#!/usr/bin/env bash
# Installe ET déploie Divertiflix sur un serveur Ubuntu (testé sur 20.04, 22.04 et 24.04).
# Usage (sur le serveur, depuis une copie du dépôt) : sudo ./install-serveur.sh
#
# Ce que fait le script :
#   1. paquets système (Docker, nginx, certbot, ufw, .NET 9, Node 22, ...)
#   2. utilisateur système + /opt/divertiflix (copie du dépôt)
#   3. secrets générés une fois dans /opt/divertiflix/.env (mot de passe BD, clé JWT, mot de passe admin)
#   4. PostgreSQL / Mosquitto / Redis via docker compose (ports liés à 127.0.0.1)
#   5. build de l'API (.NET), du front React et du back-office Angular
#   6. service systemd divertiflix-api + site nginx (React sur /, Angular sur /admin/, API sur /api)
#   7. HTTPS Let's Encrypt si DOMAIN et CERTBOT_EMAIL sont fournis
#
# Variables d'environnement :
#   DOMAIN=            nom de domaine du site (sinon accès par IP en HTTP)
#   CERTBOT_EMAIL=     e-mail pour Let's Encrypt (avec DOMAIN → HTTPS automatique)
#   ADMIN_LOGIN=root   login du compte administrateur créé au premier démarrage
#   ADMIN_PASSWORD=    mot de passe du compte administrateur (sinon généré aléatoirement)
#   ENABLE_FIREWALL=1  ufw : SSH, 80, 443 ouverts
#   MQTT_BIND=127.0.0.1  adresse d'écoute de Mosquitto (mettre 0.0.0.0 pour les ESP32, voir note en bas)
#   APP_USER=divertiflix
# Idempotent : relancer le script redéploie la dernière version sans toucher aux secrets ni à la base.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Lance ce script avec sudo."; exit 1; }
. /etc/os-release
[ "$ID" = ubuntu ] || { echo "Prévu pour Ubuntu (détecté : $ID)."; exit 1; }

SRC_DIR=$(cd "$(dirname "$0")" && pwd)
[ -f "$SRC_DIR/docker-compose.yml" ] && [ -d "$SRC_DIR/apps/api" ] || { echo "Lance le script depuis la racine du dépôt Divertiflix."; exit 1; }

DOMAIN=${DOMAIN:-}
CERTBOT_EMAIL=${CERTBOT_EMAIL:-}
ADMIN_LOGIN=${ADMIN_LOGIN:-root}
ADMIN_PASSWORD=${ADMIN_PASSWORD:-}
ENABLE_FIREWALL=${ENABLE_FIREWALL:-1}
MQTT_BIND=${MQTT_BIND:-127.0.0.1}
APP_USER=${APP_USER:-divertiflix}
APP_DIR=/opt/divertiflix
export DEBIAN_FRONTEND=noninteractive

# ---------------------------------------------------------------- 1. Paquets
apt-get update
apt-get install -y ca-certificates curl gnupg git rsync openssl ufw unattended-upgrades \
  postgresql-client mosquitto-clients nginx certbot python3-certbot-nginx

# Docker Engine + Compose (dépôt officiel)
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

# .NET 9 SDK (compile l'API ; contient aussi le runtime ASP.NET)
# Microsoft ne publie plus dotnet-sdk-9.0 dans les dépôts apt d'Ubuntu (confirmé sur 20.04/22.04/24.04) :
# on tente quand même au cas où une future version Ubuntu le réintroduirait, en silence, puis on bascule
# sur dotnet-install.sh sans faire croire à une erreur dans les logs.
if ! dotnet --list-sdks 2>/dev/null | grep -q '^9\.'; then
  if apt-get install -y dotnet-sdk-9.0 >/tmp/dotnet-apt.log 2>&1; then
    :
  else
    echo ">> dotnet-sdk-9.0 absent des dépôts Ubuntu (normal) ; installation via dotnet-install.sh"
    curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
    bash /tmp/dotnet-install.sh --channel 9.0 --install-dir /usr/share/dotnet
    ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet
  fi
fi
export DOTNET_CLI_TELEMETRY_OPTOUT=1

# Node 22 (compile React et Angular)
# Purge d'abord le nodejs/libnode fourni par Ubuntu (ex. 10.x sur 20.04) : sinon le paquet nodesource
# se pose "over" l'ancien et dpkg râle sur des dépendances cassées (inoffensif mais bruyant dans les logs).
# Angular 22 exige Node >= 22.22 : on compare la version complete, pas seulement "v22".
node_ok() { node -e 'const [a,b]=process.versions.node.split(".").map(Number); process.exit(a===22&&b>=22?0:1)' 2>/dev/null; }
if ! node_ok; then
  apt-get purge -y nodejs npm libnode-dev libnode64 nodejs-doc >/dev/null 2>&1 || true
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# ---------------------------------------------------------------- 2. Utilisateur et code
# Compte systeme sans connexion. Il n'est volontairement PAS dans le groupe docker : cet acces equivaut a root, et ce compte
# execute l'API exposee sur Internet. Le script (root) pilote Docker lui-meme.
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
gpasswd -d "$APP_USER" docker >/dev/null 2>&1 || true   # retire l'acces laisse par une ancienne version du script
install -d -o "$APP_USER" -g "$APP_USER" "$APP_DIR"
rsync -a --delete \
  --exclude .git --exclude node_modules --exclude dist --exclude .angular --exclude .logs \
  --exclude bin --exclude obj --exclude .env --exclude publish \
  "$SRC_DIR"/ "$APP_DIR"/
chown -R "$APP_USER":"$APP_USER" "$APP_DIR"

# ---------------------------------------------------------------- 3. Secrets (générés une seule fois)
ENV_FILE=$APP_DIR/.env
NEW_SECRETS=0
if [ ! -f "$ENV_FILE" ]; then
  NEW_SECRETS=1
  PG_PASS=$(openssl rand -hex 24)
  ( umask 077; cat > "$ENV_FILE" <<EOF
POSTGRES_PASSWORD=$PG_PASS
MQTT_BIND=$MQTT_BIND
ASPNETCORE_ENVIRONMENT=Production
ConnectionStrings__Default=Host=127.0.0.1;Port=5432;Database=divertiflix;Username=divertiflix;Password=$PG_PASS
Jwt__Key=$(openssl rand -hex 48)
Seed__AdminLogin=$ADMIN_LOGIN
Seed__AdminPassword=${ADMIN_PASSWORD:-$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)}
EOF
  )   # umask 077 : le fichier n'est jamais lisible par un autre compte, meme un instant
  chown "$APP_USER":"$APP_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"
fi
# Origine autorisée (CORS) : mise à jour à chaque exécution
sed -i '/^Cors__Origins__0=/d' "$ENV_FILE"
if [ -n "$DOMAIN" ]; then
  scheme=http; [ -n "$CERTBOT_EMAIL" ] && scheme=https
  echo "Cors__Origins__0=$scheme://$DOMAIN" >> "$ENV_FILE"
fi

# ---------------------------------------------------------------- 4. Infrastructure Docker
# docker-compose.yml publie déjà les ports sur 127.0.0.1 (Docker contourne ufw) ; Mosquitto suit MQTT_BIND.
cat > "$APP_DIR/docker-compose.prod.yml" <<'EOF'
services:
  postgres:
    restart: unless-stopped
  mosquitto:
    restart: unless-stopped
  redis:
    restart: unless-stopped
EOF
chown "$APP_USER":"$APP_USER" "$APP_DIR/docker-compose.prod.yml"
COMPOSE="docker compose --project-directory $APP_DIR --env-file $ENV_FILE -p divertiflix -f $APP_DIR/docker-compose.yml -f $APP_DIR/docker-compose.prod.yml"
$COMPOSE up -d
echo ">> Attente de PostgreSQL..."
for _ in $(seq 1 60); do
  $COMPOSE exec -T postgres pg_isready -U divertiflix >/dev/null 2>&1 && break
  sleep 1
done

# Le mot de passe POSTGRES_PASSWORD n'est appliqué par l'image postgres qu'à la toute première
# initialisation du volume ; si pgdata existait déjà (déploiement précédent, test manuel avant ce
# script...) avec un autre mot de passe, l'API n'arrivera jamais à se connecter (28P01). On
# resynchronise donc le rôle à chaque exécution via le socket local (auth "trust" du conteneur,
# sans avoir besoin de connaître l'ancien mot de passe) : idempotent, ne touche pas aux données.
CUR_PG_PASS=$(grep '^POSTGRES_PASSWORD=' "$ENV_FILE" | cut -d= -f2-)
$COMPOSE exec -T -u postgres postgres psql -U divertiflix -d divertiflix \
  -c "ALTER ROLE divertiflix WITH PASSWORD '$CUR_PG_PASS';" >/dev/null

# ---------------------------------------------------------------- 5. Build
as_app() { sudo -u "$APP_USER" -H env DOTNET_CLI_TELEMETRY_OPTOUT=1 bash -c "cd $APP_DIR && $1"; }

systemctl stop divertiflix-api 2>/dev/null || true
as_app "dotnet publish apps/api/src/Divertiflix.Api -c Release -o $APP_DIR/publish/api"
as_app "npm ci"
as_app "npm run build -w web-react"
as_app "cd apps/admin-angular && npx ng build --base-href /admin/"

WWW=/var/www/divertiflix
install -d "$WWW/web" "$WWW/admin"
rsync -a --delete "$APP_DIR/apps/web-react/dist/" "$WWW/web/"
rsync -a --delete "$APP_DIR/apps/admin-angular/dist/admin-angular/browser/" "$WWW/admin/"

# ---------------------------------------------------------------- 6. systemd + nginx
cat > /etc/systemd/system/divertiflix-api.service <<EOF
[Unit]
Description=Divertiflix API (.NET)
After=network-online.target docker.service
Wants=network-online.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR/publish/api
EnvironmentFile=$ENV_FILE
Environment=DOTNET_ROOT=$(dirname "$(readlink -f "$(command -v dotnet)")")
ExecStart=$(readlink -f "$(command -v dotnet)") Divertiflix.Api.dll --urls http://127.0.0.1:5080
Restart=always
RestartSec=3
# Durcissement : l'API n'ecrit nulle part (sauf son etat), ne voit pas /home, n'a aucun privilege ni acces aux peripheriques.
Environment=HOME=/var/lib/divertiflix
StateDirectory=divertiflix
NoNewPrivileges=true
ProtectSystem=strict
ProtectHome=true
PrivateTmp=true
PrivateDevices=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX
RestrictSUIDSGID=true
LockPersonality=true
CapabilityBoundingSet=

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now divertiflix-api

# En-têtes de sécurité des pages statiques (l'API pose les siens). CSP stricte : scripts uniquement de notre origine ;
# les styles en ligne restent permis (Angular Material et les attributs style de React) ; médias HLS de démonstration via Mux.
install -d /etc/nginx/snippets
{
  cat <<'HDR'
add_header X-Content-Type-Options "nosniff" always;
add_header X-Frame-Options "DENY" always;
add_header Referrer-Policy "strict-origin-when-cross-origin" always;
add_header Permissions-Policy "camera=(), microphone=(), geolocation=(), payment=(), usb=()" always;
add_header Cross-Origin-Opener-Policy "same-origin" always;
add_header Content-Security-Policy "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob: https:; font-src 'self'; media-src 'self' blob: https://*.mux.com; connect-src 'self' wss://$host ws://$host https://*.mux.com; worker-src 'self' blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'; object-src 'none'" always;
HDR
  # HSTS seulement quand HTTPS est prévu : un navigateur retient l'engagement un an.
  if [ -n "$DOMAIN" ] && [ -n "$CERTBOT_EMAIL" ]; then
    echo 'add_header Strict-Transport-Security "max-age=31536000" always;'
  fi
} > /etc/nginx/snippets/divertiflix-security.conf

cat > /etc/nginx/conf.d/divertiflix-http.conf <<'HTTPCONF'
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
limit_req_zone $binary_remote_addr zone=divertiflix_auth:10m rate=5r/s;
gzip on;
gzip_comp_level 5;
gzip_min_length 1024;
gzip_vary on;
gzip_types text/css application/javascript application/json image/svg+xml application/manifest+json;
server_tokens off;
HTTPCONF
rm -f /etc/nginx/conf.d/divertiflix-upgrade.conf

cat > /etc/nginx/sites-available/divertiflix <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${DOMAIN:-_};
    client_max_body_size 10m;

    # Défense en profondeur : l'API limite aussi le débit, mais nginx coupe les rafales avant qu'elles n'arrivent jusqu'à elle.
    location /api/auth/ {
        limit_req zone=divertiflix_auth burst=20 nodelay;
        limit_req_status 429;
        proxy_pass http://127.0.0.1:5080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    # Temps réel (SignalR, WebSocket) : connexions longues.
    location /api/hubs/ {
        proxy_pass http://127.0.0.1:5080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 1h;
        proxy_send_timeout 1h;
        proxy_buffering off;
    }

    # Médias : pas de tampon disque pour de gros fichiers, les requêtes Range passent telles quelles.
    location /api/media/ {
        proxy_pass http://127.0.0.1:5080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_buffering off;
        proxy_read_timeout 120s;
    }

    location /api/ {
        proxy_pass http://127.0.0.1:5080;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
    }

    location /admin/ {
        alias $WWW/admin/;
        try_files \$uri \$uri/ /admin/index.html;
        include /etc/nginx/snippets/divertiflix-security.conf;
        add_header Cache-Control "no-cache" always;
    }

    # Fichiers à empreinte (Vite) : cache d'un an, jamais revalidés.
    location /assets/ {
        root $WWW/web;
        include /etc/nginx/snippets/divertiflix-security.conf;
        add_header Cache-Control "public, max-age=31536000, immutable" always;
    }

    location / {
        root $WWW/web;
        try_files \$uri /index.html;
        include /etc/nginx/snippets/divertiflix-security.conf;
        add_header Cache-Control "no-cache" always;
    }
}
EOF
rm -f /etc/nginx/sites-enabled/default
ln -sf /etc/nginx/sites-available/divertiflix /etc/nginx/sites-enabled/divertiflix
nginx -t
systemctl enable nginx
systemctl reload nginx || systemctl restart nginx

# ---------------------------------------------------------------- 7. Pare-feu et HTTPS
if [ "$ENABLE_FIREWALL" = 1 ]; then
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  ufw --force enable
fi
if [ -n "$DOMAIN" ] && [ -n "$CERTBOT_EMAIL" ]; then
  certbot --nginx -d "$DOMAIN" -m "$CERTBOT_EMAIL" --agree-tos --no-eff-email --redirect --non-interactive \
    || echo "!! Certbot a échoué (le DNS de $DOMAIN pointe-t-il vers ce serveur ?). Relance le script ensuite."
fi

# ---------------------------------------------------------------- Résumé
echo
echo ">> Terminé."
echo "   API      : $(systemctl is-active divertiflix-api)  (journalctl -u divertiflix-api -f)"
echo "   Site     : http://${DOMAIN:-<IP du serveur>}/        Back-office : http://${DOMAIN:-<IP du serveur>}/admin/"
if [ "$NEW_SECRETS" = 1 ]; then
  echo "   Admin    : $(grep '^Seed__AdminLogin=' "$ENV_FILE" | cut -d= -f2) / $(grep '^Seed__AdminPassword=' "$ENV_FILE" | cut -d= -f2)"
  echo "   (secrets dans $ENV_FILE, lisible par $APP_USER seulement)"
fi
echo "   MQTT     : écoute sur $MQTT_BIND:1883 (anonyme, cf. infra/mosquitto/mosquitto.conf)."
echo "              Pour les ESP32 : MQTT_BIND=0.0.0.0 puis 'ufw allow from 10.10.4.0/24 to any port 1883 proto tcp'"
echo "              (Docker contourne ufw : préférer une règle iptables DOCKER-USER, et activer un mot de passe Mosquitto)."

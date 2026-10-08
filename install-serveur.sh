#!/usr/bin/env bash
# Installe ET déploie Divertiflix sur un serveur Ubuntu 22.04/24.04.
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
if ! dotnet --list-sdks 2>/dev/null | grep -q '^9\.'; then
  apt-get install -y dotnet-sdk-9.0 || {
    echo "dotnet-sdk-9.0 absent des dépôts Ubuntu ; installation via dotnet-install.sh"
    curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
    bash /tmp/dotnet-install.sh --channel 9.0 --install-dir /usr/share/dotnet
    ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet
  }
fi
export DOTNET_CLI_TELEMETRY_OPTOUT=1

# Node 22 (compile React et Angular)
if ! node --version 2>/dev/null | grep -q '^v22\.'; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# ---------------------------------------------------------------- 2. Utilisateur et code
id "$APP_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$APP_USER"
usermod -aG docker "$APP_USER"
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
  cat > "$ENV_FILE" <<EOF
POSTGRES_PASSWORD=$PG_PASS
MQTT_BIND=$MQTT_BIND
ASPNETCORE_ENVIRONMENT=Production
ConnectionStrings__Default=Host=127.0.0.1;Port=5432;Database=divertiflix;Username=divertiflix;Password=$PG_PASS
Jwt__Key=$(openssl rand -hex 48)
Seed__AdminLogin=$ADMIN_LOGIN
Seed__AdminPassword=$(openssl rand -base64 18 | tr -d '/+=' | cut -c1-20)
EOF
  chown "$APP_USER":"$APP_USER" "$ENV_FILE"; chmod 600 "$ENV_FILE"
fi
# Origine autorisée (CORS) : mise à jour à chaque exécution
sed -i '/^Cors__Origins__0=/d' "$ENV_FILE"
if [ -n "$DOMAIN" ]; then
  scheme=http; [ -n "$CERTBOT_EMAIL" ] && scheme=https
  echo "Cors__Origins__0=$scheme://$DOMAIN" >> "$ENV_FILE"
fi

# ---------------------------------------------------------------- 4. Infrastructure Docker
# docker-compose.yml publie les ports sur toutes les interfaces et Docker contourne ufw :
# en production on les restreint à 127.0.0.1 (Mosquitto : MQTT_BIND).
cat > "$APP_DIR/docker-compose.prod.yml" <<'EOF'
services:
  postgres:
    restart: unless-stopped
    ports: !override ["127.0.0.1:5432:5432"]
  mosquitto:
    restart: unless-stopped
    ports: !override ["${MQTT_BIND:-127.0.0.1}:1883:1883"]
  redis:
    restart: unless-stopped
    ports: !override ["127.0.0.1:6379:6379"]
EOF
chown "$APP_USER":"$APP_USER" "$APP_DIR/docker-compose.prod.yml"
COMPOSE="docker compose --project-directory $APP_DIR --env-file $ENV_FILE -p divertiflix -f $APP_DIR/docker-compose.yml -f $APP_DIR/docker-compose.prod.yml"
$COMPOSE up -d
echo ">> Attente de PostgreSQL..."
for _ in $(seq 1 60); do
  $COMPOSE exec -T postgres pg_isready -U divertiflix >/dev/null 2>&1 && break
  sleep 1
done

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
NoNewPrivileges=true
ProtectSystem=full
PrivateTmp=true

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable --now divertiflix-api

cat > /etc/nginx/sites-available/divertiflix <<EOF
server {
    listen 80 default_server;
    listen [::]:80 default_server;
    server_name ${DOMAIN:-_};
    client_max_body_size 10m;

    location /api/ {
        proxy_pass http://127.0.0.1:5080;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        # SignalR / WebSocket (étape 4)
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection \$connection_upgrade;
    }

    location /admin/ {
        alias $WWW/admin/;
        try_files \$uri \$uri/ /admin/index.html;
    }

    location / {
        root $WWW/web;
        try_files \$uri /index.html;
    }
}
EOF
# \$connection_upgrade doit être défini au niveau http
cat > /etc/nginx/conf.d/divertiflix-upgrade.conf <<'EOF'
map $http_upgrade $connection_upgrade { default upgrade; '' close; }
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

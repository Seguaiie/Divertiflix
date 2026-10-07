#!/usr/bin/env bash
# Prépare un serveur Ubuntu 22.04/24.04 pour héberger Divertiflix.
# Usage (sur le serveur) : sudo ./install-serveur.sh
# Options (variables d'environnement) :
#   ENABLE_FIREWALL=1   active ufw (SSH, 80, 443 ouverts)      [défaut 1]
#   INSTALL_NGINX=1     nginx + certbot (proxy inverse + HTTPS)  [défaut 1]
#   INSTALL_DOTNET=0    SDK .NET 9 natif (inutile si l'API tourne dans Docker) [défaut 0]
#   INSTALL_NODE=0      Node 22 pour compiler React/Angular sur le serveur      [défaut 0]
#   APP_USER=divertiflix  utilisateur système qui possède /opt/divertiflix
# Idempotent : peut être relancé sans danger.
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Lance ce script avec sudo."; exit 1; }
. /etc/os-release
[ "$ID" = ubuntu ] || { echo "Prévu pour Ubuntu (détecté : $ID)."; exit 1; }

ENABLE_FIREWALL=${ENABLE_FIREWALL:-1}
INSTALL_NGINX=${INSTALL_NGINX:-1}
INSTALL_DOTNET=${INSTALL_DOTNET:-0}
INSTALL_NODE=${INSTALL_NODE:-0}
APP_USER=${APP_USER:-divertiflix}
export DEBIAN_FRONTEND=noninteractive

apt-get update
apt-get install -y ca-certificates curl gnupg git ufw unattended-upgrades postgresql-client mosquitto-clients

# --- Docker Engine + Compose (dépôt officiel) ---
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu $VERSION_CODENAME stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
systemctl enable --now docker

# --- Utilisateur applicatif et dossier de déploiement ---
id "$APP_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$APP_USER"
usermod -aG docker "$APP_USER"
install -d -o "$APP_USER" -g "$APP_USER" /opt/divertiflix

# --- Nginx + certbot ---
if [ "$INSTALL_NGINX" = 1 ]; then
  apt-get install -y nginx certbot python3-certbot-nginx
  systemctl enable --now nginx
fi

# --- .NET 9 SDK natif (optionnel) ---
if [ "$INSTALL_DOTNET" = 1 ]; then
  apt-get install -y dotnet-sdk-9.0 || {
    echo "dotnet-sdk-9.0 absent des dépôts Ubuntu ; installation via dotnet-install.sh"
    curl -fsSL https://dot.net/v1/dotnet-install.sh -o /tmp/dotnet-install.sh
    bash /tmp/dotnet-install.sh --channel 9.0 --install-dir /usr/share/dotnet
    ln -sf /usr/share/dotnet/dotnet /usr/local/bin/dotnet
  }
fi

# --- Node 22 (optionnel) ---
if [ "$INSTALL_NODE" = 1 ]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

# --- Pare-feu : SSH d'abord pour ne pas se verrouiller dehors ---
if [ "$ENABLE_FIREWALL" = 1 ]; then
  ufw allow OpenSSH
  ufw allow 80/tcp
  ufw allow 443/tcp
  # 1883 (MQTT) volontairement fermé : à ouvrir seulement depuis le VLAN des ESP32, ex. :
  #   ufw allow from 10.10.4.0/24 to any port 1883 proto tcp
  ufw --force enable
fi

echo ">> Terminé."
docker --version
docker compose version
echo ">> Déploiement : copier le dépôt dans /opt/divertiflix puis 'docker compose up -d' (utilisateur $APP_USER)."

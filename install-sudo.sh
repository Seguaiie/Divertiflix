#!/usr/bin/env bash
# Installe les logiciels système de Divertiflix (nécessite sudo).
# Usage : ./install-sudo.sh   (ou ! ./install-sudo.sh dans Claude Code)
# Pop!_OS 24.04 (base Ubuntu noble). Chaque composant est optionnel : voir les variables ci-dessous.
set -euo pipefail

INSTALL_DOCKER=${INSTALL_DOCKER:-1}          # Docker Engine + Compose (cible de l'étape 5)
INSTALL_POSTGRES_CLIENT=${INSTALL_POSTGRES_CLIENT:-1}  # psql, pour inspecter la BD du conteneur
INSTALL_MOSQUITTO_CLIENTS=${INSTALL_MOSQUITTO_CLIENTS:-1}  # mosquitto_pub/sub pour simuler un ESP32
INSTALL_POSTGRES_SERVER=${INSTALL_POSTGRES_SERVER:-0}  # serveur local : inutile si Docker

sudo apt-get update

if [ "$INSTALL_DOCKER" = 1 ]; then
  sudo apt-get install -y ca-certificates curl
  sudo install -m 0755 -d /etc/apt/keyrings
  sudo curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  sudo chmod a+r /etc/apt/keyrings/docker.asc
  # Pop!_OS 24.04 = Ubuntu noble ; on force le nom de release pour le dépôt Docker.
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu noble stable" \
    | sudo tee /etc/apt/sources.list.d/docker.list >/dev/null
  sudo apt-get update
  sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
  sudo usermod -aG docker "$USER"
  echo ">> Docker installé. Ouvre une nouvelle session (ou 'newgrp docker') pour utiliser docker sans sudo."
fi

[ "$INSTALL_POSTGRES_CLIENT" = 1 ] && sudo apt-get install -y postgresql-client
[ "$INSTALL_MOSQUITTO_CLIENTS" = 1 ] && sudo apt-get install -y mosquitto-clients
[ "$INSTALL_POSTGRES_SERVER" = 1 ] && sudo apt-get install -y postgresql

echo ">> Terminé. Versions :"
docker --version 2>/dev/null || true
docker compose version 2>/dev/null || true
psql --version 2>/dev/null || true

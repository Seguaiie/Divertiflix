#!/usr/bin/env bash
# Actions administrateur à exécuter UNE FOIS avec sudo, sur 192.168.8.115.
# Usage : sudo bash admin-actions.sh
#
# Fait :
#   1. Étend le volume racine avec le nouveau disque /dev/sdb (64 Go)
#   2. Met le mot de passe admin par défaut de Divertiflix à la valeur de $ADMIN_PASSWORD
#   3. Installe et configure GitLab CE (allégé en RAM) pour le CI/CD, sur le port 8181
#
# Usage : sudo ADMIN_PASSWORD='...' bash admin-actions.sh
set -euo pipefail

[ "$(id -u)" -eq 0 ] || { echo "Lance ce script avec sudo : sudo ADMIN_PASSWORD='...' bash admin-actions.sh"; exit 1; }
: "${ADMIN_PASSWORD:?Définis ADMIN_PASSWORD avant de lancer ce script, ex: sudo ADMIN_PASSWORD='...' bash admin-actions.sh}"

echo "=============================================="
echo "1) Extension du disque racine avec /dev/sdb (64G)"
echo "=============================================="
VG=ubuntu-vg
LVPATH=/dev/mapper/ubuntu--vg-ubuntu--lv

if [ -b /dev/sdb ]; then
  if ! pvs --noheadings -o pv_name 2>/dev/null | grep -q '/dev/sdb'; then
    pvcreate /dev/sdb
    vgextend "$VG" /dev/sdb
  else
    echo "/dev/sdb déjà dans le VG, on passe."
  fi
  lvextend -l +100%FREE "$LVPATH" || echo "lvextend : déjà à la taille max ou rien à étendre."
  resize2fs "$LVPATH"
else
  echo "/dev/sdb introuvable, étape ignorée."
fi
df -h /

echo
echo "=============================================="
echo "2) Mot de passe admin par défaut -> \$ADMIN_PASSWORD"
echo "=============================================="
ENV_FILE=/opt/divertiflix/.env
if [ -f "$ENV_FILE" ]; then
  sed -i "s#^Seed__AdminPassword=.*#Seed__AdminPassword=${ADMIN_PASSWORD}#" "$ENV_FILE"
  grep '^Seed__AdminLogin' "$ENV_FILE"
  echo "Seed__AdminPassword=(mis à jour)"
  systemctl restart divertiflix-api
  sleep 2
  systemctl is-active divertiflix-api
else
  echo "Fichier $ENV_FILE introuvable, rien à changer (pas encore déployé en prod ?)."
fi

echo
echo "=============================================="
echo "3) Installation de GitLab CE (CI/CD), port 8181"
echo "=============================================="
if ! command -v gitlab-ctl >/dev/null 2>&1; then
  curl -fsSL https://packages.gitlab.com/install/repositories/gitlab/gitlab-ce/script.deb.sh | bash
  SERVER_IP=$(hostname -I | awk '{print $1}')
  EXTERNAL_URL="http://$SERVER_IP:8181" apt-get install -y gitlab-ce
else
  echo "GitLab déjà installé, on passe à la (re)config."
fi

MARKER="# --- Réglages allégés Divertiflix ---"
if ! grep -qF "$MARKER" /etc/gitlab/gitlab.rb 2>/dev/null; then
  cat >> /etc/gitlab/gitlab.rb <<EOF

$MARKER
# Ce serveur partage 8 Go de RAM avec Divertiflix (API, PostgreSQL, Redis, Mosquitto, nginx).
puma['worker_processes'] = 0
sidekiq['max_concurrency'] = 10
prometheus_monitoring['enable'] = false
grafana['enable'] = false
alertmanager['enable'] = false
gitlab_exporter['enable'] = false
postgres_exporter['enable'] = false
redis_exporter['enable'] = false
node_exporter['enable'] = false
EOF
fi

gitlab-ctl reconfigure

ufw allow 8181/tcp 2>/dev/null || true

echo
echo ">> Terminé."
echo ">> GitLab : http://$(hostname -I | awk '{print $1}'):8181"
echo ">> Mot de passe root GitLab initial :"
cat /etc/gitlab/initial_root_password 2>/dev/null || echo "   (fichier déjà expiré après 24h, ou déjà changé)"
echo
free -h

#!/usr/bin/env bash
# Lance tous les services de Divertiflix (dev) : Docker (PostgreSQL, Mosquitto, Redis), API .NET, front React, back-office Angular.
# Usage : ./start-all.sh      (arrêt : ./stop-all.sh ; logs dans .logs/)
cd "$(dirname "$0")"
source ./env.sh

mkdir -p .logs

echo ">> Docker Compose (PostgreSQL, Mosquitto, Redis)"
if docker info >/dev/null 2>&1; then docker compose up -d
else sg docker -c "docker compose up -d"; fi

echo ">> Attente de PostgreSQL..."
until docker exec divertiflix-postgres-1 pg_isready -U divertiflix >/dev/null 2>&1 \
   || sg docker -c "docker exec divertiflix-postgres-1 pg_isready -U divertiflix" >/dev/null 2>&1; do sleep 1; done

port_used() { ss -ltnH "sport = :$1" 2>/dev/null | grep -q .; }

start() {  # $1 = port, $2 = nom, $3 = log, reste = commande
  local port=$1 name=$2 log=$3; shift 3
  if port_used "$port"; then echo ">> $name (port $port) : déjà lancé"; return; fi
  echo ">> $name (port $port) : démarrage"
  setsid nohup "$@" > ".logs/$log" 2>&1 < /dev/null &
}

start 5080 "API .NET" api.log \
  env ASPNETCORE_ENVIRONMENT=Development dotnet run --project apps/api/src/Divertiflix.Api --urls http://localhost:5080
# --host 0.0.0.0 : Vite et ng serve n'écoutent que sur 127.0.0.1 par défaut, invisibles depuis
# une autre machine même quand le pare-feu autorise le port (vérifié : ufw laissait passer, mais
# rien n'écoutait sur l'interface externe).
start 5173 "Front React" react.log npm run dev -w web-react -- --host 0.0.0.0
start 4200 "Back-office Angular" angular.log npm start -w admin-angular -- --host 0.0.0.0

echo ">> Attente des ports..."
for p in 5080 5173 4200; do
  for _ in $(seq 1 90); do port_used "$p" && break; sleep 1; done
  port_used "$p" && echo "   $p OK" || echo "   $p PAS PRÊT (voir .logs/)"
done

# Identifiants admin : "boom123$" n'est utilisé par le Seeder que si Seed:AdminPassword n'est pas
# configuré du tout. Si le port 5080 était déjà pris par le service de prod (cas le plus courant
# ici), c'est LUI qui répond aux appels API, avec le mot de passe de /opt/divertiflix/.env.
if grep -q '^Seed__AdminPassword=' /opt/divertiflix/.env 2>/dev/null; then
  ADMIN_HINT="voir 'Seed__AdminPassword' dans /opt/divertiflix/.env (mot de passe aléatoire, pas boom123\$)"
else
  ADMIN_HINT="root / boom123\$"
fi

cat <<EOF

React      : http://$(hostname -I | awk '{print $1}'):5173
Angular    : http://$(hostname -I | awk '{print $1}'):4200   ($ADMIN_HINT)
API        : http://$(hostname -I | awk '{print $1}'):5080
EOF

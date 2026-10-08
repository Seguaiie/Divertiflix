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
start 5173 "Front React" react.log npm run web
start 4200 "Back-office Angular" angular.log npm start -w admin-angular

echo ">> Attente des ports..."
for p in 5080 5173 4200; do
  for _ in $(seq 1 90); do port_used "$p" && break; sleep 1; done
  port_used "$p" && echo "   $p OK" || echo "   $p PAS PRÊT (voir .logs/)"
done

cat <<EOF

React      : http://localhost:5173
Angular    : http://localhost:4200   (root / boom123\$)
API        : http://localhost:5080
EOF

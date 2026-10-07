#!/usr/bin/env bash
# Arrête tous les services de Divertiflix (dev) : API .NET, front React, back-office Angular, conteneurs Docker.
# Usage : ./stop-all.sh        (les données PostgreSQL sont conservées)
#         ./stop-all.sh --purge   (supprime aussi les volumes Docker : base de données effacée !)
# On tue par port plutôt que par nom de processus : évite de se tuer soi-même (piège de pkill -f).
cd "$(dirname "$0")"

kill_port() {  # $1 = port, $2 = nom
  local pids
  pids=$(ss -ltnpH "sport = :$1" 2>/dev/null | grep -o 'pid=[0-9]*' | cut -d= -f2 | sort -u)
  if [ -n "$pids" ]; then
    echo ">> $2 (port $1) : arrêt de $pids"
    kill $pids 2>/dev/null
    sleep 1
    for p in $pids; do kill -0 "$p" 2>/dev/null && kill -9 "$p" 2>/dev/null; done
  else
    echo ">> $2 (port $1) : déjà arrêté"
  fi
}

kill_port 5080 "API .NET"
kill_port 5173 "Front React (Vite)"
kill_port 4200 "Back-office Angular (ng serve)"

# Processus dotnet orphelins lancés par 'dotnet run' (le serveur de build reste en arrière-plan)
dotnet build-server shutdown >/dev/null 2>&1 || true

echo ">> Docker Compose (PostgreSQL, Mosquitto, Redis)"
down_args=(); [ "$1" = "--purge" ] && down_args=(-v)
if docker info >/dev/null 2>&1; then docker compose down "${down_args[@]}"
else sg docker -c "docker compose down ${down_args[*]}"; fi

echo ">> Terminé."

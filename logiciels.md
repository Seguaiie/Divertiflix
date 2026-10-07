# Logiciels et bibliothèques installés

## Outils (espace utilisateur, sans sudo)
| Outil | Version | Installation | Usage |
|---|---|---|---|
| .NET SDK | 9.0.318 | `dotnet-install.sh` → `~/.dotnet` | API C# |
| nvm | 0.40.1 | script officiel → `~/.nvm` | Gestion de Node |
| Node.js | 22.23.3 | `nvm install 22` | Angular, React, TypeScript |

| dotnet-ef | 9.0.20 | `dotnet tool install --global` → `~/.dotnet/tools` | Migrations EF |

Activation : `source env.sh`.

## Images Docker (docker-compose.yml)
`postgres:17`, `eclipse-mosquitto:2`, `redis:7-alpine`.

## Paquets NuGet (apps/api)
| Paquet | Version | Projet |
|---|---|---|
| Microsoft.EntityFrameworkCore | 9.0.x | Infrastructure |
| Npgsql.EntityFrameworkCore.PostgreSQL | 9.0.x | Infrastructure |
| Microsoft.AspNetCore.Authentication.JwtBearer | 9.0.x | Api |
| Microsoft.EntityFrameworkCore.Design | 9.0.x | Api |
| MQTTnet | 5.2.0 | Api |
| Microsoft.AspNetCore.Mvc.Testing | 9.0.x | Tests |
| Npgsql | 9.0.x | Tests |

## À installer par l'utilisateur (sudo requis)
Lancer `./install-sudo.sh` (ou `! ./install-sudo.sh` dans Claude Code) :
- Docker Engine + plugin Compose (dépôt officiel Docker, noble)
- `postgresql-client` (psql) et `mosquitto-clients` (simuler l'ESP32)
- Serveur PostgreSQL local : optionnel, `INSTALL_POSTGRES_SERVER=1 ./install-sudo.sh` (inutile avec Docker)

## Serveur Ubuntu (production)
Lancer `sudo ./install-serveur.sh` sur le serveur (Ubuntu 22.04/24.04, idempotent) :
- Docker Engine + Compose, git, ufw (SSH/80/443), unattended-upgrades, `postgresql-client`, `mosquitto-clients`
- nginx + certbot (désactivable : `INSTALL_NGINX=0`)
- Optionnels : `.NET 9 SDK` (`INSTALL_DOTNET=1`), Node 22 (`INSTALL_NODE=1`)
- Crée l'utilisateur `divertiflix` et `/opt/divertiflix`. Port MQTT 1883 fermé par défaut (à ouvrir pour le VLAN 10.10.4.0/24).

## Paquets npm
| Paquet | Où |
|---|---|
| react 19, react-dom, vite 8, typescript 6, oxlint | web-react (gabarit `create vite`) |
| @tanstack/react-query, react-router-dom, hls.js | web-react |
| vitest, jsdom, @testing-library/{react,dom,jest-dom,user-event} | web-react (tests) |
| openapi-fetch, openapi-typescript | packages/api-client |

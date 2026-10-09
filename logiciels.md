# Logiciels et bibliothèques installés

## Outils (espace utilisateur, sans sudo)
| Outil | Version | Installation | Usage |
|---|---|---|---|
| .NET SDK | 9.0.318 | `dotnet-install.sh` → `~/.dotnet` | API C# |
| nvm | 0.40.1 | script officiel → `~/.nvm` | Gestion de Node |
| Node.js | 22.23.3 | `nvm install 22` | Angular, React, TypeScript |

| dotnet-ef | 9.0.20 | `dotnet tool install --global` → `~/.dotnet/tools` | Migrations EF |

Activation : `source env.sh`. **Après déploiement serveur** (`install-serveur.sh`), le PATH doit
plutôt viser le .NET/Node système : `DOTNET_ROOT=/usr/share/dotnet`, `PATH=/usr/local/bin:...`
(voir `memoire.md` § Environnement) — `~/.dotnet` n'a plus de runtime complet.

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
`sudo ./install-serveur.sh` depuis le dépôt, sur Ubuntu 22.04/24.04 (idempotent, relancer = redéployer) :
- Installe Docker + Compose, nginx, certbot, ufw, .NET 9 SDK, Node 22, git, rsync, clients psql/mosquitto
- Copie le dépôt dans `/opt/divertiflix` (utilisateur `divertiflix`), génère `/opt/divertiflix/.env` (mot de passe BD, clé JWT, mot de passe admin)
- PostgreSQL/Mosquitto/Redis via `docker-compose.prod.yml` (ports sur 127.0.0.1)
- Build API (service systemd `divertiflix-api`), React sur `/`, Angular sur `/admin/`, API sur `/api` (nginx)
- `DOMAIN=... CERTBOT_EMAIL=... sudo -E ./install-serveur.sh` pour HTTPS Let's Encrypt
- Port MQTT 1883 fermé par défaut (`MQTT_BIND=0.0.0.0` pour les ESP32 du VLAN 10.10.4.0/24)

## Paquets npm
| Paquet | Où |
|---|---|
| react 19, react-dom, vite 8, typescript 6, oxlint | web-react (gabarit `create vite`) |
| @tanstack/react-query, react-router-dom, hls.js | web-react |
| vitest, jsdom, @testing-library/{react,dom,jest-dom,user-event} | web-react (tests) |
| openapi-fetch, openapi-typescript | packages/api-client |
| @angular/{core,common,forms,router,build,cli} 22.2, @angular/material + cdk 22.2, rxjs 7.8, vitest 5 | admin-angular |
| @microsoft/signalr 10.0.11 (client du hub temps réel, étape 4) | admin-angular |

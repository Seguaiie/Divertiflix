# Ports et flux réseau

État relevé sur le serveur de production (`192.168.8.115`) le 4 novembre 2026, avec `ss -ltnup`, `docker ps`, `ufw status` et la
configuration nginx. Pour revérifier, voir [Vérifier l'état réel](#vérifier-létat-réel) en bas de page.

## Vue d'ensemble

```
                         Réseau local 192.168.8.0/24
   Navigateurs ──► :80  nginx (Divertiflix) ──► 127.0.0.1:5080  API .NET ──► 127.0.0.1:5432 PostgreSQL (Docker)
                         │  /            site React                 │      ──► 127.0.0.1:6379 Redis (Docker)
                         │  /admin/      back-office Angular        │      ──► 127.0.0.1:1883 Mosquitto (Docker)
                         │  /api/…       API                        │
                                                                    ├──► 192.168.8.180:13378  Audiobookshelf (HTTP)
                                                                    ├──► DC-01.ad.home.arpa:636 Active Directory (LDAPS)
                                                                    └──► Internet :443 (MLB, fils de nouvelles, Epoch AI)
   Navigateurs ──► :8181 GitLab (nginx embarqué de GitLab, indépendant de Divertiflix)
   Administration ──► :22 SSH
```

Le navigateur ne parle qu'au serveur Divertiflix : Audiobookshelf, l'Active Directory, la MLB et les sites de presse ne sont jamais
contactés directement par le navigateur (l'API relaie flux, vidéos et images).

## Ports ouverts sur le réseau (entrants)

| Port | Protocole | Service | Écoute sur | Pare-feu (ufw) | Rôle |
|---|---|---|---|---|---|
| 22 | TCP | OpenSSH | toutes les interfaces | autorisé | Administration du serveur |
| 80 | TCP | nginx (système) | toutes les interfaces | autorisé | Site Divertiflix (`/`), back-office (`/admin/`), API (`/api/`) |
| 443 | TCP | — | rien n'écoute | autorisé | Réservé à HTTPS : actif seulement si `DOMAIN` et `CERTBOT_EMAIL` sont fournis à `install-serveur.sh` |
| 8181 | TCP | nginx embarqué de GitLab | toutes les interfaces | autorisé | GitLab (`external_url 'http://192.168.8.115:8181'`) |
| 8060 | TCP | nginx embarqué de GitLab | toutes les interfaces | **bloqué** | Page d'état interne de GitLab ; non joignable depuis le réseau grâce à ufw |

## Ports internes (127.0.0.1 seulement)

Ces services n'écoutent que sur la boucle locale : ils ne sont pas joignables depuis le réseau, quel que soit le pare-feu.

| Port | Service | Lancé par | Notes |
|---|---|---|---|
| 5080 | API Divertiflix (.NET / Kestrel) | systemd `divertiflix-api` | nginx relaie `/api/` vers ce port |
| 5432 | PostgreSQL 17 | Docker (`divertiflix-postgres-1`) | Base de Divertiflix |
| 6379 | Redis 7 | Docker (`divertiflix-redis-1`) | Cache et présence |
| 1883 | Mosquitto (MQTT) | Docker (`divertiflix-mosquitto-1`) | Adresse d'écoute réglée par `MQTT_BIND` (voir plus bas) |
| 53 | systemd-resolved | système | Résolveur DNS local ; il interroge le routeur `192.168.8.1` |
| 8080, 8082, 8092 | GitLab (Puma, Sidekiq…) | GitLab | Interne à GitLab |
| 8150 à 8155 | GitLab KAS | GitLab | Interne à GitLab |
| 9229, 9236 | GitLab Workhorse, Gitaly | GitLab | Interne à GitLab |

## Chemins nginx vers l'API (port 80 → 127.0.0.1:5080)

| Chemin | Particularité |
|---|---|
| `/` | Site React (fichiers statiques), `no-cache` sur `index.html` |
| `/admin/` | Back-office Angular (fichiers statiques) |
| `/api/auth/` | Limitation de débit renforcée (connexion, inscription) |
| `/api/hubs/` | WebSocket (SignalR, notifications en direct), délai de lecture 1 h |
| `/api/media/` | Flux sans mise en tampon : vidéos, flux HLS des livres audio, relais des vidéos MLB et des images de presse |
| `/api/` | Reste de l'API |

## Services extérieurs appelés par le serveur (sortants)

Le pare-feu laisse tout sortir (`Default: allow (outgoing)`). Si un pare-feu est ajouté en sortie, voici ce qu'il faut autoriser.

| Destination | Port | Protocole | Utilisé pour | Réglage |
|---|---|---|---|---|
| `192.168.8.180` (Audiobookshelf) | 13378 | HTTP | Catalogue, lecture et progression des livres audio | `Audiobookshelf__Url` dans `.env` |
| `DC-01.ad.home.arpa` → `192.168.8.117` | 636 | LDAPS (TLS) | Connexion des comptes Active Directory | `ActiveDirectory__Host`, `__Port=636`, `__UseSsl=true` |
| `192.168.8.117` | 389 | LDAP | **Non utilisé** depuis le passage en LDAPS (le mot de passe y circulerait en clair) | — |
| `192.168.8.1` (routeur) | 53 | DNS | Résolution des noms | DHCP |
| Serveurs de temps | 123 | NTP (UDP) | Horloge du serveur (jetons, certificats) | `systemd-timesyncd` |
| `statsapi.mlb.com` | 443 | HTTPS | Résultats et faits saillants (onglet Domingo) | — |
| `mlb-cuts-diamond.mlb.com`, `img.mlbstatic.com`, `www.mlbstatic.com` | 443 | HTTPS | Vidéos, vignettes et logos MLB, relayés par l'API | — |
| `techcrunch.com`, `www.theverge.com`, `www.technologyreview.com`, `arstechnica.com`, `www.wired.com`, `www.theguardian.com`, `www.journaldugeek.com`, `news.google.com` | 443 | HTTPS | Nouvelles de l'IA (onglet Nicolas) | Liste dans `Services/AiNews.cs` |
| Sites des images de presse (variable) | 443 | HTTPS | Images des articles, relayées par l'API | Seulement les images trouvées dans les fils |
| `epoch.ai` | 443 | HTTPS | Classement des modèles d'IA (onglet Nicolas) | `Services/AiBenchmarks.cs` |
| `*.home.arpa` → `192.168.8.240` (Traefik) | 443 | HTTPS | Surveillance des services auto-hébergés chaque minute ; Jellyseerr (demandes) ; ntfy (alertes) | `Services/HomeServices.cs`, `Jellyseerr__*`, `Ntfy__*` — voir [home-arpa.md](home-arpa.md) |

Le nom `DC-01.ad.home.arpa` est déclaré dans `/etc/hosts` du serveur (le DNS du routeur ne le connaît pas), et l'autorité
de certification de l'AD (`ad-DC-01-CA`) est installée dans `/usr/local/share/ca-certificates/` : sans elle, LDAPS est refusé.

## Pare-feu (ufw)

Règles actuelles (IPv4 et IPv6) : **22, 80, 443, 5080, 5173, 4200, 8181** autorisés en entrée, tout le reste refusé.

À savoir :

- **5080, 5173 et 4200 ne servent à rien en production.** L'API écoute sur `127.0.0.1:5080` (injoignable depuis le réseau même
  avec la règle), et 5173 / 4200 sont les serveurs de développement Vite et Angular, qui ne tournent pas sur ce serveur. Ces
  règles peuvent être retirées : `sudo ufw delete allow 5080/tcp` (idem 5173 et 4200).
- **443** n'a d'utilité qu'une fois HTTPS configuré (`DOMAIN=… CERTBOT_EMAIL=… sudo ./install-serveur.sh`).
- **Docker contourne ufw.** Un port publié par Docker sur `0.0.0.0` est joignable depuis le réseau même si ufw ne l'autorise
  pas : c'est pourquoi `docker-compose.yml` publie PostgreSQL, Redis et Mosquitto sur `127.0.0.1` uniquement.

### Ouvrir MQTT aux ESP32 (optionnel)

Mosquitto n'écoute que sur `127.0.0.1` par défaut. Pour des capteurs ESP32 du réseau local :

```bash
MQTT_BIND=0.0.0.0 sudo ./install-serveur.sh      # mémorisé dans .env
```

Mosquitto est alors joignable depuis tout le réseau (Docker contourne ufw) et accepte les connexions anonymes. Restreindre avec
une règle `iptables` dans la chaîne `DOCKER-USER` et activer un mot de passe Mosquitto (`infra/mosquitto/mosquitto.conf`).

## Ports de développement et de test

Uniquement sur un poste de développement, ou temporairement sur le serveur pendant une intervention ; rien de tout cela ne doit
rester ouvert en production.

| Port | Usage |
|---|---|
| 5080 | API en développement (`dotnet run`, profil `http` de `launchSettings.json`) — **même port que la production** : ne pas lancer d'API de développement sur le serveur de production |
| 5013 | API en développement, autre profil de `launchSettings.json` |
| 5173 | Site React (`npm run dev`, Vite) ; relaie `/api` vers `localhost:5080` |
| 4200 | Back-office Angular (`ng serve`) ; relaie `/api` vers `localhost:5080` |
| 5099 | API de développement lancée brièvement pour exporter la description OpenAPI (`/openapi/v1.json`), quand 5080 est déjà pris |
| 55432 | PostgreSQL jetable pour les tests (`docker run --rm … -p 127.0.0.1:55432:5432 postgres:17`, puis `TEST_DB=…`) |

## Où se règle quoi

| Réglage | Fichier ou variable |
|---|---|
| Ports de PostgreSQL, Redis, Mosquitto | `docker-compose.yml` (`MQTT_BIND` pour Mosquitto) |
| Port de l'API | service systemd écrit par `install-serveur.sh` (`--urls http://127.0.0.1:5080`) |
| Site nginx, en-têtes de sécurité, chemins | écrit par `install-serveur.sh` à chaque déploiement (ne pas modifier `/etc/nginx/sites-enabled/` à la main) |
| Audiobookshelf | `AUDIOBOOKSHELF_URL`, `AUDIOBOOKSHELF_TOKEN` → `.env` |
| Active Directory | `AD_HOST`, `AD_DOMAIN`, `AD_PORT`, `AD_SSL` → `.env` |
| Pare-feu | `ENABLE_FIREWALL=1` à l'installation (SSH, 80, 443), puis `ufw` |
| GitLab | `/etc/gitlab/gitlab.rb` (`external_url`), indépendant de Divertiflix |

## Vérifier l'état réel

```bash
sudo ss -ltnup                       # tout ce qui écoute, avec le programme
docker ps --format '{{.Names}}\t{{.Ports}}'
sudo ufw status verbose
curl -sI http://127.0.0.1/ | head -3                 # nginx Divertiflix
curl -s  http://127.0.0.1:5080/api/titles -o /dev/null -w '%{http_code}\n'   # API (401 attendu sans connexion)
echo | openssl s_client -connect DC-01.ad.home.arpa:636 -verify_hostname DC-01.ad.home.arpa 2>/dev/null | grep 'Verify return'
```

# Mémoire du projet Divertiflix

## Contexte
- `porjetdivertiflyx.docx` = rapport de planification **réseau** (cours 420-511-SH, Cégep de Sherbrooke, équipe 1). Infra déjà faite/en cours : VPN, Mailcow, pare-feu, FreePBX, GitLab CE, GLPI, sauvegardes, Mosquitto/ESP32, scripts POO, VLAN (MQTT = 10.10.4.0/24, services = 10.10.2.0/24).
- Ce dépôt = l'**application métier** (streaming). Voir `plan.md`.
- Auteur du dépôt : Émilien (responsable courriel/sauvegardes dans le rapport).

## Décisions
- React = application abonné ; Angular = back-office admin/support ; API ASP.NET Core .NET 9.
- BD : **PostgreSQL seulement** (décision de l'utilisateur, Sqlite retiré). Migrations EF dans `apps/api/src/Divertiflix.Infrastructure/Migrations`, appliquées au démarrage. Nouvelle migration : `dotnet ef migrations add X -p src/Divertiflix.Infrastructure -s src/Divertiflix.Api -o Migrations` (avec `ASPNETCORE_ENVIRONMENT=Development`, `~/.dotnet/tools` dans le PATH).
- Recherche catalogue : `ILike` (Postgres est sensible à la casse).
- Tests : une base PostgreSQL jetable par classe (`TEST_DB` pour changer le serveur). Il faut `docker compose up -d` avant `dotnet test`.
- Paquets EF Core épinglés en 9.0.x (les dernières versions visent .NET 10).
- Enums sérialisés en chaînes (contrat TypeScript lisible).
- Refresh tokens : stockés hachés (SHA-256), rotation à chaque usage.

## Environnement
- `source env.sh` active .NET 9 (`~/.dotnet`) et Node 22 (nvm). Node système = 18, trop vieux.
- `sudo` demande un mot de passe : toute installation système doit être faite par l'utilisateur (`install-sudo.sh`). Docker est installé ; ma session n'a pas le groupe `docker` → `sg docker -c "docker ..."`.
- Infra : `sg docker -c "docker compose up -d"` (PostgreSQL 5432, Mosquitto 1883, Redis 6379).
- Lancer l'API : `cd apps/api && ASPNETCORE_ENVIRONMENT=Development dotnet run --project src/Divertiflix.Api --urls http://localhost:5080`.
- Compte admin de dev seedé : `root` / `boom123$` (voulu par l'utilisateur, **à changer au déploiement**). Hors Development, l'API refuse de démarrer sans `Seed__AdminPassword` (et `Seed__AdminLogin` pour le nom). Le seed met à jour le mot de passe à chaque démarrage.

## Front / contrat
- Régénérer les types après un changement d'API : lancer l'API en Development, récupérer `/openapi/v1.json` dans `packages/api-client/openapi.json`, puis `npm run api:types`.
- Enums en chaînes : il faut `ConfigureHttpJsonOptions` (en plus de `AddJsonOptions`) sinon OpenAPI les décrit comme des entiers.
- `createApiClient` prend un `fetch` résolu à l'appel (mockable) ; baseUrl = `location.origin` (Request n'accepte pas d'URL relative sous Node/jsdom).
- React : `npm run web` (port 5173, proxy `/api` vers 5080). Tests : `npm test -w web-react`.
- Piège shell : `pkill -f` avec le nom du process tue aussi la commande bash qui le contient (même avec `[D]`, si le nom apparaît dans la commande). Utiliser `pgrep` puis `kill PID`.

## Active Directory (décision de l'utilisateur)
- Ne PAS écrire les endpoints admin (utilisateurs, rôles, stats) tout de suite : ils seront conçus avec l'Active Directory quand il sera prêt. Un `AdminController` fait puis annulé a été retiré (17 tests → 13).
- Le back-office Angular suppose les rôles Admin/Support du JWT actuel.

## Angular
- `npm start -w admin-angular` (4200). Angular utilise `HttpClient` + les types de `@divertiflix/api-client` (pas son runtime openapi-fetch).
- Material 22 : thème via `mat.theme` → `styles.scss` (pas css).

## Règles
- Demander l'autorisation avant toute interaction avec GitHub.
- Tout logiciel installé est listé dans `logiciels.md`.

## État d'avancement
- [x] Étape 1 (partielle) : monorepo, API (auth JWT + refresh, catalogue CRUD, seed), Sqlite.
- [x] Profils/liste de lecture (API)
- [x] Tests xUnit (13, `dotnet test` dans apps/api)
- [x] Migrations EF + docker-compose
- [x] Front React (apps/web-react)
- [x] Angular back-office (branche etape-3-angular) ; gestion des utilisateurs reportée, SignalR + MQTT, Docker.

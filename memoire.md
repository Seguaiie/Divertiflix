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
  **Périmé depuis le déploiement serveur** (`install-serveur.sh` installe .NET/Node système) :
  `~/.dotnet` ne contient plus de runtime, `dotnet-ef` échoue avec « Failed to resolve
  libhostfxr.so ». Utiliser plutôt `export DOTNET_ROOT=/usr/share/dotnet; export PATH=/usr/local/bin:$HOME/.dotnet/tools:$PATH`.
- `dotnet-ef` avait disparu de `~/.dotnet/tools` (réinstallé : `dotnet tool install --global dotnet-ef --version 9.0.20`).
- Le rôle Postgres **dev** peut dériver de `divertiflix-dev` si le volume `pgdata` existait déjà
  avec un autre mot de passe (même piège que celui déjà documenté dans `install-serveur.sh` pour
  la prod). Resynchroniser au besoin : `docker compose exec -u postgres postgres psql -U divertiflix -d divertiflix -c "ALTER ROLE divertiflix WITH PASSWORD 'divertiflix-dev';"`.
- Port 5080 : le service systemd `divertiflix-api` (prod) peut déjà l'occuper. Pour lancer une
  instance de dev (ex. régénérer l'OpenAPI), utiliser un autre port (`--urls http://localhost:5090`).
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
- Pas de serveur Windows/LDAP ici. Préparation livrée (2026-10-09, branche `2026-10-09`) :
  `POST /api/admin/directory-sync` (clé partagée `X-Sync-Key`, config `DirectorySync:ApiKey`, 
  absente en dev, donc endpoint fermé tant qu'on ne la définit pas). Reçoit une liste de comptes
  AD (email, nom, groupes), upsert les `User` (rôle dérivé de `DirectorySync:AdminGroup` /
  `:SupportGroup`, par défaut `Divertiflix-Admins`/`Divertiflix-Support`), désactive (`IsActive`,
  jamais supprimé) les comptes AD absents du dernier envoi. `AuthController` refuse login/refresh
  si `!IsActive`.
- Les comptes créés depuis l'AD n'ont PAS encore de vraie authentification (mot de passe aléatoire
  inutilisable posé à la création) : le login réel par AD (Kerberos/LDAP) reste à brancher.
- Gabarit de script côté machine du domaine : `scripts/ad_sync_example.py` (ldap3 + requests, non
  exécuté ici, à adapter au schéma réel de l'AD).
- Le back-office Angular suppose les rôles Admin/Support du JWT actuel.

## Audiobookshelf (préparation, 2026-10-09)
- Serveur Audiobookshelf non installé ici. `POST /api/admin/audiobookshelf-sync` (même principe de
  clé partagée, `AudiobookshelfSync:ApiKey`) upsert les items dans `Titles` (`Kind=Audiobook`),
  clé d'upsert = (`ExternalSource`, `ExternalId`). `TitleDto` a gagné `Author`/`Narrator`.
- `GET /api/titles` accepte `?kind=` (Movie/Series/Audiobook) ; React a un sélecteur Type.
- Gabarit : `scripts/audiobookshelf_sync_example.py` (appelle l'API Audiobookshelf réelle, pousse
  vers Divertiflix). Non exécuté ici, à lancer là où Audiobookshelf tourne.

## Temps réel (étape 4, 2026-10-09)
- SignalR : `NotificationsHub` sur `/api/hubs/notifications`, volontairement SOUS `/api/` pour
  réutiliser le `location /api/` nginx déjà configuré (avec upgrade WebSocket) sans toucher à
  `install-serveur.sh` ni recharger nginx. JWT en query string (`?access_token=`), lu par
  `OnMessageReceived` dans `Program.cs` (un WebSocket ne peut pas poser d'en-tête Authorization).
- `MqttBridgeService` (`BackgroundService`) s'abonne à `divertiflix/capteurs/#` sur Mosquitto
  (localhost:1883, celui du docker-compose) et republie vers SignalR (`sensorMessage`). Se
  reconnecte seul (boucle + `try/catch`, 5s) ; ne bloque jamais le démarrage si Mosquitto est down.
  Testé : se connecte bien au vrai Mosquitto, encaisse un message `mosquitto_pub` sans erreur.
  Simuler un ESP32 : `mosquitto_pub -h localhost -t divertiflix/capteurs/temp1 -m '{"temp":21.5}'`.
- Événements poussés : `titleAdded` (création catalogue), `directorySynced`, `audiobookshelfSynced`,
  `sensorMessage`. Le dashboard Angular (`LiveService`) les affiche en direct.

## Angular
- `npm start -w admin-angular` (4200). Angular utilise `HttpClient` + les types de `@divertiflix/api-client` (pas son runtime openapi-fetch).
- Material 22 : thème via `mat.theme` → `styles.scss` (pas css).

## Règles
- Demander l'autorisation avant toute interaction avec GitHub.
- Tout logiciel installé est listé dans `logiciels.md`.

## État d'avancement
- [x] Étape 1 (partielle) : monorepo, API (auth JWT + refresh, catalogue CRUD, seed), Sqlite.
- [x] Profils/liste de lecture (API)
- [x] Tests xUnit (18, `dotnet test` dans apps/api)
- [x] Migrations EF + docker-compose
- [x] Front React (apps/web-react)
- [x] Angular back-office (branche etape-3-angular) ; gestion des utilisateurs reportée à l'AD.
- [x] Préparation Active Directory et Audiobookshelf (ingestion, scripts Python, branche `2026-10-09`).
- [x] Accès back-office en un clic depuis React (lien conditionné au rôle).
- [x] Étape 4 (partielle) : SignalR + pont MQTT ; reste Docker/tests/doc (étape 5).

## Refonte de la session du 2026-10-09
- **Identité visuelle** : logo officiel fourni par l'utilisateur (D chromé violet/magenta, lecture, pellicule orbitale, mot DIVERTIFLIX chromé,
  « STREAM WITHOUT LIMITS »). Le fichier d'origine n'était pas disponible dans l'environnement : le logo a été **recréé en SVG** par
  `python3 tools/brand/build.py` (texte converti en tracés avec Orbitron, OFL). Pour utiliser le fichier du graphiste : remplacer les fichiers de
  `packages/brand/assets/` en gardant les noms. `node tools/brand/render.mjs` rend les PNG/ICO et copie les icônes et logos dans les deux apps.
- **Design** : `packages/brand/tokens.css` est la seule source (encre indigo, accent violet, dégradé de marque réservé aux appels à l'action et
  aux progressions, Sora pour les titres, Inter pour l'interface). Portail et back-office l'importent. Ne pas recopier de couleurs en littéral : utiliser
  `rgb(var(--tint) / x)` et `rgb(var(--ink) / x)`.
- **Pièges rencontrés** : le proxy Vite doit avoir `ws: true` (sinon SignalR ne reçoit rien en dev) ; un bouton dans un `<label>` pollue le nom accessible
  du champ ; les effets rejoués par StrictMode cassent un drapeau « premier rendu » (comparer au chemin précédent) ; Angular n'accepte que des fichiers
  d'assets situés dans son espace de travail (les logos sont donc copiés) ; `*matCellDef="let x"` est `any` : passer par des fonctions typées plutôt
  que des index de `Record`.
- **Médias** : générés, jamais téléchargés, sauf « Big Buck Bunny » (flux Mux public, CC BY 3.0, crédit sur la fiche). Voir `tools/demo-media/build.py`.
- **Tests de bout en bout** : `E2E_CHROME=/opt/google/chrome/chrome npm run e2e` (H.264 requis) ; API lancée avec `RateLimit__AuthPerMinute=100000`.
- **Évaluation** : `dotnet run --project tools/recsys-eval -- --out docs/evaluation-movielens.md` (télécharge MovieLens dans un dossier ignoré par git).
- **Mots de passe** : le compte `root` / `boom123$` n'existe qu'en développement.

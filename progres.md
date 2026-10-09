# Progression — Divertiflix

Dernière mise à jour : 2026-10-09

## Étape 1 — Squelette, API, base de données, auth (en cours)
- [x] Lecture de `agent.md` et de `porjetdivertiflyx.docx` (rapport réseau, pas un projet logiciel)
- [x] `plan.md`, `memoire.md`, `logiciels.md`, `env.sh`, `.gitignore`
- [x] Installation de .NET 9.0.318 et Node 22 (espace utilisateur, sans sudo)
- [x] Solution `apps/api` : Domain, Infrastructure, Api, Tests (xUnit)
- [x] Entités : User, Profile, Title, WatchlistItem, RefreshToken
- [x] DbContext EF Core, SQLite en dev, PostgreSQL configurable
- [x] Auth JWT + refresh token haché avec rotation (`/api/auth/register|login|refresh`)
- [x] Catalogue (`/api/titles`) : liste paginée avec recherche, CRUD réservé au rôle Admin
- [x] Seed : compte admin de dev et 4 titres
- [x] Vérifié à l'exécution : login OK, recherche OK, 401 sans jeton
- [x] Endpoints profils (CRUD, max 5) et liste de lecture (`/api/profiles`), vérifiés à l'exécution
- [x] Tests xUnit d'intégration (13 : auth, catalogue, profils, liste de lecture) via WebApplicationFactory + base PostgreSQL jetable
- [x] Migrations EF (`InitialCreate`, appliquées au démarrage via `MigrateAsync`) ; PostgreSQL seulement, Sqlite retiré
- [x] `docker-compose.yml` : PostgreSQL 17, Mosquitto 2, Redis 7 (infra/mosquitto/mosquitto.conf)

## Étape 2 — Front React (abonné) : terminé
- [x] Monorepo npm workspaces (`apps/*`, `packages/*`), `.npmrc` legacy-peer-deps (openapi-typescript attend TS 5)
- [x] `packages/api-client` : types générés depuis `openapi.json` (`npm run api:types`) + client `openapi-fetch` avec jeton et refresh sur 401
- [x] `apps/web-react` (Vite, React 19, TS, TanStack Query, React Router) : connexion/inscription, choix de profil, catalogue (recherche anti-rebond, genre, pagination), fiche + lecteur HLS (hls.js chargé à la demande), liste de lecture
- [x] 5 tests Vitest (connexion, erreurs, catalogue, recherche) ; build OK ; vérifié via proxy Vite → API → PostgreSQL
- [ ] Non testé dans un vrai navigateur (Playwright prévu à l'étape 5)
## Étape 3 — Back-office Angular : terminé (hors gestion des utilisateurs) — branche `etape-3-angular`
- [x] `apps/admin-angular` : Angular 22 (zoneless, Signals), Material, RxJS ; proxy `/api` → 5080 (`npm start -w admin-angular`, port 4200)
- [x] Auth : `AuthService` (signals), intercepteur avec refresh unique partagé (RxJS `shareReplay`), `staffGuard` (Admin/Support seulement)
- [x] Pages : connexion, mise en page (toolbar + sidenav), tableau de bord (stats calculées depuis le catalogue), catalogue (recherche avec délai, pagination, création/modification/suppression pour Admin ; Support en lecture seule)
- [x] Types partagés avec React via `@divertiflix/api-client`
- [x] 6 tests (`ng test`) ; build OK ; proxy vérifié
- [x] **Gestion des utilisateurs / rôles** : ingestion Active Directory livrée (voir Étape 3bis) ;
  toujours aucun écran Angular de gestion manuelle des comptes (pas demandé).
- [x] Supervision en direct : voir Étape 4.
- [ ] Non testé dans un vrai navigateur (Playwright, étape 5)

## Étape 3bis — Préparation Active Directory et Audiobookshelf : terminé — branche `2026-10-09`
- [x] `POST /api/admin/directory-sync` : upsert comptes AD (rôle depuis les groupes), désactivation
  (`IsActive`) des comptes disparus, clé partagée `DirectorySync:ApiKey`. Pas de vrai LDAP ici (pas
  de serveur Windows) : `scripts/ad_sync_example.py` est le gabarit pour la machine qui a l'accès AD réel.
- [x] `POST /api/admin/audiobookshelf-sync` : upsert dans le catalogue (`Title.Kind=Audiobook`),
  clé partagée `AudiobookshelfSync:ApiKey`. Pas de serveur Audiobookshelf installé ici :
  `scripts/audiobookshelf_sync_example.py` est le gabarit (appelle l'API Audiobookshelf réelle).
- [x] `GET /api/titles?kind=` ; filtre Type (Films/Séries/Livres audio) côté React ; `TitleCard`
  affiche auteur/narrateur pour les livres audio.
- [x] Lien "Back-office" dans la nav React (visible si rôle Admin/Support), vers `/admin/` —
  connexion séparée toujours requise côté Angular (`staffGuard`), demandé explicitement ainsi.
- [x] 5 nouveaux tests xUnit (18 au total) ; migration EF `AdAndAudiobookshelfPrep`.

## Étape 4 — SignalR et pont MQTT/ESP32 : partiel (le noyau temps réel est fait)
- [x] `NotificationsHub` (SignalR) sur `/api/hubs/notifications` ; JWT en query string.
- [x] `MqttBridgeService` : s'abonne à `divertiflix/capteurs/#` sur Mosquitto, republie vers
  SignalR (`sensorMessage`) ; reconnexion automatique ; testé contre le vrai Mosquitto du
  docker-compose (`mosquitto_pub` sans erreur).
- [x] Événements supplémentaires : `titleAdded`, `directorySynced`, `audiobookshelfSynced`.
- [x] Dashboard Angular (`LiveService`) : statut connecté/déconnecté + flux d'événements en direct.
- [ ] Pas de vrai capteur ESP32 branché (hors de portée ici) ; pas testé dans un vrai navigateur.
## Étape 5 — Docker, tests, documentation : à faire

## Blocages / actions pour l'utilisateur
- Docker installé ; dans cette session, utiliser `sg docker -c "docker ..."` tant que le groupe n'est pas actif.
- Commits faits sur la branche `2026-10-09` (poussée vide) ; **pas encore mergée/poussée avec son
  contenu** — autorisation GitHub à demander avant de le faire (règle `agent.md`).

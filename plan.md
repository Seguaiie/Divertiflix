# Plan : Plateforme de streaming « Divertiflix »

## Contexte
Le document `porjetdivertiflyx.docx` est le rapport de planification de l'implantation du réseau informatique de Divertiflix (VPN, Mailcow, pare-feu, FreePBX, GitLab CE, GLPI, sauvegardes, Mosquitto/ESP32, scripts POO, VLAN). Tout cela est considéré comme déjà fait ou en cours. Ce projet construit l'**application métier** : une plateforme de vidéo sur demande.

## Architecture

| Couche | Techno | Rôle |
|---|---|---|
| API | ASP.NET Core (.NET 9), EF Core, PostgreSQL | Catalogue, comptes, profils, liste de lecture, historique de visionnement |
| Auth | JWT + refresh token, rôles (Abonné, Admin, Support) | Un même jeton pour les deux fronts |
| Temps réel | SignalR | Notifications, tableau de bord en direct |
| Arrière-plan | .NET `BackgroundService` + MQTTnet | Lit les capteurs ESP32 sur Mosquitto et les pousse via SignalR |
| React (TypeScript) | Vite, TanStack Query | Application **abonné** : parcourir, rechercher, lire (HLS), liste de lecture |
| Angular (TypeScript) | Signals, RxJS, Angular Material | **Back-office** admin/support : catalogue, utilisateurs, supervision en direct |
| Contrat partagé | OpenAPI → client TS généré dans `packages/api-client` | Types uniques pour React et Angular |
| Infra | Docker Compose (API, PostgreSQL, Mosquitto, Redis), monorepo npm workspaces | Cohérent avec l'infra du rapport |
| Tests | xUnit, Vitest, Playwright | |

## Étapes
1. Squelette du monorepo, API, base de données, auth, `memoire.md`, `logiciels.md`. (fait)
2. Catalogue et profils, puis le front React. (fait)
3. Back-office Angular. (fait)
4. SignalR et pont MQTT/ESP32. (fait)
5. Docker, tests et documentation. (fait : voir `progres.md`, `README.md` et `docs/`)
6. Refonte complète : moteur de recommandation, médias générés, identité visuelle, back-office d'exploitation, tests de bout en bout. (fait)

## Règles (agent.md)
- Consigner l'important dans `memoire.md`.
- Lister tout logiciel/librairie installé dans `logiciels.md`.
- Demander l'autorisation avant toute interaction avec GitHub.

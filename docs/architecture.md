# Architecture

## Vue d'ensemble

```
Navigateur ── HTTPS ──> nginx ──┬── /            portail React (fichiers statiques)
                                ├── /admin/      back-office Angular (fichiers statiques)
                                └── /api/        API ASP.NET Core ──┬── PostgreSQL (données)
                                     /api/hubs/   (SignalR, WebSocket) ├── Mosquitto (capteurs ESP32, via MQTTnet)
                                     /api/media/  (flux signés)        └── disque : médias de démonstration
```

Un seul jeton d'accès (JWT court) sert les deux fronts. Les rôles viennent du jeton : Abonné, Support, Admin.

## Couches de l'API

| Projet | Rôle |
| --- | --- |
| `Divertiflix.Domain` | Entités, moteur de recommandation, analyseur de requêtes. Aucune dépendance à EF ni à ASP.NET : testable en mémoire, et réutilisé tel quel par l'outil d'évaluation. |
| `Divertiflix.Infrastructure` | `DbContext` EF Core, migrations PostgreSQL. |
| `Divertiflix.Api` | Contrôleurs, services (accueil, assistant, notifications, audit, rétention), SignalR, pont MQTT, médias signés. |
| `Divertiflix.Tests` | Tests d'intégration sur une vraie API et une base PostgreSQL jetable. |

## Contrat unique

L'API publie son OpenAPI. `packages/api-client` en tire les types TypeScript et un client `openapi-fetch` (jeton automatique,
rafraîchissement sur 401 avec rejeu du corps de la requête). Le portail l'utilise directement ; le back-office en réutilise les types
au-dessus de `HttpClient`. Un changement d'API casse la compilation des fronts au lieu de casser la production.

## Temps réel

`NotificationsHub` (SignalR) : chaque utilisateur reçoit ses notifications (décision sur une demande, réponse à un billet) et les
nouveaux titres. Le groupe `staff` reçoit en plus les évènements d'exploitation : nouvelle demande, nouveau billet, réponse d'un
abonné, synchronisations, messages de capteurs. Les clients n'envoient rien au hub : ils écoutent. Le jeton passe en chaîne de requête
(un WebSocket ne peut pas poser d'en-tête) et se renouvelle d'avance.

## Médias

Les fichiers de démonstration sont servis par `/api/media/stream/{jeton}/...`. Le jeton, signé par HMAC et valable peu de temps, est
dans le **chemin** et non dans la requête : les segments HLS, adressés en relatif par le manifeste, héritent donc de l'autorisation sans
que le lecteur ait à signer chaque segment. La source d'un titre est soit une URL absolue, soit `media:dossier/fichier`.

## Données

PostgreSQL uniquement. Entités : utilisateurs, profils, titres, liste, progression, notes, jetons de rafraîchissement (hachés),
demandes, notifications, billets, journal d'audit. Le seed du catalogue de démonstration est versionné par le journal d'audit : une
modification faite depuis le back-office n'est jamais écrasée par un redémarrage.

## Décisions

- **Moteur de recommandation sans modèle de langage ni service externe** : déterministe, testable, expliquable, aucune donnée ne sort.
- **Assistant à règles** : il comprend des demandes libres (genre, ambiance, durée, « sans gore », « comme X ») et répond par des titres
  réels du catalogue avec la raison calculée. Il admet quand il ne connaît pas un titre.
- **Une seule source de design** (`packages/brand`) pour que portail et back-office restent homogènes.
- **Chargement à la demande** : lecteur (hls.js), assistant et SignalR ne pèsent rien avant usage.

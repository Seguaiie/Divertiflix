# Progression : Divertiflix

Dernière mise à jour : 2026-10-10

## Fait

### Étapes initiales (1 à 4)
- Monorepo npm, API ASP.NET Core 9 (Domain, Infrastructure, Api, Tests), PostgreSQL, migrations EF, JWT avec rotation des jetons de rafraîchissement.
- Catalogue, profils, liste de lecture. Portail React, back-office Angular. Active Directory et Audiobookshelf (ingestion). SignalR et pont MQTT.

### Refonte complète (cette session)
- **API** : durcissement sécurité, moteur de recommandation hybride expliquable, accueil personnalisé, assistant à règles, progression, notes,
  demandes de titres, billets d'aide, notifications en direct, statut des services, statistiques, utilisateurs, médias servis par URL signées,
  limitation de débit, journal d'audit, rétention. 342 tests xUnit (2026-10-10).
- **Médias de démonstration** générés par ffmpeg (`tools/demo-media`) : affiches, fonds, flux HLS H.264/AAC, livres audio en voix de synthèse.
- **Portail React** : nouveau système de design, accueil, films, livres audio, fiche, lecteur avec reprise, lecteur audio persistant, assistant,
  palette Ctrl+K, demandes, aide, notifications, FR/EN. 159 tests Vitest (2026-10-10).
- **Identité visuelle** : logo officiel recréé en SVG (`packages/brand`), jetons de design partagés, favicon et icônes, manifeste.
- **Back-office Angular** : tableau de bord, catalogue complet, demandes, billets, utilisateurs, accès Admin/Support. 96 tests (2026-10-10).
- **Bout en bout** : 14 parcours Playwright (portail, back-office, notifications en direct entre les deux).
- **Infrastructure** : nginx durci (CSP, HSTS, cache), service systemd durci, utilisateur système sans accès Docker, ports en 127.0.0.1,
  pipeline GitLab avec tests avant déploiement.
- **Audit (2026-10-10)** : relecture de l'API, du portail, du back-office, de l'infrastructure et de la documentation ; les correctifs
  sont décrits dans `docs/securite.md` (dont « Ce qui reste à faire ») et les pièges d'infrastructure dans `memoire.md`.
- **Évaluation** du moteur sur MovieLens (`docs/evaluation-movielens.md`).
- **Documentation** : README, architecture, sécurité, recommandation, démonstration.

## Reste à faire (hors périmètre de cette session)
- Authentification réelle par Active Directory (Kerberos ou LDAP) et double authentification pour le personnel.
- Mosquitto : mots de passe et ACL avant d'ouvrir le port aux ESP32.
- Branchement réel de Jellyseerr / Radarr / Sonarr derrière les demandes (les états existent déjà), et de Jellyfin pour les médias.
- Scan des dépendances dans le pipeline.

## Blocages / actions pour l'utilisateur
- Les poussées vers GitHub sont faites par l'utilisateur (règle `agent.md`) : les commits d'audit restent locaux tant qu'il ne les a pas poussés.

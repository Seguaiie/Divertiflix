# Progression : Divertiflix

Dernière mise à jour : 2026-10-09

## Fait

### Étapes initiales (1 à 4)
- Monorepo npm, API ASP.NET Core 9 (Domain, Infrastructure, Api, Tests), PostgreSQL, migrations EF, JWT avec rotation des jetons de rafraîchissement.
- Catalogue, profils, liste de lecture. Portail React, back-office Angular. Active Directory et Audiobookshelf (ingestion). SignalR et pont MQTT.

### Refonte complète (cette session)
- **API** : durcissement sécurité, moteur de recommandation hybride expliquable, accueil personnalisé, assistant à règles, progression, notes,
  demandes de titres, billets d'aide, notifications en direct, statut des services, statistiques, utilisateurs, médias servis par URL signées,
  limitation de débit, journal d'audit, rétention. 117 tests xUnit.
- **Médias de démonstration** générés par ffmpeg (`tools/demo-media`) : affiches, fonds, flux HLS H.264/AAC, livres audio en voix de synthèse.
- **Portail React** : nouveau système de design, accueil, films, livres audio, fiche, lecteur avec reprise, lecteur audio persistant, assistant,
  palette Ctrl+K, demandes, aide, notifications, FR/EN. 44 tests Vitest.
- **Identité visuelle** : logo officiel recréé en SVG (`packages/brand`), jetons de design partagés, favicon et icônes, manifeste.
- **Back-office Angular** : tableau de bord, catalogue complet, demandes, billets, utilisateurs, accès Admin/Support. 24 tests.
- **Bout en bout** : 14 parcours Playwright (portail, back-office, notifications en direct entre les deux).
- **Infrastructure** : nginx durci (CSP, HSTS, cache), service systemd durci, utilisateur système sans accès Docker, ports en 127.0.0.1,
  pipeline GitLab avec tests avant déploiement.
- **Évaluation** du moteur sur MovieLens (`docs/evaluation-movielens.md`).
- **Documentation** : README, architecture, sécurité, recommandation, démonstration.

## Reste à faire (hors périmètre de cette session)
- Authentification réelle par Active Directory (Kerberos ou LDAP) et double authentification pour le personnel.
- Mosquitto : mots de passe et ACL avant d'ouvrir le port aux ESP32.
- Branchement réel de Jellyseerr / Radarr / Sonarr derrière les demandes (les états existent déjà), et de Jellyfin pour les médias.
- Scan des dépendances dans le pipeline.

## Blocages / actions pour l'utilisateur
- Aucune poussée vers GitHub n'a été faite : autorisation demandée à l'utilisateur (règle `agent.md`). Les commits sont locaux, sur la branche de travail.

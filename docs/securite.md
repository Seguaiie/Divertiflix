# Sécurité

## Authentification et sessions

- Mots de passe hachés (PBKDF2 via ASP.NET Identity). Un compte inconnu coûte le même temps de calcul qu'un compte réel : pas de fuite par le temps de réponse.
- Jeton d'accès JWT court. Jeton de rafraîchissement aléatoire, stocké **haché** (SHA-256), à usage unique, avec rotation atomique : deux
  requêtes simultanées ne peuvent pas consommer le même jeton.
- Déconnexion : le jeton de rafraîchissement est révoqué côté serveur. Un compte désactivé perd ses sessions renouvelables immédiatement.
- Un compte local ne peut pas être repris par une synchronisation Active Directory. La désactivation de masse est bloquée par une garde.

## Autorisation

- Rôles Abonné, Support, Admin vérifiés par l'API (l'interface ne fait que masquer). Le dernier administrateur actif ne peut ni se
  rétrograder ni se désactiver, et personne ne peut retirer ses propres droits.
- Le groupe SignalR du personnel est rempli à la connexion d'après le rôle du jeton.
- Les routes de synchronisation machine à machine exigent une clé partagée comparée en temps constant ; sans clé configurée, elles sont fermées.

## Limitation de débit

Politiques `auth`, `sync`, `write`, `assistant`, `media`, réglables par configuration (`RateLimit:*`). Les plafonds `write` et `assistant` sont
par utilisateur, `auth`, `sync` et `media` par adresse (l'API fait confiance aux en-têtes du proxy local). nginx coupe aussi les rafales
sur `/api/auth/`.

## Données

- Recherche sans caractères génériques : aucune injection de motif.
- Aucun détail de la chaîne d'approvisionnement (torrents, indexeurs) n'est exposé : les demandes ne montrent que des états.
- Minimisation (Loi 25) : le moteur ne conserve que des signaux (titre, poids, date) ; l'assistant n'enregistre aucune conversation ;
  un service de rétention supprime les jetons expirés, les notifications anciennes et le journal d'audit après un an.
- Journal d'audit des écritures sensibles (demandes, billets, administration).

## En-têtes et réseau

- API : `X-Content-Type-Options`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, `Permissions-Policy`. Erreurs en `problem+json`.
- nginx : CSP stricte (scripts de notre origine seulement ; styles en ligne permis pour Angular Material), `frame-ancestors 'none'`,
  HSTS dès que HTTPS est activé, `Cross-Origin-Opener-Policy`, cache immuable des fichiers à empreinte.
- Docker contourne le pare-feu : tous les ports d'infrastructure sont publiés sur 127.0.0.1.
- Le compte système du service n'est **pas** dans le groupe `docker` (équivalent root). L'unité systemd : `NoNewPrivileges`, `ProtectSystem=strict`,
  `ProtectHome`, `PrivateDevices`, aucune capacité, familles d'adresses limitées.
- Secrets générés au déploiement, fichier `.env` en 600, jamais dans le dépôt. Le mot de passe administrateur de développement n'existe qu'en développement.

## Ce qui reste à faire

- Mosquitto est anonyme (loopback seulement par défaut) : ajouter un fichier de mots de passe et des ACL avant d'ouvrir le port aux ESP32.
- Authentification réelle par Active Directory (Kerberos ou LDAP) : les comptes synchronisés n'ont pas de mot de passe utilisable.
- Double authentification pour les rôles Admin et Support.
- Étape de scan des dépendances dans le pipeline (npm audit, `dotnet list package --vulnerable`).

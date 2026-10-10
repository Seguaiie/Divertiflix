# Sécurité

## Authentification et sessions

- Mots de passe hachés (PBKDF2 via ASP.NET Identity). Un compte inconnu coûte le même temps de calcul qu'un compte réel : à la
  **connexion**, ni le message ni le temps de réponse ne disent si un courriel a un compte.
- **L'inscription, elle, le révèle** : `POST /api/auth/register` répond 409 « Courriel déjà utilisé » quand l'adresse existe. Aucun flux de
  confirmation par courriel n'existe (hors périmètre) : seule la limitation de débit (20 requêtes par minute et par adresse, voir plus bas)
  borne ce que quelqu'un peut apprendre ainsi. Ne pas présenter l'anti-énumération comme complète.
- À l'inscription, un mot de passe doit faire 8 caractères au moins, ne pas figurer dans une liste des mots de passe les plus courants,
  ne pas répéter un seul caractère et ne pas être le courriel (ni sa partie avant l'arobase). Aucune autre règle de composition.
- Jeton d'accès JWT court (15 min). Il n'est **jamais cru seul** : à chaque requête authentifiée, l'API relit l'état du compte (actif ou non,
  rôle courant) dans un cache mémoire de 5 secondes et refuse le jeton (401) si le compte est désactivé ou si son rôle n'est plus celui que
  le jeton annonce. Les écritures qui changent un compte (modification par un administrateur, synchronisation d'annuaire) vident ce cache :
  l'effet est immédiat sur le même serveur. Après un changement de rôle, le client se voit refuser l'ancien jeton et en demande un nouveau
  (le portail et le back-office le font déjà sur un 401).
- Jeton de rafraîchissement aléatoire, stocké **haché** (SHA-256), à usage unique, avec rotation atomique : deux requêtes simultanées ne
  peuvent pas consommer le même jeton. Valable 14 jours à chaque rotation, mais la **session** a une fin absolue (60 jours depuis la
  connexion, `Jwt:SessionDays`) que les rotations ne repoussent pas (les sessions déjà ouvertes lors de la mise en service de cette règle la reçoivent à partir de ce jour).
- Chaque connexion ouvre une **famille** de jetons. Présenter un jeton déjà remplacé, plus de 10 secondes après son remplacement, signale une
  chaîne copiée : toute la famille est révoquée et l'évènement est journalisé (`auth.replay`) ; le titulaire se reconnecte, le voleur perd la
  session. Dans les 10 secondes, le refus n'entraîne rien : deux onglets du portail peuvent légitimement rafraîchir en même temps. Côté portail,
  la session locale n'est effacée que sur un refus définitif (400 ou 401) ; un échec passager (429, 5xx, réseau) la laisse en place, et un onglet
  qui perd la rotation adopte le jeton de l'onglet gagnant. Les jetons
  révoqués sont purgés après 7 jours : au-delà, un jeton très ancien est simplement refusé, sans alerte.
- Déconnexion : le jeton de rafraîchissement est révoqué côté serveur. `POST /api/auth/logout-all` (authentifié) révoque tous les jetons du
  compte (appareil perdu, jeton volé) ; les jetons d'accès déjà émis restent valables jusqu'à leur échéance (15 min au plus) sans pouvoir être
  renouvelés. Il n'existe pas encore de changement ni de réinitialisation de mot de passe.
- Échecs de connexion : compteur par courriel, existant ou non (la réponse reste la même), en mémoire. À partir de 5 échecs en 15 minutes, le
  courriel est verrouillé 30 s, puis 1, 2, 4 et au plus 5 min (réponse 429 avec `Retry-After`) ; les tentatives refusées pendant un verrou ne le
  prolongent pas. Le verrou ne vaut que pour les adresses dont aucune connexion réussie n'est connue pour ce compte (les 8 dernières sont
  retenues 30 jours) : un attaquant ne peut donc pas empêcher en continu l'administrateur de se connecter depuis ses lieux habituels. L'état
  est perdu au redémarrage et propre à chaque instance.
- Un compte désactivé perd ses sessions renouvelables, et aussi ses droits sur le champ (jeton d'accès refusé, connexions temps réel coupées,
  flux média refusés). La désactivation et la révocation des jetons sont enregistrées ensemble ou pas du tout.
- Un compte local ne peut pas être repris par une synchronisation Active Directory. La désactivation de masse est bloquée par une garde.
  Un compte invalide dans le lot (courriel inutilisable) est ignoré et compté (`errors`) sans empêcher les départs et les changements de
  rôle des autres ; un nom d'affichage trop long est abrégé à 50 caractères.

## Autorisation

- Rôles Abonné, Support, Admin vérifiés par l'API (l'interface ne fait que masquer). La liste des comptes, comme leur modification, est
  réservée à l'Admin : le Support lit le reste de la console (statistiques, demandes, billets, catalogue) sans voir les courriels des comptes.
- Le dernier administrateur actif ne peut ni se rétrograder ni se désactiver, et **personne ne peut changer son propre rôle ni l'état de son
  compte** (une session coupée ne peut donc pas se rétablir elle-même).
- Le groupe SignalR du personnel est rempli à la connexion d'après le rôle du jeton, revalidé à ce moment. Chaque connexion est suivie par
  utilisateur : désactiver un compte ou changer son rôle la coupe aussitôt (le client se reconnecte avec un jeton à jour).
- Flux média : le jeton signé vit 6 heures, car la liste HLS et tous ses segments en dépendent (une durée courte casserait les longues
  lectures). L'état du compte est donc vérifié à **chaque** requête de flux (cache de 5 s, vidé par les écritures) : un compte désactivé ne
  reçoit plus rien, et son jeton de flux n'est plus qu'un morceau de texte inerte.
- Les routes de synchronisation machine à machine exigent une clé partagée comparée en temps constant ; sans clé configurée, elles sont fermées.

## Limitation de débit

Politiques `auth`, `sync`, `write`, `assistant`, `media`, réglables par configuration (`RateLimit:*`). Les plafonds `write` et `assistant` sont
par utilisateur, `auth`, `sync` et `media` par adresse (l'API fait confiance aux en-têtes du proxy local). En IPv6, l'adresse est ramenée à son
préfixe /64 (qui est ce qu'un abonné contrôle : limiter l'adresse complète ne limiterait rien) ; une IPv4 reçue sous forme IPv6 redevient une IPv4.
nginx coupe aussi les rafales sur `/api/auth/` et doit regrouper de même les adresses IPv6. Le compteur d'échecs par courriel (voir plus haut)
complète la limite par adresse contre une attaque répartie sur beaucoup d'adresses.

## Données

- Recherche sans caractères génériques : aucune injection de motif.
- Un caractère nul (U+0000) dans un texte reçu (corps, paramètre de requête) est refusé avec un 400 par un filtre global : PostgreSQL le
  rejette, ce qui donnait un 500. Un jeton de flux dont l'échéance est hors bornes est refusé (401) sans exception.
- Adresses de lecture et d'images : seuls les schémas `http`, `https` et le préfixe `media:` sont acceptés pour la source de lecture ; les
  visuels acceptent aussi un chemin du site (`/api/media/art/...`). Contrôle à l'administration du catalogue et à la synchronisation
  Audiobookshelf (400 sinon). Une source enregistrée avant ce contrôle avec un autre schéma (`javascript:`) n'est jamais remise au lecteur.
- Journal d'audit : cible et détail sont abrégés à la longueur des colonnes (200 et 300), un courriel long ne fait plus échouer l'action journalisée.
- Aucun détail de la chaîne d'approvisionnement (torrents, indexeurs) n'est exposé : les demandes ne montrent que des états.
- Minimisation (Loi 25) : le moteur ne conserve que des signaux (titre, poids, date) ; l'assistant n'enregistre aucune conversation ;
  un service de rétention supprime les jetons expirés, les notifications anciennes et le journal d'audit après un an (sauf le marqueur
  du catalogue de démonstration, qui évite de recréer un catalogue modifié depuis le back-office).
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
- Confirmation de l'adresse par courriel à l'inscription (qui mettrait fin à l'énumération par `register`), changement et réinitialisation
  du mot de passe, avec fin de toutes les sessions.
- Double authentification pour les rôles Admin et Support.
- Étape de scan des dépendances dans le pipeline (npm audit, `dotnet list package --vulnerable`).

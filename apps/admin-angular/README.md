# Back-office Divertiflix (Angular)

Console d'exploitation du personnel (rôles Admin et Support) : tableau de bord, catalogue, demandes de contenu, billets d'aide,
comptes. Angular 22, Angular Material, signaux, composants autonomes. L'API fait foi pour les droits : l'interface ne fait que
masquer ce que le rôle ne permet pas (le Support lit tout, répond aux billets, mais ne gère ni les comptes ni le catalogue ni les décisions sur les demandes).

## Commandes

Depuis ce dossier (les dépendances s'installent à la racine du dépôt avec `npm install`) :

```bash
npm start                    # http://localhost:4200, /api et le temps réel sont relayés vers l'API (proxy.conf.json, http://localhost:5080)
npx ng build                 # production, dans dist/ (aucun avertissement toléré)
npx ng test --watch=false    # tests unitaires (Vitest)
npx ng build --configuration demo   # version sans serveur, voir ../../docs/demo-hebergee.md
```

Les parcours de bout en bout (Playwright) sont à la racine : `npm run e2e` (voir le README du dépôt).

## Organisation

```
src/app/core/     services et logique sans interface
  auth.service.ts   session (stockage local partagé entre onglets), rafraîchissement du jeton, déconnexion
  auth.interceptor.ts  jeton sur chaque appel, un seul rafraîchissement partagé sur 401
  live.service.ts   SignalR : état « En direct », évènements du personnel, reconnexion
  admin.service.ts  appels /api/admin/*
src/app/pages/    un dossier par écran (dashboard, catalog, requests, tickets, users, login, layout)
src/app/shared/   icônes SVG intégrées, fenêtre de confirmation, état d'erreur d'une liste (`load-error`)
```

## Règles à connaître

- **Session.** Le jeton de rafraîchissement est à usage unique : un seul rafraîchissement à la fois. Entre onglets, un verrou du navigateur
  (`navigator.locks`) fait attendre les autres, qui relisent ensuite le stockage et adoptent la session obtenue sans appel réseau, aussi lente
  que soit la réponse du premier (jamais de rejeu d'un jeton consommé, l'API coupe alors toute la session). Sans verrou (page servie en HTTP
  hors localhost), un onglet dont le jeton est refusé attend 10 s, la tolérance de rejeu de l'API, qu'un autre onglet écrive sa session avant
  de conclure : une session réellement morte met alors ce temps à ramener à la connexion. Seule une réponse 400 ou 401 du rafraîchissement
  vide la session ; un 429, un 5xx ou un réseau coupé la gardent. Un compte qui n'est plus du personnel au rafraîchissement (agent rétrogradé
  en cours de session) est renvoyé à la connexion, son nouveau jeton est révoqué et le formulaire l'explique. Connexion et déconnexion se
  propagent aux autres onglets : une connexion ailleurs fait quitter la page de connexion, qui n'est d'ailleurs pas servie quand une session
  du personnel est ouverte (`guestGuard`), et `staffGuard` est rejoué à chaque navigation entre pages.
- **Temps réel.** Le jeton passé à SignalR est renouvelé d'avance s'il est périmé, y compris à chaque reconnexion. Une connexion qui échoue
  est relancée de plus en plus lentement jusqu'à la déconnexion.
- **Charte.** Jetons de couleur dans `packages/brand/tokens.css`. Le dégradé de marque ne sert qu'aux boutons principaux et aux barres de
  progression ; ailleurs, l'accent est uni.
- **Tableaux.** Chaque tableau porte une classe `stack-<largeur>` : sous cette largeur de panneau, les lignes deviennent des fiches
  (`data-label` donne le sens des valeurs sans en-tête). Pas de défilement horizontal.
- **Accessibilité.** Les commandes répétées par ligne portent le nom de la ligne (`aria-label`) ; sur un composant Material, utiliser
  `[aria-label]` (le composant le relaie) et non `[attr.aria-label]`. Le focus clavier est visible partout (anneau Material configuré dans
  `styles.scss`).
- **Listes.** Un chargement raté affiche « Chargement impossible » avec « Réessayer », jamais l'état vide (« Aucun billet à traiter. Bon travail. »
  ferait croire qu'il n'y a rien à faire). Un rechargement qui échoue alors que des données sont déjà là garde ces données et le signale par une notification.
  Après une action qui retire la ligne (suppression, décision, résolution), `restoreLostFocus` ramène le focus clavier sur la page.
- **Langue.** Interface en français, dates et nombres via `core/format.ts` (le `DatePipe` d'Angular écrirait les mois en anglais sans données de langue).

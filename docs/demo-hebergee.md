# Démo hébergée (sans serveur)

Le portail et le back-office tournent en entier dans le navigateur, sans API ni base de données. Utile pour montrer le produit sur un lien, sans rien installer.

## Comment ça marche

- `packages/demo/src` contient un faux serveur en TypeScript, sans dépendance au navigateur. Il reproduit les routes `/api/*` utilisées par les deux fronts : authentification et rôles, catalogue, recherche, lecture, progression, liste, notes, profils, demandes de titres, billets de support, utilisateurs, statistiques et assistant.
- Les données viennent d'une vraie API : `npm run capture -w @divertiflix/demo` interroge l'API locale et écrit `packages/demo/data/snapshot.json`. Les demandes, billets et comptes du back-office sont fictifs et recréés à chaque réinitialisation, pour ne pas dépendre de la base de développement.
- L'état (compte, progression, demandes, billets, notifications) est gardé dans `localStorage`. Deux onglets du même site se parlent par `BroadcastChannel` : approuver une demande dans le back-office fait apparaître la notification dans le portail ouvert dans l'autre onglet, comme avec SignalR.
- Côté React, `window.fetch` est remplacé pour les chemins `/api/*`. Côté Angular, un intercepteur HTTP joue le même rôle. Les écrans sont ceux de la vraie application, sans copie.
- Le routage passe en mode hash pour fonctionner sur n'importe quel hébergement statique.

## Limites à connaître

- L'assistant de la démo est un portage plus léger de l'analyseur et du moteur de l'API. Les cas courants (genre, durée, ambiance, « sans gore », « comme X », « surprends-moi ») donnent les mêmes résultats, pas tous les cas limites.
- Les extraits vidéo et audio sont les médias de démonstration générés par `tools/demo-media`. « Big Buck Bunny » est affiché « sur demande » : sa source est distante et la démo n'ouvre aucune connexion externe.
- Les données sont par navigateur. Le bouton de réinitialisation de la barre de démo remet tout à zéro.
- Aucun mot de passe n'est vérifié. `root` ou `admin...` ouvre le back-office en administrateur, `support...` en agent de support, tout autre nom en abonné.

## Reconstruire

```
npm run capture -w @divertiflix/demo        # optionnel, API locale lancée
node packages/demo/make-fonts.mjs            # polices en data URI
(cd apps/admin-angular && npx ng build --configuration demo)
npx vite build -c packages/demo/react/vite.config.ts
node packages/demo/assemble.mjs              # site complet dans packages/demo/dist/site
node packages/demo/artifact.mjs              # fragment de page et liste de fichiers pour la publication
```

Le résultat (`packages/demo/dist/site`, environ 18 Mo) se sert tel quel par n'importe quel serveur de fichiers statiques. Les audios sont convertis en MP3 par `assemble.mjs`, certains hébergeurs ne servant pas le M4A.

## Tests

`cd packages/demo && npx vitest run` : 25 tests du faux serveur (rôles, catalogue, lecture, liste, notes, demandes et transitions, billets, garde-fous sur les utilisateurs, assistant).

# Fichiers générés

Certains fichiers volumineux ou binaires ne sont pas versionnés sur la branche publiée depuis l'outil de relecture (transfert texte seulement). Tous se régénèrent depuis le dépôt, dans cet ordre.

| Fichier ou dossier | Commande | Prérequis |
|---|---|---|
| `package-lock.json` | `npm install` puis versionner le fichier | Node 22.22 ou plus |
| `packages/api-client/openapi.json` | API lancée, puis `curl http://localhost:5080/openapi/v1.json -o packages/api-client/openapi.json` | API en développement |
| `packages/api-client/src/schema.d.ts` | `npm run api:types` | `openapi.json` présent |
| Médias de démonstration : visuels `.webp`, segments HLS `.ts`, extraits audio `.m4a` | `python3 tools/demo-media/build.py` | ffmpeg (libx264, libwebp), espeak-ng et voix MBROLA pour les livres audio |
| Icônes `favicon.ico` et PNG de `packages/brand/assets/png`, copies dans `public/` des deux applications | `node tools/brand/render.mjs` | Chrome ou Chromium (`E2E_CHROME`) |
| Polices `tools/brand/*.woff` (utilisées seulement par `tools/brand/build.py`) | `npm i --no-save @fontsource/orbitron`, puis copier `orbitron-latin-700-normal.woff` et `orbitron-latin-900-normal.woff` depuis `node_modules/@fontsource/orbitron/files/` | aucun |
| `packages/demo/data/snapshot.json` | `npm run capture -w @divertiflix/demo` | API lancée avec le catalogue de démonstration |
| `docs/captures/*.jpg` | captures de l'interface en fonctionnement (Playwright), 1440 x 900 | portail, back-office et API lancés |

Le logo SVG, les jetons de design et tout le code source sont versionnés : seuls les artefacts ci-dessus sont à produire.

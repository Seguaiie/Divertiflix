# Outils de marque

Génère le logo Divertiflix en SVG (fond transparent) et les icônes raster.

```bash
python3 tools/brand/build.py        # packages/brand/assets/*.svg (nécessite : pip install fonttools brotli)
node tools/brand/render.mjs         # PNG, ICO, et copie dans apps/web-react/public et apps/admin-angular/public
```

Le dessin reprend le logo officiel fourni : D chromé dégradé, triangle de lecture, pellicule en orbite, mot DIVERTIFLIX en métal
et signature « STREAM WITHOUT LIMITS ». Le texte est converti en tracés avec **Orbitron** (SIL Open Font License 1.1, voir
`OFL-Orbitron.txt`) : aucune police n'est requise à l'affichage. Les deux fichiers `.woff` ne servent qu'à la génération.

Pour utiliser le fichier d'origine du graphiste à la place, remplacer les fichiers de `packages/brand/assets/` en gardant
les noms : le portail et le back-office les chargent tels quels.

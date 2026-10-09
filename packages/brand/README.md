# @divertiflix/brand

Identité visuelle partagée par le portail (React) et le back-office (Angular).

| Fichier | Usage |
| --- | --- |
| `assets/logo.svg` | Logo complet : marque, mot chromé et signature. Connexion, écrans de démarrage. |
| `assets/mark.svg` | La marque seule (D, lecture, pellicule). |
| `assets/lockup.svg` | Marque et mot à plat, horizontal. Barre de navigation. |
| `assets/wordmark.svg` | Le mot DIVERTIFLIX en métal chromé. |
| `assets/favicon.svg` | Le D et son triangle, lisible à 16 px. |
| `tokens.css` | Palette, polices, rayons, mouvements. |

Les SVG sont générés par `python3 tools/brand/build.py` (texte converti en tracés, licence OFL d'Orbitron) à partir du
logo officiel fourni. Pour remplacer le dessin par le fichier d'origine du graphiste, remplacer les fichiers de `assets/` en
gardant les mêmes noms : rien d'autre à changer.

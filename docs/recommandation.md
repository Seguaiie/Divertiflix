# Moteur de recommandation et assistant

Tout vit dans `Divertiflix.Domain.Recommendations` : du C# pur, sans base de données ni service externe.

## Signaux du profil

| Signal | Poids |
| --- | --- |
| Lecture terminée (>= 80 %) | +1,0 |
| Lecture entamée (30 à 80 %) | +0,4 |
| Entre les deux | +0,1 |
| Abandon (< 10 %) | -0,3 |
| Pouce haut | +1,5 |
| Pouce bas | -2,0 |
| Ajout à la liste | +0,6 |

Les signaux s'estompent avec une demi-vie de 60 jours.

## Score d'un titre

Combinaison pondérée : contenu 0,62 (vecteurs TF-IDF creux sur genres, mots-clés, époque et type), filtrage collaboratif item-item 0,14,
tendance 0,12 (profils distincts récents), fraîcheur 0,07, note 0,05. Sans historique (démarrage à froid) : 0,55 / 0,25 / 0,20 sur
popularité, tendance, fraîcheur. La sélection finale applique **MMR** (λ = 0,72) pour éviter dix titres identiques, et un emplacement
d'exploration déterministe (stable sur une journée) qui propose un titre hors des habitudes.

## Raisons expliquables

Chaque recommandation porte la raison réelle de son calcul : « parce que vous avez regardé X », « vous aimez le genre Y »,
« tendance chez Divertiflix », « ajout récent », « apprécié par des profils proches », « pour élargir vos horizons ». Le client ne fait que
les mettre en mots, il n'en invente jamais. L'indice d'affinité (%) est une transformation de l'écart au meilleur score et n'est affiché
qu'à partir de 60 %.

## Assistant

Analyseur à règles (`QueryParser`) au-dessus du moteur : genres, ambiances, durée (« moins de 90 minutes », « court »), époque
(« années 80 », « récent »), exclusions (« sans gore »), « comme X ». Si aucun titre ne respecte tous les critères, il assouplit durée et
époque et le dit. Un « comme X » inconnu est avoué. Aucune conversation n'est conservée : la réponse est calculée à chaque message.

## Évaluation

Voir [evaluation-movielens.md](evaluation-movielens.md), produite par `dotnet run --project tools/recsys-eval -- --out docs/evaluation-movielens.md`.

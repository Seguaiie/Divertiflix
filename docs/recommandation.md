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
tendance 0,12 (profils distincts récents), fraîcheur 0,07, note 0,05. Sans communauté (aucun autre profil n'a de signal comparable) le
contenu prend le relais : 0,76 / 0,12 / 0,07 / 0,05 sur contenu, tendance, fraîcheur, note. Sans historique (démarrage à froid) : 0,55 / 0,25 / 0,20
sur tendance, fraîcheur, note. La sélection finale applique **MMR** (λ = 0,72) pour éviter dix titres identiques, et un emplacement
d'exploration déterministe (stable sur une journée) qui propose un titre hors des habitudes.

## Raisons expliquables

Chaque recommandation porte la raison réelle de son calcul : « parce que vous avez regardé X », « vous aimez le genre Y »,
« tendance chez Divertiflix », « ajout récent », « apprécié par des profils proches », « pour élargir vos horizons ». Le client ne fait que
les mettre en mots, il n'en invente jamais. L'indice d'affinité (%) est une transformation de la proximité de contenu entre le titre et le goût
du profil : il ne dépend pas du classement des autres titres, et n'est affiché qu'à partir de 60 %.

La fiche d'un titre n'a pas besoin du classement complet : `RecommendationEngine.ScoreOne` note ce seul titre (score, raison, pourcentage)
avec les mêmes calculs que `Recommend`, sans re-classement MMR ni place d'exploration. Son coût ne dépend pas de la taille du catalogue
(moins d'une milliseconde sur 3 000 titres, contre plusieurs secondes pour un classement de 200 titres). Un titre déjà vu, en cours ou
rejeté n'est jamais recommandé : sa fiche reste sans raison.

## Assistant

Analyseur à règles (`QueryParser`) au-dessus du moteur : genres, ambiances, durée (« moins de 90 minutes », « 1h30 max », « court »), époque
(« années 80 », « récent »), type (« film », « série », « livre audio »), exclusions (« sans gore »), « comme X ». Les négations sont lues
avant les contraintes qu'elles retournent : « pas trop long » plafonne la durée juste sous le seuil du « long » (et non l'inverse), « pas trop
court » fixe un plancher, « pas récent » et « pas classique » prennent l'époque opposée, et « pas de série » ou « no movies » gardent les autres
types. Une négation de type ne vaut que si elle termine la proposition : « pas de film d'horreur » exclut le genre, pas les films. « show »
seul n'est pas un type (« show me something funny »), « tv show » désigne une série.

Si aucun titre ne respecte tous les critères, l'assistant assouplit durée et époque et le dit ; les raisons des cartes n'affichent alors plus
ces critères levés, seulement ce que le titre respecte vraiment. Un « comme X » inconnu est avoué. Aucune conversation n'est conservée : la
réponse est calculée à chaque message.

## Évaluation

Voir [evaluation-movielens.md](evaluation-movielens.md), produite par `dotnet run --project tools/recsys-eval -- --out docs/evaluation-movielens.md`.

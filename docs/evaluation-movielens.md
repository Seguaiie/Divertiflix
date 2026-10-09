# Évaluation du moteur de recommandation sur MovieLens

Jeu de données : MovieLens `ml-latest-small` (GroupLens Research, Université du Minnesota) : 9742 films, 100836 notes, 610 utilisateurs, 3654 étiquettes.
Citation : F. Maxwell Harper et Joseph A. Konstan, *The MovieLens Datasets: History and Context*, ACM Transactions on Interactive Intelligent Systems 5(4), 2015.

## Protocole

- Leave-last-out : pour chacun des 603 utilisateurs ayant au moins 5 films aimés (note >= 4), le film aimé le plus récent est caché.
- Le profil est construit avec le reste de l'historique (notes converties en signaux : >= 4,5 = pouce haut, >= 4 = visionnage complet, >= 3 = léger intérêt, < 3 = désintérêt).
- Le catalogue, la tendance et le filtrage collaboratif n'utilisent que l'entraînement : aucune fuite du test.
- Le moteur évalué est celui de l'API (`Divertiflix.Domain`), sans adaptation. Classement sur tout le catalogue (9742 films), films déjà notés exclus, top 10.
- Genre principal = premier genre MovieLens ; autres genres et étiquettes fréquentes = mots-clés.

## Résultats (K = 10)

| Méthode | HR@10 | NDCG@10 | MRR@10 | Couverture du catalogue | Nouveauté (log2 du rang de popularité) |
| --- | ---: | ---: | ---: | ---: | ---: |
| Aléatoire | 0.17 % | 0.0008 | 0.0006 | 46.5 % | 11.71 |
| Popularité | 4.15 % | 0.0231 | 0.0173 | 1.2 % | 3.13 |
| Divertiflix, contenu seul | 0.33 % | 0.0013 | 0.0007 | 13.5 % | 11.24 |
| Divertiflix, complet (contenu + collaboratif + tendance + MMR) | 1.33 % | 0.0059 | 0.0037 | 10.7 % | 9.05 |

## Lecture

- **HR@K** : part des utilisateurs dont le film caché figure dans les K premiers. **NDCG@K** et **MRR@K** : récompensent un rang élevé.
- **Couverture** : part du catalogue effectivement recommandée à au moins un utilisateur (la popularité n'en recommande qu'une poignée).
- **Nouveauté** : plus le nombre est grand, plus les titres proposés sont éloignés des plus populaires.
- Le moteur complet applique volontairement une diversification (MMR) et un emplacement d'exploration : ils coûtent un peu de précision brute en échange de variété et de découverte.
- **Honnêteté du résultat** : sur MovieLens, la popularité est une référence très forte (c'est connu pour ce protocole, avec 9 700 films et peu de notes par personne). Le moteur de Divertiflix n'est pas réglé pour ce jeu de données : il est conçu pour un petit catalogue où l'explication, la diversité et l'exploration comptent autant que la précision brute. Il fait nettement mieux que le hasard et que le contenu seul, sans égaler la popularité en précision, mais avec une couverture et une nouveauté bien supérieures.
- MovieLens ne contient ni synopsis, ni durée, ni distribution : le contenu se résume ici aux genres et étiquettes. Sur le catalogue de Divertiflix, qui a des mots-clés, des synopsis et des durées, le signal de contenu est plus riche.

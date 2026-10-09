# Démonstration (7 minutes)

Préparer : API et fronts lancés, un compte abonné créé, le back-office ouvert dans une seconde fenêtre (compte `root`).

1. **Connexion et profils** (30 s). Montrer le logo, l'inscription, le choix du profil. Le profil nommé à l'inscription s'ouvre directement.
2. **Accueil** (1 min). À la une, reprise, rangées expliquées : « Parce que vous avez regardé X ». Survoler une carte : lecture, liste, pouces.
3. **Fiche et lecture** (1 min). Ouvrir une fiche, lancer un court-métrage, quitter à 30 secondes : la rangée « Continuer à regarder » le propose.
4. **Assistant** (1 min). Ctrl+J : « un film court et sombre sans gore ». Montrer les critères compris, les titres et leur raison. Essayer « comme Zorglub » : il admet qu'il ne connaît pas.
5. **Demande de titre en direct** (1 min 30). Abonné : menu du profil, Demander un titre. Back-office : Demandes, Approuver. Revenir au portail : la notification arrive sans recharger.
6. **Aide** (1 min). Abonné : bouton Aide, nouveau billet. Back-office : Billets, ouvrir, répondre. La réponse apparaît dans le fil de l'abonné.
7. **Supervision** (30 s). Tableau de bord : compteurs, services, flux en direct. Simuler un capteur : `mosquitto_pub -h localhost -t divertiflix/capteurs/temp1 -m '{"temp":21.5}'`.
8. **Sécurité en une phrase** (30 s). Jetons à usage unique, URL de média signées, CSP stricte, rôles vérifiés par l'API, rien d'externe.

Plan B si le réseau tombe : tout le catalogue de démonstration est local, seule la vidéo « Big Buck Bunny » dépend d'Internet.

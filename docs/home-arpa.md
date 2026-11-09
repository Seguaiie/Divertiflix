# Services auto-hébergés (*.home.arpa)

Divertiflix s'appuie sur les services de la maison publiés par Traefik (`192.168.8.240`) sous `https://<service>.home.arpa`, avec des
certificats de l'autorité interne Step CA (`divertiflixCA`).

## Ce qui est en place

| Fonction | Où | État |
|---|---|---|
| Page **Services** du back-office | `/admin/services` (administrateurs seulement ; rien dans le portail) | Actif : les 17 services, état mesuré chaque minute, délai, code HTTP, certificat et échéance (alerte sous 6 h) |
| Demandes → **Jellyseerr** | back-office, page Demandes | Prêt : actif dès que `JELLYSEERR_API_KEY` est fourni **et** que l'autorité Step CA est approuvée |
| Alertes **ntfy** (service tombé / revenu) | téléphone | Prêt : actif dès que `NTFY_TOPIC` est fourni **et** que l'autorité Step CA est approuvée |
| Divertiflix derrière **Traefik** | `https://divertiflix.home.arpa` | Prêt : fichier `infra/traefik/divertiflix.yml` à déposer sur 192.168.8.240 |

## Surveillance

L'API interroge chaque service une fois par minute (`GET /`, sans redirection, sans cookie ni jeton, réponse non lue). Elle note :

- l'état : **en ligne** (le service répond, une redirection vers sa page de connexion compte), **perturbé** (erreur 5xx, certificat
  expiré ou au mauvais nom), **hors ligne** (pas de réponse, nom introuvable, ou certificat par défaut de Traefik = route absente) ;
- le certificat : vérifié normalement par le serveur. Tant que l'autorité Step CA n'y est pas installée, il est marqué « autorité
  inconnue de ce serveur » : c'est signalé, pas ignoré.

FlareSolverr et dnsmasq n'ont pas d'interface web : ils sont listés sans être sondés.

## Demandes → Jellyseerr

1. Une personne demande un film ou une série dans le portail.
2. Un administrateur l'**approuve** dans le back-office.
3. L'API cherche le titre dans Jellyseerr : même type (film ou série), même titre (traduit ou original) et année à un an près.
   Aucun résultat sûr : la demande reste « approuvée » avec la mention « Introuvable dans Jellyseerr : à traiter à la main »
   (mieux vaut rien qu'un mauvais film téléchargé).
4. La demande est créée dans Jellyseerr (toutes les saisons pour une série), qui la confie à Radarr ou Sonarr : la demande passe
   « en téléchargement » et la personne est prévenue.
5. Toutes les 2 minutes, l'API regarde la disponibilité du média. Disponible : la demande passe « disponible » et la personne reçoit
   une notification avec un lien vers Jellyfin. Refusée dans Jellyseerr : « refusée », avec la raison.

Le back-office montre l'état du suivi sous chaque demande (« Jellyseerr · transmise », « introuvable », ou « en échec » avec la raison).
Les livres audio ne passent pas par Jellyseerr.

## Mise en route

```bash
cd ~/divertiflix/Divertiflix
# 1. Autorité Step CA (une fois) : le fichier root_ca.crt de Step CA
sudo CA_CERT=/chemin/vers/root_ca.crt ./install-serveur.sh

# 2. Clé Jellyseerr et sujet ntfy, saisis sans passer par l'historique
read -rs JELLYSEERR_API_KEY && export JELLYSEERR_API_KEY
sudo --preserve-env=JELLYSEERR_API_KEY NTFY_TOPIC=divertiflix-alertes ./install-serveur.sh
unset JELLYSEERR_API_KEY

# 3. Derrière Traefik (après avoir déposé infra/traefik/divertiflix.yml et ajouté le nom dans dnsmasq)
sudo TRUSTED_PROXY=192.168.8.240 ./install-serveur.sh
```

## Certificats de 24 heures

Step CA délivre par défaut des certificats valables 24 h. Traefik doit le savoir pour les renouveler à temps : dans la configuration
statique, sur le résolveur ACME de Step CA, `certificatesDuration: 24`. Sans ce réglage, Traefik les croit valables 90 jours et ne
les renouvelle pas : tous les services passent en erreur de certificat une journée après leur émission. La page Services du back-office affiche
l'échéance de chaque certificat et alerte sous 6 heures.

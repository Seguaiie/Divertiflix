# Audiobookshelf

Deux mécanismes coexistent pour amener les livres audio d'Audiobookshelf (ABS) dans le catalogue Divertiflix
(`Title.Kind = Audiobook`), et un seul chemin de lecture :

1. **Intégration native** (code depuis le 2026-10-28, commit « Audiobookshelf branché sur l'API ») : l'API lit
   elle-même les bibliothèques ABS et relaie la lecture. C'est le mécanisme prévu pour la production, mais **il
   n'est pas encore déployé** (voir « État réel du déploiement » plus bas).
2. **Ingestion externe par clé partagée** (préparée le 2026-10-09, câblée en production le 2026-10-30) : un script
   tourne là où ABS est accessible et pousse son catalogue vers Divertiflix. C'est ce qui tourne réellement
   aujourd'hui.

Dans les deux cas, le sens est unique : **Audiobookshelf → Divertiflix**. Rien ne part de Divertiflix vers ABS, et un
livre retiré d'ABS n'est jamais supprimé du catalogue (upsert seulement).

## Topologie

| Rôle | Machine | Détail |
|---|---|---|
| API Divertiflix | `192.168.8.115` | `divertiflix-api.service` (dotnet, `127.0.0.1:5080`), nginx expose `/api/` en HTTP (port 80, pas de vhost HTTPS sur ce site) |
| GitLab + runner CI | `192.168.8.115` | même machine, `http://192.168.8.115:8181`, projet `root/divertiflix` |
| Audiobookshelf | `192.168.8.180` | Conteneur Docker `ghcr.io/advplyr/audiobookshelf:latest` (2.37.2), port `13378:80`, tourne en `root` dans le conteneur |
| Fichiers audio | NFS `192.168.6.69:/AudioBookshelf` | monté dans le conteneur ABS en `/audiobooks` |

## Mécanisme 1 — natif (sur GitHub, pas encore en production)

- **Configuration** : section `Audiobookshelf` — `Audiobookshelf__Url` (ex. `http://192.168.8.180:13378`),
  `Audiobookshelf__Token` (jeton d'API d'un compte ABS, reste côté serveur), `Audiobookshelf__SyncMinutes` (60 par
  défaut, `0` désactive la synchro périodique mais garde le bouton manuel). `install-serveur.sh` accepte
  `AUDIOBOOKSHELF_URL=` / `AUDIOBOOKSHELF_TOKEN=` et les mémorise dans `.env` sous ces noms (comme `MQTT_BIND`,
  `DOMAIN`…) : à fournir une fois, relu ensuite.
- **Synchro automatique** : `AudiobookshelfSyncService` (tâche de fond), 20 s après le démarrage puis toutes les
  `SyncMinutes`, lit les bibliothèques de type livre (pas les balados) via `AudiobookshelfClient.ListBooksAsync` et
  upsert via `AudiobookshelfCatalog` (même classe que le mécanisme 2 — même table, même clé d'upsert). Une panne
  d'ABS est journalisée, jamais fatale.
- **Synchro manuelle** : `POST /api/admin/audiobookshelf-sync/run` (rôle Admin) — bouton du back-office. Répond 409
  si `Audiobookshelf__Url`/`Token` manquent, 502 si ABS ne répond pas ou refuse le jeton.
- **Lecture (HLS, tous les chapitres fusionnés)** : `Title.StreamUrl = "abs:{idItem}"`. `GET /api/titles/{id}/playback`
  reconnaît ce préfixe, ouvre une session ABS (`POST /api/items/{id}/play`, `forceTranscode: true` — ABS assemble
  tous les fichiers du livre, un par chapitre, en un flux HLS continu) et renvoie une URL relayée, signée, valable
  6 h : `/api/media/abs/hls/{jeton}/{session}/output.m3u8`. Le dock audio du portail la lit avec `hls.js`. L'API ne
  relaie que les sessions qu'elle a elle-même ouvertes (`AudiobookshelfSessions`, suivi en mémoire, fermeture côté
  ABS après 7 h) ; le jeton est revérifié (compte actif) à chaque segment.
- **Couverture** : relayée sous `/api/media/abs/cover/{id}`, uniquement pour un identifiant déjà présent au
  catalogue — ce point n'ouvre pas tout Audiobookshelf au premier identifiant venu.
- **Sécurité** : le jeton ABS et son adresse ne sont jamais envoyés au navigateur. Les identifiants ABS (item,
  session) sont validés par une liste blanche (`[A-Za-z0-9_-]`, 64 caractères max) avant d'entrer dans une URL.
  `SafeUrl` accepte le préfixe `abs:` en plus de `media:`/`http(s)`. Les deux endpoints de relais (`cover`, `hls`)
  sont sous la limite de débit `media`.
- **Couvert par les tests** : `AudiobookshelfProxyTests.cs` (faux serveur ABS), côté API seulement — pas essayé
  contre un vrai Audiobookshelf au moment d'écrire ce commit (pas d'accès à `192.168.8.180` dans cette session de
  dev). `packages/api-client/openapi.json` ne contient pas encore `/run` : à régénérer (voir `docs/regeneration.md`).

## Mécanisme 2 — ingestion externe par clé partagée (ce qui tourne réellement)

`POST /api/admin/audiobookshelf-sync` (même contrôleur), protégé par une clé partagée (même principe que
`directory-sync`) :

- En-tête `X-Sync-Key`, comparée à `AudiobookshelfSync:ApiKey` / `AudiobookshelfSync__ApiKey`. Absente ou invalide → 401.
- Corps : `{ "items": [ { externalId, name, synopsis, author, narrator, durationMinutes, coverUrl, streamUrl, genre } ] }`.
  **`streamUrl` est fourni par l'appelant** — rien n'oblige au format `abs:{id}` ici, contrairement au mécanisme 1.
  Le gabarit `scripts/audiobookshelf_sync_example.py` y met un lien direct vers la page ABS
  (`http://<abs>/item/<id>`) : pas de lecture intégrée au portail par ce chemin, juste une fiche avec un lien externe.
- Upsert par clé (`ExternalSource="Audiobookshelf"`, `ExternalId`) — **même table que le mécanisme 1** : si les deux
  tournent un jour en même temps sur le même item, le dernier qui écrit gagne (et le format de `streamUrl` en
  dépend : lien externe ou lecture intégrée).
- Réponse : `{ "created": N, "updated": N }`. Événement SignalR `audiobookshelfSynced` au groupe staff.
- Écriture concurrente → 409 plutôt que 500 (contrainte unique Postgres interceptée).
- 30 requêtes/minute par IP (politique `sync`, partagée avec `directory-sync`, `RateLimit:SyncPerMinute`).

### Déploiement réel de ce mécanisme (192.168.8.180, 2026-10-30)

1. **Jeton ABS** : récupéré via `POST http://localhost:13378/login` (compte `root`), champ `user.token` — jeton de
   compte de longue durée, pas une clé API dédiée.
2. **Script** : copie de `scripts/audiobookshelf_sync_example.py` déployée en
   `/opt/audiobookshelf/sync_to_divertiflix.py` (`emilien`, `chmod 750`).
3. **Variables d'environnement** : `/opt/audiobookshelf/sync.env` (`chmod 600`) :
   ```
   AUDIOBOOKSHELF_URL=http://localhost:13378
   AUDIOBOOKSHELF_TOKEN=<jeton du compte root>
   DIVERTIFLIX_URL=http://192.168.8.115
   DIVERTIFLIX_SYNC_KEY=<même valeur que AudiobookshelfSync__ApiKey côté Divertiflix>
   ```
4. **Dépendance Python** : `python3-requests` installé via `apt` (le `pip install requests` du docstring ne passe
   pas sur Debian 13/trixie, « externally managed » — le paquet système évite le problème).
5. **Planification** : cron de `emilien`, toutes les heures :
   `0 * * * * set -a; . /opt/audiobookshelf/sync.env; set +a; /usr/bin/python3 /opt/audiobookshelf/sync_to_divertiflix.py >> /opt/audiobookshelf/sync.log 2>&1`
6. Côté Divertiflix : `AudiobookshelfSync__ApiKey=<clé générée>` ajoutée à `/opt/divertiflix/.env`, lue par
   `divertiflix-api.service` (`EnvironmentFile=`), service redémarré. Testé manuellement : `{"created": 1, "updated": 0}`.

## État réel du déploiement (important, constaté le 2026-10-30)

Le code du mécanisme natif (commit du 2026-10-28, fusionné sur `main` de GitHub) **n'a pas atteint la production**.
En creusant pourquoi :

- Le déploiement réel se fait par la pipeline GitLab (`.gitlab-ci.yml`, job `deploy` → `bash install-serveur.sh`) sur
  un runner shell qui tourne sur `192.168.8.115` lui-même.
- Le commentaire en tête de `.gitlab-ci.yml` dit que le projet GitLab « sonde GitHub toutes les 15 minutes » — en
  réalité **le projet GitLab local n'est pas configuré en miroir** (`Project#mirror` = `false`, pas d'import
  configuré). Rien ne rapatrie automatiquement les commits de GitHub vers ce GitLab : il faut un push explicite vers
  `git@192.168.8.115:root/divertiflix.git`.
- Les deux seules pipelines déjà exécutées sur ce projet (9 et 14 octobre) ont **échoué à l'étape `test`** (le
  `deploy` a donc été sauté). La cause n'a pas été creusée plus loin.
- Résultat : le binaire actuellement en service date d'avant le 14 octobre, il ne connaît que le mécanisme 2
  (ingestion par clé partagée), pas le mécanisme natif, pas le relais HLS, pas `Audiobookshelf__Url/Token`.

**Pour que le mécanisme natif arrive en production**, il faut, dans cet ordre : pousser (ou faire pousser) la
branche `main` de GitHub vers ce GitLab (manuellement, ou en configurant un vrai miroir de projet), corriger ce qui
fait échouer l'étape `test` du pipeline, laisser `deploy` tourner, puis fournir `AUDIOBOOKSHELF_URL` /
`AUDIOBOOKSHELF_TOKEN` à `install-serveur.sh` (ou poser directement `Audiobookshelf__Url` / `Audiobookshelf__Token`
dans `/opt/divertiflix/.env`) et redémarrer `divertiflix-api.service`.

## Permissions côté Audiobookshelf (192.168.8.180, vérifié le 2026-10-30)

Le conteneur tourne en `root` (uid 0, aucun remappage utilisateur Docker) : il peut écrire sans restriction côté
hôte, y compris dans des répertoires appartenant à `emilien`. Testé par écriture directe :

- `/opt/audiobookshelf/config` (bind mount `/config`) : écriture OK.
- `/opt/audiobookshelf/metadata` (bind mount `/metadata`), y compris `/metadata/streams` — **c'est ce répertoire que
  le relais HLS du mécanisme natif utilise pour le transcodage** (`forceTranscode`, ffmpeg déjà présent dans l'image) :
  écriture OK.
- `/audiobooks` (volume NFS `192.168.6.69:/AudioBookshelf`) : écriture OK (pas de `root_squash` bloquant côté export
  NFS, ou en tout cas pas pour cet accès). Pas utilisé en pratique : `storeCoverWithItem` et `storeMetadataWithItem`
  sont désactivés dans les réglages ABS, donc rien n'est écrit dans la bibliothèque source.

Aucune action nécessaire : rien à corriger côté permissions pour l'un ou l'autre mécanisme.

## Limites connues

- Mécanisme 2 (le seul actif en production) : synchro additive uniquement, et `streamUrl` pointe vers une page ABS
  externe — pas de lecture intégrée au portail tant que le mécanisme natif n'est pas déployé.
- Le jeton ABS utilisé pour le mécanisme 2 est un jeton de compte (`root`), pas une clé API dédiée et révocable
  isolément : le révoquer suppose de changer le mot de passe du compte ou de régénérer le jeton, puis de mettre à
  jour `sync.env`.
- Aucune alerte si le cron du mécanisme 2 échoue : seul `/opt/audiobookshelf/sync.log` en garde la trace.
- Pas de HTTPS entre `192.168.8.180` et `192.168.8.115` : clé de synchro et contenu circulent en clair sur le LAN.
- Pas de gestion des balados ni des séries ABS dans l'un ou l'autre mécanisme : seul le modèle « livre » simple
  (titre/auteur/narrateur/durée/genre) est repris.
- Si les deux mécanismes tournent un jour simultanément sur le même item, le dernier à écrire gagne sur `StreamUrl`
  (externe vs. lecture intégrée) — à garder en tête avant d'activer le mécanisme natif sans retirer le cron externe.

## Vérifier que ça tourne

```bash
# mécanisme 2, sur 192.168.8.180 : exécution manuelle, résultat attendu {"created": N, "updated": N}
set -a; . /opt/audiobookshelf/sync.env; set +a
python3 /opt/audiobookshelf/sync_to_divertiflix.py

# dernière exécution du cron
tail -f /opt/audiobookshelf/sync.log

# mécanisme 1, une fois déployé et configuré : déclenchement manuel (rôle Admin)
curl -X POST http://192.168.8.115/api/admin/audiobookshelf-sync/run -H "Authorization: Bearer <jeton admin>"
```

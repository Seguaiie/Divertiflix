#!/usr/bin/env python3
"""
Gabarit : synchronisation Audiobookshelf -> Divertiflix (point 7 de la préparation).

Ce script n'est PAS exécuté sur ce serveur (le serveur Audiobookshelf n'est pas installé ici).
Il tourne là où Audiobookshelf est hébergé (ou n'importe où ayant accès à son API REST), et pousse
périodiquement le contenu des bibliothèques vers Divertiflix, qui upsert les livres audio dans son
catalogue (Title.Kind = Audiobook). Voir Divertiflix.Api/Controllers/AudiobookshelfSyncController.cs
pour le contrat exact.

Dépendances réelles (non installées ici) : `pip install requests`

Variables d'environnement attendues :
  AUDIOBOOKSHELF_URL, AUDIOBOOKSHELF_TOKEN   -> API Audiobookshelf (voir sa doc : /api/libraries, /api/items)
  DIVERTIFLIX_URL, DIVERTIFLIX_SYNC_KEY      -> doit correspondre à AudiobookshelfSync__ApiKey côté API
"""
import os

import requests


def fetch_audiobookshelf_items() -> list[dict]:
    """Récupère tous les items de toutes les bibliothèques Audiobookshelf, au format Divertiflix."""
    base = os.environ["AUDIOBOOKSHELF_URL"].rstrip("/")
    headers = {"Authorization": f"Bearer {os.environ['AUDIOBOOKSHELF_TOKEN']}"}

    libraries = requests.get(f"{base}/api/libraries", headers=headers, timeout=30).json()["libraries"]
    items: list[dict] = []
    for lib in libraries:
        page = requests.get(f"{base}/api/libraries/{lib['id']}/items", headers=headers, timeout=30).json()
        for it in page.get("results", []):
            media = it.get("media", {})
            meta = media.get("metadata", {})
            items.append({
                "externalId": it["id"],
                "name": meta.get("title", "Sans titre"),
                "synopsis": meta.get("description"),
                "author": meta.get("authorName"),
                "narrator": meta.get("narratorName"),
                "durationMinutes": round(media.get("duration", 0) / 60),
                "coverUrl": f"{base}/api/items/{it['id']}/cover",
                # Lien de lecture externe vers Audiobookshelf (pas de proxy du flux ici) :
                "streamUrl": f"{base}/item/{it['id']}",
                "genre": (meta.get("genres") or ["Livre audio"])[0],
            })
    return items


def push_to_divertiflix(items: list[dict]) -> None:
    base_url = os.environ["DIVERTIFLIX_URL"].rstrip("/")
    sync_key = os.environ["DIVERTIFLIX_SYNC_KEY"]
    res = requests.post(
        f"{base_url}/api/admin/audiobookshelf-sync",
        json={"items": items},
        headers={"X-Sync-Key": sync_key},
        timeout=30,
    )
    res.raise_for_status()
    print(res.json())  # {"created": N, "updated": N}


if __name__ == "__main__":
    push_to_divertiflix(fetch_audiobookshelf_items())

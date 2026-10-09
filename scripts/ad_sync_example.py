#!/usr/bin/env python3
"""
Gabarit : synchronisation Active Directory -> Divertiflix (point 6 de la préparation).

Ce script n'est PAS exécuté sur ce serveur (pas de serveur Windows/LDAP ici). Il est fait pour
tourner sur une machine qui a un accès réel à l'Active Directory du réseau (ex. un contrôleur de
domaine, ou un membre du domaine), et pousse périodiquement (cron / tâche planifiée) la liste des
comptes et de leurs groupes vers l'API Divertiflix, qui décide des rôles et désactive les comptes
disparus. Voir Divertiflix.Api/Controllers/DirectorySyncController.cs pour le contrat exact.

Dépendances réelles (non installées ici) : `pip install ldap3 requests`

Variables d'environnement attendues sur la machine qui exécute ce script :
  AD_SERVER, AD_BASE_DN, AD_BIND_USER, AD_BIND_PASSWORD   -> accès LDAP
  DIVERTIFLIX_URL     (ex. https://divertiflix.example.com)
  DIVERTIFLIX_SYNC_KEY (doit correspondre à DirectorySync__ApiKey côté API, jamais en dur ici)
"""
import os
import sys

# from ldap3 import Server, Connection, SUBTREE
import requests


def fetch_ad_accounts() -> list[dict]:
    """Interroge l'Active Directory et retourne [{"email": ..., "displayName": ..., "groups": [...]}]."""
    # Exemple avec ldap3 (pseudo-code, à adapter au schéma réel de l'AD du réseau) :
    #
    # server = Server(os.environ["AD_SERVER"])
    # conn = Connection(server, os.environ["AD_BIND_USER"], os.environ["AD_BIND_PASSWORD"], auto_bind=True)
    # conn.search(
    #     os.environ["AD_BASE_DN"],
    #     "(&(objectClass=user)(mail=*))",
    #     search_scope=SUBTREE,
    #     attributes=["mail", "displayName", "memberOf"],
    # )
    # accounts = []
    # for entry in conn.entries:
    #     groups = [str(g).split(",")[0].split("=")[1] for g in entry.memberOf]
    #     accounts.append({"email": str(entry.mail), "displayName": str(entry.displayName), "groups": groups})
    # return accounts
    raise NotImplementedError("Brancher le vrai accès LDAP une fois l'Active Directory disponible.")


def push_to_divertiflix(accounts: list[dict]) -> None:
    base_url = os.environ["DIVERTIFLIX_URL"].rstrip("/")
    sync_key = os.environ["DIVERTIFLIX_SYNC_KEY"]
    res = requests.post(
        f"{base_url}/api/admin/directory-sync",
        json={"accounts": accounts},
        headers={"X-Sync-Key": sync_key},
        timeout=30,
    )
    res.raise_for_status()
    print(res.json())  # {"created": N, "updated": N, "deactivated": N}


if __name__ == "__main__":
    try:
        push_to_divertiflix(fetch_ad_accounts())
    except NotImplementedError as e:
        print(f"Gabarit non branché : {e}", file=sys.stderr)
        sys.exit(1)

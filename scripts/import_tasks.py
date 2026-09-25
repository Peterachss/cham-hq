#!/usr/bin/env python3
"""
Chạm HQ — one-time move of data.json into Firestore.

Run this once, after Firestore exists and firestore.rules are published.
It copies PEOPLE into /members (so you can fill in emails) and every task
in data.json into /tasks, so nobody has to retype 29 jobs.

    set FIREBASE_SERVICE_ACCOUNT=<paste the json>
    python scripts/import_tasks.py            # shows what it would do
    python scripts/import_tasks.py --write    # actually writes

Safe to read twice; it refuses to write if /tasks already has anything,
so you cannot accidentally double up.
"""

import json
import os
import sys

from google.cloud import firestore
from google.oauth2 import service_account

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
WRITE = "--write" in sys.argv


def key_path():
    """Read the key from a file path, so the secret never goes on a command line."""
    if "--key" in sys.argv:
        i = sys.argv.index("--key")
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return None


def main():
    path = key_path()
    if path:
        with open(path, encoding="utf-8") as f:
            raw = f.read()
    else:
        raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
    if not raw:
        sys.exit("Pass --key <path to the service account json>, "
                 "or set FIREBASE_SERVICE_ACCOUNT.")
    info = json.loads(raw)
    db = firestore.Client(
        project=info["project_id"],
        credentials=service_account.Credentials.from_service_account_info(info),
    )

    with open(os.path.join(HERE, "data.json"), encoding="utf-8") as f:
        data = json.load(f)

    existing = list(db.collection("tasks").limit(1).stream())
    if existing and WRITE:
        sys.exit("/tasks already has documents. Delete them first, or skip the import.")

    people = {k: v for k, v in data["PEOPLE"].items() if k != "team"}
    tasks = data["TASKS"]

    print(f"{len(people)} people, {len(tasks)} tasks")
    print()

    if not WRITE:
        print("DRY RUN. Nothing written. Add --write to do it for real.")
        print()
        for k, p in people.items():
            print(f"  member  {k:8} {p['name']:8} {p.get('role','')}")
        print()
        for t in tasks:
            print(f"  task    {t['who']:8} [{t['status']:7}] {t['title'][:58]}")
        return

    batch = db.batch()
    n = 0

    # Members are keyed by email. We do not know the emails yet, so these
    # go in as placeholders for you to rename in the Firestore console.
    for k, p in people.items():
        ref = db.collection("members").document(f"{k}@REPLACE-WITH-REAL-EMAIL")
        batch.set(ref, {"personKey": k, "name": p["name"], "admin": k in ("peter", "bach")})
        n += 1

    for t in tasks:
        ref = db.collection("tasks").document()
        batch.set(ref, {
            "who": t["who"],
            "title": t["title"],
            "note": t.get("note", ""),
            "status": t.get("status", "open"),
            "due": t.get("due"),
            "since": t.get("since"),
            "createdBy": "import",
        })
        n += 1

    batch.commit()
    print(f"wrote {n} documents")
    print("Now open the Firestore console and rename each /members document")
    print("to that person's real email address, all lowercase.")


if __name__ == "__main__":
    main()

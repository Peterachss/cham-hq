#!/usr/bin/env python3
"""
Chạm HQ - upload the site's base data to the members-only database.

The page used to read data.json straight off the web, which meant anyone
with the address could read the team list, the calendar and the chat
summaries. data.json now lives only on Peter's computer (it is in
.gitignore) and this uploads it to /site/data, which only signed-in
members can read (see firestore.rules).

Run it after editing data.json:

    python scripts/publish_data.py
"""

import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import push  # noqa: E402  (firebase() lives there)

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def main():
    with open(os.path.join(HERE, "data.json"), encoding="utf-8") as f:
        data = json.load(f)
    need = {"TODAY", "PEOPLE", "DAYS", "TASKS", "EVENTS", "UNDATED", "MONEY", "LINKS"}
    missing = need - set(data)
    if missing:
        sys.exit("data.json is missing: " + ", ".join(sorted(missing)))
    db = push.firebase()
    if db is None:
        sys.exit("no service account - nothing uploaded")
    db.collection("site").document("data").set(data)
    print(f"uploaded data.json to site/data ({len(json.dumps(data, ensure_ascii=False)):,} characters)")


if __name__ == "__main__":
    main()

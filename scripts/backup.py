#!/usr/bin/env python3
"""
Chạm HQ - nightly backup of the whole database to Peter's laptop.

Every collection, every document, into one compressed file per night:
    ~/.cham-hq/backups/cham-hq-YYYY-MM-DD.json.gz
The last 60 nights are kept; older ones are deleted.

    python scripts/backup.py                     make tonight's backup
    python scripts/backup.py --list              what backups exist
    python scripts/backup.py --restore 2026-09-26 --only tasks
                                                 show what WOULD come back
    python scripts/backup.py --restore 2026-09-26 --only tasks --apply
                                                 put back documents that are
                                                 missing now (never touches
                                                 ones that still exist)
    ... --apply --overwrite                      also roll existing ones back

Restoring is always by hand, one collection at a time, and shows what it
would do first. The backup never contains anything that is not already in
the database; the files stay on this computer only (not in the repo).
"""

import argparse
import datetime as dt
import glob
import gzip
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import push  # noqa: E402
import status  # noqa: E402

DIR = os.path.join(push.HOME, "backups")
KEEP = 60
COLLECTIONS = ["members", "tasks", "updates", "photos", "expenses", "pushSubs", "chatDrafts", "announcements",
               "sales", "orders", "activities", "sponsors", "meetings", "site", "meta"]


def log(msg):
    line = f"[{dt.datetime.now(push.VN):%Y-%m-%d %H:%M}] {msg}"
    print(line, flush=True)
    try:
        os.makedirs(os.path.join(push.HOME, "logs"), exist_ok=True)
        with open(os.path.join(push.HOME, "logs", "backup.log"), "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def to_json(v):
    """Firestore values -> plain JSON, with timestamps marked so they come back as timestamps."""
    if isinstance(v, dt.datetime):
        return {"__ts__": v.isoformat()}
    if isinstance(v, dict):
        return {k: to_json(x) for k, x in v.items()}
    if isinstance(v, list):
        return [to_json(x) for x in v]
    if isinstance(v, (bytes, bytearray)):
        return {"__bytes__": v.hex()}
    if hasattr(v, "path") and hasattr(v, "id"):          # a document reference
        return {"__ref__": v.path}
    return v


def from_json(v, db):
    if isinstance(v, dict):
        if set(v) == {"__ts__"}:
            return dt.datetime.fromisoformat(v["__ts__"])
        if set(v) == {"__bytes__"}:
            return bytes.fromhex(v["__bytes__"])
        if set(v) == {"__ref__"}:
            return db.document(v["__ref__"])
        return {k: from_json(x, db) for k, x in v.items()}
    if isinstance(v, list):
        return [from_json(x, db) for x in v]
    return v


def backup(db):
    os.makedirs(DIR, exist_ok=True)
    out, counts = {"taken": dt.datetime.now(push.VN).isoformat(), "collections": {}}, {}
    for c in COLLECTIONS:
        docs = {d.id: to_json(d.to_dict() or {}) for d in db.collection(c).stream()}
        out["collections"][c] = docs
        counts[c] = len(docs)
    day = dt.datetime.now(push.VN).date().isoformat()
    path = os.path.join(DIR, f"cham-hq-{day}.json.gz")
    tmp = path + ".part"
    with gzip.open(tmp, "wt", encoding="utf-8") as f:
        json.dump(out, f, ensure_ascii=False)
    os.replace(tmp, path)                                 # never leave a half-written backup
    size = os.path.getsize(path)
    log(f"backup saved: {os.path.basename(path)} ({size / 1024:.0f} KB) - "
        + ", ".join(f"{c} {n}" for c, n in counts.items() if n))
    status.beat("backup", True, f"{size / 1024:.0f} KB, {sum(counts.values())} documents", db)
    old = sorted(glob.glob(os.path.join(DIR, "cham-hq-*.json.gz")))[:-KEEP]
    for p in old:
        os.remove(p)
        log(f"removed old backup {os.path.basename(p)}")


def find(day):
    path = os.path.join(DIR, f"cham-hq-{day}.json.gz")
    if not os.path.exists(path):
        sys.exit(f"no backup for {day}. Try --list.")
    with gzip.open(path, "rt", encoding="utf-8") as f:
        return json.load(f)


def restore(db, day, only, apply, overwrite):
    data = find(day)
    if only not in data["collections"]:
        sys.exit(f"{only} is not in that backup")
    saved = data["collections"][only]
    now = {d.id for d in db.collection(only).stream()}
    back = [i for i in saved if i not in now]
    roll = [i for i in saved if i in now] if overwrite else []
    print(f"{only} on {day}: {len(saved)} in the backup, {len(now)} now")
    print(f"  missing now, would come back: {len(back)}")
    for i in back[:20]:
        print("    +", i, str(saved[i].get("title") or saved[i].get("name") or saved[i].get("description") or "")[:60])
    if overwrite:
        print(f"  exist now, would be rolled back to the backup: {len(roll)}")
    if not apply:
        print("Nothing changed. Add --apply to do it.")
        return
    for i in back + roll:
        db.collection(only).document(i).set(from_json(saved[i], db))
    log(f"restored {len(back)} missing + {len(roll)} rolled back in {only} from {day}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--list", action="store_true")
    ap.add_argument("--restore", metavar="YYYY-MM-DD")
    ap.add_argument("--only", metavar="COLLECTION")
    ap.add_argument("--apply", action="store_true")
    ap.add_argument("--overwrite", action="store_true")
    args = ap.parse_args()
    if args.list:
        for p in sorted(glob.glob(os.path.join(DIR, "cham-hq-*.json.gz"))):
            print(f"{os.path.basename(p)}  {os.path.getsize(p) / 1024:.0f} KB")
        return
    db = push.firebase()
    if db is None:
        sys.exit("no service account")
    if args.restore:
        if not args.only:
            sys.exit("restore one collection at a time: add --only tasks (or expenses, orders, ...)")
        restore(db, args.restore, args.only, args.apply, args.overwrite)
    else:
        backup(db)


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        log(f"BACKUP FAILED: {type(e).__name__}: {e}")
        status.beat("backup", False, f"{type(e).__name__}: {e}")
        sys.exit(1)

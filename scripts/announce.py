#!/usr/bin/env python3
"""
Chạm HQ - send the announcements admins type into the site.

An admin (Peter, Bach, Thy) writes a message in the Announce box on the
Updates tab. The site files it in /announcements as "pending". This sends
it as a push to everyone who has notifications on - except the person who
wrote it - and marks it "sent", with how many people got it, so the site
can show "Sent to 4 people".

    pythonw scripts/announce.py --watch    stay running and send within
                                           seconds (started at log-on)
    python  scripts/announce.py            send anything waiting, then stop
    python  scripts/announce.py --dry-run  show what would go out

push.py also calls send_pending() every fifteen minutes, so an announcement
still goes out if this watcher is not running - just not straight away.

A message is claimed in a transaction before sending, so two senders
running at once can never push the same announcement twice.
"""

import argparse
import datetime as dt
import os
import socket
import sys
import threading
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import push  # noqa: E402  (same folder: firebase(), vapid_key(), load(), Pusher)

from google.cloud import firestore  # noqa: E402
from google.cloud.firestore_v1.base_query import FieldFilter  # noqa: E402

LOCK_PORT = 47631        # one watcher per computer: the second one to start just exits


def log(msg):
    stamp = dt.datetime.now(push.VN).strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{stamp}] {msg}"
    print(line, flush=True)
    try:
        os.makedirs(os.path.join(push.HOME, "logs"), exist_ok=True)
        with open(os.path.join(push.HOME, "logs", "announce.log"), "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


@firestore.transactional
def _claim(tx, ref):
    snap = ref.get(transaction=tx)
    if not snap.exists or (snap.to_dict() or {}).get("status") != "pending":
        return False
    tx.update(ref, {"status": "sending", "claimedAt": firestore.SERVER_TIMESTAMP})
    return True


def send_pending(db, key, dry=False, say=log):
    """Send every pending announcement. Returns how many went out."""
    waiting = list(db.collection("announcements").where(filter=FieldFilter("status", "==", "pending")).stream())
    if not waiting:
        return 0
    members, by_key, subs = push.load(db)
    n = 0
    for d in sorted(waiting, key=lambda d: str((d.to_dict() or {}).get("createdAt") or "")):
        a = d.to_dict() or {}
        text = " ".join(str(a.get("text") or "").split())[:300]
        by = a.get("by") or ""
        if not text:
            continue
        if not dry and not _claim(db.transaction(), d.reference):
            continue                                    # somebody else got it first
        name = by_key.get(by, {}).get("name") or a.get("byName") or "Chạm HQ"
        P = push.Pusher(db, key, dry)
        people = 0
        for who, s in subs.items():
            if who == by:
                continue                                # you don't need your own message
            if P.send(s, "📣 " + name, text, url="./#updates", tag="announce-" + d.id, urgent=True):
                people += 1
        say(f"announcement from {name} -> {people} people ({P.sent} devices, {P.failed} failed): {text[:60]}")
        if not dry:
            d.reference.update({"status": "sent", "sentAt": firestore.SERVER_TIMESTAMP,
                                "sentTo": people, "devices": P.sent, "failed": P.failed})
        n += 1
    return n


def watch(db, key):
    try:
        lock = socket.socket(socket.AF_INET, socket.SOCK_STREAM)
        lock.bind(("127.0.0.1", LOCK_PORT))
        lock.listen(1)
    except OSError:
        log("another watcher is already running - leaving it to that one")
        return

    wake = threading.Event()
    q = db.collection("announcements").where(filter=FieldFilter("status", "==", "pending"))
    listener = None
    last_ok = 0.0
    log("watching for announcements")
    while True:
        if listener is None:
            try:
                listener = q.on_snapshot(lambda docs, changes, t: wake.set())
            except Exception as e:
                log(f"could not listen ({type(e).__name__}: {e}); retrying in a minute")
                time.sleep(60)
                continue
        wake.wait(timeout=300)                          # a change, or a routine five-minute check
        wake.clear()
        try:
            send_pending(db, key)
            last_ok = time.time()
        except Exception:
            log("send failed:\n" + traceback.format_exc())
            try:
                listener.unsubscribe()
            except Exception:
                pass
            listener = None                             # rebuild the listener next time round
            time.sleep(20)
        if time.time() - last_ok > 1800 and listener is not None:
            try:
                listener.unsubscribe()                  # nothing has worked for half an hour: start clean
            except Exception:
                pass
            listener = None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--watch", action="store_true")
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()
    db, key = push.firebase(), push.vapid_key()
    if db is None or key is None:
        log("not set up - missing the service account or the push key. Doing nothing.")
        return
    if args.watch:
        watch(db, key)
    else:
        n = send_pending(db, key, args.dry_run)
        log(f"{n} announcement(s) sent" if n else "nothing waiting")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception:
        log("CRASHED:\n" + traceback.format_exc())
        sys.exit(1)

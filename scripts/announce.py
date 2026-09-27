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

A nudge (an admin tapping Nudge on somebody's job) is the same thing with
a "to": it goes to that one person only, as "👉 Bach nudged you". A "test"
is anybody pressing "Send me a test": it goes to every device of theirs,
and sentTo says how many, so the site can tell them. A "poll" is an admin
asking a quick question on the Updates tab: it goes to everyone but them,
as "📊 Bach asks", and opens the Updates tab where they vote.

A message is claimed in a transaction before sending, so two senders
running at once can never push the same announcement twice.

The group chat: when an admin approves the 9pm wrap with "Also post to the
group chat" ticked, the site files a short version in /outbox. On the
computer where the Instagram bot is signed in (ig_wrap.py --login), this
posts it with ig_send.py - once, claimed the same way - and marks it sent
or failed. Other computers, and GitHub, leave it alone.
"""

import argparse
import datetime as dt
import os
import socket
import subprocess
import sys
import tempfile
import threading
import time
import traceback

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import push  # noqa: E402  (same folder: firebase(), vapid_key(), load(), Pusher)
import status  # noqa: E402

from google.cloud import firestore  # noqa: E402
from google.cloud.firestore_v1.base_query import FieldFilter  # noqa: E402

LOCK_PORT = 47631        # one watcher per computer: the second one to start just exits
IG_READY = os.path.join(push.HOME, "ig-signed-in")     # written by ig_wrap.py --login
IG_SEND = os.path.join(os.path.dirname(os.path.abspath(__file__)), "ig_send.py")
# what ig_send.py's exit codes mean, in words for the site
IG_FAIL = {2: "the Instagram bot is signed out - run ig_wrap.py --login",
           3: "couldn't find the message box (Instagram may have changed)",
           4: "pressed send but couldn't confirm it arrived - check the chat before trying again"}


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
        to = a.get("to")
        if a.get("kind") == "test" and to:
            if to in subs:
                P.send(subs[to], "🔔 Test from Chạm HQ", "It works — this device will get announcements, nudges and reminders.",
                       url="./", tag="test-" + d.id, urgent=True)
            people = P.sent                             # for a test: how many of their devices got it
            say(f"test for {to}: {P.sent} device(s)")
        elif a.get("kind") == "nudge" and to:
            if to in subs and P.send(subs[to], "👉 " + name + " nudged you", text,
                                     url="./#tasks", tag="nudge-" + d.id, urgent=True):
                people = 1
            say(f"nudge from {name} -> {to}: {'delivered' if people else 'NOT delivered (notifications off)'}: {text[:60]}")
        else:
            poll = a.get("kind") == "poll"
            title = ("📊 " + name + " asks") if poll else ("📣 " + name)
            body = (text + " Tap to answer.")[:300] if poll else text
            for who, s in subs.items():
                if who == by:
                    continue                            # you don't need your own message
                if P.send(s, title, body, url="./#updates", tag=("poll-" if poll else "announce-") + d.id, urgent=True):
                    people += 1
            say(f"{'poll' if poll else 'announcement'} from {name} -> {people} people ({P.sent} devices, {P.failed} failed): {text[:60]}")
        if not dry:
            d.reference.update({"status": "sent", "sentAt": firestore.SERVER_TIMESTAMP,
                                "sentTo": people, "devices": P.sent, "failed": P.failed})
        n += 1
    return n


def can_post_to_chat():
    """Only the computer with the Instagram bot signed in posts to the chat."""
    return os.path.exists(IG_READY)


def ig_send(text):
    """Run ig_send.py on this text. Returns (ok, message). It sends at most
    once and never retries; a message already in the chat counts as sent."""
    fd, path = tempfile.mkstemp(suffix=".txt", prefix="cham-chat-")
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as f:
            f.write(text)
        flags = subprocess.CREATE_NO_WINDOW if os.name == "nt" else 0
        env = dict(os.environ, PYTHONIOENCODING="utf-8")
        try:
            r = subprocess.run([sys.executable, IG_SEND, "--file", path], capture_output=True, text=True,
                               encoding="utf-8", errors="replace", timeout=240, creationflags=flags, env=env)
        except subprocess.TimeoutExpired:
            return False, "timed out after 4 minutes - check the chat before trying again"
        out = (r.stdout or "").strip().splitlines()
        if r.returncode == 0:
            return True, "already in the chat" if any("already in the chat" in x for x in out) else "sent"
        return False, IG_FAIL.get(r.returncode, "crashed (" + ((r.stderr or "").strip().splitlines() or ["?"])[-1][:100] + ")")
    finally:
        try:
            os.remove(path)
        except OSError:
            pass


def send_outbox(db, dry=False, say=log, send=ig_send):
    """Post every group chat message waiting in /outbox. Returns how many went."""
    if not can_post_to_chat():
        return 0
    # one claimed but never finished (the computer went off mid-send): say so, don't guess
    for d in db.collection("outbox").where(filter=FieldFilter("status", "==", "sending")).stream():
        at = (d.to_dict() or {}).get("claimedAt")
        if at and (dt.datetime.now(dt.timezone.utc) - at).total_seconds() > 900 and not dry:
            d.reference.update({"status": "failed", "error": "the sender stopped halfway - check the chat before trying again"})
    waiting = list(db.collection("outbox").where(filter=FieldFilter("status", "==", "pending")).stream())
    n = 0
    for d in sorted(waiting, key=lambda d: str((d.to_dict() or {}).get("createdAt") or "")):
        m = d.to_dict() or {}
        text = str(m.get("text") or "").strip()[:1000]
        if not text:
            continue
        if dry:
            say(f"[dry] would post to the group chat: {text.splitlines()[0][:60]}")
            continue
        if not _claim(db.transaction(), d.reference):
            continue                                    # the other computer got it first
        say(f"group chat: posting {d.id}")
        ok, why = send(text)
        if ok:
            d.reference.update({"status": "sent", "sentAt": firestore.SERVER_TIMESTAMP, "error": ""})
            n += 1
        else:
            d.reference.update({"status": "failed", "failedAt": firestore.SERVER_TIMESTAMP, "error": why})
        say(f"group chat: {d.id} {'sent' if ok else 'FAILED'} ({why})")
        status.beat("groupchat", ok, ("posted " + (m.get("date") or "")) if ok else why, db)
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
    oq = db.collection("outbox").where(filter=FieldFilter("status", "==", "pending"))
    listener = None
    outbox = None
    last_ok = 0.0
    log("watching for announcements" + (" and group chat posts" if can_post_to_chat() else ""))

    def stop_listening():
        for x in (listener, outbox):
            try:
                if x is not None:
                    x.unsubscribe()
            except Exception:
                pass

    while True:
        if listener is None:
            try:
                listener = q.on_snapshot(lambda docs, changes, t: wake.set())
                outbox = oq.on_snapshot(lambda docs, changes, t: wake.set()) if can_post_to_chat() else None
            except Exception as e:
                log(f"could not listen ({type(e).__name__}: {e}); retrying in a minute")
                stop_listening()
                listener = outbox = None
                time.sleep(60)
                continue
        wake.wait(timeout=300)                          # a change, or a routine five-minute check
        wake.clear()
        try:
            send_pending(db, key)
            last_ok = time.time()
            status.beat("announce", True, "watching", db)
        except Exception:
            log("send failed:\n" + traceback.format_exc())
            stop_listening()
            listener = outbox = None                    # rebuild the listeners next time round
            time.sleep(20)
        try:
            send_outbox(db)                             # does nothing unless the Instagram bot lives here
        except Exception:
            log("group chat post failed:\n" + traceback.format_exc())
        if time.time() - last_ok > 1800 and listener is not None:
            stop_listening()                            # nothing has worked for half an hour: start clean
            listener = outbox = None


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
        if can_post_to_chat():
            g = send_outbox(db, args.dry_run)
            if g:
                log(f"{g} group chat message(s) posted")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        pass
    except Exception:
        log("CRASHED:\n" + traceback.format_exc())
        sys.exit(1)

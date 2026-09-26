#!/usr/bin/env python3
"""
Chạm HQ - push notifications to people's phones and computers.

Runs every fifteen minutes. Each run looks at what has changed since the
last one and tells the right people, once:

  new job            -> the person it was given to
  somebody stuck     -> the admins
  money to log       -> finance, when new lines pile up for the sheet
  7am                -> anyone with something overdue, due today or tomorrow
  9pm                -> everyone: a round-up of what the club got done today
  announcements      -> everyone: anything an admin typed into the Announce
                        box that the always-on watcher (announce.py) missed
  Monday morning     -> everyone: Judy's weekly report - officer of the
                        week, who is most behind, what is due this week

    python scripts/push.py              the real thing
    python scripts/push.py --dry-run    print what would go out, send nothing
    python scripts/push.py --test EMAIL send one test notification to that person

Secrets, looked for in this order:
  service account   FIREBASE_SERVICE_ACCOUNT env, else ~/.cham-hq/firebase-key.json
  push signing key  VAPID_PRIVATE_KEY env, else ~/.cham-hq/vapid.json

Deliberate choices:
  - The first ever run marks everything that already exists as told, so
    switching this on does not fire a burst about old jobs.
  - A dead subscription (phone reset, app deleted) is removed the first time
    the push service says it is gone, so nobody is retried forever.
  - Nothing is ever pushed to anyone not in /members.
"""

import argparse
import datetime as dt
import json
import os
import sys
import traceback

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from google.oauth2 import service_account

HOME = os.path.join(os.path.expanduser("~"), ".cham-hq")
SITE = "https://peterachss.github.io/cham-hq/"
VN = dt.timezone(dt.timedelta(hours=7))        # Vietnam has no daylight saving
MORNING = range(7, 11)                         # 07:00 to 10:59, once
EVENING = range(21, 24)                        # 21:00 to 23:59, once
SUBJECT = "mailto:cham.dreams1703@gmail.com"


def log(msg):
    stamp = dt.datetime.now(VN).strftime("%Y-%m-%d %H:%M")
    line = f"[{stamp}] {msg}"
    print(line, flush=True)
    try:
        os.makedirs(os.path.join(HOME, "logs"), exist_ok=True)
        with open(os.path.join(HOME, "logs", "push.log"), "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


# ------------------------------------------------------------------ secrets
def firebase():
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
    if not raw:
        path = os.path.join(HOME, "firebase-key.json")
        if not os.path.exists(path):
            return None
        with open(path, encoding="utf-8-sig") as f:
            raw = f.read()
    info = json.loads(raw)
    return firestore.Client(project=info["project_id"],
                            credentials=service_account.Credentials.from_service_account_info(info))


def vapid_key():
    k = os.environ.get("VAPID_PRIVATE_KEY", "").strip()
    if k:
        return k
    path = os.path.join(HOME, "vapid.json")
    if os.path.exists(path):
        with open(path, encoding="utf-8-sig") as f:
            return json.load(f)["private_raw_b64url"]
    return None


# ------------------------------------------------------------------ sending
class Pusher:
    def __init__(self, db, key, dry):
        self.db, self.key, self.dry = db, key, dry
        self.sent = self.gone = self.failed = 0

    def send(self, subs, title, body, url="./", tag=None, urgent=False):
        """to every device one person has. Returns True if any got through."""
        from pywebpush import webpush, WebPushException
        payload = json.dumps({"title": title, "body": body, "url": url, "tag": tag})
        ok = False
        for s in subs:
            if self.dry:
                log(f"    [dry] {s['email']} ({s.get('device') or 'device'}): {title} - {body[:70]}")
                self.sent += 1
                ok = True
                continue
            try:
                webpush(
                    subscription_info={"endpoint": s["endpoint"], "keys": s["keys"]},
                    data=payload,
                    vapid_private_key=self.key,
                    vapid_claims={"sub": SUBJECT},
                    ttl=24 * 3600,
                    headers={"Urgency": "high" if urgent else "normal"},
                )
                self.sent += 1
                ok = True
            except WebPushException as e:
                code = getattr(e.response, "status_code", None)
                if code in (404, 410):
                    # the phone forgot us - stop trying
                    self.db.collection("pushSubs").document(s["_id"]).delete()
                    self.gone += 1
                    log(f"    removed a dead subscription for {s['email']}")
                else:
                    self.failed += 1
                    log(f"    FAILED {s['email']}: {code} {str(e)[:120]}")
            except Exception as e:
                self.failed += 1
                log(f"    FAILED {s['email']}: {type(e).__name__}: {str(e)[:120]}")
        return ok


# ------------------------------------------------------------------ helpers
def fmt_vnd(n):
    return f"{int(round(n)):,} ₫"


def short(text, n):
    text = " ".join(str(text).split())
    return text if len(text) <= n else text[: n - 1].rstrip() + "…"


def load(db):
    members = {}
    for d in db.collection("members").stream():
        m = d.to_dict() or {}
        key = (m.get("personKey") or "").strip()
        if key:
            members[d.id] = {"email": d.id, "key": key, "name": m.get("name") or key.title(),
                             "admin": m.get("admin") is True, "finance": m.get("finance") is True}
    by_key = {m["key"]: m for m in members.values()}

    subs = {}
    for d in db.collection("pushSubs").stream():
        s = d.to_dict() or {}
        email = (s.get("email") or "").lower()
        if email in members and s.get("endpoint") and s.get("keys"):
            s["_id"] = d.id
            subs.setdefault(members[email]["key"], []).append(s)
    return members, by_key, subs


# ------------------------------------------------------------------ the jobs
def assignments(db, P, by_key, subs):
    for d in db.collection("tasks").stream():
        t = d.to_dict() or {}
        who = t.get("who")
        if not who or t.get("status") == "done" or t.get("pushedWho") == who:
            continue
        if who in subs:
            due = t.get("due")
            body = short(t.get("title", "A new job"), 110) + (f" — due {pretty(due)}" if due else "")
            log(f"  new job -> {who}: {t.get('title', '')[:50]}")
            if P.send(subs[who], "You’ve got a new job", body, url="./#tasks", tag="task-" + d.id, urgent=True) or P.dry:
                if not P.dry:
                    d.reference.update({"pushedWho": who})
        else:
            # they have no device registered; nothing to send, but don't queue it forever
            if not P.dry:
                d.reference.update({"pushedWho": who})


def stuck(db, P, by_key, subs):
    admins = [m for m in by_key.values() if m["admin"]]
    for d in db.collection("tasks").stream():
        t = d.to_dict() or {}
        is_stuck = t.get("status") == "blocked"
        if not is_stuck:
            if t.get("pushedStuck") and not P.dry:
                d.reference.update({"pushedStuck": False})     # so a later stick re-notifies
            continue
        if t.get("pushedStuck"):
            continue
        owner = by_key.get(t.get("who"), {}).get("name", t.get("who", "Someone"))
        body = short(f"{owner} is stuck on: {t.get('title', '')}" + (f" — {t['note']}" if t.get("note") else ""), 170)
        log(f"  stuck -> admins: {body[:60]}")
        for a in admins:
            if a["key"] != t.get("who") and a["key"] in subs:
                P.send(subs[a["key"]], "Someone’s stuck", body, url="./#tasks", tag="stuck-" + d.id, urgent=True)
        if not P.dry:
            d.reference.update({"pushedStuck": True})


def drafts(db, P, by_key, subs):
    """Tonight's chat wrap is sitting in review: tell whoever approves it."""
    admins = [m for m in by_key.values() if m["admin"]]
    for d in db.collection("chatDrafts").where(filter=FieldFilter("status", "==", "pending")).stream():
        v = d.to_dict() or {}
        if v.get("pushed"):
            continue
        lines = v.get("lines") or []
        kept = sum(1 for l in lines if l.get("keep", True))
        body = f"{kept} line{'s' if kept != 1 else ''} worth keeping from {len(lines)} read. Tap to look before it goes up."
        log(f"  chat wrap ready -> admins: {body}")
        for a in admins:
            if a["key"] in subs:
                P.send(subs[a["key"]], "Tonight’s chat wrap is ready", body, url="./#updates", tag="chatwrap-" + d.id)
        if not P.dry:
            d.reference.update({"pushed": True})


def finance(db, P, by_key, subs, meta):
    pending = [d.to_dict() for d in db.collection("expenses").where(filter=FieldFilter("status", "==", "new")).stream()]
    n = len(pending)
    last = int(meta.get("financeNotified", 0))
    if n <= last:
        if n < last and not P.dry:
            meta["financeNotified"] = n        # Thuan cleared some; start counting again from here
        return
    total = sum(p.get("amount", 0) for p in pending if p.get("kind") == "out")
    body = f"{n} line{'s' if n != 1 else ''} to copy into the finance sheet" + (f" ({fmt_vnd(total)} out)" if total else "")
    log(f"  finance: {body}")
    for m in by_key.values():
        if m["finance"] and m["key"] in subs:
            P.send(subs[m["key"]], "Money waiting for the sheet", body, url="./#money", tag="finance")
    if not P.dry:
        meta["financeNotified"] = n


def pretty(iso):
    try:
        d = dt.date.fromisoformat(iso)
    except (TypeError, ValueError):
        return iso or ""
    return f"{d:%a} {d.day} {d:%b}"


def morning(db, P, by_key, subs, meta, today):
    if meta.get("morningDate") == today.isoformat():
        return
    tomorrow = today + dt.timedelta(days=1)
    per = {}
    for d in db.collection("tasks").stream():
        t = d.to_dict() or {}
        if t.get("status") == "done" or not t.get("due") or not t.get("who"):
            continue
        try:
            due = dt.date.fromisoformat(t["due"])
        except ValueError:
            continue
        b = per.setdefault(t["who"], {"late": [], "today": [], "tomorrow": []})
        if due < today:
            b["late"].append(t)
        elif due == today:
            b["today"].append(t)
        elif due == tomorrow:
            b["tomorrow"].append(t)

    log(f"  morning: {len(per)} people with dated work")
    for who, b in per.items():
        if who not in subs or not (b["late"] or b["today"] or b["tomorrow"]):
            continue
        bits = []
        if b["late"]:
            bits.append(f"{len(b['late'])} overdue")
        if b["today"]:
            bits.append(f"{len(b['today'])} due today")
        if b["tomorrow"]:
            bits.append(f"{len(b['tomorrow'])} due tomorrow")
        first = (b["late"] or b["today"] or b["tomorrow"])[0]
        body = short(" · ".join(bits) + f" — {first.get('title', '')}", 170)
        P.send(subs[who], "Morning — what’s due", body, url="./#tasks", tag="morning")
    if not P.dry:
        meta["morningDate"] = today.isoformat()


def evening(db, P, by_key, subs, meta, today):
    """The day in one notification - built from the feed the site writes
    itself, so it says what actually happened, not what was said."""
    if meta.get("eveningDate") == today.isoformat():
        return
    iso = today.isoformat()
    lines = [d.to_dict() for d in db.collection("updates").where(filter=FieldFilter("date", "==", iso)).stream()]
    if not lines:
        log("  evening: nothing happened today, no round-up")
        if not P.dry:
            meta["eveningDate"] = iso
        return

    name = lambda k: by_key.get(k, {}).get("name", k)
    done = [l for l in lines if l.get("event") == "done"]
    stuck_ = [l for l in lines if l.get("event") == "stuck"]
    given = [l for l in lines if l.get("event") == "assign"]
    photos = [l for l in lines if l.get("event") == "photos"]
    money = [l for l in lines if l.get("event") == "money"]
    posts = [l for l in lines if not l.get("auto")]

    parts = []
    if done:
        who = sorted({name(l["who"]) for l in done})
        parts.append(f"{len(done)} job{'s' if len(done) != 1 else ''} finished ({', '.join(who[:3])}{'…' if len(who) > 3 else ''})")
    if stuck_:
        parts.append(f"{len(stuck_)} stuck")
    if given:
        parts.append(f"{len(given)} new job{'s' if len(given) != 1 else ''} handed out")
    if money:
        parts.append(f"{len(money)} money entr{'ies' if len(money) != 1 else 'y'}")
    if photos:
        parts.append("photos added")
    if posts:
        parts.append(f"{len(posts)} update{'s' if len(posts) != 1 else ''} posted")

    body = short("Today: " + "; ".join(parts) + ".", 175)
    log(f"  evening round-up: {body}")
    for who, s in subs.items():
        P.send(s, "Chạm today", body, url="./", tag="evening")
    if not P.dry:
        meta["eveningDate"] = iso


# Same rules as the Points chart in app.js - change one, change both.
PTS = {"on_time": 10, "no_date": 5, "late": 3, "overdue": -5}


def done_day(t):
    ts = t.get("doneAt")
    try:
        return ts.astimezone(VN).date() if ts else None
    except (AttributeError, ValueError):
        return None


def job_points(t, today):
    due = None
    try:
        due = dt.date.fromisoformat(t["due"]) if t.get("due") else None
    except ValueError:
        pass
    if t.get("status") != "done":
        return PTS["overdue"] if due and due < today else 0
    d = done_day(t)
    if not due or not d:
        return PTS["no_date"]
    return PTS["on_time"] if d <= due else PTS["late"]


def weekly(db, P, by_key, subs, meta, today):
    """Monday: Judy's report. Officer of the week, who's most behind, and
    what the week holds - with each person's own count on the end."""
    week = today.isocalendar()
    tag = f"{week[0]}-W{week[1]:02d}"
    if meta.get("weeklyDate") == tag:
        return
    mon = today - dt.timedelta(days=today.weekday())
    last_mon, sun = mon - dt.timedelta(days=7), mon + dt.timedelta(days=6)

    tasks = [d.to_dict() or {} for d in db.collection("tasks").stream()]
    active = {k for k, m in by_key.items()}
    last_week, late, due_week, mine = {}, {}, 0, {}
    for t in tasks:
        who = t.get("who")
        if t.get("status") == "done":
            d = done_day(t)
            if who in active and d and last_mon <= d < mon:
                last_week[who] = last_week.get(who, 0) + job_points(t, today)
            continue
        try:
            due = dt.date.fromisoformat(t["due"]) if t.get("due") else None
        except ValueError:
            due = None
        if not due:
            continue
        if due < today and who in active:
            late[who] = late.get(who, 0) + 1
        elif today <= due <= sun:
            due_week += 1
            mine[who] = mine.get(who, 0) + 1

    name = lambda k: by_key.get(k, {}).get("name", k)
    both = lambda ks: " & ".join(name(k) for k in ks)
    parts = []
    top = max(last_week.values(), default=0)
    if top > 0:
        parts.append(f"👮 Officer of the week: {both([k for k, v in last_week.items() if v == top])} ({top} pts).")
    else:
        parts.append("👮 No officer this week — nobody finished a job last week.")
    most = max(late.values(), default=0)
    if most:
        parts.append(f"🐌 Most late: {both([k for k, v in late.items() if v == most])} ({most}).")
    else:
        parts.append("Nobody’s late. Suspicious.")
    parts.append(f"This week: {due_week} job{'s' if due_week != 1 else ''} due")
    common = " ".join(parts)

    log(f"  monday report: {common}")
    for who, s in subs.items():
        n = mine.get(who, 0)
        body = short(common + (f", {n} yours." if n else ", none yours."), 178)
        P.send(s, "Judy’s Monday report", body, url="./#tracker", tag="weekly")
    if not P.dry:
        meta["weeklyDate"] = tag


def initialise(db, meta, dry):
    """First run ever: everything that already exists counts as told."""
    n = 0
    for d in db.collection("tasks").stream():
        t = d.to_dict() or {}
        patch = {}
        if t.get("who") and t.get("pushedWho") != t.get("who"):
            patch["pushedWho"] = t["who"]
        if t.get("status") == "blocked" and not t.get("pushedStuck"):
            patch["pushedStuck"] = True
        if patch and not dry:
            d.reference.update(patch)
        n += bool(patch)
    pending = len(list(db.collection("expenses").where(filter=FieldFilter("status", "==", "new")).stream()))
    meta["financeNotified"] = pending
    meta["initialised"] = True
    log(f"first run: {n} existing job(s) and {pending} money line(s) counted as already told")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--test", metavar="EMAIL")
    ap.add_argument("--weekly-now", action="store_true", help="build the Monday report today (use with --dry-run to preview)")
    args = ap.parse_args()

    db = firebase()
    key = vapid_key()
    if db is None or key is None:
        log("not set up - missing " + ("the service account" if db is None else "the push signing key")
            + ". Doing nothing, on purpose.")
        return

    members, by_key, subs = load(db)
    P = Pusher(db, key, args.dry_run)

    if args.test:
        m = members.get(args.test.lower())
        if not m:
            sys.exit(f"{args.test} is not in /members")
        if m["key"] not in subs:
            sys.exit(f"{m['name']} has no device with notifications turned on yet")
        P.send(subs[m["key"]], "Test from Chạm HQ", "If you can read this, notifications work on this device.",
               url="./", tag="test", urgent=True)
        log(f"test: {P.sent} sent, {P.gone} dead, {P.failed} failed")
        return

    meta_ref = db.collection("meta").document("push")
    meta = meta_ref.get().to_dict() or {}
    if not meta.get("initialised"):
        initialise(db, meta, args.dry_run)
        if not args.dry_run:
            meta_ref.set(meta)
        return

    now = dt.datetime.now(VN)
    today = now.date()
    log(f"run: {sum(len(v) for v in subs.values())} device(s) across {len(subs)} people")

    assignments(db, P, by_key, subs)
    stuck(db, P, by_key, subs)
    finance(db, P, by_key, subs, meta)
    drafts(db, P, by_key, subs)
    try:
        import announce
        announce.send_pending(db, key, args.dry_run, say=log)
    except Exception as e:
        log(f"  announcements: {type(e).__name__}: {e}")
    if now.hour in MORNING:
        morning(db, P, by_key, subs, meta, today)
        if today.weekday() == 0 or args.weekly_now:
            weekly(db, P, by_key, subs, meta, today)
    elif args.weekly_now:
        weekly(db, P, by_key, subs, meta, today)
    if now.hour in EVENING:
        evening(db, P, by_key, subs, meta, today)

    if not args.dry_run:
        meta_ref.set(meta)
    log(f"done: {P.sent} sent, {P.gone} dead removed, {P.failed} failed")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        log("CRASHED:\n" + traceback.format_exc())
        sys.exit(1)

#!/usr/bin/env python3
"""
Chạm HQ - the email notifier.

Two jobs, both run from GitHub Actions:

  1. Handed out a job?  The person gets an email within the hour.
  2. Every morning at 7am Vietnam, anyone with something overdue or due
     inside a week gets one short digest. A clean slate gets nothing.

    python scripts/notify.py                 assignments only
    python scripts/notify.py --digest        assignments + the morning digest
    python scripts/notify.py --dry-run       print, send nothing, mark nothing
    python scripts/notify.py --catch-up      mark everything already handed out as
                                             announced, WITHOUT emailing - run this
                                             once when switching the emails on, so
                                             nobody gets a pile about old jobs

Needs three repository secrets:
    FIREBASE_SERVICE_ACCOUNT   the service account JSON, pasted whole
    GMAIL_USER                 the address the mail is sent from
    GMAIL_APP_PASSWORD         a Google app password for that address

Deliberate choices:
  - A task is marked notified only after its email actually goes out, so a
    crash mid-run repeats at most one message rather than losing it.
  - Reassigning a job re-notifies the new owner, because the old owner's
    email is no use to them.
  - Nothing is ever sent to somebody who is not in /members.
"""

import argparse
import datetime as dt
import json
import os
import smtplib
import sys
import traceback
from email.message import EmailMessage

from google.cloud import firestore
from google.oauth2 import service_account

SITE = "https://peterachss.github.io/cham-hq/"
HORIZON = 7  # days ahead the digest warns about


def env(name):
    v = os.environ.get(name, "").strip()
    if not v:
        sys.exit(f"Missing secret: {name}")
    return v


def db_client():
    info = json.loads(env("FIREBASE_SERVICE_ACCOUNT"))
    return firestore.Client(
        project=info["project_id"],
        credentials=service_account.Credentials.from_service_account_info(info),
    )


def pretty(iso):
    try:
        d = dt.date.fromisoformat(iso)
    except (TypeError, ValueError):
        return iso or ""
    return f"{d:%a} {d.day} {d:%b}"


def members(db):
    """personKey -> {email, name}. Anyone not in here simply never gets mail."""
    out = {}
    for doc in db.collection("members").stream():
        d = doc.to_dict() or {}
        key = (d.get("personKey") or "").strip()
        if key:
            out[key] = {"email": doc.id, "name": d.get("name") or key.title()}
    return out


class Mailer:
    """Opens the connection only if there is something to send."""

    def __init__(self, dry):
        self.dry = dry
        self.smtp = None
        self.sent = 0

    def __enter__(self):
        return self

    def _connect(self):
        if self.smtp is None and not self.dry:
            self.user = env("GMAIL_USER")
            self.smtp = smtplib.SMTP_SSL("smtp.gmail.com", 465)
            self.smtp.login(self.user, env("GMAIL_APP_PASSWORD"))

    def send(self, to, subject, body):
        if self.dry:
            print(f"    [dry] -> {to}: {subject}")
            self.sent += 1
            return True
        try:
            self._connect()
            m = EmailMessage()
            m["Subject"] = subject
            m["From"] = f"Chạm HQ <{self.user}>"
            m["To"] = to
            m.set_content(body)
            self.smtp.send_message(m)
            self.sent += 1
            print(f"    sent -> {to}: {subject}")
            return True
        except Exception as e:
            print(f"    FAILED -> {to}: {type(e).__name__}: {e}")
            return False

    def __exit__(self, *a):
        if self.smtp:
            try:
                self.smtp.quit()
            except Exception:
                pass


# ---------------------------------------------------------------- assignments
def catch_up(db, dry):
    """Switching this on for the first time should not dump a dozen emails
    about jobs everybody already knows about. This marks them as announced
    and sends nothing; from then on only genuinely new ones go out."""
    n = 0
    for doc in db.collection("tasks").stream():
        t = doc.to_dict() or {}
        owner = t.get("who")
        if owner and t.get("notifiedWho") != owner:
            if not dry:
                doc.reference.update({"notifiedWho": owner})
            n += 1
    print(f"catch-up: {n} existing job(s) marked as already announced"
          + (" (dry run, nothing written)" if dry else ""))


def assignments(db, who, mail, dry):
    """Anything handed out and not yet announced to its current owner."""
    pending = []
    for doc in db.collection("tasks").stream():
        t = doc.to_dict() or {}
        owner = t.get("who")
        if not owner or t.get("status") == "done":
            continue
        # re-announce if it changed hands since the last notice
        if t.get("notifiedWho") == owner:
            continue
        if t.get("createdBy") == "import":
            # the original 29 were already everyone's known workload
            doc.reference.update({"notifiedWho": owner})
            continue
        pending.append((doc, t, owner))

    if not pending:
        print("assignments: nothing new")
        return

    print(f"assignments: {len(pending)} to announce")
    for doc, t, owner in pending:
        m = who.get(owner)
        if not m:
            print(f"    skipped '{(t.get('title') or '')[:40]}' - {owner} is not in /members")
            continue

        due = t.get("due")
        lines = [
            f"Hi {m['name']},",
            "",
            "You have been given a job on Chạm HQ:",
            "",
            f"    {t.get('title', '(no title)')}",
        ]
        if t.get("note"):
            lines.append(f"    {t['note']}")
        lines += [
            "",
            f"Due {pretty(due)}." if due else "No due date on it yet.",
            "",
            "Tick it off, or say how far along you are, here:",
            SITE,
        ]
        if mail.send(m["email"], "Chạm: " + (t.get("title") or "a new job"), "\n".join(lines)):
            if not dry:
                doc.reference.update({"notifiedWho": owner})


# --------------------------------------------------------------------- digest
def digest(db, who, mail):
    today = dt.date.today()
    limit = today + dt.timedelta(days=HORIZON)
    buckets = {}

    for doc in db.collection("tasks").stream():
        t = doc.to_dict() or {}
        if t.get("status") == "done" or not t.get("due") or not t.get("who"):
            continue
        try:
            d = dt.date.fromisoformat(t["due"])
        except (TypeError, ValueError):
            continue
        if t["who"] not in who:
            continue
        b = buckets.setdefault(t["who"], {"overdue": [], "soon": []})
        if d < today:
            b["overdue"].append(t)
        elif d <= limit:
            b["soon"].append(t)

    if not buckets:
        print("digest: nothing due and nothing overdue")
        return

    print(f"digest: {len(buckets)} people to write to")
    for key, b in sorted(buckets.items()):
        m = who[key]
        b["overdue"].sort(key=lambda t: t["due"])
        b["soon"].sort(key=lambda t: t["due"])

        lines = [f"Morning {m['name']},", ""]
        if b["overdue"]:
            lines.append(f"PAST ITS DATE ({len(b['overdue'])})")
            for t in b["overdue"]:
                n = (today - dt.date.fromisoformat(t["due"])).days
                ago = "today" if n == 0 else f"{n} day{'s' if n != 1 else ''} ago"
                lines.append(f"  - {t['title']}  (was due {pretty(t['due'])}, {ago})")
            lines.append("")
        if b["soon"]:
            lines.append(f"COMING UP ({len(b['soon'])})")
            for t in b["soon"]:
                n = (dt.date.fromisoformat(t["due"]) - today).days
                when = "today" if n == 0 else ("tomorrow" if n == 1 else f"in {n} days")
                lines.append(f"  - {t['title']}  (due {pretty(t['due'])}, {when})")
            lines.append("")
        lines += ["Tick anything off here:", SITE, "",
                  "If something on this list is wrong, say so in the group chat."]

        bits = []
        if b["overdue"]:
            bits.append(f"{len(b['overdue'])} overdue")
        if b["soon"]:
            bits.append(f"{len(b['soon'])} coming up")
        mail.send(m["email"], "Chạm: " + " and ".join(bits), "\n".join(lines))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--digest", action="store_true", help="also send the morning digest")
    ap.add_argument("--dry-run", action="store_true", help="print, send nothing, mark nothing")
    ap.add_argument("--catch-up", action="store_true",
                    help="mark everything already handed out as announced, without emailing")
    args = ap.parse_args()

    db = db_client()

    if args.catch_up:
        catch_up(db, args.dry_run)
        return

    who = members(db)
    print(f"{len(who)} members on the list")

    with Mailer(args.dry_run) as mail:
        assignments(db, who, mail, args.dry_run)
        if args.digest:
            digest(db, who, mail)
        print(f"done, {mail.sent} email(s)")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        traceback.print_exc()
        sys.exit(1)

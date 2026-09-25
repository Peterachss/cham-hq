#!/usr/bin/env python3
"""
Chạm HQ — the morning email.

Runs once a day from GitHub Actions. Reads the tasks out of Firestore and
sends each member one short email: what is overdue, and what is due in the
next week. Nobody with a clean slate gets an email at all.

Needs three secrets, set in the repo under Settings -> Secrets -> Actions:
  FIREBASE_SERVICE_ACCOUNT   the service account JSON, pasted whole
  GMAIL_USER                 the gmail address the mail is sent from
  GMAIL_APP_PASSWORD         a Google app password for that address
"""

import datetime as dt
import json
import os
import smtplib
import sys
from email.message import EmailMessage

from google.cloud import firestore
from google.oauth2 import service_account

SITE = "https://peterachss.github.io/cham-hq/"
HORIZON = 7  # days ahead to warn about


def env(name):
    v = os.environ.get(name, "").strip()
    if not v:
        sys.exit(f"Missing secret: {name}")
    return v


def client():
    info = json.loads(env("FIREBASE_SERVICE_ACCOUNT"))
    creds = service_account.Credentials.from_service_account_info(info)
    return firestore.Client(project=info["project_id"], credentials=creds)


def pretty(iso):
    try:
        d = dt.date.fromisoformat(iso)
    except (TypeError, ValueError):
        return iso or ""
    return d.strftime("%a %-d %b") if os.name != "nt" else d.strftime("%a %d %b")


def body_for(name, overdue, soon):
    lines = [f"Morning {name},", ""]

    if overdue:
        lines.append(f"PAST ITS DATE ({len(overdue)})")
        for t in overdue:
            days = (dt.date.today() - dt.date.fromisoformat(t["due"])).days
            ago = "today" if days == 0 else f"{days} day{'s' if days != 1 else ''} ago"
            lines.append(f"  - {t['title']}  (was due {pretty(t['due'])}, {ago})")
        lines.append("")

    if soon:
        lines.append(f"COMING UP ({len(soon)})")
        for t in soon:
            due = dt.date.fromisoformat(t["due"])
            n = (due - dt.date.today()).days
            when = "today" if n == 0 else ("tomorrow" if n == 1 else f"in {n} days")
            lines.append(f"  - {t['title']}  (due {pretty(t['due'])}, {when})")
        lines.append("")

    lines += [
        "Tick anything off here:",
        SITE,
        "",
        "If something on this list is wrong, say so in the group chat.",
    ]
    return "\n".join(lines)


def main():
    db = client()

    members = {}
    for doc in db.collection("members").stream():
        d = doc.to_dict() or {}
        if d.get("personKey"):
            members[d["personKey"]] = {
                "email": doc.id,
                "name": d.get("name") or d["personKey"].title(),
            }

    tasks = []
    for doc in db.collection("tasks").stream():
        d = doc.to_dict() or {}
        if d.get("status") != "done" and d.get("due") and d.get("who"):
            tasks.append(d)

    today = dt.date.today()
    limit = today + dt.timedelta(days=HORIZON)

    buckets = {}
    for t in tasks:
        try:
            due = dt.date.fromisoformat(t["due"])
        except (TypeError, ValueError):
            continue
        who = t["who"]
        if who not in members:
            continue
        b = buckets.setdefault(who, {"overdue": [], "soon": []})
        if due < today:
            b["overdue"].append(t)
        elif due <= limit:
            b["soon"].append(t)

    if not buckets:
        print("Nothing due and nothing overdue. No mail sent.")
        return

    user, password = env("GMAIL_USER"), env("GMAIL_APP_PASSWORD")
    sent = 0

    with smtplib.SMTP_SSL("smtp.gmail.com", 465) as smtp:
        smtp.login(user, password)
        for who, b in sorted(buckets.items()):
            b["overdue"].sort(key=lambda t: t["due"])
            b["soon"].sort(key=lambda t: t["due"])
            m = members[who]

            bits = []
            if b["overdue"]:
                bits.append(f"{len(b['overdue'])} overdue")
            if b["soon"]:
                bits.append(f"{len(b['soon'])} coming up")

            msg = EmailMessage()
            msg["Subject"] = "Chạm: " + " and ".join(bits)
            msg["From"] = f"Chạm HQ <{user}>"
            msg["To"] = m["email"]
            msg.set_content(body_for(m["name"], b["overdue"], b["soon"]))
            smtp.send_message(msg)
            sent += 1
            print(f"sent to {m['email']}: {' and '.join(bits)}")

    print(f"done, {sent} email(s)")


if __name__ == "__main__":
    main()

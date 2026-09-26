#!/usr/bin/env python3
"""
Chạm HQ - copy new money lines into Thuan's finance sheet, automatically.

Every line logged on the Money tab that is not in the sheet yet is appended
to the sheet's "Expenses" tab (money out) or "Income" tab (money in), in the
sheet's own column order, then marked as in the sheet on the site. The two
tabs are created, with headers, the first time.

    python scripts/sync_finance.py             do it
    python scripts/sync_finance.py --dry-run   show the rows, change nothing

It waits quietly, doing nothing, until two things are true - and says which
one is missing:
  1. The Google Sheets API is switched on for the cham-hq project
     https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=120151131910
  2. The sheet is shared, as Editor, with
     firebase-adminsdk-fbsvc@cham-hq.iam.gserviceaccount.com
     (Bach owns the sheet, so he is the one who can share it.)

Only whole rows are ever appended to those two tabs.

It also keeps Thuan's "Overall" tab up to date: one row per fundraiser,
with the cost in column D and the earnings in column F. Only those two
cells are ever written (plus the name in column B when a new fundraiser
gets the next empty row). The profit column is Thuan's formula, and so are
the totals, so they follow by themselves. A row is matched by its name in
column B; rows the site knows nothing about are left exactly as they are.
Teaching spending goes on the "Teaching tools" row, as Thuan has it.
"""

import argparse
import datetime as dt
import json
import os
import sys
import urllib.error
import urllib.parse
import urllib.request

from google.cloud import firestore
from google.cloud.firestore_v1.base_query import FieldFilter
from google.oauth2 import service_account
import google.auth.transport.requests as tr

SHEET = "1Ly4peYB07425kfvsy9yFMqFxoGE-jdc7YHqgoVhlHnc"
HOME = os.path.join(os.path.expanduser("~"), ".cham-hq")
VN = dt.timezone(dt.timedelta(hours=7))

TABS = {
    "out": ("Expenses", ["Date", "Category", "Description", "Amount", "Budget Line", "Notes",
                         "Paid by", "Method", "Owed back", "Logged by", "Chạm HQ id"]),
    "in":  ("Income",   ["Date", "Source", "Description", "Amount", "Budget Line", "Notes",
                         "Received by", "Method", "Logged by", "Chạm HQ id"]),
}
METHODS = {"cash": "Cash", "transfer": "Bank transfer", "momo": "MoMo", "card": "Card"}

OVERALL = "Overall "             # Thuan's tab name - it has a trailing space
OVERALL_ROWS = range(2, 40)      # the fundraiser rows; row 40 is the totals
TEACHING_ROW = "Teaching tools"  # where money spent on teaching goes
RUNNING_ROW = "Running costs"    # money out that belongs to no fundraiser
DONATION_ROW = "Donations"       # money in that belongs to no fundraiser


def log(msg):
    line = f"[{dt.datetime.now(VN):%Y-%m-%d %H:%M}] {msg}"
    print(line, flush=True)
    try:
        os.makedirs(os.path.join(HOME, "logs"), exist_ok=True)
        with open(os.path.join(HOME, "logs", "finance-sync.log"), "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except OSError:
        pass


def service_info():
    raw = os.environ.get("FIREBASE_SERVICE_ACCOUNT", "").strip()
    if not raw:
        path = os.path.join(HOME, "firebase-key.json")
        if not os.path.exists(path):
            return None
        with open(path, encoding="utf-8-sig") as f:
            raw = f.read()
    return json.loads(raw)


class Sheets:
    def __init__(self, info):
        c = service_account.Credentials.from_service_account_info(
            info, scopes=["https://www.googleapis.com/auth/spreadsheets"])
        c.refresh(tr.Request())
        self.token = c.token

    def call(self, method, path, body=None):
        url = f"https://sheets.googleapis.com/v4/spreadsheets/{SHEET}{path}"
        data = json.dumps(body).encode() if body is not None else None
        r = urllib.request.Request(url, data=data, method=method, headers={
            "Authorization": "Bearer " + self.token, "Content-Type": "application/json"})
        try:
            return 200, json.load(urllib.request.urlopen(r))
        except urllib.error.HTTPError as e:
            try:
                return e.code, json.loads(e.read() or b"{}")
            except Exception:
                return e.code, {}


def not_ready(code, res):
    msg = (res.get("error") or {}).get("message", "")
    if code == 403 and ("has not been used" in msg or "is disabled" in msg):
        return ("the Sheets API is off for the cham-hq project. Switch it on (one click):\n"
                "  https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=120151131910")
    if code in (403, 404):
        return ("the sheet is not shared with the service account. Bach (the owner) needs to share it, "
                "as Editor, with:\n  firebase-adminsdk-fbsvc@cham-hq.iam.gserviceaccount.com")
    return None


def overall_figures(expenses):
    """{row name: [cost, earned]} worked out from every line on the site,
    with the same rules as the Money tab."""
    out = {}
    for e in expenses:
        amt = e.get("amount") or 0
        kind = "in" if e.get("kind") == "in" else "out"
        if kind == "out" and e.get("category") == "Teaching":
            name = TEACHING_ROW
        elif e.get("budgetLine"):
            name = e["budgetLine"].strip()
        else:
            name = RUNNING_ROW if kind == "out" else DONATION_ROW
        k = " ".join(name.split()).lower()           # "bake sale  #2" is "Bake sale #2"
        f = out.setdefault(k, [name, 0, 0])
        f[1 if kind == "out" else 2] += amt
    return {name: [cost, earned] for name, cost, earned in out.values()}


def update_overall(S, expenses, dry):
    key = lambda n: " ".join(str(n).split()).lower()
    rng = urllib.parse.quote(f"'{OVERALL}'!B{OVERALL_ROWS.start}:F{OVERALL_ROWS.stop - 1}")
    code, res = S.call("GET", f"/values/{rng}?valueRenderOption=UNFORMATTED_VALUE")
    if code != 200:
        log(f"overall: could not read the tab ({code}): {json.dumps(res)[:160]}")
        return
    rows = res.get("values", [])
    have, empty = {}, []
    for i in range(len(OVERALL_ROWS)):
        r = rows[i] if i < len(rows) else []
        name = str(r[0]).strip() if r else ""
        num = lambda j: (r[j] if len(r) > j and isinstance(r[j], (int, float)) else None)
        if name:
            have[key(name)] = (OVERALL_ROWS.start + i, num(2), num(4))
        else:
            empty.append(OVERALL_ROWS.start + i)

    writes = []
    for name, (cost, earned) in sorted(overall_figures(expenses).items()):
        if key(name) in have:
            row, c0, e0 = have[key(name)]
            if c0 != cost:
                writes.append({"range": f"'{OVERALL}'!D{row}", "values": [[cost]]})
                log(f"overall: {name} cost {c0} -> {cost}")
            if e0 != earned:
                writes.append({"range": f"'{OVERALL}'!F{row}", "values": [[earned]]})
                log(f"overall: {name} earnings {e0} -> {earned}")
        elif empty:
            row = empty.pop(0)
            writes += [{"range": f"'{OVERALL}'!B{row}", "values": [[name]]},
                       {"range": f"'{OVERALL}'!D{row}", "values": [[cost]]},
                       {"range": f"'{OVERALL}'!F{row}", "values": [[earned]]}]
            log(f"overall: new row {row} for {name}: cost {cost}, earnings {earned}")
        else:
            log(f"overall: no empty row left for {name}")
    if not writes:
        log("overall: already up to date")
        return
    if dry:
        log(f"overall: dry run - {len(writes)} cell(s) not written")
        return
    code, res = S.call("POST", "/values:batchUpdate", {"valueInputOption": "RAW", "data": writes})
    if code != 200:
        log(f"overall: write failed ({code}): {json.dumps(res)[:160]}")
    else:
        log(f"overall: updated {len(writes)} cell(s)")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    args = ap.parse_args()

    info = service_info()
    if info is None:
        log("not set up - no service account. Doing nothing.")
        return
    db = firestore.Client(project=info["project_id"],
                          credentials=service_account.Credentials.from_service_account_info(info))

    everything, pending = [], []
    for d in db.collection("expenses").stream():
        e = d.to_dict() or {}
        e["_ref"] = d.reference
        e["_id"] = d.id
        everything.append(e)
        if e.get("status") == "new":
            pending.append(e)

    S = Sheets(info)
    code, meta = S.call("GET", "?fields=sheets.properties.title")
    reason = not_ready(code, meta) if code != 200 else None
    if reason:
        log("waiting: " + reason)
        return
    if code != 200:
        log(f"could not read the sheet ({code}): {json.dumps(meta)[:200]}")
        return

    update_overall(S, everything, args.dry_run)
    if not pending:
        log("nothing new to copy")
        return

    people = {}
    for d in db.collection("members").stream():
        m = d.to_dict() or {}
        if m.get("personKey"):
            people[m["personKey"]] = m.get("name") or m["personKey"].title()
    who = lambda k: "Chạm's money" if k == "cham" else people.get(k, k)

    rows = {"out": [], "in": []}
    for e in sorted(pending, key=lambda e: (e.get("date") or "", e["_id"])):
        kind = "in" if e.get("kind") == "in" else "out"
        common = [e.get("date") or "", e.get("category") or "", e.get("description") or "",
                  e.get("amount") or 0, e.get("budgetLine") or "", e.get("notes") or "",
                  who(e.get("paidBy") or "cham"), METHODS.get(e.get("method"), e.get("method") or "")]
        if kind == "out":
            owed = ("Paid back" if e.get("repaid") else "Yes") if e.get("owed") else ""
            rows[kind].append((e, common + [owed, e.get("createdBy") or "", e["_id"]]))
        else:
            rows[kind].append((e, common + [e.get("createdBy") or "", e["_id"]]))

    for kind, items in rows.items():
        if items:
            log(f"{len(items)} {TABS[kind][0].lower()} line(s) to copy")
            for _, r in items:
                log("   " + " | ".join(str(x) for x in r[:6]))

    if args.dry_run:
        log("dry run - nothing written")
        return

    have = {s["properties"]["title"] for s in meta.get("sheets", [])}
    for kind, (tab, header) in TABS.items():
        if tab in have or not rows[kind]:
            continue
        code, res = S.call("POST", ":batchUpdate", {"requests": [{"addSheet": {"properties": {"title": tab}}}]})
        if code != 200:
            log(f"could not add the {tab} tab ({code}): {json.dumps(res)[:200]}")
            return
        rng = urllib.parse.quote(f"'{tab}'!A1")
        S.call("PUT", f"/values/{rng}?valueInputOption=RAW", {"values": [header]})
        log(f"made the {tab} tab")

    for kind, items in rows.items():
        if not items:
            continue
        tab = TABS[kind][0]
        rng = urllib.parse.quote(f"'{tab}'!A1")
        code, res = S.call("POST", f"/values/{rng}:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS",
                           {"values": [r for _, r in items]})
        if code != 200:
            log(f"append to {tab} failed ({code}): {json.dumps(res)[:200]} - nothing marked, will retry")
            continue
        now = firestore.SERVER_TIMESTAMP
        for e, _ in items:
            e["_ref"].update({"status": "logged", "loggedAt": now, "sheetSyncedAt": now, "loggedBy": "auto-sync"})
        log(f"copied {len(items)} line(s) into {tab} and marked them in the sheet")


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception as e:
        log(f"CRASHED: {type(e).__name__}: {e}")
        sys.exit(1)

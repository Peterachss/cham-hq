#!/usr/bin/env python3
"""
Chạm HQ - test the Firestore rules, and publish them only if every test passes.

    python scripts/deploy_rules.py --key C:\\path\\to\\service-account.json          test only
    python scripts/deploy_rules.py --key C:\\path\\to\\service-account.json --deploy test, then publish

Every scenario below is something that must, or must not, be allowed. If a
single one comes out wrong, nothing is published. That is the point: a
mistake in these rules either locks the club out or opens its data up, and
you find out from a stranger, not from a test.
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request

from google.oauth2 import service_account
import google.auth.transport.requests as tr

HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
PROJECT = "cham-hq"
DOCS = "/databases/(default)/documents"

# Pretend people. What matters is the shape of their member documents.
ADMIN = ("peter@test.cham", {"personKey": "peter", "admin": True})
FINANCE = ("thuan@test.cham", {"personKey": "thuan", "finance": True})
MEMBER = ("emily@test.cham", {"personKey": "emily"})
STRANGER = "nobody@test.cham"          # signed in, but not on the list


def mocks(*people):
    """exists()/get() on /members answer for the people given, and say
    'not there' for anyone else."""
    out = []
    for email, data in people:
        path = f"{DOCS}/members/{email}"
        out.append({"function": "exists", "args": [{"exactValue": path}], "result": {"value": True}})
        out.append({"function": "get", "args": [{"exactValue": path}],
                    "result": {"value": {"data": data}}})
    out.append({"function": "exists", "args": [{"anyValue": {}}], "result": {"value": False}})
    return out


def req(email, method, path, data=None):
    r = {"method": method, "path": f"{DOCS}/{path}", "time": "2026-09-26T00:00:00Z"}
    if email:
        r["auth"] = {"uid": email, "token": {"email": email}}
    if data is not None:
        r["resource"] = {"data": data}
    return r


TASK = {"who": "emily", "title": "Film the reel", "status": "open", "progress": 0}
EXPENSE = {"kind": "out", "amount": 250000, "description": "Beads", "status": "new",
           "createdBy": MEMBER[0], "receipt": ""}

# (name, expect, request, existing resource or None)
CASES = [
    ("signed out cannot read tasks", "DENY",
     req(None, "get", "tasks/t1"), TASK),
    ("stranger cannot read tasks", "DENY",
     req(STRANGER, "get", "tasks/t1"), TASK),
    ("member can read tasks", "ALLOW",
     req(MEMBER[0], "get", "tasks/t1"), TASK),

    ("member can set progress on their own job", "ALLOW",
     req(MEMBER[0], "update", "tasks/t1", {**TASK, "progress": 60}), TASK),
    ("member cannot rename their own job", "DENY",
     req(MEMBER[0], "update", "tasks/t1", {**TASK, "title": "Something else"}), TASK),
    ("member cannot touch someone else's job", "DENY",
     req(MEMBER[0], "update", "tasks/t2", {**TASK, "who": "bach", "progress": 50}), {**TASK, "who": "bach"}),
    ("admin can create a job", "ALLOW",
     req(ADMIN[0], "create", "tasks/t3", TASK), None),
    ("member cannot create a job", "DENY",
     req(MEMBER[0], "create", "tasks/t3", TASK), None),

    ("member can post to the feed as themselves", "ALLOW",
     req(MEMBER[0], "create", "updates/u1", {"who": "emily", "text": "Filmed it", "date": "2026-09-26"}), None),
    ("member cannot post as somebody else", "DENY",
     req(MEMBER[0], "create", "updates/u1", {"who": "bach", "text": "x", "date": "2026-09-26"}), None),

    ("member can log money under their own name", "ALLOW",
     req(MEMBER[0], "create", "expenses/e1", EXPENSE), None),
    ("member cannot log money as someone else", "DENY",
     req(MEMBER[0], "create", "expenses/e1", {**EXPENSE, "createdBy": FINANCE[0]}), None),
    ("a zero or negative amount is refused", "DENY",
     req(MEMBER[0], "create", "expenses/e1", {**EXPENSE, "amount": 0}), None),
    ("member cannot mark their own line as in the sheet", "DENY",
     req(MEMBER[0], "update", "expenses/e1", {**EXPENSE, "status": "logged"}), EXPENSE),
    ("finance can mark a line as in the sheet", "ALLOW",
     req(FINANCE[0], "update", "expenses/e1", {**EXPENSE, "status": "logged"}), EXPENSE),
    ("member can delete their own new line", "ALLOW",
     req(MEMBER[0], "delete", "expenses/e1"), EXPENSE),
    ("member cannot delete a line finance has dealt with", "DENY",
     req(MEMBER[0], "delete", "expenses/e1"), {**EXPENSE, "status": "logged"}),
    ("member cannot delete someone else's line", "DENY",
     req(MEMBER[0], "delete", "expenses/e1"), {**EXPENSE, "createdBy": FINANCE[0]}),
    ("stranger cannot read money", "DENY",
     req(STRANGER, "get", "expenses/e1"), EXPENSE),
]


def key_path():
    if "--key" in sys.argv:
        i = sys.argv.index("--key")
        if i + 1 < len(sys.argv):
            return sys.argv[i + 1]
    return os.path.join(os.path.expanduser("~"), ".cham-hq", "firebase-key.json")


def token():
    with open(key_path(), encoding="utf-8-sig") as f:
        info = json.load(f)
    c = service_account.Credentials.from_service_account_info(
        info, scopes=["https://www.googleapis.com/auth/cloud-platform"])
    c.refresh(tr.Request())
    return c.token


def call(tok, method, url, body=None):
    data = json.dumps(body).encode() if body is not None else None
    r = urllib.request.Request(url, data=data, method=method,
                               headers={"Authorization": "Bearer " + tok, "Content-Type": "application/json"})
    try:
        return 200, json.load(urllib.request.urlopen(r))
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read() or b"{}")
        except Exception:
            return e.code, {}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--key")
    ap.add_argument("--deploy", action="store_true")
    ap.add_argument("--tested-locally", action="store_true",
                    help="the service account cannot run Google's test tool; say you ran the "
                         "emulator suite (tests/rules.test.mjs) and it passed")
    args = ap.parse_args()

    with open(os.path.join(HERE, "firestore.rules"), encoding="utf-8") as f:
        source = f.read()

    tok = token()
    who_mocks = mocks(ADMIN, FINANCE, MEMBER)
    cases = []
    for name, expect, request, resource in CASES:
        c = {"expectation": expect, "request": request, "functionMocks": who_mocks}
        if resource is not None:
            c["resource"] = {"data": resource}
        cases.append(c)

    code, res = call(tok, "POST", f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}:test", {
        "source": {"files": [{"name": "firestore.rules", "content": source}]},
        "testSuite": {"testCases": cases},
    })
    if code == 403 and args.tested_locally:
        print("Google's test tool is not open to this service account; relying on the")
        print("local emulator run you vouched for with --tested-locally.")
        if args.deploy:
            publish(tok, source)
        else:
            print("Add --deploy to publish.")
        return
    if code != 200:
        sys.exit(f"The rules did not even compile or the test call failed ({code}):\n"
                 + json.dumps(res, indent=2)[:2000]
                 + ("\n\nIf this is a 403: run tests/rules.test.mjs in the emulator, then pass --tested-locally."
                    if code == 403 else ""))

    if res.get("issues"):
        print("Compiler notes:")
        for i in res["issues"]:
            print("  ", i.get("severity"), i.get("description"))

    failed = 0
    for (name, expect, _, _), r in zip(CASES, res.get("testResults", [])):
        ok = r.get("state") == "SUCCESS"
        failed += not ok
        print(("  pass  " if ok else "  FAIL  ") + f"{expect:5}  {name}")
        if not ok:
            for d in r.get("debugMessages", [])[:3]:
                print("          ", d)
            if r.get("errorPosition"):
                print("           at line", r["errorPosition"].get("line"))

    print()
    if failed:
        sys.exit(f"{failed} of {len(CASES)} failed. Nothing was published.")
    print(f"All {len(CASES)} passed.")

    if not args.deploy:
        print("Test only. Add --deploy to publish.")
        return
    publish(tok, source)


def publish(tok, source):
    code, rs = call(tok, "POST", f"https://firebaserules.googleapis.com/v1/projects/{PROJECT}/rulesets",
                    {"source": {"files": [{"name": "firestore.rules", "content": source}]}})
    if code != 200:
        sys.exit(f"Could not create the ruleset ({code}): {json.dumps(rs)[:500]}")

    name = f"projects/{PROJECT}/releases/cloud.firestore"
    code, rel = call(tok, "PATCH", f"https://firebaserules.googleapis.com/v1/{name}",
                     {"release": {"name": name, "rulesetName": rs["name"]}})
    if code != 200:
        sys.exit(f"Ruleset made but not released ({code}): {json.dumps(rel)[:500]}")
    print("Published:", rs["name"], "at", rel.get("updateTime"))


if __name__ == "__main__":
    main()

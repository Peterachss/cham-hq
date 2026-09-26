"""
Chạm HQ - every background job checks in here when it runs.

    import status
    status.beat("backup", True, "13 KB")          # it worked
    status.beat("finance", False, "sheet 403")    # it ran and failed
    status.beat("chatwrap", None, "login needed") # it is waiting on a person

Everything lands in meta/status, which only admins can read. push.py
looks at it every run and pings the admins, once, when something that
matters has stopped or is failing (see health() in push.py). Checking in
must never break the job itself, so any problem here is swallowed.
"""

import datetime as dt
import os

VN = dt.timezone(dt.timedelta(hours=7))


def where():
    return "github" if os.environ.get("GITHUB_ACTIONS") == "true" else "laptop"


def beat(job, ok, msg="", db=None):
    try:
        if db is None:
            import push
            db = push.firebase()
        if db is None:
            return
        now = dt.datetime.now(VN).isoformat(timespec="seconds")
        w = where()
        db.collection("meta").document("status").set(
            {"jobs": {job: {"at": now, "ok": ok, "msg": str(msg)[:160], "where": w, w + "At": now}}}, merge=True)
    except Exception:
        pass

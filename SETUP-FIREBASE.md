# Turning on sign-in and the morning email

> **Status, 26 Sep 2026:** steps 1–7 are done - the project exists, sign-in works, the
> rules are published (now by `scripts/deploy_rules.py`, not by pasting), all nine
> members are in, and the tasks are imported. For what is left, see **README.md →
> One-time setup still to do**. This file is kept as the record of how it was set up.

Right now the site works exactly as it always has: anyone with the link reads it,
tasks come from `data.json`, nobody signs in. **Nothing below is required.** Do it
only when you want members signing in and ticking their own jobs off.

Everything here is free. No credit card at any point.

You will do the clicking, because it all needs your Google account. Then paste me
the one block of settings from step 3 and I will wire up the rest.

---

## 1. Make the Firebase project

1. Go to **https://console.firebase.google.com** and sign in with your Google account
2. **Create a project** → name it `cham-hq` → **Continue**
3. Google Analytics: **turn it off**, you do not need it → **Create project**

Stay on the **Spark** (free) plan. If it ever asks you to upgrade to Blaze and put a
card in, you have wandered into Cloud Functions — back out, we are not using those.

## 2. Turn on email sign-in

1. Left sidebar → **Build → Authentication** → **Get started**
2. **Email/Password** → toggle the first switch on → **Save**

Leave "Email link (passwordless)" off.

## 3. Get the settings and send them to me

1. Click the **gear** next to *Project Overview* → **Project settings**
2. Scroll to **Your apps** → click the **`</>`** (web) icon
3. Nickname `cham-hq` → **Register app** (do NOT tick Firebase Hosting)
4. It shows a block of code with `apiKey`, `authDomain`, `projectId` and so on

**Copy that whole block and paste it to me in the chat.** I will put it in
`firebase-config.js` and push it.

These are not secrets. Firebase web keys are designed to sit in public code — what
actually protects your data is the rules in step 5.

## 4. Make the database

1. Left sidebar → **Build → Firestore Database** → **Create database**
2. Choose **Start in production mode** (locked down; we open it properly next step)
3. Location: **asia-southeast1** — that is Singapore, closest to Vietnam → **Enable**

## 5. Paste in the security rules

This is the part that actually protects everything, so do not skip it.

1. Firestore Database → **Rules** tab
2. Delete everything in the box
3. Open `firestore.rules` from this folder, copy all of it, paste it in
4. **Publish**

What those rules do:

- only people listed in `/members` can read anything
- only **you and Bach** can create, delete or reassign a job
- everyone else can change the status and note on **their own** jobs, and nothing else
- nobody can rename a task, move its due date, or hand it to somebody else

## 6. Put the people in

Two things per member: a login, and a record saying which Chạm person that login is.

**The login** — Authentication → **Users** → **Add user**. Type their email and a
starting password, tell them what it is, and tell them to change it. Do this for all
eleven of you.

**The record** — Firestore → **Start collection** → collection ID `members`.
One document per person. **The document ID is their email, all lowercase.** Fields:

| Field | Type | Value |
| --- | --- | --- |
| `personKey` | string | `uyen`, `bach`, `thuan`… — must match the key in `data.json` |
| `name` | string | Their name, e.g. `Uyen` |
| `admin` | boolean | `true` for you and Bach, `false` for everyone else |

Anyone who signs in without a `/members` record gets bounced straight back out with a
message telling them to ask you. So a stranger who somehow guesses a password still
sees nothing.

## 7. Move the existing tasks across

Rather than retyping 29 jobs, run the importer once.

1. Project settings → **Service accounts** → **Generate new private key** → it
   downloads a `.json` file. **This one IS a secret. Do not commit it, do not paste
   it in the chat.**
2. In PowerShell:

```powershell
pip install google-cloud-firestore
$env:FIREBASE_SERVICE_ACCOUNT = Get-Content "C:\path\to\the-key.json" -Raw
cd C:\Users\peter\cham-hq
python scripts\import_tasks.py            # shows what it would do, writes nothing
python scripts\import_tasks.py --write    # does it
```

3. It also creates placeholder `/members` docs named `uyen@REPLACE-WITH-REAL-EMAIL`.
   Rename each one to the real email in the Firestore console, or just delete them and
   do step 6 by hand.

After this, the Tasks tab reads from Firestore instead of `data.json`, live on every
phone at once. The Updates feed and Calendar stay in `data.json` — those are still
yours to edit, and they are the bits that work with no signal.

## 8. The morning email

A GitHub Action runs at **7am Vietnam time** every day and emails anyone who has
something overdue or due within a week. People with a clean slate get nothing.

Add three repository secrets — GitHub repo → **Settings → Secrets and variables →
Actions → New repository secret**:

| Secret | What to paste |
| --- | --- |
| `FIREBASE_SERVICE_ACCOUNT` | the entire contents of that `.json` key file from step 7 |
| `GMAIL_USER` | the Gmail address the reminders are sent from |
| `GMAIL_APP_PASSWORD` | an app password for that address, see below |

**Getting an app password:** the account needs 2-Step Verification on. Go to
**https://myaccount.google.com/apppasswords**, name it `cham-hq`, and Google gives you
a 16-character password. That is what goes in the secret — not your real Gmail
password. If that page says it is unavailable, 2-Step Verification is not on yet.

To test it without waiting for morning: repo → **Actions** → **Morning task email** →
**Run workflow**.

---

## What can go wrong

**"That account is not on the Chạm list yet"** — they have a login but no `/members`
document, or the document ID is not exactly their email in lowercase.

**Signed in but the task list is empty** — the rules are not published (step 5), or
their `personKey` does not match the keys in `data.json`.

**No email arrived** — check the Actions tab for a red run. Nearly always the app
password: it must be the 16-character one, with no spaces.

**Changed your mind?** Empty out `firebase-config.js` and push. The sign-in bar
disappears and the site goes back to reading `data.json`. Nothing is lost.

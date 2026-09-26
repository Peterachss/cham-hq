# Chạm HQ

The members page for Chạm: what happened, what is due, who is doing what, and where
the money went. Live at **https://peterachss.github.io/cham-hq/**.

Anyone with the link sees the public parts (the feed and calendar from `data.json`).
Everything else - tasks, money, photos, the tracker - needs a Chạm login.

---

## What each tab does

| Tab | What it is | Who changes it |
| --- | --- | --- |
| **Updates** | The day-by-day feed. Each day opens with a counted line ("2 finished · 1 stuck · 944,000 ₫ spent"). Most lines write themselves - see below | Everyone logs their own; Peter, Bach and Thy can post as anyone and paste a day's chat |
| **Calendar** | Events from `data.json`, plus every job with a due date. Jobs with no date collect under "Waiting on a date" | `data.json` for events; the Tasks tab for jobs |
| **Tasks** | Every job, who has it, how far along it is | Admins hand out and edit; the owner ticks off and sets their own % |
| **Money** | Every bit of money in and out, and what is owed back | Everyone logs; Thuan (finance) marks lines as in the sheet or paid back |
| **Photos** | CAS evidence. Members-only | Everyone adds their own |
| **Tracker** | Charts: workload and progress per person, who is behind, what is coming up | Nobody - it counts the rest |

### The feed writes itself

Finishing a job, getting stuck, handing out work, adding photos and logging money each
put a line in the feed on their own. Nobody has to type up what happened; the site
already knows. The same job finished twice in a day is one line.

### Who is who

Roles live on each person's document in Firestore → `members` (the document ID is
their email, lowercase):

- `personKey` - which person they are (`bach`, `thuan`, …), matching `data.json`
- `admin: true` - Peter, Bach, Thy. Hand out and edit any job, post as anyone, review the chat wrap
- `finance: true` - Thuan. Marks money lines as in the sheet, and people as paid back

---

## What runs on its own

| What | When | Where | Needs |
| --- | --- | --- | --- |
| **Push notifications** - new job, somebody stuck, money waiting for the sheet, 7am due list, 9pm round-up | Every 15 min | Scheduled task *Cham HQ notifications* on Peter's PC; GitHub Actions as backup | Nothing more on the PC. For the backup: two GitHub secrets (below) |
| **Finance sheet sync** - new money lines appended to the sheet's Expenses / Income tabs | Hourly | Scheduled task *Cham HQ finance sync*; GitHub as backup | Sheets API switched on, and the sheet shared with the service account |
| **Chat wrap** - reads the day's group chat, sorts it, queues it for review | 9pm | Scheduled task *Cham HQ nightly wrap* | The bot account signed in once (`ig_wrap.py --login`) |
| **Email** - new jobs and a 7am digest | Every 15 min | GitHub Actions | Three GitHub secrets |

Everything above checks its own setup and, if something is missing, says exactly what
and does nothing rather than failing. Logs are in `%USERPROFILE%\.cham-hq\logs\`.

### Turning notifications on (each person, once)

Open the site, sign in, and tap **Turn on notifications** in the green bar.

- **iPhone:** Apple only allows notifications from the Home Screen app. Safari → Share →
  **Add to Home Screen**, open Chạm HQ from the Home Screen, sign in, then tap the button.
- **Android, Windows, Mac:** Chrome, Edge or Firefox, straight from the page.

---

## One-time setup still to do

In order of how much they unlock:

1. **Sheets API** - one click, logged in as the owner of the Firebase project:
   https://console.developers.google.com/apis/api/sheets.googleapis.com/overview?project=120151131910
2. **Share the finance sheet** with `firebase-adminsdk-fbsvc@cham-hq.iam.gserviceaccount.com`
   as Editor. Only Bach can - he owns it.
3. **GitHub backup for notifications** - repo → Settings → Secrets and variables → Actions:
   - `FIREBASE_SERVICE_ACCOUNT` - the whole of `%USERPROFILE%\.cham-hq\firebase-key.json`
   - `VAPID_PRIVATE_KEY` - the `private_raw_b64url` value from `%USERPROFILE%\.cham-hq\vapid.json`
4. **Email** (optional - push does the same job) - add `GMAIL_USER` (cham.dreams1703@gmail.com)
   and `GMAIL_APP_PASSWORD` (an app password from https://myaccount.google.com/apppasswords).
   Then once: `python scripts\notify.py --catch-up` so nobody gets mail about old jobs.
5. **Chat wrap** - `python scripts\ig_wrap.py --login` and sign `cham_summarizer` in.
   Optionally an Anthropic API key in `%USERPROFILE%\.cham-hq\config.json` for model-written
   summaries; without one it sorts the chat with the same rules as the paste box.

Nothing in `%USERPROFILE%\.cham-hq\` is ever committed. It holds the real secrets.

---

## Changing the security rules

Rules live in `firestore.rules`. Never publish them untested - a mistake either locks
the club out or opens the data up.

```
cd %USERPROFILE%\.cham-hq\ruletest
copy C:\Users\peter\cham-hq\firestore.rules .
copy C:\Users\peter\cham-hq\tests\rules.test.mjs .
set JAVA_HOME=%USERPROFILE%\.cham-hq\jre21\jdk-21.0.12.1+1-jre
npx firebase emulators:exec --only firestore --project cham-hq-test "node rules.test.mjs"
```

Only when every test passes:

```
python scripts\deploy_rules.py --deploy --tested-locally
```

---

## `data.json` - the public parts

Edit on github.com (pencil → commit); the site updates within a minute. You never set
`"TODAY"` - the page reads the real date off the device; that field only stamps how far
the chat has been read.

| Key | What it is |
| --- | --- |
| `TODAY` | How far the chat has been read. Only stamps the header |
| `PEOPLE` | Everyone, with `name`, `role`, `color`, `initials`. The key is what everything else points at |
| `DAYS` | The feed's history, from before the site wrote its own. Newest first |
| `TASKS` | The original import only. Live tasks come from the database |
| `EVENTS` | Calendar entries: `date`, `title`, `sub`, `state` (`past`, `target`, `confirmed`) |
| `UNDATED` | Things with no date yet |
| `MONEY` | The "numbers quoted in the chat" strip |
| `LINKS` | The footer buttons |

### After changing `app.js`, `styles.css`, `live.js` or `index.html`

Bump the `?v=` on the script and stylesheet tags in `index.html`, and the same numbers in
the `SHELL` list and `CACHE` in `sw.js`. The `?v=` makes every phone fetch the new file;
without it a phone can run new HTML against old JavaScript, with half the buttons
missing and nothing to say why.

---

## Files

```
index.html              the page
app.js                  everything the page does
live.js                 sign-in and the live database
firebase-config.js      Firebase settings and the push PUBLIC key (not secrets)
styles.css              all the styling, light and dark
sw.js                   offline, and showing notifications
data.json               the public feed, calendar and people
firestore.rules         who may read and write what
tests/rules.test.mjs    58 checks the rules must pass before publishing
scripts/push.py         push notifications
scripts/notify.py       email
scripts/sync_finance.py money lines into the finance sheet
scripts/ig_wrap.py      the 9pm chat wrap
scripts/deploy_rules.py publishes the rules
scripts/import_tasks.py the one-time task import
.github/workflows/       the GitHub backup for all of the above
```

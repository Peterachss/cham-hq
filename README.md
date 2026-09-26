# Chạm HQ

Updates, calendar and tasks for Chạm members. Built from the ISHCMC Chạm Nonprofit
group chat, read up to Fri 25 Sep 2026.

It installs to a phone home screen like an app: own icon, own name, full screen, and it
still opens with no signal.

## Put it online (once, about two minutes)

1. On github.com, make a new **public** repository called `cham-hq`. No README, no
   .gitignore, nothing — leave it empty.
2. On the empty repo page click **uploading an existing file**, then drag in
   *everything inside this folder* (not the folder itself): `index.html`, `styles.css`,
   `app.js`, `data.json`, `manifest.webmanifest`, `sw.js`, `.nojekyll` and the `icons`
   folder. Commit.
3. **Settings → Pages →** Source: *Deploy from a branch*, Branch: `main`, folder: `/ (root)`. Save.
4. Wait a minute, then open **https://peterachss.github.io/cham-hq/** and pin that link
   in the group chat.

The repo has to be public for free GitHub Pages. That is fine — there is nothing private
in here, and nobody finds it without the link (`robots` is set to noindex so it stays out
of Google). Keep phone numbers, addresses and anything personal out of `data.json`.

## Update it

There are two halves now, and they update in completely different ways.

### Tasks - on the site itself

Since sign-in was switched on, **tasks live in the database, not in this folder.**
Nobody edits a file to change them:

- **You and Bach** hand out jobs from the **Tasks** tab: pick the person, type the job,
  set a due date. It is on their phone straight away.
- **Everyone else** ticks their own jobs off - *Not started, Doing it, Stuck, Done* -
  and can leave a note. They cannot touch anyone else's.
- Admins can edit or delete anybody's.

The **Tracker** tab adds these up on its own. Nothing to maintain.

### Everything else - `data.json`

The day-by-day feed, the calendar, the money figures, people's names and roles, and
the footer links are still in `data.json`. Edit it on github.com (open the file, click
the pencil, commit) and the site updates within a minute.

- **You never set `"TODAY"` any more.** The page reads the real date off the device.
  The date in `data.json` only stamps *"Chat read to ..."* in the corner, so move it
  when you have read further up the chat, and otherwise leave it alone.
- If you change `app.js`, `styles.css` or `index.html`, bump **two** things: `CACHE` in
  `sw.js`, and the `?v=` on the script and stylesheet tags in `index.html` (they must
  match the list in `sw.js`). The `?v=` is the one that matters - it makes every browser
  fetch a genuinely new address, which no cache can answer from memory. Without it,
  phones can end up running new HTML against old JavaScript, where half the buttons
  are missing and nothing explains why.

### What goes where in `data.json`

| Key | What it is |
| --- | --- |
| `TODAY` | How far the chat has been read. Only stamps the header - the page gets the real date from the device |
| `PEOPLE` | Everyone, with `name`, `role`, `color`, `initials`. The key (`bach`, `thuan`…) is what the other sections point at |
| `DAYS` | The Updates feed. Newest first. `date` (or `null` with a `label`), `tag`, and `items` with `who` + `text`. Put `"key": true` on the ones that matter, they get highlighted. `**double stars**` makes text bold |
| `TASKS` | The original import only. Live tasks now come from the database - editing this list changes nothing for anyone signed in |
| `EVENTS` | Calendar entries: `date`, `title`, `sub`, `state` |
| `UNDATED` | Things with no date yet. This list is the point of the calendar, keep it honest |
| `MONEY` | The figures strip: `fig` and `lbl` |
| `LINKS` | The buttons in the footer |

`status` is one of `open`, `doing`, `blocked`, `late`, `done`.
Anything with a `due` in the past automatically shows as overdue, so you rarely need `late`.

`state` is one of `past`, `target`, `confirmed`. Amber is `target`: something somebody named
but nobody locked.

## Get it on your home screen

- **iPhone:** open the link in Safari, tap **Share**, then **Add to Home Screen**.
- **Android:** Chrome offers an **Install** button on the page itself.

After that it opens full screen with the Chạm icon, and works on the bus with no signal.

## Files

```
index.html            the page
styles.css            all the styling, light and dark
app.js                rendering, filters, the calendar
data.json             ← the content. this is the one you edit
manifest.webmanifest  name, icon and colours for installing
sw.js                 offline caching
icons/                app icon, 180 / 192 / 512 / 512-maskable
.nojekyll             stops GitHub Pages doing anything clever to the files
```

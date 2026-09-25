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

**`data.json` is the only file you normally touch.** Edit it on github.com (open the file,
click the pencil, commit) and the site updates within a minute. No rebuild, no review, no
app store.

Every time you update:

- Set `"TODAY"` to the real date, `YYYY-MM-DD`. Everything that says *overdue*, *3 days ago*
  or *in 5 days* is worked out from it. If you forget, the page quietly starts lying.
- If you change `app.js`, `styles.css` or `index.html`, also bump `CACHE` in `sw.js`
  (`cham-hq-v1` → `cham-hq-v2`). Otherwise phones keep showing the old version from cache.

### What goes where in `data.json`

| Key | What it is |
| --- | --- |
| `TODAY` | The date the page treats as today |
| `PEOPLE` | Everyone, with `name`, `role`, `color`, `initials`. The key (`bach`, `thuan`…) is what the other sections point at |
| `DAYS` | The Updates feed. Newest first. `date` (or `null` with a `label`), `tag`, and `items` with `who` + `text`. Put `"key": true` on the ones that matter, they get highlighted. `**double stars**` makes text bold |
| `TASKS` | `who`, `title`, `status`, `note`, and `due` or `since` |
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

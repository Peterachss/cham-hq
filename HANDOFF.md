# Handoff: put Chạm HQ on GitHub Pages

This folder is a finished static site. Nothing needs building, compiling or installing.
It just needs to sit in a public GitHub repo with Pages turned on.

Target: **https://peterachss.github.io/cham-hq/**

---

## Option A — paste this to Claude Code on the laptop that has GitHub

Unzip the folder first, note where it landed, then fix the path in the first line:

```text
I unzipped cham-hq.zip to ~/Downloads/cham-hq. It is a finished static site:
index.html, styles.css, app.js, data.json, manifest.webmanifest, sw.js, .nojekyll, icons/.
Read README.md in that folder first.

Please do this:
1. Run `gh auth status` and tell me if I am logged in. If not, stop and tell me how to log in.
2. Create a PUBLIC repo called cham-hq under my account.
3. Push the CONTENTS of the folder to main, at the repo root. index.html must end up at the
   top level of the repo, NOT inside a cham-hq/ subfolder. Include the hidden .nojekyll file.
4. Enable GitHub Pages: deploy from branch main, folder / (root).
5. Wait for the deploy, then confirm the live URL loads, that data.json is fetched with a 200,
   and that the manifest and icons resolve. Tell me the URL.

Do not change the contents of any file. If something fails, tell me what failed rather than
working around it.
```

## Option B — do it by hand in a browser, no terminal

1. github.com → **New repository** → name `cham-hq` → **Public** → create it empty
   (no README, no .gitignore, no licence)
2. On the empty repo page, click **uploading an existing file**
3. Open the unzipped folder, select everything inside it, drag it onto the page.
   The `icons` folder drags across as a folder, that is fine.
   `.nojekyll` is hidden in Finder — press **⌘⇧.** to see it, or just skip it, this site
   does not need it.
4. Commit
5. **Settings → Pages** → Source *Deploy from a branch* → Branch `main`, folder `/ (root)` → Save
6. Give it a minute, then open the URL at the top of this file

## Option C — the terminal version

```bash
cd ~/Downloads/cham-hq
git init -b main
git add -A
git commit -m "Chạm HQ: members page"
gh repo create cham-hq --public --source=. --remote=origin --push
gh api -X POST repos/:owner/cham-hq/pages -f "source[branch]=main" -f "source[path]=/"
```

---

## Checks once it is live

- The page shows **21 open jobs** and **7 day cards** under Updates. If it shows an error box
  saying it could not load the page data, `data.json` did not get uploaded, or it ended up in a
  subfolder.
- On an iPhone: open in Safari → Share → **Add to Home Screen**. It should install as
  "Chạm HQ" with a green icon, and open with no browser bar.

## Updating it afterwards

Edit **`data.json`** on github.com, commit, done — the site refreshes within a minute.
Set `"TODAY"` to the real date every time, or everything that says *overdue* or *3 days ago*
is wrong. If you ever change `app.js`, `styles.css` or `index.html`, bump `CACHE` in `sw.js`
(`cham-hq-v1` → `cham-hq-v2`) or phones will keep showing the old version.

Full detail is in README.md.

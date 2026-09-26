(async () => {
  "use strict";

  /* ------------------------------------------------------------------ *
   * data — everything below comes from the ISHCMC Chạm Nonprofit group
   * chat export of 25 Sep 2026. Nothing is invented.
   * ------------------------------------------------------------------ */
  let TODAY, PEOPLE, DAYS, TASKS, EVENTS, UNDATED, MONEY, LINKS;
  try {
    const res = await fetch("data.json", { cache: "no-cache" });
    if (!res.ok) throw new Error("HTTP " + res.status);
    ({ TODAY, PEOPLE, DAYS, TASKS, EVENTS, UNDATED, MONEY, LINKS } = await res.json());
  } catch (err) {
    console.error("Chạm HQ: could not load data.json", err);
    const b = document.getElementById("boot-error");
    if (b) b.hidden = false;
    return;
  }

  /* TODAY used to be typed into data.json by hand, which meant that the
     moment somebody forgot, every "overdue" and "3 days ago" on the page
     quietly went wrong. Now the page just asks the device what day it is.
     The date in data.json is kept for one job only: stamping how far the
     chat was read. */
  const CHAT_READ = TODAY;
  TODAY = isoDay(new Date());

  /* ------------------------------------------------------------------ *
   * helpers
   * ------------------------------------------------------------------ */
  const $ = (id) => document.getElementById(id);
  const MON = ["Jan","Feb","Mar","Apr","May","Jun","Jul","Aug","Sep","Oct","Nov","Dec"];
  const MONTH_FULL = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DOW = ["Mon","Tue","Wed","Thu","Fri","Sat","Sun"];

  function el(tag, props, kids) {
    const n = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.slice(0,2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    (kids || []).forEach((c) => { if (c) n.appendChild(c); });
    return n;
  }
  function fromIso(s) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s || ""));
    return m ? new Date(+m[1], +m[2]-1, +m[3]) : null;
  }
  function isoDay(d) {
    const p = (n) => String(n).padStart(2, "0");
    return d.getFullYear() + "-" + p(d.getMonth()+1) + "-" + p(d.getDate());
  }
  function days(aIso, bIso) {
    const a = fromIso(aIso), b = fromIso(bIso);
    return (a && b) ? Math.round((b - a) / 86400000) : null;
  }
  function pretty(iso) {
    const d = fromIso(iso);
    return d ? DOW[(d.getDay()+6)%7] + " " + d.getDate() + " " + MON[d.getMonth()] : "";
  }
  function relDay(iso) {
    const n = days(TODAY, iso);
    if (n === null) return "";
    if (n === 0) return "today";
    if (n === -1) return "yesterday";
    if (n < 0) return Math.abs(n) + " days ago";
    if (n === 1) return "tomorrow";
    return "in " + n + " days";
  }
  function avatar(key, big) {
    const p = PEOPLE[key] || PEOPLE.team;
    const a = el("span", { class: "av" + (big ? " lg" : ""), title: p.name, "aria-hidden": "true", text: p.initials });
    a.style.background = p.color;
    return a;
  }
  /** renders **bold** spans without innerHTML */
  function richText(str) {
    const p = el("p");
    String(str).split(/(\*\*[^*]+\*\*)/g).forEach((part) => {
      if (!part) return;
      if (part.startsWith("**") && part.endsWith("**")) p.appendChild(el("b", { text: part.slice(2, -2) }));
      else p.appendChild(document.createTextNode(part));
    });
    return p;
  }

  /* ------------------------------------------------------------------ *
   * bridge to live.js (sign-in + Firestore). If live.js is not wired up
   * or nobody is signed in, TASKS stays exactly as data.json had it.
   * ------------------------------------------------------------------ */
  const BASE_TASKS = TASKS;
  const BASE_DAYS = DAYS;
  let SESSION = null;
  let LIVE_UPDATES = null;
  let PHOTOS = null;

  /* Live entries sit on top of what data.json already had, rather than
     replacing it, so the chat history from before any of this existed
     stays in the feed. Same date means same card. */
  function mergedDays() {
    if (!LIVE_UPDATES) return BASE_DAYS;
    const byKey = new Map();
    BASE_DAYS.forEach((d) => {
      byKey.set(d.date || ("label:" + d.label), { date: d.date, label: d.label, tag: d.tag, items: d.items.slice() });
    });
    LIVE_UPDATES.forEach((u) => {
      if (!u.date) return;
      let d = byKey.get(u.date);
      if (!d) { d = { date: u.date, label: null, tag: null, items: [] }; byKey.set(u.date, d); }
      if (u.tag && !d.tag) d.tag = u.tag;
      d.items.push({ who: u.who, text: u.text, key: u.key, id: u.id });
    });
    return [...byKey.values()].sort((a, b) => {
      if (!a.date) return 1;
      if (!b.date) return -1;
      return a.date < b.date ? 1 : -1;
    });
  }

  window.ChamHQ = {
    setTasks(rows) {
      TASKS = Array.isArray(rows) ? rows : BASE_TASKS;
      $("task-filters").replaceChildren();
      $("status-filters").replaceChildren();
      render();
    },
    setPhotos(rows) {
      PHOTOS = Array.isArray(rows) ? rows : null;
      $("photo-filters").replaceChildren();
      render();
    },
    setUpdates(rows) {
      LIVE_UPDATES = Array.isArray(rows) ? rows : null;
      DAYS = mergedDays();
      $("upd-filters").replaceChildren();
      render();
    },
    setSession(s) {
      SESSION = s;
      /* Panels are built once and then left alone, so they have to be torn
         down when the person changes - otherwise signing in after somebody
         else leaves you looking at their buttons. */
      ["task-filters","status-filters","upd-filters","photo-filters",
       "upd-admin","admin-panel","photo-add"].forEach((id) => {
        const n = $(id); if (n) n.replaceChildren();
      });
      render();
    },
    personName: (k) => (PEOPLE[k] ? PEOPLE[k].name : null),
    personRole: (k) => (PEOPLE[k] ? PEOPLE[k].role : null)
  };

  /** can the signed-in person move this particular job? */
  function canEdit(t) {
    if (!SESSION || !window.ChamLive || !t.id) return false;
    return SESSION.admin || SESSION.personKey === t.who;
  }

  const STATUS = {
    open:    { label: "open" },
    doing:   { label: "in progress" },
    blocked: { label: "blocked" },
    late:    { label: "overdue" },
    done:    { label: "done" }
  };

  /* ------------------------------------------------------------------ *
   * state
   * ------------------------------------------------------------------ */
  const S = {
    view: "updates",
    person: "all",
    status: "live",           // live = everything except done
    updPerson: "all",
    trackSort: "behind",
    photoPerson: "all",
    month: (() => { const d = fromIso(TODAY); return new Date(d.getFullYear(), d.getMonth(), 1); })(),
    selected: TODAY
  };

  const VIEWS = ["updates","calendar","tasks","photos","tracker"];
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
    btn.addEventListener("keydown", (e) => {
      const i = VIEWS.indexOf(btn.dataset.view);
      const N = VIEWS.length;
      if (e.key === "ArrowRight") { e.preventDefault(); setView(VIEWS[(i+1)%N]); $("tab-"+VIEWS[(i+1)%N]).focus(); }
      if (e.key === "ArrowLeft")  { e.preventDefault(); setView(VIEWS[(i+N-1)%N]); $("tab-"+VIEWS[(i+N-1)%N]).focus(); }
    });
  });
  function setView(v) {
    S.view = v;
    VIEWS.forEach((n) => {
      $("tab-"+n).setAttribute("aria-selected", String(n === v));
      $("view-"+n).hidden = n !== v;
    });
    render();
  }

  /* ------------------------------------------------------------------ *
   * render
   * ------------------------------------------------------------------ */
  function render() {
    renderGlance();
    if (S.view === "updates") { renderFeed(); renderUpdateAdmin(); }
    if (S.view === "calendar") renderCalendar();
    if (S.view === "tasks") renderTasks();
    if (S.view === "photos") renderPhotos();
    if (S.view === "tracker") renderTracker();
    renderAdmin();
  }

  function liveTasks() { return TASKS.filter((t) => t.status !== "done"); }

  /* A job with a due date IS a date in the calendar. Anything without one
     drops into "Waiting on a date", which is the honest place for it. */
  function calEvents() {
    const fromTasks = TASKS.filter((t) => t.due).map((t) => ({
      date: t.due,
      title: t.title,
      sub: (PEOPLE[t.who] ? PEOPLE[t.who].name : t.who) + (t.note ? " \u00b7 " + t.note : ""),
      state: t.status === "done" ? "past" : (t.due < TODAY ? "late" : "confirmed"),
      task: true
    }));
    return EVENTS.concat(fromTasks);
  }

  function calUndated() {
    const fromTasks = TASKS.filter((t) => !t.due && t.status !== "done").map((t) => ({
      title: t.title,
      sub: (PEOPLE[t.who] ? PEOPLE[t.who].name : t.who) + " \u00b7 nobody has set a date",
      task: true
    }));
    return UNDATED.concat(fromTasks);
  }

  function renderGlance() {
    const live = liveTasks();
    const late = TASKS.filter((t) => t.status === "late" || (t.due && t.status !== "done" && t.due < TODAY));
    $("g-open").textContent = "";
    $("g-open").appendChild(el("b", { text: String(live.length) }));
    $("g-open").appendChild(document.createTextNode(" across " + new Set(live.map((t) => t.who)).size + " people"));

    const gl = $("g-late");
    gl.className = "v" + (late.length ? " warn" : "");
    gl.textContent = late.length ? late.length + (late.length === 1 ? " job past its date" : " jobs past their date") : "Nothing overdue";

    const next = calEvents().filter((e) => e.date >= TODAY && e.state !== "past").sort((a,b) => a.date < b.date ? -1 : 1)[0];
    $("g-next").textContent = next ? pretty(next.date) + " · " + next.title : "Nothing dated";

    $("g-block").textContent = "School approval for the sale";

    $("n-updates").textContent = DAYS.length;
    $("n-calendar").textContent = calEvents().filter((e) => e.date >= TODAY && e.state !== "past").length + calUndated().length;
    $("n-tasks").textContent = liveTasks().length;
    $("n-tracker").textContent = TASKS.filter((t) => t.status === "done").length;
    $("n-photos").textContent = PHOTOS ? PHOTOS.length : "";

    const cr = fromIso(CHAT_READ);
    $("stamp").textContent = cr ? "Chat read to " + pretty(CHAT_READ) + " " + cr.getFullYear() : "";
  }

  /* ----- updates ----- */
  function renderFeed() {
    const box = $("upd-filters");
    if (!box.childElementCount) {
      const who = ["all"].concat([...new Set(DAYS.flatMap((d) => d.items.map((i) => i.who)))]);
      who.forEach((k) => {
        box.appendChild(el("button", {
          class: "chipbtn" + (k === "all" ? " plain" : ""),
          "aria-pressed": String(S.updPerson === k),
          "data-k": k,
          onclick: () => { S.updPerson = k; syncPressed(box, k); renderFeed(); }
        }, k === "all" ? [document.createTextNode("Everyone")]
                       : [avatar(k), el("span", { text: PEOPLE[k].name })]));
      });
    }

    const feed = $("feed");
    feed.innerHTML = "";
    let shown = 0;
    DAYS.forEach((day) => {
      const items = day.items.filter((i) => S.updPerson === "all" || i.who === S.updPerson);
      if (!items.length) return;
      shown++;
      const head = el("header", {}, [
        el("span", { class: "date", text: day.date ? pretty(day.date) : day.label }),
        day.date ? el("span", { class: "rel", text: relDay(day.date) }) : null,
        day.tag ? el("span", { class: "tagline", text: day.tag }) : null
      ]);
      const bullets = el("div", { class: "bullets" });
      items.forEach((i) => {
        const row = el("div", { class: "bullet" + (i.key ? " key" : "") }, [
          avatar(i.who), richText(i.text)
        ]);
        /* only entries that came from the database can be removed here;
           the ones from data.json are edited in the file */
        if (i.id && SESSION && window.ChamLive && (SESSION.admin || SESSION.personKey === i.who)) {
          row.appendChild(el("button", {
            class: "bullet-x", type: "button", title: "Remove this line",
            "aria-label": "Remove this line", text: "\u00d7",
            onclick: async () => {
              if (!window.confirm("Remove this line from the feed?")) return;
              try { await window.ChamLive.deleteUpdate(i.id); }
              catch (err) { window.alert("Could not remove it. " + (err.code || err.message)); }
            }
          }));
        }
        bullets.appendChild(row);
      });
      feed.appendChild(el("article", { class: "card day-card" }, [head, bullets]));
    });
    if (!shown) feed.appendChild(el("div", { class: "empty-state", text: "Nothing from them in the chat this stretch." }));

    const m = $("money");
    if (!m.childElementCount) {
      MONEY.forEach((x) => m.appendChild(el("div", { class: "card" }, [
        el("div", { class: "fig", text: x.fig }),
        el("div", { class: "lbl", text: x.lbl })
      ])));
    }
  }

  function syncPressed(box, k) {
    box.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === k)));
  }

  /* ----- calendar ----- */
  /* ------------------------------------------------------------------ *
   * writing the feed - admins only
   *
   * Two ways in: one line at a time, or paste a whole day out of the chat
   * and sort it into lines here. Either way it goes straight to the
   * database and shows up on everyone's phone.
   * ------------------------------------------------------------------ */
  function peopleOptions(sel) {
    Object.keys(PEOPLE)
      .filter((k) => !/^Left /.test(PEOPLE[k].role || ""))
      .forEach((k) => sel.appendChild(el("option", { value: k, text: PEOPLE[k].name })));
    return sel;
  }

  /* ------------------------------------------------------------------ *
   * reading a pasted chat
   *
   * Instagram does not paste as "Bach: hello". It puts the sender's name
   * on its own line and then their messages underneath, until the next
   * name. It also drops in timestamps, "Seen", reaction lines and other
   * furniture. This walks the lines keeping track of who is talking.
   * ------------------------------------------------------------------ */

  /** which Chạm person, if any, a line names */
  function whoIsThis(raw) {
    const line = String(raw).trim().replace(/[:\u2013-]\s*$/, "").toLowerCase();
    if (!line || line.length > 32) return null;
    const words = line.split(/\s+/);
    if (words.length > 4) return null;
    for (const k of Object.keys(PEOPLE)) {
      if (k === "team") continue;
      const name = (PEOPLE[k].name || "").toLowerCase();
      if (line === k || line === name) return k;
      /* display names like "Peter Gallagher" or "thuan__17" */
      if (words.some((w) => w.replace(/[^a-z\u00C0-\u1EF9]/g, "") === k
                         || w.replace(/[^a-z\u00C0-\u1EF9]/g, "") === name)) return k;
    }
    return null;
  }

  const CHAT_NOISE = [
    /^\d{1,2}:\d{2}(\s*[ap]m)?$/i,          // 9:41 PM
    /^(today|yesterday|now|just now)$/i,
    /^(mon|tue|wed|thu|fri|sat|sun)[a-z]*$/i,
    /^(seen|delivered|sent|you sent|active now)\b/i,
    /^\d+\s+active( today)?$/i,
    /^(liked|loved|reacted|replied)\b/i,
    /replied to (you|themselves|a message)/i,
    /^(enter|message|send|aa)$/i,
    // the furniture a real Instagram copy drags along with it
    /^user[\s-]?avatar$/i,
    /^user[\s-]?profile[\s-]?picture$/i,
    /^(profile )?photo$/i,
    /^this (photo|video) can only be/i,
    /^use the mobile app/i,
    /^(you )?(sent|forwarded) (a|an) /i,
    /^\d+ (new )?messages?$/i,
    /^(reply|forward|copy|unsend|remove)$/i,
    /^open photo/i
  ];
  function isNoise(line) {
    const t = line.trim();
    if (!t) return true;
    if (t.length < 2) return true;
    if (!/[a-z\u00C0-\u1EF9\d]/i.test(t)) return true;   // emoji or punctuation only
    return CHAT_NOISE.some((re) => re.test(t));
  }

  /** a pasted chat -> [{who, text}], attributing by the name headings */
  function parseChat(text) {
    const out = [];
    let current = "team";
    String(text).split(/\r?\n/).forEach((raw) => {
      const line = raw.trim();
      if (!line) return;

      /* "Bach: we met Mr Marshall" - still supported */
      const inline = /^\s*([A-Za-z\u00C0-\u1EF9 ._]{1,24}?)\s*[:\u2013-]\s+(.*)$/.exec(line);
      if (inline) {
        const k = whoIsThis(inline[1]);
        if (k) { out.push({ who: k, text: inline[2].trim() }); current = k; return; }
      }

      /* a name on its own line: everything after it is theirs */
      const head = whoIsThis(line);
      if (head) { current = head; return; }

      if (isNoise(line)) return;
      out.push({ who: current, text: line });
    });
    return out;
  }

  function renderUpdateAdmin() {
    const box = $("upd-admin");
    if (!box) return;
    /* Everyone signed in can log their own progress. Only admins can put
       words in somebody else's mouth, or backdate an entry. */
    const on = Boolean(SESSION && window.ChamLive);
    const admin = Boolean(SESSION && SESSION.admin);
    box.hidden = !on;
    if (!on) { box.replaceChildren(); return; }
    if (box.childElementCount) return;

    const today = isoDay(new Date());

    /* ---- one line at a time ---- */
    const date = el("input", { class: "ad-in", type: "date", value: today,
                               "aria-label": "Which day", disabled: !admin });
    const who = admin
      ? peopleOptions(el("select", { class: "ad-in", "aria-label": "Who" }))
      : el("span", { class: "ad-fixed" }, [avatar(SESSION.personKey),
          el("span", { text: PEOPLE[SESSION.personKey] ? PEOPLE[SESSION.personKey].name : "You" })]);
    who.value = admin ? who.value : SESSION.personKey;
    const text = el("input", { class: "ad-in wide", type: "text", placeholder: "What happened", "aria-label": "What happened" });
    const tag = el("input", { class: "ad-in", type: "text", placeholder: "Day label (optional)", "aria-label": "Day label" });
    const keyBox = el("input", { type: "checkbox", id: "upd-key" });
    const msg = el("span", { class: "ad-msg" });

    const post = el("button", { class: "au-go", text: "Post it",
      onclick: async () => {
        msg.classList.remove("bad");
        if (!text.value.trim()) { msg.textContent = "Type what happened first."; msg.classList.add("bad"); return; }
        post.disabled = true; post.textContent = "Posting\u2026";
        try {
          await window.ChamLive.addUpdates([{
            date: admin ? (date.value || today) : today,
            who: admin ? who.value : SESSION.personKey,
            text: text.value.trim(), key: admin ? keyBox.checked : false,
            tag: admin ? (tag.value.trim() || null) : null
          }]);
          text.value = ""; keyBox.checked = false;
          msg.textContent = "Posted. It is on everyone\u2019s phone now.";
        } catch (err) {
          msg.textContent = "Did not post. " + (err.code || err.message);
          msg.classList.add("bad");
        }
        post.disabled = false; post.textContent = "Post it";
      }
    });

    /* ---- paste a whole day ---- */
    const paste = el("textarea", { class: "ad-area", rows: "5",
      placeholder: "Paste the day\u2019s messages here, one per line.\nLines like \u201cBach: we met Mr Marshall\u201d get matched to the right person automatically.",
      "aria-label": "Paste the day\u2019s messages" });
    const drafts = el("div", { class: "drafts" });
    const pmsg = el("span", { class: "ad-msg" });

    function sortIntoLines() {
        drafts.replaceChildren();
        pmsg.textContent = "";
        const lines = parseChat(paste.value);
        if (!lines.length) {
          pmsg.textContent = paste.value.trim()
            ? "Nothing usable in there - it looked like timestamps and reactions."
            : "Paste the messages into the box first.";
          pmsg.classList.add("bad");
          return 0;
        }
        pmsg.classList.remove("bad");
        lines.forEach((entry) => {
          const w = peopleOptions(el("select", { class: "ad-in", "aria-label": "Who said it" }));
          w.value = entry.who;
          const t = el("input", { class: "ad-in wide", type: "text", value: entry.text, "aria-label": "What was said" });
          const k = el("input", { type: "checkbox", "aria-label": "Highlight this one" });
          const row = el("div", { class: "draft" }, [
            w, t,
            el("label", { class: "ad-check" }, [k, el("span", { text: "highlight" })]),
            el("button", { class: "act ghost", type: "button", text: "drop",
              onclick: () => row.remove() })
          ]);
          row._read = () => ({ who: w.value, text: t.value.trim(), key: k.checked });
          drafts.appendChild(row);
        });
        const guessed = lines.filter((l) => l.who !== "team").length;
        pmsg.textContent = lines.length + " line" + (lines.length === 1 ? "" : "s") + " ready, "
          + guessed + " matched to a person. Fix any that are wrong, then post.";
        return lines.length;
    }

    const sortBtn = el("button", { class: "act", type: "button", text: "Sort it into lines",
      onclick: () => sortIntoLines() });

    const postAll = el("button", { class: "au-go", text: "Post all of it",
      onclick: async () => {
        /* Sorting first is easy to skip, so do it for them rather than
           saying "nothing to post" at somebody who has clearly pasted. */
        if (!drafts.childElementCount && paste.value.trim()) sortIntoLines();
        const rows = [...drafts.children].map((r) => r._read()).filter((r) => r.text);
        if (!rows.length) {
          pmsg.textContent = paste.value.trim()
            ? "Nothing usable in there."
            : "Paste the messages into the box first.";
          pmsg.classList.add("bad");
          return;
        }
        pmsg.classList.remove("bad");
        postAll.disabled = true; postAll.textContent = "Posting\u2026";
        try {
          await window.ChamLive.addUpdates(rows.map((r) => ({
            date: date.value || today, who: r.who, text: r.text, key: r.key,
            tag: tag.value.trim() || null
          })));
          drafts.replaceChildren();
          paste.value = "";
          pmsg.textContent = "Posted " + rows.length + " line" + (rows.length === 1 ? "" : "s") + ".";
        } catch (err) {
          pmsg.textContent = "Did not post. " + (err.code || err.message);
          pmsg.classList.add("bad");
        }
        postAll.disabled = false; postAll.textContent = "Post all of it";
      }
    });

    box.append(
      el("h3", { class: "grp", text: admin ? "Add to the feed" : "Log what you did" }),
      el("div", { class: "adrow" }, admin
        ? [date, who, text, el("label", { class: "ad-check" }, [keyBox, el("span", { text: "highlight" })]), post]
        : [who, text, post])
    );
    if (admin) {
      box.append(
        el("div", { class: "adrow" }, [tag, msg]),
        el("details", { class: "viz-details" }, [
          el("summary", { text: "Or paste the whole day out of the chat" }),
          el("div", { class: "pastebox" }, [
            paste,
            el("div", { class: "adrow" }, [sortBtn, postAll, pmsg]),
            drafts
          ])
        ])
      );
    } else {
      box.append(el("div", { class: "adrow" }, [
        el("span", { class: "ad-msg", text: "Goes on today under your name, so everyone can see what you got done." }),
        msg
      ]));
    }
  }

  function renderCalendar() {
    const y = S.month.getFullYear(), m = S.month.getMonth();
    $("cal-month").textContent = MONTH_FULL[m] + " " + y;

    const grid = $("cal-grid");
    grid.innerHTML = "";
    DOW.forEach((d) => grid.appendChild(el("div", { class: "dow", text: d })));

    const lead = (new Date(y, m, 1).getDay() + 6) % 7;
    const start = new Date(y, m, 1 - lead);
    const ALL = calEvents();
    const byDay = {};
    ALL.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });

    for (let i = 0; i < 42; i++) {
      const d = new Date(start.getFullYear(), start.getMonth(), start.getDate() + i);
      const iso = isoDay(d);
      const evs = byDay[iso] || [];
      const cell = el("button", {
        class: "day" + (d.getMonth() !== m ? " out" : "") + (iso === TODAY ? " today" : "") + (iso === S.selected ? " sel" : ""),
        type: "button",
        "aria-label": pretty(iso) + (evs.length ? ", " + evs.length + " item" + (evs.length === 1 ? "" : "s") : ", nothing on"),
        onclick: () => { S.selected = iso; renderCalendar(); }
      }, [el("span", { class: "num", text: String(d.getDate()) })]);
      evs.slice(0, 2).forEach((e) => cell.appendChild(el("span", { class: "ev " + e.state, text: e.title })));
      if (evs.length > 2) cell.appendChild(el("span", { class: "ev", text: "+" + (evs.length - 2) }));
      grid.appendChild(cell);
    }

    const rail = $("rail");
    rail.innerHTML = "";
    const onDay = ALL.filter((e) => e.date === S.selected);
    const list = onDay.length ? onDay : ALL.filter((e) => e.date >= TODAY).sort((a,b) => a.date < b.date ? -1 : 1);
    $("rail-head").textContent = onDay.length ? "On " + pretty(S.selected) : "Coming up";
    if (!list.length) rail.appendChild(el("div", { class: "empty-state", text: "Nothing on this day." }));
    list.forEach((e) => {
      const d = fromIso(e.date);
      rail.appendChild(el("div", { class: "card evrow " + e.state }, [
        el("div", { class: "d" }, [ el("span", { text: MON[d.getMonth()] }), el("b", { text: String(d.getDate()) }) ]),
        el("div", { style: "min-width:0" }, [
          el("div", { class: "t", text: e.title }),
          el("div", { class: "sub", text: e.sub }),
          el("div", { class: "meta", style: "margin-top:5px" }, [
            el("span", { class: "pill " + (e.state === "late" ? "late" : e.state === "target" ? "doing" : e.state === "past" ? "" : "done"),
                         text: e.state === "late" ? "overdue" : e.state === "target" ? "not locked"
                             : e.state === "past" ? "happened" : (e.task ? "a job, due" : "confirmed") }),
            el("span", { class: "pill due", text: relDay(e.date) })
          ])
        ])
      ]));
    });

    const un = $("undated");
    un.replaceChildren();
    {
      calUndated().forEach((u) => un.appendChild(el("div", { class: "card evrow" }, [
        el("div", { class: "d", style: "min-width:46px" }, [el("b", { text: "?" })]),
        el("div", { style: "min-width:0" }, [
          el("div", { class: "t", text: u.title }),
          el("div", { class: "sub", text: u.sub })
        ])
      ])));
    }
  }

  $("cal-prev").addEventListener("click", () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth()-1, 1); renderCalendar(); });
  $("cal-next").addEventListener("click", () => { S.month = new Date(S.month.getFullYear(), S.month.getMonth()+1, 1); renderCalendar(); });
  $("cal-today").addEventListener("click", () => {
    const d = fromIso(TODAY);
    S.month = new Date(d.getFullYear(), d.getMonth(), 1);
    S.selected = TODAY;
    renderCalendar();
  });

  /* ----- tasks ----- */
  function renderTasks() {
    const pbox = $("task-filters");
    if (!pbox.childElementCount) {
      const order = ["all"].concat([...new Set(TASKS.map((t) => t.who))]);
      order.forEach((k) => {
        const count = k === "all" ? liveTasks().length : TASKS.filter((t) => t.who === k && t.status !== "done").length;
        pbox.appendChild(el("button", {
          class: "chipbtn" + (k === "all" ? " plain" : ""),
          "aria-pressed": String(S.person === k), "data-k": k,
          onclick: () => { S.person = k; syncPressed(pbox, k); renderTasks(); }
        }, k === "all"
          ? [document.createTextNode("Everyone"), el("span", { class: "c", text: String(count) })]
          : [avatar(k), el("span", { text: PEOPLE[k].name }), el("span", { class: "c", text: String(count) })]));
      });

      const sbox = $("status-filters");
      [["live","Still open"],["all","Everything"],["done","Finished"]].forEach(([k, label]) => {
        sbox.appendChild(el("button", {
          class: "chipbtn plain", "aria-pressed": String(S.status === k), "data-k": k,
          text: label,
          onclick: () => { S.status = k; syncPressed(sbox, k); renderTasks(); }
        }));
      });
    }

    const board = $("board");
    board.innerHTML = "";
    const who = S.person === "all" ? [...new Set(TASKS.map((t) => t.who))] : [S.person];
    let any = false;

    who.forEach((k) => {
      let rows = TASKS.filter((t) => t.who === k);
      if (S.status === "live") rows = rows.filter((t) => t.status !== "done");
      if (S.status === "done") rows = rows.filter((t) => t.status === "done");
      if (!rows.length) return;
      any = true;
      const rank = { late: 0, blocked: 1, doing: 2, open: 3, done: 4 };
      rows.sort((a,b) => (rank[a.status] - rank[b.status]) || a.title.localeCompare(b.title));

      board.appendChild(el("h3", { class: "grp" }, [
        avatar(k, true),
        el("span", { text: PEOPLE[k].name }),
        PEOPLE[k].role ? el("span", { style: "color:var(--muted);font-weight:400;text-transform:none;letter-spacing:0;font-family:var(--sans);font-size:12.5px", text: PEOPLE[k].role }) : null
      ]));

      const list = el("div", { class: "tasklist" });
      rows.forEach((t) => {
        const late = t.status === "late" || (t.due && t.status !== "done" && t.due < TODAY);
        const meta = el("div", { class: "meta" }, [
          el("span", { class: "pill " + (late ? "late" : t.status), text: late ? "overdue" : STATUS[t.status].label })
        ]);
        if (t.due) meta.appendChild(el("span", { class: "pill due", text: (late ? "was due " : "due ") + pretty(t.due) }));
        if (!t.due && t.since) meta.appendChild(el("span", { class: "pill due", text: "since " + pretty(t.since) }));
        const pct = t.status === "done" ? 100 : (t.progress || 0);
        const body = el("div", { class: "body" }, [
          el("div", { class: "tt", text: t.title }),
          t.note ? el("div", { class: "note", text: t.note }) : null,
          meta
        ]);
        if (pct > 0 && t.status !== "done") {
          body.appendChild(el("div", { class: "tprog" }, [
            el("div", { class: "tprog-track" }, [el("i", { style: "width:" + pct + "%" })]),
            el("span", { class: "tprog-n", text: pct + "%" })
          ]));
        }
        if (canEdit(t)) body.appendChild(taskActions(t));
        list.appendChild(el("article", { class: "card task s-" + (late ? "late" : t.status) }, [body]));
      });
      board.appendChild(list);
    });

    if (!any) board.appendChild(el("div", { class: "empty-state", text: "Nothing here with that filter." }));
  }

  /* ------------------------------------------------------------------ *
   * moving a job along — only shown to the person it belongs to, or to
   * an admin. Everything here goes straight to Firestore.
   * ------------------------------------------------------------------ */
  const MOVES = [["open","Not started"],["doing","Doing it"],["blocked","Stuck"],["done","Done"]];

  function taskActions(t) {
    const row = el("div", { class: "acts" });

    MOVES.forEach(([k, label]) => {
      row.appendChild(el("button", {
        class: "act" + (t.status === k ? " on" : ""),
        "aria-pressed": String(t.status === k),
        text: label,
        onclick: async (e) => {
          const b = e.currentTarget;
          if (t.status === k) return;
          b.disabled = true;
          try { await window.ChamLive.setStatus(t.id, k); }
          catch (err) { b.disabled = false; flash(row, "Did not save. " + (err.code || err.message)); }
        }
      }));
    });

    if (SESSION && SESSION.admin) {
      row.appendChild(el("button", {
        class: "act ghost", type: "button", text: "Edit",
        onclick: (e) => openEditor(t, e.currentTarget.closest("article"))
      }));
    }

    /* How far along, in the owner's own words. Marking it Done sets this
       to 100 on its own, so nobody has to do both. */
    if (t.status !== "done") {
      const now = t.progress || 0;
      const out = el("span", { class: "sl-n", text: now + "%" });
      const sl = el("input", {
        class: "sl", type: "range", min: "0", max: "100", step: "5", value: String(now),
        "aria-label": "How far along " + t.title + " is"
      });
      sl.addEventListener("input", () => { out.textContent = sl.value + "%"; });
      sl.addEventListener("change", async () => {
        sl.disabled = true;
        try { await window.ChamLive.setProgress(t.id, Number(sl.value)); }
        catch (err) { flash(row, "Did not save. " + (err.code || err.message)); }
        sl.disabled = false;
      });
      row.appendChild(el("span", { class: "slwrap" }, [
        el("span", { class: "sl-k", text: "how far" }), sl, out
      ]));
    }

    row.appendChild(el("button", {
      class: "act ghost", text: t.note ? "Edit note" : "Add note",
      onclick: async () => {
        const next = window.prompt("Note for “" + t.title + "”", t.note || "");
        if (next === null) return;
        try { await window.ChamLive.setNote(t.id, next.trim()); }
        catch (err) { flash(row, "Did not save. " + (err.code || err.message)); }
      }
    }));

    if (SESSION && SESSION.admin) {
      row.appendChild(el("button", {
        class: "act ghost danger", text: "Delete",
        onclick: async () => {
          if (!window.confirm("Delete “" + t.title + "” for good?")) return;
          try { await window.ChamLive.deleteTask(t.id); }
          catch (err) { flash(row, "Did not delete. " + (err.code || err.message)); }
        }
      }));
    }
    return row;
  }

  /** Swap a job's card for a little form. Admins only - the security rules
      refuse a title or date change from anybody else, so there is no point
      showing it to them. */
  function openEditor(t, card) {
    if (!card || card.querySelector(".tedit")) return;
    const body = card.querySelector(".body");
    body.hidden = true;

    const title = el("input", { class: "ad-in wide", type: "text", value: t.title, "aria-label": "What the job is" });
    const due = el("input", { class: "ad-in", type: "date", value: t.due || "", "aria-label": "Due date" });
    const msg = el("span", { class: "ad-msg" });

    const close = () => { form.remove(); body.hidden = false; };

    const save = el("button", { class: "au-go", type: "button", text: "Save",
      onclick: async () => {
        if (!title.value.trim()) { msg.textContent = "It needs a title."; msg.classList.add("bad"); return; }
        save.disabled = true; save.textContent = "Saving\u2026";
        try {
          await window.ChamLive.editTask(t.id, { title: title.value.trim(), due: due.value || null });
          close();
        } catch (err) {
          msg.textContent = "Did not save. " + (err.code || err.message);
          msg.classList.add("bad");
          save.disabled = false; save.textContent = "Save";
        }
      }
    });

    const form = el("div", { class: "tedit" }, [
      el("div", { class: "adrow" }, [title, due, save,
        el("button", { class: "act ghost", type: "button", text: "Cancel", onclick: close })]),
      el("div", { class: "adrow" }, [
        el("span", { class: "ad-msg", text: due.value ? "Clear the date to take it off the calendar." : "Give it a date and it appears on the calendar." }),
        msg
      ])
    ]);
    [title, due].forEach((i) => i.addEventListener("keydown", (e) => {
      if (e.key === "Enter") save.click();
      if (e.key === "Escape") close();
    }));
    card.appendChild(form);
    title.focus();
  }

  function flash(node, msg) {
    const old = node.querySelector(".act-err");
    if (old) old.remove();
    node.appendChild(el("span", { class: "act-err", text: msg }));
  }

  /* ------------------------------------------------------------------ *
   * admin panel — Peter and Bach hand out the work here
   * ------------------------------------------------------------------ */
  function renderAdmin() {
    const box = $("admin-panel");
    if (!box) return;
    const on = Boolean(SESSION && SESSION.admin && window.ChamLive);
    box.hidden = !on;
    if (!on) { box.replaceChildren(); return; }
    if (box.childElementCount) return;

    const who = el("select", { class: "ad-in", "aria-label": "Who it is for" });
    Object.keys(PEOPLE)
      .filter((k) => k !== "team" && !/^Left /.test(PEOPLE[k].role || ""))
      .forEach((k) => who.appendChild(el("option", { value: k, text: PEOPLE[k].name })));

    const title = el("input", { class: "ad-in wide", type: "text", placeholder: "What needs doing", "aria-label": "Task" });
    const due   = el("input", { class: "ad-in", type: "date", "aria-label": "Due date" });
    const note  = el("input", { class: "ad-in wide", type: "text", placeholder: "Note (optional)", "aria-label": "Note" });
    const msg   = el("span", { class: "ad-msg" });

    const go = el("button", { class: "au-go", text: "Give out this job",
      onclick: async () => {
        msg.classList.remove("bad");
        if (!title.value.trim()) { msg.textContent = "It needs a title."; msg.classList.add("bad"); return; }
        go.disabled = true; go.textContent = "Saving…";
        try {
          await window.ChamLive.addTask({
            who: who.value, title: title.value.trim(),
            note: note.value.trim(), due: due.value || null
          });
          title.value = ""; note.value = ""; due.value = "";
          msg.textContent = "Added. They will get it in tomorrow morning's email.";
        } catch (err) {
          msg.textContent = "Did not save. " + (err.code || err.message);
          msg.classList.add("bad");
        }
        go.disabled = false; go.textContent = "Give out this job";
      }
    });

    box.append(
      el("h3", { class: "grp", text: "Hand out a job" }),
      el("div", { class: "adrow" }, [who, title, due, note, go, msg])
    );
  }

  /* ------------------------------------------------------------------ *
   * tracker - the analytics view.
   *
   * Three questions, three charts: how much has everyone got through, who
   * is behind, and what is coming up. Progress is an ordered scale, so it
   * uses one hue getting darker, not four colours competing.
   * ------------------------------------------------------------------ */
  function statsFor(key) {
    const mine = TASKS.filter((t) => t.who === key);
    const isDone = (t) => t.status === "done";
    const done = mine.filter(isDone);
    const doing = mine.filter((t) => t.status === "doing");
    const rest = mine.filter((t) => !isDone(t) && t.status !== "doing");
    const open = mine.filter((t) => !isDone(t));
    const overdue = open.filter((t) => t.due && t.due < TODAY);

    let daysLate = 0, worst = 0;
    overdue.forEach((t) => {
      const n = days(t.due, TODAY) || 0;
      daysLate += n;
      if (n > worst) worst = n;
    });

    /* Average of how far along everything is, a finished job counting as
       100. Somebody most of the way through four jobs is not on zero, which
       is what counting only finished ones would claim. */
    const avg = mine.length
      ? Math.round(mine.reduce((a, t) => a + (t.status === "done" ? 100 : (t.progress || 0)), 0) / mine.length)
      : 0;

    return {
      key, total: mine.length,
      done: done.length, doing: doing.length, rest: rest.length,
      open: open.length, overdue: overdue.length,
      daysLate, worst, avg,
      pct: mine.length ? Math.round((done.length / mine.length) * 100) : 0
    };
  }

  /* one tooltip element, reused by every mark */
  let tipEl = null;
  function tip(node, lines) {
    const show = (e) => {
      if (!tipEl) { tipEl = el("div", { class: "viz-tip", role: "status" }); document.body.appendChild(tipEl); }
      tipEl.replaceChildren();
      lines.forEach((l, i) => tipEl.appendChild(el("div", { class: i ? "r" : "h", text: l })));
      tipEl.hidden = false;
      const r = node.getBoundingClientRect();
      const x = (e && e.clientX !== undefined) ? e.clientX : r.left + r.width / 2;
      tipEl.style.left = Math.min(Math.max(8, x), window.innerWidth - tipEl.offsetWidth - 8) + "px";
      tipEl.style.top = (r.top + window.scrollY - tipEl.offsetHeight - 10) + "px";
    };
    const hide = () => { if (tipEl) tipEl.hidden = true; };
    node.addEventListener("pointermove", show);
    node.addEventListener("pointerenter", show);
    node.addEventListener("focus", show);
    node.addEventListener("pointerleave", hide);
    node.addEventListener("blur", hide);
  }

  const STAGES = [
    { k: "done",  cls: "s-done",  label: "Finished" },
    { k: "doing", cls: "s-doing", label: "In progress" },
    { k: "rest",  cls: "s-rest",  label: "Not started" }
  ];

  function legend(items) {
    const box = el("div", { class: "viz-legend" });
    items.forEach(([cls, label]) => {
      box.appendChild(el("span", { class: "lg" }, [
        el("i", { class: "sw " + cls, "aria-hidden": "true" }),
        el("span", { text: label })
      ]));
    });
    return box;
  }

  function renderTracker() {
    const sbox = $("track-sort");
    if (!sbox.childElementCount) {
      [["behind","Furthest behind"],["done","Most finished"],["far","Furthest along"],["load","Biggest workload"],["name","By name"]].forEach(([k, label]) => {
        sbox.appendChild(el("button", {
          class: "chipbtn plain", "aria-pressed": String(S.trackSort === k), "data-k": k,
          text: label,
          onclick: () => { S.trackSort = k; syncPressed(sbox, k); renderTracker(); }
        }));
      });
    }

    const rows = [...new Set(TASKS.map((t) => t.who))].filter((k) => PEOPLE[k]).map(statsFor);

    const tot = rows.reduce((a, r) => ({
      done: a.done + r.done, open: a.open + r.open,
      overdue: a.overdue + r.overdue, daysLate: a.daysLate + r.daysLate
    }), { done: 0, open: 0, overdue: 0, daysLate: 0 });

    /* ----- the four headline numbers ----- */
    const line = $("team-line");
    line.replaceChildren();
    [
      ["Finished", tot.done, false],
      ["Still open", tot.open, false],
      ["Past its date", tot.overdue, tot.overdue > 0],
      ["Days late, all told", tot.daysLate, tot.daysLate > 0]
    ].forEach(([k, v, bad]) => {
      line.appendChild(el("div", { class: "kpi" }, [
        el("span", { class: "tl-k", text: k }),
        el("span", { class: "tl-n" + (bad ? " bad" : ""), text: String(v) })
      ]));
    });

    if (S.trackSort === "done")      rows.sort((a,b) => b.done - a.done || b.pct - a.pct);
    else if (S.trackSort === "name") rows.sort((a,b) => PEOPLE[a.key].name.localeCompare(PEOPLE[b.key].name));
    else if (S.trackSort === "load") rows.sort((a,b) => b.total - a.total || b.open - a.open);
    else if (S.trackSort === "far") rows.sort((a,b) => b.avg - a.avg || b.done - a.done);
    else rows.sort((a,b) => b.daysLate - a.daysLate || b.overdue - a.overdue || b.open - a.open);

    const box = $("tracker");
    box.replaceChildren();

    /* ----- chart 1: workload and progress ----- */
    const most = Math.max(1, ...rows.map((r) => r.total));
    const c1 = el("section", { class: "viz" }, [
      el("h3", { class: "viz-h", text: "Every job, and how far along it is" }),
      el("p", { class: "viz-sub", text: "One row per person. The bar is their whole workload, so a long bar means a lot on their plate." }),
      legend(STAGES.map((st) => [st.cls, st.label]))
    ]);

    const plot1 = el("div", { class: "viz-plot" });
    rows.forEach((r) => {
      const track = el("div", { class: "hbar", style: "width:" + Math.round((r.total / most) * 100) + "%" });
      STAGES.forEach((st) => {
        const n = r[st.k];
        if (!n) return;
        const seg = el("button", {
          class: "seg " + st.cls, type: "button",
          style: "flex:" + n + " 0 0",
          "aria-label": PEOPLE[r.key].name + ": " + n + " " + st.label.toLowerCase()
        });
        tip(seg, [PEOPLE[r.key].name, n + " " + st.label.toLowerCase() + " of " + r.total,
                  r.avg + "% of the way through overall"]);
        track.appendChild(seg);
      });

      plot1.appendChild(el("div", { class: "hrow" }, [
        el("span", { class: "hname" }, [avatar(r.key), el("span", { text: PEOPLE[r.key].name })]),
        el("div", { class: "htrack" }, [track]),
        el("span", { class: "hval", text: r.avg + "%", title: r.done + " of " + r.total + " finished" })
      ]));
    });
    c1.appendChild(plot1);
    box.appendChild(c1);

    /* ----- chart 2: who is behind. only those who are. ----- */
    const behind = rows.filter((r) => r.daysLate > 0).sort((a,b) => b.daysLate - a.daysLate);
    const c2 = el("section", { class: "viz" }, [
      el("h3", { class: "viz-h", text: "Days past the date" }),
      el("p", { class: "viz-sub", text: "Every day, added up, that an unfinished job has sat past its due date." })
    ]);
    if (!behind.length) {
      c2.appendChild(el("div", { class: "viz-none", text: "Nobody is behind. Every job with a date is still inside it." }));
    } else if (behind.length === 1) {
      /* one value is a number, not a chart - a lone bar at full width
         reads as "enormous" when it might be a single day */
      const r = behind[0];
      c2.appendChild(el("div", { class: "viz-one" }, [
        avatar(r.key, true),
        el("span", { class: "one-n", text: String(r.daysLate) }),
        el("span", { class: "one-k", text: "day" + (r.daysLate === 1 ? "" : "s") + " late \u00b7 "
          + PEOPLE[r.key].name + " \u00b7 " + r.overdue + " job" + (r.overdue === 1 ? "" : "s") }),
        el("span", { class: "one-sub", text: "Nobody else has anything past its date." })
      ]));
    } else {
      const worst = Math.max(...behind.map((r) => r.daysLate));
      const plot2 = el("div", { class: "viz-plot" });
      behind.forEach((r) => {
        const bar = el("button", {
          class: "lbar", type: "button",
          style: "width:" + Math.round((r.daysLate / worst) * 100) + "%",
          "aria-label": PEOPLE[r.key].name + ": " + r.daysLate + " days late across " + r.overdue + " jobs"
        });
        tip(bar, [PEOPLE[r.key].name,
                  r.daysLate + " day" + (r.daysLate === 1 ? "" : "s") + " late across " + r.overdue + " job" + (r.overdue === 1 ? "" : "s"),
                  "worst one is " + r.worst + " day" + (r.worst === 1 ? "" : "s") + " over"]);
        plot2.appendChild(el("div", { class: "hrow" }, [
          el("span", { class: "hname" }, [avatar(r.key), el("span", { text: PEOPLE[r.key].name })]),
          el("div", { class: "htrack" }, [bar]),
          el("span", { class: "hval bad", text: String(r.daysLate) })
        ]));
      });
      c2.appendChild(plot2);
    }
    box.appendChild(c2);

    /* ----- chart 3: what is coming ----- */
    const openTasks = TASKS.filter((t) => t.status !== "done");
    const buckets = [
      { label: "Overdue", sub: "already past its date", n: 0, cls: "b-late" },
      { label: "This week", sub: "due in the next 7 days", n: 0, cls: "b-now" },
      { label: "Week 2", sub: "due in 8 to 14 days", n: 0, cls: "b-now" },
      { label: "Week 3+", sub: "due in 15 days or more", n: 0, cls: "b-far" },
      { label: "No date", sub: "nobody has set a date", n: 0, cls: "b-none" }
    ];
    openTasks.forEach((t) => {
      if (!t.due) { buckets[4].n++; return; }
      const d = days(TODAY, t.due);
      if (d === null) { buckets[4].n++; return; }
      if (d < 0) buckets[0].n++;
      else if (d <= 7) buckets[1].n++;
      else if (d <= 14) buckets[2].n++;
      else buckets[3].n++;
    });
    const tallest = Math.max(1, ...buckets.map((b) => b.n));

    const cols = el("div", { class: "viz-cols" });
    buckets.forEach((b) => {
      const col = el("button", { class: "colwrap", type: "button",
        "aria-label": b.label + ": " + b.n + " jobs, " + b.sub });
      tip(col, [b.label, b.n + " job" + (b.n === 1 ? "" : "s"), b.sub]);
      col.append(
        el("span", { class: "coltrack" }, [
          el("span", { class: "colstack", style: "height:" + (b.n ? Math.max(4, Math.round((b.n / tallest) * 100)) : 0) + "%" }, [
            el("span", { class: "colval" + (b.n ? "" : " zero"), text: String(b.n) }),
            b.n ? el("i", { class: "col " + b.cls }) : null
          ])
        ]),
        el("span", { class: "collab", text: b.label })
      );
      cols.appendChild(col);
    });

    box.appendChild(el("section", { class: "viz" }, [
      el("h3", { class: "viz-h", text: "What is coming up" }),
      el("p", { class: "viz-sub", text: "Unfinished jobs only. The last column is the one to watch: things nobody has put a date on." }),
      cols
    ]));

    /* ----- the same numbers plainly, for anyone who would rather read them ----- */
    const tbl = el("table", { class: "viz-table" });
    tbl.appendChild(el("thead", {}, [el("tr", {}, ["Person","Jobs","Finished","In progress","Not started","How far","Overdue","Days late"]
      .map((h) => el("th", { text: h, scope: "col" })))]));
    const tb = el("tbody");
    rows.forEach((r) => {
      tb.appendChild(el("tr", {}, [
        el("th", { scope: "row", text: PEOPLE[r.key].name })
      ].concat([r.total, r.done, r.doing, r.rest, r.avg + "%", r.overdue, r.daysLate].map((v) => el("td", { text: String(v) })))));
    });
    tbl.appendChild(tb);
    box.appendChild(el("details", { class: "viz-details" }, [
      el("summary", { text: "See it as a table" }), tbl
    ]));

    if (!rows.length) box.replaceChildren(el("div", { class: "empty-state", text: "No jobs to count yet." }));
  }

  /* ------------------------------------------------------------------ *
   * photos
   *
   * Firebase Storage needs a paid plan on this project, so pictures are
   * shrunk in the browser and kept inline in the database instead. That
   * keeps them behind the login, which matters: these are photographs of
   * students and the rest of this site is public.
   * ------------------------------------------------------------------ */
  const PHOTO_MAX = 1280;      // longest edge, in pixels
  const PHOTO_BUDGET = 700000; // bytes of encoded text, under the 1MB field limit

  function shrink(file) {
    return new Promise((resolve, reject) => {
      const img = new Image();
      const url = URL.createObjectURL(file);
      img.onload = () => {
        URL.revokeObjectURL(url);
        const scale = Math.min(1, PHOTO_MAX / Math.max(img.width, img.height));
        const w = Math.max(1, Math.round(img.width * scale));
        const h = Math.max(1, Math.round(img.height * scale));
        const c = document.createElement("canvas");
        c.width = w; c.height = h;
        c.getContext("2d").drawImage(img, 0, 0, w, h);
        /* step the quality down until it fits, rather than refusing a big photo */
        let q = 0.78, out = c.toDataURL("image/jpeg", q);
        while (out.length > PHOTO_BUDGET && q > 0.35) {
          q -= 0.12;
          out = c.toDataURL("image/jpeg", q);
        }
        if (out.length > PHOTO_BUDGET) return reject(new Error("still too big after shrinking"));
        resolve({ data: out, w, h });
      };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("not an image we can read")); };
      img.src = url;
    });
  }

  function renderPhotoAdd() {
    const box = $("photo-add");
    if (!box) return;
    const on = Boolean(SESSION && window.ChamLive);
    box.hidden = !on;
    if (!on) { box.replaceChildren(); return; }
    if (box.childElementCount) return;

    const file = el("input", { class: "ad-in", type: "file", accept: "image/*", multiple: true, "aria-label": "Pick photos" });
    const cap = el("input", { class: "ad-in wide", type: "text", placeholder: "What is it? (optional)", "aria-label": "Caption" });
    const msg = el("span", { class: "ad-msg" });

    const go = el("button", { class: "au-go", type: "button", text: "Add them",
      onclick: async () => {
        const files = [...(file.files || [])];
        if (!files.length) { msg.textContent = "Pick a photo first."; msg.classList.add("bad"); return; }
        msg.classList.remove("bad");
        go.disabled = true;
        let done = 0, failed = 0;
        for (const f of files) {
          go.textContent = "Adding " + (done + failed + 1) + " of " + files.length + "\u2026";
          try {
            const shrunk = await shrink(f);
            await window.ChamLive.addPhoto({
              date: isoDay(new Date()), who: SESSION.personKey,
              caption: cap.value.trim(), data: shrunk.data, w: shrunk.w, h: shrunk.h
            });
            done++;
          } catch (err) {
            failed++;
            console.error("photo failed", f.name, err);
          }
        }
        file.value = ""; cap.value = "";
        go.disabled = false; go.textContent = "Add them";
        msg.textContent = done + " added" + (failed ? ", " + failed + " would not go" : "") + ".";
        if (failed) msg.classList.add("bad");
      }
    });

    box.append(
      el("h3", { class: "grp", text: "Add photos" }),
      el("div", { class: "adrow" }, [file, cap, go]),
      el("div", { class: "adrow" }, [msg])
    );
  }

  function openLightbox(ph) {
    const lb = $("lightbox");
    $("lb-img").src = ph.data;
    $("lb-cap").textContent = (PEOPLE[ph.who] ? PEOPLE[ph.who].name : ph.who)
      + (ph.date ? " \u00b7 " + pretty(ph.date) : "") + (ph.caption ? " \u00b7 " + ph.caption : "");
    const dl = $("lb-dl");
    dl.href = ph.data;
    dl.download = "cham-" + (ph.date || "photo") + ".jpg";
    lb.hidden = false;
    $("lb-close").focus();
  }
  (function lightboxWiring() {
    const lb = $("lightbox");
    if (!lb) return;
    const close = () => { lb.hidden = true; $("lb-img").src = ""; };
    $("lb-close").addEventListener("click", close);
    lb.addEventListener("click", (e) => { if (e.target === lb) close(); });
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && !lb.hidden) close(); });
  })();

  function renderPhotos() {
    renderPhotoAdd();

    const grid = $("photo-grid");
    grid.replaceChildren();

    if (!SESSION) {
      grid.appendChild(el("div", { class: "empty-state", text: "Sign in to see the photos. They are kept off the public page on purpose." }));
      $("photo-filters").replaceChildren();
      return;
    }
    if (!PHOTOS || !PHOTOS.length) {
      grid.appendChild(el("div", { class: "empty-state", text: "No photos yet. Add the first one." }));
      return;
    }

    const fbox = $("photo-filters");
    if (!fbox.childElementCount) {
      ["all"].concat([...new Set(PHOTOS.map((p) => p.who))]).forEach((k) => {
        fbox.appendChild(el("button", {
          class: "chipbtn" + (k === "all" ? " plain" : ""),
          "aria-pressed": String(S.photoPerson === k), "data-k": k,
          onclick: () => { S.photoPerson = k; syncPressed(fbox, k); renderPhotos(); }
        }, k === "all" ? [document.createTextNode("Everyone")]
                       : [avatar(k), el("span", { text: PEOPLE[k] ? PEOPLE[k].name : k })]));
      });
    }

    const rows = PHOTOS
      .filter((p) => S.photoPerson === "all" || p.who === S.photoPerson)
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    if (!rows.length) {
      grid.appendChild(el("div", { class: "empty-state", text: "Nothing from them yet." }));
      return;
    }

    const wall = el("div", { class: "pgrid" });
    rows.forEach((ph) => {
      const tile = el("button", { class: "ptile", type: "button",
        "aria-label": "Open photo from " + (PEOPLE[ph.who] ? PEOPLE[ph.who].name : ph.who),
        onclick: () => openLightbox(ph) },
        [el("img", { src: ph.data, alt: ph.caption || "", loading: "lazy" })]);

      const foot = el("div", { class: "pfoot" }, [
        avatar(ph.who),
        el("span", { class: "pcap", text: ph.caption || (ph.date ? pretty(ph.date) : "") })
      ]);

      if (SESSION.admin || SESSION.personKey === ph.who) {
        foot.appendChild(el("button", {
          class: "act ghost danger", type: "button", text: "remove",
          onclick: async () => {
            if (!window.confirm("Remove this photo?")) return;
            try { await window.ChamLive.deletePhoto(ph.id); }
            catch (err) { window.alert("Could not remove it. " + (err.code || err.message)); }
          }
        }));
      }
      wall.appendChild(el("figure", { class: "pcard" }, [tile, foot]));
    });
    grid.appendChild(wall);
  }

  /* ----- footer ----- */
  (function foot() {
    const l = $("links");
    LINKS.forEach((x) => l.appendChild(el("a", { href: x.url, target: "_blank", rel: "noopener noreferrer", text: x.label })));
    $("foot-note").textContent =
      "Built from the ISHCMC Chạm Nonprofit group chat, read up to Fri 25 Sep 2026. Peter keeps it updated, tell him in the chat if something here is wrong. " +
      "This is an unlisted link, not a locked door: anyone who has the link can read it, so keep phone numbers, addresses and anything personal off it.";
  })();

  /* ------------------------------------------------------------------ *
   * home screen install: manifest + iOS meta tags, injected at runtime
   * ------------------------------------------------------------------ */
  (function installable() {
    const bar = $("install"), txt = $("install-txt"), go = $("install-go");
    const installed = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
    let dismissed = false;
    try { dismissed = localStorage.getItem("cham-install-hidden") === "1"; } catch (_) {}
    if (installed || dismissed) return;

    const hide = (remember) => {
      bar.hidden = true;
      if (remember) { try { localStorage.setItem("cham-install-hidden", "1"); } catch (_) {} }
    };
    $("install-x").addEventListener("click", () => hide(true));

    // Android and desktop Chrome: a real install prompt
    let deferred = null;
    window.addEventListener("beforeinstallprompt", (e) => {
      e.preventDefault();
      deferred = e;
      txt.textContent = "Keep Chạm HQ one tap away.";
      go.hidden = false;
      bar.hidden = false;
    });
    go.addEventListener("click", async () => {
      if (!deferred) return;
      go.disabled = true;
      deferred.prompt();
      try { await deferred.userChoice; } catch (_) {}
      deferred = null;
      hide(true);
    });
    window.addEventListener("appinstalled", () => hide(true));

    // iPhone and iPad: Safari has no prompt, so say where the button is
    const ua = navigator.userAgent;
    const isIOS = /iPhone|iPad|iPod/.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
    if (isIOS && /Safari/.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua)) {
      txt.textContent = "";
      txt.appendChild(document.createTextNode("Add to your home screen: tap "));
      txt.appendChild(el("b", { text: "Share" }));
      txt.appendChild(document.createTextNode(", then "));
      txt.appendChild(el("b", { text: "Add to Home Screen" }));
      txt.appendChild(document.createTextNode("."));
      bar.hidden = false;
    }
  })();

  if ("serviceWorker" in navigator && location.protocol === "https:") {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((e) => console.warn("sw:", e));
    });
  }

  setView("updates");
})();

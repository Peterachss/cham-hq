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
  let LEDGER = null;
  let DRAFTS = null;
  let ANNOUNCES = null;

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
      d.items.push({ who: u.who, text: u.text, key: u.key, id: u.id, auto: u.auto === true,
                     event: u.event || null, amount: u.amount, kind: u.kind });
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
    setDrafts(rows) {
      DRAFTS = Array.isArray(rows) ? rows : null;
      if (S.view === "updates") renderDrafts();
    },
    setMoney(rows) {
      LEDGER = Array.isArray(rows) ? rows : null;
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
      pushState = null; pushSavedThisSession = false;
      mascotAutoDone = false; sessionKnown = true;
      if (!s) closeMoneySheet();
      /* Panels are built once and then left alone, so they have to be torn
         down when the person changes - otherwise signing in after somebody
         else leaves you looking at their buttons. */
      ["task-filters","status-filters","upd-filters","photo-filters",
       "upd-admin","admin-panel","photo-add","money-add","money-tools","money-filters","announce"].forEach((id) => {
        const n = $(id); if (n) n.replaceChildren();
      });
      render();
      if (s && pendingLog) setTimeout(openMoneySheet, 0);
    },
    setAnnouncements(rows) { ANNOUNCES = rows; renderAnnounce(); },
    personName: (k) => (PEOPLE[k] ? PEOPLE[k].name : null),
    personRole: (k) => (PEOPLE[k] ? PEOPLE[k].role : null)
  };

  /* ------------------------------------------------------------------ *
   * the feed writes itself
   *
   * Whenever something worth knowing happens on the site - a job finished,
   * somebody stuck, work handed out, photos added, money logged - a line
   * goes into the day-by-day feed on its own. Nobody has to type up what
   * happened; the site already knows.
   *
   * Fire and forget: if it fails, the thing the person actually did has
   * still been saved, and that is what matters.
   * ------------------------------------------------------------------ */
  function logActivity(entry) {
    if (!SESSION || !window.ChamLive || !window.ChamLive.addUpdates) return;
    const today = isoDay(new Date());
    /* the same job finished twice in a day is one line, not two */
    if (entry.ref && LIVE_UPDATES &&
        LIVE_UPDATES.some((u) => u.auto && u.ref === entry.ref && u.event === entry.event && u.date === today)) return;
    window.ChamLive.addUpdates([{
      date: today, who: entry.who, text: entry.text,
      key: entry.key === true, auto: true, event: entry.event, ref: entry.ref || null,
      amount: typeof entry.amount === "number" ? entry.amount : null, kind: entry.kind || null
    }]).catch((err) => console.warn("Ch\u1ea1m HQ: activity line not saved", err));
  }

  /* ------------------------------------------------------------------ *
   * notifications
   *
   * Web Push, the browsers' own system - free, no app store, nothing to
   * install. What it can and cannot do depends on the device, and every
   * dead end below says so plainly instead of a button that does nothing:
   *   - Android and computers: works in Chrome, Edge and Firefox.
   *   - iPhone: ONLY from the Home Screen app (iOS 16.4 or later). Safari
   *     in a normal tab has no push at all, so the button would be a lie.
   * ------------------------------------------------------------------ */
  const PUSH_OK = "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  const IS_IOS = /iPad|iPhone|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const IS_STANDALONE = (window.matchMedia && window.matchMedia("(display-mode: standalone)").matches)
    || navigator.standalone === true;
  let pushState = null;      // null until checked; then "on" | "off" | "denied" | "ios" | "none"
  let pushChecking = false;
  let pushSavedThisSession = false;

  function b64uToU8(b64u) {
    const pad = "=".repeat((4 - (b64u.length % 4)) % 4);
    const raw = atob((b64u + pad).replace(/-/g, "+").replace(/_/g, "/"));
    return Uint8Array.from(raw, (c) => c.charCodeAt(0));
  }
  function deviceLabel() {
    const u = navigator.userAgent;
    const os = /iPhone|iPad|iPod/.test(u) ? "iPhone" : /Android/.test(u) ? "Android"
      : /Mac/.test(u) ? "Mac" : /Windows/.test(u) ? "Windows" : "Other";
    const br = /Edg\//.test(u) ? "Edge" : /Firefox\//.test(u) ? "Firefox"
      : /Chrome\//.test(u) ? "Chrome" : /Safari\//.test(u) ? "Safari" : "";
    return os + (br ? " \u00b7 " + br : "") + (IS_STANDALONE ? " \u00b7 app" : "");
  }
  const dismissedUntil = () => { try { return Number(localStorage.getItem("cham-notify-later") || 0); } catch (e) { return 0; } };
  const dismissForAWeek = () => { try { localStorage.setItem("cham-notify-later", String(Date.now() + 7 * 864e5)); } catch (e) {} };

  async function checkPush() {
    if (pushChecking) return;
    pushChecking = true;
    try {
      if (!PUSH_OK) { pushState = IS_IOS && !IS_STANDALONE ? "ios" : "none"; return; }
      if (Notification.permission === "denied") { pushState = "denied"; return; }
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      pushState = sub && Notification.permission === "granted" ? "on" : "off";
      /* keep this device's subscription on file for whoever is signed in */
      if (pushState === "on" && SESSION && window.ChamLive && !pushSavedThisSession) {
        pushSavedThisSession = true;
        window.ChamLive.savePushSub(sub.toJSON(), deviceLabel()).catch(() => { pushSavedThisSession = false; });
      }
    } catch (err) {
      console.warn("Ch\u1ea1m HQ: could not check notifications", err);
      pushState = "none";
    } finally {
      pushChecking = false;
      drawNotify();
    }
  }

  async function turnPushOn(btn, msg) {
    btn.disabled = true; btn.textContent = "Asking\u2026";
    try {
      const perm = await Notification.requestPermission();
      if (perm !== "granted") { pushState = perm === "denied" ? "denied" : "off"; drawNotify(); return; }
      if (!navigator.serviceWorker.controller) await navigator.serviceWorker.register("sw.js");
      const reg = await navigator.serviceWorker.ready;
      let sub = await reg.pushManager.getSubscription();
      if (!sub) sub = await reg.pushManager.subscribe({
        userVisibleOnly: true, applicationServerKey: b64uToU8(window.CHAM_PUSH_KEY)
      });
      await window.ChamLive.savePushSub(sub.toJSON(), deviceLabel());
      pushSavedThisSession = true;
      pushState = "on";
      /* a local one, straight away, so they know this device can show them */
      await reg.showNotification("Notifications are on", {
        body: "You\u2019ll hear about new jobs, anything due, and a round-up at 9pm.",
        icon: "icons/icon-192.png", badge: "icons/icon-192.png", tag: "cham-on"
      });
      drawNotify();
    } catch (err) {
      console.error("Ch\u1ea1m HQ: turning notifications on failed", err);
      btn.disabled = false; btn.textContent = "Turn on notifications";
      msg.textContent = "That didn\u2019t work on this browser (" + (err.name || "error") + "). Try Chrome, or on iPhone the Home Screen app.";
      msg.classList.add("bad");
    }
  }

  async function turnPushOff() {
    try {
      const reg = await navigator.serviceWorker.getRegistration();
      const sub = reg && await reg.pushManager.getSubscription();
      if (sub) {
        await window.ChamLive.deletePushSub(sub.endpoint).catch(() => {});
        await sub.unsubscribe();
      }
    } catch (err) { console.warn(err); }
    pushState = "off";
    dismissForAWeek();
    drawNotify();
  }

  function renderNotify() {
    if (!SESSION || !window.ChamLive) { const b = $("notify-bar"); if (b) b.hidden = true; return; }
    if (pushState === null) { checkPush(); return; }
    drawNotify();
  }

  function drawNotify() {
    const bar = $("notify-bar");
    if (!bar) return;
    bar.replaceChildren();
    bar.className = "";
    if (!SESSION || !window.ChamLive || pushState === null) { bar.hidden = true; return; }

    const msg = el("span", { class: "nb-msg" });

    if (pushState === "on") {
      bar.className = "nb nb-on";
      bar.append(
        el("span", { class: "nb-dot", "aria-hidden": "true" }),
        el("span", { class: "nb-text", text: "Notifications on for this device" }),
        el("button", { class: "nb-link", type: "button", text: "Turn off", onclick: turnPushOff })
      );
      bar.hidden = false;
      return;
    }

    if (Date.now() < dismissedUntil()) { bar.hidden = true; return; }

    const later = el("button", { class: "nb-link", type: "button", text: "Not now",
      onclick: () => { dismissForAWeek(); bar.hidden = true; } });

    bar.className = "nb";
    if (pushState === "ios") {
      bar.append(el("div", { class: "nb-body" }, [
        el("b", { text: "Want notifications on your iPhone?" }),
        el("span", { text: "Apple only allows them from the Home Screen app. Tap Share \u2192 Add to Home Screen, open Ch\u1ea1m HQ from your Home Screen, sign in, and the button will be here." })
      ]), later);
    } else if (pushState === "denied") {
      bar.append(el("div", { class: "nb-body" }, [
        el("b", { text: "Notifications are blocked for this site" }),
        el("span", { text: "Click the padlock next to the web address, set Notifications to Allow, then reload." })
      ]), later);
    } else if (pushState === "none") {
      bar.append(el("div", { class: "nb-body" }, [
        el("b", { text: "This browser can\u2019t do notifications" }),
        el("span", { text: "Chrome, Edge or Firefox can \u2014 or on iPhone, the Home Screen app." })
      ]), later);
    } else {
      const go = el("button", { class: "au-go", type: "button", text: "Turn on notifications" });
      go.addEventListener("click", () => turnPushOn(go, msg));
      bar.append(el("div", { class: "nb-body" }, [
        el("b", { text: "Get told, instead of checking" }),
        el("span", { text: "When you\u2019re given a job, when something\u2019s due, and a round-up of the day at 9pm." }),
        msg
      ]), el("div", { class: "nb-btns" }, [go, later]));
    }
    bar.hidden = false;
  }

  if (PUSH_OK) {
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data && e.data.type === "push-resubscribe") { pushSavedThisSession = false; pushState = null; renderNotify(); }
    });
  }

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
    moneyKind: "out",
    moneyShow: "all",
    month: (() => { const d = fromIso(TODAY); return new Date(d.getFullYear(), d.getMonth(), 1); })(),
    selected: TODAY
  };

  const VIEWS = ["updates","calendar","tasks","money","photos","tracker"];
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
    if (location.hash.slice(1) !== v) {
      try { history.replaceState(null, "", location.pathname + location.search + (v === "updates" ? "" : "#" + v)); } catch (e) {}
    }
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
    renderNotify();
    renderFab();
    renderMascot();
    if (S.view === "updates") { renderAnnounce(); renderDrafts(); renderFeed(); renderUpdateAdmin(); }
    if (S.view === "calendar") renderCalendar();
    if (S.view === "tasks") renderTasks();
    if (S.view === "money") renderMoney();
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
    /* for Thuan the useful number is what has not reached the sheet yet */
    $("n-money").textContent = LEDGER ? (LEDGER.filter((m) => m.status === "new").length || "") : "";

    const cr = fromIso(CHAT_READ);
    $("stamp").textContent = cr ? "Chat read to " + pretty(CHAT_READ) + " " + cr.getFullYear() : "";
  }

  /* ----- updates ----- */
  /* ------------------------------------------------------------------ *
   * one line that says what a day added up to, worked out from what the
   * site recorded - so it is counted, not guessed
   * ------------------------------------------------------------------ */
  function daySummary(items) {
    const n = (ev) => items.filter((i) => i.event === ev).length;
    const done = n("done"), stuck = n("stuck"), given = n("assign"), pics = n("photos");
    const out = items.filter((i) => i.event === "money" && i.kind === "out" && typeof i.amount === "number")
                     .reduce((a, i) => a + i.amount, 0);
    const inn = items.filter((i) => i.event === "money" && i.kind === "in" && typeof i.amount === "number")
                     .reduce((a, i) => a + i.amount, 0);
    const said = items.filter((i) => !i.auto).length;

    const bits = [];
    if (done)  bits.push([done + " finished", "ok"]);
    if (stuck) bits.push([stuck + " stuck", "bad"]);
    if (given) bits.push([given + " new job" + (given === 1 ? "" : "s"), ""]);
    if (out)   bits.push([fmtVnd(out) + " spent", ""]);
    if (inn)   bits.push([fmtVnd(inn) + " in", "ok"]);
    if (pics)  bits.push([pics + " photo post" + (pics === 1 ? "" : "s"), ""]);
    if (said && bits.length) bits.push([said + " update" + (said === 1 ? "" : "s"), ""]);
    /* a day that is only people's words needs no counting line */
    if (!bits.length) return null;

    const line = el("div", { class: "daysum", "aria-label": "The day in short" });
    bits.forEach(([t, tone], i) => {
      if (i) line.appendChild(el("span", { class: "ds-sep", "aria-hidden": "true", text: "\u00b7" }));
      line.appendChild(el("span", { class: "ds-bit" + (tone ? " " + tone : ""), text: t }));
    });
    return line;
  }

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
      const sum = daySummary(day.items);
      const bullets = el("div", { class: "bullets" });
      items.forEach((i) => {
        const row = el("div", { class: "bullet" + (i.key ? " key" : "") + (i.auto ? " auto" : "") }, [
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
      feed.appendChild(el("article", { class: "card day-card" }, [head, sum, bullets]));
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

  /* Is this line chatter or something worth recording? A guess, made in
     the open: every line still shows, chatter just starts un-ticked, and
     one click keeps it. Anything with a number, a date, money, or a
     decision in it is kept, however short. */
  const KEEP_SIGNAL = new RegExp([
    "\\d",                                                     // amounts, dates, times, counts
    "\\b(today|tomorrow|tonight|yesterday|monday|tuesday|wednesday|thursday|friday|saturday|sunday|week|deadline|due|by then)\\b",
    "\\b(k|tr|vnd|dong|price|cost|budget|paid|pay|spent|bought|sell|sold|profit|money|fund)\\b",
    "\\b(approved|approve|decided|decide|confirmed|confirm|agreed|cancel|cancelled|postpone|moved|booked)\\b",
    "\\b(need|needs|will|going to|gonna|must|should|plan|planned|assigned|finished|done|sent|submitted|started)\\b",
    "\\b(meeting|sale|event|proposal|design|merch|poster|order|form|sheet|deck|slides)\\b"
  ].join("|"), "i");
  const FILLER = /^(ok(ay)?|k+|yes+|yeah+|ya|yep|yup|no+|nope|lol+|lmao+|ha(ha)+|h+a+|hha+|he(he)+|omg|same|true|fr|bruh+|nice|cool|thanks?|thank you|ty|sure|wait|what|huh|oh+|ah+|hmm+|damn|bro|guys|oh yeah( guys)?|good job|gj|gl|w|l)[.!?\s]*$/i;

  function isChatter(text) {
    const t = String(text).trim();
    if (!t) return true;
    if (FILLER.test(t)) return true;
    if (/^@[\w.]+\s*$/.test(t)) return true;                    // a bare @mention
    if (KEEP_SIGNAL.test(t)) return false;
    return t.length < 28;                                       // short and signal-free
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

  /* ------------------------------------------------------------------ *
   * tonight's chat wrap, waiting for a look
   *
   * The nightly job reads the chat and sorts it, but it never posts on its
   * own: a filter is a guess, and a group chat has things in it that should
   * not sit under people's names. It lands here instead, with chatter
   * already un-ticked, and one tap posts the rest.
   * ------------------------------------------------------------------ */
  function renderDrafts() {
    const box = $("chat-drafts");
    if (!box) return;
    box.replaceChildren();
    if (!SESSION || !SESSION.admin || !DRAFTS || !DRAFTS.length || !window.ChamLive) return;

    DRAFTS.slice().sort((a, b) => b.date.localeCompare(a.date)).forEach((d) => {
      const rows = el("div", { class: "drafts" });
      d.lines.forEach((ln) => {
        const keep = el("input", { type: "checkbox", "aria-label": "Post this line" });
        keep.checked = ln.keep !== false;
        const w = peopleOptions(el("select", { class: "ad-in", "aria-label": "Who said it" }));
        w.value = ln.who || "team";
        const t = el("input", { class: "ad-in wide", type: "text", value: ln.text || "", "aria-label": "What was said" });
        const row = el("div", { class: "draft" + (keep.checked ? "" : " chatter") }, [
          el("label", { class: "ad-check keep" }, [keep]), w, t
        ]);
        keep.addEventListener("change", () => { row.classList.toggle("chatter", !keep.checked); count(); });
        row._read = () => ({ who: w.value, text: t.value.trim(), keep: keep.checked, key: Boolean(ln.key) });
        rows.appendChild(row);
      });

      const msg = el("span", { class: "ad-msg" });
      const post = el("button", { class: "au-go", type: "button" });
      const count = () => {
        const n = [...rows.children].filter((r) => r._read().keep && r._read().text).length;
        post.textContent = n ? "Post " + n + " line" + (n === 1 ? "" : "s") : "Nothing ticked";
        post.disabled = !n;
      };
      count();

      post.addEventListener("click", async () => {
        const keep = [...rows.children].map((r) => r._read()).filter((r) => r.keep && r.text);
        post.disabled = true; post.textContent = "Posting\u2026";
        try {
          await window.ChamLive.addUpdates(keep.map((r) => ({ date: d.date, who: r.who, text: r.text, key: r.key, tag: "From the chat" })));
          await window.ChamLive.setDraftStatus(d.id, "posted");
        } catch (err) {
          msg.textContent = "Did not post. " + (err.code || err.message);
          msg.classList.add("bad");
          count();
        }
      });
      const drop = el("button", { class: "act ghost", type: "button", text: "Discard it",
        onclick: async () => {
          if (!window.confirm("Throw away the chat wrap for " + pretty(d.date) + "?")) return;
          try { await window.ChamLive.setDraftStatus(d.id, "discarded"); }
          catch (err) { msg.textContent = "Did not save. " + (err.code || err.message); msg.classList.add("bad"); }
        } });

      const kept = d.lines.filter((l) => l.keep !== false).length;
      box.appendChild(el("section", { class: "admin chatwrap" }, [
        el("div", { class: "cw-head" }, [
          el("h3", { class: "grp", text: "Chat wrap for " + pretty(d.date) }),
          el("span", { class: "cw-sub", text: d.lines.length + " lines read, " + kept + " look worth keeping. Nothing is posted until you say." })
        ]),
        rows,
        el("div", { class: "adrow" }, [post, drop, msg])
      ]));
    });
  }

  /* ------------------------------------------------------------------ *
   * Announce - admins ping everyone's phone from here. The site only
   * files the message; the sender on Peter's computer pushes it within
   * seconds and writes back how many people got it.
   * ------------------------------------------------------------------ */
  function renderAnnounce() {
    const box = $("announce");
    if (!box) return;
    const on = Boolean(SESSION && SESSION.admin && window.ChamLive && window.ChamLive.announce);
    box.hidden = !on;
    if (!on) { box.replaceChildren(); return; }

    if (!box.childElementCount) {
      const text = el("textarea", { class: "an-text", rows: "2", maxlength: "300",
        placeholder: "@everyone just a quick check \u2026", "aria-label": "Announcement" });
      const count = el("span", { class: "an-count", text: "0 / 300" });
      const msg = el("span", { class: "ad-msg" });
      const send = el("button", { class: "au-go", type: "button", text: "Send to everyone",
        onclick: async () => {
          const t = text.value.trim().replace(/\s+/g, " ");
          msg.classList.remove("bad");
          if (!t) { msg.textContent = "Type the message first."; msg.classList.add("bad"); return; }
          if (!confirm("Send this to everyone's phone?\n\n\u201c" + t + "\u201d")) return;
          send.disabled = true; send.textContent = "Sending\u2026";
          try {
            const me = SESSION.personKey;
            await window.ChamLive.announce(t, me, PEOPLE[me] ? PEOPLE[me].name : me);
            logActivity({ who: me, event: "announce", key: true, text: "\ud83d\udce3 " + t });
            text.value = ""; count.textContent = "0 / 300";
            msg.textContent = "Queued \u2014 phones buzz in a few seconds.";
          } catch (e) {
            msg.textContent = "Couldn\u2019t send: " + (e.code || e.message || e); msg.classList.add("bad");
          } finally { send.disabled = false; send.textContent = "Send to everyone"; }
        } });
      text.addEventListener("input", () => { count.textContent = text.value.length + " / 300"; });
      text.addEventListener("keydown", (e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send.click(); });
      box.append(
        el("div", { class: "an-head" }, [
          el("span", { class: "an-ic", "aria-hidden": "true", text: "\ud83d\udce3" }),
          el("div", {}, [el("h3", { class: "an-h", text: "Announce" }),
            el("p", { class: "an-sub", text: "Goes straight to the phone of everyone with notifications on. Admins only." })])
        ]),
        text,
        el("div", { class: "an-row" }, [count, send]),
        msg,
        el("ul", { class: "an-list", id: "an-list" }));
    }

    const list = $("an-list");
    list.replaceChildren();
    (ANNOUNCES || []).forEach((a) => {
      const state = a.status === "sent"
        ? (a.sentTo ? "Sent to " + a.sentTo + " " + (a.sentTo === 1 ? "person" : "people") : "Sent \u2014 nobody else has notifications on yet")
        : "Sending\u2026";
      const when = a.at.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
      list.appendChild(el("li", { class: "an-item" + (a.status === "sent" ? " sent" : "") }, [
        el("span", { class: "an-who", text: (PEOPLE[a.by] ? PEOPLE[a.by].name : a.by) + " \u00b7 " + when }),
        el("span", { class: "an-t", text: a.text }),
        el("span", { class: "an-state", text: (a.status === "sent" ? "\u2713 " : "") + state })
      ]));
    });
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
          const chatter = isChatter(entry.text);
          const keep = el("input", { type: "checkbox", "aria-label": "Post this line" });
          keep.checked = !chatter;
          const w = peopleOptions(el("select", { class: "ad-in", "aria-label": "Who said it" }));
          w.value = entry.who;
          const t = el("input", { class: "ad-in wide", type: "text", value: entry.text, "aria-label": "What was said" });
          const k = el("input", { type: "checkbox", "aria-label": "Highlight this one" });
          const row = el("div", { class: "draft" + (chatter ? " chatter" : "") }, [
            el("label", { class: "ad-check keep", title: chatter ? "Looks like chatter - tick to post it anyway" : "Will be posted" }, [keep]),
            w, t,
            el("label", { class: "ad-check" }, [k, el("span", { text: "highlight" })])
          ]);
          keep.addEventListener("change", () => row.classList.toggle("chatter", !keep.checked));
          row._read = () => ({ who: w.value, text: t.value.trim(), key: k.checked, keep: keep.checked });
          drafts.appendChild(row);
        });
        const guessed = lines.filter((l) => l.who !== "team").length;
        const chat = lines.filter((l) => isChatter(l.text)).length;
        pmsg.textContent = (lines.length - chat) + " worth keeping, " + chat + " look like chatter and are un-ticked. "
          + guessed + " of " + lines.length + " matched to a person \u2014 check the names, then post.";
        return lines.length;
    }

    const sortBtn = el("button", { class: "act", type: "button", text: "Sort it into lines",
      onclick: () => sortIntoLines() });

    const postAll = el("button", { class: "au-go", text: "Post all of it",
      onclick: async () => {
        /* Sorting first is easy to skip, so do it for them rather than
           saying "nothing to post" at somebody who has clearly pasted. */
        if (!drafts.childElementCount && paste.value.trim()) sortIntoLines();
        const rows = [...drafts.children].map((r) => r._read()).filter((r) => r.text && r.keep);
        if (!rows.length) {
          pmsg.textContent = paste.value.trim()
            ? "Nothing ticked to post \u2014 tick the lines you want, or it was all chatter."
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
          try {
            await window.ChamLive.setStatus(t.id, k);
            if (k === "done") logActivity({ who: t.who, ref: t.id, event: "done", text: "Finished **" + t.title + "**" });
            if (k === "done" && SESSION && t.who === SESSION.personKey) mascotSay("Nice one! \u201c" + t.title + "\u201d is done.");
            if (k === "blocked") logActivity({ who: t.who, ref: t.id, event: "stuck",
              text: "Stuck on **" + t.title + "**" + (t.note ? " \u2014 " + t.note : "") });
          }
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
          const newId = await window.ChamLive.addTask({
            who: who.value, title: title.value.trim(),
            note: note.value.trim(), due: due.value || null
          });
          logActivity({ who: SESSION.personKey, ref: newId, event: "assign",
            text: "Gave " + (PEOPLE[who.value] ? PEOPLE[who.value].name : who.value) + " a job: **"
              + title.value.trim() + "**" + (due.value ? ", due " + pretty(due.value) : "") });
          title.value = ""; note.value = ""; due.value = "";
          msg.textContent = "Added. It is on their Tasks tab now.";
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
  /* ------------------------------------------------------------------ *
   * points
   *
   * Same rules as scripts/push.py, which sends the Monday report - change
   * one, change both.
   *   finished by the due date      +10
   *   finished, no date / unknown   +5
   *   finished late                 +3   (still better than not finishing)
   *   open and past its date        -5   each, for as long as it stays late
   * Officer of the week: most points from jobs finished last Mon-Sun.
   * ------------------------------------------------------------------ */
  const PTS = { onTime: 10, noDate: 5, late: 3, overdue: -5 };
  const shiftDay = (iso, n) => { const d = new Date(iso + "T00:00:00"); d.setDate(d.getDate() + n); return isoDay(d); };
  const weekStart = (iso) => shiftDay(iso, -((new Date(iso + "T00:00:00").getDay() + 6) % 7));
  function jobPoints(t) {
    if (t.status !== "done") return (t.due && t.due < TODAY) ? PTS.overdue : 0;
    if (!t.due || !t.doneOn) return PTS.noDate;
    return t.doneOn <= t.due ? PTS.onTime : PTS.late;
  }
  function pointsTable() {
    const mon = weekStart(TODAY), lastMon = shiftDay(mon, -7);
    const P = {};
    const row = (k) => P[k] || (P[k] = { key: k, total: 0, week: 0, lastWeek: 0, onTime: 0, late: 0, overdue: 0 });
    TASKS.forEach((t) => {
      if (!t.who || t.who === "team" || !PEOPLE[t.who] || /^Left /.test(PEOPLE[t.who].role || "")) return;
      const p = jobPoints(t), r = row(t.who);
      r.total += p;
      if (t.status !== "done") {
        if (p < 0) { r.overdue++; r.week += p; }
        return;
      }
      if (p === PTS.onTime) r.onTime++;
      if (p === PTS.late) r.late++;
      if (t.doneOn && t.doneOn >= mon) r.week += p;
      else if (t.doneOn && t.doneOn >= lastMon) r.lastWeek += p;
    });
    const rows = Object.values(P);
    const topLast = Math.max(0, ...rows.map((r) => r.lastWeek));
    const officers = topLast > 0 ? rows.filter((r) => r.lastWeek === topLast).map((r) => r.key) : [];
    const topWeek = Math.max(0, ...rows.map((r) => r.week));
    const leaders = topWeek > 0 ? rows.filter((r) => r.week === topWeek).map((r) => r.key) : [];
    return { rows, officers, topLast, leaders, topWeek };
  }

  function renderPoints(box) {
    const pt = pointsTable();
    const sec = el("section", { class: "viz" }, [
      el("h3", { class: "viz-h", text: "Points" }),
      el("p", { class: "viz-sub",
        text: "+10 finished by the date \u00b7 +5 no date \u00b7 +3 finished late \u00b7 \u22125 for every job sitting past its date. Officer of the week is whoever scored most last Monday to Sunday." })
    ]);

    const who = (ks) => ks.map((k) => PEOPLE[k].name).join(" & ");
    const badge = el("div", { class: "officer" }, [
      el("span", { class: "officer-ic", "aria-hidden": "true", text: "\ud83d\udc6e" }),
      el("div", { class: "officer-t" }, pt.officers.length
        ? [el("span", { class: "officer-k", text: "Officer of the week" }),
           el("span", { class: "officer-n", text: who(pt.officers) }),
           el("span", { class: "officer-s", text: pt.topLast + " points last week" })]
        : [el("span", { class: "officer-k", text: "Officer of the week" }),
           el("span", { class: "officer-n", text: "Nobody yet" }),
           el("span", { class: "officer-s", text: "Nobody finished a job last week. Next Monday it could be you." })]),
      pt.leaders.length ? el("div", { class: "officer-now" }, [
        el("span", { class: "officer-k", text: "Leading this week" }),
        el("span", { class: "officer-n sm", text: who(pt.leaders) + " \u00b7 " + pt.topWeek })]) : null
    ]);
    sec.appendChild(badge);

    const view = S.pointsView || "total";
    const tog = el("div", { class: "filters pts-tog" });
    [["total", "All time"], ["week", "This week"]].forEach(([k, label]) => tog.appendChild(el("button", {
      class: "chipbtn plain", "aria-pressed": String(view === k), text: label,
      onclick: () => { S.pointsView = k; renderTracker(); }
    })));
    sec.appendChild(tog);

    const rows = pt.rows.slice().sort((a, b) => b[view] - a[view] || b.onTime - a.onTime
      || PEOPLE[a.key].name.localeCompare(PEOPLE[b.key].name));
    const most = Math.max(1, ...rows.map((r) => Math.abs(r[view])));
    const plot = el("div", { class: "viz-plot" });
    rows.forEach((r) => {
      const v = r[view];
      const bar = el("button", {
        class: "pbar" + (v < 0 ? " neg" : ""), type: "button",
        style: "width:" + (v ? Math.max(2, Math.round(Math.abs(v) / most * 100)) : 0) + "%",
        "aria-label": PEOPLE[r.key].name + ": " + v + " points"
      });
      tip(bar, [PEOPLE[r.key].name, v + " point" + (Math.abs(v) === 1 ? "" : "s") + (view === "week" ? " this week" : " all time"),
                r.onTime + " on time \u00b7 " + r.late + " late \u00b7 " + r.overdue + " past its date now"]);
      // ties share a medal: rank = how many different scores beat this one
      const rank = new Set(rows.map((x) => x[view]).filter((x) => x > v)).size;
      const medal = view === "total" && v > 0 ? ["\ud83e\udd47", "\ud83e\udd48", "\ud83e\udd49"][rank] : null;
      plot.appendChild(el("div", { class: "hrow" }, [
        el("span", { class: "hname" }, [avatar(r.key), el("span", {
          text: PEOPLE[r.key].name + (pt.officers.includes(r.key) ? " \ud83d\udc6e" : "") + (medal ? " " + medal : "") })]),
        el("div", { class: "htrack" }, [bar]),
        el("span", { class: "hval" + (v < 0 ? " bad" : ""), text: (v > 0 ? "+" : "") + v })
      ]));
    });
    sec.appendChild(plot);
    box.appendChild(sec);
  }

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
    const pbox = $("points");
    pbox.replaceChildren();
    renderPoints(pbox);

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
        const capText = cap.value.trim();
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
        if (done) logActivity({ who: SESSION.personKey, ref: "photos-" + Date.now(), event: "photos",
          text: "Added " + done + " photo" + (done === 1 ? "" : "s") + (capText ? ": " + capText : "") });
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

  /* ------------------------------------------------------------------ *
   * money
   *
   * One log for money out and money in. Anybody can add a line; Thuan
   * (finance) and the admins mark lines as copied into the sheet, or as
   * paid back to whoever spent their own money.
   *
   * Thuan's sheet is the real record. This is where the numbers are caught
   * the day they happen, so they reach it at all.
   * ------------------------------------------------------------------ */
  const OUT_CATS = ["Events", "Merch", "Media", "Operations", "Teaching", "Other"];
  const IN_CATS  = ["Sales", "Donation", "Sponsor", "Other"];
  const METHODS  = [["cash","Cash"],["transfer","Bank transfer"],["momo","MoMo"],["card","Card"]];

  /** "250k" -> 250000, "1.2tr" / "1,2m" -> 1200000, "45.000" -> 45000 */
  function parseVnd(raw) {
    let t = String(raw || "").trim().toLowerCase().replace(/\s|₫|vnd|đ/g, "");
    if (!t) return NaN;
    let mult = 1;
    if (/(tr|m|mil|triệu|trieu)$/.test(t)) { mult = 1000000; t = t.replace(/(tr|m|mil|triệu|trieu)$/, ""); }
    else if (/(k|nghìn|nghin|ngàn|ngan)$/.test(t)) { mult = 1000; t = t.replace(/(k|nghìn|nghin|ngàn|ngan)$/, ""); }
    if (mult > 1) {
      t = t.replace(",", ".");                 // "1,2tr" means 1.2 million
      const n = parseFloat(t);
      return isFinite(n) ? Math.round(n * mult) : NaN;
    }
    /* plain amounts: dots and commas are thousand separators in Vietnam */
    t = t.replace(/[.,]/g, "");
    const n = parseInt(t, 10);
    return isFinite(n) ? n : NaN;
  }
  const fmtVnd = (n) => (Math.round(n) || 0).toLocaleString("en-US") + " \u20ab";

  function canManageMoney() { return Boolean(SESSION && (SESSION.admin || SESSION.finance)); }

  function monthKey(iso) { return (iso || "").slice(0, 7); }
  function monthName(key) {
    const d = fromIso(key + "-01");
    return d ? MONTH_FULL[d.getMonth()] + " " + d.getFullYear() : "No date";
  }
  const whoName = (k) => k === "cham" ? "Ch\u1ea1m's money" : (PEOPLE[k] ? PEOPLE[k].name : k);

  function renderMoneyAdd() {
    const box = $("money-add");
    if (!box) return;
    const on = Boolean(SESSION && window.ChamLive);
    box.hidden = !on;
    if (!on) { box.replaceChildren(); return; }
    if (box.childElementCount) return;

    let kind = "out";
    const today = isoDay(new Date());

    /* --- out / in, as one segmented control --- */
    const segOut = el("button", { class: "seg-b", type: "button", "aria-pressed": "true", text: "Money out" });
    const segIn  = el("button", { class: "seg-b", type: "button", "aria-pressed": "false", text: "Money in" });
    const seg = el("div", { class: "seg-ctl", role: "group", "aria-label": "Money out or money in" }, [segOut, segIn]);

    /* --- the three things almost every entry needs --- */
    const amount = el("input", { class: "mf-in mf-amount", type: "text", inputmode: "decimal",
      placeholder: "250k", "aria-label": "Amount in dong", autocomplete: "off" });
    const amountSeen = el("div", { class: "mf-seen", "aria-live": "polite" });
    const desc = el("input", { class: "mf-in", type: "text", placeholder: "What was it for?", "aria-label": "What it was for" });
    const cat = el("select", { class: "mf-in", "aria-label": "Category" });
    const fillCats = () => {
      const keep = cat.value;
      cat.replaceChildren();
      (kind === "out" ? OUT_CATS : IN_CATS).forEach((c) => cat.appendChild(el("option", { value: c, text: c })));
      if ([...cat.options].some((o) => o.value === keep)) cat.value = keep;
    };
    fillCats();

    /* --- who, with the pay-me-back tick right beside it --- */
    const payer = el("select", { class: "mf-in mf-short", "aria-label": "Who paid" });
    payer.appendChild(el("option", { value: "cham", text: "Ch\u1ea1m's money" }));
    Object.keys(PEOPLE)
      .filter((k) => k !== "team" && !/^Left /.test(PEOPLE[k].role || ""))
      .forEach((k) => payer.appendChild(el("option", { value: k, text: PEOPLE[k].name })));
    payer.value = SESSION.personKey || "cham";
    const payerLabel = el("span", { class: "mf-k", text: "Paid by" });
    const owedBox = el("input", { type: "checkbox", id: "mf-owed" });
    const owedLabel = el("label", { class: "mf-check", for: "mf-owed" }, [owedBox, el("span", { text: "out of my own pocket \u2014 pay me back" })]);
    const syncOwed = () => {
      const selfPaid = kind === "out" && payer.value !== "cham";
      owedLabel.hidden = !selfPaid;
      if (!selfPaid) owedBox.checked = false;
    };
    payer.addEventListener("change", syncOwed);

    /* --- the rest, folded away --- */
    const date = el("input", { class: "mf-in", type: "date", value: today, "aria-label": "Date" });
    const lineList = el("datalist", { id: "budget-lines" });
    const line = el("input", { class: "mf-in", type: "text", list: "budget-lines", placeholder: "e.g. Halloween sale", "aria-label": "Which event" });
    const method = el("select", { class: "mf-in", "aria-label": "How it was paid" });
    METHODS.forEach(([v, t]) => method.appendChild(el("option", { value: v, text: t })));
    const notes = el("input", { class: "mf-in", type: "text", placeholder: "Anything Thuan should know", "aria-label": "Notes" });
    const receipt = el("input", { class: "mf-in mf-file", type: "file", accept: "image/*", "aria-label": "Receipt photo" });
    const field = (label, input) => el("label", { class: "mf-field" }, [el("span", { class: "mf-k", text: label }), input]);
    const more = el("details", { class: "mf-more" }, [
      el("summary", { text: "More details \u2014 date, event, how it was paid, receipt" }),
      el("div", { class: "mf-grid2" }, [
        field("Date", date), field("Which event", line),
        field("Paid with", method), field("Receipt photo", receipt),
      ]),
      el("div", { class: "mf-row" }, [field("Notes", notes)]),
      lineList
    ]);

    const msg = el("span", { class: "mf-msg", "aria-live": "polite" });
    const go = el("button", { class: "au-go mf-go", type: "button", text: "Log it" });

    amount.addEventListener("input", () => {
      const n = parseVnd(amount.value);
      const has = amount.value.trim() !== "";
      const ok = isFinite(n) && n > 0;
      amountSeen.textContent = has ? (ok ? fmtVnd(n) : "can\u2019t read that") : "";
      amountSeen.classList.toggle("bad", has && !ok);
    });

    const setKind = (k) => {
      kind = k;
      segOut.setAttribute("aria-pressed", String(k === "out"));
      segIn.setAttribute("aria-pressed", String(k === "in"));
      box.classList.toggle("is-in", k === "in");
      payerLabel.textContent = k === "out" ? "Paid by" : "Received by";
      desc.placeholder = k === "out" ? "What was it for?" : "Where did it come from?";
      fillCats();
      syncOwed();
    };
    segOut.addEventListener("click", () => setKind("out"));
    segIn.addEventListener("click", () => setKind("in"));
    setKind("out");

    go.addEventListener("click", async () => {
      msg.classList.remove("bad", "good");
      const n = parseVnd(amount.value);
      if (!(isFinite(n) && n > 0)) { msg.textContent = "Put in an amount \u2014 250k, 1.2tr, or 45.000 all work."; msg.classList.add("bad"); amount.focus(); return; }
      if (!desc.value.trim()) { msg.textContent = "Say what it was for."; msg.classList.add("bad"); desc.focus(); return; }
      go.disabled = true; go.textContent = "Saving\u2026";
      try {
        let rc = "";
        if (receipt.files && receipt.files[0]) rc = (await shrink(receipt.files[0])).data;
        const loggedDesc = desc.value.trim();
        await window.ChamLive.addMoney({
          kind, date: date.value || today, amount: n,
          description: loggedDesc, category: cat.value,
          budgetLine: line.value.trim(), paidBy: payer.value, method: method.value,
          notes: notes.value.trim(), owed: owedBox.checked, receipt: rc
        });
        logActivity({ who: SESSION.personKey, ref: "money-" + Date.now(), event: "money",
          amount: n, kind,
          text: (kind === "out" ? "Spent " : "Brought in ") + "**" + fmtVnd(n) + "** \u2014 " + loggedDesc });
        amount.value = ""; desc.value = ""; notes.value = ""; line.value = ""; receipt.value = "";
        owedBox.checked = false; amountSeen.textContent = ""; more.open = false; date.value = today;
        box._pickLine && box._pickLine("");
        msg.textContent = "";
        closeMoneySheet();
        toast("Logged " + fmtVnd(n) + (kind === "out" ? " out" : " in") + " \u2014 Thuan will see it.");
      } catch (err) {
        msg.textContent = "Did not save. " + (err.code || err.message);
        msg.classList.add("bad");
      }
      go.disabled = false; go.textContent = "Log it";
    });
    [amount, desc].forEach((i) => i.addEventListener("keydown", (e) => { if (e.key === "Enter") go.click(); }));

    /* the events people have logged to most recently, one tap each - most
       entries during a sale belong to that sale */
    const chips = el("div", { class: "mf-chips", hidden: true });
    const pickLine = (name) => {
      line.value = name;
      chips.querySelectorAll("button").forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.name === name)));
    };
    box._pickLine = pickLine;
    box._refresh = () => {
      const recent = [];
      (LEDGER || []).slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""))
        .forEach((m) => { if (m.budgetLine && !recent.includes(m.budgetLine) && m.category !== "Teaching") recent.push(m.budgetLine); });
      chips.replaceChildren(el("span", { class: "mf-k", text: "For" }));
      recent.slice(0, 4).forEach((name) => chips.appendChild(el("button", {
        class: "chipbtn plain", type: "button", "data-name": name, "aria-pressed": String(line.value === name), text: name,
        onclick: () => pickLine(line.value === name ? "" : name)
      })));
      chips.hidden = recent.length === 0;
    };
    line.addEventListener("input", () => chips.querySelectorAll("button")
      .forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.name === line.value))));

    box.classList.add("mform");
    box.append(
      el("div", { class: "mf-head" }, [el("h3", { class: "grp", text: "Log money" }), seg]),
      el("div", { class: "mf-main" }, [
        el("div", { class: "mf-amtwrap" }, [
          el("span", { class: "mf-cur", "aria-hidden": "true", text: "\u20ab" }), amount
        ]),
        desc, cat
      ]),
      chips,
      el("div", { class: "mf-sub" }, [
        amountSeen,
        el("span", { class: "mf-who" }, [payerLabel, payer, owedLabel])
      ]),
      more,
      el("div", { class: "mf-foot" }, [msg, go])
    );
    syncOwed();
  }

  /** rows in exactly the order the finance sheet's columns run */
  function sheetRows(list) {
    return list.map((m) => m.kind === "out"
      ? [m.date || "", m.category, m.description, m.amount, m.budgetLine, m.notes,
         whoName(m.paidBy), (METHODS.find(([v]) => v === m.method) || [0, m.method])[1],
         m.owed ? "Yes" : "", m.createdBy || "", m.id]
      : [m.date || "", m.category, m.description, m.amount, m.budgetLine, m.notes,
         whoName(m.paidBy), (METHODS.find(([v]) => v === m.method) || [0, m.method])[1],
         m.createdBy || "", m.id]);
  }
  const tsvCell = (v) => String(v == null ? "" : v).replace(/[\t\r\n]+/g, " ");
  const csvCell = (v) => { const t = String(v == null ? "" : v); return /[",\n]/.test(t) ? '"' + t.replace(/"/g, '""') + '"' : t; };

  function renderMoneyTools(list) {
    const box = $("money-tools");
    box.replaceChildren();
    if (!canManageMoney()) return;

    const pending = list.filter((m) => m.status === "new");
    const tab = S.moneyKind === "out" ? "Expenses" : "Income";
    const msg = el("span", { class: "mt-msg", "aria-live": "polite" });

    const copy = el("button", { class: "au-go", type: "button",
      text: pending.length ? "Copy " + pending.length + " for the sheet" : "All in the sheet",
      disabled: !pending.length,
      onclick: async () => {
        const text = sheetRows(pending).map((r) => r.map(tsvCell).join("\t")).join("\n");
        try {
          await navigator.clipboard.writeText(text);
          msg.classList.remove("bad");
          msg.textContent = "Copied. In the sheet\u2019s " + tab + " tab, click the first empty cell in column A and paste.";
          done.hidden = false;
        } catch (err) {
          msg.textContent = "Your browser would not copy \u2014 use the CSV.";
          msg.classList.add("bad");
        }
      }
    });

    const done = el("button", { class: "act", type: "button", hidden: true, text: "Pasted \u2014 mark them done",
      onclick: async () => {
        done.disabled = true;
        try {
          await window.ChamLive.setMoneyStatus(pending.map((m) => m.id), "logged");
          msg.textContent = pending.length + " marked as in the sheet.";
        } catch (err) {
          msg.textContent = "Did not save. " + (err.code || err.message);
          msg.classList.add("bad");
          done.disabled = false;
        }
      }
    });

    const csv = el("button", { class: "act ghost", type: "button", text: "CSV",
      title: "Download everything as a spreadsheet file",
      onclick: () => {
        const head = ["Kind","Date","Category","Description","Amount","Budget line","Notes","Paid or received by","Method","Owed back","Status","Logged by","ID"];
        const rows = (LEDGER || []).slice().sort((a, b) => (a.date || "").localeCompare(b.date || "")).map((m) =>
          [m.kind === "out" ? "Out" : "In", m.date, m.category, m.description, m.amount, m.budgetLine, m.notes,
           whoName(m.paidBy), (METHODS.find(([v]) => v === m.method) || [0, m.method])[1],
           m.owed ? (m.repaid ? "Paid back" : "Yes") : "", m.status, m.createdBy || "", m.id]);
        const text = "\ufeff" + [head].concat(rows).map((r) => r.map(csvCell).join(",")).join("\r\n");
        const a = el("a", { href: URL.createObjectURL(new Blob([text], { type: "text/csv" })),
                            download: "cham-money-" + isoDay(new Date()) + ".csv" });
        document.body.appendChild(a); a.click(); a.remove();
      }
    });

    box.appendChild(el("div", { class: "mtools" }, [
      el("div", { class: "mt-text" }, [
        el("b", { text: "Finance sheet" }),
        el("span", { text: pending.length
          ? pending.length + " " + (S.moneyKind === "out" ? "expense" : "income") + " line" + (pending.length === 1 ? "" : "s") + " waiting"
          : "up to date" })
      ]),
      el("div", { class: "mt-btns" }, [copy, done, csv]),
      msg
    ]));
  }

  /* ------------------------------------------------------------------ *
   * what the fundraising adds up to
   *
   * The roadmap's first money rule: "track the money that remains after
   * costs, not only total sales." So every fundraiser is shown as money in,
   * its costs, and what was left - and the club's total is measured against
   * the milestones the roadmap sets, not against a number someone liked.
   *
   * How a line is counted:
   *   - Teaching spend is money USED for programs, never a fundraiser cost.
   *   - Any other spend on a budget line is that fundraiser's cost.
   *   - Other spend with no budget line is a general running cost.
   *   - Raised after costs = all money in, less fundraiser costs.
   * ------------------------------------------------------------------ */
  const PER_EVENT_TARGET = [1000000, 3000000];      // roadmap, Phase 2
  const MILESTONES = [
    { at: 10000000,  name: "Early funds",      note: "Phase 2 \u00b7 5\u201310M from school fundraisers you can repeat" },
    { at: 50000000,  name: "Sponsored events", note: "Phase 4 \u00b7 20\u201350M with sponsors behind bigger events" },
    { at: 100000000, name: "The 100M goal",    note: "Phase 5 \u00b7 the end goal in the plan" },
    { at: 200000000, name: "Stretch",          note: "Phase 6 \u00b7 100\u2013200M, once Ch\u1ea1m expands beyond HCMC" }
  ];
  const isProgram = (m) => m.kind === "out" && m.category === "Teaching";
  const shortVnd = (n) => {
    const a = Math.abs(n);
    const t = a >= 1e6 ? (a / 1e6).toFixed(a % 1e6 === 0 ? 0 : 1).replace(/\.0$/, "") + "M"
            : a >= 1e3 ? Math.round(a / 1e3) + "k" : String(a);
    return (n < 0 ? "\u2212" : "") + t;
  };

  function moneySummary(all) {
    const lines = new Map();
    let totalIn = 0, fundCosts = 0, programs = 0, running = 0, totalOut = 0;
    all.forEach((m) => {
      if (m.kind === "in") totalIn += m.amount; else totalOut += m.amount;
      if (isProgram(m)) { programs += m.amount; return; }
      if (!m.budgetLine) { if (m.kind === "out") running += m.amount; return; }
      const f = lines.get(m.budgetLine) || { name: m.budgetLine, inn: 0, out: 0, first: null };
      if (m.kind === "in") f.inn += m.amount; else { f.out += m.amount; fundCosts += m.amount; }
      if (m.date && (!f.first || m.date < f.first)) f.first = m.date;
      lines.set(m.budgetLine, f);
    });
    const funds = [...lines.values()].map((f) => ({ ...f, left: f.inn - f.out }))
      .sort((a, b) => (b.first || "").localeCompare(a.first || "") || a.name.localeCompare(b.name));
    return { funds, raised: totalIn - fundCosts, programs, running, available: totalIn - totalOut };
  }

  function renderMoneyGoal(all) {
    const box = $("money-goal");
    box.replaceChildren();
    if (!all.length) return;
    const sum = moneySummary(all);

    /* ---- the goal ---- */
    const next = MILESTONES.find((ms) => ms.at > sum.raised) || MILESTONES[MILESTONES.length - 1];
    const pct = Math.max(0, Math.min(100, Math.round((sum.raised / next.at) * 100)));
    const ladder = el("ol", { class: "ms-ladder", "aria-label": "Roadmap milestones" });
    MILESTONES.forEach((ms) => {
      const state = sum.raised >= ms.at ? "done" : ms === next ? "now" : "later";
      ladder.appendChild(el("li", { class: "ms " + state, title: ms.note }, [
        el("span", { class: "ms-at", text: shortVnd(ms.at) }),
        el("span", { class: "ms-name", text: ms.name })
      ]));
    });
    const meter = el("div", { class: "goal-meter", role: "meter", "aria-valuemin": "0",
      "aria-valuemax": String(next.at), "aria-valuenow": String(Math.max(0, sum.raised)),
      "aria-label": "Raised after costs, towards " + next.name }, [
      el("i", { style: "width:" + pct + "%" })
    ]);
    tip(meter, [fmtVnd(sum.raised) + " of " + fmtVnd(next.at), next.note]);

    const goal = el("section", { class: "viz goal" }, [
      el("div", { class: "goal-top" }, [
        el("div", {}, [
          el("span", { class: "tl-k", text: "Raised after costs, all time" }),
          el("span", { class: "goal-n", text: fmtVnd(sum.raised) })
        ]),
        el("div", { class: "goal-next" }, [
          el("b", { text: pct + "%" }),
          el("span", { text: " of the way to " + shortVnd(next.at) + " \u2014 " + next.name })
        ])
      ]),
      meter,
      el("p", { class: "goal-note", text: next.note }),
      ladder,
      el("div", { class: "goal-split" }, [
        el("span", {}, [el("span", { class: "tl-k", text: "Used for programs" }), el("b", { text: fmtVnd(sum.programs) })]),
        sum.running ? el("span", {}, [el("span", { class: "tl-k", text: "Running costs" }), el("b", { text: fmtVnd(sum.running) })]) : null,
        el("span", {}, [el("span", { class: "tl-k", text: "Available now" }), el("b", { text: fmtVnd(sum.available) })])
      ])
    ]);

    /* ---- each fundraiser ---- */
    const funds = sum.funds;
    let table = null;
    if (funds.length) {
      const biggest = Math.max(PER_EVENT_TARGET[1], ...funds.map((f) => Math.max(0, f.left)));
      table = el("section", { class: "viz" }, [
        el("h3", { class: "viz-h", text: "Each fundraiser, after costs" }),
        el("p", { class: "viz-sub", text: "What each one actually left once its costs were paid. The shaded band is the roadmap\u2019s 1\u20133M target for a school fundraiser." })
      ]);
      const rows = el("div", { class: "fund-rows" });
      funds.forEach((f) => {
        let verdict, tone;
        if (!f.inn) { verdict = "costs so far"; tone = ""; }
        else if (f.left < PER_EVENT_TARGET[0]) { verdict = "below target"; tone = "bad"; }
        else if (f.left <= PER_EVENT_TARGET[1]) { verdict = "on target"; tone = "ok"; }
        else { verdict = "above target"; tone = "ok"; }

        const band = el("span", { class: "fund-band", "aria-hidden": "true",
          style: "left:" + (PER_EVENT_TARGET[0] / biggest * 100) + "%;width:" + ((PER_EVENT_TARGET[1] - PER_EVENT_TARGET[0]) / biggest * 100) + "%" });
        const bar = el("button", { class: "fund-bar" + (f.left < 0 ? " neg" : ""), type: "button",
          style: "width:" + Math.max(1.5, Math.min(100, Math.abs(f.left) / biggest * 100)) + "%",
          "aria-label": f.name + ": " + fmtVnd(f.left) + " left after costs" });
        tip(bar, [f.name, fmtVnd(f.inn) + " in \u2212 " + fmtVnd(f.out) + " costs", "= " + fmtVnd(f.left) + " left"]);

        rows.appendChild(el("div", { class: "fund-row" }, [
          el("div", { class: "fund-head" }, [
            el("span", { class: "fund-name", text: f.name }),
            el("span", { class: "fund-verdict " + tone, text: verdict })
          ]),
          el("div", { class: "fund-track" }, [band, bar]),
          el("div", { class: "fund-nums" }, [
            el("span", {}, [el("span", { class: "tl-k", text: "In" }), el("b", { text: fmtVnd(f.inn) })]),
            el("span", {}, [el("span", { class: "tl-k", text: "Costs" }), el("b", { text: fmtVnd(f.out) })]),
            el("span", { class: "fund-left" }, [el("span", { class: "tl-k", text: "Left" }), el("b", { text: fmtVnd(f.left) })])
          ])
        ]));
      });
      table.appendChild(rows);
    }

    box.append(goal);
    if (table) box.append(table);
  }

  /* ------------------------------------------------------------------ *
   * logging money from anywhere
   *
   * The form used to sit halfway down the Money tab, under the charts. Now
   * it lives in a sheet that opens over whatever you are looking at: the
   * + Log money button on every tab, the button on the Money tab, the
   * app icon's shortcut, or a #log link pinned in the chat.
   * ------------------------------------------------------------------ */
  let pendingLog = false;
  let lastFocus = null;

  function openMoneySheet() {
    const dlg = $("money-sheet");
    if (!dlg) return;
    if (!SESSION || !window.ChamLive) { pendingLog = true; return; }
    pendingLog = false;
    renderMoneyAdd();
    const box = $("money-add");
    if (box._refresh) box._refresh();
    lastFocus = document.activeElement;
    if (!dlg.open) { if (dlg.showModal) dlg.showModal(); else dlg.setAttribute("open", ""); }
    renderFab();
    const amt = box.querySelector(".mf-amount");
    if (amt) setTimeout(() => amt.focus(), 60);
  }
  function closeMoneySheet() {
    const dlg = $("money-sheet");
    if (dlg && dlg.open) { if (dlg.close) dlg.close(); else dlg.removeAttribute("open"); }
  }
  (function sheetWiring() {
    const dlg = $("money-sheet");
    if (!dlg) return;
    $("money-sheet-x").addEventListener("click", closeMoneySheet);
    /* a tap on the dim backdrop closes it; a tap inside the form does not */
    dlg.addEventListener("click", (e) => { if (e.target === dlg) closeMoneySheet(); });
    dlg.addEventListener("close", () => {
      renderFab();
      if (lastFocus && lastFocus.focus) { try { lastFocus.focus(); } catch (e) {} }
    });
    $("log-fab").addEventListener("click", openMoneySheet);
  })();

  function renderFab() {
    const fab = $("log-fab");
    if (!fab) return;
    /* not hidden while the sheet is open: the sheet's backdrop already covers
       it, and hiding it meant waiting on a "close" event some browsers are
       slow to fire - which left the button gone after logging */
    fab.hidden = !(SESSION && window.ChamLive);
    const inst = $("install");
    document.body.classList.toggle("has-install", Boolean(inst && !inst.hidden));
    document.body.classList.toggle("has-fab", !fab.hidden);
  }

  let toastTimer = null;
  function toast(text) {
    const t = $("toast");
    if (!t) return;
    t.textContent = text;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  function renderMoneyCta() {
    const box = $("money-cta");
    if (!box) return;
    box.replaceChildren();
    if (!SESSION || !window.ChamLive) return;
    box.appendChild(el("div", { class: "mcta" }, [
      el("button", { class: "au-go mcta-go", type: "button", onclick: openMoneySheet }, [
        el("span", { "aria-hidden": "true", text: "+ " }), document.createTextNode("Log money")
      ]),
      el("span", { class: "mcta-sub", text: "Spent or took money for Ch\u1ea1m? Log it the same day. The + Log money button is on every tab too." })
    ]));
  }

  /* ------------------------------------------------------------------ *
   * Judy
   *
   * Says the one thing that matters most to whoever is looking, worked out
   * from the real data: something overdue, something due, a wrap waiting,
   * money for the sheet, money you are owed, how close the goal is. Tap it
   * for the next thing. It speaks up by itself once per visit and then
   * stays quiet unless asked, so it never nags.
   * ------------------------------------------------------------------ */
  let mascotIdx = 0;
  let mascotAutoDone = false;
  let mascotTimer = null;
  let sessionKnown = false;   // wait for sign-in to settle so nobody gets two hellos

  const pick = (a) => a[Math.floor(Math.random() * a.length)];
  const nameOf = (k) => (PEOPLE[k] ? PEOPLE[k].name : k);
  const andList = (ks) => ks.length < 2 ? nameOf(ks[0])
    : ks.slice(0, -1).map(nameOf).join(", ") + " and " + nameOf(ks[ks.length - 1]);
  const isLate = (t) => t.status !== "done" && (t.status === "late" || (t.due && t.due < TODAY));

  /* The group-wide stuff: what's due next, who's carrying, who's dragging.
     Friendly roasting - it only ever counts jobs, never says anything else. */
  function teamLines() {
    const out = [];
    const people = (k) => k && k !== "team" && PEOPLE[k] && !/^Left /.test(PEOPLE[k].role || "");
    const next = TASKS.filter((t) => t.status !== "done" && t.due && t.due >= TODAY)
      .sort((a, b) => a.due.localeCompare(b.due))[0];
    if (next) out.push({ go: ["tasks", "See all jobs"],
      text: "Next job due: \u201c" + next.title + "\u201d \u2014 " + (people(next.who) ? nameOf(next.who) : "the whole group")
        + ", " + relDay(next.due) + ". " + pick(["Clock\u2019s ticking.", "No pressure. (Pressure.)", "I\u2019m watching.", "Tick tock."]) });

    const done = {}, late = {};
    TASKS.forEach((t) => {
      if (!people(t.who)) return;
      if (t.status === "done") done[t.who] = (done[t.who] || 0) + 1;
      if (isLate(t)) late[t.who] = (late[t.who] || 0) + 1;
    });
    const top = (m) => {
      const max = Math.max(0, ...Object.values(m));
      return max ? { n: max, who: Object.keys(m).filter((k) => m[k] === max) } : null;
    };
    const best = top(done), worst = top(late);
    const pt = pointsTable();
    if (pt.officers.length) out.push({ go: ["tracker", "See the points"],
      text: "\ud83d\udc6e Officer of the week: " + andList(pt.officers) + " (" + pt.topLast + " pts). "
        + pick(["Salute.", "Badge well earned.", "Everyone else: this could be you.", "Doing the actual work."]) });
    if (best) out.push({ tone: "ok", go: ["tracker", "See the tracker"],
      text: "\ud83c\udfc6 Best: " + andList(best.who) + ", " + best.n + " job" + (best.n === 1 ? "" : "s") + " done. "
        + pick(["Carrots for " + (best.who.length > 1 ? "them" : nameOf(best.who[0])) + ".",
                "Carrying the whole team, honestly.", "Promotion pending.", "Everyone else, take notes."]) });
    if (worst) out.push({ tone: "bad", go: ["tasks", "See the late jobs"],
      text: "\ud83d\udc0c Worst: " + andList(worst.who) + ", " + worst.n + " job" + (worst.n === 1 ? "" : "s") + " past the date. "
        + pick(["I\u2019m writing you a ticket.", "Slower than the DMV.", "Hop to it!", "I believe in you. Barely."]) });
    else if (TASKS.some((t) => t.status !== "done")) out.push({ tone: "ok",
      text: "Nobody\u2019s late right now. Suspicious\u2026 but I\u2019ll allow it." });
    return out;
  }

  function mascotLines() {
    const out = [];
    if (!SESSION) {
      out.push({ text: "Ch\u1ea1m is a student-led nonprofit in Ho Chi Minh City. Members, sign in at the top to see your jobs." });
      const tl = teamLines();
      if (tl.length) out.push({ title: "Today\u2019s report", rows: tl.map((l) => l.text), go: ["tasks", "See all jobs"] });
      return out;
    }
    const me = SESSION.personKey;
    const first = (PEOPLE[me] && PEOPLE[me].name) || "there";
    const mine = TASKS.filter((t) => t.who === me && t.status !== "done");
    const byDue = (a, b) => (a.due || "").localeCompare(b.due || "");
    const late = mine.filter((t) => t.due && t.due < TODAY).sort(byDue);
    const soon = mine.filter((t) => t.due && t.due >= TODAY && days(TODAY, t.due) <= 2).sort(byDue);

    if (late.length) out.push({ tone: "bad", go: ["tasks", "See my jobs"],
      text: (late.length === 1 ? "One of your jobs is" : late.length + " of your jobs are") + " past the date \u2014 \u201c" + late[0].title + "\u201d." });
    if (soon.length) out.push({ go: ["tasks", "Open my jobs"],
      text: "Due " + relDay(soon[0].due) + ": \u201c" + soon[0].title + "\u201d." });
    if (SESSION.admin && DRAFTS && DRAFTS.length) out.push({ go: ["updates", "Review it"],
      text: "Tonight\u2019s chat wrap is waiting for you to look over." });
    if (SESSION.finance && LEDGER) {
      const n = LEDGER.filter((m) => m.status === "new").length;
      if (n) out.push({ go: ["money", "Open Money"], text: n + " money line" + (n === 1 ? "" : "s") + " to copy into the finance sheet." });
    }
    if (LEDGER) {
      const owed = LEDGER.filter((m) => m.kind === "out" && m.owed && !m.repaid && m.paidBy === me).reduce((a, m) => a + m.amount, 0);
      if (owed) out.push({ text: "Ch\u1ea1m owes you " + fmtVnd(owed) + ". Thuan can see it on the Money tab." });
    }
    if (!late.length && !soon.length) out.push({ go: mine.length ? ["tasks", "My jobs"] : null,
      text: "Nothing of yours is due in the next two days." + (mine.length
        ? " You have " + mine.length + " open job" + (mine.length === 1 ? "" : "s") + "."
        : " You\u2019re all clear.") });
    if (LEDGER && LEDGER.length) {
      const sm = moneySummary(LEDGER);
      const next = MILESTONES.find((ms) => ms.at > sm.raised);
      if (next && sm.raised > 0) out.push({ go: ["money", "See the goal"],
        text: "We\u2019ve raised " + fmtVnd(sm.raised) + " after costs \u2014 " + Math.round(sm.raised / next.at * 100)
          + "% of the way to " + shortVnd(next.at) + ". " + fmtVnd(next.at - sm.raised) + " to go!" });
    }
    if (pushState === "off") out.push({ text: "Want a ping when you\u2019re given a job? Turn on notifications in the green bar at the top." });
    out.push({ text: "Spent money for Ch\u1ea1m? Tap + Log money on the right. It takes ten seconds." });

    /* the team report leads: next job due, best, worst */
    const tl = teamLines();
    if (tl.length) out.unshift({ title: "Ch\u00e0o " + first + "! Today\u2019s report:", rows: tl.map((l) => l.text), go: ["tasks", "See all jobs"] });
    else out[0] = { ...out[0], text: "Ch\u00e0o " + first + "! " + out[0].text };
    return out;
  }

  function showBubble(line, count) {
    const b = $("mascot-bubble");
    b.replaceChildren();
    b.className = "mascot-bubble" + (line.tone ? " " + line.tone : "");
    b.appendChild(el("button", { class: "mb-x", type: "button", "aria-label": "Close", text: "\u00d7",
      onclick: (e) => { e.stopPropagation(); hideBubble(); } }));
    if (line.title) b.appendChild(el("p", { class: "mb-title", text: line.title }));
    if (line.rows) b.appendChild(el("ul", { class: "mb-rows" }, line.rows.map((r) => el("li", { text: r }))));
    if (line.text) b.appendChild(el("p", { class: "mb-text", text: line.text }));
    const foot = el("div", { class: "mb-foot" });
    if (line.go) foot.appendChild(el("button", { class: "mb-go", type: "button", text: line.go[1] + " \u2192",
      onclick: () => { hideBubble(); setView(line.go[0]); window.scrollTo({ top: 0, behavior: "smooth" }); } }));
    if (foot.childElementCount) b.appendChild(foot);
    b.hidden = false;
    $("mascot").classList.add("talking");
  }
  function hideBubble() {
    clearTimeout(mascotTimer);
    const b = $("mascot-bubble");
    if (b) b.hidden = true;
    $("mascot").classList.remove("talking");
  }
  function mascotSay(text) {
    showBubble({ text, tone: "ok" }, 1);
    clearTimeout(mascotTimer);
    mascotTimer = setTimeout(hideBubble, 6000);
  }

  function renderMascot() {
    const wrap = $("mascot");
    if (!wrap) return;
    wrap.hidden = false;
    /* she stands on the "+ Log money" button when it's there, in the corner when it isn't */
    const fab = $("log-fab");
    wrap.classList.toggle("on-fab", Boolean(fab && !fab.hidden));
    /* stand just under the header, however tall it is on this screen */
    const top = document.querySelector("header.top");
    if (top && !renderMascot.watching) {
      renderMascot.watching = true;
      const fit = () => {
        const R = document.documentElement.style;
        R.setProperty("--top-h", top.offsetHeight + "px");
        /* on phones she stands inside the header, between its first line and the tabs */
        const br = top.querySelector(".brandrow"), tb = top.querySelector(".tabs");
        if (br && tb) {
          R.setProperty("--brand-b", Math.round(br.getBoundingClientRect().bottom) + "px");
          R.setProperty("--tabs-b", Math.round(tb.getBoundingClientRect().bottom) + "px");
        }
        /* on wider screens she stands right under the "chat read to" date */
        const st = $("stamp");
        if (st && st.offsetParent) {
          const b = st.getBoundingClientRect();
          R.setProperty("--stamp-b", Math.round(b.bottom) + "px");
          R.setProperty("--stamp-r", Math.max(6, Math.round(document.documentElement.clientWidth - b.right)) + "px");
        }
      };
      renderMascot.fit = fit;
      window.addEventListener("resize", fit);
      if (window.ResizeObserver) new ResizeObserver(fit).observe(top);
    }
    if (renderMascot.fit) renderMascot.fit();   // the date's width changes once data loads
    /* speak up once per visit, a moment after the page settles, then go quiet */
    if (!mascotAutoDone && sessionKnown) {
      mascotAutoDone = true;
      setTimeout(() => {
        const lines = mascotLines();
        mascotIdx = 0;
        showBubble(lines[0], lines.length);
        mascotTimer = setTimeout(hideBubble, 12000);
      }, 1200);
    }
  }
  /* Judy's clock: Ho Chi Minh City time, ticking every second, whatever
     time zone the phone happens to be in. */
  (function mascotClock() {
    const t = $("mc-t"), sec = $("mc-s"), d = $("mc-d");
    if (!t) return;
    const TZ = "Asia/Ho_Chi_Minh";
    const hm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
    const ss = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, second: "2-digit" });
    const day = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
    function tick() {
      const now = new Date();
      t.textContent = hm.format(now);
      sec.textContent = ":" + ss.format(now).padStart(2, "0");
      d.textContent = day.format(now).replace(",", "").replace("Sept", "Sep");
      setTimeout(tick, 1000 - (Date.now() % 1000) + 5);   // land on the second
    }
    tick();
  })();

  function renderMoney() {
    const list = $("money-list");
    const tiles = $("money-tiles");
    const chart = $("money-chart");
    list.replaceChildren(); tiles.replaceChildren(); chart.replaceChildren();

    renderMoneyCta();

    if (!SESSION) {
      $("money-goal").replaceChildren();
      $("money-tools").replaceChildren();
      $("money-filters").replaceChildren();
      list.appendChild(el("div", { class: "empty-state", text: "Sign in to see the money log. It is kept off the public page on purpose." }));
      return;
    }

    const all = LEDGER || [];
    renderMoneyGoal(all);
    const thisMonth = monthKey(TODAY);
    const inMonth = all.filter((m) => monthKey(m.date) === thisMonth);
    const outM = inMonth.filter((m) => m.kind === "out").reduce((a, m) => a + m.amount, 0);
    const inM  = inMonth.filter((m) => m.kind === "in").reduce((a, m) => a + m.amount, 0);
    const owed = all.filter((m) => m.kind === "out" && m.owed && !m.repaid);
    const owedSum = owed.reduce((a, m) => a + m.amount, 0);
    const notInSheet = all.filter((m) => m.status === "new").length;

    [
      ["Out this month", fmtVnd(outM), false],
      ["In this month", fmtVnd(inM), false],
      ["Owed back to members", owed.length ? fmtVnd(owedSum) : "Nobody", owed.length > 0],
    ].concat(canManageMoney() ? [["Not in the sheet yet", String(notInSheet), notInSheet > 0]] : [])
    .forEach(([k, v, flag]) => tiles.appendChild(el("div", { class: "kpi" }, [
      el("span", { class: "tl-k", text: k }),
      el("span", { class: "tl-n money-n" + (flag ? " bad" : ""), text: v })
    ])));

    /* ----- kind + filter chips ----- */
    const fbox = $("money-filters");
    if (!fbox.childElementCount) {
      [["out","Money out"],["in","Money in"]].forEach(([k, label]) => fbox.appendChild(el("button", {
        class: "chipbtn plain", "aria-pressed": String(S.moneyKind === k), "data-k": "kind-" + k, text: label,
        onclick: () => { S.moneyKind = k;
          fbox.querySelectorAll('[data-k^="kind-"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === "kind-" + k)));
          renderMoney(); }
      })));
      fbox.appendChild(el("span", { class: "fsep" }));
      [["all","Everything"],["new","Not in the sheet"],["owed","Owed back"]].forEach(([k, label]) => fbox.appendChild(el("button", {
        class: "chipbtn plain", "aria-pressed": String(S.moneyShow === k), "data-k": "show-" + k, text: label,
        onclick: () => { S.moneyShow = k;
          fbox.querySelectorAll('[data-k^="show-"]').forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.k === "show-" + k)));
          renderMoney(); }
      })));
    }

    const ofKind = all.filter((m) => m.kind === S.moneyKind);
    renderMoneyTools(ofKind);

    /* budget lines people have used before, offered as suggestions */
    const dl = $("budget-lines");
    if (dl) {
      dl.replaceChildren();
      [...new Set(all.map((m) => m.budgetLine).filter(Boolean))].sort()
        .forEach((b) => dl.appendChild(el("option", { value: b })));
    }

    /* ----- this month by category: one series, one colour ----- */
    const byCat = {};
    inMonth.filter((m) => m.kind === S.moneyKind).forEach((m) => { byCat[m.category] = (byCat[m.category] || 0) + m.amount; });
    const cats = Object.entries(byCat).sort((a, b) => b[1] - a[1]);
    if (cats.length) {
      const top = cats[0][1];
      const plot = el("div", { class: "viz-plot" });
      cats.forEach(([c, v]) => {
        const bar = el("button", { class: "mbar" + (S.moneyKind === "in" ? " in" : ""), type: "button",
          style: "width:" + Math.max(2, Math.round((v / top) * 100)) + "%",
          "aria-label": c + ": " + fmtVnd(v) });
        tip(bar, [c, fmtVnd(v), MONTH_FULL[fromIso(TODAY).getMonth()]]);
        plot.appendChild(el("div", { class: "hrow" }, [
          el("span", { class: "hname", text: c }),
          el("div", { class: "htrack" }, [bar]),
          el("span", { class: "hval money-v", text: fmtVnd(v) })
        ]));
      });
      chart.appendChild(el("section", { class: "viz" }, [
        el("h3", { class: "viz-h", text: (S.moneyKind === "out" ? "Where it went" : "Where it came from") + " this month" }),
        plot
      ]));
    }

    /* ----- the log itself: a ledger, month by month ----- */
    let rows = ofKind;
    if (S.moneyShow === "new") rows = rows.filter((m) => m.status === "new");
    if (S.moneyShow === "owed") rows = rows.filter((m) => m.owed && !m.repaid);
    rows = rows.slice().sort((a, b) => (b.date || "").localeCompare(a.date || ""));

    if (!rows.length) {
      list.appendChild(el("div", { class: "empty-state", text:
        !all.length ? "Nothing logged yet. Spent money on Ch\u1ea1m? Log it above the same day."
                    : "Nothing here with that filter." }));
      return;
    }

    const months = new Map();
    rows.forEach((m) => {
      const k = monthKey(m.date);
      if (!months.has(k)) months.set(k, []);
      months.get(k).push(m);
    });

    months.forEach((items, mk) => {
      const total = items.reduce((a, m) => a + m.amount, 0);
      const ledger = el("div", { class: "ledger" });
      ledger.appendChild(el("div", { class: "lg-head" }, [
        el("span", { class: "lg-month", text: monthName(mk) }),
        el("span", { class: "lg-total", text: (S.moneyKind === "out" ? "\u2212 " : "+ ") + fmtVnd(total) })
      ]));

      items.forEach((m) => {
        const d = fromIso(m.date);
        const isMine = SESSION.email && m.createdBy === SESSION.email;
        const methodName = (METHODS.find(([v]) => v === m.method) || [0, m.method])[1];

        /* only the facts that are not obvious; nothing that repeats */
        const meta = [m.category];
        if (m.budgetLine) meta.push(m.budgetLine);
        meta.push(whoName(m.paidBy));
        if (methodName) meta.push(methodName);

        const flags = el("span", { class: "lg-flags" });
        if (m.owed && !m.repaid) flags.appendChild(el("span", { class: "lg-flag owed", text: "owe " + whoName(m.paidBy) }));
        if (m.owed && m.repaid) flags.appendChild(el("span", { class: "lg-flag ok", text: "paid back" }));
        if (m.status === "new" && canManageMoney()) flags.appendChild(el("span", { class: "lg-flag todo", text: "not in sheet" }));

        const acts = el("div", { class: "lg-acts" });
        if (m.receipt) acts.appendChild(el("button", { class: "lg-a", type: "button", text: "Receipt",
          onclick: () => openLightbox({ data: m.receipt, who: m.paidBy, date: m.date, caption: m.description }) }));
        if (canManageMoney() && m.status === "new") acts.appendChild(el("button", { class: "lg-a", type: "button", text: "In sheet",
          onclick: () => window.ChamLive.setMoneyStatus([m.id], "logged").catch((e) => flash(acts, "Did not save. " + (e.code || e.message))) }));
        if (canManageMoney() && m.owed && !m.repaid) acts.appendChild(el("button", { class: "lg-a", type: "button", text: "Paid back",
          onclick: () => window.ChamLive.setMoneyStatus([m.id], "repaid").catch((e) => flash(acts, "Did not save. " + (e.code || e.message))) }));
        if (canManageMoney() || (isMine && m.status === "new")) acts.appendChild(el("button", { class: "lg-a danger", type: "button", text: "Delete",
          onclick: async () => {
            if (!window.confirm("Delete \u201c" + m.description + "\u201d (" + fmtVnd(m.amount) + ")?")) return;
            try { await window.ChamLive.deleteMoney(m.id); }
            catch (e) { flash(acts, "Did not delete. " + (e.code || e.message)); }
          } }));

        ledger.appendChild(el("div", { class: "lg-row " + (m.kind === "in" ? "in" : "out") }, [
          el("div", { class: "lg-date" }, d ? [
            el("b", { text: String(d.getDate()) }), el("span", { text: MON[d.getMonth()] })
          ] : [el("span", { text: "\u2014" })]),
          el("div", { class: "lg-main" }, [
            el("div", { class: "lg-desc" }, [el("span", { text: m.description }), flags]),
            el("div", { class: "lg-meta", text: meta.join(" \u00b7 ") + (m.notes ? " \u2014 " + m.notes : "") }),
            acts.childElementCount ? acts : null
          ]),
          el("div", { class: "lg-amt", text: (m.kind === "in" ? "+ " : "\u2212 ") + fmtVnd(m.amount) })
        ]));
      });

      list.appendChild(ledger);
    });
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

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    window.addEventListener("load", () => {
      navigator.serviceWorker.register("sw.js").catch((e) => console.warn("sw:", e));
    });
  }

  /* A phone keeps the app open in the background for days, so it never
     sees a new version. Whenever it comes back to the front, ask GitHub
     which version is current and reload if it is newer - but only when
     nobody is halfway through typing something. */
  (function stayCurrent() {
    const mine = (document.querySelector('script[src*="app.js"]') || {}).src || "";
    const ver = (mine.match(/[?&]v=(\d+)/) || [])[1];
    if (!ver) return;
    let last = Date.now();
    async function check() {
      if (document.visibilityState !== "visible" || Date.now() - last < 60000) return;
      last = Date.now();
      try {
        const html = await (await fetch("./?fresh=" + last, { cache: "no-store" })).text();
        const live = (html.match(/app\.js\?v=(\d+)/) || [])[1];
        if (!live || live === ver) return;
        const a = document.activeElement;
        const busy = (a && /^(INPUT|TEXTAREA|SELECT)$/.test(a.tagName) && a.value)
          || ($("money-sheet") && $("money-sheet").open);
        if (busy) { last = 0; return; }   // try again next time
        location.reload();
      } catch (e) { /* offline - fine */ }
    }
    document.addEventListener("visibilitychange", check);
    window.addEventListener("focus", check);
    window.addEventListener("pageshow", (e) => { if (e.persisted) { last = 0; check(); } });
  })();

  const fromLink = location.hash.slice(1);
  if (fromLink === "log") { setView("money"); pendingLog = true; openMoneySheet(); }
  else setView(VIEWS.includes(fromLink) ? fromLink : "updates");
  window.addEventListener("hashchange", () => {
    const h = location.hash.slice(1);
    if (h === "log") { setView("money"); openMoneySheet(); return; }
    if (VIEWS.includes(h) && h !== S.view) setView(h);
  });
})();

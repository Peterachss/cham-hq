(async () => {
  "use strict";

  /* ------------------------------------------------------------------ *
   * data — everything below comes from the ISHCMC Chạm Nonprofit group
   * chat export of 25 Sep 2026. Nothing is invented.
   * ------------------------------------------------------------------ */
  /* Members only: nothing is on the page until a member signs in. live.js
     checks the account, reads the base data from the members-only
     database and hands it over here. Signed out, this simply waits. */
  let TODAY, PEOPLE, DAYS, TASKS, EVENTS, UNDATED, MONEY, LINKS;
  const boot = window.__chamData || await new Promise((res) =>
    window.addEventListener("cham-data", (e) => res(e.detail), { once: true }));
  ({ TODAY, PEOPLE, DAYS, TASKS, EVENTS, UNDATED, MONEY, LINKS } = boot);

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

  /* Panels are built as lists like [header, maybeThis, maybeThat] where a
     part that has nothing to show is null. The browser's own append() and
     replaceChildren() would print those as the word "null" - so skip them,
     everywhere, once. */
  for (const m of ["append", "prepend", "replaceChildren"]) {
    const orig = Element.prototype[m];
    Element.prototype[m] = function (...kids) {
      return orig.apply(this, kids.filter((k) => k !== null && k !== undefined && k !== false));
    };
  }

  /* "Are you sure?" without a pop-up. Browser confirm boxes can be blocked
     (in-app browsers, or after ticking "don't show more dialogs"), and a
     blocked one silently answers no - so the button seemed dead. Instead
     the first tap turns the button into "Tap again to ..." for four
     seconds, and only a second tap does it. Returns true on that second tap. */
  function tapTwice(btn, ask) {
    if (btn._armed) {
      clearTimeout(btn._armed); btn._armed = null;
      btn.classList.remove("armed"); btn.textContent = btn._label;
      return true;
    }
    btn._label = btn.textContent;
    btn.textContent = ask;
    btn.classList.add("armed");
    btn._armed = setTimeout(() => { btn._armed = null; btn.classList.remove("armed"); btn.textContent = btn._label; }, 4000);
    return false;
  }

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
  let SALES = null, ORDERS = null, ACTS = null, SPONSORS = null, MEETINGS = null, PUSHSTATUS = null;
  let SYS = null, OB = null;
  const NUDGED = {};          // job id -> when you last nudged it, this visit

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
    setSysStatus(d) { SYS = d; if (S.view === "updates") renderSystem(); },
    setOnboarding(d) {
      const first = OB === null;
      OB = d || {};
      // someone who hasn't finished setting up lands on their checklist
      if (first && !OB.dismissed && obSteps().some((x) => !x.done) && !location.hash) setView("me");
      else if (S.view === "me") renderMe();
    },
    setPushStatus(d) { PUSHSTATUS = d; if (S.view === "updates") renderWhosOn(); },
    setSponsors(rows) { SPONSORS = Array.isArray(rows) ? rows : null; render(); },
    setMeetings(rows) { MEETINGS = Array.isArray(rows) ? rows : null; if (S.view === "calendar") { renderMeetings(); renderCalendar(); } },
    setActivities(rows) { ACTS = Array.isArray(rows) ? rows : null; if (S.view === "tracker") renderImpact(); },
    setSales(rows) { SALES = Array.isArray(rows) ? rows : null; if (S.view === "money") renderSales(); },
    setOrders(rows) { ORDERS = Array.isArray(rows) ? rows : null; if (S.view === "money") renderSales(); },
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
      if (!s) closeMoneySheet();
      /* Panels are built once and then left alone, so they have to be torn
         down when the person changes - otherwise signing in after somebody
         else leaves you looking at their buttons. */
      ["task-filters","status-filters","upd-filters","photo-filters",
       "upd-admin","admin-panel","photo-add","money-add","money-tools","money-filters","announce","sales","sponsors","meetings","whos-on","me","system","countdown"].forEach((id) => {
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

  /* Buzz every device you have, to check. The sender on Peter's laptop picks
     it up within seconds; with the laptop off, GitHub does within ~15 min. */
  async function sendTest(e) {
    const b = e.currentTarget, txt = b.parentNode.querySelector(".nb-text");
    if (!SESSION || !window.ChamLive || !window.ChamLive.testPush) return;
    b.disabled = true; b.textContent = "Sending\u2026";
    let answered = false;
    const reset = () => { b.disabled = false; b.textContent = "Send me a test"; };
    try {
      await window.ChamLive.testPush(SESSION.personKey, SESSION.name, (n) => {
        answered = true;
        txt.textContent = n ? "\u2713 Sent to " + n + " of your devices \u2014 check your phone"
                            : "No devices found \u2014 tap Turn off, then turn it on again";
        reset();
      });
      setTimeout(() => {
        if (answered) return;
        txt.textContent = "Queued \u2014 it\u2019ll arrive within about 15 minutes";
        reset();
      }, 20000);
    } catch (err) {
      txt.textContent = "Couldn\u2019t send a test. " + (err.code || err.message || "");
      reset();
    }
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
        el("button", { class: "nb-link nb-test", type: "button", text: "Send me a test", onclick: sendTest }),
        el("button", { class: "nb-link", type: "button", text: "Turn off", onclick: turnPushOff })
      );
      bar.hidden = false;
      return;
    }

    const nudgedBy = SESSION && SESSION.nudged ? (PEOPLE[SESSION.nudged.by] ? PEOPLE[SESSION.nudged.by].name : "An admin") : null;
    if (!nudgedBy && Date.now() < dismissedUntil()) { bar.hidden = true; return; }

    const later = el("button", { class: "nb-link", type: "button", text: "Not now",
      onclick: () => { dismissForAWeek(); bar.hidden = true; } });

    bar.className = "nb" + (nudgedBy ? " nb-nudged" : "");
    if (nudgedBy) bar.append(el("div", { class: "nb-ask", text: "\ud83d\udc4b " + nudgedBy + " asked you to turn these on \u2014 it takes ten seconds." }));
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

  const VIEWS = ["me","updates","calendar","tasks","money","photos","tracker","sponsors"];
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
    renderNow();
  }

  /* ------------------------------------------------------------------ *
   * render
   * ------------------------------------------------------------------ */
  /* Firestore can deliver several snapshots in a burst when the page opens
     (tasks, updates, money, photos...). Each one asks for a render; they
     are folded into a single render on the next frame. A tab click renders
     straight away. */
  let renderQueued = false;
  function render() {
    if (renderQueued) return;
    renderQueued = true;
    // next frame - or, if the tab is in the background (browsers pause
    // frames there), a quarter of a second, so an update is never stuck
    const go = () => { if (renderQueued) renderNow(); };
    requestAnimationFrame(go);
    setTimeout(go, 250);
  }
  function renderNow() {
    renderQueued = false;
    renderGlance();
    renderNotify();
    renderFab();
    if (S.view === "updates") { renderCountdown(); renderAnnounce(); renderWhosOn(); renderSystem(); renderDrafts(); renderFeed(); renderUpdateAdmin(); }
    if (S.view === "me") renderMe();
    if (S.view === "calendar") { renderMeetings(); renderCalendar(); }
    if (S.view === "sponsors") renderSponsors();
    if (S.view === "tasks") renderTasks();
    if (S.view === "money") { renderSales(); renderMoney(); }
    if (S.view === "photos") renderPhotos();
    if (S.view === "tracker") { renderImpact(); renderTracker(); }
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
    const fromMeetings = (MEETINGS || []).filter((m) => m.date).map((m) => ({
      date: m.date, title: "Meeting: " + m.title,
      sub: m.people.map((k) => PEOPLE[k] ? PEOPLE[k].name : k).join(", "),
      state: m.date < TODAY ? "past" : "confirmed"
    }));
    return EVENTS.concat(fromTasks, fromMeetings);
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
    $("n-sponsors").textContent = SPONSORS ? SPONSORS.filter((x) => x.stage !== "no").length : "";
    const need = SESSION ? meNeeds().length : 0;
    $("n-me").textContent = need ? String(need) : "";
    $("n-me").classList.toggle("hot", need > 0);
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
            onclick: async (e) => {
              if (!tapTwice(e.currentTarget, "Remove?")) return;
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
        onclick: async (e) => {
          if (!tapTwice(e.currentTarget, "Tap again to discard")) return;
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
  /* ------------------------------------------------------------------ *
   * Admins: who is actually getting notifications. The list comes from the
   * sender (meta/pushStatus); nudging someone puts a banner in front of
   * them next time they open the site, until a device of theirs is on.
   * ------------------------------------------------------------------ */
  function renderWhosOn() {
    const box = $("whos-on");
    if (!box) return;
    const on = Boolean(SESSION && SESSION.admin && PUSHSTATUS && PUSHSTATUS.people);
    box.hidden = !on;
    if (!on) { box.replaceChildren(); return; }
    const ppl = Object.entries(PUSHSTATUS.people)
      .filter(([k]) => PEOPLE[k] && !/^Left /.test(PEOPLE[k].role || ""))
      .sort((a, b) => (a[1].devices.length > 0) - (b[1].devices.length > 0) || a[1].name.localeCompare(b[1].name));
    const onN = ppl.filter(([, p]) => p.devices.length).length;
    const off = ppl.filter(([, p]) => !p.devices.length).map(([, p]) => p.name);
    const wasOpen = box.querySelector("details") && box.querySelector("details").open;
    const rows = ppl.map(([k, p]) => {
      const isOn = p.devices.length > 0;
      const nudged = NUDGED_N[k];
      return el("div", { class: "wo-row" + (isOn ? " on" : "") }, [
        avatar(k), el("b", { text: p.name }),
        el("span", { class: "wo-dev", text: isOn ? p.devices.join(" \u00b7 ") : "off" }),
        isOn ? el("span", { class: "wo-ok", text: "\u2713" })
             : el("button", { class: "act" + (nudged ? " sent" : ""), type: "button", disabled: nudged, text: nudged ? "Nudged \u2713" : "Nudge",
                 title: "Shows " + p.name + " a banner asking them to turn notifications on, next time they open the site",
                 onclick: async (e) => {
                   const b = e.currentTarget; b.disabled = true;
                   try { await window.ChamLive.nudgeNotify(p.email, SESSION.personKey); NUDGED_N[k] = true; b.textContent = "Nudged \u2713"; b.classList.add("sent"); toast(p.name + " will see a reminder next time"); }
                   catch (err) { b.disabled = false; toast("Didn\u2019t save. " + (err.code || err.message)); }
                 } })
      ]);
    });
    const msg = "Can everyone turn on notifications for Ch\u1ea1m HQ? Open peterachss.github.io/cham-hq, sign in, tap Turn on in the green bar. iPhone: Share \u2192 Add to Home Screen first, then open it from there.";
    box.replaceChildren(el("details", { open: wasOpen }, [
      el("summary", {}, [el("b", { text: "\ud83d\udd14 " + onN + " of " + ppl.length + " get notifications" }),
        off.length ? el("span", { class: "wo-off", text: " \u00b7 off: " + off.join(", ") }) : null]),
      el("div", { class: "wo-list" }, rows),
      off.length ? el("div", { class: "sf-row" }, [
        el("span", { class: "an-sub", text: "Or paste a reminder in the group chat:" }),
        el("button", { class: "act ghost", type: "button", text: "Copy reminder", onclick: async (e) => {
          const b = e.currentTarget;
          try { await navigator.clipboard.writeText(msg); b.textContent = "Copied \u2713"; } catch (err) { b.textContent = "Couldn\u2019t copy"; }
          setTimeout(() => { b.textContent = "Copy reminder"; }, 2500);
        } })]) : null
    ]));
  }
  const NUDGED_N = {};

  /* ------------------------------------------------------------------ *
   * Me - everything that is mine, in one place
   * ------------------------------------------------------------------ */
  function meNeeds() {
    if (!SESSION) return [];
    const me = SESSION.personKey, soon = shiftDay(TODAY, 1), out = [];
    TASKS.filter((t) => t.who === me && t.status !== "done" && t.due && t.due <= soon).forEach((t) => out.push("job"));
    (SPONSORS || []).filter((x) => x.owner === me && !["agreed", "no"].includes(x.stage) && x.next && x.next <= TODAY).forEach(() => out.push("sponsor"));
    (MEETINGS || []).forEach((m) => m.decisions.forEach((d) => { if (d.who === me && !d.taskId) out.push("action"); }));
    return out;
  }

  /* ------------------------------------------------------------------ *
   * Getting started: the five things every member needs to do once.
   * Ticks itself where the site can tell (notifications on, opened from
   * the home screen); the rest are one tap. Saved per person, so it
   * follows you between devices.
   * ------------------------------------------------------------------ */
  const STANDALONE = () => (window.matchMedia && matchMedia("(display-mode: standalone)").matches) || navigator.standalone === true;
  const IS_PHONE = /android|iphone|ipad|ipod|mobile/i.test(navigator.userAgent);
  function obSteps() {
    const ob = OB || {}, me = SESSION ? SESSION.personKey : null;
    const touched = TASKS.some((t) => t.who === me && (t.status !== "open" || (t.progress || 0) > 0));
    return [
      { k: "home", title: "Put Ch\u1ea1m HQ on your home screen", done: Boolean(ob.home) || STANDALONE(),
        how: IS_IOS ? "In Safari tap Share (the square with an arrow) \u2192 Add to Home Screen, then open Ch\u1ea1m HQ from your home screen \u2014 on iPhone that\u2019s the only way notifications work."
           : IS_PHONE ? "Tap the \u22ee menu \u2192 Install app (or Add to Home screen). It opens like a real app after that."
           : "On a computer this is optional \u2014 bookmark it, or do it later on your phone.", btn: "Done" },
      { k: "notify", title: "Turn on notifications", done: Boolean(ob.notify) || pushState === "on",
        how: pushState === "ios" ? "Do the home-screen step first; then the Turn on button appears in the bar at the top."
           : pushState === "denied" ? "They\u2019re blocked: click the padlock next to the web address, set Notifications to Allow, then reload."
           : "Tap Turn on in the green bar at the top and Allow. You\u2019ll hear about new jobs, nudges and announcements.", btn: "Take me there", go: () => window.scrollTo({ top: 0, behavior: "smooth" }) },
      { k: "password", title: "Change your password", done: Boolean(ob.password),
        how: "Swap the password you were given for your own.", btn: "Change it now", go: () => window.ChamLive.openPasswordForm(), noTick: true },
      { k: "job", title: "Look at your jobs", done: Boolean(ob.job) || touched,
        how: "Your jobs are just below. Tap Doing it on one you\u2019ve started, or slide how far along it is.", btn: "Show me",
        go: () => { const j = $("me-jobs"); if (j) j.scrollIntoView({ behavior: "smooth", block: "start" }); } },
      { k: "tour", title: "The 1-minute tour", done: Boolean(ob.tour), how: "", btn: "Show me around", tour: true }
    ];
  }

  function welcomeCard() {
    if (!OB || OB.dismissed) return null;
    const steps = obSteps();
    // quietly record what the site could see for itself
    const seen = {};
    if (steps[0].done && !OB.home) seen.home = true;
    if (pushState === "on" && !OB.notify) seen.notify = true;
    if (steps[3].done && !OB.job) seen.job = true;
    if (Object.keys(seen).length) window.ChamLive.saveOnboarding(seen).catch(() => {});
    const done = steps.filter((x) => x.done).length;
    if (done === steps.length) {
      if (!OB.finished) { window.ChamLive.saveOnboarding({ finished: true }).catch(() => {}); toast("All set up \ud83c\udf89"); }
      return null;
    }
    const tick = (k) => window.ChamLive.saveOnboarding({ [k]: true }).catch((err) => toast("Didn\u2019t save. " + (err.code || err.message)));
    const TOUR = [["Me", "your jobs, points, money owed to you \u2014 start here"], ["Updates", "what happened, day by day; admins announce from here"],
      ["Calendar", "dates, deadlines and meetings"], ["Tasks", "every job, who has it, how far along"], ["Money", "log anything spent or taken, pre-orders"],
      ["Photos", "pictures for CAS \u2014 members only"], ["Tracker", "points, Officer of the week, impact"], ["Sponsors", "who we\u2019re asking for support"],
      ["+ Log money", "the green button, on every tab"]];
    return el("section", { class: "welcome" }, [
      el("div", { class: "wl-head" }, [
        el("b", { text: "\ud83d\udc4b Welcome to Ch\u1ea1m HQ \u2014 " + done + " of " + steps.length + " done" }),
        el("button", { class: "nb-link", type: "button", text: "Hide", onclick: () => tick("dismissed") })
      ]),
      el("div", { class: "wl-bar" }, [el("span", { style: "width:" + (done / steps.length * 100) + "%" })]),
      el("ol", { class: "wl-steps" }, steps.map((x) => el("li", { class: x.done ? "done" : "" }, [
        el("span", { class: "wl-tick", "aria-hidden": "true", text: x.done ? "\u2713" : "" }),
        el("div", { class: "wl-body" }, x.done ? [el("b", { text: x.title })] : [
          el("b", { text: x.title }),
          x.how ? el("span", { text: x.how }) : null,
          x.tour ? el("details", { class: "wl-tour" }, [el("summary", { text: x.btn }),
            el("ul", {}, TOUR.map(([t, d]) => el("li", {}, [el("b", { text: t }), document.createTextNode(" \u2014 " + d)]))),
            el("button", { class: "act", type: "button", text: "Got it", onclick: () => tick("tour") })])
          : el("div", { class: "sf-row" }, [
              el("button", { class: "act", type: "button", text: x.btn, onclick: () => { if (x.go) x.go(); if (!x.noTick && x.k !== "notify") tick(x.k); } }),
              x.k === "home" || x.k === "password" ? el("button", { class: "nb-link", type: "button", text: x.k === "password" ? "Already did" : "Skip", onclick: () => tick(x.k) }) : null])
        ])
      ])))
    ]);
  }

  /* ------------------------------------------------------------------ *
   * The next event, counting down: its jobs, its pre-orders, its money.
   * It comes from a pre-order sale or an activity with a date; failing
   * that, a target date from the plan (marked as not locked yet).
   * ------------------------------------------------------------------ */
  const STOP = new Set(["sale", "sales", "event", "before", "after", "break", "target", "first", "with", "from", "the", "and", "one", "day", "our", "chạm"]);
  function nextEvents() {
    const out = [];
    (SALES || []).forEach((x) => { if (x.date && x.date >= TODAY) out.push({ name: x.name, date: x.date, sale: x }); });
    (ACTS || []).forEach((a) => { if (a.date && a.date >= TODAY) out.push({ name: a.name, date: a.date }); });
    EVENTS.forEach((e) => {
      if (e.date >= TODAY && e.state !== "past" && /sale|fundrais|booth|drop|market|tournament|program/i.test(e.title))
        out.push({ name: e.title.replace(/^Target:\s*/i, ""), date: e.date, tentative: e.state === "target" });
    });
    const seen = new Set();
    return out.sort((a, b) => a.date.localeCompare(b.date) || (Number(!!a.tentative) - Number(!!b.tentative)))
      .filter((e) => { const k = e.date + e.name.toLowerCase(); if (seen.has(k)) return false; seen.add(k); return true; });
  }

  function renderCountdown() {
    const box = $("countdown");
    if (!box) return;
    const evs = SESSION ? nextEvents() : [];
    box.hidden = !evs.length;
    if (!evs.length) { box.replaceChildren(); return; }
    const e = evs[0], d = days(TODAY, e.date);
    const words = e.name.toLowerCase().split(/[^a-zà-ỹ0-9#]+/i).filter((w) => w.length >= 4 && !STOP.has(w));
    const jobs = TASKS.filter((t) => t.status !== "done"
      && (words.some((w) => t.title.toLowerCase().includes(w)) || t.due === e.date));   // named after it, or due that day
    const line = (e.sale && e.sale.name) || e.name;
    const money = (LEDGER || []).filter((m) => (m.budgetLine || "").toLowerCase() === line.toLowerCase());
    const mIn = money.filter((m) => m.kind === "in").reduce((n, m) => n + m.amount, 0);
    const mOut = money.filter((m) => m.kind === "out").reduce((n, m) => n + m.amount, 0);
    const orders = e.sale ? (ORDERS || []).filter((o) => o.sale === e.sale.id) : [];

    box.replaceChildren(
      el("div", { class: "cd-main" }, [
        el("div", { class: "cd-num" }, [el("span", { class: "cd-n", text: d === 0 ? "Today" : d === 1 ? "1" : String(d) }),
          d > 0 ? el("span", { class: "cd-k", text: d === 1 ? "day to go" : "days to go" }) : null]),
        el("div", { class: "cd-what" }, [
          el("b", { text: e.name.charAt(0).toUpperCase() + e.name.slice(1) }),
          el("span", { text: pretty(e.date) + (e.tentative ? " \u00b7 target date, not locked yet" : "") }),
        ])
      ]),
      el("div", { class: "cd-facts" }, [
        el("div", {}, [el("span", { class: "sf-k", text: "Jobs for it" }),
          jobs.length ? el("ul", { class: "cd-jobs" }, jobs.slice(0, 5).map((t) => el("li", {}, [avatar(t.who), el("span", { text: t.title }),
            el("span", { class: "pill " + (t.due && t.due < TODAY ? "late" : t.status), text: t.due && t.due < TODAY ? "overdue" : STATUS[t.status].label })])))
          : el("span", { class: "cd-none", text: "Nothing on the jobs list mentions it yet." })]),
        e.sale ? el("div", {}, [el("span", { class: "sf-k", text: "Pre-orders" }),
          el("span", { class: "cd-val", text: orders.length + " order" + (orders.length === 1 ? "" : "s") + " \u00b7 " + (e.sale.open ? "taking orders" : "closed") })]) : null,
        el("div", {}, [el("span", { class: "sf-k", text: "Money" }),
          el("span", { class: "cd-val", text: money.length ? "In " + fmtVnd(mIn) + " \u00b7 out " + fmtVnd(mOut) + " \u00b7 left " + fmtVnd(mIn - mOut) : "Nothing logged for it yet \u2014 log costs under \u201c" + line + "\u201d." })])
      ]),
      evs.length > 1 ? el("p", { class: "cd-then", text: "Then: " + evs.slice(1, 3).map((x) => x.name + " (" + days(TODAY, x.date) + " days)").join(" \u00b7 ") }) : null
    );
  }

  /* ------------------------------------------------------------------ *
   * Admins: is everything that runs in the background still running?
   * ------------------------------------------------------------------ */
  function ago(iso) {
    const m = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
    if (m < 2) return "just now";
    if (m < 60) return m + " min ago";
    if (m < 48 * 60) return Math.round(m / 60) + " h ago";
    return Math.round(m / 1440) + " days ago";
  }
  function renderSystem() {
    const box = $("system");
    if (!box) return;
    const on = Boolean(SESSION && SESSION.admin && SYS);
    box.hidden = !on;
    if (!on) { box.replaceChildren(); return; }
    const J = SYS.jobs || {};
    const rows = [
      ["Notifications", "every 15 min", J.push && J.push.at, 1, J.push],
      ["GitHub backup job", "every 15 min, laptop off too", J.push && J.push.githubAt, 3, J.push, "gh"],
      ["Instant announcements", "Peter\u2019s laptop", J.announce && J.announce.at, 0.5, J.announce, "laptop"],
      ["Finance sheet sync", "hourly", J.finance && J.finance.at, 6, J.finance],
      ["Nightly backup", "2am, Peter\u2019s laptop", J.backup && J.backup.at, 50, J.backup],
      ["9pm chat wrap", "Peter\u2019s laptop", J.chatwrap && J.chatwrap.at, 50, J.chatwrap]
    ].map(([label, when, at, hours, j, kind]) => {
      const age = at ? (Date.now() - new Date(at).getTime()) / 36e5 : null;
      let state, text;
      if (!at) { state = "grey"; text = "hasn\u2019t checked in yet"; }
      else if (j && j.ok === null && kind !== "gh") { state = "amber"; text = j.msg || "waiting"; }
      else if (j && j.ok === false && kind !== "gh") { state = "red"; text = "failing: " + (j.msg || "") + " (" + ago(at) + ")"; }
      else if (age > hours) { state = kind === "laptop" ? "amber" : "red"; text = "last ran " + ago(at) + (kind === "laptop" ? " \u2014 laptop off or asleep; GitHub covers it" : ""); }
      else { state = "green"; text = "ran " + ago(at) + (j && j.msg && kind !== "gh" ? " \u00b7 " + j.msg : ""); }
      return { label, when, state, text };
    });
    const bad = rows.filter((r) => r.state === "red").length;
    const wasOpen = box.querySelector("details") ? box.querySelector("details").open : bad > 0;
    box.replaceChildren(el("details", { open: wasOpen || bad > 0 }, [
      el("summary", {}, [el("b", { text: bad ? "\u26a0\ufe0f " + bad + " background job" + (bad === 1 ? "" : "s") + " need" + (bad === 1 ? "s" : "") + " attention" : "\u2699\ufe0f Background jobs: all running" })]),
      el("div", { class: "wo-list" }, rows.map((r) => el("div", { class: "sys-row" }, [
        el("span", { class: "sys-dot " + r.state, "aria-hidden": "true" }),
        el("div", {}, [el("b", { text: r.label }), el("span", { class: "sys-when", text: " \u00b7 " + r.when })]),
        el("span", { class: "sys-text " + r.state, text: r.text })
      ])))
    ]));
  }

  function renderMe() {
    const box = $("me");
    if (!box || !SESSION) return;
    const me = SESSION.personKey, p = PEOPLE[me] || { name: SESSION.name };
    const sec = (title, sub, kids) => el("section", { class: "me-sec" }, [
      el("h3", { class: "me-h" }, [document.createTextNode(title + " "), sub ? el("span", { text: sub }) : null])].concat(kids));

    // points
    const pt = pointsTable();
    const mine = pt.rows.find((r) => r.key === me);
    const rank = mine ? pt.rows.filter((r) => r.total > mine.total).length + 1 : null;
    const officer = pt.officers.includes(me);

    // jobs
    const jobs = TASKS.filter((t) => t.who === me && t.status !== "done")
      .sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
    const jobCards = jobs.map((t) => {
      const late = t.due && t.due < TODAY;
      const body = el("div", { class: "body" }, [
        el("div", { class: "tt", text: t.title }),
        t.note ? el("div", { class: "note", text: t.note }) : null,
        el("div", { class: "meta" }, [el("span", { class: "pill " + (late ? "late" : t.status), text: late ? "overdue" : STATUS[t.status].label }),
          t.due ? el("span", { class: "pill due", text: (late ? "was due " : "due ") + relDay(t.due) }) : el("span", { class: "pill due", text: "no date" })])
      ]);
      if (canEdit(t)) body.appendChild(taskActions(t));
      return el("article", { class: "card task s-" + (late ? "late" : t.status) }, [body]);
    });

    // money
    const owed = (LEDGER || []).filter((m) => m.kind === "out" && m.owed && !m.repaid && m.paidBy === me);
    const unsynced = (LEDGER || []).filter((m) => m.createdBy === SESSION.email && m.status === "new");
    const moneyRows = owed.map((m) => el("li", {}, [el("b", { text: fmtVnd(m.amount) }), document.createTextNode(" \u00b7 " + m.description + (m.date ? " \u00b7 " + pretty(m.date) : ""))]));

    // sponsors I chase
    const sps = (SPONSORS || []).filter((x) => x.owner === me && !["agreed", "no"].includes(x.stage))
      .sort((a, b) => (a.next || "9").localeCompare(b.next || "9"));
    // meetings
    const actions = [];
    (MEETINGS || []).forEach((m) => m.decisions.forEach((d) => { if (d.who === me && !d.taskId) actions.push({ m, d }); }));
    const nextMeets = (MEETINGS || []).filter((m) => m.date >= TODAY && (!m.people.length || m.people.includes(me))).sort((a, b) => a.date.localeCompare(b.date));

    const need = meNeeds().length;
    box.replaceChildren(
      welcomeCard(),
      el("div", { class: "me-head" }, [
        avatar(me, true),
        el("div", { class: "me-id" }, [el("h2", { class: "sec", text: "Hi " + p.name + (officer ? " \ud83d\udc6e" : "") }),
          el("span", { class: "an-sub", text: (p.role || "") + (SESSION.admin ? " \u00b7 admin" : "") })]),
        el("div", { class: "me-pts" }, [
          el("span", { class: "im-n", text: mine ? (mine.total > 0 ? "+" : "") + mine.total : "0" }),
          el("span", { class: "im-k", text: "points" + (rank ? " \u00b7 #" + rank + " of " + pt.rows.length : "") + (mine ? " \u00b7 " + (mine.week > 0 ? "+" : "") + mine.week + " this week" : "") })
        ])
      ]),
      el("p", { class: "me-need" + (need ? " hot" : "") }, [document.createTextNode(need
        ? (need === 1 ? "1 thing needs" : need + " things need") + " you soon \u2014 at the top of the lists below."
        : "Nothing urgent. Nice.")]),
      el("div", { id: "me-jobs" }, [sec("My jobs", jobs.length ? String(jobs.length) + " open" : "", jobCards.length ? [el("div", { class: "tasklist" }, jobCards)]
        : [el("p", { class: "viz-none", text: "No open jobs. Ask Bach or Thy for one, or take one from the chat." })])]),
      actions.length ? sec("From meetings", "not on the jobs list yet", [el("ul", { class: "me-list" }, actions.map(({ m, d }) =>
        el("li", {}, [el("b", { text: d.text }), document.createTextNode(" \u00b7 " + pretty(m.date) + " meeting" + (d.due ? " \u00b7 by " + relDay(d.due) : ""))])))]) : null,
      sec("Money", owed.length ? "owed to you: " + fmtVnd(owed.reduce((n, m) => n + m.amount, 0)) : "", [
        owed.length ? el("ul", { class: "me-list" }, moneyRows) : el("p", { class: "viz-none", text: "Ch\u1ea1m doesn\u2019t owe you anything right now." }),
        unsynced.length ? el("p", { class: "an-sub", text: unsynced.length + " line" + (unsynced.length === 1 ? "" : "s") + " you logged " + (unsynced.length === 1 ? "is" : "are") + " waiting to go into the finance sheet (that\u2019s automatic)." }) : null
      ]),
      sps.length ? sec("Sponsors you\u2019re chasing", String(sps.length), [el("ul", { class: "me-list" }, sps.map((x) => {
        const late = x.next && x.next <= TODAY;
        return el("li", { class: late ? "late" : "" }, [el("b", { text: x.name }), document.createTextNode(" \u00b7 " + (x.next ? (late ? "follow up now (" + relDay(x.next) + ")" : "follow up " + relDay(x.next)) : "no follow-up date") + " \u00b7 " + (STAGES_SP.find(([k]) => k === x.stage) || ["", x.stage])[1])]);
      }))]) : null,
      nextMeets.length ? sec("Coming up", "", [el("ul", { class: "me-list" }, nextMeets.slice(0, 4).map((m) =>
        el("li", {}, [el("b", { text: m.title }), document.createTextNode(" \u00b7 " + relDay(m.date))])))]) : null,
      sec("This device", "", [el("p", { class: "an-sub", text: pushState === "on" ? "\ud83d\udd14 Notifications are on here. Use \u201cSend me a test\u201d in the green bar at the top to check."
        : "\ud83d\udd15 Notifications are off on this device \u2014 turn them on in the bar at the top so you hear about new jobs and nudges." })])
    );
  }

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
          if (!tapTwice(send, "Tap again to send \u2192")) return;
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

    /* Sent ones tidy themselves away an hour after sending, and x hides one
       now. Hiding is just for you, on this device - it never unsends. Ones
       still sending always stay, so you can see they went. */
    const list = $("an-list");
    list.replaceChildren();
    clearTimeout(renderAnnounce.timer);
    const hidden = anHidden();
    const shown = (ANNOUNCES || []).filter((a) => a.kind !== "test" &&
      !hidden.includes(a.id) && !(a.status === "sent" && Date.now() - a.at.getTime() > AN_KEEP));
    const nextGone = Math.min(...shown.filter((a) => a.status === "sent").map((a) => a.at.getTime() + AN_KEEP - Date.now()));
    if (isFinite(nextGone)) renderAnnounce.timer = setTimeout(renderAnnounce, Math.max(1000, nextGone + 500));
    shown.forEach((a) => {
      const nudge = a.kind === "nudge";
      const toName = nudge ? (PEOPLE[a.to] ? PEOPLE[a.to].name : a.to) : "";
      const state = a.status !== "sent" ? "Sending\u2026"
        : nudge ? (a.sentTo ? "Buzzed " + toName : toName + " has notifications off")
        : (a.sentTo ? "Sent to " + a.sentTo + " " + (a.sentTo === 1 ? "person" : "people") : "Sent \u2014 nobody else has notifications on yet");
      const when = a.at.toLocaleString("en-GB", { weekday: "short", hour: "2-digit", minute: "2-digit" });
      const missed = a.status === "sent" && !a.sentTo;
      list.appendChild(el("li", { class: "an-item" + (a.status === "sent" ? " sent" : "") + (missed ? " missed" : "") }, [
        el("span", { class: "an-who", text: (PEOPLE[a.by] ? PEOPLE[a.by].name : a.by)
          + (nudge ? " \ud83d\udc49 nudged " + toName : "") + " \u00b7 " + when }),
        el("span", { class: "an-t", text: a.text }),
        el("span", { class: "an-state", text: (a.status === "sent" ? "\u2713 " : "") + state }),
        a.status === "sent" ? el("button", { class: "an-x", type: "button", "aria-label": "Hide this", title: "Hide this",
          text: "\u00d7", onclick: () => { anHide(a.id); renderAnnounce(); } }) : null
      ]));
    });
  }
  const AN_KEEP = 60 * 60 * 1000;               // sent messages stay in the list for an hour
  function anHidden() {
    try { return JSON.parse(localStorage.getItem("cham-an-hidden") || "[]"); } catch (e) { return anHidden.mem || []; }
  }
  function anHide(id) {
    const ids = anHidden().concat(id).slice(-50);
    anHidden.mem = ids;
    try { localStorage.setItem("cham-an-hidden", JSON.stringify(ids)); } catch (e) { /* private mode: this visit only */ }
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
      /* Nudge: buzz the owner's phone about this job. Not on your own jobs,
         the group's, or finished ones; once per job every ten minutes. */
      if (t.status !== "done" && t.who && t.who !== "team" && t.who !== SESSION.personKey
          && PEOPLE[t.who] && window.ChamLive && window.ChamLive.nudge) {
        const recent = Date.now() - (NUDGED[t.id] || 0) < 10 * 60 * 1000;
        row.appendChild(el("button", {
          class: "act nudge" + (recent ? " sent" : ""), type: "button", disabled: recent,
          text: recent ? "Nudged \u2713" : "\ud83d\udc49 Nudge",
          title: "Buzz " + PEOPLE[t.who].name + "\u2019s phone about this job",
          onclick: async (e) => {
            const b = e.currentTarget;
            const name = PEOPLE[t.who].name;
            const late = t.due && t.due < TODAY;
            const text = t.title + (t.due ? (late ? " \u2014 past its date (" + relDay(t.due) + ")" : " \u2014 due " + relDay(t.due)) : "");
            b.disabled = true; b.textContent = "Nudging\u2026";
            try {
              const me = SESSION.personKey;
              await window.ChamLive.nudge(text, t.who, me, PEOPLE[me] ? PEOPLE[me].name : me, t.id);
              NUDGED[t.id] = Date.now();
              b.textContent = "Nudged \u2713"; b.classList.add("sent");
              toast("Nudge sent to " + name);
            } catch (err) {
              b.disabled = false; b.textContent = "\ud83d\udc49 Nudge";
              flash(row, "Couldn\u2019t nudge. " + (err.code || err.message));
            }
          }
        }));
      }
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
        onclick: async (e) => {
          if (!tapTwice(e.currentTarget, "Tap again to delete")) return;
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
          onclick: async (e) => {
            if (!tapTwice(e.currentTarget, "tap again to remove")) return;
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

  /* The clock: Ho Chi Minh City time, ticking every second, whatever
     time zone the phone happens to be in. Pauses while the tab is hidden. */
  (function mascotClock() {
    const t = $("mc-t"), sec = $("mc-s"), d = $("mc-d");
    if (!t) return;
    const TZ = "Asia/Ho_Chi_Minh";
    const hm = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, hour: "2-digit", minute: "2-digit", hour12: false });
    const ss = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, second: "2-digit" });
    const day = new Intl.DateTimeFormat("en-GB", { timeZone: TZ, weekday: "short", day: "numeric", month: "short" });
    let timer = null, lastHm = "", lastDay = "";
    function tick() {
      const now = new Date();
      const h = hm.format(now), dd = day.format(now).replace(",", "").replace("Sept", "Sep");
      if (h !== lastHm) { t.textContent = lastHm = h; }         // only touch what changed
      if (dd !== lastDay) { d.textContent = lastDay = dd; }
      sec.textContent = ":" + ss.format(now).padStart(2, "0");
      timer = setTimeout(tick, 1000 - (Date.now() % 1000) + 5);   // land on the second
    }
    document.addEventListener("visibilitychange", () => {
      clearTimeout(timer);
      if (!document.hidden) tick();
    });
    tick();
  })();

  /* ------------------------------------------------------------------ *
   * Pre-orders
   *
   * An admin sets up a sale (items and prices) and shares its order link.
   * Buyers order on order.html without an account. Here everyone sees how
   * many of each thing to make, who has paid and who has picked up, and
   * the takings go into the money log with one tap.
   * ------------------------------------------------------------------ */
  const orderLink = (id) => location.origin + location.pathname.replace(/[^/]*$/, "") + "order.html?sale=" + encodeURIComponent(id);
  const qtyOf = (n) => Math.max(0, Math.min(20, Math.floor(Number(n) || 0)));
  function orderTotal(o, sale) {
    return (sale.items || []).reduce((a, it) => a + qtyOf(o.items[it.id]) * (it.price || 0), 0);
  }

  /* ------------------------------------------------------------------ *
   * Impact, and the evidence behind it
   *
   * The roadmap's "what we should track across every phase": programs
   * completed, people reached (a count, never names), fundraisers run,
   * money raised and used - and for each activity, whether the evidence
   * a sponsor would ask for actually exists.
   * ------------------------------------------------------------------ */
  const EVIDENCE = [["plan", "Plan"], ["money", "Money records"], ["photos", "Photos / video"],
                    ["permission", "Permission"], ["feedback", "Feedback"], ["recap", "Recap / report"]];
  /* The after-event review: four questions, any member, filed on the card. */
  function reviewBlock(a) {
    const past = !a.date || a.date <= TODAY;
    if (!past) return null;
    const rv = a.review;
    const wrap = el("details", { class: "rv" + (rv ? " done" : " due") }, [
      el("summary", { text: rv ? "Review by " + (PEOPLE[rv.by] ? PEOPLE[rv.by].name : rv.by) + (rv.at ? " \u00b7 " + pretty(rv.at) : "")
                               : "\u270d Write the review (4 questions)" })
    ]);
    const Q = [["well", "What went well?"], ["bad", "What didn\u2019t?"], ["next", "What should we change next time?"],
               ["numbers", "Any numbers? (sold, reached, left over)"]];
    if (rv) {
      Q.forEach(([k, q]) => { if (rv[k]) wrap.appendChild(el("p", { class: "rv-a" }, [el("b", { text: q + " " }), document.createTextNode(rv[k])])); });
      return wrap;
    }
    const ins = Q.map(([k, q]) => [k, el("textarea", { class: "an-text rv-in", rows: "2", maxlength: "500", placeholder: q, "aria-label": q })]);
    const msg = el("span", { class: "ad-msg" });
    const save = el("button", { class: "au-go", type: "button", text: "Save review", onclick: async () => {
      const r = { by: SESSION.personKey, at: TODAY };
      ins.forEach(([k, t]) => { if (t.value.trim()) r[k] = t.value.trim().slice(0, 500); });
      if (!r.well && !r.bad && !r.next) { msg.textContent = "Answer at least one of the first three."; msg.classList.add("bad"); return; }
      save.disabled = true;
      try { await window.ChamLive.saveReview(a.id, r); toast("Review saved for " + a.name); }
      catch (err) { save.disabled = false; msg.textContent = "Didn\u2019t save. " + (err.code || err.message); msg.classList.add("bad"); }
    } });
    ins.forEach(([, t]) => wrap.appendChild(t));
    wrap.append(el("div", { class: "sf-row" }, [msg, save]));
    return wrap;
  }

  /* ------------------------------------------------------------------ *
   * Sponsors - the roadmap's Phase 4 list: who, who's chasing them,
   * where it's up to, and when to follow up.
   * ------------------------------------------------------------------ */
  const STAGES_SP = [["todo", "To contact"], ["contacted", "Contacted"], ["replied", "Replied"],
                     ["meeting", "Meeting"], ["agreed", "Agreed"], ["no", "Said no"]];
  function renderSponsors() {
    const box = $("sponsors");
    if (!box) return;
    if (!SESSION || !window.ChamLive || !SPONSORS) { box.replaceChildren(el("p", { class: "viz-none", text: "Sign in to see sponsors." })); return; }
    const admin = Boolean(SESSION.admin);

    if (!box.querySelector(".sp-add")) {
      box.replaceChildren(el("div", { class: "sp-stats", id: "sp-stats" }), spAddForm(), el("div", { id: "sp-list" }));
    }
    const live = SPONSORS.filter((x) => x.stage !== "no");
    const talking = SPONSORS.filter((x) => ["contacted", "replied", "meeting"].includes(x.stage)).length;
    const agreed = SPONSORS.filter((x) => x.stage === "agreed");
    const due = live.filter((x) => x.stage !== "agreed" && x.next && x.next <= TODAY).length;
    $("sp-stats").replaceChildren(...[
      [String(live.length), "on the list"], [String(talking), "in conversation"], [String(agreed.length), "agreed"],
      [fmtVnd(agreed.reduce((n, x) => n + (x.amount || 0), 0)), "pledged"], [String(due), "follow-ups due"]
    ].map(([n, k], i) => el("div", { class: "im-tile" + (i === 4 && due ? " warn" : "") }, [el("span", { class: "im-n", text: n }), el("span", { class: "im-k", text: k })])));

    const list = $("sp-list");
    list.replaceChildren();
    if (!SPONSORS.length) list.appendChild(el("p", { class: "viz-none", text: "Nobody on the list yet. Add the first possible sponsor above \u2014 a caf\u00e9, a brand, a parent\u2019s company." }));
    STAGES_SP.forEach(([st, label]) => {
      const rows = SPONSORS.filter((x) => x.stage === st).sort((a, b) => String(a.next || "9").localeCompare(String(b.next || "9")));
      if (!rows.length) return;
      list.appendChild(el("h3", { class: "sp-stage" }, [document.createTextNode(label + " "), el("span", { text: String(rows.length) })]));
      rows.forEach((x) => list.appendChild(spCard(x, admin)));
    });
  }

  function spAddForm() {
    const name = el("input", { class: "ad-in wide", type: "text", maxlength: "80", placeholder: "Who? e.g. Goofoo Gelato", "aria-label": "Sponsor name" });
    const contact = el("input", { class: "ad-in wide", type: "text", maxlength: "120", placeholder: "How to reach them (Zalo, email, IG, a parent\u2026)", "aria-label": "Contact" });
    const ask = el("input", { class: "ad-in wide", type: "text", maxlength: "160", placeholder: "What we\u2019d ask for, e.g. lend a freezer + 500k", "aria-label": "Ask" });
    const owner = peopleOptions(el("select", { class: "ad-in", "aria-label": "Who chases it" }));
    owner.value = SESSION.personKey;
    const next = el("input", { class: "ad-in", type: "date", "aria-label": "Follow up on", title: "Follow up on" });
    const msg = el("span", { class: "ad-msg" });
    const go = el("button", { class: "au-go", type: "button", text: "Add to the list", onclick: async () => {
      if (!name.value.trim()) { msg.textContent = "Who is it?"; msg.classList.add("bad"); name.focus(); return; }
      go.disabled = true;
      try {
        await window.ChamLive.addSponsor({ name: name.value.trim(), contact: contact.value.trim(), ask: ask.value.trim(),
          owner: owner.value, next: next.value || null, stage: "todo", amount: 0 });
        [name, contact, ask, next].forEach((i) => { i.value = ""; }); msg.textContent = "";
      } catch (err) { msg.textContent = "Didn\u2019t save. " + (err.code || err.message); msg.classList.add("bad"); }
      go.disabled = false;
    } });
    return el("details", { class: "sp-add" }, [el("summary", { text: "+ Add a possible sponsor" }),
      el("div", { class: "sale-form" }, [name, contact, ask, el("div", { class: "sf-row" }, [
        el("label", { class: "sp-lbl" }, [document.createTextNode("Chased by "), owner]),
        el("label", { class: "sp-lbl" }, [document.createTextNode("Follow up "), next]), go]), msg])]);
  }

  function spCard(x, admin) {
    const save = (patch, why) => window.ChamLive.updateSponsor(x.id, { name: x.name, stage: x.stage, ...patch })
      .catch((err) => toast("Didn\u2019t save" + (why ? " " + why : "") + ". " + (err.code || err.message)));
    const stage = el("select", { class: "ad-in sp-sel", "aria-label": "Stage" },
      STAGES_SP.map(([k, l]) => el("option", { value: k, text: l, selected: k === x.stage })));
    stage.addEventListener("change", () => {
      save({ stage: stage.value });
      if (stage.value === "agreed") logActivity({ who: SESSION.personKey, event: "sponsor", key: true, text: "\ud83e\udd1d **" + x.name + "** agreed to support Ch\u1ea1m" });
    });
    const next = el("input", { class: "ad-in", type: "date", value: x.next || "", "aria-label": "Follow up on" });
    next.addEventListener("change", () => save({ next: next.value || null }));
    const late = x.stage !== "agreed" && x.stage !== "no" && x.next && x.next < TODAY;
    const amount = el("input", { class: "ad-in sp-amt", type: "text", inputmode: "numeric", placeholder: "Pledged, e.g. 2tr", value: x.amount ? fmtVnd(x.amount) : "", "aria-label": "Pledged amount" });
    amount.addEventListener("change", () => save({ amount: parseVnd(amount.value) || 0 }));
    const note = el("input", { class: "ad-in wide", type: "text", maxlength: "200", placeholder: "What happened? e.g. Messaged on Zalo, waiting", "aria-label": "Log a contact" });
    const logIt = el("button", { class: "act", type: "button", text: "Log it", onclick: () => {
      const t = note.value.trim(); if (!t) { note.focus(); return; }
      const entry = { date: TODAY, by: SESSION.personKey, text: t.slice(0, 200) };
      const patch = { log: x.log.concat(entry).slice(-30) };
      if (x.stage === "todo") patch.stage = "contacted";
      if (!x.next || x.next <= TODAY) patch.next = isoDay(new Date(Date.now() + 7 * 864e5));   // chase again in a week
      save(patch); note.value = "";
    } });
    note.addEventListener("keydown", (e) => { if (e.key === "Enter") logIt.click(); });
    return el("article", { class: "sp-card" + (late ? " late" : "") + (x.stage === "agreed" ? " agreed" : "") }, [
      el("div", { class: "sp-top" }, [
        el("div", { class: "sp-who" }, [el("b", { text: x.name }),
          el("span", { text: [x.contact, x.ask ? "Ask: " + x.ask : ""].filter(Boolean).join(" \u00b7 ") })]),
        x.owner && PEOPLE[x.owner] ? el("span", { class: "sp-owner" }, [avatar(x.owner), el("span", { text: PEOPLE[x.owner].name })]) : null
      ]),
      el("div", { class: "sf-row sp-row" }, [stage,
        el("label", { class: "sp-lbl" + (late ? " late" : "") }, [document.createTextNode(late ? "Overdue \u2014 follow up " : "Follow up "), next]),
        x.stage === "agreed" || x.amount ? amount : null,
        admin ? el("button", { class: "act ghost danger", type: "button", text: "Delete",
          onclick: (e) => { if (!tapTwice(e.currentTarget, "Tap again to delete")) return; window.ChamLive.deleteSponsor(x.id).catch((err) => toast("Didn\u2019t delete. " + (err.code || err.message))); } }) : null]),
      el("div", { class: "sf-row sp-row" }, [note, logIt]),
      x.log.length ? el("details", { class: "sp-log" }, [el("summary", { text: x.log.length + " contact" + (x.log.length === 1 ? "" : "s") + " logged" }),
        el("ul", {}, x.log.slice().reverse().map((l) => el("li", {}, [el("b", { text: pretty(l.date) + " \u00b7 " + (PEOPLE[l.by] ? PEOPLE[l.by].name : l.by) + ": " }), document.createTextNode(l.text)])))]) : null
    ]);
  }

  /* ------------------------------------------------------------------ *
   * Meetings - notes, who came, and decisions that become jobs.
   * ------------------------------------------------------------------ */
  function renderMeetings() {
    const box = $("meetings");
    if (!box) return;
    const on = Boolean(SESSION && window.ChamLive && MEETINGS);
    box.hidden = !on;
    if (!on) { box.replaceChildren(); return; }
    if (!box.querySelector("#mt-list")) {
      box.replaceChildren(
        el("div", { class: "sl-headrow" }, [
          el("div", {}, [el("h3", { class: "an-h", text: "Meetings" }),
            el("p", { class: "an-sub", text: "Who came, what was said, and what was decided. A decision with a name on it becomes a job in one tap." })]),
          el("button", { class: "act", type: "button", text: "+ New meeting", onclick: () => openMeeting(null) })
        ]),
        el("div", { id: "mt-form" }),
        el("div", { id: "mt-list" }));
    }
    const list = $("mt-list");
    list.replaceChildren();
    const ms = MEETINGS.slice().sort((a, b) => b.date.localeCompare(a.date));
    const upcoming = ms.filter((m) => m.date >= TODAY).reverse();
    const past = ms.filter((m) => m.date < TODAY);
    if (!ms.length) list.appendChild(el("p", { class: "viz-none", text: "No meetings yet. Tap + New meeting to plan the next one or write up the last." }));
    upcoming.concat(past.slice(0, 6)).forEach((m) => list.appendChild(meetingCard(m, m.date >= TODAY)));
  }

  function meetingCard(m, soon) {
    const admin = Boolean(SESSION.admin);
    const decisions = m.decisions.map((d, i) => el("li", { class: "mt-dec" }, [
      el("span", { class: "mt-dtext", text: d.text }),
      d.who && PEOPLE[d.who] ? el("span", { class: "sp-owner" }, [avatar(d.who), el("span", { text: PEOPLE[d.who].name + (d.due ? " \u00b7 " + relDay(d.due) : "") })]) : null,
      d.taskId ? el("span", { class: "mt-job", text: "\u2713 On the jobs list" })
        : (admin && d.who ? el("button", { class: "act", type: "button", text: "Make it a job", onclick: async (e) => {
            const b = e.currentTarget; b.disabled = true;
            try {
              const id = await window.ChamLive.addTask({ who: d.who, title: d.text, due: d.due || null, note: "From the " + pretty(m.date) + " meeting" });
              const ds = m.decisions.map((x, j) => j === i ? { ...x, taskId: id } : x);
              await window.ChamLive.saveMeeting(m.id, { date: m.date, decisions: ds });
              logActivity({ who: d.who, ref: id, event: "assign", text: "Given a job at the meeting: **" + d.text + "**" });
              toast("Added to " + PEOPLE[d.who].name + "\u2019s jobs");
            } catch (err) { b.disabled = false; toast("Didn\u2019t add. " + (err.code || err.message)); }
          } }) : null)
    ]));
    return el("article", { class: "mt-card" + (soon ? " soon" : "") }, [
      el("div", { class: "sp-top" }, [
        el("div", { class: "sp-who" }, [el("b", { text: m.title }),
          el("span", { text: pretty(m.date) + (soon ? " \u00b7 " + relDay(m.date) : "") + (m.people.length ? " \u00b7 " + m.people.map((k) => PEOPLE[k] ? PEOPLE[k].name : k).join(", ") : "") })]),
        el("div", { class: "sf-row" }, [
          el("button", { class: "act ghost", type: "button", text: m.notes || m.decisions.length ? "Edit" : "Add notes", onclick: () => openMeeting(m) }),
          admin ? el("button", { class: "act ghost danger", type: "button", text: "Delete",
            onclick: (e) => { if (!tapTwice(e.currentTarget, "Tap again")) return; window.ChamLive.deleteMeeting(m.id).catch((err) => toast("Didn\u2019t delete. " + (err.code || err.message))); } }) : null])
      ]),
      m.notes ? el("p", { class: "mt-notes", text: m.notes }) : null,
      decisions.length ? el("div", {}, [el("span", { class: "sf-k", text: "Decided" }), el("ul", { class: "mt-decs" }, decisions)]) : null
    ]);
  }

  function openMeeting(m) {
    const host = $("mt-form");
    const date = el("input", { class: "ad-in", type: "date", value: m ? m.date : TODAY, "aria-label": "Date" });
    const title = el("input", { class: "ad-in wide", type: "text", maxlength: "80", value: m ? m.title : "Team meeting", "aria-label": "Title" });
    const chosen = new Set(m ? m.people : []);
    const who = el("div", { class: "filters mt-people" }, Object.keys(PEOPLE).filter((k) => k !== "team" && !/^Left /.test(PEOPLE[k].role || "")).map((k) => {
      const b = el("button", { class: "chipbtn plain", type: "button", "aria-pressed": String(chosen.has(k)), text: PEOPLE[k].name });
      b.addEventListener("click", () => { chosen.has(k) ? chosen.delete(k) : chosen.add(k); b.setAttribute("aria-pressed", String(chosen.has(k))); });
      return b;
    }));
    const notes = el("textarea", { class: "an-text", rows: "4", maxlength: "4000", placeholder: "Notes: what was discussed", "aria-label": "Notes" });
    notes.value = m ? m.notes : "";
    const decs = el("div", { class: "sf-items" });
    const addDec = (d) => {
      const t = el("input", { class: "ad-in wide mt-t", type: "text", maxlength: "160", placeholder: "Decision or action", "aria-label": "Decision", value: d ? d.text : "" });
      const w = peopleOptions(el("select", { class: "ad-in mt-w", "aria-label": "Who" }, [el("option", { value: "", text: "Nobody" })]));
      w.value = d && d.who ? d.who : "";
      const due = el("input", { class: "ad-in mt-d", type: "date", "aria-label": "By when", value: d && d.due ? d.due : "" });
      const row = el("div", { class: "sf-item mt-row" }, [t, w, due]);
      row._taskId = d ? d.taskId || null : null;
      decs.appendChild(row);
    };
    (m ? m.decisions : []).forEach(addDec);
    if (!m || !m.decisions.length) addDec(null);
    const msg = el("span", { class: "ad-msg" });
    const save = el("button", { class: "au-go", type: "button", text: "Save meeting", onclick: async () => {
      if (!date.value) { msg.textContent = "Pick a date."; msg.classList.add("bad"); return; }
      const ds = [...decs.querySelectorAll(".mt-row")].map((r) => ({ text: r.querySelector(".mt-t").value.trim(),
        who: r.querySelector(".mt-w").value || null, due: r.querySelector(".mt-d").value || null, taskId: r._taskId || null }))
        .filter((d) => d.text).map((d) => { Object.keys(d).forEach((k) => { if (d[k] === null) delete d[k]; }); return d; });
      save.disabled = true;
      try {
        await window.ChamLive.saveMeeting(m ? m.id : null, { date: date.value, title: title.value.trim() || "Meeting",
          people: [...chosen], notes: notes.value.trim(), decisions: ds, by: SESSION.personKey });
        host.replaceChildren(); toast("Meeting saved");
      } catch (err) { save.disabled = false; msg.textContent = "Didn\u2019t save. " + (err.code || err.message); msg.classList.add("bad"); }
    } });
    host.replaceChildren(el("div", { class: "sale-form mt-form" }, [
      el("div", { class: "sf-row" }, [title, date]),
      el("span", { class: "sf-k", text: "Who came" }), who, notes,
      el("span", { class: "sf-k", text: "Decisions \u2014 give one a name and it can become a job" }), decs,
      el("div", { class: "sf-row" }, [
        el("button", { class: "act ghost", type: "button", text: "+ Another decision", onclick: () => addDec(null) }),
        el("div", { class: "sf-row" }, [el("button", { class: "act ghost", type: "button", text: "Cancel", onclick: () => host.replaceChildren() }), save])]),
      msg]));
    title.focus();
  }

  function renderImpact() {
    const box = $("impact");
    if (!box) return;
    const on = Boolean(SESSION && window.ChamLive && ACTS);
    box.hidden = !on;
    if (!on) { box.replaceChildren(); return; }
    const admin = Boolean(SESSION.admin);
    const acts = ACTS.slice().sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")));
    const programs = acts.filter((a) => a.type === "program");
    const sum = (k) => programs.reduce((n, a) => n + (a[k] || 0), 0);
    const sm = LEDGER && LEDGER.length ? moneySummary(LEDGER) : null;

    const tiles = el("div", { class: "im-tiles" }, [
      ["Programs run", String(programs.length)],
      ["Kids reached", String(sum("reach"))],
      ["Teaching sessions", String(sum("sessions"))],
      ["Fundraisers done", String(acts.filter((a) => a.type === "fundraiser").length)],
      ["Raised after costs", sm ? shortVnd(sm.raised) : "\u2014"],
      ["Used for programs", sm ? shortVnd(sm.programs) : "\u2014"]
    ].map(([k, v]) => el("div", { class: "im-tile" }, [el("span", { class: "im-n", text: v }), el("span", { class: "im-k", text: k })])));

    acts.forEach((a) => { if (a.review) a.checks = { ...a.checks, feedback: true }; });
    const done = acts.reduce((n, a) => n + EVIDENCE.filter(([k]) => a.checks[k]).length, 0);
    const total = acts.length * EVIDENCE.length;
    const list = el("div", { class: "im-list" });
    acts.forEach((a) => {
      const got = EVIDENCE.filter(([k]) => a.checks[k]).length;
      list.appendChild(el("div", { class: "im-row" }, [
        el("div", { class: "im-name" }, [
          el("b", { text: a.name }),
          el("span", { text: [a.date ? pretty(a.date) : "", a.type === "program" ? "Program" : "Fundraiser",
            a.reach ? a.reach + " kids" : ""].filter(Boolean).join(" \u00b7 ") })
        ]),
        el("div", { class: "im-checks" }, EVIDENCE.map(([k, label]) => el("button", {
          class: "im-chk" + (a.checks[k] ? " on" : ""), type: "button", disabled: !admin, "aria-pressed": String(Boolean(a.checks[k])),
          title: admin ? "Tap to mark " + (a.checks[k] ? "missing" : "done") : (a.checks[k] ? "In the evidence folder" : "Missing"),
          text: (a.checks[k] ? "\u2713 " : "") + label,
          onclick: (e) => { e.currentTarget.disabled = true; window.ChamLive.setCheck(a.id, k, !a.checks[k]).catch((err) => toast("Didn\u2019t save. " + (err.code || err.message))); }
        }))),
        el("span", { class: "im-score" + (got === EVIDENCE.length ? " full" : ""), text: got + "/" + EVIDENCE.length }),
        reviewBlock(a)
      ]));
    });

    const add = admin ? (() => {
      const nm = el("input", { class: "ad-in wide", type: "text", maxlength: "60", placeholder: "Activity, e.g. Halloween sale", "aria-label": "Activity" });
      const dt = el("input", { class: "ad-in", type: "date", "aria-label": "Date" });
      const ty = el("select", { class: "ad-in", "aria-label": "Type" }, [el("option", { value: "fundraiser", text: "Fundraiser" }), el("option", { value: "program", text: "Program" })]);
      const kids = el("input", { class: "ad-in", type: "number", min: "0", placeholder: "Kids (programs)", "aria-label": "Kids reached" });
      const go = el("button", { class: "act", type: "button", text: "Add",
        onclick: async () => {
          if (!nm.value.trim()) { nm.focus(); return; }
          go.disabled = true;
          try {
            await window.ChamLive.addActivity({ name: nm.value.trim(), date: dt.value || null, type: ty.value,
              reach: ty.value === "program" && kids.value ? Number(kids.value) : null, sessions: null });
            nm.value = ""; dt.value = ""; kids.value = "";
          } catch (err) { toast("Didn\u2019t save. " + (err.code || err.message)); }
          go.disabled = false;
        } });
      return el("details", { class: "im-add" }, [el("summary", { text: "+ Add an activity" }), el("div", { class: "sf-row" }, [nm, dt, ty, kids, go])]);
    })() : null;

    box.replaceChildren(
      el("div", { class: "sl-headrow" }, [el("div", {}, [
        el("h3", { class: "an-h", text: "Impact" }),
        el("p", { class: "an-sub", text: "What Ch\u1ea1m has actually done, and whether the proof a sponsor would ask for exists. Counts only \u2014 no names." })
      ])]),
      tiles,
      el("div", { class: "im-evhead" }, [
        el("span", { class: "sf-k", text: "Evidence" }),
        el("span", { class: "im-total", text: done + " of " + total + " pieces in place" + (admin ? " \u00b7 tap one to tick it" : "") })
      ]),
      list, add);
  }

  function renderSales() {
    const box = $("sales");
    if (!box) return;
    const admin = Boolean(SESSION && SESSION.admin);
    const on = Boolean(SESSION && window.ChamLive && window.ChamLive.createSale && SALES);
    box.hidden = !on || (!admin && !SALES.length);
    if (box.hidden) { if (!on) box.replaceChildren(); return; }

    if (!box.childElementCount) {
      const toggle = admin ? el("button", { class: "act", type: "button", text: "+ New sale",
        onclick: () => { const f = $("sale-form"); f.hidden = !f.hidden; if (!f.hidden) f.querySelector("input").focus(); } }) : null;
      box.append(
        el("div", { class: "sl-headrow" }, [
          el("div", {}, [el("h3", { class: "an-h", text: "\ud83e\uddfe Pre-orders" }),
            el("p", { class: "an-sub", text: "Share a sale\u2019s order link; orders land here live. Tick them paid and picked up at the stall." })]),
          toggle
        ]),
        admin ? saleForm() : null,
        el("div", { id: "sale-list" }));
    }

    const list = $("sale-list");
    list.replaceChildren();
    const sales = SALES.slice().sort((a, b) => (b.open - a.open) || String(b.date || "").localeCompare(String(a.date || "")));
    if (!sales.length) list.appendChild(el("p", { class: "viz-none", text: "No sales yet. Tap + New sale once the details are set." }));
    sales.forEach((s) => list.appendChild(saleCard(s)));
  }

  function saleForm() {
    const name = el("input", { class: "ad-in wide", type: "text", maxlength: "60", placeholder: "Sale name, e.g. Ice cream sale", "aria-label": "Sale name" });
    const date = el("input", { class: "ad-in", type: "date", "aria-label": "Sale day" });
    const pickup = el("input", { class: "ad-in wide", type: "text", maxlength: "80", placeholder: "Pickup, e.g. Break time, outside the canteen", "aria-label": "Pickup" });
    const note = el("input", { class: "ad-in wide", type: "text", maxlength: "200", placeholder: "Note for buyers (optional), e.g. transfer to \u2026", "aria-label": "Note for buyers" });
    const allergens = el("input", { class: "ad-in wide", type: "text", maxlength: "120", placeholder: "Allergens, e.g. wheat, dairy, egg (food sales)", "aria-label": "Allergens" });
    const rows = el("div", { class: "sf-items" });
    const addRow = () => rows.appendChild(el("div", { class: "sf-item" }, [
      el("input", { class: "ad-in wide sf-n", type: "text", maxlength: "40", placeholder: "Item, e.g. Vanilla", "aria-label": "Item" }),
      el("input", { class: "ad-in sf-p", type: "text", inputmode: "numeric", placeholder: "Price, e.g. 30k", "aria-label": "Price" })
    ]));
    addRow(); addRow();
    const msg = el("span", { class: "ad-msg" });
    const make = el("button", { class: "au-go", type: "button", text: "Create sale & get link" });
    make.addEventListener("click", async () => {
      msg.classList.remove("bad");
      const items = [...rows.querySelectorAll(".sf-item")].map((r, i) => ({
        id: "i" + (i + 1), name: r.querySelector(".sf-n").value.trim(), price: parseVnd(r.querySelector(".sf-p").value) || 0
      })).filter((it) => it.name);
      const bad = (t) => { msg.textContent = t; msg.classList.add("bad"); };
      if (!name.value.trim()) return bad("Give the sale a name.");
      if (!items.length) return bad("Add at least one item.");
      if (items.some((it) => !it.price)) return bad("Every item needs a price.");
      make.disabled = true; make.textContent = "Creating\u2026";
      try {
        await window.ChamLive.createSale({ name: name.value.trim(), date: date.value || null, pickup: pickup.value.trim(),
          note: note.value.trim(), allergens: allergens.value.trim(), items, by: SESSION.personKey });
        [name, date, pickup, note, allergens].forEach((i) => { i.value = ""; });
        rows.replaceChildren(); addRow(); addRow();
        form.hidden = true; msg.textContent = "";
        toast("Sale created \u2014 copy its link below");
      } catch (e) { bad("Couldn\u2019t create it. " + (e.code || e.message)); }
      finally { make.disabled = false; make.textContent = "Create sale & get link"; }
    });
    const form = el("div", { class: "sale-form", id: "sale-form", hidden: true }, [
      el("div", { class: "sf-row" }, [name, date]), pickup, note, allergens,
      el("span", { class: "sf-k", text: "Items and prices" }), rows,
      el("div", { class: "sf-row" }, [
        el("div", { class: "sf-row" }, [
          el("button", { class: "act ghost", type: "button", text: "+ Another item", onclick: () => { if (rows.childElementCount < 12) addRow(); } }),
          /* merch: turn the first item into one row per size, same price */
          el("button", { class: "act ghost", type: "button", text: "Split into sizes S\u2013XL", title: "For shirts: fill in the first item, then tap this",
            onclick: () => {
              const first = rows.querySelector(".sf-item");
              const n = first.querySelector(".sf-n").value.trim(), pr = first.querySelector(".sf-p").value.trim();
              if (!n) { msg.textContent = "Type the first item (e.g. Chạm tee) and its price first."; msg.classList.add("bad"); return; }
              rows.replaceChildren();
              ["S", "M", "L", "XL"].forEach((sz) => { addRow(); const r = rows.lastChild; r.querySelector(".sf-n").value = n + " (" + sz + ")"; r.querySelector(".sf-p").value = pr; });
              msg.textContent = ""; msg.classList.remove("bad");
            } })]),
        make]),
      msg
    ]);
    return form;
  }

  function saleCard(s) {
    const admin = Boolean(SESSION && SESSION.admin);
    const os = (ORDERS || []).filter((o) => o.sale === s.id).sort((a, b) => (a.pickedUp - b.pickedUp) || (a.at - b.at));
    const make = {};
    let expected = 0, paid = 0, picked = 0;
    os.forEach((o) => {
      (s.items || []).forEach((it) => { make[it.id] = (make[it.id] || 0) + qtyOf(o.items[it.id]); });
      const t = orderTotal(o, s);
      expected += t; if (o.paid) paid += t; if (o.pickedUp) picked++;
    });
    const link = orderLink(s.id);
    const copy = el("button", { class: "act", type: "button", text: "Copy link",
      onclick: async (e) => {
        const b = e.currentTarget;
        try { await navigator.clipboard.writeText(link); b.textContent = "Copied \u2713"; }
        catch (err) { linkIn.select(); b.textContent = "Press Ctrl+C"; }
        setTimeout(() => { b.textContent = "Copy link"; }, 2500);
      } });
    const linkIn = el("input", { class: "ad-in wide sl-link", type: "text", readonly: true, value: link, "aria-label": "Order link",
      onclick: (e) => e.currentTarget.select() });

    const head = el("div", { class: "sl-head" }, [
      el("div", {}, [
        el("b", { class: "sl-name", text: s.name }),
        el("span", { class: "sl-meta", text: [s.date ? pretty(s.date) : "", s.pickup].filter(Boolean).join(" \u00b7 ") }),
        s.allergens ? el("span", { class: "sl-meta", text: "Allergens: " + s.allergens }) : null
      ]),
      el("span", { class: "sl-badge" + (s.open ? " open" : ""), text: s.open ? "Taking orders" : "Closed" })
    ]);

    const tools = el("div", { class: "sl-tools" }, [linkIn, copy,
      admin ? el("button", { class: "act ghost", type: "button", text: s.open ? "Close orders" : "Reopen orders",
        onclick: (e) => { e.currentTarget.disabled = true; window.ChamLive.setSaleOpen(s.id, !s.open).catch((err) => toast("Didn\u2019t save. " + (err.code || err.message))); } }) : null]);

    const makeLine = el("div", { class: "sl-make" }, [el("span", { class: "sl-k", text: "Make" })].concat(
      (s.items || []).map((it) => el("span", { class: "sl-chip" }, [el("b", { text: String(make[it.id] || 0) }), document.createTextNode(" \u00d7 " + it.name)]))));

    const nums = el("div", { class: "sl-nums" }, [
      el("span", { text: os.length + " order" + (os.length === 1 ? "" : "s") }),
      el("span", { text: "Expected " + fmtVnd(expected) }),
      el("span", { class: "ok", text: "Paid " + fmtVnd(paid) }),
      el("span", { text: "Picked up " + picked + "/" + os.length })
    ]);

    const toLog = paid - (s.logged || 0);
    const logBtn = canManageMoney() && toLog > 0 ? el("button", { class: "au-go sl-log", type: "button",
      text: "Log " + fmtVnd(toLog) + " as money in",
      onclick: async (e) => {
        const b = e.currentTarget;
        if (!tapTwice(b, "Tap again to log " + fmtVnd(toLog))) return;
        b.disabled = true;
        try {
          await window.ChamLive.addMoney({ kind: "in", date: TODAY, amount: toLog,
            description: s.name + " pre-orders (" + os.filter((o) => o.paid).length + " paid)",
            category: "Sales", budgetLine: s.name, paidBy: SESSION.personKey, method: "cash",
            notes: "From the pre-order list, cash and transfers together" });
          await window.ChamLive.setSaleLogged(s.id, paid);
          toast("Logged " + fmtVnd(toLog) + " for " + s.name);
        } catch (err) { b.disabled = false; toast("Didn\u2019t log. " + (err.code || err.message)); }
      } }) : null;

    const rows = el("div", { class: "sl-orders" });
    os.forEach((o) => {
      const what = (s.items || []).filter((it) => qtyOf(o.items[it.id])).map((it) => qtyOf(o.items[it.id]) + "\u00d7 " + it.name).join(", ");
      const flip = (k, label) => el("button", { class: "act sl-flip" + (o[k] ? " on" : ""), type: "button", "aria-pressed": String(o[k]),
        text: (o[k] ? "\u2713 " : "") + label,
        onclick: (e) => {
          e.currentTarget.disabled = true;
          window.ChamLive.setOrder(o.id, { [k]: !o[k] }, SESSION.personKey).catch((err) => toast("Didn\u2019t save. " + (err.code || err.message)));
        } });
      rows.appendChild(el("div", { class: "sl-order" + (o.pickedUp ? " done" : "") }, [
        el("span", { class: "sl-code", text: o.code }),
        el("div", { class: "sl-who" }, [
          el("b", { text: o.name + (o.cls ? " \u00b7 " + o.cls : "") }),
          el("span", { text: what + (o.note ? " \u2014 \u201c" + o.note + "\u201d" : "") + (o.contact ? " \u00b7 " + o.contact : "") })
        ]),
        el("span", { class: "sl-amt" }, [el("b", { text: fmtVnd(orderTotal(o, s)) }), el("span", { text: o.pay === "transfer" ? "transfer" : "cash" })]),
        el("div", { class: "sl-flips" }, [flip("paid", "Paid"), flip("pickedUp", "Picked up")])
      ]));
    });

    return el("section", { class: "sale-card" + (s.open ? " open" : "") }, [
      head, tools, os.length ? makeLine : null, os.length ? nums : el("p", { class: "sl-empty", text: s.open ? "No orders yet \u2014 share the link." : "No orders." }),
      logBtn,
      os.length ? el("details", { class: "sl-det", open: os.length <= 40 }, [el("summary", { text: "All " + os.length + " orders" }), rows]) : null
    ]);
  }

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
          onclick: async (e) => {
            if (!tapTwice(e.currentTarget, "Tap again")) return;
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

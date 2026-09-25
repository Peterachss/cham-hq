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
    month: (() => { const d = fromIso(TODAY); return new Date(d.getFullYear(), d.getMonth(), 1); })(),
    selected: TODAY
  };

  const VIEWS = ["updates","calendar","tasks"];
  document.querySelectorAll(".tab").forEach((btn) => {
    btn.addEventListener("click", () => setView(btn.dataset.view));
    btn.addEventListener("keydown", (e) => {
      const i = VIEWS.indexOf(btn.dataset.view);
      if (e.key === "ArrowRight") { e.preventDefault(); setView(VIEWS[(i+1)%3]); $("tab-"+VIEWS[(i+1)%3]).focus(); }
      if (e.key === "ArrowLeft")  { e.preventDefault(); setView(VIEWS[(i+2)%3]); $("tab-"+VIEWS[(i+2)%3]).focus(); }
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
    if (S.view === "updates") renderFeed();
    if (S.view === "calendar") renderCalendar();
    if (S.view === "tasks") renderTasks();
  }

  function liveTasks() { return TASKS.filter((t) => t.status !== "done"); }

  function renderGlance() {
    const live = liveTasks();
    const late = TASKS.filter((t) => t.status === "late" || (t.due && t.status !== "done" && t.due < TODAY));
    $("g-open").textContent = "";
    $("g-open").appendChild(el("b", { text: String(live.length) }));
    $("g-open").appendChild(document.createTextNode(" across " + new Set(live.map((t) => t.who)).size + " people"));

    const gl = $("g-late");
    gl.className = "v" + (late.length ? " warn" : "");
    gl.textContent = late.length ? late.length + (late.length === 1 ? " job past its date" : " jobs past their date") : "Nothing overdue";

    const next = EVENTS.filter((e) => e.date >= TODAY && e.state !== "past").sort((a,b) => a.date < b.date ? -1 : 1)[0];
    $("g-next").textContent = next ? pretty(next.date) + " · " + next.title : "Nothing dated";

    $("g-block").textContent = "School approval for the sale";

    $("n-updates").textContent = DAYS.length;
    $("n-calendar").textContent = EVENTS.filter((e) => e.date >= TODAY && e.state !== "past").length + UNDATED.length;
    $("n-tasks").textContent = liveTasks().length;

    $("stamp").textContent = "Chat read to Fri 25 Sep 2026";
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
        bullets.appendChild(el("div", { class: "bullet" + (i.key ? " key" : "") }, [
          avatar(i.who), richText(i.text)
        ]));
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
  function renderCalendar() {
    const y = S.month.getFullYear(), m = S.month.getMonth();
    $("cal-month").textContent = MONTH_FULL[m] + " " + y;

    const grid = $("cal-grid");
    grid.innerHTML = "";
    DOW.forEach((d) => grid.appendChild(el("div", { class: "dow", text: d })));

    const lead = (new Date(y, m, 1).getDay() + 6) % 7;
    const start = new Date(y, m, 1 - lead);
    const byDay = {};
    EVENTS.forEach((e) => { (byDay[e.date] = byDay[e.date] || []).push(e); });

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
    const onDay = EVENTS.filter((e) => e.date === S.selected);
    const list = onDay.length ? onDay : EVENTS.filter((e) => e.date >= TODAY).sort((a,b) => a.date < b.date ? -1 : 1);
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
            el("span", { class: "pill " + (e.state === "target" ? "doing" : e.state === "past" ? "" : "done"),
                         text: e.state === "target" ? "not locked" : e.state === "past" ? "happened" : "confirmed" }),
            el("span", { class: "pill due", text: relDay(e.date) })
          ])
        ])
      ]));
    });

    const un = $("undated");
    if (!un.childElementCount) {
      UNDATED.forEach((u) => un.appendChild(el("div", { class: "card evrow" }, [
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
        list.appendChild(el("article", { class: "card task s-" + (late ? "late" : t.status) }, [
          el("div", { class: "body" }, [
            el("div", { class: "tt", text: t.title }),
            t.note ? el("div", { class: "note", text: t.note }) : null,
            meta
          ])
        ]));
      });
      board.appendChild(list);
    });

    if (!any) board.appendChild(el("div", { class: "empty-state", text: "Nothing here with that filter." }));
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

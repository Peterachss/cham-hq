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
  let SESSION = null;

  window.ChamHQ = {
    setTasks(rows) {
      TASKS = Array.isArray(rows) ? rows : BASE_TASKS;
      $("task-filters").replaceChildren();
      $("status-filters").replaceChildren();
      render();
    },
    setSession(s) {
      SESSION = s;
      $("task-filters").replaceChildren();
      $("status-filters").replaceChildren();
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
    month: (() => { const d = fromIso(TODAY); return new Date(d.getFullYear(), d.getMonth(), 1); })(),
    selected: TODAY
  };

  const VIEWS = ["updates","calendar","tasks","tracker"];
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
    if (S.view === "updates") renderFeed();
    if (S.view === "calendar") renderCalendar();
    if (S.view === "tasks") renderTasks();
    if (S.view === "tracker") renderTracker();
    renderAdmin();
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
    $("n-tracker").textContent = TASKS.filter((t) => t.status === "done").length;

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
        const body = el("div", { class: "body" }, [
          el("div", { class: "tt", text: t.title }),
          t.note ? el("div", { class: "note", text: t.note }) : null,
          meta
        ]);
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

    return {
      key, total: mine.length,
      done: done.length, doing: doing.length, rest: rest.length,
      open: open.length, overdue: overdue.length,
      daysLate, worst,
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
      [["behind","Furthest behind"],["done","Most finished"],["load","Biggest workload"],["name","By name"]].forEach(([k, label]) => {
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
        tip(seg, [PEOPLE[r.key].name, n + " " + st.label.toLowerCase() + " of " + r.total]);
        track.appendChild(seg);
      });

      plot1.appendChild(el("div", { class: "hrow" }, [
        el("span", { class: "hname" }, [avatar(r.key), el("span", { text: PEOPLE[r.key].name })]),
        el("div", { class: "htrack" }, [track]),
        el("span", { class: "hval", text: r.done + "/" + r.total })
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
    tbl.appendChild(el("thead", {}, [el("tr", {}, ["Person","Jobs","Finished","In progress","Not started","Overdue","Days late"]
      .map((h) => el("th", { text: h, scope: "col" })))]));
    const tb = el("tbody");
    rows.forEach((r) => {
      tb.appendChild(el("tr", {}, [
        el("th", { scope: "row", text: PEOPLE[r.key].name })
      ].concat([r.total, r.done, r.doing, r.rest, r.overdue, r.daysLate].map((v) => el("td", { text: String(v) })))));
    });
    tbl.appendChild(tb);
    box.appendChild(el("details", { class: "viz-details" }, [
      el("summary", { text: "See it as a table" }), tbl
    ]));

    if (!rows.length) box.replaceChildren(el("div", { class: "empty-state", text: "No jobs to count yet." }));
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

/* ------------------------------------------------------------------ *
 * Chạm HQ — sign-in and live tasks.
 *
 * This file is optional. If firebase-config.js has not been filled in,
 * it does nothing at all and the page stays exactly as it was: tasks
 * read from data.json, no sign-in, no editing.
 *
 * When it IS configured:
 *   - members sign in with email and password
 *   - tasks come from Firestore live, updating on every device at once
 *   - a member can tick off their own jobs
 *   - admins (Peter, Bach) can add, edit and delete anybody's
 * ------------------------------------------------------------------ */
const CFG = window.CHAM_FIREBASE || {};
const CONFIGURED = Boolean(CFG.apiKey && CFG.projectId);

const bar = document.getElementById("authbar");

if (!CONFIGURED) {
  // Nothing set up yet. Leave the page as a read-only static site.
  if (bar) bar.hidden = true;
} else {
  const V = "10.12.2";
  const [{ initializeApp }, auth_, store_] = await Promise.all([
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-auth.js`),
    import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`)
  ]);

  const {
    getAuth, onAuthStateChanged, signInWithEmailAndPassword, signOut,
    sendPasswordResetEmail, updatePassword, EmailAuthProvider, reauthenticateWithCredential
  } = auth_;
  const {
    getFirestore, collection, doc, getDoc, onSnapshot,
    addDoc, updateDoc, deleteDoc, setDoc, serverTimestamp, query, where, orderBy, limit
  } = store_;

  /* a subscription's document id is a hash of its endpoint, so the same
     phone subscribing twice overwrites itself rather than doubling up */
  async function subId(endpoint) {
    const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(endpoint));
    return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("").slice(0, 40);
  }

  /* app.js builds the page only once it has the data, which this file
     fetches after sign-in - so wait for its bridge at that point. */
  async function pageReady() {
    for (let i = 0; i < 400 && !window.ChamHQ; i++) await new Promise((r) => setTimeout(r, 25));
    return Boolean(window.ChamHQ);
  }
  let wasIn = false;

  const app  = initializeApp(CFG);
  const auth = getAuth(app);
  const db   = getFirestore(app);

  const el = (tag, props, kids) => {
    const n = document.createElement(tag);
    if (props) for (const k in props) {
      const v = props[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") n.className = v;
      else if (k === "text") n.textContent = v;
      else if (k.slice(0, 2) === "on") n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? "" : v);
    }
    (kids || []).forEach((c) => { if (c) n.appendChild(c); });
    return n;
  };

  let unsubTasks = null, unsubUpdates = null, unsubPhotos = null, unsubMoney = null, unsubDrafts = null;
  let unsubAnn = null, unsubSales = null, unsubOrders = null, unsubActs = null, unsubSponsors = null, unsubMeetings = null;
  let unsubPushStatus = null, unsubSys = null, unsubOnboard = null;

  /* ----- the sign-in bar ------------------------------------------ */
  function showSignedOut(msg) {
    bar.hidden = false;
    bar.replaceChildren();

    const email = el("input", { type: "email", id: "au-email", placeholder: "you@example.com",
                                autocomplete: "username", "aria-label": "Email" });
    const pass  = el("input", { type: "password", id: "au-pass", placeholder: "Password",
                                autocomplete: "current-password", "aria-label": "Password" });
    const note  = el("span", { class: "au-note", text: msg || "" });
    const go    = el("button", { class: "au-go", text: "Sign in" });

    async function submit() {
      note.textContent = "";
      note.classList.remove("bad");
      if (!email.value || !pass.value) { fail("Enter your email and password."); return; }
      go.disabled = true; go.textContent = "Signing in…";
      try {
        await signInWithEmailAndPassword(auth, email.value.trim(), pass.value);
      } catch (err) {
        go.disabled = false; go.textContent = "Sign in";
        fail(friendly(err));
      }
    }
    function fail(t) { note.textContent = t; note.classList.add("bad"); }

    go.addEventListener("click", submit);
    [email, pass].forEach((i) => i.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); }));

    const forgot = el("button", { class: "au-link", text: "Forgot password",
      onclick: async () => {
        if (!email.value) { fail("Type your email first, then tap this."); return; }
        try {
          await sendPasswordResetEmail(auth, email.value.trim());
          note.classList.remove("bad");
          note.textContent = "Reset link sent. Check your email.";
        } catch (err) { fail(friendly(err)); }
      }
    });

    bar.append(el("span", { class: "au-lead", text: "Members:" }), email, pass, go, forgot, note);
  }

  function showSignedIn(session) {
    bar.hidden = false;
    bar.replaceChildren(
      el("span", { class: "au-who" }, [
        el("b", { text: session.name }),
        el("span", { class: "au-sub", text: session.admin ? "admin" : (session.role || "member") })
      ]),
      el("button", { class: "au-link", text: "Change password", onclick: togglePasswordForm }),
      el("button", { class: "au-link", text: "Sign out", onclick: () => signOut(auth) })
    );
  }

  /* Change your own password while signed in. Firebase wants proof it is
     really you (your current password) before it will change it. */
  function togglePasswordForm() {
    const open = bar.querySelector(".au-pw");
    if (open) { open.remove(); return; }
    const user = auth.currentUser;
    if (!user) return;
    const cur  = el("input", { type: "password", placeholder: "Current password", autocomplete: "current-password", "aria-label": "Current password" });
    const nw   = el("input", { type: "password", placeholder: "New password (8+ characters)", autocomplete: "new-password", "aria-label": "New password" });
    const nw2  = el("input", { type: "password", placeholder: "New password again", autocomplete: "new-password", "aria-label": "New password again" });
    const note = el("span", { class: "au-note" });
    const save = el("button", { class: "au-go", text: "Save new password" });
    const cancel = el("button", { class: "au-link", text: "Cancel", onclick: () => form.remove() });
    const bad = (t) => { note.textContent = t; note.classList.add("bad"); };
    async function submit() {
      note.textContent = ""; note.classList.remove("bad");
      if (!cur.value || !nw.value) { bad("Fill in your current and new password."); return; }
      if (nw.value.length < 8) { bad("The new password needs at least 8 characters."); return; }
      if (nw.value !== nw2.value) { bad("The two new passwords don't match."); return; }
      if (nw.value === cur.value) { bad("That's the same as your current password."); return; }
      save.disabled = true; save.textContent = "Saving\u2026";
      try {
        await reauthenticateWithCredential(user, EmailAuthProvider.credential(user.email, cur.value));
        await updatePassword(user, nw.value);
        form.replaceChildren(el("span", { class: "au-note ok", text: "Password changed. Use the new one next time you sign in." }));
        window.ChamLive.saveOnboarding({ password: true }).catch(() => {});
        setTimeout(() => form.remove(), 4000);
      } catch (err) {
        save.disabled = false; save.textContent = "Save new password";
        const c = String(err && err.code || "");
        if (c.includes("invalid-credential") || c.includes("wrong-password")) bad("Your current password isn't right.");
        else if (c.includes("weak-password")) bad("Pick a stronger password.");
        else if (c.includes("too-many-requests")) bad("Too many tries. Wait a minute and go again.");
        else if (c.includes("network")) bad("No connection.");
        else bad("Couldn't change it. " + c);
      }
    }
    save.addEventListener("click", submit);
    [cur, nw, nw2].forEach((i) => i.addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); }));
    const form = el("div", { class: "au-pw" }, [cur, nw, nw2, save, cancel, note]);
    bar.appendChild(form);
    cur.focus();
  }

  function friendly(err) {
    const c = String(err && err.code || "");
    if (c.includes("invalid-credential") || c.includes("wrong-password") || c.includes("user-not-found"))
      return "That email and password do not match.";
    if (c.includes("invalid-email"))    return "That does not look like an email address.";
    if (c.includes("too-many-requests")) return "Too many tries. Wait a minute and go again.";
    if (c.includes("network"))           return "No connection.";
    return "Could not sign in. " + c;
  }

  /* ----- auth state ------------------------------------------------ */
  onAuthStateChanged(auth, async (user) => {
    if (unsubTasks) { unsubTasks(); unsubTasks = null; }
    if (unsubUpdates) { unsubUpdates(); unsubUpdates = null; }
    if (unsubPhotos) { unsubPhotos(); unsubPhotos = null; }
    if (unsubMoney) { unsubMoney(); unsubMoney = null; }
    if (unsubDrafts) { unsubDrafts(); unsubDrafts = null; }
    if (unsubAnn) { unsubAnn(); unsubAnn = null; }
    if (unsubSales) { unsubSales(); unsubSales = null; }
    if (unsubOrders) { unsubOrders(); unsubOrders = null; }
    if (unsubActs) { unsubActs(); unsubActs = null; }
    if (unsubSponsors) { unsubSponsors(); unsubSponsors = null; }
    if (unsubMeetings) { unsubMeetings(); unsubMeetings = null; }
    if (unsubPushStatus) { unsubPushStatus(); unsubPushStatus = null; }
    if (unsubSys) { unsubSys(); unsubSys = null; }
    if (unsubOnboard) { unsubOnboard(); unsubOnboard = null; }

    if (!user) {
      // Signing out wipes the page: reload, so nothing a member saw stays in memory.
      if (wasIn) { location.reload(); return; }
      document.body.classList.add("locked");
      showSignedOut();
      return;
    }

    // Who is this, in Chạm terms?
    let member = null, lookupFailed = null;
    try {
      const snap = await getDoc(doc(db, "members", user.email.toLowerCase()));
      if (snap.exists()) member = snap.data();
    } catch (err) {
      lookupFailed = err;
      console.error("Chạm HQ: could not read your member record", err);
    }

    if (!member) {
      await signOut(auth);
      const looked = user.email.toLowerCase();
      showSignedOut(lookupFailed
        ? "Signed in as " + looked + ", but could not read members/" + looked
          + " (" + (lookupFailed.code || "error") + "). The document ID must be exactly that."
        : "That account is not on the Chạm list yet. Ask Peter or Bach to add it.");
      return;
    }

    // The base data: members only, so it can only be read now.
    if (!window.__chamData) {
      try {
        const s = await getDoc(doc(db, "site", "data"));
        if (!s.exists()) throw new Error("site/data is missing");
        window.__chamData = s.data();
        window.dispatchEvent(new CustomEvent("cham-data", { detail: window.__chamData }));
      } catch (err) {
        console.error("Chạm HQ: could not load the site data", err);
        showSignedOut("Signed in, but the Chạm data would not load (" + (err.code || err.message) + "). Reload to try again.");
        return;
      }
    }
    if (!(await pageReady())) { showSignedOut("The page did not finish loading. Reload to try again."); return; }
    wasIn = true;
    document.body.classList.remove("locked");

    const session = {
      email: user.email.toLowerCase(),
      personKey: member.personKey || null,
      admin: member.admin === true,
      finance: member.finance === true,
      name: member.name || (window.ChamHQ.personName(member.personKey) || user.email),
      role: window.ChamHQ.personRole(member.personKey),
      nudged: member.notifyNudge || null          // an admin asked this person to turn notifications on
    };
    window.ChamHQ.setSession(session);
    showSignedIn(session);

    // Live tasks
    unsubTasks = onSnapshot(collection(db, "tasks"),
      (qs) => {
        const rows = [];
        qs.forEach((d) => {
          const t = d.data();
          rows.push({
            id: d.id,
            who: t.who,
            title: t.title,
            note: t.note || "",
            status: t.status || "open",
            due: t.due || null,
            since: t.since || null,
            progress: typeof t.progress === "number" ? t.progress : (t.status === "done" ? 100 : 0),
            // when it was ticked off, as YYYY-MM-DD, so the tracker can tell
            // whether it landed before or after its due date
            doneOn: t.doneAt && t.doneAt.toDate
              ? t.doneAt.toDate().toLocaleDateString("en-CA")   // YYYY-MM-DD, local day
              : null
          });
        });
        window.ChamHQ.setTasks(rows);
      },
      (err) => {
        console.error("Chạm HQ: lost the task feed", err);
        window.ChamHQ.setTasks(null);
      });

    // Live entries in the day-by-day feed. These sit on top of whatever is
    // already in data.json rather than replacing it, so the chat history
    // written before any of this existed stays put.
    unsubUpdates = onSnapshot(collection(db, "updates"),
      (qs) => {
        const rows = [];
        qs.forEach((d) => {
          const u = d.data();
          rows.push({
            id: d.id,
            date: u.date || null,
            who: u.who || "team",
            text: u.text || "",
            key: u.key === true,
            tag: u.tag || null,
            auto: u.auto === true,
            event: u.event || null,
            ref: u.ref || null,
            amount: typeof u.amount === "number" ? u.amount : null,
            kind: u.kind || null
          });
        });
        window.ChamHQ.setUpdates(rows);
      },
      (err) => {
        console.error("Chạm HQ: lost the updates feed", err);
        window.ChamHQ.setUpdates(null);
      });

    // Photos, stored small and inline in Firestore rather than in Storage,
    // which this project would need a paid plan to switch on.
    unsubPhotos = onSnapshot(collection(db, "photos"),
      (qs) => {
        const rows = [];
        qs.forEach((d) => {
          const v = d.data();
          rows.push({
            id: d.id, date: v.date || null, who: v.who || "team",
            caption: v.caption || "", data: v.data || "", w: v.w || 0, h: v.h || 0
          });
        });
        window.ChamHQ.setPhotos(rows);
      },
      (err) => {
        console.error("Chạm HQ: lost the photos", err);
        window.ChamHQ.setPhotos(null);
      });

    // Money in and out. Everyone can log; Thuan and the admins keep it tidy.
    unsubMoney = onSnapshot(collection(db, "expenses"),
      (qs) => {
        const rows = [];
        qs.forEach((d) => {
          const v = d.data();
          rows.push({
            id: d.id,
            kind: v.kind === "in" ? "in" : "out",
            date: v.date || null,
            amount: typeof v.amount === "number" ? v.amount : 0,
            description: v.description || "",
            category: v.category || "Other",
            budgetLine: v.budgetLine || "",
            paidBy: v.paidBy || "cham",
            method: v.method || "cash",
            notes: v.notes || "",
            owed: v.owed === true,
            repaid: v.repaid === true,
            receipt: v.receipt || "",
            status: v.status || "new",
            createdBy: v.createdBy || null,
            sheetSyncedAt: v.sheetSyncedAt ? true : false
          });
        });
        window.ChamHQ.setMoney(rows);
      },
      (err) => {
        console.error("Chạm HQ: lost the money log", err);
        window.ChamHQ.setMoney(null);
      });

    // pre-order sales and the orders people have placed
    unsubSales = onSnapshot(collection(db, "sales"),
      (qs) => {
        const rows = [];
        qs.forEach((d) => {
          const v = d.data();
          rows.push({ id: d.id, name: v.name || "Sale", date: v.date || null, pickup: v.pickup || "", note: v.note || "", allergens: v.allergens || "",
            items: Array.isArray(v.items) ? v.items : [], open: v.open === true,
            logged: typeof v.logged === "number" ? v.logged : 0 });
        });
        window.ChamHQ.setSales(rows);
      },
      (err) => { console.error("Chạm HQ: lost the sales", err); window.ChamHQ.setSales(null); });
    unsubOrders = onSnapshot(collection(db, "orders"),
      (qs) => {
        const rows = [];
        qs.forEach((d) => {
          const v = d.data();
          rows.push({ id: d.id, sale: v.sale || "", name: v.name || "", cls: v.cls || "", contact: v.contact || "",
            note: v.note || "", items: v.items && typeof v.items === "object" ? v.items : {}, pay: v.pay || "cash",
            code: v.code || "", paid: v.paid === true, pickedUp: v.pickedUp === true,
            at: v.createdAt && v.createdAt.toDate ? v.createdAt.toDate() : new Date() });
        });
        window.ChamHQ.setOrders(rows);
      },
      (err) => { console.error("Chạm HQ: lost the orders", err); window.ChamHQ.setOrders(null); });

    // what Chạm has done, and the evidence for it
    unsubActs = onSnapshot(collection(db, "activities"),
      (qs) => {
        const rows = [];
        qs.forEach((d) => {
          const v = d.data();
          rows.push({ id: d.id, name: v.name || "Activity", date: v.date || null, type: v.type === "program" ? "program" : "fundraiser",
            reach: typeof v.reach === "number" ? v.reach : null, sessions: typeof v.sessions === "number" ? v.sessions : null,
            checks: v.checks && typeof v.checks === "object" ? v.checks : {}, note: v.note || "",
            review: v.review && typeof v.review === "object" ? v.review : null });
        });
        window.ChamHQ.setActivities(rows);
      },
      (err) => { console.error("Chạm HQ: lost the activities", err); window.ChamHQ.setActivities(null); });

    unsubSponsors = onSnapshot(collection(db, "sponsors"),
      (qs) => {
        const rows = [];
        qs.forEach((d) => {
          const v = d.data();
          rows.push({ id: d.id, name: v.name || "", contact: v.contact || "", owner: v.owner || "", stage: v.stage || "todo",
            ask: v.ask || "", amount: typeof v.amount === "number" ? v.amount : 0, next: v.next || null,
            log: Array.isArray(v.log) ? v.log : [] });
        });
        window.ChamHQ.setSponsors(rows);
      },
      (err) => { console.error("Chạm HQ: lost the sponsors", err); window.ChamHQ.setSponsors(null); });
    // your own getting-started checklist
    unsubOnboard = onSnapshot(doc(db, "onboarding", session.email),
      (s) => window.ChamHQ.setOnboarding(s.exists() ? s.data() : {}),
      () => window.ChamHQ.setOnboarding({}));

    // admins: every background job's last check-in
    if (session.admin) {
      unsubSys = onSnapshot(doc(db, "meta", "status"),
        (s) => window.ChamHQ.setSysStatus(s.exists() ? s.data() : { jobs: {} }),
        () => window.ChamHQ.setSysStatus(null));
    }

    // admins: who has notifications on (worked out by the sender)
    if (session.admin) {
      unsubPushStatus = onSnapshot(doc(db, "meta", "pushStatus"),
        (s) => window.ChamHQ.setPushStatus(s.exists() ? s.data() : null),
        (err) => { console.error("Chạm HQ: lost the notification list", err); window.ChamHQ.setPushStatus(null); });
    }
    unsubMeetings = onSnapshot(collection(db, "meetings"),
      (qs) => {
        const rows = [];
        qs.forEach((d) => {
          const v = d.data();
          rows.push({ id: d.id, date: v.date || "", title: v.title || "Meeting", people: Array.isArray(v.people) ? v.people : [],
            notes: v.notes || "", decisions: Array.isArray(v.decisions) ? v.decisions : [] });
        });
        window.ChamHQ.setMeetings(rows);
      },
      (err) => { console.error("Chạm HQ: lost the meetings", err); window.ChamHQ.setMeetings(null); });

    // tonight's chat wrap, for the two people who approve it
    if (session.admin) {
      unsubDrafts = onSnapshot(query(collection(db, "chatDrafts"), where("status", "==", "pending")),
        (qs) => {
          const rows = [];
          qs.forEach((d) => { const v = d.data(); rows.push({ id: d.id, date: v.date || d.id, method: v.method || "", lines: v.lines || [] }); });
          window.ChamHQ.setDrafts(rows);
        },
        (err) => { console.error("Chạm HQ: lost the chat drafts", err); window.ChamHQ.setDrafts(null); });

      // the last few announcements, so the sender sees "Sent to 4 people"
      unsubAnn = onSnapshot(query(collection(db, "announcements"), orderBy("createdAt", "desc"), limit(4)),
        (qs) => {
          const rows = [];
          qs.forEach((d) => {
            const v = d.data();
            rows.push({ id: d.id, text: v.text || "", by: v.by || "", status: v.status || "pending",
              kind: v.kind || "announce", to: v.to || null,
              sentTo: typeof v.sentTo === "number" ? v.sentTo : null,
              at: v.createdAt && v.createdAt.toDate ? v.createdAt.toDate() : new Date() });
          });
          window.ChamHQ.setAnnouncements(rows);
        },
        (err) => { console.error("Chạm HQ: lost the announcements", err); window.ChamHQ.setAnnouncements(null); });
    }
  });

  /* ----- what app.js is allowed to call ---------------------------- */
  window.ChamLive = {
    configured: true,
    async setStatus(id, status) {
      const patch = { status, updatedAt: serverTimestamp() };
      if (status === "done") { patch.doneAt = serverTimestamp(); patch.progress = 100; }
      await updateDoc(doc(db, "tasks", id), patch);
    },
    async setProgress(id, progress) {
      await updateDoc(doc(db, "tasks", id), {
        progress: Math.max(0, Math.min(100, Math.round(progress))),
        updatedAt: serverTimestamp()
      });
    },
    /** admins only - the rules stop anyone else changing these */
    async editTask(id, patch) {
      const out = { updatedAt: serverTimestamp() };
      if (patch.title !== undefined) out.title = patch.title;
      if (patch.due !== undefined) out.due = patch.due || null;
      await updateDoc(doc(db, "tasks", id), out);
    },
    async setNote(id, note) {
      await updateDoc(doc(db, "tasks", id), { note, updatedAt: serverTimestamp() });
    },
    async addTask(t) {
      const ref = await addDoc(collection(db, "tasks"), {
        who: t.who, title: t.title, note: t.note || "",
        status: "open", due: t.due || null, since: null,
        createdBy: auth.currentUser ? auth.currentUser.email.toLowerCase() : null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
      return ref.id;
    },
    async deleteTask(id) { await deleteDoc(doc(db, "tasks", id)); },

    async addUpdates(list) {
      const who = auth.currentUser ? auth.currentUser.email.toLowerCase() : null;
      for (const u of list) {
        await addDoc(collection(db, "updates"), {
          date: u.date, who: u.who, text: u.text,
          key: u.key === true, tag: u.tag || null,
          auto: u.auto === true, event: u.event || null, ref: u.ref || null,
          amount: typeof u.amount === "number" ? u.amount : null,
          kind: u.kind || null,
          createdBy: who, createdAt: serverTimestamp()
        });
      }
    },
    async deleteUpdate(id) { await deleteDoc(doc(db, "updates", id)); },

    async addPhoto(ph) {
      await addDoc(collection(db, "photos"), {
        date: ph.date, who: ph.who, caption: ph.caption || "",
        data: ph.data, w: ph.w, h: ph.h,
        createdBy: auth.currentUser ? auth.currentUser.email.toLowerCase() : null,
        createdAt: serverTimestamp()
      });
    },
    async deletePhoto(id) { await deleteDoc(doc(db, "photos", id)); },

    async addMoney(e) {
      await addDoc(collection(db, "expenses"), {
        kind: e.kind, date: e.date, amount: e.amount,
        description: e.description, category: e.category,
        budgetLine: e.budgetLine || "", paidBy: e.paidBy, method: e.method,
        notes: e.notes || "", owed: e.owed === true,
        receipt: e.receipt || "", status: "new",
        createdBy: auth.currentUser ? auth.currentUser.email.toLowerCase() : null,
        createdAt: serverTimestamp()
      });
    },
    /* Two separate facts: whether a line is in the sheet yet, and whether
       whoever paid it has been paid back. Paying someone back must never
       make an entry look like it reached the sheet when it has not. */
    async setMoneyStatus(ids, status) {
      for (const id of ids) {
        const patch = { updatedAt: serverTimestamp() };
        if (status === "logged") { patch.status = "logged"; patch.loggedAt = serverTimestamp(); }
        if (status === "repaid") { patch.repaid = true; patch.repaidAt = serverTimestamp(); }
        await updateDoc(doc(db, "expenses", id), patch);
      }
    },
    async deleteMoney(id) { await deleteDoc(doc(db, "expenses", id)); },

    async savePushSub(sub, device) {
      const me = auth.currentUser;
      if (!me) throw new Error("not signed in");
      await setDoc(doc(db, "pushSubs", await subId(sub.endpoint)), {
        email: me.email.toLowerCase(),
        endpoint: sub.endpoint,
        keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth },
        device: device || "",
        createdAt: serverTimestamp()
      });
    },
    async announce(text, by, byName) {
      await addDoc(collection(db, "announcements"), {
        text, by, byName: byName || "", status: "pending",
        createdBy: auth.currentUser.email.toLowerCase(), createdAt: serverTimestamp()
      });
    },
    async createSale(s) {
      const ref = await addDoc(collection(db, "sales"), {
        name: s.name, date: s.date || null, pickup: s.pickup || "", note: s.note || "", allergens: s.allergens || "",
        items: s.items, open: true, logged: 0, createdByKey: s.by || "", createdAt: serverTimestamp()
      });
      return ref.id;
    },
    async saveReview(id, review) { await updateDoc(doc(db, "activities", id), { review, reviewedAt: serverTimestamp() }); },
    async addSponsor(s) { await addDoc(collection(db, "sponsors"), { ...s, log: [], createdAt: serverTimestamp() }); },
    async updateSponsor(id, s) { await setDoc(doc(db, "sponsors", id), { ...s, updatedAt: serverTimestamp() }, { merge: true }); },
    async deleteSponsor(id) { await deleteDoc(doc(db, "sponsors", id)); },
    async saveMeeting(id, m) {
      if (id) { await setDoc(doc(db, "meetings", id), { ...m, updatedAt: serverTimestamp() }, { merge: true }); return id; }
      const ref = await addDoc(collection(db, "meetings"), { ...m, createdAt: serverTimestamp() });
      return ref.id;
    },
    async saveOnboarding(patch) {
      await setDoc(doc(db, "onboarding", auth.currentUser.email.toLowerCase()), patch, { merge: true });
    },
    openPasswordForm() { if (!bar.querySelector(".au-pw")) togglePasswordForm(); window.scrollTo({ top: 0, behavior: "smooth" }); },
    async nudgeNotify(email, by) {
      await updateDoc(doc(db, "members", email), { notifyNudge: { by, at: new Date().toISOString().slice(0, 10) } });
    },
    async deleteMeeting(id) { await deleteDoc(doc(db, "meetings", id)); },
    async setCheck(id, key, on) { await updateDoc(doc(db, "activities", id), { ["checks." + key]: on, updatedAt: serverTimestamp() }); },
    async addActivity(a) {
      await addDoc(collection(db, "activities"), { name: a.name, date: a.date || null, type: a.type, reach: a.reach, sessions: a.sessions,
        checks: {}, createdAt: serverTimestamp() });
    },
    async setSaleOpen(id, open) { await updateDoc(doc(db, "sales", id), { open, updatedAt: serverTimestamp() }); },
    async setSaleLogged(id, logged) { await updateDoc(doc(db, "sales", id), { logged, updatedAt: serverTimestamp() }); },
    async setOrder(id, patch, by) {
      await updateDoc(doc(db, "orders", id), { ...patch, updatedAt: serverTimestamp(), updatedBy: by || "" });
    },
    /* "Send me a test": files a test for your own devices, then calls back
       when the sender has dealt with it (or never, if nothing is running). */
    async testPush(me, name, onDone) {
      const ref = await addDoc(collection(db, "announcements"), {
        kind: "test", to: me, by: me, byName: name || "", text: "test", status: "pending",
        createdBy: auth.currentUser.email.toLowerCase(), createdAt: serverTimestamp()
      });
      const stop = onSnapshot(ref, (s) => {
        const v = s.data();
        if (v && v.status === "sent") { stop(); onDone(v.sentTo || 0); }
      }, () => {});
      return stop;
    },
    async nudge(text, to, by, byName, taskId) {
      await addDoc(collection(db, "announcements"), {
        kind: "nudge", to, text, by, byName: byName || "", task: taskId || null, status: "pending",
        createdBy: auth.currentUser.email.toLowerCase(), createdAt: serverTimestamp()
      });
    },
    async setDraftStatus(id, status) {
      await updateDoc(doc(db, "chatDrafts", id), { status, reviewedAt: serverTimestamp(),
        reviewedBy: auth.currentUser ? auth.currentUser.email.toLowerCase() : null });
    },
    async deletePushSub(endpoint) {
      await deleteDoc(doc(db, "pushSubs", await subId(endpoint)));
    }
  };

  showSignedOut();
}

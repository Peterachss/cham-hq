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
    sendPasswordResetEmail, updatePassword
  } = auth_;
  const {
    getFirestore, collection, doc, getDoc, onSnapshot,
    addDoc, updateDoc, deleteDoc, serverTimestamp
  } = store_;

  // app.js loads data.json before it publishes the bridge, so wait for it.
  await (async function whenReady() {
    for (let i = 0; i < 200 && !window.ChamHQ; i++) await new Promise((r) => setTimeout(r, 25));
  })();
  if (!window.ChamHQ) { console.error("Chạm HQ: page never finished loading, sign-in disabled"); }

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

  let unsubTasks = null;

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
      el("button", { class: "au-link", text: "Sign out", onclick: () => signOut(auth) })
    );
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

    if (!user) {
      window.ChamHQ.setSession(null);
      window.ChamHQ.setTasks(null);       // fall back to data.json
      showSignedOut();
      return;
    }

    // Who is this, in Chạm terms?
    let member = null;
    try {
      const snap = await getDoc(doc(db, "members", user.email.toLowerCase()));
      if (snap.exists()) member = snap.data();
    } catch (err) {
      console.error("Chạm HQ: could not read your member record", err);
    }

    if (!member) {
      await signOut(auth);
      showSignedOut("That account is not on the Chạm list yet. Ask Peter or Bach to add it.");
      return;
    }

    const session = {
      email: user.email.toLowerCase(),
      personKey: member.personKey || null,
      admin: member.admin === true,
      name: member.name || (window.ChamHQ.personName(member.personKey) || user.email),
      role: window.ChamHQ.personRole(member.personKey)
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
            since: t.since || null
          });
        });
        window.ChamHQ.setTasks(rows);
      },
      (err) => {
        console.error("Chạm HQ: lost the task feed", err);
        window.ChamHQ.setTasks(null);
      });
  });

  /* ----- what app.js is allowed to call ---------------------------- */
  window.ChamLive = {
    configured: true,
    async setStatus(id, status) {
      const patch = { status, updatedAt: serverTimestamp() };
      if (status === "done") patch.doneAt = serverTimestamp();
      await updateDoc(doc(db, "tasks", id), patch);
    },
    async setNote(id, note) {
      await updateDoc(doc(db, "tasks", id), { note, updatedAt: serverTimestamp() });
    },
    async addTask(t) {
      await addDoc(collection(db, "tasks"), {
        who: t.who, title: t.title, note: t.note || "",
        status: "open", due: t.due || null, since: null,
        createdBy: auth.currentUser ? auth.currentUser.email.toLowerCase() : null,
        createdAt: serverTimestamp(), updatedAt: serverTimestamp()
      });
    },
    async deleteTask(id) { await deleteDoc(doc(db, "tasks", id)); }
  };

  showSignedOut();
}

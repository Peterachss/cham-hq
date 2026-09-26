/* ------------------------------------------------------------------ *
 * Chạm - the public pre-order page.  order.html?sale=<id>
 *
 * For buyers, who have no account. They can read the sale (name, items,
 * prices, pickup) and place an order while it is open - and nothing else:
 * they cannot see anybody's orders, and cannot mark their own as paid.
 * firestore.rules enforces all of that; this page just asks nicely.
 * ------------------------------------------------------------------ */
const CFG = window.CHAM_FIREBASE || {};
const V = "10.12.2";
const [{ initializeApp }, fs] = await Promise.all([
  import(`https://www.gstatic.com/firebasejs/${V}/firebase-app.js`),
  import(`https://www.gstatic.com/firebasejs/${V}/firebase-firestore.js`)
]);
const { getFirestore, doc, getDoc, collection, addDoc, serverTimestamp } = fs;
const db = getFirestore(initializeApp(CFG));

const box = document.getElementById("op");
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
const vnd = (n) => (Math.round(n) || 0).toLocaleString("en-US") + " ₫";
const pretty = (iso) => {
  if (!iso) return "";
  const d = new Date(iso + "T00:00:00");
  return isNaN(d) ? iso : d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long" });
};
function message(title, text) {
  box.replaceChildren(el("section", { class: "op-card op-msg" }, [el("h2", { text: title }), el("p", { text: text })]));
}

const saleId = new URLSearchParams(location.search).get("sale") || "";
let sale = null;
try {
  if (saleId) {
    const snap = await getDoc(doc(db, "sales", saleId));
    if (snap.exists()) sale = snap.data();
  }
} catch (e) { /* shown below */ }

if (!sale) {
  message("This order link doesn’t work", "Ask whoever sent it to you for the right link.");
} else if (!sale.open) {
  document.title = sale.name + " · Chạm";
  message("Orders for " + sale.name + " are closed", "Thanks for checking! Follow Chạm for the next one.");
} else {
  document.title = "Pre-order: " + sale.name + " · Chạm";
  drawForm();
}

function drawForm() {
  const items = (sale.items || []).filter((i) => i && i.id && i.name);
  const qty = {};
  const total = el("span", { class: "op-total-n", text: vnd(0) });
  const note = el("p", { class: "op-note" });

  const rows = items.map((it) => {
    qty[it.id] = 0;
    const n = el("span", { class: "op-q", text: "0", "aria-live": "polite" });
    const set = (v) => {
      qty[it.id] = Math.max(0, Math.min(20, v));
      n.textContent = String(qty[it.id]);
      row.classList.toggle("on", qty[it.id] > 0);
      recount();
    };
    const row = el("div", { class: "op-item" }, [
      el("div", { class: "op-item-t" }, [el("b", { text: it.name }), el("span", { text: vnd(it.price) })]),
      el("div", { class: "op-step" }, [
        el("button", { type: "button", class: "op-btn", "aria-label": "One less " + it.name, text: "−", onclick: () => set(qty[it.id] - 1) }),
        n,
        el("button", { type: "button", class: "op-btn", "aria-label": "One more " + it.name, text: "+", onclick: () => set(qty[it.id] + 1) })
      ])
    ]);
    return row;
  });
  function recount() {
    total.textContent = vnd(items.reduce((a, it) => a + (qty[it.id] || 0) * (it.price || 0), 0));
  }

  const name = el("input", { class: "op-in", type: "text", maxlength: "60", autocomplete: "name", placeholder: "Your name", "aria-label": "Your name" });
  const cls = el("input", { class: "op-in", type: "text", maxlength: "20", placeholder: "Class (e.g. 10A)", "aria-label": "Class" });
  const contact = el("input", { class: "op-in", type: "text", maxlength: "60", placeholder: "Instagram or phone (optional)", "aria-label": "Instagram or phone, optional" });
  const extra = el("input", { class: "op-in", type: "text", maxlength: "200", placeholder: "Anything else? (optional)", "aria-label": "Anything else, optional" });
  let pay = "cash";
  const payBtns = [["cash", "Cash at pickup"], ["transfer", "Bank transfer"]].map(([k, label]) =>
    el("button", { type: "button", class: "op-pay" + (k === pay ? " on" : ""), "aria-pressed": String(k === pay), text: label,
      onclick: (e) => {
        pay = k;
        payBtns.forEach((b) => { const on = b === e.currentTarget; b.classList.toggle("on", on); b.setAttribute("aria-pressed", String(on)); });
      } }));
  const go = el("button", { type: "button", class: "op-go", text: "Place order" });

  go.addEventListener("click", async () => {
    note.textContent = ""; note.classList.remove("bad");
    const picked = {};
    items.forEach((it) => { if (qty[it.id] > 0) picked[it.id] = qty[it.id]; });
    const bad = (t) => { note.textContent = t; note.classList.add("bad"); };
    if (!Object.keys(picked).length) return bad("Pick at least one thing.");
    if (!name.value.trim()) { name.focus(); return bad("Add your name so we know it’s yours."); }
    if (!cls.value.trim()) { cls.focus(); return bad("Add your class so we can find you."); }
    const code = Array.from(crypto.getRandomValues(new Uint8Array(4)), (b) => "ABCDEFGHJKMNPQRSTUVWXYZ23456789"[b % 31]).join("");
    const sum = items.reduce((a, it) => a + (picked[it.id] || 0) * (it.price || 0), 0);
    go.disabled = true; go.textContent = "Placing…";
    try {
      await addDoc(collection(db, "orders"), {
        sale: saleId, name: name.value.trim().slice(0, 60), cls: cls.value.trim().slice(0, 20),
        contact: contact.value.trim().slice(0, 60), note: extra.value.trim().slice(0, 200),
        items: picked, pay, code, paid: false, pickedUp: false, pushed: false, createdAt: serverTimestamp()
      });
      done(code, picked, sum);
    } catch (e) {
      go.disabled = false; go.textContent = "Place order";
      bad(String(e.code || "").includes("permission") ? "Orders just closed — sorry!" : "Couldn’t place it. Check your connection and try again.");
    }
  });

  box.replaceChildren(
    el("section", { class: "op-card" }, [
      el("h2", { class: "op-title", text: sale.name }),
      el("p", { class: "op-when" }, [
        sale.date ? el("span", { text: pretty(sale.date) }) : null,
        sale.pickup ? el("span", { text: "Pickup: " + sale.pickup }) : null
      ]),
      sale.note ? el("p", { class: "op-info", text: sale.note }) : null,
      sale.allergens ? el("p", { class: "op-allergens", text: "\u26a0 Contains: " + sale.allergens + ". Ask us if you\u2019re not sure." }) : null
    ]),
    el("section", { class: "op-card" }, [el("h3", { class: "op-h", text: "What would you like?" })].concat(rows)),
    el("section", { class: "op-card" }, [
      el("h3", { class: "op-h", text: "Your details" }),
      name, cls, contact,
      el("h3", { class: "op-h", text: "How will you pay?" }),
      el("div", { class: "op-pays" }, payBtns),
      extra
    ]),
    el("div", { class: "op-bar" }, [
      el("div", { class: "op-total" }, [el("span", { class: "op-total-k", text: "Total" }), total]),
      go
    ]),
    note
  );
}

function done(code, picked, sum) {
  const items = sale.items || [];
  const lines = items.filter((it) => picked[it.id]).map((it) => picked[it.id] + " × " + it.name);
  box.replaceChildren(el("section", { class: "op-card op-done" }, [
    el("div", { class: "op-tick", "aria-hidden": "true", text: "✓" }),
    el("h2", { text: "Order placed!" }),
    el("p", { text: "Show this code when you pick it up:" }),
    el("div", { class: "op-code", text: code }),
    el("p", { class: "op-sum", text: lines.join(" · ") + " — " + vnd(sum) }),
    sale.pickup ? el("p", { class: "op-when", text: "Pickup: " + sale.pickup + (sale.date ? " · " + pretty(sale.date) : "") }) : null,
    el("p", { class: "op-small", text: "Screenshot this page so you don’t lose the code." }),
    el("button", { type: "button", class: "op-again", text: "Place another order", onclick: drawForm })
  ]));
  window.scrollTo({ top: 0, behavior: "smooth" });
}

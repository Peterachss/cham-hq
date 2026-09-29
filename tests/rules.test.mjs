// Chạm HQ - Firestore rules, tested in the local emulator before they are
// ever published. Run:  npx firebase emulators:exec --only firestore "node rules.test.mjs"
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment, assertSucceeds, assertFails
} from "@firebase/rules-unit-testing";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp, query, where, Timestamp
} from "firebase/firestore";

const RULES = readFileSync(process.env.RULES || "C:/Users/peter/cham-hq/firestore.rules", "utf8");

const env = await initializeTestEnvironment({
  projectId: "cham-hq-test",
  firestore: { rules: RULES, host: "127.0.0.1", port: 8080 }
});

const PETER = "peter@test.cham", THUAN = "thuan@test.cham", EMILY = "emily@test.cham",
      BACH = "bach@test.cham", STRANGER = "nobody@test.cham";

async function seed() {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    await setDoc(doc(db, "members", PETER), { personKey: "peter", admin: true, sysadmin: true });
    await setDoc(doc(db, "members", THUAN), { personKey: "thuan", finance: true });
    await setDoc(doc(db, "members", EMILY), { personKey: "emily" });
    await setDoc(doc(db, "members", BACH), { personKey: "bach", admin: true });
    await setDoc(doc(db, "tasks", "t-emily"), { who: "emily", title: "Film the reel", status: "open", progress: 0 });
    await setDoc(doc(db, "tasks", "t-bach"), { who: "bach", title: "Meet Mr Marshall", status: "open", progress: 0 });
    await setDoc(doc(db, "expenses", "e-emily"), { kind: "out", amount: 250000, description: "Beads",
      status: "new", createdBy: EMILY, receipt: "" });
    await setDoc(doc(db, "expenses", "e-logged"), { kind: "out", amount: 90000, description: "Tape",
      status: "logged", createdBy: EMILY, receipt: "" });
    await setDoc(doc(db, "photos", "p-emily"), { who: "emily", data: "x", date: "2026-09-26" });
    await setDoc(doc(db, "merch", "m-seed"), { kind: "photo", group: "final", title: "Six colourways", data: "x", who: "peter", createdBy: "" });
    await setDoc(doc(db, "merch", "m-emily"), { kind: "photo", group: "sketch", title: "Stars", data: "x", who: "emily", createdBy: EMILY });
    await setDoc(doc(db, "merch", "m-idea"), { kind: "idea", group: "idea", title: "Varsity", idea: "varsity", order: 9, who: "peter", createdBy: "" });
    await setDoc(doc(db, "updates", "u-emily"), { who: "emily", text: "hi", date: "2026-09-26" });
    await setDoc(doc(db, "pushSubs", "s-emily"), { email: EMILY, endpoint: "https://fcm.googleapis.com/e", keys: {} });
    await setDoc(doc(db, "chatDrafts", "2026-09-26"), { date: "2026-09-26", status: "pending", lines: [] });
    await setDoc(doc(db, "announcements", "a-1"), { text: "hi", by: "peter", createdBy: PETER, status: "pending" });
    await setDoc(doc(db, "activities", "act"), { name: "Bake sale #2", type: "fundraiser", checks: { money: true } });
    await setDoc(doc(db, "sponsors", "sp"), { name: "Goofoo", stage: "todo" });
    await setDoc(doc(db, "site", "data"), { PEOPLE: {} });
    await setDoc(doc(db, "meta", "pushStatus"), { people: {} });
    await setDoc(doc(db, "meta", "push"), { initialised: true });
    await setDoc(doc(db, "meta", "status"), { jobs: {} });
    await setDoc(doc(db, "onboarding", THUAN), { notify: false });
    await setDoc(doc(db, "sales", "s-open"), { name: "Ice cream sale", open: true, items: [{ id: "v", name: "Vanilla", price: 30000 }] });
    await setDoc(doc(db, "sales", "s-shut"), { name: "Bake sale", open: false, items: [{ id: "c", name: "Cookie", price: 15000 }] });
    await setDoc(doc(db, "outbox", "nightly-2026-09-26"), { kind: "nightly", date: "2026-09-26", text: "hi", by: "bach", status: "pending" });
    await setDoc(doc(db, "outbox", "nightly-2026-09-20"), { kind: "nightly", date: "2026-09-20", text: "hi", by: "bach", status: "failed" });
    await setDoc(doc(db, "outbox", "nightly-2026-09-19"), { kind: "nightly", date: "2026-09-19", text: "hi", by: "bach", status: "sent" });
    await setDoc(doc(db, "requests", "r-1"), { date: "2026-09-27", who: "bach", text: "move the sale to the 7th",
      change: { type: "event_date", eventId: "e1", date: "2026-10-07" }, status: "pending" });
    await setDoc(doc(db, "requests", "r-done"), { date: "2026-09-26", who: "bach", text: "x", change: {}, status: "applied" });
    await setDoc(doc(db, "polls", "p-open"), { question: "Which day?", options: ["Fri", "Sat", "Sun"], status: "open", by: "bach", closesAt: null });
    await setDoc(doc(db, "polls", "p-shut"), { question: "Old?", options: ["Yes", "No"], status: "closed", by: "bach", closesAt: null });
    await setDoc(doc(db, "polls", "p-past"), { question: "Past its time?", options: ["Yes", "No"], status: "open", by: "bach",
      closesAt: Timestamp.fromMillis(Date.now() - 3600e3) });
    await setDoc(doc(db, "pollVotes", "p-open_" + EMILY), { poll: "p-open", who: "emily", choice: 0 });
    await setDoc(doc(db, "orders", "o-1"), { sale: "s-open", name: "Minh", cls: "10A", items: { v: 2 }, pay: "cash",
      code: "A7K2", paid: false, pickedUp: false, pushed: false });
  });
}

const as = (email) => env.authenticatedContext(email, { email }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

const ANN = (by, key, extra = {}) => ({ text: "Are we still doing the ice cream sale?", by: key, byName: "x",
  createdBy: by, status: "pending", createdAt: serverTimestamp(), ...extra });

const ORD = (extra = {}) => ({ sale: "s-open", name: "Minh", cls: "10A", contact: "", items: { v: 2 }, pay: "cash",
  note: "", code: "B3X9", paid: false, pickedUp: false, pushed: false, createdAt: serverTimestamp(), ...extra });

const OUT = (by, key, extra = {}) => ({ kind: "nightly", date: "2026-09-27", text: "🧾 Chạm on Sun 27 Sep\n• Sale moved\nUpdates tab: peterachss.github.io/cham-hq",
  by: key, byName: "x", createdBy: by, status: "pending", createdAt: serverTimestamp(), ...extra });

// a design; pass { field: undefined } to leave a field out
const MER = (by, key, extra = {}) => Object.fromEntries(Object.entries({ kind: "photo", group: "canva", title: "Hoodie draft", caption: "",
  data: "data:image/jpeg;base64,xyz", w: 900, h: 1600, who: key, createdBy: by, createdAt: serverTimestamp(), ...extra })
  .filter(([, v]) => v !== undefined));

const POLL = (by, key, extra = {}) => ({ question: "Sale on Friday or Saturday?", options: ["Friday", "Saturday"], closesAt: null,
  status: "open", by: key, byName: "x", createdBy: by, createdAt: serverTimestamp(), ...extra });
const VOTE = (poll, key, choice, extra = {}) => ({ poll, who: key, choice, at: serverTimestamp(), ...extra });

const EXP = (by, extra = {}) => ({ kind: "out", amount: 250000, description: "Beads", category: "Events",
  status: "new", createdBy: by, receipt: "", ...extra });

const cases = [
  // ---------------------------------------------------------------- reading
  ["signed out cannot read tasks",           false, () => getDoc(doc(anon(), "tasks/t-emily"))],
  ["stranger cannot read tasks",             false, () => getDoc(doc(as(STRANGER), "tasks/t-emily"))],
  ["member reads tasks",                     true,  () => getDoc(doc(as(EMILY), "tasks/t-emily"))],
  ["member reads the member list",           true,  () => getDoc(doc(as(EMILY), "members", PETER))],
  ["stranger cannot read money",             false, () => getDoc(doc(as(STRANGER), "expenses/e-emily"))],
  ["stranger cannot read photos",            false, () => getDoc(doc(as(STRANGER), "photos/p-emily"))],

  // ---------------------------------------------------------------- members
  ["member cannot make themselves admin",    false, () => updateDoc(doc(as(EMILY), "members", EMILY), { admin: true })],
  ["admin can add a member",                 true,  () => setDoc(doc(as(PETER), "members", "new@test.cham"), { personKey: "sarah" })],

  // ---------------------------------------------------------------- tasks
  ["member sets progress on own job",        true,  () => updateDoc(doc(as(EMILY), "tasks/t-emily"), { progress: 60, updatedAt: serverTimestamp() })],
  ["member marks own job done",              true,  () => updateDoc(doc(as(EMILY), "tasks/t-emily"), { status: "done", progress: 100, doneAt: serverTimestamp(), updatedAt: serverTimestamp() })],
  ["member cannot rename own job",           false, () => updateDoc(doc(as(EMILY), "tasks/t-emily"), { title: "Something easier" })],
  ["member cannot move own due date",        false, () => updateDoc(doc(as(EMILY), "tasks/t-emily"), { due: "2027-01-01" })],
  ["member cannot hand own job to someone",  false, () => updateDoc(doc(as(EMILY), "tasks/t-emily"), { who: "bach" })],
  ["member cannot touch someone else's job", false, () => updateDoc(doc(as(EMILY), "tasks/t-bach"), { progress: 50 })],
  ["member cannot use a made-up status",     false, () => updateDoc(doc(as(EMILY), "tasks/t-emily"), { status: "cancelled" })],
  ["admin renames anybody's job",            true,  () => updateDoc(doc(as(BACH), "tasks/t-emily"), { title: "Film two reels" })],
  ["admin creates a job",                    true,  () => setDoc(doc(as(PETER), "tasks/t-new"), { who: "emily", title: "x", status: "open" })],
  ["member cannot create a job",             false, () => setDoc(doc(as(EMILY), "tasks/t-new2"), { who: "emily", title: "x", status: "open" })],
  ["finance is not admin for jobs",          false, () => setDoc(doc(as(THUAN), "tasks/t-new3"), { who: "thuan", title: "x", status: "open" })],

  // ---------------------------------------------------------------- feed
  ["member posts to feed as themselves",     true,  () => addDoc(collection(as(EMILY), "updates"), { who: "emily", text: "Filmed it", date: "2026-09-26", auto: true })],
  ["member cannot post as someone else",     false, () => addDoc(collection(as(EMILY), "updates"), { who: "bach", text: "x", date: "2026-09-26" })],
  ["admin posts as anybody",                 true,  () => addDoc(collection(as(PETER), "updates"), { who: "bach", text: "x", date: "2026-09-26" })],
  ["member deletes own feed line",           true,  () => deleteDoc(doc(as(EMILY), "updates/u-emily"))],

  // ---------------------------------------------------------------- photos
  ["member adds own photo",                  true,  () => addDoc(collection(as(EMILY), "photos"), { who: "emily", data: "abc", date: "2026-09-26" })],
  ["member cannot add a photo as someone",   false, () => addDoc(collection(as(EMILY), "photos"), { who: "bach", data: "abc", date: "2026-09-26" })],
  ["oversized photo is refused",             false, () => addDoc(collection(as(EMILY), "photos"), { who: "emily", data: "x".repeat(1_000_001), date: "2026-09-26" })],
  ["photos cannot be edited",                false, () => updateDoc(doc(as(EMILY), "photos/p-emily"), { data: "y" })],

  // ---------------------------------------------------------------- money
  ["member logs money in own name",          true,  () => addDoc(collection(as(EMILY), "expenses"), EXP(EMILY))],
  ["member cannot log money as someone",     false, () => addDoc(collection(as(EMILY), "expenses"), EXP(THUAN))],
  ["zero amount refused",                    false, () => addDoc(collection(as(EMILY), "expenses"), EXP(EMILY, { amount: 0 }))],
  ["negative amount refused",                false, () => addDoc(collection(as(EMILY), "expenses"), EXP(EMILY, { amount: -5000 }))],
  ["amount as text refused",                 false, () => addDoc(collection(as(EMILY), "expenses"), EXP(EMILY, { amount: "250k" }))],
  ["cannot log straight in as 'logged'",     false, () => addDoc(collection(as(EMILY), "expenses"), EXP(EMILY, { status: "logged" }))],
  ["unknown kind refused",                   false, () => addDoc(collection(as(EMILY), "expenses"), EXP(EMILY, { kind: "sideways" }))],
  ["member cannot mark own line in sheet",   false, () => updateDoc(doc(as(EMILY), "expenses/e-emily"), { status: "logged" })],
  ["finance marks a line in the sheet",      true,  () => updateDoc(doc(as(THUAN), "expenses/e-emily"), { status: "logged" })],
  ["finance marks someone paid back",        true,  () => updateDoc(doc(as(THUAN), "expenses/e-emily"), { repaid: true })],
  ["admin can also manage money",            true,  () => updateDoc(doc(as(PETER), "expenses/e-emily"), { status: "logged" })],
  ["member deletes own new line",            true,  () => deleteDoc(doc(as(EMILY), "expenses/e-emily"))],
  ["member cannot delete a logged line",     false, () => deleteDoc(doc(as(EMILY), "expenses/e-logged"))],
  ["finance deletes any line",               true,  () => deleteDoc(doc(as(THUAN), "expenses/e-logged"))],

  // ---------------------------------------------------------------- push
  ["member saves own push subscription",     true,  () => setDoc(doc(as(EMILY), "pushSubs/s1"), { email: EMILY, endpoint: "https://fcm.googleapis.com/x", keys: { p256dh: "a", auth: "b" } })],
  ["cannot file a subscription as someone",  false, () => setDoc(doc(as(EMILY), "pushSubs/s2"), { email: PETER, endpoint: "https://fcm.googleapis.com/x", keys: {} })],
  ["subscription endpoint must be https",    false, () => setDoc(doc(as(EMILY), "pushSubs/s3"), { email: EMILY, endpoint: "http://evil.example/x", keys: {} })],
  ["nobody can read subscriptions",          false, () => getDoc(doc(as(PETER), "pushSubs/s-emily"))],
  ["member removes own subscription",        true,  () => deleteDoc(doc(as(EMILY), "pushSubs/s-emily"))],
  ["cannot remove someone else's",           false, () => deleteDoc(doc(as(BACH), "pushSubs/s-emily"))],
  ["stranger cannot save a subscription",    false, () => setDoc(doc(as(STRANGER), "pushSubs/s4"), { email: STRANGER, endpoint: "https://fcm.googleapis.com/x", keys: {} })],

  // ---------------------------------------------------------------- chat drafts
  ["admin reads tonight's draft",            true,  () => getDoc(doc(as(BACH), "chatDrafts/2026-09-26"))],
  ["member cannot read the draft",           false, () => getDoc(doc(as(EMILY), "chatDrafts/2026-09-26"))],
  ["finance cannot read the draft",          false, () => getDoc(doc(as(THUAN), "chatDrafts/2026-09-26"))],
  ["admin marks the draft posted",           true,  () => updateDoc(doc(as(PETER), "chatDrafts/2026-09-26"), { status: "posted" })],
  ["member cannot touch the draft",          false, () => updateDoc(doc(as(EMILY), "chatDrafts/2026-09-26"), { status: "posted" })],
  ["nobody on the site creates a draft",     false, () => setDoc(doc(as(PETER), "chatDrafts/2026-09-27"), { status: "pending" })],
  // the site LISTS pending drafts rather than fetching one - Firestore checks that separately
  ["admin lists pending drafts (the site's query)", true,  () => getDocs(query(collection(as(PETER), "chatDrafts"), where("status", "==", "pending")))],
  ["member cannot list drafts",              false, () => getDocs(query(collection(as(EMILY), "chatDrafts"), where("status", "==", "pending")))],
  ["member lists money (the site's query)",  true,  () => getDocs(collection(as(EMILY), "expenses"))],
  ["member lists tasks (the site's query)",  true,  () => getDocs(collection(as(EMILY), "tasks"))],

  // ---------------------------------------------------------------- announcements
  ["admin announces under own name",         true,  () => addDoc(collection(as(PETER), "announcements"), ANN(PETER, "peter"))],
  ["member cannot announce",                 false, () => addDoc(collection(as(EMILY), "announcements"), ANN(EMILY, "emily"))],
  ["finance cannot announce",                false, () => addDoc(collection(as(THUAN), "announcements"), ANN(THUAN, "thuan"))],
  ["admin cannot announce as someone else",  false, () => addDoc(collection(as(PETER), "announcements"), ANN(PETER, "bach"))],
  ["admin cannot fake the sender email",     false, () => addDoc(collection(as(PETER), "announcements"), ANN(BACH, "peter"))],
  ["cannot file one as already sent",        false, () => addDoc(collection(as(PETER), "announcements"), ANN(PETER, "peter", { status: "sent" }))],
  ["empty announcement refused",             false, () => addDoc(collection(as(PETER), "announcements"), ANN(PETER, "peter", { text: "" }))],
  ["over 300 characters refused",            false, () => addDoc(collection(as(PETER), "announcements"), ANN(PETER, "peter", { text: "x".repeat(301) }))],
  ["member reads announcements (the site's query)", true, () => getDocs(collection(as(EMILY), "announcements"))],
  ["stranger cannot read announcements",     false, () => getDocs(collection(as(STRANGER), "announcements"))],
  ["admin cannot mark one sent",             false, () => updateDoc(doc(as(PETER), "announcements/a-1"), { status: "sent" })],
  ["admin cannot delete one",                false, () => deleteDoc(doc(as(PETER), "announcements/a-1"))],

  // ---------------------------------------------------------------- nudges
  ["admin nudges somebody",                  true,  () => addDoc(collection(as(BACH), "announcements"), ANN(BACH, "bach", { kind: "nudge", to: "emily", text: "Film the reel, due tomorrow" }))],
  ["member cannot nudge",                    false, () => addDoc(collection(as(EMILY), "announcements"), ANN(EMILY, "emily", { kind: "nudge", to: "bach" }))],
  ["a nudge needs somebody to go to",        false, () => addDoc(collection(as(BACH), "announcements"), ANN(BACH, "bach", { kind: "nudge" }))],
  ["cannot nudge yourself",                  false, () => addDoc(collection(as(BACH), "announcements"), ANN(BACH, "bach", { kind: "nudge", to: "bach" }))],
  ["no made-up kinds",                       false, () => addDoc(collection(as(BACH), "announcements"), ANN(BACH, "bach", { kind: "shout" }))],

  // ---------------------------------------------------------------- test notifications
  ["member sends a test to themselves",      true,  () => addDoc(collection(as(EMILY), "announcements"), ANN(EMILY, "emily", { kind: "test", to: "emily" }))],
  ["member cannot test someone else",        false, () => addDoc(collection(as(EMILY), "announcements"), ANN(EMILY, "emily", { kind: "test", to: "bach" }))],
  ["member still cannot announce",           false, () => addDoc(collection(as(EMILY), "announcements"), ANN(EMILY, "emily", { kind: "announce" }))],

  // ---------------------------------------------------------------- sales + pre-orders
  ["anyone can see a sale (the order page)", true,  () => getDoc(doc(anon(), "sales/s-open"))],
  ["admin sets up a sale",                   true,  () => setDoc(doc(as(BACH), "sales/s-new"), { name: "Bracelets", open: true, items: [] })],
  ["member cannot set up a sale",            false, () => setDoc(doc(as(EMILY), "sales/s-new"), { name: "x", open: true, items: [] })],
  ["signed-out buyer places an order",       true,  () => addDoc(collection(anon(), "orders"), ORD())],
  ["no ordering once the sale is closed",    false, () => addDoc(collection(anon(), "orders"), ORD({ sale: "s-shut" }))],
  ["no ordering from a made-up sale",        false, () => addDoc(collection(anon(), "orders"), ORD({ sale: "nope" }))],
  ["buyer cannot mark it paid",              false, () => addDoc(collection(anon(), "orders"), ORD({ paid: true }))],
  ["buyer cannot add extra fields",          false, () => addDoc(collection(anon(), "orders"), ORD({ price: 1 }))],
  ["buyer name must be sensible",            false, () => addDoc(collection(anon(), "orders"), ORD({ name: "x".repeat(61) }))],
  ["order must have something in it",        false, () => addDoc(collection(anon(), "orders"), ORD({ items: {} }))],
  ["buyers cannot read orders",              false, () => getDoc(doc(anon(), "orders/o-1"))],
  ["stranger cannot read orders",            false, () => getDocs(collection(as(STRANGER), "orders"))],
  ["member lists orders (the site's query)", true,  () => getDocs(collection(as(EMILY), "orders"))],
  ["member ticks paid at the stall",         true,  () => updateDoc(doc(as(EMILY), "orders/o-1"), { paid: true, updatedAt: serverTimestamp(), updatedBy: "emily" })],
  ["member cannot change what was ordered",  false, () => updateDoc(doc(as(EMILY), "orders/o-1"), { items: { v: 20 } })],
  ["buyer cannot tick their own order paid", false, () => updateDoc(doc(anon(), "orders/o-1"), { paid: true })],
  ["member cannot delete an order",          false, () => deleteDoc(doc(as(EMILY), "orders/o-1"))],
  ["admin deletes a junk order",             true,  () => deleteDoc(doc(as(BACH), "orders/o-1"))],

  // ---------------------------------------------------------------- impact & evidence
  ["member reads the activities",            true,  () => getDocs(collection(as(EMILY), "activities"))],
  ["stranger cannot read the activities",    false, () => getDocs(collection(anon(), "activities"))],
  ["admin ticks off evidence",               true,  () => setDoc(doc(as(BACH), "activities/a1"), { name: "Mai Tâm", checks: { plan: true } })],
  ["member cannot tick off evidence",        false, () => setDoc(doc(as(EMILY), "activities/a1"), { name: "Mai Tâm", checks: { plan: true } })],

  // ---------------------------------------------------------------- reviews, sponsors, meetings, public report
  ["member files the after-event review",    true,  () => updateDoc(doc(as(EMILY), "activities/act"), { review: { by: "emily", well: "x" }, reviewedAt: serverTimestamp() })],
  ["member cannot review as someone else",   false, () => updateDoc(doc(as(EMILY), "activities/act"), { review: { by: "bach", well: "x" } })],
  ["member cannot change the evidence ticks",false, () => updateDoc(doc(as(EMILY), "activities/act"), { checks: { plan: true } })],
  ["member adds a possible sponsor",         true,  () => addDoc(collection(as(EMILY), "sponsors"), { name: "Goofoo Gelato", stage: "todo" })],
  ["sponsor stage must be a real stage",     false, () => addDoc(collection(as(EMILY), "sponsors"), { name: "X", stage: "maybe" })],
  ["stranger cannot see sponsors",           false, () => getDocs(collection(anon(), "sponsors"))],
  ["member cannot delete a sponsor",         false, () => deleteDoc(doc(as(EMILY), "sponsors/sp"))],
  ["member writes meeting notes",            true,  () => addDoc(collection(as(THUAN), "meetings"), { date: "2026-09-28", title: "Weekly", notes: "x" })],
  ["stranger cannot read meeting notes",     false, () => getDocs(collection(anon(), "meetings"))],
  ["nothing is public: signed-out read fails", false, () => getDoc(doc(anon(), "public/report"))],
  ["member reads the site data",             true,  () => getDoc(doc(as(EMILY), "site/data"))],
  ["signed out cannot read the site data",   false, () => getDoc(doc(anon(), "site/data"))],
  ["stranger cannot read the site data",     false, () => getDoc(doc(as(STRANGER), "site/data"))],
  ["nobody writes the site data from a page",false, () => setDoc(doc(as(PETER), "site/data"), { PEOPLE: {} })],
  ["admin sees who has notifications on",    true,  () => getDoc(doc(as(BACH), "meta/pushStatus"))],
  ["member cannot see notification status",  false, () => getDoc(doc(as(EMILY), "meta/pushStatus"))],
  ["admin cannot read the sender's state",   false, () => getDoc(doc(as(BACH), "meta/push"))],
  ["Peter reads the system status",          true,  () => getDoc(doc(as(PETER), "meta/status"))],
  ["another admin cannot read it",           false, () => getDoc(doc(as(BACH), "meta/status"))],
  ["member cannot read the system status",   false, () => getDoc(doc(as(EMILY), "meta/status"))],
  ["member sees the events",                 true,  () => getDocs(collection(as(EMILY), "events"))],
  ["admin sets an event",                    true,  () => setDoc(doc(as(BACH), "events/e1"), { name: "Ice cream sale", date: "2026-10-02", locked: true })],
  ["member cannot set an event",             false, () => setDoc(doc(as(EMILY), "events/e1"), { name: "x", date: "2026-10-02" })],
  ["stranger cannot see events",             false, () => getDocs(collection(anon(), "events"))],
  ["member saves own checklist",             true,  () => setDoc(doc(as(EMILY), "onboarding", EMILY), { notify: true })],
  ["member cannot read someone's checklist", false, () => getDoc(doc(as(EMILY), "onboarding", THUAN))],
  ["member cannot write someone's checklist",false, () => setDoc(doc(as(EMILY), "onboarding", THUAN), { notify: true })],
  ["admin nudges someone to turn them on",   true,  () => updateDoc(doc(as(BACH), "members", EMILY), { notifyNudge: { by: "bach", at: "2026-09-26" } })],
  ["member cannot nudge via member records", false, () => updateDoc(doc(as(EMILY), "members", THUAN), { notifyNudge: { by: "emily" } })],

  // ---------------------------------------------------------------- group chat outbox
  ["admin queues tonight's group chat post", true,  () => setDoc(doc(as(BACH), "outbox/nightly-2026-09-27"), OUT(BACH, "bach"))],
  ["member cannot queue a group chat post",  false, () => setDoc(doc(as(EMILY), "outbox/nightly-2026-09-27"), OUT(EMILY, "emily"))],
  ["finance cannot queue one either",        false, () => setDoc(doc(as(THUAN), "outbox/nightly-2026-09-27"), OUT(THUAN, "thuan"))],
  ["cannot queue one as someone else",       false, () => setDoc(doc(as(BACH), "outbox/nightly-2026-09-27"), OUT(BACH, "peter"))],
  ["cannot queue one already sent",          false, () => setDoc(doc(as(BACH), "outbox/nightly-2026-09-27"), OUT(BACH, "bach", { status: "sent" }))],
  ["one post per night: id must match date", false, () => setDoc(doc(as(BACH), "outbox/whatever"), OUT(BACH, "bach"))],
  ["cannot queue a second one for a night",  false, () => setDoc(doc(as(BACH), "outbox/nightly-2026-09-26"), OUT(BACH, "bach", { date: "2026-09-26" }))],
  ["empty group chat post refused",          false, () => setDoc(doc(as(BACH), "outbox/nightly-2026-09-27"), OUT(BACH, "bach", { text: "" }))],
  ["over-long group chat post refused",      false, () => setDoc(doc(as(BACH), "outbox/nightly-2026-09-27"), OUT(BACH, "bach", { text: "x".repeat(1001) }))],
  ["no extra fields on a group chat post",   false, () => setDoc(doc(as(BACH), "outbox/nightly-2026-09-27"), OUT(BACH, "bach", { to: "someone" }))],
  ["member reads the outbox",                true,  () => getDocs(collection(as(EMILY), "outbox"))],
  ["stranger cannot read the outbox",        false, () => getDocs(collection(as(STRANGER), "outbox"))],
  ["admin cancels one still waiting",        true,  () => updateDoc(doc(as(PETER), "outbox/nightly-2026-09-26"), { status: "cancelled", updatedAt: serverTimestamp(), updatedBy: "peter" })],
  ["member cannot cancel one",               false, () => updateDoc(doc(as(EMILY), "outbox/nightly-2026-09-26"), { status: "cancelled" })],
  ["admin cannot mark one sent",             false, () => updateDoc(doc(as(PETER), "outbox/nightly-2026-09-26"), { status: "sent" })],
  ["admin cannot change what it says",       false, () => updateDoc(doc(as(PETER), "outbox/nightly-2026-09-26"), { text: "something else" })],
  ["admin tries a failed one again",         true,  () => updateDoc(doc(as(PETER), "outbox/nightly-2026-09-20"), { status: "pending", updatedAt: serverTimestamp(), updatedBy: "peter" })],
  ["cannot re-send one that went",           false, () => updateDoc(doc(as(PETER), "outbox/nightly-2026-09-19"), { status: "pending" })],
  ["nobody deletes from the outbox",         false, () => deleteDoc(doc(as(PETER), "outbox/nightly-2026-09-26"))],

  // ---------------------------------------------------------------- requests from the chat
  ["admin lists pending requests (the site's query)", true, () => getDocs(query(collection(as(BACH), "requests"), where("status", "==", "pending")))],
  ["member cannot read requests",            false, () => getDocs(query(collection(as(EMILY), "requests"), where("status", "==", "pending")))],
  ["finance cannot read requests",           false, () => getDoc(doc(as(THUAN), "requests/r-1"))],
  ["admin applies a request",                true,  () => updateDoc(doc(as(PETER), "requests/r-1"), { status: "applied", reviewedAt: serverTimestamp(), reviewedBy: PETER })],
  ["admin dismisses a request",              true,  () => updateDoc(doc(as(BACH), "requests/r-1"), { status: "dismissed", reviewedAt: serverTimestamp(), reviewedBy: BACH })],
  ["member cannot apply a request",          false, () => updateDoc(doc(as(EMILY), "requests/r-1"), { status: "applied" })],
  ["admin cannot rewrite what was asked",    false, () => updateDoc(doc(as(PETER), "requests/r-1"), { change: { type: "task_new", who: "peter", title: "x" } })],
  ["no made-up request status",              false, () => updateDoc(doc(as(PETER), "requests/r-1"), { status: "maybe" })],
  ["a dealt-with request stays dealt with",  false, () => updateDoc(doc(as(PETER), "requests/r-done"), { status: "dismissed" })],
  ["nobody on the site files a request",     false, () => setDoc(doc(as(PETER), "requests/r-new"), { status: "pending", change: {} })],
  ["nobody deletes a request",               false, () => deleteDoc(doc(as(PETER), "requests/r-1"))],

  // ---------------------------------------------------------------- polls
  ["admin asks a poll",                      true,  () => addDoc(collection(as(BACH), "polls"), POLL(BACH, "bach"))],
  ["admin asks one with a closing time",     true,  () => addDoc(collection(as(BACH), "polls"), POLL(BACH, "bach", { closesAt: Timestamp.fromMillis(Date.now() + 864e5) }))],
  ["member cannot ask a poll",               false, () => addDoc(collection(as(EMILY), "polls"), POLL(EMILY, "emily"))],
  ["cannot ask one as someone else",         false, () => addDoc(collection(as(BACH), "polls"), POLL(BACH, "peter"))],
  ["a poll needs at least 2 options",        false, () => addDoc(collection(as(BACH), "polls"), POLL(BACH, "bach", { options: ["Only"] }))],
  ["a poll has at most 5 options",           false, () => addDoc(collection(as(BACH), "polls"), POLL(BACH, "bach", { options: ["a", "b", "c", "d", "e", "f"] }))],
  ["no empty options",                       false, () => addDoc(collection(as(BACH), "polls"), POLL(BACH, "bach", { options: ["a", "b", ""] }))],
  ["options must be words",                  false, () => addDoc(collection(as(BACH), "polls"), POLL(BACH, "bach", { options: ["a", 2] }))],
  ["no empty question",                      false, () => addDoc(collection(as(BACH), "polls"), POLL(BACH, "bach", { question: "" }))],
  ["cannot open one already closed",         false, () => addDoc(collection(as(BACH), "polls"), POLL(BACH, "bach", { status: "closed" }))],
  ["closing time must be a time",            false, () => addDoc(collection(as(BACH), "polls"), POLL(BACH, "bach", { closesAt: "friday" }))],
  ["member reads polls",                     true,  () => getDocs(collection(as(EMILY), "polls"))],
  ["stranger cannot read polls",             false, () => getDocs(collection(as(STRANGER), "polls"))],
  ["admin closes a poll",                    true,  () => updateDoc(doc(as(PETER), "polls/p-open"), { status: "closed", closedAt: serverTimestamp(), closedBy: PETER })],
  ["member cannot close a poll",             false, () => updateDoc(doc(as(EMILY), "polls/p-open"), { status: "closed" })],
  ["admin cannot change the options",        false, () => updateDoc(doc(as(PETER), "polls/p-open"), { options: ["Fri", "Sat", "Mon"] })],
  ["a closed poll stays closed",             false, () => updateDoc(doc(as(PETER), "polls/p-shut"), { status: "open" })],
  ["member votes",                           true,  () => setDoc(doc(as(THUAN), "pollVotes", "p-open_" + THUAN), VOTE("p-open", "thuan", 1))],
  ["member changes their vote",              true,  () => setDoc(doc(as(EMILY), "pollVotes", "p-open_" + EMILY), VOTE("p-open", "emily", 2))],
  ["cannot vote for someone else",           false, () => setDoc(doc(as(EMILY), "pollVotes", "p-open_" + THUAN), VOTE("p-open", "thuan", 1))],
  ["cannot vote under someone's name",       false, () => setDoc(doc(as(EMILY), "pollVotes", "p-open_" + EMILY), VOTE("p-open", "thuan", 1))],
  ["cannot change someone else's vote",      false, () => updateDoc(doc(as(THUAN), "pollVotes", "p-open_" + EMILY), { choice: 1 })],
  ["no voting for an option that isn't there", false, () => setDoc(doc(as(THUAN), "pollVotes", "p-open_" + THUAN), VOTE("p-open", "thuan", 3))],
  ["no negative choices",                    false, () => setDoc(doc(as(THUAN), "pollVotes", "p-open_" + THUAN), VOTE("p-open", "thuan", -1))],
  ["no voting once it's closed",             false, () => setDoc(doc(as(THUAN), "pollVotes", "p-shut_" + THUAN), VOTE("p-shut", "thuan", 0))],
  ["no voting past its closing time",        false, () => setDoc(doc(as(THUAN), "pollVotes", "p-past_" + THUAN), VOTE("p-past", "thuan", 0))],
  ["no voting in a poll that doesn't exist", false, () => setDoc(doc(as(THUAN), "pollVotes", "nope_" + THUAN), VOTE("nope", "thuan", 0))],
  ["no extra fields on a vote",              false, () => setDoc(doc(as(THUAN), "pollVotes", "p-open_" + THUAN), VOTE("p-open", "thuan", 0, { weight: 10 }))],
  ["stranger cannot vote",                   false, () => setDoc(doc(as(STRANGER), "pollVotes", "p-open_" + STRANGER), VOTE("p-open", "x", 0))],
  ["member reads the votes",                 true,  () => getDocs(query(collection(as(EMILY), "pollVotes"), where("poll", "in", ["p-open", "p-shut"])))],
  ["stranger cannot read votes",             false, () => getDocs(collection(as(STRANGER), "pollVotes"))],
  ["member cannot delete a vote",            false, () => deleteDoc(doc(as(EMILY), "pollVotes", "p-open_" + EMILY))],
  ["admin deletes a poll",                   true,  () => deleteDoc(doc(as(BACH), "polls/p-open"))],
  ["admin clears a poll's votes",            true,  () => deleteDoc(doc(as(PETER), "pollVotes", "p-open_" + EMILY))],
  ["admin finds a poll's feed lines",        true,  () => getDocs(query(collection(as(PETER), "updates"), where("ref", "==", "p-open")))],
  ["admin deletes a poll's feed line",       true,  () => deleteDoc(doc(as(PETER), "updates/u-emily"))],
  ["member cannot delete a poll",            false, () => deleteDoc(doc(as(EMILY), "polls/p-open"))],
  ["admin pings everyone about a poll",      true,  () => addDoc(collection(as(BACH), "announcements"), ANN(BACH, "bach", { kind: "poll", poll: "p-open", text: "Which day?" }))],
  ["member cannot ping about a poll",        false, () => addDoc(collection(as(EMILY), "announcements"), ANN(EMILY, "emily", { kind: "poll", poll: "p-open" }))],
  ["poll ping needs a real poll",            false, () => addDoc(collection(as(BACH), "announcements"), ANN(BACH, "bach", { kind: "poll", poll: "nope" }))],
  // ---------------------------------------------------------------- merch
  ["member reads the merch designs",         true,  () => getDocs(collection(as(EMILY), "merch"))],
  ["stranger cannot read merch",             false, () => getDocs(collection(as(STRANGER), "merch"))],
  ["signed out cannot read merch",           false, () => getDoc(doc(anon(), "merch/m-seed"))],
  ["member adds a design",                   true,  () => addDoc(collection(as(EMILY), "merch"), MER(EMILY, "emily"))],
  ["admin adds a concept idea",              true,  () => addDoc(collection(as(PETER), "merch"), MER(PETER, "peter", { kind: "idea", group: "idea", idea: "varsity", data: undefined }))],
  ["cannot add a design as someone else",    false, () => addDoc(collection(as(EMILY), "merch"), MER(EMILY, "bach"))],
  ["cannot add under another email",         false, () => addDoc(collection(as(EMILY), "merch"), MER(BACH, "emily"))],
  ["a picture needs its image",              false, () => addDoc(collection(as(EMILY), "merch"), MER(EMILY, "emily", { data: undefined }))],
  ["oversized design is refused",            false, () => addDoc(collection(as(EMILY), "merch"), MER(EMILY, "emily", { data: "x".repeat(1_000_001) }))],
  ["design needs a title",                   false, () => addDoc(collection(as(EMILY), "merch"), MER(EMILY, "emily", { title: "" }))],
  ["only the known groups",                  false, () => addDoc(collection(as(EMILY), "merch"), MER(EMILY, "emily", { group: "secret" }))],
  ["no extra fields on a design",            false, () => addDoc(collection(as(EMILY), "merch"), MER(EMILY, "emily", { public: true }))],
  ["stranger cannot add a design",           false, () => addDoc(collection(as(STRANGER), "merch"), MER(STRANGER, "x"))],
  ["a design's title can't be edited",       false, () => updateDoc(doc(as(PETER), "merch/m-seed"), { title: "y" })],
  ["a design's picture can't be swapped",    false, () => updateDoc(doc(as(PETER), "merch/m-seed"), { data: "z" })],
  ["admin moves a design to another section", true, () => updateDoc(doc(as(BACH), "merch/m-seed"), { group: "canva", order: 4 })],
  ["admin reorders a design",                true,  () => updateDoc(doc(as(PETER), "merch/m-seed"), { order: 7.5 })],
  ["member moves their own design",          true,  () => updateDoc(doc(as(EMILY), "merch/m-emily"), { group: "final", order: 2 })],
  ["member cannot move someone else's",      false, () => updateDoc(doc(as(EMILY), "merch/m-seed"), { order: 3 })],
  ["no moving into a made-up section",       false, () => updateDoc(doc(as(PETER), "merch/m-seed"), { group: "secret", order: 1 })],
  ["a picture can't join the drawn ideas",   false, () => updateDoc(doc(as(PETER), "merch/m-seed"), { group: "idea", order: 1 })],
  ["a drawn idea stays with the ideas",      false, () => updateDoc(doc(as(PETER), "merch/m-idea"), { group: "canva", order: 1 })],
  ["order must be a number",                 false, () => updateDoc(doc(as(PETER), "merch/m-seed"), { order: "first" })],
  ["stranger cannot move a design",          false, () => updateDoc(doc(as(STRANGER), "merch/m-emily"), { order: 1 })],
  ["member removes their own design",        true,  () => deleteDoc(doc(as(EMILY), "merch/m-emily"))],
  ["member cannot remove someone else's",    false, () => deleteDoc(doc(as(EMILY), "merch/m-seed"))],
  ["admin removes any design",               true,  () => deleteDoc(doc(as(BACH), "merch/m-seed"))],
];

let failed = 0;
for (const [name, shouldPass, run] of cases) {
  await seed();
  try {
    if (shouldPass) await assertSucceeds(run()); else await assertFails(run());
    console.log("  pass  " + (shouldPass ? "ALLOW " : "DENY  ") + name);
  } catch (e) {
    failed++;
    console.log("  FAIL  " + (shouldPass ? "ALLOW " : "DENY  ") + name + "\n          " + String(e.message || e).split("\n")[0]);
  }
}
await env.cleanup();
console.log(`\n${cases.length - failed} of ${cases.length} passed`);
process.exit(failed ? 1 : 0);

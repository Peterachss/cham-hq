// Chạm HQ - Firestore rules, tested in the local emulator before they are
// ever published. Run:  npx firebase emulators:exec --only firestore "node rules.test.mjs"
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment, assertSucceeds, assertFails
} from "@firebase/rules-unit-testing";
import {
  doc, getDoc, getDocs, setDoc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp, query, where
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
    await setDoc(doc(db, "members", PETER), { personKey: "peter", admin: true });
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
    await setDoc(doc(db, "updates", "u-emily"), { who: "emily", text: "hi", date: "2026-09-26" });
    await setDoc(doc(db, "pushSubs", "s-emily"), { email: EMILY, endpoint: "https://fcm.googleapis.com/e", keys: {} });
    await setDoc(doc(db, "chatDrafts", "2026-09-26"), { date: "2026-09-26", status: "pending", lines: [] });
    await setDoc(doc(db, "announcements", "a-1"), { text: "hi", by: "peter", createdBy: PETER, status: "pending" });
    await setDoc(doc(db, "activities", "act"), { name: "Bake sale #2", type: "fundraiser", checks: { money: true } });
    await setDoc(doc(db, "sponsors", "sp"), { name: "Goofoo", stage: "todo" });
    await setDoc(doc(db, "site", "data"), { PEOPLE: {} });
    await setDoc(doc(db, "sales", "s-open"), { name: "Ice cream sale", open: true, items: [{ id: "v", name: "Vanilla", price: 30000 }] });
    await setDoc(doc(db, "sales", "s-shut"), { name: "Bake sale", open: false, items: [{ id: "c", name: "Cookie", price: 15000 }] });
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

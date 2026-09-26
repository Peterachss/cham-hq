// Chạm HQ - Firestore rules, tested in the local emulator before they are
// ever published. Run:  npx firebase emulators:exec --only firestore "node rules.test.mjs"
import { readFileSync } from "node:fs";
import {
  initializeTestEnvironment, assertSucceeds, assertFails
} from "@firebase/rules-unit-testing";
import {
  doc, getDoc, setDoc, updateDoc, deleteDoc, addDoc, collection, serverTimestamp
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
  });
}

const as = (email) => env.authenticatedContext(email, { email }).firestore();
const anon = () => env.unauthenticatedContext().firestore();

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

/* ------------------------------------------------------------------ *
 * Chạm HQ — Firebase settings
 *
 * Until this is filled in, the site runs exactly as it always has:
 * tasks come from data.json and nobody can sign in. Fill it in and the
 * sign-in bar, the tick-off buttons and the admin panel switch on.
 *
 * Where these values come from: SETUP-FIREBASE.md, step 3.
 * These are NOT secrets. Firebase web keys are meant to sit in public
 * code; what actually protects the data is firestore.rules.
 * ------------------------------------------------------------------ */
window.CHAM_FIREBASE = {
  apiKey:            "AIzaSyA3yfNRZTGzfDX1kUgtVl5N0fm76bdF-tw",
  authDomain:        "cham-hq.firebaseapp.com",
  projectId:         "cham-hq",
  storageBucket:     "cham-hq.firebasestorage.app",
  messagingSenderId: "120151131910",
  appId:             "1:120151131910:web:aeaf5e151b85bd8a654087"
};

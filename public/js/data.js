// ---------------------------------------------------------------------------
// Unified data layer backed by Firebase (Auth + Firestore). Every other
// script talks to `backend` only — status, schedule, usage logs, and chat
// are all persisted in Firestore so all 6 users share the same live state.
// ---------------------------------------------------------------------------
import { firebaseConfig, CONFIG_READY, ADMIN_EMAILS } from "./firebase-config.js";

export const WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
export const WEEKDAY_LABELS = {
  sun: "Sunday", mon: "Monday", tue: "Tuesday", wed: "Wednesday",
  thu: "Thursday", fri: "Friday", sat: "Saturday",
};

function pad(n) { return String(n).padStart(2, "0"); }
export function todayStr(d = new Date()) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; }
export function weekdayKey(d = new Date()) { return WEEKDAYS[d.getDay()]; }
export function isAdmin(email) { return ADMIN_EMAILS.includes(email); }

function emptySchedule() {
  const sched = {};
  WEEKDAYS.forEach((day) => { sched[day] = []; });
  return sched;
}

class FirebaseBackend {
  constructor() { this._ready = this._init(); }
  async _init() {
    const [{ initializeApp }, authMod, fsMod] = await Promise.all([
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-auth.js"),
      import("https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js"),
    ]);
    this._app = initializeApp(firebaseConfig);
    this._auth = authMod.getAuth(this._app);
    this._db = fsMod.getFirestore(this._app);
    this._authMod = authMod;
    this._fsMod = fsMod;
  }
  async login(email, password) {
    await this._ready;
    const cred = await this._authMod.signInWithEmailAndPassword(this._auth, email, password);
    return cred.user;
  }
  async logout() { await this._ready; return this._authMod.signOut(this._auth); }
  currentUser() { return this._auth ? this._auth.currentUser : null; }
  async onAuthChange(cb) { await this._ready; this._authMod.onAuthStateChanged(this._auth, cb); }
  // Resolves once Firebase has finished restoring (or confirmed there's no)
  // persisted session — unlike currentUser(), safe to call right after a
  // fresh page load/redirect, before the SDK has rehydrated.
  async waitForUser() {
    await this._ready;
    return new Promise((resolve) => {
      const unsub = this._authMod.onAuthStateChanged(this._auth, (user) => {
        unsub();
        resolve(user);
      });
    });
  }

  async getUserProfile(email) {
    await this._ready;
    const { doc, getDoc } = this._fsMod;
    const snap = await getDoc(doc(this._db, "users", email));
    return snap.exists() ? snap.data() : null;
  }
  async ensureUserProfile(email, name) {
    await this._ready;
    const { doc, getDoc, setDoc } = this._fsMod;
    const ref = doc(this._db, "users", email);
    const snap = await getDoc(ref);
    if (!snap.exists()) {
      const profile = { email, name, role: isAdmin(email) ? "admin" : "member" };
      await setDoc(ref, profile);
      return profile;
    }
    return snap.data();
  }
  async listUsers() {
    await this._ready;
    const { collection, getDocs } = this._fsMod;
    const snap = await getDocs(collection(this._db, "users"));
    return snap.docs.map((d) => d.data());
  }

  async getSchedule() {
    await this._ready;
    const { doc, getDoc } = this._fsMod;
    const snap = await getDoc(doc(this._db, "config", "schedule"));
    return snap.exists() ? snap.data() : emptySchedule();
  }
  async saveSchedule(schedule) {
    await this._ready;
    const { doc, setDoc } = this._fsMod;
    await setDoc(doc(this._db, "config", "schedule"), schedule);
  }

  subscribeStatuses(cb) {
    let unsub = () => {};
    this._ready.then(() => {
      const { collection, onSnapshot } = this._fsMod;
      unsub = onSnapshot(collection(this._db, "status"), (snap) => {
        const out = {};
        snap.forEach((d) => { out[d.id] = d.data(); });
        cb(out);
      });
    });
    return () => unsub();
  }
  async setActive(email, name) {
    await this._ready;
    const { doc, setDoc, collection, addDoc, serverTimestamp } = this._fsMod;
    await setDoc(doc(this._db, "status", email), { name, active: true, since: serverTimestamp() });
    await addDoc(collection(this._db, "usageLogs"), { email, name, date: todayStr(), start: serverTimestamp(), end: null, durationMin: null });
  }
  async setInactive(email) {
    await this._ready;
    const { doc, setDoc, collection, query, where, getDocs, updateDoc, serverTimestamp } = this._fsMod;
    await setDoc(doc(this._db, "status", email), { active: false, since: null }, { merge: true });
    const q = query(collection(this._db, "usageLogs"), where("email", "==", email), where("end", "==", null));
    const snap = await getDocs(q);
    const now = Date.now();
    for (const d of snap.docs) {
      const data = d.data();
      const startMs = data.start && data.start.toMillis ? data.start.toMillis() : now;
      await updateDoc(d.ref, { end: serverTimestamp(), durationMin: Math.max(0, Math.round((now - startMs) / 60000)) });
    }
  }
  async getUsageLogsForDate(dateStr) {
    await this._ready;
    const { collection, query, where, getDocs } = this._fsMod;
    const q = query(collection(this._db, "usageLogs"), where("date", "==", dateStr));
    const snap = await getDocs(q);
    return snap.docs.map((d) => d.data());
  }

  subscribeChat(cb) {
    let unsub = () => {};
    this._ready.then(() => {
      const { collection, query, orderBy, limit, onSnapshot } = this._fsMod;
      const q = query(collection(this._db, "chat"), orderBy("ts", "asc"), limit(200));
      unsub = onSnapshot(q, (snap) => cb(snap.docs.map((d) => ({ id: d.id, ...d.data() }))));
    });
    return () => unsub();
  }
  async sendChatMessage(email, name, text) {
    await this._ready;
    const { collection, addDoc, serverTimestamp } = this._fsMod;
    await addDoc(collection(this._db, "chat"), { email, name, text, ts: serverTimestamp() });
  }
}

export const backend = new FirebaseBackend();
export { CONFIG_READY, ADMIN_EMAILS };

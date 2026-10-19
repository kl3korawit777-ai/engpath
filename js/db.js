// Data layer เดียวของแอป — หน้าอื่นห้ามเรียก Firestore ตรง
// - ข้อมูลทั้งหมดอยู่ใต้ users/{uid}/{collection}/{id}
// - อ่านแบบ synchronous จาก store ในหน่วยความจำ (อัปเดตจาก onSnapshot, ใช้ได้ออฟไลน์ผ่าน persistent cache)
// - เขียนแบบ fire-and-forget: Firestore ใช้ local cache ทันทีและส่งขึ้นเซิร์ฟเวอร์เมื่อออนไลน์

import { buildExport, planImport } from "./backup.js";

const SDK ="https://www.gstatic.com/firebasejs/10.14.1";

export const MUTABLE_COLS = ["settings", "cards", "errors", "lexicon", "smartFolders", "clips", "playlists", "handwritingWords", "journal", "links", "wordFamilies", "dailyStats", "questions", "examSets"];
export const EVENT_COLS = ["reviews", "sessions", "errorEvents", "checkpoints", "practiceEvents", "shadowingEvents", "handwritingAttempts", "handwritingImages", "readings", "interleavingSessions", "examAttempts"]; // ต่อท้ายอย่างเดียว
const ALL_COLS = [...MUTABLE_COLS, ...EVENT_COLS];
// collection ที่ไม่ผูก listener ทั้งชุด (ข้อมูลหนัก): lexicon (หลายพันคำ), handwritingImages (รูปละ ~25KB) — อ่านรายรายการผ่าน lazyGet()
const LAZY_COLS = ["lexicon", "handwritingImages"];
const LISTEN_COLS = ALL_COLS.filter((c) => !LAZY_COLS.includes(c));

let F = null;            // { auth, db, A, S }
let uid = null;
let user = null;
let raw = Object.fromEntries(ALL_COLS.map((c) => [c, new Map()]));
let unsubs = [];
const pending = new Set();
const firstSnap = new Set();
const dataSubs = new Set();
const syncSubs = new Set();
const errorSubs = new Set();
let notifyQueued = false;

// ---------- สถานะซิงก์ ----------
export function syncStatus() {
  if (!navigator.onLine) return "offline";
  return pending.size ? "pending" : "synced";
}
function emitSync() { const s = syncStatus(); syncSubs.forEach((fn) => fn(s)); }
export function onSync(fn) { syncSubs.add(fn); fn(syncStatus()); return () => syncSubs.delete(fn); }
window.addEventListener("online", emitSync);
window.addEventListener("offline", emitSync);

export function onError(fn) { errorSubs.add(fn); return () => errorSubs.delete(fn); }
function reportError(e) { console.error(e); errorSubs.forEach((fn) => fn(e)); }

// ---------- subscribe การเปลี่ยนแปลงข้อมูล ----------
export function subscribe(fn) { dataSubs.add(fn); return () => dataSubs.delete(fn); }
function notifyData() {
  if (notifyQueued) return;
  notifyQueued = true;
  queueMicrotask(() => { notifyQueued = false; dataSubs.forEach((fn) => fn()); });
}

// ---------- อ่าน ----------
export const list = (col) => [...raw[col].values()].filter((d) => !d.deleted);
export const all = (col) => [...raw[col].values()];   // รวมที่ถูกลบ (ใช้ตอน export)
export const get = (col, id) => raw[col].get(id) || null;
export const currentUser = () => user;
export const isReady = () => firstSnap.size === LISTEN_COLS.length;

/** resolve เมื่อ snapshot แรกของทุก collection มาแล้ว (ใช้ตัดสินใจเช่น ต้องทำ Onboarding ไหม โดยไม่เข้าใจผิดจากข้อมูลที่ยังไม่ซิงก์) */
export function whenReady() {
  if (isReady()) return Promise.resolve();
  return new Promise((resolve) => {
    const off = subscribe(() => { if (isReady()) { off(); resolve(); } });
  });
}

// ค่า default ใช้ตอนอ่านเท่านั้น (ข้อมูลเฟสก่อนหน้าไม่ต้องย้าย): onboarding/criteria/focus ไม่มี = ยังไม่เคยตั้ง
const SETTINGS_DEFAULTS = { stage: 0, dailyMinutes: 60, checkpointWeeks: 5, handwritingStyle: "print" };
export const getSettings = () => ({ ...SETTINGS_DEFAULTS, ...(raw.settings.get("main") || {}) });

// ---------- เขียน ----------
export function newId() {
  return crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}
const clean = (o) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined));

function write(col, id, data, options) {
  if (!F || !uid) throw new Error("ยังไม่ได้ล็อกอิน");
  const ref = F.S.doc(F.db, "users", uid, col, id);
  const p = options ? F.S.setDoc(ref, clean(data), options) : F.S.setDoc(ref, clean(data));
  p.catch(reportError);
  return p;
}

/** สร้าง document ใหม่ใน collection ที่แก้ไขได้ — คืน doc ทันที (ไม่รอเซิร์ฟเวอร์) */
export function create(col, data) {
  if (!MUTABLE_COLS.includes(col)) throw new Error(`${col} ใช้ append() เท่านั้น`);
  const now = Date.now();
  const doc = { ...data, id: data.id || newId(), createdAt: now, updatedAt: now, deleted: false };
  write(col, doc.id, doc);
  return doc;
}

export function update(col, id, patch) {
  if (!MUTABLE_COLS.includes(col)) throw new Error(`${col} เป็น event แก้ไขไม่ได้`);
  write(col, id, { ...patch, id, updatedAt: Date.now() }, { merge: true });
}

export const softDelete = (col, id) => update(col, id, { deleted: true });
export const restore = (col, id) => update(col, id, { deleted: false });

/** ต่อท้าย event (reviews / sessions / errorEvents) — สร้างได้อย่างเดียว */
export function append(col, data) {
  if (!EVENT_COLS.includes(col)) throw new Error(`${col} ไม่ใช่ collection ของ event`);
  const now = Date.now();
  const doc = { ...data, id: data.id || newId(), createdAt: now, updatedAt: now, deleted: false };
  write(col, doc.id, doc);
  return doc;
}

/** บันทึก settings (doc id = main) */
export function saveSettings(patch) {
  const existing = raw.settings.get("main");
  if (existing) return update("settings", "main", patch);
  return create("settings", { ...SETTINGS_DEFAULTS, ...patch, id: "main" });
}

// ---------- อ่านรายรายการ (lexicon, handwritingImages) ----------
const withTimeout = (p, ms) => Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms))]);
const docRef = (col, id) => F.S.doc(F.db, "users", uid, col, id);

/**
 * หาเอกสารเดียว: Firestore cache ในเครื่อง → Firestore server (ไม่เรียก API ที่นี่)
 * คืน { doc, from } โดย from = cache | server | none (ไม่เคยมี) | offline | error
 */
export async function lazyGet(col, id) {
  if (!F || !uid) throw new Error("ยังไม่ได้ล็อกอิน");
  try {
    const s = await F.S.getDocFromCache(docRef(col, id));
    if (s.exists()) return { doc: s.data(), from: "cache" };
  } catch { /* ไม่อยู่ใน cache */ }
  if (!navigator.onLine) return { doc: null, from: "offline" };
  try {
    const s = await withTimeout(F.S.getDocFromServer(docRef(col, id)), 8000);
    return s.exists() ? { doc: s.data(), from: "server" } : { doc: null, from: "none" };
  } catch (error) {
    return { doc: null, from: "error", error };
  }
}

export const lexiconGet = (key) => lazyGet("lexicon", key);
/** อ่านจาก cache ในเครื่องเท่านั้น (ไม่แตะเซิร์ฟเวอร์ ไม่นับ read) — null ถ้าไม่มีใน cache */
export async function lexiconCached(key) {
  if (!F || !uid) return null;
  try { const s = await F.S.getDocFromCache(docRef("lexicon", key)); return s.exists() ? s.data() : null; } catch { return null; }
}
export const imageGet = (attemptId) => lazyGet("handwritingImages", attemptId);

/** เขียนคลังคำ (แทนที่ทั้งเอกสาร — ผู้เรียกรวมข้อมูลเดิมมาแล้ว) คืน doc ทันที */
export function lexiconPut(key, fields, existing) {
  const now = Date.now();
  const doc = { ...fields, id: key, createdAt: existing?.createdAt ?? now, updatedAt: now, deleted: false };
  write("lexicon", key, doc);
  return doc;
}

async function loadAll(col) {
  const snap = await F.S.getDocs(F.S.collection(F.db, "users", uid, col));
  return snap.docs.map((d) => d.data());
}

// ---------- Export / Import ----------
/** ข้อมูลทั้งหมดของผู้ใช้ (รวมที่ถูกลบแบบ soft) — async เพราะต้องอ่านคอลเลกชันที่ไม่ผูก listener (คลังคำ, รูปลายมือ) */
export async function exportData() {
  const cols = Object.fromEntries(LISTEN_COLS.map((c) => [c, all(c)]));
  for (const c of LAZY_COLS) cols[c] = await loadAll(c);
  return buildExport(cols, Date.now());
}

/** นำเข้าจาก JSON ที่ parse แล้ว — ไม่ทับข้อมูลที่ใหม่กว่า และไม่เขียน event ซ้ำ; โยน Error ถ้าไฟล์ไม่ถูกต้อง */
export async function importData(json) {
  if (!F || !uid) throw new Error("ยังไม่ได้ล็อกอิน");
  const existing = { ...raw };
  for (const c of LAZY_COLS) existing[c] = new Map((await loadAll(c)).map((d) => [d.id, d]));
  const plan = planImport(json, existing);
  const { S, db: fdb } = F;
  for (let i = 0; i < plan.writes.length; i += 400) {       // ขีดจำกัดของ batch คือ 500 รายการ
    const batch = S.writeBatch(fdb);
    for (const { col, doc } of plan.writes.slice(i, i + 400)) batch.set(S.doc(fdb, "users", uid, col, doc.id), clean(doc));
    batch.commit().catch(reportError);                      // ไม่ await: ออฟไลน์จะค้างจนกว่าจะต่อเน็ต
  }
  return { written: plan.writes.length, skipped: plan.skipped };
}

// ---------- watch ----------
function startWatching() {
  stopWatching();
  const { S, db } = F;
  for (const col of LISTEN_COLS) {
    const unsub = S.onSnapshot(
      S.collection(db, "users", uid, col),
      { includeMetadataChanges: true },
      (snap) => {
        let changed = false;
        for (const ch of snap.docChanges()) {   // ค่าเริ่มต้น: ไม่รวมการเปลี่ยนเฉพาะ metadata
          changed = true;
          if (ch.type === "removed") raw[col].delete(ch.doc.id);
          else raw[col].set(ch.doc.id, ch.doc.data());
        }
        if (snap.metadata.hasPendingWrites) pending.add(col); else pending.delete(col);
        const first = !firstSnap.has(col);
        firstSnap.add(col);
        if (changed || first) notifyData();
        emitSync();
      },
      reportError
    );
    unsubs.push(unsub);
  }
  unsubs.push(S.onSnapshotsInSync(db, emitSync));
}

function stopWatching() {
  unsubs.forEach((u) => u());
  unsubs = [];
  raw = Object.fromEntries(ALL_COLS.map((c) => [c, new Map()]));
  pending.clear();
  firstSnap.clear();
  emitSync();
}

// ---------- Auth ----------
/** state: unconfigured | loading | error | signedOut | signedIn */
export async function initAuth(cb) {
  cb("loading", null);
  let config;
  try {
    ({ firebaseConfig: config } = await import("./firebase-config.js"));
  } catch {
    return cb("unconfigured", null);
  }
  if (!config || !config.apiKey || !config.projectId || !config.appId) return cb("unconfigured", null);

  try {
    const [{ initializeApp }, A, S] = await Promise.all([
      import(`${SDK}/firebase-app.js`),
      import(`${SDK}/firebase-auth.js`),
      import(`${SDK}/firebase-firestore.js`),
    ]);
    const app = initializeApp(config);
    const auth = A.getAuth(app);
    const db = S.initializeFirestore(app, {
      // ไม่จำกัดขนาด cache: ค่าเริ่มต้น 40MB จะล้างเอกสารเก่าที่ไม่ได้ผูก listener (เช่นคลังคำศัพท์) ทำให้ค้นออฟไลน์ไม่ได้
      localCache: S.persistentLocalCache({ tabManager: S.persistentMultipleTabManager(), cacheSizeBytes: S.CACHE_SIZE_UNLIMITED }),
    });
    F = { auth, db, A, S };
    A.getRedirectResult(auth).catch((e) => cb("error", null, e));   // ผลจาก signInWithRedirect
    A.onAuthStateChanged(auth, (u) => {
      user = u;
      if (u) { uid = u.uid; startWatching(); cb("signedIn", u); }
      else { uid = null; stopWatching(); cb("signedOut", null); }
    });
  } catch (e) {
    console.error(e);
    cb("error", null, e);
  }
}

function preferRedirect() {
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const standalone = window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
  return ios || standalone;
}

export async function signIn() {
  const { auth, A } = F;
  const provider = new A.GoogleAuthProvider();
  provider.setCustomParameters({ prompt: "select_account" });
  if (preferRedirect()) return A.signInWithRedirect(auth, provider);
  try {
    await A.signInWithPopup(auth, provider);
  } catch (e) {
    if (e.code === "auth/popup-blocked" || e.code === "auth/operation-not-supported-in-this-environment") {
      return A.signInWithRedirect(auth, provider);
    }
    if (e.code === "auth/popup-closed-by-user" || e.code === "auth/cancelled-popup-request") return;
    throw e;
  }
}

export const signOut = () => F.A.signOut(F.auth);

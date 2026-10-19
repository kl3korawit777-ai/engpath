// mock ของ js/db.js สำหรับทดสอบ view ในเบราว์เซอร์โดยไม่ต้องใช้ Firebase (ใช้ผ่าน tests/harness.html)
const raw = { cards: new Map(), reviews: new Map() };  // sessions/settings เติมท้ายไฟล์
const subs = new Set();
const note = () => queueMicrotask(() => subs.forEach((f) => f()));
const id = () => Math.random().toString(36).slice(2);
export const list = (c) => [...raw[c].values()].filter((d) => !d.deleted);
export const get = (c, i) => raw[c].get(i) || null;
export const subscribe = (f) => { subs.add(f); return () => subs.delete(f); };
export function create(c, d) { const x = { ...d, id: d.id || id(), createdAt: Date.now(), updatedAt: Date.now(), deleted: false }; raw[c].set(x.id, x); note(); return x; }
export function update(c, i, p) { raw[c].set(i, { ...raw[c].get(i), ...p }); note(); }
export const softDelete = (c, i) => update(c, i, { deleted: true });
export function append(c, d) { const x = { id: id(), ...d, createdAt: Date.now(), deleted: false }; raw[c].set(x.id, x); (window.__log ||= []).push(x); note(); return x; }
raw.sessions = new Map();
raw.settings = new Map();
export const getSettings = () => ({ stage: 0, dailyMinutes: 60, checkpointWeeks: 5, ...(raw.settings.get("main") || {}) });
// merge แบบ Firestore setDoc(merge): object ซ้อนกันรวมแบบลึก
const deep = (a, b) => { const o = { ...a }; for (const [k, v] of Object.entries(b)) o[k] = v && typeof v === "object" && !Array.isArray(v) ? deep(a?.[k] || {}, v) : v; return o; };
export const saveSettings = (p) => { raw.settings.set("main", deep(raw.settings.get("main") || {}, p)); note(); };
raw.errors = new Map();
raw.errorEvents = new Map();
// lexicon (in-memory) — จำลอง lexiconGet/lexiconPut ของ js/db.js
const lex = new Map();
window.__lexCalls = [];
export async function lexiconGet(key) { window.__lexCalls.push(['get', key]); return lex.has(key) ? { doc: lex.get(key), from: 'cache' } : { doc: null, from: 'none' }; }
export function lexiconPut(key, fields, existing) { const d = { ...fields, id: key, createdAt: existing?.createdAt ?? Date.now(), updatedAt: Date.now(), deleted: false }; lex.set(key, d); window.__lexCalls.push(['put', key]); return d; }
raw.smartFolders = new Map();
raw.checkpoints = new Map();
export const whenReady = () => Promise.resolve();
export const isReady = () => true;
raw.practiceEvents = new Map();

raw.handwritingWords = new Map();
raw.handwritingAttempts = new Map();
raw.handwritingImages = new Map();
raw.sessions = raw.sessions || new Map();
export const imageGet = async (key) => (raw.handwritingImages.has(key) ? { doc: raw.handwritingImages.get(key), from: "cache" } : { doc: null, from: "none" });

raw.clips = new Map();
raw.playlists = new Map();
raw.shadowingEvents = new Map();

raw.readings = new Map();

raw.journal = new Map();

raw.links = new Map();
raw.wordFamilies = new Map();
export const lexiconCached = async (key) => lex.get(key) || null;
export const currentUser = () => ({ displayName: "ผู้ทดสอบ", email: "test@example.com", photoURL: "" });
export const signOut = () => {};
export const onSync = (fn) => { fn("synced"); return () => {}; };
raw.dailyStats = new Map();
export const all = (c) => [...raw[c].values()];
export const onError = () => () => {};
raw.interleavingSessions = new Map();
raw.questions = new Map();
raw.examSets = new Map();
raw.examAttempts = new Map();

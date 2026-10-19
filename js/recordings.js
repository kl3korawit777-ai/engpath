// เสียงอัด Shadowing: เก็บใน IndexedDB ของเครื่องนี้เท่านั้น — ห้ามขึ้น Firestore และไม่รวมใน Export JSON
// record = { id, clipId, sentenceIndex, mime, blob, size, durationSec, at }
import { extensionFor } from "./speech.js";

const DB_NAME = "engpath-audio", STORE = "recordings";
let dbPromise = null;

function open() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) { reject(new Error("เบราว์เซอร์นี้เก็บเสียงอัดในเครื่องไม่ได้ (ไม่รองรับ IndexedDB)")); return; }
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const s = req.result.createObjectStore(STORE, { keyPath: "id" });
      s.createIndex("clipId", "clipId");
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => { dbPromise = null; reject(new Error("เปิดที่เก็บเสียงอัดไม่ได้ (โหมดส่วนตัวหรือถูกบล็อกพื้นที่เก็บข้อมูล)")); };
  });
  return dbPromise;
}

const wrap = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });

async function tx(mode, fn) {
  const db = await open();
  return new Promise((resolve, reject) => {
    const t = db.transaction(STORE, mode);
    let result;
    t.oncomplete = () => resolve(result);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error || new Error("abort"));
    Promise.resolve(fn(t.objectStore(STORE))).then((r) => { result = r; }, reject);
  });
}

const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/** บันทึกเสียงอัด — พื้นที่เต็มโยน Error ภาษาไทย */
export async function putRecording({ clipId, sentenceIndex, mime, blob, durationSec }) {
  const rec = { id: uuid(), clipId, sentenceIndex, mime, blob, size: blob.size, durationSec: Math.round(durationSec * 10) / 10, at: Date.now() };
  try {
    await tx("readwrite", (s) => wrap(s.put(rec)));
  } catch (e) {
    if (e?.name === "QuotaExceededError" || /quota/i.test(String(e?.message))) throw new Error("พื้นที่ในเครื่องเต็ม — ลบเสียงอัดเก่าบางส่วนแล้วลองใหม่");
    throw e;
  }
  return rec;
}

export const listRecordings = (clipId) => tx("readonly", (s) => wrap(s.index("clipId").getAll(clipId))).then((a) => a.sort((x, y) => x.at - y.at));
export const getRecording = (id) => tx("readonly", (s) => wrap(s.get(id)));
export const deleteRecording = (id) => tx("readwrite", (s) => wrap(s.delete(id)));
export const allRecordings = () => tx("readonly", (s) => wrap(s.getAll()));

export async function deleteClipRecordings(clipId) {
  const list = await listRecordings(clipId);
  await tx("readwrite", async (s) => { for (const r of list) await wrap(s.delete(r.id)); });
  return list.length;
}

/** { count, bytes } ของเสียงอัดทั้งหมด (หรือเฉพาะคลิป) */
export async function usage(clipId = null) {
  const list = clipId ? await listRecordings(clipId) : await allRecordings();
  return { count: list.length, bytes: list.reduce((n, r) => n + (r.size || 0), 0) };
}

// ---------- พื้นที่เก็บข้อมูล ----------
export async function storageEstimate() {
  try { return navigator.storage?.estimate ? await navigator.storage.estimate() : null; } catch { return null; }
}

/** ขอให้เบราว์เซอร์เก็บข้อมูลถาวร (กันถูกล้างเมื่อพื้นที่เต็ม) คืน true/false/null (ไม่รองรับ) */
export async function requestPersist() {
  try {
    if (!navigator.storage?.persist) return null;
    if (await navigator.storage.persisted?.()) return true;
    return await navigator.storage.persist();
  } catch { return null; }
}

export async function isPersisted() {
  try { return navigator.storage?.persisted ? await navigator.storage.persisted() : null; } catch { return null; }
}

// ---------- ส่งออก ----------
export const fileNameFor = (r, clipTitle = "clip") =>
  `${clipTitle.replace(/[^\p{L}\p{N}]+/gu, "_").slice(0, 40) || "clip"}_s${r.sentenceIndex + 1}_${new Date(r.at).toISOString().slice(0, 19).replace(/[:T]/g, "-")}.${extensionFor(r.mime)}`;

export function downloadBlob(blob, name) {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

const toBase64 = (blob) => new Promise((resolve, reject) => {
  const fr = new FileReader();
  fr.onload = () => resolve(String(fr.result).split(",")[1] || "");
  fr.onerror = () => reject(fr.error);
  fr.readAsDataURL(blob);
});

/** ไฟล์ JSON เดียวที่รวมเสียงอัดทั้งหมด (base64) — แยกจาก Export ข้อมูลหลัก */
export async function exportAllJson() {
  const list = await allRecordings();
  const recordings = [];
  for (const r of list) recordings.push({ id: r.id, clipId: r.clipId, sentenceIndex: r.sentenceIndex, mime: r.mime, durationSec: r.durationSec, at: r.at, base64: await toBase64(r.blob) });
  return new Blob([JSON.stringify({ app: "engpath-audio", version: 1, exportedAt: Date.now(), recordings })], { type: "application/json" });
}

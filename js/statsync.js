// ดูแล dailyStats ให้ตรงกับ events เสมอ: คำนวณใหม่จาก events (stats.js) แล้วเขียนเฉพาะวันที่ต่างจากที่เก็บไว้
// - ไม่แก้ด้วยมือ ไม่บวกเพิ่ม: ค่าเป็นฟังก์ชันของชุด events เท่านั้น สองเครื่องจึงลู่เข้าค่าเดียวกันหลังซิงก์
// - ครั้งแรกที่ไม่มี dailyStats (หรือสูตรเวอร์ชันเก่า) จะสร้างย้อนหลังจาก events เดิมอัตโนมัติ
import * as db from "./db.js";
import { computeAll, diffStats } from "./stats.js";

const DEBOUNCE_MS = 2000;
const MIN_GAP_MS = 15000;          // คำนวณทั้งชุดอย่างมากทุก 15 วินาทีขณะใช้งาน (เครื่องรุ่นกลางที่ events เยอะไม่กระตุก) — ปิดแอป/ซ่อนแท็บจะสั่งรอบสุดท้ายทันที
const SIG_COLS = ["sessions", "reviews", "cards", "errors", "errorEvents", "practiceEvents", "shadowingEvents", "handwritingAttempts", "readings", "journal", "interleavingSessions", "dailyStats"];
let timer = null, started = false, lastSig = "", busy = false, disabled = false, lastWriteAt = 0, lastRunAt = 0;

const signature = () => SIG_COLS.map((c) => { const l = db.all(c); let m = 0; for (const d of l) { const t = d.updatedAt || d.createdAt || 0; if (t > m) m = t; } return `${l.length}:${m}`; }).join("|");

function inputs() {
  return {
    sessions: db.list("sessions"), reviews: db.list("reviews"), cards: db.all("cards"), errors: db.all("errors"), errorEvents: db.list("errorEvents"),
    practiceEvents: db.list("practiceEvents"), shadowingEvents: db.list("shadowingEvents"), handwritingAttempts: db.list("handwritingAttempts"),
    readings: db.list("readings"), journal: db.all("journal"), interleavingSessions: db.list("interleavingSessions"),
  };
}

/** คำนวณแล้วเขียนเฉพาะที่ต่าง; removeStale = soft delete วันที่ไม่มี event รองรับแล้ว (ใช้กับปุ่ม “คำนวณใหม่ทั้งหมด”) */
export function sync({ removeStale = false } = {}) {
  if (!db.isReady() || busy || disabled) return { written: 0, removed: 0, days: 0 };
  busy = true;
  try {
    const computed = computeAll(inputs());
    const existing = db.all("dailyStats");
    const todo = diffStats(computed, existing);
    const now = Date.now();
    if (todo.length) lastWriteAt = now;
    for (const { id, doc, existing: old } of todo) {
      const data = { ...doc, computedAt: now, deleted: false };
      if (old) db.update("dailyStats", id, data); else db.create("dailyStats", data);
    }
    let removed = 0;
    if (removeStale) for (const d of existing) if (!d.deleted && !computed.has(d.id)) { db.softDelete("dailyStats", d.id); removed++; }
    lastSig = signature();
    lastRunAt = Date.now();
    return { written: todo.length, removed, days: computed.size };
  } finally { busy = false; }
}

function schedule(delay = DEBOUNCE_MS, urgent = false) {
  clearTimeout(timer);
  const wait = urgent ? 0 : Math.max(delay, lastRunAt + MIN_GAP_MS - Date.now());
  timer = setTimeout(() => { if (db.isReady() && signature() !== lastSig) sync(); }, wait);
}

export function startStatsSync() {
  if (started) return;
  started = true;
  db.subscribe(() => schedule());
  // ยังไม่ได้ publish firestore.rules ล่าสุด → เขียน dailyStats ไม่ได้: หยุดลองซ้ำในรอบนี้ (ไม่วนเขียนซ้ำ) รีเฟรชหลัง publish แล้วจะทำงานเอง
  db.onError((e) => { if (e?.code === "permission-denied" && Date.now() - lastWriteAt < 15000) disabled = true; });
  document.addEventListener("visibilitychange", () => { if (document.visibilityState === "hidden") schedule(0, true); });
  schedule(500);
}

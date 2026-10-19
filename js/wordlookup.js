// หาข้อมูลคำแบบใช้ซ้ำข้ามหน้า (ลำดับเดียวกับหน้า "เพิ่มคำ"): Firestore cache ในเครื่อง → server → API (เฉพาะคำที่ไม่เคยมี)
// ผ่าน js/db.js เท่านั้น — ไม่ทับคำแปลที่ผู้ใช้แก้เอง (mergeLexicon ดูแล userEdited)
import * as db from "./db.js";
import * as lx from "./lexicon.js";
import { lexiconConfig } from "./localsettings.js";

/** คืน { lex, from: cache | server | api | offline | failed } — lex เป็น null ถ้าไม่ได้ข้อมูล */
export async function lookupWord(word) {
  const key = lx.wordKey(word);
  const found = await db.lexiconGet(key);
  if (found.doc) return { lex: found.doc, from: found.from };
  if (!navigator.onLine) return { lex: null, from: "offline" };
  const results = await lx.fetchAll(key, { email: lexiconConfig().email });
  if (!Object.values(results).some((r) => r.ok)) return { lex: null, from: "failed", results };
  const lex = db.lexiconPut(key, lx.mergeLexicon(null, results, { word: key, now: Date.now() }), null);
  return { lex, from: "api", results };
}

/** ทำงานพร้อมกันไม่เกิน limit งาน (ไม่ยิง API รัว) — onProgress(done, total) */
export async function mapLimit(items, limit, fn, onProgress) {
  const out = new Array(items.length);
  let next = 0, done = 0;
  const worker = async () => {
    while (next < items.length) {
      const i = next++;
      try { out[i] = await fn(items[i], i); } catch (e) { out[i] = { error: e.message || String(e) }; }
      onProgress?.(++done, items.length);
    }
  };
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

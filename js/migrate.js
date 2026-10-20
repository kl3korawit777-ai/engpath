// ย้ายบัตรคำเดิม (เพิ่มเอง/จาก API) เข้าระบบคลังกลาง — pure ไม่แตะ DB/DOM ทดสอบด้วย node ได้
//
// หลักการ: reviews เป็น event ต่อท้ายอย่างเดียว จึง "ไม่แก้" cardId ของประวัติเดิม
//   • บัตรคลังที่ได้จากการย้าย (id = wordKey) เก็บ legacyIds = [id บัตรเดิม...]
//   • ชั้นอ่านของ db.js แปลง cardId ของ reviews เดิม → id บัตรคลัง (aliasMap) จึงได้สถานะ SRS ต่อเนื่องโดยไม่เขียนทับ event
//   • บัตรเดิมถูก soft delete (ไม่ลบจริง) → ย้อนกลับได้ด้วย planUndo
// บัตรที่ไม่ตรงกับคำใดในคลัง (เช่น วลี) ไม่ถูกแตะ — ยังใช้งานเป็นบัตรเดิมต่อไป

import { wordKey } from "./vocab.js";

export const isLegacyCard = (c) => !c.wordKey && typeof c.en === "string";
export const isLibraryCard = (c) => Boolean(c.wordKey) && c.source === "library";

/** legacyId → id ของบัตรคลัง (เฉพาะบัตรคลังที่ยังไม่ถูกลบ) */
export function buildAliases(rawCards) {
  const m = new Map();
  for (const c of rawCards) {
    if (c.deleted || !isLibraryCard(c) || !Array.isArray(c.legacyIds)) continue;
    for (const id of c.legacyIds) m.set(id, c.id);
  }
  return m;
}

/** reviews ที่ cardId เป็นบัตรเดิมที่ย้ายแล้ว → ชี้ไปบัตรคลัง (คืนอ็อบเจ็กต์เดิมถ้าไม่ต้องแปลง) */
export function remapReview(r, aliases) {
  const to = aliases.get(r.cardId);
  return to ? { ...r, cardId: to } : r;
}

/**
 * วางแผนการย้าย (dry-run — ไม่เขียนอะไร)
 * rawCards: เอกสาร cards ดิบทั้งหมด (รวมที่ลบ/ข้าม) · peek(key) → entry ของคลัง | null
 * คืน {
 *   create: [{ wordKey, entry, legacy:[card], legacyIds, addedDay }]   — สร้างบัตรคลังใหม่
 *   update: [{ wordKey, entry, legacy:[card], existing, legacyIds }]  — มีบัตรคลังคำนี้อยู่แล้ว: รวม legacyIds (และดึงจาก “รู้แล้ว” กลับมาเรียน)
 *   unmatched: [card]   — ไม่อยู่ในคลัง คงเป็นบัตรเดิม
 * }
 */
export function planMigration(rawCards, peek, dayOf = (ts) => new Date(ts).toISOString().slice(0, 10)) {
  const live = rawCards.filter((c) => !c.deleted);
  const legacy = live.filter(isLegacyCard);
  const byWord = new Map(rawCards.filter(isLibraryCard).map((c) => [c.wordKey, c]));       // รวมที่ถูกลบ (id เดียวกัน เขียนทับได้)
  const groups = new Map();
  const unmatched = [];
  for (const c of legacy) {
    const key = wordKey(c.en);
    const entry = key ? peek(key) : null;
    if (!entry || entry.wordKey !== key) { unmatched.push(c); continue; }                  // จับคู่เฉพาะตรงตัว (ไม่เดาจากรูปผัน)
    if (!groups.has(key)) groups.set(key, { wordKey: key, entry, legacy: [] });
    groups.get(key).legacy.push(c);
  }
  const create = [], update = [];
  for (const g of groups.values()) {
    const legacyIds = g.legacy.map((c) => c.id).sort();
    const existing = byWord.get(g.wordKey);
    if (existing && !existing.deleted) update.push({ ...g, existing, legacyIds: [...new Set([...(existing.legacyIds || []), ...legacyIds])] });
    else create.push({ ...g, legacyIds, addedDay: dayOf(Math.min(...g.legacy.map((c) => c.createdAt || Date.now()))) });
  }
  const byRank = (a, b) => a.entry.rank - b.entry.rank;
  return { create: create.sort(byRank), update: update.sort(byRank), unmatched: unmatched.sort((a, b) => a.en.localeCompare(b.en)) };
}

/** สรุปจำนวนสำหรับแสดงผล */
export function summarize(plan) {
  const legacy = plan.create.reduce((n, g) => n + g.legacy.length, 0) + plan.update.reduce((n, g) => n + g.legacy.length, 0);
  return { words: plan.create.length + plan.update.length, legacyCards: legacy, creates: plan.create.length, updates: plan.update.length, unmatched: plan.unmatched.length };
}

/**
 * แปลงแผนเป็นคำสั่งเขียน (ลำดับ: เขียนบัตรคลังก่อน แล้วค่อย soft delete บัตรเดิม — ถ้าขัดจังหวะกลางทางไม่มีประวัติหาย)
 * [{ op:"create", fields }, { op:"update", id, patch }, { op:"softDelete", id }]
 */
export function toOps(plan) {
  const ops = [];
  for (const g of plan.create) {
    ops.push({ op: "create", fields: { id: g.wordKey, wordKey: g.wordKey, source: "library", level: g.entry.level, rank: g.entry.rank, status: "learning", addedDay: g.addedDay, legacyIds: g.legacyIds, migrated: true } });
  }
  for (const g of plan.update) {
    ops.push({ op: "update", id: g.wordKey, patch: { legacyIds: g.legacyIds, status: "learning", deleted: false } });
  }
  for (const g of [...plan.create, ...plan.update]) for (const c of g.legacy) ops.push({ op: "softDelete", id: c.id });
  return ops;
}

/**
 * ย้อนกลับ: บัตรเดิมที่ถูกย้ายกลับมาใช้งาน · บัตรคลังที่ “สร้างจากการย้าย” ถูก soft delete · บัตรคลังที่มีอยู่ก่อนแล้ว (รวมประวัติ) แค่ถอด legacyIds
 * ข้อควรรู้: การทบทวนที่ทำหลังย้าย (cardId = wordKey) จะไม่ย้อนไปอยู่กับบัตรเดิม
 */
export function planUndo(rawCards) {
  const byId = new Map(rawCards.map((c) => [c.id, c]));
  const ops = [];
  for (const lib of rawCards.filter((c) => isLibraryCard(c) && !c.deleted && Array.isArray(c.legacyIds) && c.legacyIds.length)) {
    for (const id of lib.legacyIds) if (byId.get(id)?.deleted) ops.push({ op: "restore", id });
    if (lib.migrated) ops.push({ op: "softDelete", id: lib.id });
    else ops.push({ op: "update", id: lib.id, patch: { legacyIds: [] } });
  }
  return ops;
}

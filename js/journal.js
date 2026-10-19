// Journal + ตรวจบันทึก (AI หรือตรวจเอง) แบบ pure — ไม่แตะ DB/DOM
import { CATEGORIES } from "./errlog.js";
import { splitSentences } from "./clips.js";
import { tokenize } from "./reading.js";
import { normalize } from "./srs.js";
import { ApiError, claudeText } from "./lexicon.js";

export const GOAL = { min: 5, max: 10 };          // เป้า 5–10 ประโยคต่อวัน
export const MAX_ITEMS = 30;

export const GOAL_TEXT = {
  below: (n) => `ยังไม่ถึงเป้า (${n}/${GOAL.min} ประโยคขั้นต่ำ)`,
  in: () => "ตามเป้าแล้ว ✓",
  above: (n) => `เกินเป้า (${n} ประโยค — เยี่ยม แต่ถ้าเหนื่อยพอที่ ${GOAL.max} ก็ได้)`,
};

/** เช็กลิสต์ตรวจเอง (ไม่ใช้ AI) — ผูกกับหมวดของ Error Log */
export const SELF_CHECKLIST = [
  { key: "tense", label: "Tense", category: "Tense", question: "กริยาตรงกับเวลาที่เล่าไหม (อดีต/ปัจจุบัน/อนาคต)? ไล่ดูกริยาทีละตัว เช่น yesterday ต้องใช้รูปอดีต" },
  { key: "article", label: "Article (a / an / the)", category: "Article", question: "นามนับได้เอกพจน์มี a/an/the ไหม? ใช้ an กับเสียงสระ (an apple) และ the กับสิ่งที่ระบุชัด" },
  { key: "preposition", label: "Preposition", category: "Preposition", question: "บุพบทตรงกับคำที่มักมาด้วยไหม เช่น depend on, interested in, arrive at/in, at 5 pm, on Monday, in May" },
  { key: "spelling", label: "การสะกด", category: "การสะกด", question: "อ่านทวนทีละคำ คำที่ไม่แน่ใจเช็กพจนานุกรม (receive, definitely, separate, tomorrow)" },
];

// ---------- นับ ----------
export function countText(text) {
  return { words: tokenize(text).length, sentences: splitSentences(text).length };
}
export const goalStatus = (sentences) => (sentences < GOAL.min ? "below" : sentences > GOAL.max ? "above" : "in");

// ---------- ค้นหาข้อความต้นฉบับในบันทึก (ยอมให้ช่องว่าง/ขึ้นบรรทัดต่างกัน) ----------
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export function locate(text, original, from = 0) {
  const parts = String(original).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return null;
  const re = new RegExp(parts.map(esc).join("\\s+"), "g");
  re.lastIndex = from;
  const m = re.exec(text);
  return m ? { start: m.index, end: m.index + m[0].length } : null;
}

/** วางแต่ละข้อลงตำแหน่งแรกที่ยังไม่ซ้อนกัน คืน { placed: [{ item, start, end }] เรียงตามตำแหน่ง, skipped } */
export function planEdits(text, items) {
  const used = [], placed = [], skipped = [];
  for (const item of items) {
    let from = 0, pos = null;
    for (;;) {
      const r = locate(text, item.original, from);
      if (!r) break;
      if (!used.some((u) => r.start < u.end && r.end > u.start)) { pos = r; break; }
      from = r.start + 1;
    }
    if (pos) { used.push(pos); placed.push({ item, ...pos }); } else skipped.push(item);
  }
  placed.sort((a, b) => a.start - b.start);
  return { placed, skipped };
}

export function applyEdits(text, placed) {
  let out = "", pos = 0;
  for (const p of placed) { out += text.slice(pos, p.start) + p.item.corrected; pos = p.end; }
  return out + text.slice(pos);
}

/** ชิ้นส่วนสำหรับแสดงเทียบข้างกัน: { original: [{ text, changed, item? }], corrected: [...] } */
export function sideBySide(text, placed) {
  const original = [], corrected = [];
  let pos = 0;
  const push = (arr, t, changed, item) => { if (t) arr.push(changed ? { text: t, changed: true, item } : { text: t, changed: false }); };
  for (const p of placed) {
    const gap = text.slice(pos, p.start);
    push(original, gap, false); push(corrected, gap, false);
    push(original, text.slice(p.start, p.end), true, p.item); push(corrected, p.item.corrected, true, p.item);
    pos = p.end;
  }
  const tail = text.slice(pos);
  push(original, tail, false); push(corrected, tail, false);
  return { original, corrected };
}

// ---------- AI ----------
const bad = (detail) => new ApiError("ai", "parse", { detail });

export function aiPrompt(text) {
  return [
    "You are an English teacher reviewing a short diary entry written by a Thai learner.",
    "Find only REAL mistakes (grammar, tense, article, preposition, word choice, spelling). Do NOT rewrite style, do NOT change wording that is already correct, and do NOT make the text more fluent or formal.",
    `Reply with ONLY a JSON array (no markdown, no commentary). Each item: {"original": "...", "corrected": "...", "category": "...", "explanation_th": "..."}.`,
    `- "original": copy the smallest span of the diary exactly as written (same spelling/punctuation) that contains the mistake.`,
    `- "corrected": the minimal fix for that span only.`,
    `- "category": exactly one of: ${CATEGORIES.map((c) => `"${c}"`).join(", ")}.`,
    `- "explanation_th": a short explanation in Thai (at most 2 sentences) of the rule.`,
    "If there are no mistakes, reply with [].",
    "",
    "Diary entry:",
    text,
  ].join("\n");
}

/**
 * ตรวจโครงสร้างผลจาก AI อย่างเข้ม: ต้องเป็นอาร์เรย์ของ { original, corrected, category, explanation_th } ทุกข้อ
 * category ต้องอยู่ในหมวด Error Log, original ต้องมีอยู่ในบันทึกจริง, corrected ต้องต่างจาก original
 * ข้อใดข้อหนึ่งไม่ผ่าน = โยน ApiError ทั้งชุด (ไม่เดา/ไม่เติม/ไม่เก็บบางส่วน) คืนอาร์เรย์ว่างได้ (ไม่พบข้อผิด)
 */
export function parseAiReview(reply, text) {
  const a = String(reply).indexOf("["), b = String(reply).lastIndexOf("]");
  if (a < 0 || b <= a) throw bad("ไม่พบรายการ JSON (ต้องเป็นอาร์เรย์)");
  let arr;
  try { arr = JSON.parse(reply.slice(a, b + 1)); } catch { throw bad("อ่าน JSON ไม่ได้"); }
  if (!Array.isArray(arr)) throw bad("ผลไม่ใช่อาร์เรย์");
  if (arr.length > MAX_ITEMS) throw bad(`มีรายการเกิน ${MAX_ITEMS} ข้อ`);
  return arr.map((x, i) => {
    const n = i + 1;
    if (!x || typeof x !== "object" || Array.isArray(x)) throw bad(`ข้อที่ ${n}: ไม่ใช่ออบเจ็กต์`);
    for (const k of ["original", "corrected", "category", "explanation_th"]) {
      if (typeof x[k] !== "string" || !x[k].trim()) throw bad(`ข้อที่ ${n}: ฟิลด์ ${k} ว่างหรือผิดชนิด`);
    }
    if (!CATEGORIES.includes(x.category)) throw bad(`ข้อที่ ${n}: category “${x.category}” ไม่อยู่ในหมวดของ Error Log`);
    const original = x.original.trim(), corrected = x.corrected.trim();
    if (original === corrected) throw bad(`ข้อที่ ${n}: corrected เหมือน original (ไม่ใช่ข้อผิด)`);
    if (!locate(text, original)) throw bad(`ข้อที่ ${n}: ไม่พบ “${original}” ในบันทึก`);
    if (x.explanation_th.length > 400) throw bad(`ข้อที่ ${n}: คำอธิบายยาวเกินไป`);
    return { original, corrected, category: x.category, explanation_th: x.explanation_th.trim() };
  });
}

export async function reviewWithAi(text, opts) {
  return parseAiReview(await claudeText(aiPrompt(text), opts), text);
}

// ---------- ตรวจเอง ----------
/** สร้างข้อผิดที่ผู้ใช้จดเอง: { item } หรือ { error } (ข้อความไทย) */
export function makeSelfItem({ original, corrected, category, note = "" }, text) {
  const o = String(original || "").trim(), c = String(corrected || "").trim();
  if (!o) return { error: "ใส่ข้อความที่ผิด" };
  if (!c) return { error: "ใส่แบบที่ถูก" };
  if (o === c) return { error: "แบบที่ถูกต้องต่างจากแบบที่ผิด" };
  if (!CATEGORIES.includes(category)) return { error: "เลือกหมวด" };
  if (!locate(text, o)) return { error: "ข้อความที่ผิดต้องตรงกับที่เขียนไว้ในบันทึก (ลากคลุมในช่องเขียนแล้วกด “ใช้ข้อความที่เลือก” ได้)" };
  return { item: { original: o, corrected: c, category, explanation_th: String(note).trim().slice(0, 400) } };
}

// ---------- ส่งเข้า Error Log / บัตรคำ ----------
/** error เดิมที่ wrong/right ตรงกัน (ไม่สนตัวพิมพ์/เครื่องหมาย) และไม่ถูกลบ — เจอ = เพิ่ม errorEvent นับซ้ำ ไม่เจอ = สร้างใหม่ */
export function findExistingError(errors, wrong, right) {
  const w = normalize(wrong), r = normalize(right);
  return errors.find((e) => !e.deleted && normalize(e.wrong) === w && normalize(e.right) === r) || null;
}

export function errorPayload(item) {
  return { wrong: item.original, right: item.corrected, category: item.category, note: item.explanation_th || "" };
}

/** ประโยคในบันทึกฉบับแก้ที่มีส่วนที่แก้อยู่ (ใช้เป็นประโยคตัวอย่างของบัตรคำ) */
export function sentenceWith(correctedText, fragment) {
  const f = String(fragment).replace(/\s+/g, " ").trim().toLowerCase();
  return splitSentences(correctedText).find((s) => s.replace(/\s+/g, " ").toLowerCase().includes(f)) || null;
}

// ---------- ตรวจรูปแบบเอกสาร (ใช้กับ Import) ----------
export function isValidReview(r) {
  if (!r || typeof r !== "object" || !["ai", "self"].includes(r.source) || typeof r.at !== "number") return false;
  const ok = (i) => i && ["original", "corrected", "category", "explanation_th"].every((k) => typeof i[k] === "string") && CATEGORIES.includes(i.category)
    && i.original.length <= 2000 && i.corrected.length <= 2000;
  return Array.isArray(r.items) && r.items.length <= MAX_ITEMS && r.items.every(ok);
}

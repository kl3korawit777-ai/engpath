// ลิงก์ [[ ]] แบบ Obsidian + Backlinks — pure logic ไม่แตะ DB/DOM
// รูปแบบ: [[wordKey]] และ [[wordKey|ข้อความที่แสดง]] · อ้างอิงด้วย wordKey เสมอ ไม่ใช่ข้อความที่แสดง
// ลิงก์ซ้อน [[a [[b]] c]] นับเฉพาะชั้นใน ([[b]]) เพราะวงเล็บชั้นนอกมี [ ] อยู่ข้างใน
import { wordKey, isValidWord } from "./lexicon.js";

export const NOTE_MAX = 20000;
export const MAX_OCCURRENCES = 100;       // จำนวนลิงก์ต่อโน้ตที่เก็บในดัชนี
const LINE_MAX = 200;

const RE = /\[\[([^\[\]\n|]+)(?:\|([^\[\]\n]*))?\]\]/g;

/** ลิงก์ทั้งหมดในข้อความ: [{ key, alias, start, end, line (เริ่มที่ 1), lineText }]; เป้าหมายที่ไม่ใช่คำ/วลีที่ถูกต้องจะข้าม */
export function parseLinks(text) {
  const src = String(text ?? "");
  const out = [];
  const lineStarts = [0];
  for (let i = 0; i < src.length; i++) if (src[i] === "\n") lineStarts.push(i + 1);
  RE.lastIndex = 0;
  let m;
  while ((m = RE.exec(src))) {
    const key = wordKey(m[1]);
    if (!isValidWord(key)) continue;
    let line = lineStarts.length;
    while (lineStarts[line - 1] > m.index) line--;
    const s = lineStarts[line - 1];
    const e = src.indexOf("\n", s);
    const alias = (m[2] ?? "").trim();
    out.push({ key, target: m[1].trim(), alias: alias || null, start: m.index, end: m.index + m[0].length, line, lineText: src.slice(s, e < 0 ? src.length : e).trim().slice(0, LINE_MAX) });
  }
  return out;
}

/** เอกสารในดัชนี links/{from}: เก็บโน้ตและลิงก์ออก (ซ้ำคำ+บรรทัดเดียวกันนับครั้งเดียว) */
export function buildLinkDoc(from, notes) {
  const text = String(notes ?? "").slice(0, NOTE_MAX);
  const seen = new Set(), to = [];
  for (const l of parseLinks(text)) {
    const id = `${l.key}\u0000${l.line}`;
    if (seen.has(id)) continue;
    seen.add(id);
    to.push({ key: l.key, alias: l.alias, line: l.lineText });
    if (to.length >= MAX_OCCURRENCES) break;
  }
  return { from, notes: text, to };
}

/** คำที่ลิงก์มาหา target: [{ from, lines: [บรรทัดที่อ้างถึง ไม่ซ้ำ] }] เรียงตามชื่อ (ไม่นับลิงก์หาตัวเอง/doc ที่ถูกลบ) */
export function backlinks(linkDocs, target) {
  const t = wordKey(target);
  const out = [];
  for (const d of linkDocs) {
    if (d.deleted || d.from === t || !Array.isArray(d.to)) continue;
    const lines = [...new Set(d.to.filter((x) => x.key === t).map((x) => x.line))];
    if (lines.length) out.push({ from: d.from, lines });
  }
  return out.sort((a, b) => a.from.localeCompare(b.from));
}

/** คำที่คำนี้ลิงก์ออกไป (ไม่ซ้ำ) */
export function outgoing(linkDoc) {
  return [...new Set((linkDoc?.to || []).map((x) => x.key))];
}

/** ชิ้นส่วนสำหรับแสดงโน้ต: [{ type:"text", text } | { type:"link", key, label, exists }] */
export function segments(text, exists) {
  const src = String(text ?? "");
  const out = [];
  let pos = 0;
  for (const l of parseLinks(src)) {
    if (l.start > pos) out.push({ type: "text", text: src.slice(pos, l.start) });
    out.push({ type: "link", key: l.key, label: l.alias || l.key, exists: Boolean(exists(l.key)) });
    pos = l.end;
  }
  if (pos < src.length) out.push({ type: "text", text: src.slice(pos) });
  return out;
}

// ---------- autocomplete ตอนพิมพ์ [[ ----------
/** ถ้าเคอร์เซอร์อยู่ในลิงก์ที่ยังพิมพ์ไม่จบ คืน { start, query } (start = ตำแหน่งหลัง "[[") ไม่งั้น null */
export function openLink(text, caret) {
  const before = String(text ?? "").slice(0, caret);
  const i = before.lastIndexOf("[[");
  if (i < 0) return null;
  const q = before.slice(i + 2);
  if (/[\n\[\]|]/.test(q)) return null;      // ขึ้นบรรทัดใหม่ / ปิดแล้ว / กำลังพิมพ์ alias
  return { start: i + 2, query: q };
}

/** เติมคำที่เลือกลงในลิงก์ที่เปิดอยู่ คืน { text, caret } (เคอร์เซอร์อยู่หลัง ]]) — คง alias เดิมถ้ามี */
export function applySuggestion(text, caret, key) {
  const open = openLink(text, caret);
  if (!open) return { text, caret };
  const after = text.slice(caret);
  const m = after.match(/^([^\[\]\n|]*)(\|[^\[\]\n]*)?\]\]/);
  if (m) {
    const head = text.slice(0, open.start) + key + (m[2] || "") + "]]";
    return { text: head + after.slice(m[0].length), caret: head.length };
  }
  const head = text.slice(0, open.start) + key + "]]";
  return { text: head + after, caret: head.length };
}

/** รายการแนะนำ: ขึ้นต้นด้วยคำค้นก่อน แล้วค่อยมีคำค้นอยู่ตรงกลาง เรียงตัวอักษร จำกัดจำนวน */
export function suggest(query, keys, limit = 8) {
  const q = wordKey(query);
  const all = [...new Set(keys)].sort((a, b) => a.localeCompare(b));
  if (!q) return all.slice(0, limit);
  return [...all.filter((k) => k.startsWith(q)), ...all.filter((k) => !k.startsWith(q) && k.includes(q))].slice(0, limit);
}

// ---------- ตรวจรูปแบบเอกสาร (ใช้กับ Import) ----------
export function isValidLinkDoc(d) {
  return d && typeof d.from === "string" && d.from === d.id && d.from === wordKey(d.from) && typeof d.notes === "string" && d.notes.length <= NOTE_MAX
    && Array.isArray(d.to) && d.to.length <= MAX_OCCURRENCES
    && d.to.every((x) => x && typeof x.key === "string" && x.key && typeof x.line === "string" && (x.alias === null || typeof x.alias === "string"));
}

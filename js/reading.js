// ตัวเช็ก i+1 แบบ pure: แยกคำ, จับรูปผันคำแบบง่าย, สถานะคำจากบัตรคำ, นับ % คำที่ไม่รู้, คำตัดสิน
import { READING } from "./data/reading-config.js";
import { memoryStatus } from "./library.js";
import { splitSentences } from "./clips.js";

// ---------- แยกคำ ----------
const WORD_RE = /\p{L}+(?:['’]\p{L}+)*(?:-\p{L}+)*/gu;

/** [{ surface, key, start, end }] — key = ตัวพิมพ์เล็ก ใช้ ' ตรง (ตัวเลข/เครื่องหมายไม่นับเป็นคำ) */
export function tokenize(text) {
  const out = [];
  for (const m of String(text ?? "").matchAll(WORD_RE)) {
    out.push({ surface: m[0], key: m[0].toLowerCase().replace(/’/g, "'"), start: m.index, end: m.index + m[0].length });
  }
  return out;
}

/** รูปที่เป็นไปได้ของคำ (ตัดท้ายแบบง่าย: 's, s/es/ies, ed/ied, ing, ly + ตัวสะกดซ้ำ) — ใช้จับว่า running ≈ run */
export function stems(word) {
  const w = String(word).toLowerCase().replace(/’/g, "'");
  const out = new Set([w]);
  const add = (s) => { if (s.length >= 3) out.add(s); };
  const b = w.replace(/'s$/, "").replace(/s'$/, "s");
  add(b);
  if (/ies$/.test(b)) add(`${b.slice(0, -3)}y`);
  if (/(ches|shes|sses|xes|zes|oes)$/.test(b)) add(b.slice(0, -2));
  if (/[^s]s$/.test(b)) add(b.slice(0, -1));
  if (/ied$/.test(b)) add(`${b.slice(0, -3)}y`);
  if (/ed$/.test(b)) { const x = b.slice(0, -2); add(x); add(b.slice(0, -1)); if (/(.)\1$/.test(x)) add(x.slice(0, -1)); }
  if (/ing$/.test(b)) { const x = b.slice(0, -3); add(x); add(`${x}e`); if (/(.)\1$/.test(x)) add(x.slice(0, -1)); }
  if (/ly$/.test(b)) add(b.slice(0, -2));
  return out;
}

// ---------- สถานะคำจากบัตรคำ ----------
const RANK = { known: 3, learning: 2, new: 1 };

/**
 * ดัชนี stem → สถานะ (known | learning | new) จากบัตรคำ "คำเดี่ยว" เท่านั้น (วลีหลายคำไม่กระทบสถานะคำเดี่ยว)
 * ถ้าคำเดียวกันมีหลายบัตร ใช้สถานะที่ดีที่สุด (known > learning > new)
 */
export function cardWordIndex(cards, states) {
  const idx = new Map();
  for (const c of cards) {
    const en = String(c.en || "").trim().toLowerCase();
    if (!en || /\s/.test(en)) continue;
    const st = memoryStatus(states.get(c.id));
    for (const s of stems(en)) if (!idx.has(s) || RANK[st] > RANK[idx.get(s)]) idx.set(s, st);
  }
  return idx;
}

export function statusOfWord(key, index) {
  let best = null;
  for (const s of stems(key)) { const st = index.get(s); if (st && (!best || RANK[st] > RANK[best])) best = st; }
  return best;
}

// ---------- จัดประเภท + สถิติ ----------
/**
 * สถานะของแต่ละคำที่ปรากฏ:
 *   known-card    อยู่ในบัตรสถานะ "จำได้" → รู้อัตโนมัติ (แตะไม่เปลี่ยน)
 *   learning-card อยู่ในบัตร "ใหม่/กำลังเรียน" → นับเป็นไม่รู้ (แตะเพื่อบอกว่ารู้แล้วได้ = userKnown)
 *   user-unknown  ผู้ใช้แตะว่าไม่รู้
 *   plain         ไม่มีข้อมูล → ถือว่ารู้ (ค่าเริ่มต้น)
 * userUnknown / userKnown เป็น Set ของ key
 */
export function classify(tokens, index, { userUnknown = new Set(), userKnown = new Set() } = {}) {
  return tokens.map((t) => {
    const card = statusOfWord(t.key, index);
    let status, unknown;
    if (card === "known") { status = "known-card"; unknown = false; }
    else if (card && !userKnown.has(t.key)) { status = "learning-card"; unknown = true; }
    else if (userUnknown.has(t.key)) { status = "user-unknown"; unknown = true; }
    else { status = "plain"; unknown = false; }
    return { ...t, status, unknown };
  });
}

export function verdictOf(pct, cfg = READING) {
  return pct < cfg.easyBelow ? "easy" : pct <= cfg.fitUpTo ? "fit" : "hard";
}

/** { total, unknownCount, unknownPct, verdict, unique: [{ key, surface, count, status }] เรียงตามจำนวนครั้ง } */
export function stats(classified, cfg = READING) {
  const total = classified.length;
  const unknownTokens = classified.filter((t) => t.unknown);
  const map = new Map();
  for (const t of unknownTokens) {
    const e = map.get(t.key) || { key: t.key, surface: t.surface, count: 0, status: t.status };
    e.count++;
    map.set(t.key, e);
  }
  const unknownPct = total ? (unknownTokens.length / total) * 100 : 0;
  return {
    total, unknownCount: unknownTokens.length, unknownPct, verdict: total ? verdictOf(unknownPct, cfg) : null,
    unique: [...map.values()].sort((a, b) => b.count - a.count || a.key.localeCompare(b.key)),
  };
}

// ---------- ประโยคต้นฉบับ ----------
/** ประโยคแรกในข้อความที่มีคำนี้ (ทั้งคำ) — สั้นกว่า minWords คำ ต่อประโยคถัดไปให้ (ตัวอย่างบัตรคำต้อง ≥ 4 คำ) */
export function sentenceFor(text, key, minWords = 4) {
  const sents = splitSentences(text);
  const re = new RegExp(`(?<![\\p{L}'’-])${key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/'/g, "['’]")}(?![\\p{L}'’-])`, "iu");
  const i = sents.findIndex((s) => re.test(s));
  if (i < 0) return null;
  let s = sents[i];
  const count = (x) => tokenize(x).length;
  if (count(s) < minWords && sents[i + 1]) s = `${s} ${sents[i + 1]}`;
  if (count(s) < minWords && i > 0) s = `${sents[i - 1]} ${s}`;
  return s;
}

// ---------- reading log ----------
/** เอกสาร readings (ต่อท้ายอย่างเดียว) — ไม่เก็บตัวข้อความที่วาง เก็บแค่สถิติ */
export function buildReadingLog({ source, level, st, durationSec, now }, cfg = READING) {
  return {
    at: now, source: String(source || "").trim().slice(0, 200), level: level || "",
    totalWords: st.total, unknownCount: st.unknownCount, unknownPct: Math.round(st.unknownPct * 10) / 10,
    unknownWords: st.unique.slice(0, cfg.maxLogWords).map((u) => u.key), durationSec: Math.max(0, Math.round(durationSec)),
  };
}

// ---------- สร้างบัตรคำจากคำที่ไม่รู้ ----------
import { validateCard } from "./srs.js";
import { thDisplay, suggestPos } from "./lexicon.js";

/** ใช้ข้อมูลใน lexicon + ประโยคต้นฉบับเป็นตัวอย่าง คืน { card } หรือ { error } (ภาษาไทย) — กฎ Chunking: ตัวอย่างต้อง ≥ 4 คำ */
export function buildCard({ word, lex, sentence }) {
  if (!lex) return { error: "ดึงข้อมูลคำไม่ได้" };
  const th = thDisplay(lex.th);
  if (!th) return { error: "ไม่มีคำแปล — เพิ่มเองที่ “บัตรคำ → เพิ่มคำ”" };
  if (!sentence) return { error: "ไม่พบประโยคต้นฉบับในข้อความ" };
  const card = { en: word, th, example: sentence, ipa: lex.ipa || "", tags: [], pos: suggestPos({ ...lex, word }) || null, freq: lex.freq ?? null, source: "reading" };
  const err = validateCard(card);
  return err ? { error: err } : { card };
}

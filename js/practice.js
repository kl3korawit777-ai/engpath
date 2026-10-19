// Deliberate Practice แบบ pure: จุดเน้นสัปดาห์, สร้างแบบฝึกในเครื่อง (ไม่ใช้ AI), เสนอ "แก้ได้แล้ว", โจทย์จาก AI (ไม่บังคับ)
import { normalize } from "./srs.js";
import { errorStats } from "./errlog.js";
import { dayKey } from "./streak.js";
import { claudeText, ApiError } from "./lexicon.js";

const DAY = 86400000;
export const FOCUS_LIMIT = 2;
export const FOCUS_DAYS = 30;
export const RESOLVE_STREAK_DAYS = 3;
export const DRILL_TYPES = ["choose", "recall", "cloze"];

// ---------- จุดเน้นสัปดาห์ ----------
/** วันจันทร์ของสัปดาห์ (เวลาท้องถิ่น) เป็น "YYYY-MM-DD" — จุดเน้นที่ผู้ใช้เลือกเองมีผลถึงสิ้นสัปดาห์นี้ */
export function weekKey(now) {
  const d = new Date(now);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return dayKey(d.getTime());
}

function recentCounts(events, now) {
  const m = new Map();
  for (const ev of events) {
    if (ev.type === "occurred" && ev.at > now - FOCUS_DAYS * DAY && ev.at <= now) m.set(ev.errorId, (m.get(ev.errorId) || 0) + 1);
  }
  return m;
}

/** อัตโนมัติ: ข้อผิดที่ยังไม่แก้และมี errorEvents (occurred) มากสุดใน 30 วัน — เท่ากันใช้ยอดรวมทั้งหมด แล้วตาม id */
export function autoFocus(errors, events, now, limit = FOCUS_LIMIT) {
  const stats = errorStats(errors, events);
  const count = recentCounts(events, now);
  return errors
    .filter((e) => count.has(e.id) && !stats.get(e.id).resolved)
    .map((e) => ({ error: e, count: count.get(e.id) }))
    .sort((a, b) => b.count - a.count || stats.get(b.error.id).count - stats.get(a.error.id).count || a.error.id.localeCompare(b.error.id))
    .slice(0, limit);
}

/**
 * focus = settings.focus { weekKey, errorIds[] } ถ้าเป็นของสัปดาห์นี้และยังมีข้อผิดที่ใช้ได้ (ไม่ถูกลบ/ยังไม่แก้) ใช้ของผู้ใช้
 * ไม่งั้นใช้อัตโนมัติ — คืน { source: "user" | "auto", items: [{ error, count }] } (count = ครั้งที่ผิดใน 30 วัน)
 */
export function focusErrors({ errors, events, focus, now, limit = FOCUS_LIMIT }) {
  if (focus && focus.weekKey === weekKey(now) && Array.isArray(focus.errorIds)) {
    const stats = errorStats(errors, events);
    const count = recentCounts(events, now);
    const byId = new Map(errors.map((e) => [e.id, e]));
    const items = focus.errorIds.map((id) => byId.get(id)).filter((e) => e && !stats.get(e.id).resolved)
      .slice(0, limit).map((e) => ({ error: e, count: count.get(e.id) || 0 }));
    if (items.length) return { source: "user", items };
  }
  return { source: "auto", items: autoFocus(errors, events, now, limit) };
}

// ---------- แบบฝึกในเครื่อง ----------
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** บัตรคำที่เกี่ยวข้องกับข้อผิด: en อยู่ในแบบที่ถูก (ทั้งคำ/วลี) หรือประโยคตัวอย่างมีแบบที่ถูกอยู่ — วลียาวมาก่อน */
export function relatedCards(error, cards) {
  const right = normalize(error.right);
  if (!right) return [];
  const rightPad = ` ${right} `;
  return cards.filter((c) => {
    const en = normalize(c.en);
    return (en && rightPad.includes(` ${en} `)) || ` ${normalize(c.example)} `.includes(rightPad);
  }).sort((a, b) => normalize(b.en).length - normalize(a.en).length || a.id.localeCompare(b.id));
}

/** เว้นช่องที่วลี en ในประโยคตัวอย่าง (ต้องเจอทั้งคำ ตัวพิมพ์ไม่สำคัญ) ไม่เจอ = null */
export function clozeFromCard(card) {
  const en = String(card.en || "").trim();
  const ex = String(card.example || "");
  if (!en || !ex) return null;
  const m = new RegExp(`(?<![\\p{L}\\p{N}])${escapeRe(en)}(?![\\p{L}\\p{N}])`, "iu").exec(ex);
  if (!m) return null;
  return { sentence: `${ex.slice(0, m.index)}_____${ex.slice(m.index + m[0].length)}`, answer: m[0] };
}

/** ตอบถูกเมื่อตรงกันหลัง normalize (ตัวพิมพ์/เครื่องหมาย/ช่องว่าง) — ไม่มี "เกือบถูก": ข้อผิดไวยากรณ์ต่างกันนิดเดียวก็คือผิด */
export function checkExact(input, expected) {
  const a = normalize(input), b = normalize(expected);
  return a !== "" && a === b;
}

/**
 * ชุดแบบฝึกของข้อผิดหนึ่งข้อ: 1) เลือกแบบที่ถูก 2) พิมพ์แบบที่ถูกจากความจำ 3) เติมช่องจากประโยคตัวอย่างของบัตรที่เกี่ยวข้อง (ถ้ามี ไม่เกิน 2 ข้อ)
 * rng ส่งเข้ามาเพื่อให้ทดสอบได้ (สลับตำแหน่งตัวเลือก)
 */
export function buildDrills(error, cards, rng = Math.random) {
  const drills = [
    { type: "choose", options: rng() < 0.5 ? [error.right, error.wrong] : [error.wrong, error.right], answer: error.right },
    { type: "recall", prompt: error.wrong, answer: error.right },
  ];
  for (const c of relatedCards(error, cards)) {
    if (drills.length >= 4) break;
    const cl = clozeFromCard(c);
    if (cl) drills.push({ type: "cloze", sentence: cl.sentence, answer: cl.answer, cardId: c.id });
  }
  return drills;
}

// ---------- เสนอให้กด "แก้ได้แล้ว" ----------
/**
 * ทำถูกติดกัน 3 รอบใน 3 วันต่างกัน: นับเป็นรายวัน (วันนั้นต้องตอบถูกทุกข้อที่ทำ) และ 3 วันล่าสุดที่มีการฝึกต้องถูกทั้งหมด
 * ข้อที่แก้แล้ว (resolved ล่าสุด) ไม่เสนอ · เปิดใหม่ (reopened) นับเฉพาะการฝึกหลังเปิดใหม่
 */
export function resolveSuggestion({ errorId, practiceEvents, errorEvents }) {
  const status = errorEvents.filter((e) => e.errorId === errorId && (e.type === "resolved" || e.type === "reopened")).sort((a, b) => a.at - b.at).at(-1);
  if (status?.type === "resolved") return { suggest: false, days: [], reason: "resolved" };
  const since = status?.type === "reopened" ? status.at : 0;
  const byDay = new Map();
  for (const p of practiceEvents) {
    if (p.errorId !== errorId || p.at <= since) continue;
    const k = dayKey(p.at);
    byDay.set(k, (byDay.get(k) ?? true) && p.correct === true);
  }
  const days = [...byDay].sort(([a], [b]) => (a < b ? -1 : 1)).slice(-RESOLVE_STREAK_DAYS).map(([key, ok]) => ({ key, ok }));
  return { suggest: days.length === RESOLVE_STREAK_DAYS && days.every((d) => d.ok), days };
}

// ---------- โจทย์จาก AI (ไม่บังคับ) ----------
export function aiDrillPrompt(error) {
  return [
    `A Thai learner of English keeps making this mistake.`,
    `Wrong: "${error.wrong}"`,
    `Correct: "${error.right}"`,
    `Category: ${error.category}${error.note ? `\nNote: ${error.note}` : ""}`,
    `Write 3 fill-in-the-blank practice sentences that test exactly this point. Reply with ONLY one JSON object (no markdown, no commentary):`,
    `{"items":[{"sentence":"English sentence containing exactly one ___ blank","answer":"the words that correctly fill the blank","hint":"short Thai hint"}]}`,
    `Rules: each sentence contains "___" exactly once; the answer is usually 1 to 3 words; do not reuse the wrong/correct example sentence itself.`,
  ].join("\n");
}

/** ตรวจและล้างผลจาก AI: ต้องมี ___ ช่องเดียว คำตอบสั้นและไม่ว่าง */
export function parseAiDrills(text) {
  const a = text.indexOf("{"), b = text.lastIndexOf("}");
  if (a < 0 || b <= a) throw new ApiError("ai", "parse");
  let j;
  try { j = JSON.parse(text.slice(a, b + 1)); } catch { throw new ApiError("ai", "parse"); }
  const items = (Array.isArray(j.items) ? j.items : []).map((x) => ({
    sentence: String(x?.sentence || "").trim(), answer: String(x?.answer || "").trim(), hint: String(x?.hint || "").trim().slice(0, 80),
  })).filter((x) => x.sentence.length <= 300 && (x.sentence.match(/___/g) || []).length === 1 && x.answer && x.answer.length <= 60 && !x.answer.includes("___"))
    .slice(0, 3);
  if (!items.length) throw new ApiError("ai", "empty");
  return items.map((x) => ({ type: "cloze", ai: true, sentence: x.sentence.replace("___", "_____"), answer: x.answer, hint: x.hint }));
}

export async function fetchAiDrills(error, opts) {
  return parseAiDrills(await claudeText(aiDrillPrompt(error), opts));
}

// ตัวเลข/ชุดข้อมูลกราฟของ Dashboard — pure อ่านจาก dailyStats (ไม่แตะ events) ยกเว้นคาดการณ์บัตรถึงรอบที่ใช้สถานะ SRS ปัจจุบัน
import { dayKey, currentStreak } from "./streak.js";
import { SKILLS, HW_STYLES } from "./stats.js";
import { planFor } from "./timer.js";

export const RANGES = { day: "วัน", week: "สัปดาห์", month: "เดือน", all: "ทั้งหมด" };
export const SKILL_LABELS = { srs: "ทบทวนบัตรคำ", input: "Input", output: "Output", weak: "เจาะจุดอ่อน", shadowing: "Shadowing", writing: "เขียนมือ", journal: "Journal" };
// Input = ช่วง Input ; Output = ช่วง Output + Shadowing (พูดตาม) + เขียนมือ + Journal ; ทบทวนบัตรคำ/จุดอ่อน ไม่นับในสัดส่วนนี้
export const INPUT_SKILLS = ["input"];
export const OUTPUT_SKILLS = ["output", "shadowing", "writing", "journal"];

export function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
  return dayKey(new Date(y, m - 1, d + n).getTime());
}
const span = (end, n) => Array.from({ length: n }, (_, i) => addDays(end, -(n - 1 - i)));
const daysBetween = (a, b) => { const [y1, m1, d1] = a.split("-").map(Number), [y2, m2, d2] = b.split("-").map(Number); return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000); };

/** { keys, prevKeys } ของช่วงเวลา: day = วันนี้ (เทียบเมื่อวาน) · week = 7 วัน · month = 30 วัน · all = ตั้งแต่วันแรกที่มีข้อมูล (ไม่เทียบ) */
export function rangeKeys(range, now, firstKey = null) {
  const today = dayKey(now);
  if (range === "day") return { keys: [today], prevKeys: [addDays(today, -1)] };
  if (range === "week") return { keys: span(today, 7), prevKeys: span(addDays(today, -7), 7) };
  if (range === "month") return { keys: span(today, 30), prevKeys: span(addDays(today, -30), 30) };
  const n = firstKey && firstKey <= today ? daysBetween(firstKey, today) + 1 : 1;
  return { keys: span(today, Math.min(n, 3660)), prevKeys: null };
}

const sumSec = (d) => (d ? SKILLS.reduce((a, s) => a + (d.sec?.[s] || 0), 0) : 0);

export function totals(keys, map) {
  const t = { sec: 0, reviews: 0, correct: 0, newCards: 0, gained: 0, lost: 0, activeDays: 0 };
  for (const k of keys) {
    const d = map.get(k);
    if (!d) continue;
    t.sec += sumSec(d); t.reviews += d.reviews; t.correct += d.correct; t.newCards += d.newCards; t.gained += d.knownGained; t.lost += d.knownLost;
    if (d.activity > 0) t.activeDays++;
  }
  return t;
}

/** เปลี่ยนแปลงเทียบช่วงก่อนหน้า: { abs, pct } (pct = null ถ้าฐานเป็น 0 หรือไม่มีช่วงก่อนหน้า) */
export function change(cur, prev) {
  if (prev == null) return null;
  return { abs: cur - prev, pct: prev > 0 ? Math.round(((cur - prev) / prev) * 100) : null };
}

export function longestStreak(activeKeys) {
  const keys = [...new Set(activeKeys)].sort();
  let best = 0, run = 0, prev = null;
  for (const k of keys) { run = prev && addDays(prev, 1) === k ? run + 1 : 1; best = Math.max(best, run); prev = k; }
  return best;
}

/** KPI: เวลาเรียนรวม · คำที่จำได้ (ปัจจุบัน + เปลี่ยนในช่วง) · % ตอบถูก · streak — เทียบช่วงก่อนหน้า */
export function kpis({ map, range, now, liveKnown }) {
  const first = [...map.keys()].sort()[0] || null;
  const { keys, prevKeys } = rangeKeys(range, now, first);
  const cur = totals(keys, map), prev = prevKeys ? totals(prevKeys, map) : null;
  const pct = (t) => (t.reviews ? Math.round((t.correct / t.reviews) * 100) : null);
  const active = [...map.values()].filter((d) => d.activity > 0).map((d) => d.id);
  const counts = new Map(active.map((k) => [k, 1]));
  return {
    keys, prevKeys,
    studySec: { value: cur.sec, prev: prev?.sec ?? null, change: change(cur.sec, prev?.sec) },
    known: { value: liveKnown, delta: cur.gained - cur.lost, prevDelta: prev ? prev.gained - prev.lost : null },
    accuracy: { value: pct(cur), prev: prev ? pct(prev) : null, reviews: cur.reviews, change: pct(cur) != null && prev && pct(prev) != null ? { abs: pct(cur) - pct(prev), pct: null } : null },
    streak: { current: currentStreak(counts, now), longest: longestStreak(active) },
    activeDays: cur.activeDays,
  };
}

/** เวลาเรียนรายวันแบบ stacked (นาที) ตาม skill + เส้นเป้าหมาย; range=day แสดงรายชั่วโมงของวันนี้ (รวมทุก skill) */
export function timeSeries({ map, range, now, dailyMinutes }) {
  if (range === "day") {
    const d = map.get(dayKey(now));
    return { kind: "hour", labels: Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, "0")}:00`), datasets: [{ skill: "all", label: "รวมทุกทักษะ", data: Array.from({ length: 24 }, (_, h) => round1((d?.hourSec[h] || 0) / 60)) }], goal: null };
  }
  const first = [...map.keys()].sort()[0] || null;
  const { keys } = rangeKeys(range, now, first);
  return {
    kind: "day", labels: keys,
    datasets: SKILLS.map((s) => ({ skill: s, label: SKILL_LABELS[s], data: keys.map((k) => round1((map.get(k)?.sec[s] || 0) / 60)) })).filter((ds) => ds.data.some((v) => v > 0)),
    goal: dailyMinutes,
  };
}
const round1 = (x) => Math.round(x * 10) / 10;

/** ตารางชั่วโมง × วันในสัปดาห์ (จันทร์ = 0) หน่วยนาที ในช่วงที่เลือก + ช่วงที่เรียนบ่อยที่สุด */
export function weekdayHour({ map, range, now }) {
  const first = [...map.keys()].sort()[0] || null;
  const { keys } = rangeKeys(range === "day" ? "week" : range, now, first);
  const m = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (const k of keys) {
    const d = map.get(k);
    if (!d) continue;
    const [y, mo, da] = k.split("-").map(Number);
    const wd = (new Date(y, mo - 1, da).getDay() + 6) % 7;
    for (let h = 0; h < 24; h++) m[wd][h] += (d.hourSec[h] || 0) / 60;
  }
  let best = null;
  const byHour = Array(24).fill(0);
  m.forEach((row) => row.forEach((v, h) => { byHour[h] += v; }));
  byHour.forEach((v, h) => { if (v > 0 && (!best || v > best.minutes)) best = { hour: h, minutes: round1(v) }; });
  const cells = m.map((r) => r.map(round1));
  return { cells, max: Math.max(0, ...cells.flat()), best };
}

/** สัดส่วน Input / Output จริง เทียบที่ขั้นปัจจุบันแนะนำ (จากแผนตัวจับเวลา) — เฉพาะ Input+Output เท่านั้น */
export function ioShare({ map, range, now, stage, dailyMinutes }) {
  const first = [...map.keys()].sort()[0] || null;
  const { keys } = rangeKeys(range, now, first);
  let input = 0, output = 0;
  for (const k of keys) {
    const d = map.get(k);
    if (!d) continue;
    for (const s of INPUT_SKILLS) input += d.sec[s] || 0;
    for (const s of OUTPUT_SKILLS) output += d.sec[s] || 0;
  }
  const plan = planFor(stage, dailyMinutes);
  const recIn = plan[1], recOut = plan[2];
  const share = (a, b) => (a + b > 0 ? Math.round((a / (a + b)) * 100) : null);
  return { inputMin: round1(input / 60), outputMin: round1(output / 60), actual: share(input, output), recommended: share(recIn, recOut), recommendedMin: { input: recIn, output: recOut } };
}

/** การเติบโตของคลังคำ: สะสมคำใหม่ vs สะสมคำที่จำได้ (เริ่มจากยอดก่อนช่วงที่เลือก) */
export function vocabGrowth({ map, range, now }) {
  const sorted = [...map.keys()].sort();
  const { keys } = rangeKeys(range === "day" ? "week" : range, now, sorted[0] || null);
  let cards = 0, known = 0;
  for (const k of sorted) { if (k >= keys[0]) break; const d = map.get(k); cards += d.newCards; known += d.knownGained - d.knownLost; }
  const outCards = [], outKnown = [];
  for (const k of keys) { const d = map.get(k); if (d) { cards += d.newCards; known += d.knownGained - d.knownLost; } outCards.push(cards); outKnown.push(Math.max(0, known)); }
  return { labels: keys, cards: outCards, known: outKnown };
}

/** บัตรที่ถึงรอบทบทวนในอีก N วัน (ไม่รวมบัตรใหม่; ที่เลยกำหนดแล้วนับเป็นวันนี้) */
export function forecast({ cards, states, now, days = 14 }) {
  const today = dayKey(now);
  const labels = span(addDays(today, days - 1), days);
  const counts = new Map(labels.map((k) => [k, 0]));
  for (const c of cards) {
    const st = states.get(c.id);
    if (!st || st.isNew) continue;
    const due = dayKey(st.due);
    const k = due < today ? today : due;
    if (counts.has(k)) counts.set(k, counts.get(k) + 1);
  }
  return { labels, counts: labels.map((k) => counts.get(k)) };
}

/** ข้อผิด (จำนวนครั้งที่เกิด) ตามหมวด เดือนนี้เทียบเดือนก่อน (เดือนปฏิทิน) */
export function errorMonths({ map, now }) {
  const d = new Date(now);
  const cur = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  const prevD = new Date(d.getFullYear(), d.getMonth() - 1, 1);
  const prev = `${prevD.getFullYear()}-${String(prevD.getMonth() + 1).padStart(2, "0")}`;
  const a = new Map(), b = new Map();
  for (const [k, day] of map) {
    const target = k.startsWith(cur) ? a : k.startsWith(prev) ? b : null;
    if (target) for (const { c, n } of day.errorCat) target.set(c, (target.get(c) || 0) + n);
  }
  const cats = [...new Set([...a.keys(), ...b.keys()])].sort();
  return { month: cur, prevMonth: prev, labels: cats, current: cats.map((c) => a.get(c) || 0), previous: cats.map((c) => b.get(c) || 0) };
}

/** คะแนนลายมือเฉลี่ยรายวัน แยก Print/Cursive (เฉพาะวันที่มีการให้คะแนนอัตโนมัติ) */
export function handwritingSeries({ map, range, now }) {
  const first = [...map.keys()].sort()[0] || null;
  const { keys } = rangeKeys(range === "day" ? "month" : range, now, first);
  const out = { labels: keys };
  for (const s of HW_STYLES) out[s] = keys.map((k) => { const h = map.get(k)?.hw[s]; return h && h.n > 0 ? Math.round((h.sum / h.n) * 10) / 10 : null; });
  return out;
}

export const formatDuration = (sec) => {
  const m = Math.round(sec / 60);
  return m < 60 ? `${m} นาที` : `${Math.floor(m / 60)} ชม. ${m % 60} นาที`;
};

// ---------- ความคืบหน้าตามระดับของคลังกลาง ----------
/**
 * levels: [{ level, count }] จาก vocab index · cards: บัตรที่กำลังเรียน (รวมที่จำได้) · states: Map cardId → state SRS
 * skipped: Set ของ wordKey ที่กด “รู้แล้ว” · levelOf(card) → ระดับ (0 = ไม่อยู่ในคลัง) · isKnown(state) → boolean
 * คืน [{ level, total, learning, known, skipped, pct }] pct = (known + skipped) / total
 */
export function levelProgress({ levels, cards, states, skipped = new Set(), levelOf, isKnown, skippedLevelOf }) {
  const rows = new Map(levels.map((l) => [l.level, { level: l.level, total: l.count, learning: 0, known: 0, skipped: 0, pct: 0 }]));
  for (const c of cards) {
    const r = rows.get(levelOf(c));
    if (!r) continue;
    if (isKnown(states.get(c.id))) r.known++; else r.learning++;
  }
  for (const k of skipped) { const r = rows.get(skippedLevelOf(k)); if (r) r.skipped++; }
  for (const r of rows.values()) r.pct = r.total ? Math.round(((r.known + r.skipped) / r.total) * 1000) / 10 : 0;
  return [...rows.values()].sort((a, b) => a.level - b.level);
}

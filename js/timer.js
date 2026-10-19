// ตัวจับเวลา 4 ช่วง แบบ pure functions — นับจาก timestamp (now ที่ส่งเข้ามา) ไม่ใช่การนับ tick
// ทุกฟังก์ชันคืน { t: สถานะใหม่, slices: [session ที่ต้องบันทึก] } — ผู้เรียกเป็นคนเขียน DB

export const SEGMENTS = [
  { key: "srs", label: "ทบทวนบัตรคำ", color: "var(--seg-srs)" },
  { key: "input", label: "Input", color: "var(--seg-input)" },
  { key: "output", label: "Output", color: "var(--seg-output)" },
  { key: "weak", label: "เจาะจุดอ่อน", color: "var(--seg-weak)" },
];

// นาทีต่อช่วง [srs, input, output, weak] ตามขั้น 0–5
export const PLANS = {
  0: [15, 20, 15, 10],
  1: [15, 25, 10, 10],
  2: [15, 25, 10, 10],
  3: [15, 15, 20, 10],
  4: [15, 15, 20, 10],
  5: [15, 15, 20, 10],
};
export const DAILY_GOAL_MIN = 60;

/**
 * แผนนาทีต่อช่วงที่สเกลตามเวลาเรียนต่อวัน (ค่าเริ่มต้น 60 = สัดส่วนเดิมของเฟส 1 ทุกประการ)
 * แบ่งแบบ largest remainder ให้ผลรวมเท่ากับ dailyMinutes พอดี (ขั้นต่ำช่วงละ 1 นาที)
 */
export function planFor(stage, dailyMinutes = DAILY_GOAL_MIN) {
  const base = PLANS[stage];
  if (dailyMinutes === DAILY_GOAL_MIN) return [...base];
  const raw = base.map((m) => (m * dailyMinutes) / DAILY_GOAL_MIN);
  const out = raw.map(Math.floor);
  let rest = dailyMinutes - out.reduce((a, b) => a + b, 0);
  const order = raw.map((v, i) => [v - out[i], i]).sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) { if (rest <= 0) break; out[i]++; rest--; }
  return out.map((m) => Math.max(1, m));
}

export const create = (stage, plan) => ({ stage, plan: plan || PLANS[stage], idx: 0, elapsed: 0, runStart: null, done: false });
export const isRunning = (t) => t.runStart != null;
const segMs = (t) => (t.plan || PLANS[t.stage])[t.idx] * 60000;

export function remaining(t, now) {
  if (t.done) return 0;
  const run = t.runStart == null ? 0 : now - t.runStart;
  return Math.max(0, segMs(t) - t.elapsed - run);
}

function slice(t, start, end) {
  const durationSec = Math.round((end - start) / 1000);
  return durationSec >= 1 ? { start, end, durationSec, skill: SEGMENTS[t.idx].key, stage: t.stage } : null;
}
const out = (t, s) => ({ t, slices: s ? [s] : [] });

function advance(t) {
  if (t.idx + 1 >= SEGMENTS.length) return { ...t, runStart: null, done: true, elapsed: segMs(t) };
  return { ...t, idx: t.idx + 1, elapsed: 0, runStart: null };
}

export function start(t, now) {
  if (t.done || t.runStart != null) return out(t);
  return out({ ...t, runStart: now });
}

/** หยุดพัก — บันทึกช่วงที่เพิ่งเดิน */
export function pause(t, now) {
  if (t.runStart == null) return out(t);
  return out({ ...t, runStart: null, elapsed: t.elapsed + (now - t.runStart) }, slice(t, t.runStart, now));
}

/** เรียกซ้ำ ๆ — ถ้าช่วงปัจจุบันครบเวลาแล้ว บันทึก (ตัดที่เวลาครบพอดี) แล้วขึ้นช่วงถัดไปในสถานะหยุด */
export function tick(t, now) {
  if (t.runStart == null) return out(t);
  const end = t.runStart + (segMs(t) - t.elapsed);
  if (now < end) return out(t);
  return out(advance(t), slice(t, t.runStart, end));
}

export function skip(t, now) {
  if (t.done) return out(t);
  const p = pause(t, now);
  return out(advance(p.t), p.slices[0]);
}

/** เริ่มใหม่ (หรือเปลี่ยนขั้น) — บันทึกช่วงที่กำลังเดินก่อนล้าง */
export function reset(t, now, stage = t.stage, plan = stage === t.stage ? t.plan : undefined) {
  const p = pause(t, now);
  return out(create(stage, plan), p.slices[0]);
}

export function formatClock(ms) {
  const s = Math.ceil(ms / 1000);
  return `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}

// ---------- สรุป ----------
export function startOfDay(ts) {
  const d = new Date(ts);
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** นาทีรวมของวัน (เวลาท้องถิ่น) คำนวณจาก sessions เสมอ — นับตามเวลาเริ่มของ session */
export function minutesOnDay(sessions, now) {
  const a = startOfDay(now);
  const d = new Date(a);
  d.setDate(d.getDate() + 1);
  const b = d.getTime();
  return sessions.filter((s) => s.start >= a && s.start < b).reduce((sum, s) => sum + s.durationSec, 0) / 60;
}

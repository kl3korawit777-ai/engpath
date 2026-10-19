// Streak + heatmap แบบ pure — นับจาก sessions และ reviews ตามวันตามเวลาท้องถิ่นของเครื่อง
// ไม่เก็บตัวนับ: คำนวณจาก events ทุกครั้ง

const pad = (n) => String(n).padStart(2, "0");

/** "YYYY-MM-DD" ตามเวลาท้องถิ่น */
export function dayKey(ts) {
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** เลื่อนวันตามปฏิทินท้องถิ่น (ปลอดภัยเรื่อง DST — ไม่ใช้ +86400000) */
function shiftDay(ts, days) {
  const d = new Date(ts);
  d.setDate(d.getDate() + days);
  return d.getTime();
}

/** Map dayKey → จำนวนรายการ (session นับตามเวลาเริ่ม, review นับตามเวลาให้คะแนน) */
export function activityCounts(sessions, reviews) {
  const m = new Map();
  const add = (ts) => { const k = dayKey(ts); m.set(k, (m.get(k) || 0) + 1); };
  for (const s of sessions) add(s.start);
  for (const r of reviews) add(r.at);
  return m;
}

/**
 * Streak ปัจจุบัน = จำนวนวันติดต่อกันที่มีกิจกรรม
 * ถ้าวันนี้ยังไม่มีกิจกรรม แต่เมื่อวานมี streak ยังไม่ขาด (นับถึงเมื่อวาน) — ขาดเมื่อวันนี้จบโดยไม่มี
 */
export function currentStreak(counts, now) {
  let cursor = now;
  if (!counts.has(dayKey(cursor))) cursor = shiftDay(cursor, -1);
  let n = 0;
  while (counts.has(dayKey(cursor))) { n += 1; cursor = shiftDay(cursor, -1); }
  return n;
}

export function level(count) {
  return count <= 0 ? 0 : count < 3 ? 1 : count < 10 ? 2 : count < 25 ? 3 : 4;
}

/**
 * heatmap: อาร์เรย์ของ weeks (เก่า → ใหม่) แต่ละสัปดาห์มี 7 วัน (จันทร์ → อาทิตย์)
 * สัปดาห์สุดท้ายคือสัปดาห์ปัจจุบัน วันที่ยังมาไม่ถึงมี future: true
 */
export function heatmap(counts, now, weeks = 12) {
  const today = new Date(now);
  const mondayOffset = (today.getDay() + 6) % 7;            // จันทร์ = 0
  const thisMonday = shiftDay(now, -mondayOffset);
  const todayKey = dayKey(now);
  const out = [];
  for (let w = weeks - 1; w >= 0; w--) {
    const days = [];
    for (let d = 0; d < 7; d++) {
      const ts = shiftDay(thisMonday, -7 * w + d);
      const key = dayKey(ts);
      const count = counts.get(key) || 0;
      days.push({ key, count, level: level(count), future: key > todayKey, today: key === todayKey });
    }
    out.push(days);
  }
  return out;
}

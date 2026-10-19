// ตรรกะ Error Log แบบ pure — จำนวนครั้งและสถานะคำนวณจาก errorEvents เสมอ (ไม่เก็บตัวนับ)
// errorEvent.type: "occurred" (+1) | "resolved" | "reopened"

export const CATEGORIES = ["Grammar", "Tense", "Article", "Preposition", "Word choice", "การออกเสียง", "การสะกด"];
const WEEK = 7 * 86400000;

const byTime = (a, b) => (a.at - b.at) || ((a.createdAt || 0) - (b.createdAt || 0)) || (a.id < b.id ? -1 : 1);

/** Map errorId → { count, resolved, lastAt } (เฉพาะ error ที่ส่งเข้ามา) */
export function errorStats(errors, events) {
  const stats = new Map(errors.map((e) => [e.id, { count: 0, resolved: false, lastAt: 0 }]));
  for (const ev of [...events].sort(byTime)) {
    const s = stats.get(ev.errorId);
    if (!s) continue;
    if (ev.type === "occurred") { s.count += 1; s.lastAt = ev.at; }
    else if (ev.type === "resolved") s.resolved = true;
    else if (ev.type === "reopened") s.resolved = false;
  }
  return stats;
}

/** จำนวนครั้งที่ผิดแยกตามหมวด (ทุกหมวดมีค่า แม้เป็น 0) */
export function byCategory(errors, events) {
  const stats = errorStats(errors, events);
  const out = Object.fromEntries(CATEGORIES.map((c) => [c, 0]));
  for (const e of errors) {
    const n = stats.get(e.id).count;
    out[e.category] = (out[e.category] || 0) + n;
  }
  return out;
}

/** จุดเน้นสัปดาห์: ข้อผิดที่เกิดซ้ำบ่อยสุดใน 7 วันล่าสุด (ยังไม่ถูกทำเครื่องหมายว่าแก้ได้แล้ว) */
export function weeklyFocus(errors, events, now, limit = 2) {
  const stats = errorStats(errors, events);
  const recent = new Map();
  for (const ev of events) {
    if (ev.type === "occurred" && ev.at > now - WEEK && ev.at <= now) recent.set(ev.errorId, (recent.get(ev.errorId) || 0) + 1);
  }
  return errors
    .filter((e) => recent.has(e.id) && !stats.get(e.id).resolved)
    .map((e) => ({ error: e, count: recent.get(e.id) }))
    .sort((a, b) => b.count - a.count || stats.get(b.error.id).count - stats.get(a.error.id).count || a.error.id.localeCompare(b.error.id))
    .slice(0, limit);
}

export function validateError({ wrong, right, category }) {
  if (!String(wrong || "").trim()) return "กรอกประโยค/คำที่ผิด";
  if (!String(right || "").trim()) return "กรอกประโยค/คำที่ถูก";
  if (!CATEGORIES.includes(category)) return "เลือกหมวด";
  return null;
}

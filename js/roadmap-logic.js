// ตรรกะ Roadmap / Onboarding / checkpoint แบบ pure (ไม่แตะ DB/DOM)
import { ROADMAP } from "./data/roadmap.js";
import { targetStatus } from "./exam.js";

const DAY = 86400000;

export const SKILLS = [
  { key: "listening", label: "ฟัง" },
  { key: "speaking", label: "พูด" },
  { key: "reading", label: "อ่าน" },
  { key: "writing", label: "เขียน" },
];
export const LEVELS = ["A1", "A2", "B1", "B2", "C1"];
export const EF_LEVELS = [...LEVELS, "C2"];
export const PASS_SCORE = 70;       // คะแนนต่ำกว่านี้ถือว่าทักษะนั้นต้องเสริม (ค่าตั้งต้นของแอป ปรับได้ที่นี่)

export const WEAK_ADVICE = {
  listening: "เสริมการฟัง: เพิ่มเวลาช่วง Input ด้านฟัง (podcast / คลิปพร้อมซับ แล้วดูซ้ำแบบปิดซับ)",
  reading: "เสริมการอ่าน: เพิ่มเวลาช่วง Input ด้านอ่าน (graded readers / บทความสั้นทุกวัน)",
  speaking: "เสริมการพูด: เพิ่มเวลาช่วง Output ด้านพูด (Shadowing / อัดเสียงตัวเองแล้วฟังย้อน)",
  writing: "เสริมการเขียน: เพิ่มเวลาช่วง Output ด้านเขียน (เขียนบันทึกสั้นแล้วให้ครู/AI ตรวจ)",
};

// ---------- ขั้นเริ่มต้นที่ระบบเสนอ ----------
const LEVEL_TO_STAGE = { 0: 1, 1: 2, 2: 3, 3: 4, 4: 5 };   // A1→1, A2→2, B1→3, B2→4, C1→5

/** index ใน LEVELS (C2 นับเป็น C1) หรือ -1 ถ้าไม่ระบุ/ไม่รู้จัก */
export function levelIndex(l) {
  const i = EF_LEVELS.indexOf(l);
  return i < 0 ? -1 : Math.min(i, LEVELS.length - 1);
}

/**
 * เสนอขั้นเริ่มต้น: ใช้ระดับจาก EF SET ถ้ามี ไม่งั้นใช้ค่าเฉลี่ยของการประเมินตัวเอง (ปัดลง = ระมัดระวัง)
 * ไม่มีข้อมูลเลย → ขั้น 0 (ตั้งเป้า & วัดระดับ) · ผู้ใช้ยืนยัน/แก้ได้เสมอ
 */
export function suggestStage({ selfAssess = {}, efSet = {} } = {}) {
  const ef = levelIndex(efSet.level);
  if (ef >= 0) return { stage: LEVEL_TO_STAGE[ef], level: efSet.level, source: "efset" };
  const idx = SKILLS.map((s) => levelIndex(selfAssess[s.key])).filter((i) => i >= 0);
  if (!idx.length) return { stage: 0, level: null, source: "none" };
  const avg = Math.floor(idx.reduce((a, b) => a + b, 0) / idx.length);
  return { stage: LEVEL_TO_STAGE[avg], level: LEVELS[avg], source: "self" };
}

// ---------- เป้าหมาย SMART ----------
/** goal: { type: "cefr"|"exam", target, examName?, date: "YYYY-MM-DD" } */
export function validateGoal(goal, now) {
  if (!goal || (goal.type !== "cefr" && goal.type !== "exam")) return "เลือกชนิดเป้าหมาย";
  if (goal.type === "cefr" && !LEVELS.includes(goal.target)) return "เลือกระดับ CEFR ที่ต้องการ";
  if (goal.type === "exam") {
    if (!String(goal.examName || "").trim()) return "ใส่ชื่อข้อสอบ";
    if (!String(goal.target || "").trim()) return "ใส่คะแนนที่ต้องการ";
  }
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(goal.date || "");
  if (!m) return "เลือกวันที่ต้องการบรรลุเป้าหมาย";
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  if (Number.isNaN(d.getTime()) || d.getMonth() !== Number(m[2]) - 1) return "วันที่ไม่ถูกต้อง";
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  if (d < today) return "วันที่ต้องไม่ใช่อดีต";
  return null;
}

// ---------- เช็กลิสต์เกณฑ์ผ่าน ----------
export const criterionKey = (stage, idx) => `${stage}.${idx}`;

export function stageProgress(criteria, stage) {
  const list = ROADMAP[stage].criteria;
  const done = list.filter((_, i) => criteria?.[criterionKey(stage, i)] === true).length;
  return { done, total: list.length, allDone: done === list.length };
}

// ---------- checkpoint ----------
/** กันเอกสารผิดรูป (เช่น เอกสารทดสอบ rules) ไม่ให้ปนเข้าประวัติและการนับรอบ */
export function isValidCheckpoint(c) {
  return Boolean(c) && typeof c.at === "number" && Number.isFinite(c.at) && Number.isInteger(c.stage) && c.stage >= 0 && c.stage <= 5
    && typeof c.passed === "boolean" && c.scores !== null && typeof c.scores === "object" && !Array.isArray(c.scores);
}

/** baseline = checkpoint ล่าสุด หรือวัน Onboarding เสร็จ; ครบรอบเมื่อผ่านไป weeks สัปดาห์ */
export function checkpointStatus({ checkpoints = [], onboarding = null, weeks = 5, now }) {
  const last = checkpoints.reduce((m, c) => Math.max(m, c.at || 0), 0);
  const baseline = last || onboarding?.doneAt || 0;
  if (!baseline) return { baseline: null, dueAt: null, due: false, daysLeft: null };
  const dueAt = baseline + weeks * 7 * DAY;
  return { baseline, dueAt, due: now >= dueAt, daysLeft: Math.ceil((dueAt - now) / DAY) };
}

export function weakSkills(scores = {}, pass = PASS_SCORE) {
  return SKILLS.filter((s) => typeof scores[s.key] === "number" && scores[s.key] < pass)
    .sort((a, b) => scores[a.key] - scores[b.key]).map((s) => s.key);
}

/** scores: { listening?, speaking?, reading?, writing? } เป็น 0–100 อย่างน้อย 1 ทักษะ; mockExam: { score, target } ไม่บังคับ */
export function validateCheckpoint({ scores = {}, mockExam = null }) {
  const given = SKILLS.filter((s) => scores[s.key] !== undefined && scores[s.key] !== null);
  if (!given.length) return "ใส่คะแนนอย่างน้อย 1 ทักษะ";
  for (const s of given) {
    const v = scores[s.key];
    if (typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 100) return `คะแนน${s.label}ต้องเป็นตัวเลข 0–100`;
  }
  if (mockExam) {
    const { score, target } = mockExam;
    if (![score, target].every((x) => typeof x === "number" && Number.isFinite(x) && x >= 0)) return "ข้อสอบจำลอง: ใส่ทั้งคะแนนและเป้า (ตัวเลข)";
    if (target <= 0) return "ข้อสอบจำลอง: เป้าต้องมากกว่า 0";
  }
  return null;
}

// ---------- ข้อมูลประกอบเกณฑ์ (ผู้ใช้ติ๊กยืนยันเอง) ----------
/**
 * ผลข้อสอบจำลอง 2 ครั้งล่าสุด (ใหม่→เก่า) และถึงเป้าติดกัน 2 ครั้งหรือไม่
 * รวมผลที่กรอกใน checkpoint (score/target ตามที่กรอก) กับผลจากโหมดสอบ (examAttempts ที่ตั้งเป้าไว้ — เฉพาะชุดแนวเดียวกับครั้งล่าสุด หน่วย %)
 */
export function mockExamHint(checkpoints, attempts = []) {
  const fromCheckpoints = [...checkpoints].filter((c) => c.mockExam)
    .map((c) => ({ at: c.at, score: c.mockExam.score, target: c.mockExam.target, src: "checkpoint" }));
  const fromExams = targetStatus(attempts).last2.map((x) => ({ at: x.at, score: x.score, target: x.target, src: "exam", name: x.name }));
  const last2 = [...fromCheckpoints, ...fromExams].sort((a, b) => b.at - a.at).slice(0, 2)
    .map((x) => ({ ...x, reached: x.score >= x.target }));
  return { last2, twoInARow: last2.length === 2 && last2.every((x) => x.reached) };
}

/** จำนวนครั้งที่บันทึกข้อผิด (occurred) ใน 30 วันล่าสุด เทียบ 30 วันก่อนหน้า */
export function errorTrend(events, now) {
  let last = 0, prev = 0;
  for (const e of events) {
    if (e.type !== "occurred") continue;
    if (e.at > now - 30 * DAY && e.at <= now) last++;
    else if (e.at > now - 60 * DAY && e.at <= now - 30 * DAY) prev++;
  }
  return { last, prev, improved: prev > 0 && last < prev };
}

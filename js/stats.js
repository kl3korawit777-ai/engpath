// สรุปรายวัน (dailyStats) คำนวณจาก events แบบ pure — events ยังเป็นข้อมูลจริงเพียงแหล่งเดียว
// - ผลลัพธ์เป็นฟังก์ชันของ "ชุด event" เท่านั้น (ไม่ขึ้นกับลำดับที่ได้รับ/จำนวนเครื่อง) จึงคำนวณใหม่กี่ครั้งก็ได้ค่าเดิม ไม่มีการนับซ้ำ
// - วัน = เวลาท้องถิ่นของเครื่องที่คำนวณ (ตรงกับ streak.js)
import { dayKey } from "./streak.js";
import { initialState, applyReview } from "./srs.js";
import { memoryStatus } from "./library.js";

export const STATS_VERSION = 3;                // เพิ่มเมื่อเปลี่ยนสูตร → แอปคำนวณวันเก่าใหม่ให้เอง
export const SKILLS = ["srs", "input", "output", "weak", "shadowing", "writing", "journal"];
export const HW_STYLES = ["print", "cursive"];
const HOUR = 3600000;

const emptyDay = (date) => ({
  id: date, date, v: STATS_VERSION, activity: 0,
  sec: Object.fromEntries(SKILLS.map((s) => [s, 0])), hourSec: Array(24).fill(0),
  reviews: 0, correct: 0, recall: 0, newCards: 0, knownGained: 0, knownLost: 0,
  errorsNew: 0, errorOccur: 0, errorResolved: 0, errorCat: [],
  hw: Object.fromEntries(HW_STYLES.map((s) => [s, { n: 0, sum: 0 }])),
  shadowRounds: 0, journalEntries: 0, journalWords: 0, practice: 0, practiceCorrect: 0, readings: 0, interleave: 0,
});

// เรียงแบบกำหนดผลได้ (เวลา → id) เพื่อให้ผลรวมทศนิยมเท่ากันทุกเครื่อง
const stable = (arr, time = (x) => x.at) => [...arr].sort((a, b) => (time(a) - time(b)) || (String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0));

/** คำนวณทุกวันจากข้อมูลทั้งหมด → Map dayKey → เอกสาร dailyStats (ยังไม่มี createdAt/updatedAt) */
export function computeAll({ sessions = [], reviews = [], cards = [], errors = [], errorEvents = [], practiceEvents = [], shadowingEvents = [], handwritingAttempts = [], readings = [], journal = [], interleavingSessions = [] }) {
  const days = new Map();
  const day = (ts) => { const k = dayKey(ts); let d = days.get(k); if (!d) days.set(k, (d = emptyDay(k))); return d; };
  const ms = new Map();          // `${day}|${skill}` และ `${day}|h${hour}` → มิลลิวินาทีสะสม (แปลงเป็นวินาทีตอนท้าย กันเศษคลาดเคลื่อนเวลาแบ่งชั่วโมง)
  const addMs = (k, v) => ms.set(k, (ms.get(k) || 0) + v);

  for (const s of stable(sessions, (x) => x.start)) {
    day(s.start).activity++;
    if (!SKILLS.includes(s.skill) || !(s.durationSec > 0)) continue;
    const end = s.start + s.durationSec * 1000;
    for (let t = s.start; t < end;) {
      const d = new Date(t);
      const next = new Date(d.getFullYear(), d.getMonth(), d.getDate(), d.getHours() + 1, 0, 0, 0).getTime();   // ขอบชั่วโมงถัดไปตามเวลาท้องถิ่น (ปลอดภัยกับ DST)
      const stop = Math.min(end, next > t ? next : t + HOUR);
      const k = dayKey(t);
      day(t);
      addMs(`${k}|${s.skill}`, stop - t);
      addMs(`${k}|h${d.getHours()}`, stop - t);
      t = stop;
    }
  }
  for (const [k, v] of ms) {
    const [date, what] = k.split("|");
    const d = days.get(date);
    if (what.startsWith("h")) d.hourSec[Number(what.slice(1))] = Math.round(v / 1000); else d.sec[what] = Math.round(v / 1000);
  }

  for (const r of reviews) { const d = day(r.at); d.reviews++; d.activity++; if (r.rating > 0) d.correct++; if (typeof r.answer === "string" && r.answer.trim()) d.recall++; }

  // การ์ดที่ถึงสถานะ "จำได้" / หลุดจากสถานะนั้น: เล่น reviews ของแต่ละบัตรซ้ำตามลำดับเวลา
  const live = new Set(cards.filter((c) => !c.deleted).map((c) => c.id));
  const byCard = new Map();
  for (const r of reviews) if (live.has(r.cardId)) (byCard.get(r.cardId) || byCard.set(r.cardId, []).get(r.cardId)).push(r);
  for (const list of byCard.values()) {
    let st = initialState(), known = false;
    for (const r of [...list].sort((a, b) => (a.at - b.at) || ((a.createdAt || 0) - (b.createdAt || 0)) || (a.id < b.id ? -1 : 1))) {
      st = applyReview(st, r.rating, r.at);
      const nowKnown = memoryStatus(st) === "known";
      if (nowKnown && !known) day(r.at).knownGained++;
      else if (!nowKnown && known) day(r.at).knownLost++;
      known = nowKnown;
    }
  }

  for (const c of cards) if (!c.deleted && c.createdAt) day(c.createdAt).newCards++;

  const errById = new Map(errors.map((e) => [e.id, e]));
  for (const e of errors) if (!e.deleted && e.createdAt) day(e.createdAt).errorsNew++;
  const cat = new Map();                    // `${day}|${category}` → n
  for (const ev of errorEvents) {
    const d = day(ev.at);
    if (ev.type === "occurred") {
      d.errorOccur++;
      const c = errById.get(ev.errorId)?.category;
      if (c) cat.set(`${dayKey(ev.at)}|${c}`, (cat.get(`${dayKey(ev.at)}|${c}`) || 0) + 1);
    } else if (ev.type === "resolved") d.errorResolved++;
  }
  for (const [k, n] of cat) { const i = k.indexOf("|"); days.get(k.slice(0, i)).errorCat.push({ c: k.slice(i + 1), n }); }
  for (const d of days.values()) d.errorCat.sort((a, b) => (a.c < b.c ? -1 : 1));

  for (const a of stable(handwritingAttempts)) {
    const d = day(a.at);
    if (HW_STYLES.includes(a.style) && Number.isFinite(a.score)) { d.hw[a.style].n++; d.hw[a.style].sum += a.score; }
  }
  for (const d of days.values()) for (const s of HW_STYLES) d.hw[s].sum = Math.round(d.hw[s].sum * 100) / 100;

  for (const e of shadowingEvents) if (e.kind === "round") day(e.at).shadowRounds++;
  for (const e of practiceEvents) { const d = day(e.at); d.practice++; if (e.correct) d.practiceCorrect++; }
  for (const e of readings) day(e.at).readings++;
  for (const e of interleavingSessions) day(e.start).interleave++;          // เวลาเรียนของชุดคละบันทึกเป็น session (weak) แยกต่างหาก จึงไม่นับ activity ซ้ำ
  for (const j of journal) {
    if (j.deleted || !/^\d{4}-\d{2}-\d{2}$/.test(j.date || "")) continue;
    let d = days.get(j.date); if (!d) days.set(j.date, (d = emptyDay(j.date)));
    d.journalEntries++; d.journalWords += j.wordCount || 0;
  }
  return new Map([...days].sort((a, b) => (a[0] < b[0] ? -1 : 1)));
}

// ---------- เทียบเอกสาร (ไม่เขียนซ้ำถ้าค่าเท่ากัน) ----------
const META = new Set(["createdAt", "updatedAt", "deleted", "computedAt"]);
function canon(x) {
  if (Array.isArray(x)) return x.map(canon);
  if (x && typeof x === "object") return Object.fromEntries(Object.keys(x).filter((k) => !META.has(k)).sort().map((k) => [k, canon(x[k])]));
  return x;
}
export const canonical = (doc) => JSON.stringify(canon(doc));
export const sameStats = (a, b) => canonical(a) === canonical(b);

/** วันที่ต้องเขียน: คำนวณใหม่ต่างจากที่เก็บ หรือเวอร์ชันสูตรเก่ากว่า; คืน [{ id, doc, existing }] */
export function diffStats(computed, existing) {
  const have = new Map(existing.map((d) => [d.id, d]));
  const out = [];
  for (const [id, doc] of computed) {
    const old = have.get(id);
    if (!old || old.deleted || !sameStats(old, doc)) out.push({ id, doc, existing: old || null });
  }
  return out;
}

// ---------- ตรวจรูปแบบเอกสาร ----------
export function isValidStats(d) {
  const n = (x) => Number.isFinite(x) && x >= 0;
  return d && /^\d{4}-\d{2}-\d{2}$/.test(d.id) && d.date === d.id && n(d.v) && n(d.activity) && d.sec && SKILLS.every((s) => n(d.sec[s]))
    && Array.isArray(d.hourSec) && d.hourSec.length === 24 && d.hourSec.every(n)
    && ["reviews", "correct", "recall", "newCards", "knownGained", "knownLost", "errorsNew", "errorOccur", "errorResolved", "shadowRounds", "journalEntries", "journalWords", "practice", "practiceCorrect", "readings", "interleave"].every((k) => n(d[k]))
    && Array.isArray(d.errorCat) && d.errorCat.every((x) => x && typeof x.c === "string" && n(x.n))
    && d.hw && HW_STYLES.every((s) => d.hw[s] && n(d.hw[s].n) && Number.isFinite(d.hw[s].sum));
}

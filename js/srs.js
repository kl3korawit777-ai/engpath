// SRS (SM-2) แบบ pure functions — ไม่แตะ DB
// สถานะของบัตรไม่ถูกเก็บ แต่คำนวณจากการเล่น reviews ซ้ำตามเวลาเสมอ (ดู CLAUDE.md)

export const DAY = 86400000;
export const RATINGS = [
  { value: 0, label: "ลืม", q: 0 },
  { value: 1, label: "ยาก", q: 3 },
  { value: 2, label: "จำได้", q: 4 },
  { value: 3, label: "ง่าย", q: 5 },
];
export const MIN_EASE = 1.3;
export const START_EASE = 2.5;
export const MIN_EXAMPLE_WORDS = 4;

// ---------- SM-2 ----------
export function initialState() {
  return { ease: START_EASE, interval: 0, reps: 0, due: 0, lapses: 0, isNew: true };
}

/** ใช้การให้คะแนน (0–3) กับสถานะเดิม คืนสถานะใหม่ (interval เป็นวัน) */
export function applyReview(state, rating, at) {
  const q = RATINGS[rating].q;
  let { ease, interval, reps, lapses } = state;
  if (q < 3) {
    reps = 0;
    interval = 1;
    lapses += 1;
  } else {
    reps += 1;
    interval = reps === 1 ? 1 : reps === 2 ? 6 : Math.round(interval * ease);
    ease = Math.max(MIN_EASE, ease + (0.1 - (5 - q) * (0.08 + (5 - q) * 0.02)));
  }
  return { ease, interval, reps, lapses, due: at + interval * DAY, isNew: false };
}

const byTime = (a, b) => (a.at - b.at) || ((a.createdAt || 0) - (b.createdAt || 0)) || (a.id < b.id ? -1 : 1);

/** เล่น reviews ของบัตรใบเดียวซ้ำ → สถานะปัจจุบัน */
export function buildState(reviews) {
  return [...reviews].sort(byTime).reduce((s, r) => applyReview(s, r.rating, r.at), initialState());
}

/** Map cardId → state จากบัตรทั้งหมดและ reviews ทั้งหมด */
export function stateMap(cards, reviews) {
  const by = new Map();
  for (const r of reviews) {
    if (!by.has(r.cardId)) by.set(r.cardId, []);
    by.get(r.cardId).push(r);
  }
  return new Map(cards.map((c) => [c.id, by.has(c.id) ? buildState(by.get(c.id)) : initialState()]));
}

export const isDue = (state, now) => state.isNew || state.due <= now;

/** ระยะห่างครั้งถัดไป (วัน) ของแต่ละปุ่ม เรียงตาม RATINGS */
export function previewIntervals(state, now) {
  return RATINGS.map((r) => applyReview(state, r.value, now).interval);
}

export function formatInterval(days) {
  if (days < 1) return "<1 วัน";
  if (days < 14) return `${days} วัน`;
  if (days < 60) return `${Math.round(days / 7)} สัปดาห์`;
  if (days < 365) return `${Math.round(days / 30)} เดือน`;
  return `${(days / 365).toFixed(1)} ปี`;
}

// ---------- ตรวจคำตอบ ----------
export function normalize(s) {
  return String(s)
    .normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function levenshtein(a, b) {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[b.length];
}

/** คืน "correct" | "near" (ห่าง ≤ 2 ตัวอักษร) | "wrong" */
export function checkAnswer(input, expected) {
  const a = normalize(input), b = normalize(expected);
  if (a && a === b) return "correct";
  return a && levenshtein(a, b) <= 2 ? "near" : "wrong";
}

// ---------- ตรวจฟอร์มบัตร ----------
export function wordCount(s) {
  return (String(s).match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) || []).length;
}

/** คืนข้อความผิดพลาด หรือ null ถ้าผ่าน */
export function validateCard({ en, th, example }) {
  if (!String(en || "").trim()) return "กรอกคำภาษาอังกฤษ";
  if (!String(th || "").trim()) return "กรอกความหมายภาษาไทย";
  const n = wordCount(example || "");
  if (n < MIN_EXAMPLE_WORDS) {
    return `ประโยคตัวอย่างต้องมีอย่างน้อย ${MIN_EXAMPLE_WORDS} คำ (ตอนนี้มี ${n} คำ) — การจำเป็นวลี/ประโยคช่วยให้จำได้นานกว่าจำคำเดี่ยว ๆ (Chunking)`;
  }
  return null;
}

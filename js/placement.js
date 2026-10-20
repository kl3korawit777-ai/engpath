// ข้อสอบวัดระดับ (placement test) จากคลังกลาง — pure ไม่แตะ DB/DOM ทดสอบด้วย node ได้
// วิธีการ: ถามทีละระดับ (ง่าย → ยาก) ระดับละ PER_LEVEL ข้อ เลือกความหมายไทยที่ถูก 4 ตัวเลือก (+ “ยังไม่รู้”)
// หยุดเมื่อ “ไม่ผ่าน” ติดกัน STOP_AFTER ระดับ · ระดับที่แนะนำ = ระดับแรกที่ถูกน้อยกว่าเกณฑ์ (เริ่มเรียนตรงที่ยังไม่แน่น)

export const PER_LEVEL = 5;
export const STOP_AFTER = 2;
export const PASS_RATIO = 0.8;          // ถูก ≥ 80% ของระดับ = ผ่าน
export const CHOICES = 4;
export const MAX_TH_LEN = 40;           // เลี่ยงคำแปลยาวที่ทำให้ตัวเลือกดูต่างกันเกินจริง

/** rng ที่ตั้ง seed ได้ (ทดสอบซ้ำได้) */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

const mainTh = (w) => w.th[0]?.text?.trim() || "";
const usable = (w) => { const t = mainTh(w); return t && t.length <= MAX_TH_LEN; };

/**
 * สร้างข้อสอบ 1 ข้อ: choices มี CHOICES ข้อความ (ไม่ซ้ำกัน) answer = index ที่ถูก
 * pool = คำที่ใช้เป็นตัวหลอก (เรียงกี่ระดับก็ได้) — เลือกชนิดคำเดียวกันก่อน
 */
export function buildQuestion(word, pool, rng) {
  const right = mainTh(word);
  const seen = new Set([right]);
  const pickFrom = (list) => {
    const out = [];
    for (const w of shuffle(list, rng)) {
      if (out.length >= CHOICES - 1 - extra.length) break;
      if (w.wordKey === word.wordKey || !usable(w)) continue;
      const t = mainTh(w);
      if (seen.has(t)) continue;
      seen.add(t); out.push(t);
    }
    return out;
  };
  const extra = [];
  extra.push(...pickFrom(pool.filter((w) => w.pos[0] === word.pos[0])));
  if (extra.length < CHOICES - 1) extra.push(...pickFrom(pool));
  if (extra.length < CHOICES - 1) return null;
  const choices = shuffle([right, ...extra], rng);
  return { wordKey: word.wordKey, word: word.word, ipa: word.ipa || "", level: word.level, choices, answer: choices.indexOf(right) };
}

/** เลือกข้อสอบของระดับหนึ่ง n ข้อ (คำไม่ซ้ำ) — levelWords = คำของระดับนั้น, pool = ตัวหลอก */
export function levelQuestions(levelWords, pool, n, rng) {
  const out = [];
  for (const w of shuffle(levelWords.filter(usable), rng)) {
    if (out.length >= n) break;
    const q = buildQuestion(w, pool, rng);
    if (q) out.push(q);
  }
  return out;
}

/** results: [{ level, correct }] ตามลำดับที่ตอบ → สรุปต่อระดับ */
export function byLevel(results) {
  const m = new Map();
  for (const r of results) {
    const e = m.get(r.level) || { level: r.level, correct: 0, total: 0 };
    e.total += 1; if (r.correct) e.correct += 1;
    m.set(r.level, e);
  }
  return [...m.values()].sort((a, b) => a.level - b.level);
}

export const passed = (e, perLevel = PER_LEVEL) => e.total >= perLevel && e.correct / e.total >= PASS_RATIO;

/**
 * ขั้นถัดไป: { done:false, level } ระดับที่ต้องถามต่อ หรือ { done:true } เมื่อควรหยุด
 * ถามทีละระดับจนครบ perLevel ข้อ แล้วค่อยตัดสินว่าจะไประดับถัดไปหรือหยุด
 */
export function nextStep(results, { levelCount, perLevel = PER_LEVEL, stopAfter = STOP_AFTER } = {}) {
  const per = new Map(byLevel(results).map((e) => [e.level, e]));
  let fails = 0;
  for (let l = 1; l <= levelCount; l++) {
    const e = per.get(l);
    if (!e || e.total < perLevel) return { done: false, level: l };
    fails = passed(e, perLevel) ? 0 : fails + 1;
    if (fails >= stopAfter) return { done: true };
  }
  return { done: true };
}

/**
 * ผลสรุป: startLevel = ระดับแรกที่ไม่ผ่าน (ถ้าผ่านทุกระดับที่ถาม = ระดับสุดท้าย)
 * confidence: low ถ้าตอบน้อย (< 2 ระดับ) หรือผลสลับ (ผ่านหลังระดับที่ไม่ผ่าน)
 */
export function estimate(results, { levelCount, perLevel = PER_LEVEL } = {}) {
  const levels = byLevel(results).filter((e) => e.total >= perLevel);
  if (!levels.length) return { startLevel: 1, byLevel: byLevel(results), confidence: "low", answered: results.length };
  const firstFail = levels.find((e) => !passed(e, perLevel));
  const startLevel = firstFail ? firstFail.level : Math.min(levelCount, levels.at(-1).level + (levels.at(-1).level < levelCount ? 1 : 0));
  const lateRecover = firstFail ? levels.some((e) => e.level > firstFail.level && passed(e, perLevel)) : false;
  return { startLevel, byLevel: byLevel(results), confidence: levels.length < 2 || lateRecover ? "low" : "ok", answered: results.length };
}

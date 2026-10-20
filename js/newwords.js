// เลือกคำใหม่ประจำวันจากคลังกลาง (pure — ไม่แตะ DB/DOM)
// ความคืบหน้าเก็บเป็นบัตรใน collection cards โดย id = wordKey ของคลัง:
//   { id, wordKey, source:"library", level, rank, status:"learning"|"known", addedDay:"YYYY-MM-DD" }
//   "known" = ผู้ใช้กด “รู้แล้ว” (ข้ามคำ) — ไม่เข้ารอบทบทวน และไม่นับโควตาคำใหม่ของวัน

export const PER_DAY_OPTIONS = [5, 10, 15, 20, 30];
export const DEFAULT_PER_DAY = 10;
export const MAX_LEVEL = 11;
export const DEFAULT_LEVELS = [1];

const isInt = (n) => Number.isInteger(n);

/** แผนการเลือกคำจาก settings (ค่าที่ผิดรูปแบบถูกแทนด้วยค่าเริ่มต้น เพราะ settings ซิงก์ข้ามเครื่อง/อาจถูกแก้) */
export function normalizePlan(settings = {}, { maxLevel = MAX_LEVEL, tagList = [] } = {}) {
  const perDay = PER_DAY_OPTIONS.includes(settings.newPerDay) ? settings.newPerDay : DEFAULT_PER_DAY;
  const lv = Array.isArray(settings.vocabLevels) ? [...new Set(settings.vocabLevels.filter((n) => isInt(n) && n >= 1 && n <= maxLevel))].sort((a, b) => a - b) : [];
  const tags = Array.isArray(settings.vocabTags) ? [...new Set(settings.vocabTags.filter((t) => typeof t === "string" && (!tagList.length || tagList.includes(t))))] : [];
  return { perDay, levels: lv.length ? lv : [...DEFAULT_LEVELS], tags };
}

/** บัตรจากคลัง (ทุกสถานะ ไม่รวมที่ลบ) */
export const isLibraryCard = (c) => Boolean(c?.wordKey) && c.source === "library";

/** wordKey ที่ถูกใช้ไปแล้ว (กำลังเรียนหรือข้าม) — ไม่นำมาเสนอซ้ำ */
export function takenKeys(cards) {
  return new Set(cards.filter(isLibraryCard).map((c) => c.wordKey));
}

/** จำนวนคำใหม่ที่เริ่มเรียนในวันนั้น (การกด “รู้แล้ว” ไม่นับ) */
export function addedOn(cards, day) {
  return cards.filter((c) => isLibraryCard(c) && c.status === "learning" && c.addedDay === day).length;
}

export const quotaLeft = (perDay, added) => Math.max(0, perDay - added);

/** คำถัดไปตามลำดับ rank ที่ตรงกับแผนและยังไม่เคยใช้ (words ต้องเรียงตาม rank อยู่แล้ว) */
export function candidates(words, { taken, plan, limit }) {
  const lv = new Set(plan.levels);
  const out = [];
  for (const w of words) {
    if (out.length >= limit) break;
    if (!lv.has(w.level) || taken.has(w.wordKey)) continue;
    if (plan.tags.length && !w.tags.some((t) => plan.tags.includes(t))) continue;
    out.push(w);
  }
  return out;
}

/** ฟิลด์ของบัตรความคืบหน้า (ยังไม่รวม createdAt/updatedAt/deleted ที่ db ใส่ให้) */
export function cardFields(word, day, status = "learning") {
  return { id: word.wordKey, wordKey: word.wordKey, source: "library", level: word.level, rank: word.rank, status, addedDay: day };
}

/** จำนวนคำที่ยังเหลือให้เรียนตามแผน (ไม่นับที่ใช้ไปแล้ว) */
export function remainingCount(words, { taken, plan }) {
  const lv = new Set(plan.levels);
  let n = 0;
  for (const w of words) {
    if (!lv.has(w.level) || taken.has(w.wordKey)) continue;
    if (plan.tags.length && !w.tags.some((t) => plan.tags.includes(t))) continue;
    n++;
  }
  return n;
}

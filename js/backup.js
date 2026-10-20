// Export / Import แบบ pure (ไม่แตะ Firestore) — db.js เป็นคนเขียนจริง
import { CATEGORIES } from "./errlog.js";
import { wordKey } from "./lexicon.js";
import { LEVELS, STYLES } from "./handwriting-core.js";
import { isValidReview } from "./journal.js";
import { isValidLinkDoc } from "./links.js";
import { isValidFamily } from "./graph.js";
import { isValidSession } from "./interleave.js";
import { isValidQuestionDoc, isValidExamSet, isValidAttempt } from "./exam.js";

export const COLLECTIONS = ["settings", "cards", "errors", "smartFolders", "handwritingWords", "clips", "playlists", "reviews", "sessions", "errorEvents", "checkpoints", "practiceEvents", "handwritingAttempts", "handwritingImages", "shadowingEvents", "readings", "journal", "links", "wordFamilies", "interleavingSessions", "questions", "examSets", "examAttempts"];
const EVENT_COLS = new Set(["reviews", "sessions", "errorEvents", "checkpoints", "practiceEvents", "shadowingEvents", "handwritingAttempts", "handwritingImages", "readings"]);
export const FORMAT = { app: "engpath", version: 1 };

export const SESSION_SKILLS = ["srs", "input", "output", "weak", "shadowing", "writing", "journal"];

const num = (v) => typeof v === "number" && Number.isFinite(v);
const str = (v) => typeof v === "string";

// บัตรจากคลังกลาง: เก็บเฉพาะความคืบหน้า (id = wordKey) · บัตรเดิม (เพิ่มเอง) มี en/th/example ครบ
const libraryCardOk = (d) => str(d.wordKey) && d.id === d.wordKey && ["learning", "known"].includes(d.status)
  && Number.isInteger(d.level) && Number.isInteger(d.rank) && (d.note === undefined || (typeof d.note === "string" && d.note.length <= 5000));
const legacyCardOk = (d) => str(d.en) && str(d.th) && str(d.example) && (d.ipa === undefined || str(d.ipa)) && (d.tags === undefined || (Array.isArray(d.tags) && d.tags.every(str)));
const CHECK = {
  settings: (d) => d.id === "main"
    && (d.stage === undefined || (Number.isInteger(d.stage) && d.stage >= 0 && d.stage <= 5))
    && (d.dailyMinutes === undefined || (Number.isInteger(d.dailyMinutes) && d.dailyMinutes >= 10 && d.dailyMinutes <= 240))
    && (d.checkpointWeeks === undefined || (Number.isInteger(d.checkpointWeeks) && d.checkpointWeeks >= 1 && d.checkpointWeeks <= 12))
    && (d.onboarding === undefined || (d.onboarding !== null && typeof d.onboarding === "object" && !Array.isArray(d.onboarding)))
    && (d.handwritingStyle === undefined || STYLES.includes(d.handwritingStyle))
    && (d.focus === undefined || (d.focus !== null && typeof d.focus === "object" && !Array.isArray(d.focus)))
    && (d.criteria === undefined || (d.criteria !== null && typeof d.criteria === "object" && !Array.isArray(d.criteria))),
  cards: (d) => (d.source === "library" ? libraryCardOk(d) : legacyCardOk(d)),
  errors: (d) => str(d.wrong) && str(d.right) && CATEGORIES.includes(d.category) && (d.note === undefined || str(d.note)),
  smartFolders: (d) => str(d.name) && d.name.length <= 100 && d.conditions !== null && typeof d.conditions === "object" && !Array.isArray(d.conditions),
  reviews: (d) => str(d.cardId) && Number.isInteger(d.rating) && d.rating >= 0 && d.rating <= 3 && num(d.at),
  sessions: (d) => num(d.start) && num(d.end) && num(d.durationSec) && SESSION_SKILLS.includes(d.skill),
  practiceEvents: (d) => str(d.errorId) && ["choose", "recall", "cloze"].includes(d.drill) && typeof d.correct === "boolean" && num(d.at) && (d.ai === undefined || typeof d.ai === "boolean"),
  clips: (d) => str(d.title) && d.title.length <= 120 && ["youtube", "file"].includes(d.type) && str(d.url) && d.url.length <= 2000
    && (d.start === undefined || (num(d.start) && d.start >= 0)) && (d.end === undefined || d.end === null || num(d.end))
    && Array.isArray(d.sentences) && d.sentences.length <= 2000 && d.sentences.every((s) => s && str(s.text) && s.text.length <= 1500 && (s.t === null || s.t === undefined || num(s.t))),
  readings: (d) => num(d.at) && str(d.source) && d.source.length <= 200 && (d.level === "" || LEVELS.includes(d.level))
    && Number.isInteger(d.totalWords) && d.totalWords >= 0 && Number.isInteger(d.unknownCount) && d.unknownCount >= 0 && num(d.unknownPct) && d.unknownPct >= 0
    && Array.isArray(d.unknownWords) && d.unknownWords.length <= 50 && d.unknownWords.every(str) && num(d.durationSec) && d.durationSec >= 0,
  journal: (d) => typeof d.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(d.date) && str(d.text) && d.text.length <= 20000
    && (d.corrected === undefined || (str(d.corrected) && d.corrected.length <= 25000))
    && (d.wordCount === undefined || (Number.isInteger(d.wordCount) && d.wordCount >= 0)) && (d.sentenceCount === undefined || (Number.isInteger(d.sentenceCount) && d.sentenceCount >= 0))
    && (d.review === undefined || (isValidReview(d.review) && (d.review.forText === undefined || str(d.review.forText)))),
  links: (d) => isValidLinkDoc(d),
  wordFamilies: (d) => isValidFamily(d),
  interleavingSessions: (d) => isValidSession(d),
  questions: (d) => isValidQuestionDoc(d),
  examSets: (d) => isValidExamSet(d),
  examAttempts: (d) => isValidAttempt(d),
  playlists: (d) => str(d.name) && d.name.length <= 60 && Array.isArray(d.clipIds) && d.clipIds.every(str),
  shadowingEvents: (d) => str(d.clipId) && d.kind === "round" && num(d.at),
  handwritingWords: (d) => str(d.text) && d.text.length <= 60 && ["manual", "shadowing"].includes(d.source),
  handwritingAttempts: (d) => str(d.wordKey) && STYLES.includes(d.style) && LEVELS.includes(d.level) && num(d.at)
    && ((num(d.score) && d.score >= 0 && d.score <= 100) || (Number.isInteger(d.selfRating) && d.selfRating >= 0 && d.selfRating <= 2)),
  handwritingImages: (d) => str(d.attemptId) && str(d.dataUrl) && d.dataUrl.startsWith("data:image/jpeg;base64,") && d.dataUrl.length <= 45000,
  checkpoints: (d) => num(d.at) && Number.isInteger(d.stage) && d.stage >= 0 && d.stage <= 5 && typeof d.passed === "boolean" && d.scores !== null && typeof d.scores === "object" && !Array.isArray(d.scores),
  errorEvents: (d) => str(d.errorId) && ["occurred", "resolved", "reopened"].includes(d.type) && num(d.at),
};

export function isValidDoc(col, d) {
  if (!d || typeof d !== "object" || Array.isArray(d)) return false;
  if (!str(d.id) || !d.id || d.id.length > 128 || d.id.includes("/")) return false;
  if (!num(d.createdAt) || !num(d.updatedAt) || typeof d.deleted !== "boolean") return false;
  if (JSON.stringify(d).length > (col === "handwritingImages" ? 60000 : 20000)) return false;
  return CHECK[col](d);
}

/** collections: { col: Doc[] } (รวมที่ถูกลบ) */
export function buildExport(collections, now) {
  return { ...FORMAT, exportedAt: now, collections: Object.fromEntries(COLLECTIONS.map((c) => [c, collections[c] || []])) };
}

/**
 * existing: { col: Map(id → doc) }
 * - events (ต่อท้ายอย่างเดียว): เขียนเฉพาะ id ที่ยังไม่มี
 * - ข้อมูลแก้ไขได้: เขียนเมื่อยังไม่มี หรือไฟล์ใหม่กว่า (updatedAt มากกว่า) — ไม่ทับข้อมูลที่ใหม่กว่าในเครื่อง
 */
export function planImport(json, existing) {
  if (!json || json.app !== FORMAT.app || typeof json.collections !== "object" || json.collections === null) {
    throw new Error("ไฟล์นี้ไม่ใช่ข้อมูลสำรองของ EngPath");
  }
  if (json.version !== FORMAT.version) throw new Error(`รุ่นของไฟล์ (${json.version}) ไม่รองรับ`);
  const writes = [];
  const skipped = { existing: 0, invalid: 0 };
  for (const col of COLLECTIONS) {
    const arr = json.collections[col];
    if (arr === undefined) continue;
    if (!Array.isArray(arr)) throw new Error(`ข้อมูล ${col} ในไฟล์ผิดรูปแบบ`);
    const seen = new Set();
    for (const d of arr) {
      if (!isValidDoc(col, d) || seen.has(d.id)) { skipped.invalid++; continue; }
      seen.add(d.id);
      const cur = existing[col] && existing[col].get(d.id);
      if (cur && (EVENT_COLS.has(col) || cur.updatedAt >= d.updatedAt)) { skipped.existing++; continue; }
      writes.push({ col, doc: d });
    }
  }
  return { writes, skipped };
}

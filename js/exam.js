// คลังข้อสอบ + โหมดสอบจับเวลา แบบ pure — แอปเป็น "เครื่องมือทำข้อสอบ": ผู้ใช้นำเข้าข้อสอบเองจากแหล่งที่ตนมีสิทธิ์ใช้ ไม่มีข้อสอบจริง/ลิขสิทธิ์ในโค้ด
import { normalize } from "./srs.js";
import { dayKey } from "./streak.js";

export const SECTIONS = { reading: "Reading", grammar: "Grammar", vocab: "Vocabulary", conversation: "Conversation" };
export const LIMITS = { question: 3000, option: 300, explanation: 2000, setName: 80, source: 120, minOptions: 2, maxOptions: 6, importRows: 2000, examMax: 200 };
export const SAMPLE_SOURCE = "ตัวอย่าง";                       // ข้อสอบตัวอย่างในไฟล์ template ต้องมีป้ายนี้ ลบได้ในคลัง
const LETTERS = "ABCDEF";

// ---------- ตรวจข้อสอบหนึ่งข้อ ----------
const str = (x) => (x == null ? "" : String(x)).trim();

/**
 * raw = { question, options[], answer, explanation?, section, set?, source? }
 * answer = ตัวอักษร A–F (ตามลำดับตัวเลือก) หรือข้อความตรงกับตัวเลือก (ไม่สนตัวพิมพ์/เครื่องหมาย)
 * คืน { q } (รูปแบบที่เก็บ: answer เป็นข้อความของตัวเลือกที่ถูก) หรือ { error } เป็นข้อความไทย
 */
export function validateQuestion(raw) {
  const question = str(raw.question);
  if (!question) return { error: "ไม่มีคำถาม" };
  if (question.length > LIMITS.question) return { error: `คำถามยาวเกิน ${LIMITS.question} ตัวอักษร` };
  const options = (Array.isArray(raw.options) ? raw.options : []).map(str).filter(Boolean);
  if (options.length < LIMITS.minOptions) return { error: `ต้องมีตัวเลือกอย่างน้อย ${LIMITS.minOptions} ข้อ` };
  if (options.length > LIMITS.maxOptions) return { error: `ตัวเลือกได้สูงสุด ${LIMITS.maxOptions} ข้อ` };
  if (options.some((o) => o.length > LIMITS.option)) return { error: `ตัวเลือกยาวเกิน ${LIMITS.option} ตัวอักษร` };
  if (new Set(options.map(normalize)).size !== options.length) return { error: "มีตัวเลือกที่ซ้ำกัน" };
  const a = str(raw.answer);
  if (!a) return { error: "ไม่ได้ระบุคำตอบที่ถูก" };
  let answer = null;
  if (/^[A-Fa-f]$/.test(a)) {
    const i = LETTERS.indexOf(a.toUpperCase());
    if (i >= options.length) return { error: `คำตอบ ${a.toUpperCase()} เกินจำนวนตัวเลือก (${options.length} ข้อ)` };
    answer = options[i];
  } else {
    answer = options.find((o) => o === a) ?? options.find((o) => normalize(o) === normalize(a) && normalize(a) !== "") ?? null;
    if (answer == null) return { error: `คำตอบ “${a.slice(0, 40)}” ไม่ตรงกับตัวเลือกใดเลย (ใส่ตัวอักษร A–F หรือข้อความตัวเลือกให้ตรง)` };
  }
  const section = str(raw.section).toLowerCase();
  if (!SECTIONS[section]) return { error: `ส่วนต้องเป็นหนึ่งใน ${Object.keys(SECTIONS).join(" / ")} (ได้ “${str(raw.section)}”)` };
  const explanation = str(raw.explanation);
  if (explanation.length > LIMITS.explanation) return { error: `คำอธิบายยาวเกิน ${LIMITS.explanation} ตัวอักษร` };
  const setName = str(raw.set ?? raw.setName), source = str(raw.source);
  if (setName.length > LIMITS.setName) return { error: `ชื่อชุดยาวเกิน ${LIMITS.setName} ตัวอักษร` };
  if (source.length > LIMITS.source) return { error: `แหล่งที่มายาวเกิน ${LIMITS.source} ตัวอักษร` };
  return { q: { question, options, answer, explanation, section, setName, source } };
}

export const questionKey = (q) => `${normalize(q.question)}|${[...q.options].map(normalize).sort().join("|")}`;

// ---------- CSV ----------
const ALIASES = {
  question: ["question", "คำถาม"], answer: ["answer", "คำตอบ"], explanation: ["explanation", "คำอธิบาย"],
  section: ["section", "ส่วน"], set: ["set", "ชุด", "ชุดข้อสอบ"], source: ["source", "แหล่งที่มา", "แหล่ง"],
};
const OPTION_HEAD = LETTERS.split("").map((l) => [`option_${l.toLowerCase()}`, `ตัวเลือก_${l.toLowerCase()}`, `choice_${l.toLowerCase()}`]);
export const CSV_HEADER = ["question", "option_a", "option_b", "option_c", "option_d", "option_e", "option_f", "answer", "explanation", "section", "set", "source"];

/** แยก CSV (RFC 4180: เครื่องหมายคำพูด, "" = ", ขึ้นบรรทัดในช่อง) → { rows: [{ line, cells }], delimiter } line = บรรทัดที่ระเบียนเริ่ม (เริ่มที่ 1) */
export function parseCsv(text) {
  const src = String(text ?? "").replace(/^﻿/, "");
  const firstLine = src.split(/\r?\n/, 1)[0];
  const counts = [",", "\t", ";"].map((d) => [d, firstLine.split(d).length - 1]).sort((a, b) => b[1] - a[1]);      // เดาตัวคั่นจากบรรทัดหัวตาราง
  const delimiter = counts[0][1] ? counts[0][0] : ",";
  const rows = [];
  let cells = [], cell = "", inQ = false, line = 1, startLine = 1, i = 0, any = false;
  const endCell = () => { cells.push(cell); cell = ""; };
  const endRow = () => { endCell(); if (any || cells.some((c) => c !== "")) rows.push({ line: startLine, cells }); cells = []; any = false; };
  while (i < src.length) {
    const ch = src[i];
    if (inQ) {
      if (ch === '"') { if (src[i + 1] === '"') { cell += '"'; i += 2; continue; } inQ = false; i++; continue; }
      if (ch === "\n") line++;
      cell += ch; i++; continue;
    }
    if (ch === '"' && cell === "") { inQ = true; any = true; i++; continue; }
    if (ch === delimiter) { endCell(); any = true; i++; continue; }
    if (ch === "\r") { i++; continue; }
    if (ch === "\n") { endRow(); line++; startLine = line; i++; continue; }
    cell += ch; i++;
  }
  if (inQ) rows.push({ line: startLine, cells: [...cells, cell], unterminated: true });
  else if (cell !== "" || cells.length) endRow();
  return { rows, delimiter };
}

function headerMap(cells) {
  const idx = {};
  cells.forEach((raw, i) => {
    const h = str(raw).toLowerCase().replace(/\s+/g, "_");
    for (const [k, names] of Object.entries(ALIASES)) if (names.includes(h)) idx[k] = i;
    OPTION_HEAD.forEach((names, n) => { if (names.includes(h)) (idx.options ||= [])[n] = i; });
  });
  return idx;
}

/**
 * นำเข้า CSV: ตรวจทุกแถว คืน { questions (ที่ผ่าน), errors: [{ line, message }], skippedDuplicates, total }
 * ไม่เขียนอะไรเอง — ผู้เรียกแสดงรายงานแล้วให้ผู้ใช้ยืนยันก่อนนำเข้าเฉพาะแถวที่ถูกต้อง
 */
export function importCsv(text, existing = []) {
  const { rows } = parseCsv(text);
  const errors = [];
  if (!rows.length) return { questions: [], errors: [{ line: 1, message: "ไฟล์ว่าง" }], skippedDuplicates: 0, total: 0 };
  const idx = headerMap(rows[0].cells);
  const missing = ["question", "answer", "section"].filter((k) => idx[k] === undefined);
  const optCols = (idx.options || []).filter((x) => x !== undefined);
  if (optCols.length < 2) missing.push("option_a, option_b (อย่างน้อย 2 ตัวเลือก)");
  if (missing.length) return { questions: [], errors: [{ line: rows[0].line, message: `หัวตารางบรรทัดแรกขาดคอลัมน์: ${missing.join(", ")} (ดาวน์โหลด template เพื่อดูรูปแบบ)` }], skippedDuplicates: 0, total: 0 };
  const body = rows.slice(1);
  if (body.length > LIMITS.importRows) return { questions: [], errors: [{ line: 1, message: `นำเข้าได้ครั้งละไม่เกิน ${LIMITS.importRows} ข้อ (ไฟล์มี ${body.length} แถว) — แบ่งไฟล์แล้วนำเข้าทีละส่วน` }], skippedDuplicates: 0, total: body.length };
  const seen = new Set(existing.map(questionKey));
  const out = [];
  let dup = 0;
  for (const r of body) {
    if (r.unterminated) { errors.push({ line: r.line, message: "เครื่องหมายคำพูด \" ไม่ปิด" }); continue; }
    const c = r.cells;
    const raw = {
      question: c[idx.question], answer: c[idx.answer], section: c[idx.section], explanation: idx.explanation !== undefined ? c[idx.explanation] : "",
      set: idx.set !== undefined ? c[idx.set] : "", source: idx.source !== undefined ? c[idx.source] : "",
      options: (idx.options || []).map((col) => (col === undefined ? "" : c[col])),
    };
    const v = validateQuestion(raw);
    if (v.error) { errors.push({ line: r.line, message: v.error }); continue; }
    const k = questionKey(v.q);
    if (seen.has(k)) { dup++; continue; }
    seen.add(k);
    out.push(v.q);
  }
  return { questions: out, errors, skippedDuplicates: dup, total: body.length };
}

// ---------- JSON ----------
/** รับอาร์เรย์ หรือ { questions: [] }; รายการแต่ละข้อใช้ options เป็นอาร์เรย์ หรือ option_a…option_f; ระบุตำแหน่งเป็น "รายการที่ N" */
export function importJson(text, existing = []) {
  let data;
  try { data = JSON.parse(String(text ?? "").replace(/^﻿/, "")); } catch (e) { return { questions: [], errors: [{ line: null, message: `อ่าน JSON ไม่ได้: ${e.message}` }], skippedDuplicates: 0, total: 0 }; }
  const list = Array.isArray(data) ? data : Array.isArray(data?.questions) ? data.questions : null;
  if (!list) return { questions: [], errors: [{ line: null, message: "JSON ต้องเป็นอาร์เรย์ของข้อสอบ หรือออบเจ็กต์ที่มี questions เป็นอาร์เรย์" }], skippedDuplicates: 0, total: 0 };
  if (list.length > LIMITS.importRows) return { questions: [], errors: [{ line: null, message: `นำเข้าได้ครั้งละไม่เกิน ${LIMITS.importRows} ข้อ (มี ${list.length})` }], skippedDuplicates: 0, total: list.length };
  const errors = [], seen = new Set(existing.map(questionKey)), out = [];
  let dup = 0;
  list.forEach((x, n) => {
    if (!x || typeof x !== "object" || Array.isArray(x)) { errors.push({ line: null, index: n + 1, message: "รายการนี้ไม่ใช่ออบเจ็กต์" }); return; }
    const options = Array.isArray(x.options) ? x.options : LETTERS.split("").map((l) => x[`option_${l.toLowerCase()}`]);
    const v = validateQuestion({ ...x, options });
    if (v.error) { errors.push({ line: null, index: n + 1, message: v.error }); return; }
    const k = questionKey(v.q);
    if (seen.has(k)) { dup++; return; }
    seen.add(k); out.push(v.q);
  });
  return { questions: out, errors, skippedDuplicates: dup, total: list.length };
}

/** ตรวจรูปแบบอัตโนมัติจากเนื้อหา/นามสกุล */
export function importAuto(text, filename = "", existing = []) {
  const t = String(text ?? "").trimStart();
  const isJson = /\.json$/i.test(filename) || t.startsWith("[") || t.startsWith("{");
  return { format: isJson ? "json" : "csv", ...(isJson ? importJson(text, existing) : importCsv(text, existing)) };
}

export const describeError = (e) => (e.line != null ? `บรรทัด ${e.line}: ${e.message}` : e.index != null ? `รายการที่ ${e.index}: ${e.message}` : e.message);

// ---------- template (ตัวอย่างเขียนเอง ติดป้ายและลบได้) ----------
export const SAMPLE_QUESTIONS = [
  { question: "She ____ to school every day.", options: ["go", "goes", "going", "gone"], answer: "B", explanation: "ประธานเอกพจน์บุรุษที่ 3 ใน Present Simple ใช้กริยาเติม s/es", section: "grammar", set: "ตัวอย่าง", source: SAMPLE_SOURCE },
  { question: "Choose the word closest in meaning to “rapid”.", options: ["slow", "quick", "heavy", "quiet"], answer: "quick", explanation: "rapid = เร็ว ใกล้เคียงกับ quick", section: "vocab", set: "ตัวอย่าง", source: SAMPLE_SOURCE },
  { question: "A: Thanks for your help.\nB: ____", options: ["You're welcome.", "I'm fine, thanks.", "See you later.", "Nice to meet you."], answer: "A", explanation: "ตอบรับคำขอบคุณด้วย You're welcome.", section: "conversation", set: "ตัวอย่าง", source: SAMPLE_SOURCE },
];

const csvCell = (s) => (/[",\n\r\t;]/.test(s) ? `"${String(s).replace(/"/g, '""')}"` : String(s));
export function templateCsv() {
  const rows = SAMPLE_QUESTIONS.map((q) => [q.question, ...Array.from({ length: 6 }, (_, i) => q.options[i] || ""), q.answer, q.explanation, q.section, q.set, q.source]);
  return "﻿" + [CSV_HEADER, ...rows].map((r) => r.map(csvCell).join(",")).join("\r\n") + "\r\n";
}
export const templateJson = () => JSON.stringify(SAMPLE_QUESTIONS, null, 2);

// ---------- สร้างชุดสอบ ----------
function shuffle(arr, rng) { const a = [...arr]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; }

/** กรองคลังตามชุด/ส่วนของ config (setName ว่าง = ทุกชุด · sections ว่าง = ทุกส่วน) */
export function matchingQuestions(questions, config) {
  const secs = new Set(config.sections || []);
  return questions.filter((q) => !q.deleted && (!config.setName || q.setName === config.setName) && (!secs.size || secs.has(q.section)));
}

/** สุ่มตามจำนวน แล้วเรียงตามส่วน (ลำดับ reading → grammar → vocab → conversation) ภายในส่วนสุ่ม; ตัวเลือกคงลำดับตามที่เขียนไว้ */
export function buildExam(questions, config, rng = Math.random) {
  const avail = matchingQuestions(questions, config);
  const n = Math.min(Math.max(1, Math.floor(config.count || 1)), LIMITS.examMax, avail.length);
  const order = Object.keys(SECTIONS);
  const picked = shuffle(avail, rng).slice(0, n).sort((a, b) => order.indexOf(a.section) - order.indexOf(b.section));
  return { items: picked.map((q) => ({ qid: q.id, section: q.section, question: q.question, options: q.options, answer: q.answer, explanation: q.explanation || "" })), requested: config.count, available: avail.length };
}

export function validateConfig(c) {
  const count = Number(c.count), minutes = Number(c.minutes);
  if (!Number.isInteger(count) || count < 1 || count > LIMITS.examMax) return `จำนวนข้อต้องเป็นจำนวนเต็ม 1–${LIMITS.examMax}`;
  if (!Number.isInteger(minutes) || minutes < 1 || minutes > 600) return "เวลาต้องเป็นจำนวนเต็ม 1–600 นาที";
  if (c.targetPercent != null && c.targetPercent !== "" && !(Number(c.targetPercent) > 0 && Number(c.targetPercent) <= 100)) return "เป้าคะแนนต้องอยู่ระหว่าง 1–100%";
  for (const s of c.sections || []) if (!SECTIONS[s]) return "ส่วนไม่ถูกต้อง";
  return null;
}

// ---------- จับเวลา / เวลาต่อข้อ ----------
export const remainingSec = (startAt, limitSec, now) => Math.max(0, Math.ceil(limitSec - (now - startAt) / 1000));
export const isTimeUp = (startAt, limitSec, now) => now - startAt >= limitSec * 1000;
export function clock(sec) {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
  return `${h ? `${h}:${String(m).padStart(2, "0")}` : String(m)}:${String(s % 60).padStart(2, "0")}`;
}

/** ตัวติดตามเวลาต่อข้อ: เวลาที่อยู่ในแต่ละข้อ (วินาที, ทศนิยมได้) — enter(i, now) ปิดข้อก่อนหน้าแล้วเริ่มข้อใหม่ */
export function createTracker(n, now) { return { sec: Array(n).fill(0), cur: 0, since: now }; }
export function enter(t, i, now) { t.sec[t.cur] += Math.max(0, (now - t.since) / 1000); t.cur = i; t.since = now; return t; }
export function finalize(t, now) { t.sec[t.cur] += Math.max(0, (now - t.since) / 1000); t.since = now; return t.sec.map((x) => Math.round(x * 10) / 10); }

// ---------- ให้คะแนน ----------
/** answers[i] = ข้อความตัวเลือกที่เลือก หรือ null/undefined (ไม่ได้ตอบ = ผิด) */
export function scoreExam(items, answers, times = [], flags = []) {
  const results = items.map((it, i) => {
    const chosen = answers[i] ?? null;
    return { qid: it.qid, section: it.section, chosen, correct: chosen !== null && chosen === it.answer, sec: times[i] ?? 0, flagged: Boolean(flags[i]), skipped: chosen === null };
  });
  const bySection = Object.keys(SECTIONS).map((s) => {
    const r = results.filter((x) => x.section === s);
    return { section: s, total: r.length, correct: r.filter((x) => x.correct).length };
  }).filter((x) => x.total);
  const correct = results.filter((r) => r.correct).length;
  const total = items.length;
  return { total, correct, scorePct: total ? Math.round((correct / total) * 1000) / 10 : 0, bySection, results };
}

/** เอกสาร examAttempts (ต่อท้ายอย่างเดียว) */
export function attemptDoc({ config, start, end, limitSec, autoSubmitted, score }) {
  return {
    start, end, durationSec: Math.max(0, Math.round((end - start) / 1000)), limitSec, autoSubmitted: Boolean(autoSubmitted),
    config: { name: config.name || "", presetId: config.presetId || "", setName: config.setName || "", sections: [...(config.sections || [])], count: config.count, minutes: config.minutes, targetPercent: config.targetPercent ? Number(config.targetPercent) : null },
    total: score.total, correct: score.correct, scorePct: score.scorePct, bySection: score.bySection,
    items: score.results.map((r) => ({ qid: r.qid, section: r.section, chosen: r.chosen, correct: r.correct, sec: r.sec, flagged: r.flagged })),
  };
}

// ---------- เป้า "2 ครั้งติด" ----------
/** กุญแจ "ชุดสอบแนวเดียวกัน": preset เดียวกัน หรือชุด+ส่วน+จำนวน+เวลาเหมือนกัน */
export const configKey = (c) => (c.presetId ? `preset:${c.presetId}` : `${c.setName || "*"}|${[...(c.sections || [])].sort().join(",") || "*"}|${c.count}|${c.minutes}`);

/**
 * ผลสอบที่ตั้งเป้าไว้ เฉพาะ "ชุดแนวเดียวกับครั้งล่าสุด": last2 (ใหม่→เก่า), twoInARow, latest
 * attempts = เอกสาร examAttempts; ครั้งที่ไม่ตั้งเป้าไม่นับ
 */
export function targetStatus(attempts) {
  const withTarget = attempts.filter((a) => a.config?.targetPercent).sort((a, b) => b.start - a.start);
  if (!withTarget.length) return { key: null, last2: [], twoInARow: false, latest: null };
  const key = configKey(withTarget[0].config);
  const same = withTarget.filter((a) => configKey(a.config) === key);
  const last2 = same.slice(0, 2).map((a) => ({ at: a.start, score: a.scorePct, target: a.config.targetPercent, reached: a.scorePct >= a.config.targetPercent, name: a.config.name || "" }));
  return { key, last2, twoInARow: last2.length === 2 && last2.every((x) => x.reached), latest: last2[0] };
}

// ---------- ส่งข้อผิดเข้า Error Log ----------
export const CATEGORY_OF_SECTION = { grammar: "Grammar", vocab: "Word choice", reading: "Word choice", conversation: "Word choice" };

/** wrong = ตัวเลือกที่เลือก (หรือ “(ไม่ได้ตอบ)”), right = ตัวเลือกที่ถูก, note = โจทย์ย่อ + คำอธิบาย */
export function errorPayload(item, chosen, category) {
  const stem = item.question.replace(/\s+/g, " ").slice(0, 140);
  return { wrong: chosen ?? "(ไม่ได้ตอบ)", right: item.answer, category, note: `จากข้อสอบ: ${stem}${item.explanation ? ` — ${item.explanation}`.slice(0, 200) : ""}`.slice(0, 400) };
}

export const attemptLabel = (a) => `${dayKey(a.start)} · ${a.config?.name || a.config?.setName || "ทุกชุด"} · ${a.scorePct}%`;

// ---------- ตรวจรูปแบบเอกสาร (Import) ----------
export function isValidQuestionDoc(d) {
  const v = validateQuestion({ ...d, set: d.setName });
  return Boolean(d) && !v.error && v.q.answer === d.answer && v.q.question === d.question;
}
export function isValidExamSet(d) {
  return Boolean(d) && typeof d.name === "string" && d.name.trim() !== "" && d.name.length <= 80 && !validateConfig(d) && (d.setName === undefined || typeof d.setName === "string");
}
export function isValidAttempt(d) {
  const n = (x) => Number.isFinite(x) && x >= 0;
  return Boolean(d) && n(d.start) && n(d.end) && d.end >= d.start && n(d.durationSec) && n(d.limitSec) && typeof d.autoSubmitted === "boolean"
    && d.config && typeof d.config === "object" && Number.isInteger(d.total) && Number.isInteger(d.correct) && d.correct <= d.total && n(d.scorePct) && d.scorePct <= 100
    && Array.isArray(d.bySection) && Array.isArray(d.items) && d.items.length === d.total && d.items.length <= LIMITS.examMax
    && d.items.every((i) => i && typeof i.qid === "string" && SECTIONS[i.section] && typeof i.correct === "boolean" && (i.chosen === null || typeof i.chosen === "string") && n(i.sec));
}

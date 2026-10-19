// โหมดคละโจทย์ (Interleaving) แบบ pure: สร้างคลังโจทย์จากบัตรคำ / Error Log / คลังข้อสอบ แล้วจัดลำดับตามกฎ
// กฎ: ห้ามหัวข้อเดียวกันติดกันเกิน 2 ข้อ · สลับทักษะ (ไม่ซ้ำชนิดโจทย์ติดกันถ้ามีทางเลือก) · ไม่ซ้ำบัตร/ข้อผิดเดิมใกล้กัน
import { isDue, checkAnswer, normalize } from "./srs.js";
import { errorStats } from "./errlog.js";
import { buildDrills, checkExact, focusErrors } from "./practice.js";
import { cardTags } from "./library.js";

export const SIZE = { min: 10, max: 20, default: 12 };
export const MAX_TOPIC_RUN = 2;
export const KINDS = { meaning: "ความหมาย", spelling: "สะกด", choose: "เลือกแบบที่ถูก", cloze: "เติมคำ", recall: "พิมพ์แบบที่ถูก", exam: "ข้อสอบ" };
export const SOURCES = { card: "บัตรคำ", error: "Error Log", exam: "คลังข้อสอบ" };
export const RATING_OF = { correct: 2, near: 1, wrong: 0 };       // ผลตรวจ → คะแนน SM-2 (0 ลืม · 1 ยาก · 2 จำได้)

// ---------- ตัวสุ่มที่กำหนดผลได้ ----------
export function rngFrom(seed = 1) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function shuffle(arr, rng) {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// ---------- หัวข้อ ----------
/** หัวข้อของบัตร = แท็กชั้นบนสุดของแท็กแรก (science/biology → science); ไม่มีแท็ก = "-" */
export function topicOfCard(card) {
  const t = cardTags(card)[0];
  return `tag:${t ? t.split("/")[0] : "-"}`;
}

// ---------- ตัวเลือกการสะกด ----------
/** สะกดผิดแบบที่พบบ่อย: สลับตัวอักษรติดกัน / ตัดตัวอักษร / ซ้ำตัวอักษร / สลับสระ — ต่างจากคำเดิมเสมอ (หลัง normalize) */
export function misspell(word, rng, avoid = new Set()) {
  const w = String(word);
  const idx = [...w].map((c, i) => (/\p{L}/u.test(c) ? i : -1)).filter((i) => i > 0 && i < w.length - 1);     // ไม่แตะตัวแรก/ตัวสุดท้าย
  const vowels = "aeiou";
  for (let tries = 0; tries < 30 && idx.length; tries++) {
    const i = idx[Math.floor(rng() * idx.length)];
    const op = Math.floor(rng() * 4);
    let v = w;
    if (op === 0 && i + 1 < w.length - 1 && /\p{L}/u.test(w[i + 1])) v = w.slice(0, i) + w[i + 1] + w[i] + w.slice(i + 2);
    else if (op === 1 && w.length > 4) v = w.slice(0, i) + w.slice(i + 1);
    else if (op === 2) v = w.slice(0, i) + w[i] + w.slice(i);
    else if (vowels.includes(w[i].toLowerCase())) { const o = vowels.replace(w[i].toLowerCase(), ""); v = w.slice(0, i) + o[Math.floor(rng() * o.length)] + w.slice(i + 1); }
    if (normalize(v) !== normalize(w) && !avoid.has(v)) return v;
  }
  return null;
}

/** {options:[ถูก + ผิด 2 แบบ สลับที่], answer} หรือ null ถ้าคำสั้น/สร้างตัวหลอกไม่ได้ (เปลี่ยนเฉพาะคำที่ยาวที่สุดของวลี) */
export function spellingItem(en, rng) {
  const parts = String(en).trim().split(/\s+/);
  if (!/^[\p{L}'’-]+$/u.test(parts.join("")) || Math.max(...parts.map((p) => p.length)) < 5) return null;
  const longest = parts.reduce((bi, p, i) => (p.length > parts[bi].length ? i : bi), 0);
  const used = new Set([parts[longest]]), wrong = [];
  for (let k = 0; k < 6 && wrong.length < 2; k++) {
    const m = misspell(parts[longest], rng, used);
    if (m) { used.add(m); wrong.push(parts.map((p, i) => (i === longest ? m : p)).join(" ")); }
  }
  if (wrong.length < 2) return null;
  return { options: shuffle([en, ...wrong], rng), answer: en };
}

// ---------- คลังโจทย์ ----------
/**
 * คืนอาร์เรย์โจทย์: { key, src: card|error|exam, kind, topic, ref (id ของบัตร/ข้อผิด/ข้อสอบ), priority, ...เนื้อหา }
 * cards ที่ส่งเข้ามาควรกรองตามแท็กที่ผู้ใช้เลือกแล้ว · include = { card, error, exam } เปิด/ปิดแหล่ง
 */
export function buildPool({ cards = [], states = new Map(), allCards = cards, errors = [], errorEvents = [], focus = null, questions = [], include = { card: true, error: true, exam: true }, now = Date.now(), rng = Math.random }) {
  const pool = [];
  if (include.card) {
    for (const c of cards) {
      if (c.deleted) continue;
      const st = states.get(c.id);
      const priority = !st || st.isNew ? 0.5 : isDue(st, now) ? 3 : 1;
      const topic = topicOfCard(c);
      pool.push({ key: `card:${c.id}:meaning`, src: "card", kind: "meaning", topic, ref: c.id, priority, prompt: c.th, answer: c.en });
      const sp = spellingItem(c.en, rng);
      if (sp) pool.push({ key: `card:${c.id}:spelling`, src: "card", kind: "spelling", topic, ref: c.id, priority: priority - 0.2, prompt: c.th, options: sp.options, answer: sp.answer });
    }
  }
  if (include.error) {
    const stats = errorStats(errors, errorEvents);
    const focusIds = new Set((focus?.items || []).map((x) => x.error.id));
    for (const e of errors) {
      if (e.deleted || stats.get(e.id)?.resolved) continue;
      const priority = focusIds.has(e.id) ? 3 : 1.5;
      buildDrills(e, allCards, rng).forEach((d, i) => {
        pool.push({ key: `error:${e.id}:${d.type}:${i}`, src: "error", kind: d.type, topic: `cat:${e.category}`, ref: e.id, priority, cardId: d.cardId || null, ...d });
      });
    }
  }
  if (include.exam) {
    for (const q of questions) {
      if (q.deleted || !q.question || !Array.isArray(q.options) || q.options.length < 2 || !q.options.includes(q.answer)) continue;
      pool.push({ key: `exam:${q.id}`, src: "exam", kind: "exam", topic: `exam:${q.section || "-"}`, ref: q.id, priority: 1, prompt: q.question, options: shuffle(q.options, rng), answer: q.answer, explanation: q.explanation || "" });
    }
  }
  return pool;
}

// ---------- จัดลำดับ ----------
/** ตรวจกฎกับลำดับที่ได้ → { maxTopicRun, sameKindAdjacent, ok } */
export function checkRules(items) {
  let run = 0, maxRun = 0, adj = 0;
  items.forEach((it, i) => {
    run = i && items[i - 1].topic === it.topic ? run + 1 : 1;
    maxRun = Math.max(maxRun, run);
    if (i && items[i - 1].kind === it.kind) adj++;
  });
  return { maxTopicRun: maxRun, sameKindAdjacent: adj, ok: maxRun <= MAX_TOPIC_RUN };
}

/**
 * เลือกและเรียง n ข้อทีละก้าว: เลือกหัวข้อก่อน (กระจาย + ไม่ทำให้ที่เหลือจัดไม่ได้) แล้วเลือกข้อในหัวข้อนั้น
 * ห้ามหัวข้อเดียวกันครบ 3 ติด (กฎเด็ดขาด) · ชอบชนิดโจทย์ต่างจากข้อก่อนหน้า · ไม่ซ้ำบัตร/ข้อผิดเดิมใน 3 ข้อล่าสุด · ชอบ priority สูง (ถึงรอบ/จุดเน้น)
 * คืน { items, requested, short } — short = true ถ้าหาข้อที่ไม่ผิดกฎให้ครบไม่ได้ (หัวข้อหรือชนิดไม่หลากหลายพอ)
 */
export function sequence(pool, n = SIZE.default, rng = Math.random) {
  const want = Math.max(1, Math.min(SIZE.max, Math.floor(n)));
  // ตัดเหลือผู้สมัครที่ priority สูงสุด (ถึงรอบ/จุดเน้นก่อน) ราว 3 เท่าของที่ต้องการ แล้วค่อยจัดลำดับ
  const left = shuffle(pool, rng).sort((a, b) => b.priority - a.priority).slice(0, want * 3);
  const items = [];
  while (items.length < want && left.length) {
    const prev = items.at(-1), prev2 = items.at(-2);
    const blocked = prev && prev2 && prev.topic === prev2.topic ? prev.topic : null;      // ห้ามหัวข้อเดียวกันติดกันเกิน 2 ข้อ
    const count = new Map();
    for (const c of left) count.set(c.topic, (count.get(c.topic) || 0) + 1);
    // เลือกหัวข้อแบบกระจาย (ชอบหัวข้อต่างจากข้อก่อนหน้า สุ่มเล็กน้อย) แต่ห้ามเลือกก้าวที่ทำให้ที่เหลือจัดไม่ได้:
    // หัวข้อใหญ่สุดต้องไม่เกิน 2 เท่าของ (ที่เหลือหัวข้ออื่น + 1) ไม่งั้นจะต้องวางหัวข้อเดียวกันติดกันเกิน 2 ข้อในที่สุด
    const cands = [];
    for (const [t, n2] of count) {
      if (t === blocked) continue;
      let maxAfter = 0;
      for (const [u, m] of count) maxAfter = Math.max(maxAfter, u === t ? m - 1 : m);
      const others = left.length - 1 - maxAfter;
      cands.push({ t, n: n2, safe: maxAfter <= MAX_TOPIC_RUN * (others + 1) });
    }
    const pool2 = cands.some((c) => c.safe) ? cands.filter((c) => c.safe) : cands;       // ถ้าไม่มีทางจัดให้ครบได้ → เลือกหัวข้อที่เหลือมากสุดก่อน เพื่อให้ได้ลำดับยาวที่สุด
    const crowded = !cands.some((c) => c.safe);
    let topic = null, topicScore = -Infinity;
    for (const c of pool2) {
      const sc = crowded ? c.n + (prev && c.t !== prev.topic ? 0.5 : 0) + rng() * 0.1 : (prev && c.t !== prev.topic ? 1 : 0) + rng() * 0.5 + 0.15 * Math.min(c.n, 5);
      if (sc > topicScore) { topicScore = sc; topic = c.t; }
    }
    if (topic === null) break;
    // ในหัวข้อนั้น: ชอบ priority สูง, ชนิดโจทย์ต่างจากข้อก่อนหน้า, ไม่ซ้ำบัตร/ข้อผิดเดิมใน 3 ข้อล่าสุด
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < left.length; i++) {
      const c = left[i];
      if (c.topic !== topic) continue;
      let sc = c.priority * 2 + rng() * 0.5;
      if (prev && c.kind !== prev.kind) sc += 3;
      if (items.slice(-3).some((x) => x.ref === c.ref && x.src === c.src)) sc -= 4;
      if (sc > bestScore) { bestScore = sc; best = i; }
    }
    items.push(left.splice(best, 1)[0]);
  }
  return { items, requested: want, short: items.length < want };
}

// ---------- ตรวจคำตอบ / บันทึกผลกลับต้นทาง ----------
/** ตรวจคำตอบ → { result: "correct"|"near"|"wrong", correct } (near มีเฉพาะข้อความหมายที่พิมพ์ตอบ) */
export function judge(item, input) {
  if (item.options) { const ok = input === item.answer; return { result: ok ? "correct" : "wrong", correct: ok }; }
  if (item.kind === "meaning") { const r = checkAnswer(input, item.answer); return { result: r, correct: r === "correct" }; }
  const ok = checkExact(input, item.answer);
  return { result: ok ? "correct" : "wrong", correct: ok };
}

/** เหตุการณ์ที่ต้องบันทึกลงระบบต้นทาง: บัตร → reviews (เข้า SRS) · ข้อผิด → practiceEvents · ข้อสอบ → null (บันทึกในชุดคละเท่านั้น) */
export function eventFor(item, judged, input, at) {
  if (item.src === "card") return { col: "reviews", data: { cardId: item.ref, rating: RATING_OF[judged.result], mode: "interleave", answer: item.kind === "meaning" ? String(input || "") : "", result: judged.result, at } };
  if (item.src === "error") return { col: "practiceEvents", data: { errorId: item.ref, drill: item.kind, correct: judged.correct, at, ...(item.cardId ? { cardId: item.cardId } : {}) } };
  return null;
}

/** เอกสาร interleavingSessions (ต่อท้ายอย่างเดียว): results = [{ item, correct }] */
export function sessionDoc({ start, end, results }) {
  const items = results.map((r) => ({ src: r.item.src, kind: r.item.kind, topic: r.item.topic, ref: String(r.item.ref), correct: Boolean(r.correct) })).slice(0, SIZE.max);
  return { start, end, durationSec: Math.max(0, Math.round((end - start) / 1000)), total: items.length, correct: items.filter((i) => i.correct).length, items };
}

export function summarize(results) {
  const by = (key) => {
    const m = new Map();
    for (const r of results) { const k = key(r.item); const v = m.get(k) || { total: 0, correct: 0 }; v.total++; if (r.correct) v.correct++; m.set(k, v); }
    return [...m].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.total - a.total || (a.key < b.key ? -1 : 1));
  };
  return { total: results.length, correct: results.filter((r) => r.correct).length, byKind: by((i) => i.kind), byTopic: by((i) => i.topic), mistakes: results.filter((r) => !r.correct).map((r) => r.item) };
}

export function topicLabel(topic) {
  const [type, name] = [topic.slice(0, topic.indexOf(":")), topic.slice(topic.indexOf(":") + 1)];
  if (type === "tag") return name === "-" ? "บัตรไม่มีแท็ก" : `แท็ก ${name}`;
  if (type === "cat") return `ข้อผิด ${name}`;
  return `ข้อสอบ ${name === "-" ? "" : name}`.trim();
}

// ---------- ตรวจรูปแบบเอกสาร (Import) ----------
export function isValidSession(d) {
  const n = (x) => Number.isFinite(x) && x >= 0;
  return d && n(d.start) && n(d.end) && d.end >= d.start && n(d.durationSec) && Number.isInteger(d.total) && Number.isInteger(d.correct) && d.correct <= d.total
    && Array.isArray(d.items) && d.items.length === d.total && d.items.length <= SIZE.max
    && d.items.every((i) => i && Object.keys(SOURCES).includes(i.src) && Object.keys(KINDS).includes(i.kind) && typeof i.topic === "string" && typeof i.ref === "string" && typeof i.correct === "boolean");
}

export { focusErrors };

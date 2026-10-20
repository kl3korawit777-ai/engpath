// ตรวจอัตโนมัติ: schema, th ไม่ว่าง + source ถูกต้อง, ประโยคตัวอย่างมีคำนั้นจริง/≥4 คำ/ไม่ซ้ำ/ไม่ลอก Wiktionary, pos สอดคล้อง Wiktionary, family อยู่ในคลัง, แท็กอยู่ในรายการ
// errors = ต้องแก้ก่อนนับว่าชุดนั้นเสร็จ · warnings = ให้คนตรวจในรายงาน (ไม่บล็อก)
import { config, readJson, has, OVERRIDES_FILE } from "./util.mjs";
import { containsWord, wordCount } from "./inflect.mjs";

const THAI = /[฀-๿]/;
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, " ").trim();
// เทียบประโยคซ้ำ: ไม่สนตัวพิมพ์/เครื่องหมาย/ช่องว่าง
export const normS = (s) => String(s).toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, "").replace(/\s+/g, " ").trim();
const isStr = (x) => typeof x === "string" && x.trim() !== "";
const posGroup = (p) => (p === "modal" || p === "auxiliary" ? "verb" : p);
export const TH_SOURCES = ["wiktionary", "claude", "manual"];        // manual = แก้เองใน overrides.json
export const maxWordsFor = (level) => (level <= 4 ? 12 : level <= 8 ? 16 : 20);

export const loadOverrides = () => (has(OVERRIDES_FILE) ? readJson(OVERRIDES_FILE) : {});

/** รวมผลที่เขียนไว้กับ overrides ของคำนั้น (override ทับรายฟิลด์ทั้งก้อน) */
export const mergeEntry = (parsed, override) => ({ ...(parsed || {}), ...(override || {}) });

/** ตัวเลือกคำแปลไทยจาก Wiktionary ของคำ: Set ข้อความไทยทั้งหมดที่ใช้อ้างอิงได้ */
export const thCandidateSet = (wik) => new Set((wik?.th || []).flatMap((t) => t.th));

/**
 * คืน { errors, warnings } ของคำเดียว
 * w = { rank, word, level } · e = ผลที่เขียน · wik = ระเบียน Wiktionary ของคำ (หรือ null) · keys = Set wordKey ของคลัง
 */
export function validateEntry(w, e, { wik = null, keys = new Set() } = {}) {
  const errors = [], warnings = [];
  if (!e || typeof e !== "object" || Array.isArray(e)) return { errors: ["ผลไม่ใช่ออบเจ็กต์ JSON"], warnings };
  const arr = (k, min, max) => {
    if (!Array.isArray(e[k])) { errors.push(`${k}: ต้องเป็นอาร์เรย์`); return null; }
    if (e[k].length < min || e[k].length > max) { errors.push(`${k}: ต้องมี ${min === max ? min : `${min}–${max}`} รายการ (มี ${e[k].length})`); return null; }
    return e[k];
  };

  const pos = arr("pos", 1, 3);
  if (pos) {
    if (!pos.every((p) => config.posAllowed.includes(p))) errors.push(`pos: มีค่านอกรายการที่อนุญาต (${pos.join(", ")})`);
    if (new Set(pos).size !== pos.length) errors.push("pos: ซ้ำกัน");
    if (wik?.found && wik.pos?.length) {
      const wp = new Set(wik.pos.map(posGroup));
      if (!pos.some((p) => wp.has(posGroup(p)))) errors.push(`pos ไม่สอดคล้องกับ Wiktionary (Wiktionary: ${wik.pos.join("/")} · ที่เขียน: ${pos.join("/")})`);
    }
  }

  const cands = thCandidateSet(wik);
  const th = arr("th", 1, 3);
  if (th) {
    th.forEach((t, i) => {
      if (!t || typeof t !== "object") { errors.push(`th[${i}]: ต้องเป็น {pos, text, source}`); return; }
      if (!isStr(t.text)) errors.push(`th[${i}].text: ว่าง`);
      else if (!THAI.test(t.text)) errors.push(`th[${i}].text: ไม่มีอักษรไทย (“${t.text}”)`);
      else if (t.text.length > 40) warnings.push(`th[${i}].text: ยาว ${t.text.length} ตัวอักษร`);
      if (pos && !pos.includes(t.pos)) errors.push(`th[${i}].pos: “${t.pos}” ไม่อยู่ใน pos ของคำ`);
      if (!TH_SOURCES.includes(t.source)) errors.push(`th[${i}].source: ต้องเป็น ${TH_SOURCES.join("/")} (ได้ “${t.source}”)`);
      else if (t.source === "wiktionary") {
        if (!isStr(t.basedOn)) errors.push(`th[${i}]: source “wiktionary” ต้องระบุ basedOn (คำแปลจาก Wiktionary ที่ใช้เป็นฐาน)`);
        else if (!cands.has(t.basedOn)) errors.push(`th[${i}].basedOn: “${t.basedOn}” ไม่ใช่ตัวเลือกจาก Wiktionary ของคำนี้`);
      } else if (t.source === "claude" && pos && cands.size && (wik.th || []).some((c) => c.pos === t.pos)) {
        warnings.push(`th[${i}]: ใช้ source “claude” ทั้งที่ Wiktionary มีตัวเลือกของ ${t.pos} (${(wik.th.find((c) => c.pos === t.pos).th || []).slice(0, 3).join(", ")})`);
      }
    });
    if (new Set(th.map((t) => norm(t?.text ?? ""))).size !== th.length) errors.push("th: มีความหมายซ้ำกัน");
  }

  const wikEx = new Set((wik?.examples || []).map(normS));
  const ex = arr("examples", 2, 2);
  if (ex) {
    const max = maxWordsFor(w.level);
    ex.forEach((s, i) => {
      if (!isStr(s)) { errors.push(`examples[${i}]: ว่าง`); return; }
      const n = wordCount(s);
      if (n < 4) errors.push(`examples[${i}]: สั้นเกินไป (${n} คำ ต้อง ≥ 4)`);
      else if (n > 30) errors.push(`examples[${i}]: ยาวเกินไป (${n} คำ)`);
      else if (n > max) warnings.push(`examples[${i}]: ${n} คำ เกินที่แนะนำสำหรับระดับ ${w.level} (${max})`);
      if (!containsWord(s, w.word)) errors.push(`examples[${i}]: ไม่มีคำว่า “${w.word}” หรือรูปผัน — “${s}”`);
      if (wikEx.has(normS(s))) errors.push(`examples[${i}]: ตรงกับประโยคของ Wiktionary (ต้องแต่งใหม่ทั้งหมด)`);
    });
    if (isStr(ex[0]) && isStr(ex[1]) && normS(ex[0]) === normS(ex[1])) errors.push("examples: สองประโยคเหมือนกัน");
  }

  const col = arr("collocations", 2, 4);
  if (col) {
    if (!col.every(isStr)) errors.push("collocations: มีค่าว่าง");
    else {
      if (!col.some((c) => containsWord(c, w.word))) warnings.push("collocations: ไม่มีวลีไหนมีคำนี้เลย");
      if (new Set(col.map(norm)).size !== col.length) errors.push("collocations: ซ้ำกัน");
    }
  }

  const fam = arr("family", 0, 6);
  if (fam) {
    for (const f of fam) {
      if (!isStr(f)) { errors.push("family: มีค่าว่าง"); continue; }
      if (norm(f) === norm(w.word)) errors.push("family: มีตัวคำเองอยู่ในรายการ");
      else if (keys.size && !keys.has(norm(f))) errors.push(`family: “${f}” ไม่อยู่ในคลัง 5,050 คำ (เก็บเฉพาะคำที่อยู่ในคลัง)`);
    }
    if (new Set(fam.map(norm)).size !== fam.length) errors.push("family: ซ้ำกัน");
  }

  const tags = arr("tags", 1, 3);
  if (tags) {
    const bad = tags.filter((t) => !config.tags.includes(t));
    if (bad.length) errors.push(`tags: นอกรายการที่กำหนด (${bad.join(", ")})`);
    if (new Set(tags).size !== tags.length) errors.push("tags: ซ้ำกัน");
  }

  if (!config.cefrAllowed.includes(e.cefr)) errors.push(`cefr: “${e.cefr}” ไม่ถูกต้อง (ต้องเป็น ${config.cefrAllowed.join("/")})`);
  return { errors, warnings };
}

/** ธง "ความหมายหลักเป็นของ claude/แก้เอง" ใช้ในรายงานตรวจทาน */
export const mainMeaningSource = (e) => e?.th?.[0]?.source ?? null;

/**
 * ตรวจทั้งชุด: ผลต่อคำ + ประโยคตัวอย่างซ้ำข้ามคำ (ประโยคเดียวกันในคำที่มา “หลัง” ถือว่าผิด)
 * results = Map rank → ผลที่เขียน · wiks = Map wordKey → ระเบียน Wiktionary
 */
export function validateAll(words, results, { wiks = new Map(), overrides = {}, keys = new Set(words.map((w) => w.wordKey)), prior = new Map() } = {}) {
  const failed = [], ok = [], missing = [], warned = [];
  const seen = new Map(prior);                          // prior = ประโยค (normS) → rank ของชุดอื่นที่ผ่านแล้ว กันซ้ำข้ามชุด
  for (const w of words) {
    const r = results.get(w.rank);
    if (!r) { missing.push(w.rank); continue; }
    const merged = mergeEntry(r, overrides[w.wordKey]);
    const v = validateEntry(w, merged, { wik: wiks.get(w.wordKey) || null, keys });
    if (Array.isArray(merged.examples)) for (const s of merged.examples) {
      if (!isStr(s)) continue;
      const k = normS(s);
      if (seen.has(k) && seen.get(k) !== w.rank) v.errors.push(`ประโยคตัวอย่างซ้ำกับคำอื่น (rank ${seen.get(k)}): “${s}”`);
      else seen.set(k, w.rank);
    }
    const rec = { rank: w.rank, word: w.word, errors: v.errors, warnings: v.warnings, mainSource: mainMeaningSource(merged) };
    if (v.errors.length) failed.push(rec); else { ok.push(w.rank); if (v.warnings.length) warned.push(rec); }
  }
  return { total: words.length, ok: ok.length, failed, missing, warned };
}

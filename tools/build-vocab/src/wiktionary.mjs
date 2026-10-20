// ขั้น 1: ดึงข้อมูลจาก Wiktionary ผ่านไฟล์ JSON Lines ของ kaikki.org (postprocessed English dictionary)
// อ่านแบบ stream ทีละบรรทัด (ไฟล์ ~3 GB ห้ามโหลดทั้งไฟล์) กรองเฉพาะ 5,050 คำของ NGSL-GR · ทุกข้อมูลมี source: "wiktionary"
// รูปแบบข้อมูลที่ตรวจจากไฟล์จริง: บรรทัดละ 1 entry { word, pos, lang_code:"en", sounds:[{ipa,tags}], senses:[{glosses[], examples[{text,type,ref}],
//   synonyms[{word}], antonyms[], derived[], related[], translations[{lang_code,word,sense,roman}], tags[]}], translations[...] (ระดับ entry), synonyms, antonyms, derived, related }
import { createReadStream } from "node:fs";
import { createGunzip } from "node:zlib";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { ROOT, config, cachePath, readJson, writeJson, has, listFiles } from "./util.mjs";
import { loadWords } from "./words.mjs";
import { wordKeyOf } from "./csv.mjs";

// ชนิดคำของ Wiktionary → รายการชนิดคำของเรา (ชนิดอื่น เช่น character/symbol/abbrev/phrase/prefix/suffix ข้าม)
export const POS_MAP = { noun: "noun", name: "noun", verb: "verb", adj: "adjective", adv: "adverb", prep: "preposition", postp: "preposition", conj: "conjunction", pron: "pronoun", det: "determiner", article: "determiner", intj: "interjection", num: "number", particle: "particle" };
const SKIP_SENSE_TAGS = new Set(["obsolete", "archaic", "rare", "dated", "historical", "nonstandard", "dialectal", "offensive", "vulgar", "misspelling"]);

const clip = (s, n) => { const t = String(s || "").replace(/\s+/g, " ").trim(); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const wordsOf = (arr) => (Array.isArray(arr) ? arr.map((x) => (typeof x === "string" ? x : x?.word)).filter((w) => typeof w === "string" && w.trim()) : []);

/** IPA: ชอบรูปแบบ /…/ (phonemic) ที่ติดแท็ก General-American/US ก่อน แล้วค่อย /…/ อื่น แล้วจึง […] */
export function pickIpa(sounds) {
  const all = (sounds || []).filter((s) => typeof s.ipa === "string" && s.ipa.trim());
  const rank = (s) => {
    const us = (s.tags || []).some((t) => /^(General-American|US)$/.test(t));
    const slash = s.ipa.startsWith("/");
    return (slash ? 0 : 2) + (us ? 0 : 1);
  };
  const best = [...all].sort((a, b) => rank(a) - rank(b))[0];
  return best ? best.ipa.trim() : "";
}

/** แปลง 1 entry ของ kaikki เป็นข้อมูลของเรา (หรือ null ถ้าไม่ใช่คำที่ต้องการ) keySet = wordKey ของ 5,050 คำ */
export function extractEntry(obj, keySet) {
  if (!obj || obj.lang_code !== "en" || typeof obj.word !== "string") return null;
  const key = wordKeyOf(obj.word);
  if (!keySet.has(key)) return null;
  const pos = POS_MAP[obj.pos];
  if (!pos) return null;
  const senses = [];
  const th = [];                                                // [{ pos, senseEn, th:[...] }]
  const addTh = (senseEn, list) => {
    const words = [...new Set(list.map((t) => String(t.word || "").trim()).filter(Boolean))];
    if (!words.length) return;
    const ex = th.find((x) => x.senseEn === senseEn);
    if (ex) ex.th = [...new Set([...ex.th, ...words])]; else th.push({ pos, senseEn, th: words });
  };
  const thOf = (arr) => (arr || []).filter((t) => t.lang_code === "th" || t.code === "th");
  const synonyms = wordsOf(obj.synonyms), antonyms = wordsOf(obj.antonyms), derived = wordsOf(obj.derived), related = wordsOf(obj.related);
  for (const s of obj.senses || []) {
    const gloss = clip(s.glosses?.at(-1), 160);
    if (!gloss || s.form_of || s.alt_of) continue;
    const skipTag = (s.tags || []).some((t) => SKIP_SENSE_TAGS.has(t));
    synonyms.push(...wordsOf(s.synonyms)); antonyms.push(...wordsOf(s.antonyms)); derived.push(...wordsOf(s.derived)); related.push(...wordsOf(s.related));
    const NOT_SENTENCE = /^(Holonyms?|Hypernyms?|Hyponyms?|Meronyms?|Synonyms?|Antonyms?|Near-synonyms?|Near-antonyms?|Coordinate terms?|Derived terms?|Related terms?|Alternative forms?|See also|Usage notes?)\s*[:;]/i;      // บางรายการใน kaikki เป็นบรรทัดความสัมพันธ์ ไม่ใช่ประโยค
    const examples = (s.examples || []).filter((e) => (e.type === undefined || e.type === "example") && !e.ref && typeof e.text === "string" && e.text.length >= 12 && e.text.length <= 160 && !NOT_SENTENCE.test(e.text.trim())).map((e) => e.text.trim());
    const sth = thOf(s.translations);
    addTh(gloss, sth);
    if (!skipTag) senses.push({ senseEn: gloss, tags: s.tags || [], examples, hasTh: sth.length > 0 });
  }
  // คำแปลระดับ entry (ระบุความหมายด้วยข้อความ sense) — จับคู่กับ gloss ที่ตรงกัน ไม่งั้นเก็บตามข้อความ sense เดิม
  for (const t of thOf(obj.translations)) {
    const label = String(t.sense || "").trim();
    const match = senses.find((x) => label && (x.senseEn.toLowerCase().includes(label.toLowerCase()) || label.toLowerCase().includes(x.senseEn.toLowerCase().replace(/\.$/, ""))));
    addTh(match ? match.senseEn : label || "(ไม่ระบุความหมาย)", [t]);
  }
  return {
    key, pos, ipa: pickIpa(obj.sounds), senses: senses.slice(0, config.wiktionary.maxSensesPerPos), th,
    synonyms, antonyms, derived, related,
  };
}

/** รวมหลาย entry (หลายชนิดคำ/หลายรายการของคำเดียวกัน) เป็นระเบียนเดียวต่อ wordKey; เก็บเฉพาะคำสัมพันธ์ที่อยู่ในคลัง */
export function mergeEntries(w, entries, keySet) {
  const inList = (arr) => [...new Set(arr.map(wordKeyOf))].filter((k) => keySet.has(k) && k !== w.wordKey);
  const pos = [...new Set(entries.map((e) => e.pos))];
  const ipa = entries.map((e) => e.ipa).find(Boolean) || "";
  const defEn = [];
  for (const p of pos) { const s = entries.filter((e) => e.pos === p).flatMap((e) => e.senses)[0]; if (s) defEn.push({ pos: p, def: s.senseEn }); }
  const examples = [];
  for (const e of entries) for (const s of e.senses) for (const t of s.examples) if (!examples.includes(t)) examples.push(t);
  const th = [];
  for (const e of entries) for (const t of e.th) { const ex = th.find((x) => x.pos === t.pos && x.senseEn === t.senseEn); if (ex) ex.th = [...new Set([...ex.th, ...t.th])]; else th.push({ ...t }); }
  const lim = config.wiktionary.maxListed;
  const phrases = [...new Set(entries.flatMap((e) => e.derived).filter((d) => /\s/.test(d.trim()) && d.trim().split(/\s+/).length <= 4))].slice(0, 10);
  return {
    rank: w.rank, word: w.word, level: w.level, found: entries.length > 0, source: "wiktionary",
    pos, ipa, defEn,
    senses: entries.flatMap((e) => e.senses.map((s) => ({ pos: e.pos, senseEn: s.senseEn, tags: s.tags, hasTh: s.hasTh }))),
    th, examples: examples.slice(0, config.wiktionary.maxExamplesKept),
    synonyms: inList(entries.flatMap((e) => e.synonyms)).slice(0, lim), antonyms: inList(entries.flatMap((e) => e.antonyms)).slice(0, lim),
    family: inList(entries.flatMap((e) => [...e.derived, ...e.related])).slice(0, config.wiktionary.maxFamily), phrases,
  };
}

/** ค้นไฟล์ kaikki ใน input/ (.jsonl หรือ .jsonl.gz) */
export function findKaikkiFile() {
  const dir = join(ROOT, config.wiktionary.inputDir);
  const re = new RegExp(config.wiktionary.filePattern, "i");
  const f = listFiles(dir).find((x) => re.test(x));
  return f ? join(dir, f) : null;
}

/** อ่านไฟล์แบบ stream: onEntry(extracted) ต่อ entry ที่ตรง; คืนสถิติการอ่าน */
export async function streamFile(path, keySet, onEntry, { log = () => {}, every = 200000 } = {}) {
  let input = createReadStream(path);
  if (/\.gz$/i.test(path)) input = input.pipe(createGunzip());
  const rl = createInterface({ input, crlfDelay: Infinity });
  let lines = 0, matched = 0, bad = 0;
  for await (const line of rl) {
    if (!line) continue;
    lines++;
    if (lines % every === 0) log(`  อ่านแล้ว ${lines.toLocaleString("en-US")} บรรทัด · พบ ${matched} entry`);
    let obj;
    try { obj = JSON.parse(line); } catch { bad++; continue; }
    const e = extractEntry(obj, keySet);
    if (e) { matched++; onEntry(e); }
  }
  return { lines, matched, bad };
}

/** สถิติที่ผู้ใช้ขอ: ขาดคำแปลไทย / ขาดประโยคตัวอย่าง / ขาด IPA (+ ไม่พบคำในไฟล์เลย) */
export function statsOf(records) {
  const found = records.filter((r) => r.found);
  const thFull = found.filter((r) => r.pos.length && r.pos.every((p) => r.th.some((t) => t.pos === p)));
  const thNone = found.filter((r) => !r.th.length);
  return {
    total: records.length, found: found.length, notFound: records.length - found.length,
    thFull: thFull.length, thPartial: found.length - thFull.length - thNone.length, thNone: thNone.length,
    noExamples: found.filter((r) => !r.examples.length).length, noIpa: found.filter((r) => !r.ipa).length,
    noSynonyms: found.filter((r) => !r.synonyms.length).length, noFamily: found.filter((r) => !r.family.length).length,
  };
}

export function formatStats(s, log = console.log) {
  const pct = (n, d = s.total) => `${n} (${d ? ((n / d) * 100).toFixed(1) : 0}%)`;
  log(`พบคำใน Wiktionary: ${pct(s.found)} · ไม่พบเลย: ${pct(s.notFound)}`);
  log(`คำแปลไทย — ครบทุกชนิดคำ: ${pct(s.thFull)} · บางส่วน: ${pct(s.thPartial)} · ไม่มีเลย: ${pct(s.thNone)}`);
  log(`ขาดประโยคตัวอย่าง: ${pct(s.noExamples)} · ขาด IPA: ${pct(s.noIpa)} · ไม่มีคำพ้อง: ${pct(s.noSynonyms)} · ไม่มีตระกูลคำในคลัง: ${pct(s.noFamily)}`);
}

export const WIKT_PATH = () => cachePath("wiktionary.json");

export async function runWiktionary({ log = console.log, file = findKaikkiFile() } = {}) {
  if (!file) throw new Error(`ไม่พบไฟล์ข้อมูล kaikki.org ใน tools/build-vocab/${config.wiktionary.inputDir}/ (ต้องเป็น .jsonl หรือ .jsonl.gz เช่น kaikki.org-dictionary-English.jsonl) — ดาวน์โหลดแล้ววางที่นั่น`);
  const words = loadWords();
  const keySet = new Set(words.map((w) => w.wordKey));
  log(`อ่าน ${file} แบบ stream · กรองเฉพาะ ${keySet.size} คำ`);
  const by = new Map();
  const info = await streamFile(file, keySet, (e) => { (by.get(e.key) || by.set(e.key, []).get(e.key)).push(e); }, { log });
  log(`อ่านเสร็จ ${info.lines.toLocaleString("en-US")} บรรทัด (อ่านไม่ได้ ${info.bad}) · entry ที่ตรงคำของเรา ${info.matched}`);
  const records = words.map((w) => mergeEntries(w, by.get(w.wordKey) || [], keySet));
  writeJson(WIKT_PATH(), { source: "kaikki.org (Wiktionary)", file: file.split(/[\\/]/).pop(), count: records.length, records }, false);
  const stats = statsOf(records);
  formatStats(stats, log);
  writeJson(cachePath("wiktionary-stats.json"), stats);
  const missing = records.filter((r) => !r.found).map((r) => r.word);
  if (missing.length) log(`คำที่ไม่พบในไฟล์ (${missing.length}): ${missing.slice(0, 40).join(", ")}${missing.length > 40 ? " …" : ""}`);
  return { stats, records };
}

export function loadWiktionary() {
  if (!has(WIKT_PATH())) throw new Error("ยังไม่มี cache ของ Wiktionary — รัน: node tools/build-vocab/run.mjs wiktionary");
  const d = readJson(WIKT_PATH());
  return new Map(d.records.map((r) => [wordKeyOf(r.word), r]));
}

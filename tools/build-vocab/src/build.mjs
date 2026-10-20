// ขั้น 3 (build): รวม Wiktionary + ชุดที่เขียนเอง (work/batches/*.output.json ที่ผ่านแล้ว) + overrides → /vocab/index.json และ /vocab/level-01.json … level-11.json
// ผลลัพธ์คงที่ (deterministic): ไม่ใส่เวลาสร้าง ใส่ contentHash แทน — build ซ้ำจากข้อมูลเดิมได้ไฟล์เดิมทุกไบต์
import { writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { config, VOCAB_DIR, sha256, pad } from "./util.mjs";
import { loadWords } from "./words.mjs";
import { levelRanges } from "./csv.mjs";
import { loadWiktionary } from "./wiktionary.mjs";
import { loadOverrides, mergeEntry, validateAll } from "./validate.mjs";
import { allAcceptedResults } from "./batches.mjs";

const uniq = (a) => [...new Set(a)];

/** ระเบียนสุดท้ายของคำ: ทุกค่าที่มาจากแหล่งใดแหล่งหนึ่งมี source กำกับ (รายข้อสำหรับ th/examples, รายฟิลด์ใน src) */
export function buildEntry(w, { mine = null, wik = null, override = null } = {}) {
  const c = mergeEntry(mine, override);
  const ov = override || {};
  const src = {};
  const wikFamily = wik?.family || [];
  const family = uniq([...wikFamily, ...(c.family || [])]).slice(0, config.wiktionary.maxFamily);
  if (wik?.ipa) src.ipa = "wiktionary";
  if (wik?.defEn?.length) src.defEn = "wiktionary";
  if (wik?.synonyms?.length) src.synonyms = "wiktionary";
  if (wik?.antonyms?.length) src.antonyms = "wiktionary";
  if (family.length) src.family = uniq([...(wikFamily.length ? ["wiktionary"] : []), ...((c.family || []).some((f) => !wikFamily.includes(f)) ? [ov.family ? "manual" : "claude"] : [])]);
  for (const f of ["pos", "collocations", "tags", "cefr"]) if (c[f]?.length ?? c[f]) src[f] = ov[f] ? "manual" : "claude";
  const thItems = (c.th || []).map((t) => ({ pos: t.pos, text: t.text, source: t.source }));
  if (thItems.length) src.th = uniq(thItems.map((t) => t.source));
  const examples = (c.examples || []).map((text) => ({ text, source: ov.examples ? "manual" : "claude" }));
  if (examples.length) src.examples = uniq(examples.map((e) => e.source));
  return {
    wordKey: w.wordKey, word: w.word, rank: w.rank, level: w.level,
    cefr: c.cefr ?? "", pos: c.pos ?? [],
    ipa: wik?.ipa ?? "", defEn: wik?.defEn ?? [],
    th: thItems, examples, collocations: c.collocations ?? [], family,
    synonyms: wik?.synonyms ?? [], antonyms: wik?.antonyms ?? [],
    tags: c.tags ?? [],
    src,
  };
}

export const levelFile = (level) => `level-${pad(level, 2)}.json`;

/** คืน { index, files, problems, validation } — ยังไม่เขียนดิสก์ */
export async function buildVocab({ words, results, wiks, overrides = {}, allowIncomplete = false }) {
  const v = validateAll(words, results, { wiks, overrides });
  const problems = [];
  if (v.failed.length) problems.push(`${v.failed.length} คำยังไม่ผ่าน validate (เช่น ${v.failed.slice(0, 5).map((f) => `${f.word}: ${f.errors[0]}`).join(" | ")})`);
  if (v.missing.length) problems.push(`${v.missing.length} คำยังไม่ได้เขียน (ยังไม่มีผลในชุดที่ผ่านแล้ว)`);
  const bad = new Set([...v.failed.map((f) => f.rank), ...v.missing]);
  if (problems.length && !allowIncomplete) return { index: null, files: [], problems, validation: v };

  const files = [];
  for (const r of levelRanges(words)) {
    const entries = words.filter((w) => w.level === r.level).map((w) => buildEntry(w, { mine: results.get(w.rank), wik: wiks.get(w.wordKey), override: overrides[w.wordKey] }));
    files.push({ name: levelFile(r.level), level: r.level, text: `${JSON.stringify({ level: r.level, words: entries })}\n`, count: entries.length, from: r.from, to: r.to });
  }
  const contentHash = await sha256(files.map((f) => f.text).join(""));
  const index = {
    schema: 2, version: config.vocabVersion, contentHash, complete: bad.size === 0,
    count: words.length,
    levels: files.map((f) => ({ level: f.level, file: f.name, count: f.count, rankFrom: f.from, rankTo: f.to, bytes: Buffer.byteLength(f.text) })),
    tags: config.tags, cefr: config.cefrAllowed, pos: config.posAllowed, sources: ["wiktionary", "claude", "manual"],
    credits: config.credits, license: "CC BY-SA 4.0",
  };
  return { index, files, problems, validation: v };
}

export async function cmdBuild(flags = {}, { log = console.log } = {}) {
  const words = loadWords();
  const out = await buildVocab({ words, results: allAcceptedResults(), wiks: loadWiktionary(), overrides: loadOverrides(), allowIncomplete: Boolean(flags["allow-incomplete"]) });
  if (!out.index) {
    for (const p of out.problems) log(`✗ ${p}`);
    throw new Error("ยัง build ไม่ได้ — ทำให้ครบทุกชุดและทุกคำผ่าน validate (หรือแก้ใน overrides) ก่อน หรือใช้ --allow-incomplete เพื่อสร้างไฟล์ทดสอบ (ห้ามนำไป deploy)");
  }
  mkdirSync(VOCAB_DIR, { recursive: true });
  for (const f of readdirSync(VOCAB_DIR)) if (/^level-\d+\.json$/.test(f) || f === "index.json") rmSync(join(VOCAB_DIR, f));
  for (const f of out.files) writeFileSync(join(VOCAB_DIR, f.name), f.text, "utf8");
  writeFileSync(join(VOCAB_DIR, "index.json"), `${JSON.stringify(out.index, null, 2)}\n`, "utf8");
  log(`สร้าง ${VOCAB_DIR} · เวอร์ชัน ${out.index.version} · ${out.index.count} คำ · complete=${out.index.complete} · hash ${out.index.contentHash.slice(0, 12)}`);
  let raw = 0, gz = 0;
  for (const f of out.files) { const b = Buffer.byteLength(f.text), g = gzipSync(f.text).length; raw += b; gz += g; log(`  ${f.name}: ${f.count} คำ · ${(b / 1024).toFixed(0)} KB (gzip ${(g / 1024).toFixed(0)} KB)`); }
  log(`รวม ${(raw / 1024).toFixed(0)} KB (gzip ${(gz / 1024).toFixed(0)} KB) — ${out.index.complete ? "พร้อมใช้" : "⚠ ไม่ครบ ห้าม deploy"}`);
  const big = out.files.filter((f) => Buffer.byteLength(f.text) > 400 * 1024);
  if (big.length) log(`⚠ ไฟล์ใหญ่เกิน 400 KB: ${big.map((f) => f.name).join(", ")}`);
  return out;
}

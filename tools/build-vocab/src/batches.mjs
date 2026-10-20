// ขั้น 2: แบ่งงานเป็นชุด ชุดละ 100 คำตามลำดับ rank → work/batches/batch-NNN.input.json
// Claude Code เขียน batch-NNN.output.json ตาม STYLE.md ทีละชุด → validate-batch → บันทึกลง work/progress.json
// progress.json ใช้ต่องานเมื่อเซสชันถูกตัด: `next` บอกชุดถัดไปที่ยังไม่เสร็จ — ห้ามทำชุดที่เสร็จแล้วซ้ำ
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { config, workPath, readJson, writeJson, has, pad, listFiles, sha256 } from "./util.mjs";
import { loadWords } from "./words.mjs";
import { loadWiktionary } from "./wiktionary.mjs";
import { validateEntry, validateAll, loadOverrides, normS } from "./validate.mjs";

const CEFR_HINT = { 1: "A1–A2", 2: "A1–A2", 3: "A2–B1", 4: "A2–B1", 5: "B1", 6: "B1", 7: "B1–B2", 8: "B1–B2", 9: "B2", 10: "B2", 11: "B2–C1" };
export const batchName = (n) => `batch-${pad(n, 3)}`;
export const inputPath = (n) => workPath("batches", `${batchName(n)}.input.json`);
export const outputPath = (n) => workPath("batches", `${batchName(n)}.output.json`);
export const PROGRESS = () => workPath("progress.json");

export const batchCount = (words) => Math.ceil(words.length / config.batchSize);
export const wordsOfBatch = (words, n) => words.slice((n - 1) * config.batchSize, n * config.batchSize);

/** ข้อมูลของคำหนึ่งที่ใส่ในไฟล์ input (ย่อให้พอดีกับการเขียนทีละชุด) */
const cut = (t, n) => { const x = String(t || ""); return x.length > n ? `${x.slice(0, n - 1)}…` : x; };

/** ข้อมูลของคำหนึ่งที่ใส่ในไฟล์ input — ย่อให้พอดีกับการอ่านและเขียนทีละชุด (ข้อมูลเต็มอยู่ใน cache/wiktionary.json) */
export function inputWord(w, wik) {
  const senses = [];
  for (const p of wik?.pos || []) senses.push({ pos: p, meanings: (wik.senses || []).filter((s) => s.pos === p).slice(0, 3).map((s) => cut(s.senseEn, 90)) });
  return {
    rank: w.rank, word: w.word, level: w.level, cefrHint: CEFR_HINT[w.level],
    wiktionary: wik?.found
      ? {
        pos: wik.pos, ipa: wik.ipa, senses,
        thCandidates: wik.th.slice(0, 6).map((t) => ({ pos: t.pos, senseEn: cut(t.senseEn, 70), th: t.th.slice(0, 4) })),
        exampleRefs: wik.examples.slice(0, 2).map((e) => cut(e, 100)),
        synonyms: wik.synonyms.slice(0, 6), antonyms: wik.antonyms.slice(0, 4), family: wik.family.slice(0, 6), phrases: wik.phrases.slice(0, 4),
      }
      : { found: false },
  };
}

/** เขียนไฟล์ input แบบกะทัดรัด: หนึ่งคำต่อหนึ่งบรรทัด (อ่านง่ายและกินโทเค็นน้อย) */
const writeBatchInput = (path, doc) => {
  const { words, ...head } = doc;
  const text = `${JSON.stringify(head).slice(0, -1)},"words":[\n${words.map((w) => JSON.stringify(w)).join(",\n")}\n]}\n`;
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text, "utf8");
};

export function makeBatches({ log = console.log } = {}) {
  const words = loadWords();
  const wiks = loadWiktionary();
  const n = batchCount(words);
  let wrote = 0;
  for (let i = 1; i <= n; i++) {
    const ws = wordsOfBatch(words, i);
    const doc = { batch: i, rankFrom: ws[0].rank, rankTo: ws.at(-1).rank, count: ws.length, words: ws.map((w) => inputWord(w, wiks.get(w.wordKey))) };
    const p = inputPath(i);
    const same = has(p) && JSON.stringify(readJson(p)) === JSON.stringify(doc);
    if (!same) { writeBatchInput(p, doc); wrote++; }
  }
  log(`สร้างไฟล์ input ${n} ชุด (ชุดละ ${config.batchSize} คำ) · เขียนใหม่/อัปเดต ${wrote} ไฟล์ → work/batches/`);
  return n;
}

export const loadProgress = () => (has(PROGRESS()) ? readJson(PROGRESS()) : { version: 1, batches: {} });

/** ชุดถัดไปที่ยังไม่เสร็จ (ตาม progress.json) หรือ null ถ้าครบทุกชุดแล้ว */
export function nextBatch(words, progress = loadProgress()) {
  for (let i = 1; i <= batchCount(words); i++) if (!progress.batches[pad(i, 3)]) return i;
  return null;
}

const readOutput = (n) => {
  const d = readJson(outputPath(n));
  return Array.isArray(d) ? d : d.words;
};

/** ผลที่เขียนแล้วของชุดอื่นที่ผ่านแล้ว (ใช้ตรวจประโยคซ้ำข้ามชุด) → Map rank → entry */
export function acceptedResults(exceptBatch = null) {
  const m = new Map();
  for (const f of listFiles(workPath("batches"))) {
    const mt = f.match(/^batch-(\d{3})\.output\.json$/);
    if (!mt) continue;
    const n = Number(mt[1]);
    if (n === exceptBatch) continue;
    if (!loadProgress().batches[pad(n, 3)]) continue;
    for (const e of readOutput(n)) m.set(e.rank, e);
  }
  return m;
}

/** ตรวจผลของชุดที่ n: ครบ 100 คำตรงตัว input, ผ่านด่านทุกข้อ, ประโยคไม่ซ้ำกับชุดอื่น → ผ่านแล้วบันทึก progress.json */
export async function validateBatch(n, { log = console.log, record = true } = {}) {
  const words = loadWords();
  const wiks = loadWiktionary();
  if (!has(inputPath(n))) throw new Error(`ไม่พบ ${batchName(n)}.input.json — รัน batches ก่อน`);
  if (!has(outputPath(n))) throw new Error(`ยังไม่มี ${batchName(n)}.output.json`);
  const inp = readJson(inputPath(n));
  const out = readOutput(n);
  const problems = [];
  const byRank = new Map();
  for (const e of out) { if (byRank.has(e.rank)) problems.push(`rank ${e.rank} ซ้ำในไฟล์ output`); byRank.set(e.rank, e); }
  const expected = new Set(inp.words.map((w) => w.rank));
  for (const r of expected) if (!byRank.has(r)) problems.push(`ขาดคำ rank ${r} (${inp.words.find((w) => w.rank === r).word})`);
  for (const r of byRank.keys()) if (!expected.has(r)) problems.push(`rank ${r} ไม่อยู่ในชุดนี้`);
  for (const w of inp.words) { const e = byRank.get(w.rank); if (e && e.word !== w.word) problems.push(`rank ${w.rank}: ชื่อคำ “${e.word}” ไม่ตรงกับ input (“${w.word}”)`); }

  const batchWords = words.filter((w) => expected.has(w.rank));
  const prior = new Map();
  for (const [r, e] of acceptedResults(n)) for (const s of e.examples || []) prior.set(normS(s), r);
  const v = validateAll(batchWords, byRank, { wiks, overrides: loadOverrides(), keys: new Set(words.map((w) => w.wordKey)), prior });
  const failed = v.failed.filter((f) => expected.has(f.rank));
  const ok = problems.length === 0 && failed.length === 0 && v.missing.filter((r) => expected.has(r)).length === 0;
  for (const p of problems) log(`  ✗ ${p}`);
  for (const f of failed) for (const e of f.errors) log(`  ✗ ${f.word} (rank ${f.rank}): ${e}`);
  const warns = v.warned.filter((x) => expected.has(x.rank));
  const claudeMain = batchWords.filter((w) => byRank.get(w.rank)?.th?.[0]?.source === "claude").length;
  log(`${batchName(n)}: ${ok ? "ผ่าน ✓" : "ยังไม่ผ่าน"} · คำ ${out.length}/${inp.count} · ข้อผิดพลาด ${problems.length + failed.length} · คำเตือน ${warns.length} · คำที่ความหมายหลักเป็น claude ${claudeMain}`);
  if (ok && record) {
    const pr = loadProgress();
    pr.batches[pad(n, 3)] = { rankFrom: inp.rankFrom, rankTo: inp.rankTo, count: inp.count, validatedAt: new Date().toISOString(), outputHash: (await sha256(JSON.stringify(out))).slice(0, 16), warnings: warns.length, claudeMain };
    writeJson(PROGRESS(), pr);
    log(`บันทึกลง work/progress.json แล้ว · ชุดถัดไป: ${nextBatch(words, pr) ?? "ครบทุกชุดแล้ว"}`);
  }
  return { ok, problems, failed, warned: warns };
}

export function cmdProgress({ log = console.log } = {}) {
  const words = loadWords();
  const pr = loadProgress();
  const done = Object.keys(pr.batches).length, total = batchCount(words);
  const nw = Object.values(pr.batches).reduce((a, b) => a + b.count, 0);
  log(`เสร็จ ${done}/${total} ชุด (${nw}/${words.length} คำ)`);
  for (const [k, b] of Object.entries(pr.batches)) log(`  batch-${k}: rank ${b.rankFrom}–${b.rankTo} ผ่านเมื่อ ${b.validatedAt} (คำเตือน ${b.warnings}, ความหมายหลักเป็น claude ${b.claudeMain})`);
  const nx = nextBatch(words, pr);
  log(nx ? `ชุดถัดไป: ${batchName(nx)} (ไฟล์ input: work/batches/${batchName(nx)}.input.json)` : "ครบทุกชุดแล้ว — รัน report แล้ว build");
  return { done, total, next: nx };
}

/** ผลที่เขียนทั้งหมดที่ "ผ่านแล้ว" (ใช้ตอน report/build) → Map rank → entry */
export const allAcceptedResults = () => acceptedResults(null);

export { validateEntry };

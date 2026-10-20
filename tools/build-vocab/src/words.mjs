// ขั้น 0: อ่าน CSV → รายการคำ + ระดับ → cache/words.json (ขั้นอื่นอ่านจากที่นี่)
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, config, cachePath, writeJson, readJson, has } from "./util.mjs";
import { parseCsvText, buildWords, levelRanges } from "./csv.mjs";

export function runWords({ log = console.log } = {}) {
  const file = join(ROOT, config.input);
  if (!has(file)) throw new Error(`ไม่พบไฟล์อินพุต: ${file}`);
  const parsed = parseCsvText(readFileSync(file, "utf8"));
  const { words, fixed, problems } = buildWords(parsed, { fixes: config.wordFixes, sizes: config.levels.sizes });
  log(`อ่าน ${words.length} คำ · หัวตาราง ${JSON.stringify(parsed.header)} · คอลัมน์ระดับในไฟล์: ${parsed.hasLevel ? "มี (ใช้ของไฟล์)" : "ไม่มี (คำนวณจาก WordID)"}`);
  for (const r of levelRanges(words)) log(`  ระดับ ${String(r.level).padStart(2)}: rank ${r.from}–${r.to} (${r.count} คำ)`);
  for (const f of fixed) log(`  แก้ WordID ${f.rank}: “${f.from}” → “${f.to}” (${f.why})`);
  if (problems.length) { for (const p of problems) log(`  ⚠ ${p}`); throw new Error(`พบปัญหาใน CSV ${problems.length} ข้อ — แก้ไฟล์หรือ wordFixes ใน config.json แล้วรันใหม่`); }
  writeJson(cachePath("words.json"), { source: config.input, count: words.length, fixed, words }, false);
  return { words, fixed };
}

/** อ่านรายการคำจาก cache (ถ้ายังไม่มีให้สร้างก่อน) */
export function loadWords() {
  const p = cachePath("words.json");
  return (has(p) ? readJson(p) : { words: runWords({ log: () => {} }).words }).words;
}

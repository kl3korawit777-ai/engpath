// ซ้อมสายงานเขียนทีละชุด (batches → validate-batch → progress → report → build) ด้วยข้อมูลสังเคราะห์ใน temp dir — ไม่แตะ cache/work/vocab จริง
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tmp = mkdtempSync(join(tmpdir(), "vocab-"));
process.env.VOCAB_CACHE_DIR = join(tmp, "cache");
process.env.VOCAB_WORK_DIR = join(tmp, "work");
process.env.VOCAB_OUT_DIR = join(tmp, "vocab");
process.env.VOCAB_OVERRIDES = join(tmp, "overrides.json");

const WORDS = [["the", 1, 1], ["decide", 409, 2], ["happy", 1500, 4], ["rude", 4401, 11]].map(([word, rank, level]) => ({ rank, word, wordKey: word, level }));
const REC = (w, extra = {}) => ({ rank: w.rank, word: w.word, level: w.level, found: true, source: "wiktionary", pos: ["verb"], ipa: "/x/", defEn: [{ pos: "verb", def: "to do" }], senses: [{ pos: "verb", senseEn: "to do", tags: [], hasTh: true }], th: [{ pos: "verb", senseEn: "to do", th: ["ทำ"] }], examples: ["Some wiktionary sentence here."], synonyms: [], antonyms: [], family: [], phrases: [], ...extra });
const fake = (w, extra = {}) => ({
  rank: w.rank, word: w.word, pos: ["verb"], th: [{ pos: "verb", text: "ทำ", source: "wiktionary", basedOn: "ทำ" }],
  examples: [`I really like the word ${w.word} very much.`, `We often say ${w.word} at school today.`],
  collocations: [`use ${w.word}`, `${w.word} again`], family: [], tags: ["daily-life"], cefr: "A2", ...extra,
});

const { writeJson, cachePath, workPath } = await import("../tools/build-vocab/src/util.mjs");
writeJson(cachePath("words.json"), { words: WORDS });
writeJson(cachePath("wiktionary.json"), { records: WORDS.map((w) => REC(w)) });

test("batches: สร้างไฟล์ input ชุดละ 100 คำ พร้อมข้อมูล Wiktionary และไม่เขียนซ้ำเมื่อเนื้อหาเหมือนเดิม", async () => {
  const b = await import("../tools/build-vocab/src/batches.mjs");
  assert.equal(b.makeBatches({ log: () => {} }), 1);
  const inp = JSON.parse(readFileSync(workPath("batches", "batch-001.input.json"), "utf8"));
  assert.equal(inp.count, 4);
  assert.deepEqual(inp.words.map((w) => w.rank), [1, 409, 1500, 4401]);
  assert.deepEqual(inp.words[1].wiktionary.thCandidates, [{ pos: "verb", senseEn: "to do", th: ["ทำ"] }]);
  const logs = [];
  b.makeBatches({ log: (m) => logs.push(m) });
  assert.match(logs[0], /เขียนใหม่\/อัปเดต 0 ไฟล์/);
});

test("validate-batch: ไม่ครบ/ไม่ผ่าน = ไม่บันทึก progress; ผ่านแล้วบันทึกและชุดถัดไปว่าง", async () => {
  const b = await import("../tools/build-vocab/src/batches.mjs");
  assert.equal(b.nextBatch(WORDS.length ? WORDS : [], b.loadProgress()), 1);
  // ขาดคำ + ชื่อคำไม่ตรง + หัวข้อ tag ผิด
  writeFileSync(workPath("batches", "batch-001.output.json"), JSON.stringify([fake(WORDS[0]), fake(WORDS[1], { word: "decid" }), fake(WORDS[2], { tags: ["cooking"] })]));
  const r1 = await b.validateBatch(1, { log: () => {} });
  assert.equal(r1.ok, false);
  assert.ok(r1.problems.some((p) => /ขาดคำ rank 4401/.test(p)) && r1.problems.some((p) => /ไม่ตรงกับ input/.test(p)));
  assert.ok(r1.failed.some((f) => f.word === "happy" && /tags: นอกรายการ/.test(f.errors.join())));
  assert.equal(existsSync(workPath("progress.json")), false);
  // แก้จนผ่าน
  writeFileSync(workPath("batches", "batch-001.output.json"), JSON.stringify(WORDS.map((w) => fake(w))));
  const r2 = await b.validateBatch(1, { log: () => {} });
  assert.equal(r2.ok, true);
  const pr = b.loadProgress();
  assert.deepEqual(Object.keys(pr.batches), ["001"]);
  assert.equal(pr.batches["001"].count, 4);
  assert.equal(b.nextBatch(WORDS, pr), null);
  assert.deepEqual(b.cmdProgress({ log: () => {} }), { done: 1, total: 1, next: null });
});

test("report: flag คำที่ความหมายหลักไม่ใช่ Wiktionary และสร้าง HTML ที่ปลอดภัย", async () => {
  const out = JSON.parse(readFileSync(workPath("batches", "batch-001.output.json"), "utf8"));
  out[2].th = [{ pos: "verb", text: "ทำอะไรสักอย่าง", source: "claude" }];
  writeFileSync(workPath("batches", "batch-001.output.json"), JSON.stringify(out));
  const { cmdReport } = await import("../tools/build-vocab/src/report.mjs");
  const d = await cmdReport({}, { log: () => {} });
  assert.equal(d.summary.mainClaude, 1);
  const happy = d.entries.find((e) => e.word === "happy");
  assert.equal(happy.flagged, true);
  assert.ok(happy.warnings.some((w) => /ไม่ได้มาจาก Wiktionary/.test(w)));
  const html = readFileSync(cachePath("report.html"), "utf8");
  assert.match(html, /รายงานตรวจทานคลังคำ/);
  assert.equal((html.match(/<\/script>/g) || []).length, 2);
});

test("build: คำทุกตัวผ่านแล้ว build ได้ ผลคงที่ มี source ทุกที่ และ overrides ทับ", async () => {
  const { cmdBuild } = await import("../tools/build-vocab/src/build.mjs");
  writeFileSync(process.env.VOCAB_OVERRIDES, JSON.stringify({ happy: { tags: ["emotion"] } }));
  const out = await cmdBuild({}, { log: () => {} });
  assert.equal(out.index.count, 4);
  assert.equal(out.index.complete, true);
  assert.deepEqual(readdirSync(process.env.VOCAB_OUT_DIR).sort(), ["index.json", "level-01.json", "level-02.json", "level-04.json", "level-11.json"]);
  const idx = JSON.parse(readFileSync(join(process.env.VOCAB_OUT_DIR, "index.json"), "utf8"));
  assert.equal(idx.license, "CC BY-SA 4.0");
  assert.ok(idx.credits.wiktionary.includes("Wiktionary"));
  const l4 = JSON.parse(readFileSync(join(process.env.VOCAB_OUT_DIR, "level-04.json"), "utf8"));
  assert.deepEqual(l4.words[0].tags, ["emotion"]);
  assert.equal(l4.words[0].src.tags, "manual");
  assert.equal(l4.words[0].th[0].source, "claude");
  assert.equal(l4.words[0].ipa, "/x/");
  const again = await cmdBuild({}, { log: () => {} });
  assert.equal(again.index.contentHash, idx.contentHash);
});

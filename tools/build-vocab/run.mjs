#!/usr/bin/env node
// สร้างคลังคำ 5,050 คำ — รันในเครื่องผู้ดูแลเท่านั้น (ห้าม deploy ห้ามเรียกจากแอป) และไม่เรียก API ภายนอกใด ๆ
// ใช้: node tools/build-vocab/run.mjs <ขั้น> ดูรายละเอียดใน README.md
import { parseArgs } from "./src/util.mjs";

const { _: [step, arg], flags } = parseArgs(process.argv.slice(2));

const STEPS = {
  words: async () => (await import("./src/words.mjs")).runWords(),
  wiktionary: async () => (await import("./src/wiktionary.mjs")).runWiktionary(),
  stats: async () => { const m = await import("./src/wiktionary.mjs"); const { readJson } = await import("./src/util.mjs"); m.formatStats(readJson((await import("./src/util.mjs")).cachePath("wiktionary-stats.json"))); },
  batches: async () => (await import("./src/batches.mjs")).makeBatches(),
  progress: async () => (await import("./src/batches.mjs")).cmdProgress(),
  "validate-batch": async () => {
    const n = Number(arg);
    if (!Number.isInteger(n) || n < 1) throw new Error("ระบุเลขชุด เช่น: validate-batch 1");
    const r = await (await import("./src/batches.mjs")).validateBatch(n);
    if (!r.ok) process.exitCode = 1;
  },
  validate: async () => {
    const { loadWords } = await import("./src/words.mjs");
    const { loadWiktionary } = await import("./src/wiktionary.mjs");
    const { allAcceptedResults } = await import("./src/batches.mjs");
    const { validateAll, loadOverrides } = await import("./src/validate.mjs");
    const words = loadWords();
    const v = validateAll(words, allAcceptedResults(), { wiks: loadWiktionary(), overrides: loadOverrides() });
    console.log(`ตรวจ ${v.total} คำ: ผ่าน ${v.ok} · ไม่ผ่าน ${v.failed.length} · ยังไม่ได้เขียน ${v.missing.length} · ผ่านแต่มีคำเตือน ${v.warned.length}`);
    for (const f of v.failed.slice(0, 30)) console.log(`  ✗ ${f.word} (rank ${f.rank}): ${f.errors[0]}`);
    if (v.failed.length) process.exitCode = 1;
  },
  report: async () => (await import("./src/report.mjs")).cmdReport(flags),
  build: async () => (await import("./src/build.mjs")).cmdBuild(flags),
};

if (!step || !STEPS[step]) {
  console.log(`ขั้นที่รันได้: ${Object.keys(STEPS).join(" | ")}\nตัวอย่าง: node tools/build-vocab/run.mjs words`);
  process.exit(step ? 1 : 0);
}
STEPS[step]().catch((e) => { console.error(`\n✗ ${e.message}`); process.exit(1); });

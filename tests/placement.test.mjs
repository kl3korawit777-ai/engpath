import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as pl from "../js/placement.js";

const idx = JSON.parse(readFileSync(new URL("../vocab/index.json", import.meta.url), "utf8"));
const level = (n) => JSON.parse(readFileSync(new URL(`../vocab/${idx.levels[n - 1].file}`, import.meta.url), "utf8")).words;
const L = Object.fromEntries([1, 2, 3].map((n) => [n, level(n)]));

test("mulberry32: seed เดียวกันได้ลำดับเดียวกัน", () => {
  const a = pl.mulberry32(7), b = pl.mulberry32(7);
  assert.deepEqual([a(), a(), a()], [b(), b(), b()]);
});

test("buildQuestion: 4 ตัวเลือกไม่ซ้ำ คำตอบถูกอยู่ตาม answer และตัวหลอกไม่ใช่คำตอบเดียวกัน", () => {
  const rng = pl.mulberry32(1);
  for (const w of L[1].slice(0, 80)) {
    if (!w.th[0]?.text || w.th[0].text.length > pl.MAX_TH_LEN) continue;
    const q = pl.buildQuestion(w, L[1], rng);
    assert.ok(q, w.word);
    assert.equal(q.choices.length, pl.CHOICES);
    assert.equal(new Set(q.choices).size, pl.CHOICES);
    assert.equal(q.choices[q.answer], w.th[0].text.trim());
    assert.equal(q.wordKey, w.wordKey);
  }
});

test("buildQuestion: ตัวหลอกไม่พอ → null", () => {
  const w = { wordKey: "a", word: "a", level: 1, pos: ["noun"], th: [{ text: "ก" }] };
  assert.equal(pl.buildQuestion(w, [w, { wordKey: "b", pos: ["noun"], th: [{ text: "ข" }] }], pl.mulberry32(1)), null);
});

test("levelQuestions: ได้ n ข้อ คำไม่ซ้ำ และอยู่ในระดับนั้น", () => {
  const qs = pl.levelQuestions(L[2], L[2], 5, pl.mulberry32(3));
  assert.equal(qs.length, 5);
  assert.equal(new Set(qs.map((q) => q.wordKey)).size, 5);
  assert.ok(qs.every((q) => q.level === 2));
});

const run = (perLevelCorrect, levelCount = 11) => {
  const results = [];
  for (let step = pl.nextStep(results, { levelCount }); !step.done; step = pl.nextStep(results, { levelCount })) {
    const c = perLevelCorrect(step.level);
    const n = results.filter((r) => r.level === step.level).length;
    results.push({ level: step.level, correct: n < c });
  }
  return results;
};

test("nextStep: ถามทีละระดับ ระดับละ 5 ข้อ และหยุดเมื่อไม่ผ่านติดกัน 2 ระดับ", () => {
  const r = run((lv) => (lv <= 4 ? 5 : 1));
  assert.deepEqual([...new Set(r.map((x) => x.level))], [1, 2, 3, 4, 5, 6]);
  assert.equal(r.length, 30);
  assert.equal(pl.estimate(r, { levelCount: 11 }).startLevel, 5);
});

test("estimate: ผ่านทุกระดับ → ระดับสูงสุด, ตกตั้งแต่ระดับ 1 → ระดับ 1", () => {
  const all = run(() => 5);
  assert.equal(all.length, 55);
  assert.equal(pl.estimate(all, { levelCount: 11 }).startLevel, 11);
  const none = run(() => 0);
  assert.equal(none.length, 10);
  const e = pl.estimate(none, { levelCount: 11 });
  assert.equal(e.startLevel, 1);
});

test("estimate: ถูก 4/5 ผ่าน (80%), 3/5 ไม่ผ่าน; ผลสลับ = confidence low", () => {
  const r = run((lv) => (lv === 1 ? 4 : lv === 2 ? 3 : lv === 3 ? 5 : 0));
  const e = pl.estimate(r, { levelCount: 11 });
  assert.equal(e.startLevel, 2);
  assert.equal(e.confidence, "low");
  assert.equal(pl.estimate([], { levelCount: 11 }).startLevel, 1);
  assert.equal(pl.estimate(run((lv) => (lv <= 3 ? 5 : 0)), { levelCount: 11 }).confidence, "ok");
});

test("ข้อสอบจริงจากคลังทุกระดับสร้างได้ครบ ระดับละ 5 ข้อ", () => {
  for (let n = 1; n <= idx.levels.length; n++) {
    const words = level(n);
    const qs = pl.levelQuestions(words, words, 5, pl.mulberry32(n));
    assert.equal(qs.length, 5, `level ${n}`);
  }
});

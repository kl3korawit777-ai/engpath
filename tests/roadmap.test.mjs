// รัน: node --test tests/roadmap.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { ROADMAP, ALWAYS_DO, REVIEW_CYCLE } from "../js/data/roadmap.js";
import * as rl from "../js/roadmap-logic.js";

const DAY = 86400000, NOW = new Date(2026, 5, 15, 12).getTime();

test("roadmap data: 6 ขั้น เรียงตาม 0–5 และฟิลด์ครบ", () => {
  assert.deepEqual(ROADMAP.map((s) => s.stage), [0, 1, 2, 3, 4, 5]);
  for (const s of ROADMAP) {
    for (const k of ["cefr", "name", "duration", "goal", "passText"]) assert.ok(s[k] && typeof s[k] === "string", `${s.stage}.${k}`);
    assert.equal(s.actions.length, 4, `actions ${s.stage}`);
    assert.equal(s.tools.length, 4, `tools ${s.stage}`);
    assert.ok(s.criteria.length >= 2);
  }
  assert.equal(ALWAYS_DO.length, 4);
  assert.match(REVIEW_CYCLE.text, /ไม่ต้องเริ่มใหม่ทั้งหมด/);
});

test("เกณฑ์แต่ละช่องเป็นท่อนที่ตัดมาจาก passText ตรงตัวอักษร (ไม่แต่งเพิ่ม)", () => {
  for (const s of ROADMAP) for (const c of s.criteria) assert.ok(s.passText.includes(c.text), `${s.stage}: ${c.text}`);
});

test("เกณฑ์ที่มีข้อมูลประกอบ: ขั้น 4 เท่านั้น (ข้อสอบจำลอง + Error Log)", () => {
  const hints = ROADMAP.flatMap((s) => s.criteria.filter((c) => c.hint).map((c) => [s.stage, c.hint]));
  assert.deepEqual(hints, [[4, "mockExam"], [4, "errorTrend"]]);
});

test("suggestStage: EF SET มาก่อน, รองลงมาค่าเฉลี่ยปัดลง, ไม่มีข้อมูล = ขั้น 0", () => {
  assert.deepEqual(rl.suggestStage({}), { stage: 0, level: null, source: "none" });
  assert.equal(rl.suggestStage({ selfAssess: { listening: "A1", speaking: "A1", reading: "A1", writing: "A1" } }).stage, 1);
  assert.equal(rl.suggestStage({ selfAssess: { listening: "B1", speaking: "A2", reading: "B1", writing: "A2" } }).stage, 2);   // เฉลี่ย 1.5 → A2
  assert.equal(rl.suggestStage({ selfAssess: { listening: "B1", speaking: "B1", reading: "B1", writing: "B1" } }).stage, 3);
  assert.equal(rl.suggestStage({ selfAssess: { reading: "B2" } }).stage, 4);                  // ทักษะเดียวก็ใช้ได้
  assert.equal(rl.suggestStage({ selfAssess: { listening: "C1" } }).stage, 5);
  assert.deepEqual(rl.suggestStage({ efSet: { level: "B1" }, selfAssess: { listening: "A1" } }), { stage: 3, level: "B1", source: "efset" });
  assert.equal(rl.suggestStage({ efSet: { level: "C2" } }).stage, 5);
  assert.equal(rl.suggestStage({ efSet: { level: "??" }, selfAssess: { listening: "A2" } }).stage, 2);   // EF ไม่ถูกต้อง → ใช้ที่ประเมินเอง
});

test("validateGoal: SMART = ระดับ/คะแนน + วันที่ในอนาคต", () => {
  const ok = { type: "cefr", target: "B2", date: "2026-12-31" };
  assert.equal(rl.validateGoal(ok, NOW), null);
  assert.equal(rl.validateGoal({ ...ok, date: "2026-06-15" }, NOW), null);          // วันนี้ใช้ได้
  assert.match(rl.validateGoal({ ...ok, date: "2026-06-14" }, NOW), /อดีต/);
  assert.match(rl.validateGoal({ ...ok, date: "" }, NOW), /วันที่/);
  assert.match(rl.validateGoal({ ...ok, date: "2026-02-31" }, NOW), /ไม่ถูกต้อง/);
  assert.match(rl.validateGoal({ ...ok, target: "Z9" }, NOW), /ระดับ/);
  assert.equal(rl.validateGoal({ type: "exam", examName: "IELTS", target: "6.5", date: "2026-12-31" }, NOW), null);
  assert.match(rl.validateGoal({ type: "exam", examName: " ", target: "6.5", date: "2026-12-31" }, NOW), /ชื่อข้อสอบ/);
  assert.match(rl.validateGoal({ type: "exam", examName: "IELTS", target: "", date: "2026-12-31" }, NOW), /คะแนน/);
  assert.match(rl.validateGoal(null, NOW), /ชนิด/);
});

test("stageProgress / criterionKey", () => {
  assert.equal(rl.criterionKey(4, 1), "4.1");
  assert.deepEqual(rl.stageProgress({}, 4), { done: 0, total: 2, allDone: false });
  assert.deepEqual(rl.stageProgress({ "4.0": true }, 4), { done: 1, total: 2, allDone: false });
  assert.deepEqual(rl.stageProgress({ "4.0": true, "4.1": true, "3.0": true }, 4), { done: 2, total: 2, allDone: true });
  assert.equal(rl.stageProgress({ "4.0": "true" }, 4).done, 0);
});

test("checkpointStatus: ครบรอบ = baseline + n สัปดาห์ (baseline = checkpoint ล่าสุด หรือวัน Onboarding)", () => {
  assert.deepEqual(rl.checkpointStatus({ now: NOW }), { baseline: null, dueAt: null, due: false, daysLeft: null });
  const ob = { doneAt: NOW - 20 * DAY };
  let s = rl.checkpointStatus({ onboarding: ob, weeks: 4, now: NOW });
  assert.equal(s.due, false);
  assert.equal(s.daysLeft, 8);
  s = rl.checkpointStatus({ onboarding: ob, weeks: 4, now: NOW + 8 * DAY });
  assert.equal(s.due, true);
  const cps = [{ at: NOW - 40 * DAY }, { at: NOW - 3 * DAY }];
  s = rl.checkpointStatus({ checkpoints: cps, onboarding: ob, weeks: 5, now: NOW });
  assert.equal(s.baseline, NOW - 3 * DAY);                                  // ใช้ checkpoint ล่าสุด ไม่ใช่ onboarding
  assert.equal(s.due, false);
  assert.equal(rl.checkpointStatus({ checkpoints: cps, weeks: 6, now: NOW + 40 * DAY }).due, true);
});

test("weakSkills: ต่ำกว่าเกณฑ์ เรียงจากอ่อนสุด; ทักษะที่ไม่ได้ใส่ไม่นับ", () => {
  assert.deepEqual(rl.weakSkills({ listening: 90, speaking: 50, reading: 69, writing: 70 }), ["speaking", "reading"]);
  assert.deepEqual(rl.weakSkills({ listening: 80 }), []);
  assert.deepEqual(rl.weakSkills({ listening: 40, speaking: 30 }, 35), ["speaking"]);
  for (const s of rl.SKILLS) assert.ok(rl.WEAK_ADVICE[s.key]);
});

test("validateCheckpoint", () => {
  assert.equal(rl.validateCheckpoint({ scores: { listening: 80 } }), null);
  assert.match(rl.validateCheckpoint({ scores: {} }), /อย่างน้อย 1/);
  assert.match(rl.validateCheckpoint({ scores: { speaking: 101 } }), /พูด.*0–100/);
  assert.match(rl.validateCheckpoint({ scores: { writing: -1 } }), /เขียน/);
  assert.match(rl.validateCheckpoint({ scores: { writing: NaN } }), /เขียน/);
  assert.equal(rl.validateCheckpoint({ scores: { reading: 0 }, mockExam: { score: 80, target: 100 } }), null);
  assert.match(rl.validateCheckpoint({ scores: { reading: 5 }, mockExam: { score: 80 } }), /ข้อสอบจำลอง/);
  assert.match(rl.validateCheckpoint({ scores: { reading: 5 }, mockExam: { score: 1, target: 0 } }), /มากกว่า 0/);
});

test("mockExamHint: 2 ครั้งล่าสุด (ใหม่→เก่า) และถึงเป้าติดกัน", () => {
  const cps = [
    { at: 1, mockExam: { score: 50, target: 70 } },
    { at: 2, scores: {} },
    { at: 3, mockExam: { score: 72, target: 70 } },
    { at: 4, mockExam: { score: 75, target: 70 } },
  ];
  const h = rl.mockExamHint(cps);
  assert.deepEqual(h.last2.map((x) => x.score), [75, 72]);
  assert.equal(h.twoInARow, true);
  assert.equal(rl.mockExamHint(cps.slice(0, 3)).twoInARow, false);          // 72 ถึง แต่ 50 ไม่ถึง
  assert.deepEqual(rl.mockExamHint([]), { last2: [], twoInARow: false });
});

test("errorTrend: นับเฉพาะ occurred, 30 วันล่าสุด vs 30 วันก่อนหน้า", () => {
  const ev = [
    ...[1, 5, 10].map((d) => ({ type: "occurred", at: NOW - d * DAY })),
    ...[35, 40, 45, 59].map((d) => ({ type: "occurred", at: NOW - d * DAY })),
    { type: "resolved", at: NOW - 2 * DAY },
    { type: "occurred", at: NOW - 61 * DAY },
  ];
  assert.deepEqual(rl.errorTrend(ev, NOW), { last: 3, prev: 4, improved: true });
  assert.equal(rl.errorTrend([{ type: "occurred", at: NOW - DAY }], NOW).improved, false);   // ไม่มีช่วงก่อนหน้า = ยังบอกไม่ได้
});

test("isValidCheckpoint: เอกสารผิดรูปไม่นับ", () => {
  const ok = { at: NOW, stage: 2, passed: false, scores: { speaking: 50 } };
  assert.equal(rl.isValidCheckpoint(ok), true);
  assert.equal(rl.isValidCheckpoint({ at: NOW }), false);                       // เหมือนเอกสารทดสอบ rules
  assert.equal(rl.isValidCheckpoint({ ...ok, stage: 9 }), false);
  assert.equal(rl.isValidCheckpoint({ ...ok, passed: undefined }), false);
  assert.equal(rl.isValidCheckpoint({ ...ok, scores: null }), false);
  assert.equal(rl.isValidCheckpoint(null), false);
});

test("mockExamHint: รวมผลจากโหมดสอบ (examAttempts ที่ตั้งเป้า) กับ checkpoint; ชุดต่างแนวไม่ปนกัน", () => {
  const att = (start, scorePct, presetId = "p1", target = 70) => ({ start, scorePct, config: { presetId, name: presetId, targetPercent: target } });
  const h = rl.mockExamHint([], [att(10, 72), att(20, 80)]);
  assert.deepEqual(h.last2.map((x) => [x.score, x.src, x.reached]), [[80, "exam", true], [72, "exam", true]]);
  assert.equal(h.twoInARow, true);
  // checkpoint ใหม่กว่า + ผลสอบหนึ่งครั้ง
  const mix = rl.mockExamHint([{ at: 30, mockExam: { score: 65, target: 70 } }], [att(10, 90), att(20, 75)]);
  assert.deepEqual(mix.last2.map((x) => [x.src, x.reached]), [["checkpoint", false], ["exam", true]]);
  assert.equal(mix.twoInARow, false);
  // ชุดแนวเดียวกับครั้งล่าสุดเท่านั้น (p2 ล่าสุด → p1 ไม่ถูกนับ)
  const split = rl.mockExamHint([], [att(10, 90, "p1"), att(20, 95, "p2")]);
  assert.equal(split.last2.length, 1);
  assert.equal(split.twoInARow, false);
  assert.deepEqual(rl.mockExamHint([], []), { last2: [], twoInARow: false });
});

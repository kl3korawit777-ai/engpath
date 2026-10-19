// รัน: node --test tests/srs.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as srs from "../js/srs.js";

const T0 = 1_700_000_000_000;

test("SM-2: ลำดับ interval 1 → 6 → ×ease", () => {
  let s = srs.initialState();
  s = srs.applyReview(s, 2, T0);          // จำได้ (q=4)
  assert.equal(s.interval, 1);
  s = srs.applyReview(s, 2, T0);
  assert.equal(s.interval, 6);
  const ease = s.ease;
  s = srs.applyReview(s, 2, T0);
  assert.equal(s.interval, Math.round(6 * ease));
  assert.equal(s.due, T0 + s.interval * srs.DAY);
});

test("SM-2: ease เริ่ม 2.5, q=4 ไม่เปลี่ยน, q=5 +0.1, q=3 -0.14, ต่ำสุด 1.3", () => {
  const s0 = srs.initialState();
  assert.equal(s0.ease, 2.5);
  assert.ok(Math.abs(srs.applyReview(s0, 2, T0).ease - 2.5) < 1e-9);
  assert.ok(Math.abs(srs.applyReview(s0, 3, T0).ease - 2.6) < 1e-9);
  assert.ok(Math.abs(srs.applyReview(s0, 1, T0).ease - 2.36) < 1e-9);
  let s = s0;
  for (let i = 0; i < 30; i++) s = srs.applyReview(s, 1, T0);
  assert.equal(s.ease, srs.MIN_EASE);
});

test("SM-2: ลืม = reps รีเซ็ต, interval 1 วัน, ease คงเดิม", () => {
  let s = srs.applyReview(srs.applyReview(srs.initialState(), 3, T0), 3, T0);
  const ease = s.ease;
  s = srs.applyReview(s, 0, T0);
  assert.equal(s.reps, 0);
  assert.equal(s.interval, 1);
  assert.equal(s.ease, ease);
  assert.equal(s.lapses, 1);
});

test("buildState: เล่น reviews ซ้ำตามเวลา ไม่ขึ้นกับลำดับที่ส่งเข้ามา (รวมสองเครื่อง)", () => {
  const a = { id: "a", cardId: "c", rating: 2, at: T0 };
  const b = { id: "b", cardId: "c", rating: 3, at: T0 + 1000 };
  const c = { id: "c", cardId: "c", rating: 0, at: T0 + 2000 };
  assert.deepEqual(srs.buildState([c, a, b]), srs.buildState([a, b, c]));
  assert.equal(srs.buildState([a, b, c]).reps, 0);
});

test("stateMap + isDue", () => {
  const cards = [{ id: "n" }, { id: "x" }];
  const m = srs.stateMap(cards, [{ id: "r", cardId: "x", rating: 2, at: T0 }]);
  assert.ok(srs.isDue(m.get("n"), T0));                    // บัตรใหม่ถึงรอบเสมอ
  assert.ok(!srs.isDue(m.get("x"), T0 + 1000));            // ทบทวนแล้ว ยังไม่ถึง
  assert.ok(srs.isDue(m.get("x"), T0 + srs.DAY));          // ครบ 1 วัน
});

test("previewIntervals / formatInterval", () => {
  const p = srs.previewIntervals(srs.initialState(), T0);
  assert.deepEqual(p, [1, 1, 1, 1]);
  assert.equal(srs.formatInterval(6), "6 วัน");
  assert.equal(srs.formatInterval(21), "3 สัปดาห์");
  assert.equal(srs.formatInterval(90), "3 เดือน");
});

test("checkAnswer: normalize + Levenshtein ≤ 2", () => {
  assert.equal(srs.checkAnswer("  Apple! ", "apple"), "correct");
  assert.equal(srs.checkAnswer("look  after", "Look after."), "correct");
  assert.equal(srs.checkAnswer("recieve", "receive"), "near");
  assert.equal(srs.checkAnswer("banana", "receive"), "wrong");
  assert.equal(srs.checkAnswer("", "receive"), "wrong");
  assert.equal(srs.levenshtein("kitten", "sitting"), 3);
});

test("validateCard: ประโยคตัวอย่างต้อง ≥ 4 คำ", () => {
  const ok = { en: "run out of", th: "หมด", example: "We ran out of milk yesterday." };
  assert.equal(srs.validateCard(ok), null);
  assert.match(srs.validateCard({ ...ok, example: "ran out of" }), /อย่างน้อย 4 คำ/);
  assert.match(srs.validateCard({ ...ok, example: "" }), /อย่างน้อย 4 คำ/);
  assert.equal(srs.validateCard({ ...ok, example: "I don't like it." }), null);   // don't = 1 คำ → 4 คำพอดี
  assert.ok(srs.validateCard({ ...ok, en: " " }));
});

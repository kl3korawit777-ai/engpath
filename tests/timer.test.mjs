// รัน: node --test tests/timer.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as timer from "../js/timer.js";

const T0 = new Date(2026, 0, 15, 10, 0, 0).getTime();
const MIN = 60000;

test("สัดส่วนนาทีตามขั้น", () => {
  assert.deepEqual(timer.PLANS[0], [15, 20, 15, 10]);
  assert.deepEqual(timer.PLANS[1], [15, 25, 10, 10]);
  assert.deepEqual(timer.PLANS[2], [15, 25, 10, 10]);
  for (const s of [3, 4, 5]) assert.deepEqual(timer.PLANS[s], [15, 15, 20, 10]);
});

test("พัก/เริ่มต่อ: remaining นับจาก timestamp และบันทึก session ต่อช่วงที่เดิน", () => {
  let t = timer.create(0);
  t = timer.start(t, T0).t;
  assert.equal(timer.remaining(t, T0 + 5 * MIN), 10 * MIN);
  const p = timer.pause(t, T0 + 5 * MIN);
  assert.equal(p.slices.length, 1);
  assert.deepEqual(p.slices[0], { start: T0, end: T0 + 5 * MIN, durationSec: 300, skill: "srs", stage: 0 });
  t = timer.start(p.t, T0 + 20 * MIN).t;                 // พักไป 15 นาที ไม่นับ
  assert.equal(timer.remaining(t, T0 + 22 * MIN), 8 * MIN);
});

test("สลับแอปไป 2 นาที (ไม่มี tick เลย) แล้วกลับมา เวลายังตรง", () => {
  let t = timer.start(timer.create(1), T0).t;
  assert.equal(timer.remaining(t, T0 + 2 * MIN), 13 * MIN);
  assert.equal(timer.tick(t, T0 + 2 * MIN).slices.length, 0);
});

test("ครบเวลา: บันทึกตัดที่เวลาครบพอดี แล้วขึ้นช่วงถัดไปในสถานะหยุด", () => {
  let t = timer.start(timer.create(0), T0).t;
  const r = timer.tick(t, T0 + 40 * MIN);                 // กลับมาช้ากว่ากำหนดมาก
  assert.deepEqual(r.slices[0], { start: T0, end: T0 + 15 * MIN, durationSec: 900, skill: "srs", stage: 0 });
  assert.equal(r.t.idx, 1);
  assert.equal(timer.isRunning(r.t), false);
  assert.equal(timer.remaining(r.t, T0 + 40 * MIN), 20 * MIN);
});

test("ข้ามช่วง: บันทึกส่วนที่เดินไปแล้ว; ข้ามช่วงที่ยังไม่เริ่มไม่บันทึก", () => {
  let t = timer.start(timer.create(3), T0).t;
  const s1 = timer.skip(t, T0 + 3 * MIN);
  assert.equal(s1.slices[0].durationSec, 180);
  assert.equal(s1.t.idx, 1);
  const s2 = timer.skip(s1.t, T0 + 4 * MIN);
  assert.equal(s2.slices.length, 0);
  assert.equal(s2.t.idx, 2);
});

test("ช่วงสุดท้ายจบ = done; skill ตามลำดับ srs/input/output/weak", () => {
  let t = timer.create(0), now = T0;
  const skills = [];
  for (let i = 0; i < 4; i++) {
    t = timer.start(t, now).t;
    now += 60 * MIN;
    const r = timer.tick(t, now);
    skills.push(r.slices[0].skill);
    t = r.t;
  }
  assert.deepEqual(skills, ["srs", "input", "output", "weak"]);
  assert.equal(t.done, true);
  assert.equal(timer.start(t, now).t.runStart, null);
});

test("เริ่มใหม่ระหว่างเดิน: บันทึกก่อนล้าง; เปลี่ยนขั้นใช้แผนใหม่", () => {
  const t = timer.start(timer.create(0), T0).t;
  const r = timer.reset(t, T0 + 90_000, 4);
  assert.equal(r.slices[0].durationSec, 90);
  assert.equal(r.t.stage, 4);
  assert.equal(r.t.idx, 0);
  assert.equal(r.t.elapsed, 0);
});

test("ไม่บันทึก slice ที่สั้นกว่า 1 วินาที", () => {
  const t = timer.start(timer.create(0), T0).t;
  assert.equal(timer.pause(t, T0 + 300).slices.length, 0);
});

test("minutesOnDay: เวลาท้องถิ่น แยกวัน", () => {
  const day2 = new Date(2026, 0, 16, 0, 0, 5).getTime();
  const late = new Date(2026, 0, 15, 23, 59, 0).getTime();
  const ss = [
    { start: T0, durationSec: 600 },
    { start: late, durationSec: 120 },
    { start: day2, durationSec: 900 },
  ];
  assert.equal(timer.minutesOnDay(ss, T0), 12);
  assert.equal(timer.minutesOnDay(ss, day2), 15);
});

test("formatClock", () => {
  assert.equal(timer.formatClock(15 * MIN), "15:00");
  assert.equal(timer.formatClock(61_500), "01:02");
  assert.equal(timer.formatClock(0), "00:00");
});

test("planFor: 60 นาที = สัดส่วนเดิมของเฟส 1 ทุกขั้น", () => {
  for (const s of [0, 1, 2, 3, 4, 5]) assert.deepEqual(timer.planFor(s), timer.PLANS[s]);
  assert.deepEqual(timer.planFor(0, 60), [15, 20, 15, 10]);
  assert.notEqual(timer.planFor(0), timer.PLANS[0]);                  // เป็นสำเนา ไม่ใช่ตัวเดียวกัน
});

test("planFor: สเกลตามเวลาเรียนต่อวัน ผลรวมเท่ากับที่ตั้งพอดี", () => {
  for (const s of [0, 1, 3]) for (const d of [30, 45, 60, 75, 90, 120]) {
    const p = timer.planFor(s, d);
    assert.equal(p.reduce((a, b) => a + b, 0), d, `stage ${s} daily ${d}`);
    assert.ok(p.every((m) => m >= 1));
  }
  assert.deepEqual(timer.planFor(0, 30), [8, 10, 7, 5]);              // 7.5/10/7.5/5 → ปัดตามเศษมากสุด (ลำดับแรกก่อนเมื่อเท่ากัน)
  assert.deepEqual(timer.planFor(3, 120), [30, 30, 40, 20]);
});

test("timer ใช้ plan ที่สเกลแล้ว: ครบเวลาตามแผนใหม่ และ reset คงแผนเดิมของขั้นเดียวกัน", () => {
  const plan = timer.planFor(0, 30);                                  // ช่วงแรก 8 นาที
  let t = timer.start(timer.create(0, plan), T0).t;
  assert.equal(timer.remaining(t, T0 + 2 * MIN), 6 * MIN);
  const r = timer.tick(t, T0 + 9 * MIN);
  assert.equal(r.slices[0].durationSec, 8 * 60);
  assert.equal(timer.reset(r.t, T0 + 9 * MIN).t.plan, plan);          // ขั้นเดิม → แผนเดิม
  assert.deepEqual(timer.reset(r.t, T0, 3).t.plan, timer.PLANS[3]);   // เปลี่ยนขั้นโดยไม่ส่งแผน → แผนตั้งต้นของขั้นนั้น
  assert.equal(timer.remaining(timer.create(2), T0), 15 * MIN);       // ไม่ส่งแผน = พฤติกรรมเฟส 1
});

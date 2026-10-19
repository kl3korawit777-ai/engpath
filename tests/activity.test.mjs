// รัน: node --test tests/activity.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { ActivityClock, toSession, IDLE_MS } from "../js/activity.js";

const T0 = 1_800_000_000_000, S = 1000;

test("นับเวลาระหว่างการโต้ตอบที่ถี่ ๆ และคิดช่วงท้ายอีกไม่เกิน idle", () => {
  const c = new ActivityClock();
  c.touch(T0); c.touch(T0 + 10 * S); c.touch(T0 + 25 * S);
  const s = c.flush(T0 + 30 * S);                              // 25 วินาทีแรก + 5 วินาทีท้าย
  assert.equal(s.durationSec, 30);
  assert.equal(s.start, T0);
});

test("ปล่อยว่างนาน: แต่ละการโต้ตอบนับได้ไม่เกิน 60 วินาที", () => {
  const c = new ActivityClock();
  c.touch(T0);
  c.touch(T0 + 10 * 60 * S);                                   // หายไป 10 นาที แล้วกลับมา → ได้แค่ 60 วินาที
  const s = c.flush(T0 + 10 * 60 * S + 3 * S);
  assert.equal(s.durationSec, 60 + 3);
});

test("flush ตอนซ่อนหน้าหลังว่างนาน นับเพิ่มได้ไม่เกิน idle", () => {
  const c = new ActivityClock();
  c.touch(T0);
  assert.equal(c.flush(T0 + 3600 * S).durationSec, IDLE_MS / S);
});

test("ไม่มีการโต้ตอบ/ไม่ถึง 1 วินาที = ไม่บันทึก; flush แล้วเริ่มรอบใหม่", () => {
  const c = new ActivityClock();
  assert.equal(c.flush(T0), null);
  c.touch(T0);
  assert.equal(c.flush(T0 + 300), null);
  c.touch(T0 + 5 * S); c.touch(T0 + 8 * S);
  assert.equal(c.flush(T0 + 8 * S).durationSec, 3);
  assert.equal(c.flush(T0 + 100 * S), null);                   // รอบใหม่ยังไม่มีการโต้ตอบ
});

test("toSession: skill ใหม่ และ null ผ่านเป็น null", () => {
  assert.deepEqual(toSession({ start: 1, end: 5001, durationSec: 5 }, "writing", 2), { start: 1, end: 5001, durationSec: 5, skill: "writing", stage: 2 });
  assert.equal(toSession(null, "writing", 2), null);
});

test("elapsed: ดูเวลาใช้งานจริงโดยไม่ปิดรอบ (flush ยังได้ค่าเท่าเดิม)", () => {
  const c = new ActivityClock();
  assert.equal(c.elapsed(T0), 0);
  c.touch(T0); c.touch(T0 + 20 * S);
  assert.equal(c.elapsed(T0 + 25 * S), 25);
  assert.equal(c.elapsed(T0 + 3600 * S), 20 + 60);                 // ว่างนาน นับเพิ่มได้ไม่เกิน idle
  assert.equal(c.flush(T0 + 25 * S).durationSec, 25);
  assert.equal(c.elapsed(T0 + 30 * S), 0);
});

// รัน: node --test tests/streak.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as st from "../js/streak.js";

const at = (d, hh = 12, mm = 0) => new Date(2026, 0, d, hh, mm, 0).getTime();    // ม.ค. 2026 เวลาท้องถิ่น
const counts = (...tsList) => st.activityCounts(tsList.map((start) => ({ start })), []);

test("ข้ามเที่ยงคืน: 23:59 วันที่ 10 + 00:01 วันที่ 11 = 2 วันติด", () => {
  const c = st.activityCounts([{ start: at(10, 23, 59) }], [{ at: at(11, 0, 1) }]);
  assert.equal(st.dayKey(at(10, 23, 59)), "2026-01-10");
  assert.equal(st.dayKey(at(11, 0, 1)), "2026-01-11");
  assert.equal(st.currentStreak(c, at(11, 9)), 2);
});

test("วันนี้ยังไม่มีกิจกรรม แต่เมื่อวานมี → streak ยังไม่ขาด", () => {
  const c = counts(at(9), at(10));
  assert.equal(st.currentStreak(c, at(11, 0, 30)), 2);      // เพิ่งผ่านเที่ยงคืน
  assert.equal(st.currentStreak(c, at(11, 23, 59)), 2);     // จนถึงสิ้นวัน
});

test("ขาดเมื่อพ้นอีกวัน: เมื่อวานก็ไม่มี → 0", () => {
  const c = counts(at(9), at(10));
  assert.equal(st.currentStreak(c, at(12, 0, 30)), 0);
});

test("มีช่องว่างกลางทาง นับเฉพาะช่วงล่าสุด", () => {
  const c = counts(at(5), at(6), at(8), at(9), at(10));
  assert.equal(st.currentStreak(c, at(10, 20)), 3);
});

test("session และ review ในวันเดียวกันนับเป็นวันเดียว; ไม่มีข้อมูล = 0", () => {
  const c = st.activityCounts([{ start: at(10) }], [{ at: at(10, 15) }]);
  assert.equal(c.get("2026-01-10"), 2);
  assert.equal(st.currentStreak(c, at(10, 18)), 1);
  assert.equal(st.currentStreak(new Map(), at(10)), 0);
});

test("ข้ามเดือน/ปี", () => {
  const ts = (y, m, d) => new Date(y, m, d, 12).getTime();
  const c = st.activityCounts([{ start: ts(2025, 11, 30) }, { start: ts(2025, 11, 31) }, { start: ts(2026, 0, 1) }], []);
  assert.equal(st.currentStreak(c, ts(2026, 0, 1)), 3);
});

test("heatmap: 12 สัปดาห์ × 7 วัน, จันทร์เริ่ม, สัปดาห์สุดท้ายมีวันนี้และวัน future", () => {
  const now = at(14);                                       // พุธ 14 ม.ค. 2026
  const hm = st.heatmap(counts(at(14), at(14), at(13)), now);
  assert.equal(hm.length, 12);
  assert.ok(hm.every((w) => w.length === 7));
  const last = hm[11];
  assert.equal(last[0].key, "2026-01-12");                  // จันทร์
  assert.equal(last[2].today, true);
  assert.equal(last[2].count, 2);
  assert.equal(last[1].count, 1);
  assert.equal(last[3].future, true);
  assert.equal(last[2].future, false);
  assert.equal(hm[0][0].key, "2025-10-27");                 // จันทร์ 11 สัปดาห์ก่อน
});

test("level", () => {
  assert.deepEqual([0, 1, 2, 3, 9, 10, 24, 25].map(st.level), [0, 1, 1, 2, 2, 3, 3, 4]);
});

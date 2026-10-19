import test from "node:test";
import assert from "node:assert/strict";
import { computeAll } from "../js/stats.js";
import * as dl from "../js/dashboardlogic.js";
import { initialState, applyReview } from "../js/srs.js";

const NOW = new Date(2026, 9, 19, 12).getTime();            // จันทร์ 19 ต.ค. 2026 12:00 (เวลาท้องถิ่น)
const at = (daysAgo, h = 10, m = 0) => new Date(2026, 9, 19 - daysAgo, h, m).getTime();
const sess = (id, daysAgo, min, skill, h = 10) => ({ id, start: at(daysAgo, h), end: at(daysAgo, h) + min * 60000, durationSec: min * 60, skill, stage: 1 });
const rev = (id, cardId, rating, daysAgo, h = 9) => ({ id, cardId, rating, at: at(daysAgo, h), createdAt: at(daysAgo, h) });
const card = (id, daysAgo) => ({ id, en: id, th: "x", createdAt: at(daysAgo, 8), deleted: false });

// ชุดข้อมูลที่รู้คำตอบ
const data = {
  sessions: [sess("s1", 0, 30, "input"), sess("s2", 0, 15, "output", 20), sess("s3", 1, 60, "srs"), sess("s4", 2, 20, "shadowing"), sess("s5", 8, 40, "input"), sess("s6", 9, 10, "journal")],
  reviews: [rev("r1", "a", 2, 0), rev("r2", "a", 0, 0), rev("r3", "b", 3, 1), rev("r4", "b", 2, 8), rev("r5", "c", 1, 8)],
  cards: [card("a", 10), card("b", 9), card("c", 8)],
  errors: [{ id: "e1", category: "Tense", createdAt: at(0), deleted: false }],
  errorEvents: [{ id: "x1", errorId: "e1", type: "occurred", at: at(0) }, { id: "x2", errorId: "e1", type: "occurred", at: at(1) }],
  handwritingAttempts: [{ id: "h1", at: at(0), style: "print", score: 80 }, { id: "h2", at: at(0, 11), style: "print", score: 60 }, { id: "h3", at: at(3), style: "cursive", score: 50 }],
};
const map = computeAll(data);

test("rangeKeys: ช่วงและช่วงก่อนหน้า", () => {
  assert.deepEqual(dl.rangeKeys("day", NOW).keys, ["2026-10-19"]);
  assert.deepEqual(dl.rangeKeys("day", NOW).prevKeys, ["2026-10-18"]);
  const w = dl.rangeKeys("week", NOW);
  assert.equal(w.keys.length, 7); assert.equal(w.keys[0], "2026-10-13"); assert.equal(w.keys[6], "2026-10-19");
  assert.equal(w.prevKeys[6], "2026-10-12");
  const m = dl.rangeKeys("month", NOW);
  assert.equal(m.keys.length, 30); assert.equal(m.keys[0], "2026-09-20");
  const all = dl.rangeKeys("all", NOW, "2026-10-01");
  assert.equal(all.keys.length, 19); assert.equal(all.prevKeys, null);
  assert.deepEqual(dl.rangeKeys("all", NOW, null).keys, ["2026-10-19"]);
});

test("addDays ข้ามเดือน/ปี", () => {
  assert.equal(dl.addDays("2026-03-01", -1), "2026-02-28");
  assert.equal(dl.addDays("2026-12-31", 1), "2027-01-01");
});

test("KPI สัปดาห์: เวลารวม, % ตอบถูก, เทียบสัปดาห์ก่อน", () => {
  const k = dl.kpis({ map, range: "week", now: NOW, liveKnown: 3 });
  assert.equal(k.studySec.value, (30 + 15 + 60 + 20) * 60);            // s1–s4 (s5/s6 อยู่ก่อนหน้า)
  assert.equal(k.studySec.prev, 50 * 60);                              // สัปดาห์ก่อน: s5 (40 นาที) + s6 (10 นาที)
  assert.equal(k.accuracy.value, 67);                                  // วันนี้: 2,0 ; เมื่อวาน: 3 → ถูก 2 จาก 3 = 67%
  assert.equal(k.accuracy.reviews, 3);
  assert.equal(k.known.value, 3);
});

test("KPI: ช่วง prev ถูกต้องตามนิยาม (สัปดาห์ก่อน = 6–12 ต.ค.)", () => {
  const k = dl.kpis({ map, range: "week", now: NOW, liveKnown: 0 });
  // s6 อยู่ 9 วันก่อน = 10 ต.ค. อยู่ในช่วง 6–12 ต.ค.; s5 อยู่ 8 วันก่อน = 11 ต.ค. อยู่ในช่วงเดียวกัน
  assert.equal(k.studySec.prev, (40 + 10) * 60);
  assert.deepEqual(k.studySec.change, { abs: 125 * 60 - 50 * 60, pct: 150 });
});

test("streak: ปัจจุบันและยาวที่สุด", () => {
  const k = dl.kpis({ map, range: "all", now: NOW, liveKnown: 0 });
  // วันที่มีกิจกรรม: 0,1,2 วันก่อน (ติดกัน 3), 8,9 วันก่อน (ติดกัน 2), และ 3 วันก่อนไม่มี session/review
  assert.equal(k.streak.current, 3);
  assert.equal(k.streak.longest, 3);
  assert.equal(dl.longestStreak(["2026-01-01", "2026-01-02", "2026-01-04", "2026-01-05", "2026-01-06"]), 3);
  assert.equal(dl.longestStreak([]), 0);
  assert.equal(dl.kpis({ map, range: "all", now: NOW, liveKnown: 0 }).studySec.prev, null);
});

test("change: ฐาน 0 ไม่หารศูนย์", () => {
  assert.deepEqual(dl.change(10, 0), { abs: 10, pct: null });
  assert.equal(dl.change(5, null), null);
  assert.deepEqual(dl.change(5, 10), { abs: -5, pct: -50 });
});

test("timeSeries: stacked ตาม skill (นาที) และโหมดรายชั่วโมงสำหรับ 'วัน'", () => {
  const w = dl.timeSeries({ map, range: "week", now: NOW, dailyMinutes: 60 });
  assert.equal(w.kind, "day"); assert.equal(w.goal, 60);
  assert.deepEqual(w.datasets.map((d) => d.skill).sort(), ["input", "output", "shadowing", "srs"]);
  const input = w.datasets.find((d) => d.skill === "input").data;
  assert.equal(input[6], 30); assert.equal(input.reduce((a, b) => a + b, 0), 30);
  const day = dl.timeSeries({ map, range: "day", now: NOW, dailyMinutes: 60 });
  assert.equal(day.kind, "hour"); assert.equal(day.datasets[0].data.length, 24);
  assert.equal(day.datasets[0].data[10], 30); assert.equal(day.datasets[0].data[20], 15);
});

test("weekdayHour: ตารางชั่วโมง × วัน และช่วงที่เรียนบ่อยที่สุด", () => {
  const r = dl.weekdayHour({ map, range: "week", now: NOW });
  assert.equal(r.cells.length, 7); assert.equal(r.cells[0].length, 24);
  // 19 ต.ค. เป็นวันจันทร์ (index 0): input 30 นาทีที่ 10:00 ; output 15 นาทีที่ 20:00
  assert.equal(r.cells[0][10], 30); assert.equal(r.cells[0][20], 15);
  assert.deepEqual(r.best, { hour: 10, minutes: 30 + 60 + 20 });           // 10:00 ของทุกวันในช่วง (s1,s3,s4)
  assert.equal(r.max, 60);
});

test("ioShare: สัดส่วนจริงเทียบที่แผนแนะนำ", () => {
  const r = dl.ioShare({ map, range: "week", now: NOW, stage: 1, dailyMinutes: 60 });
  assert.equal(r.inputMin, 30);
  assert.equal(r.outputMin, 35);                                           // output 15 + shadowing 20
  assert.equal(r.actual, 46);                                              // 30/65
  assert.equal(r.recommended, 71);                                         // ขั้น 1: input 25 / (25+10)
  assert.deepEqual(r.recommendedMin, { input: 25, output: 10 });
  const none = dl.ioShare({ map: new Map(), range: "week", now: NOW, stage: 0, dailyMinutes: 60 });
  assert.equal(none.actual, null);
});

test("vocabGrowth: สะสมเริ่มจากยอดก่อนช่วง", () => {
  const g = dl.vocabGrowth({ map, range: "week", now: NOW });
  // การ์ดสร้าง 10,9,8 วันก่อน = ก่อนสัปดาห์นี้ (13–19 ต.ค.) ทั้งหมด → เริ่มที่ 3
  assert.equal(g.cards[0], 3); assert.equal(g.cards[6], 3);
  assert.equal(g.known.length, 7);
});

test("forecast: เฉพาะบัตรที่เคยทบทวน, เลยกำหนดนับเป็นวันนี้, ภายใน 14 วัน", () => {
  const mk = (rating, daysAgo) => applyReview(initialState(), rating, at(daysAgo, 9));
  const states = new Map([
    ["a", mk(2, 5)],                       // interval 1 วัน due 4 วันก่อน → เลยกำหนด → วันนี้
    ["b", { ...mk(2, 0), due: at(0) + 3 * 86400000 }],        // อีก 3 วัน
    ["c", initialState()],                 // ใหม่ ไม่นับ
    ["d", { ...mk(2, 0), due: at(0) + 30 * 86400000 }],       // เกิน 14 วัน
  ]);
  const f = dl.forecast({ cards: ["a", "b", "c", "d"].map((id) => ({ id })), states, now: NOW, days: 14 });
  assert.equal(f.labels.length, 14); assert.equal(f.labels[0], "2026-10-19");
  assert.equal(f.counts[0], 1); assert.equal(f.counts[3], 1);
  assert.equal(f.counts.reduce((a, b) => a + b, 0), 2);
});

test("errorMonths: เดือนนี้เทียบเดือนก่อนตามหมวด", () => {
  const m = computeAll({
    errors: [{ id: "e1", category: "Tense", createdAt: 1 }, { id: "e2", category: "Article", createdAt: 1 }],
    errorEvents: [
      { id: "1", errorId: "e1", type: "occurred", at: new Date(2026, 9, 2, 9).getTime() }, { id: "2", errorId: "e1", type: "occurred", at: new Date(2026, 9, 3, 9).getTime() },
      { id: "3", errorId: "e2", type: "occurred", at: new Date(2026, 8, 30, 9).getTime() }, { id: "4", errorId: "e1", type: "occurred", at: new Date(2026, 8, 15, 9).getTime() },
    ],
  });
  const r = dl.errorMonths({ map: m, now: NOW });
  assert.deepEqual(r.labels, ["Article", "Tense"]);
  assert.deepEqual(r.current, [0, 2]);
  assert.deepEqual(r.previous, [1, 1]);
  assert.equal(r.month, "2026-10"); assert.equal(r.prevMonth, "2026-09");
});

test("handwritingSeries: เฉลี่ยรายวัน แยก style และ null เมื่อไม่มีข้อมูล", () => {
  const h = dl.handwritingSeries({ map, range: "week", now: NOW });
  assert.equal(h.print[6], 70);
  assert.equal(h.cursive[3], 50);
  assert.equal(h.print[5], null);
});

test("formatDuration", () => {
  assert.equal(dl.formatDuration(1800), "30 นาที");
  assert.equal(dl.formatDuration(3900), "1 ชม. 5 นาที");
});

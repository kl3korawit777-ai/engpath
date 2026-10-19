import test from "node:test";
import assert from "node:assert/strict";
import { computeAll, canonical, sameStats, diffStats, isValidStats, STATS_VERSION } from "../js/stats.js";
import { activityCounts } from "../js/streak.js";

const T = (d, h = 0, m = 0, s = 0) => new Date(2026, 9, d, h, m, s).getTime();     // ตุลาคม 2026 เวลาท้องถิ่น
const sess = (id, start, durationSec, skill = "input") => ({ id, start, end: start + durationSec * 1000, durationSec, skill, stage: 1 });
const rev = (id, cardId, rating, at) => ({ id, cardId, rating, at, createdAt: at });
const card = (id, createdAt, extra = {}) => ({ id, en: id, th: "x", createdAt, deleted: false, ...extra });

test("session: นับวินาทีตาม skill และตามชั่วโมง", () => {
  const m = computeAll({ sessions: [sess("s1", T(5, 9, 30), 3600), sess("s2", T(5, 20), 600, "output")] });
  const d = m.get("2026-10-05");
  assert.equal(d.sec.input, 3600);
  assert.equal(d.sec.output, 600);
  assert.equal(d.hourSec[9], 1800);
  assert.equal(d.hourSec[10], 1800);
  assert.equal(d.hourSec[20], 600);
  assert.equal(d.hourSec.reduce((a, b) => a + b, 0), 4200);
  assert.equal(d.activity, 2);
  assert.ok(isValidStats(d));
});

test("session ข้ามเที่ยงคืน: แบ่งเข้าสองวันไม่ขาดไม่เกิน และกิจกรรมนับที่วันเริ่ม", () => {
  const m = computeAll({ sessions: [sess("s", T(5, 23, 50), 1200, "journal")] });   // 23:50 → 00:10
  const a = m.get("2026-10-05"), b = m.get("2026-10-06");
  assert.equal(a.sec.journal, 600);
  assert.equal(b.sec.journal, 600);
  assert.equal(a.hourSec[23], 600);
  assert.equal(b.hourSec[0], 600);
  assert.equal(a.activity, 1);
  assert.equal(b.activity, 0);
});

test("ผลรวมไม่เพี้ยนเมื่อ session ถูกแบ่งหลายช่วงที่ไม่ลงตัว (ไม่มีเศษหาย)", () => {
  const m = computeAll({ sessions: [sess("s", T(7, 10, 59, 59), 7201)] });
  const d = m.get("2026-10-07");
  assert.equal(d.sec.input, 7201);
  assert.equal(d.hourSec.reduce((a, b) => a + b, 0), 7201);
});

test("ผลไม่ขึ้นกับลำดับ event และสองเครื่องที่ได้ชุดเดียวกันได้ค่าเท่ากัน (ไม่นับซ้ำ)", () => {
  const sessions = [sess("a", T(1, 8), 900), sess("b", T(1, 9), 1200, "srs"), sess("c", T(2, 23, 59), 300, "output")];
  const reviews = [rev("r1", "c1", 2, T(1, 10)), rev("r2", "c1", 0, T(1, 11)), rev("r3", "c2", 3, T(2, 12))];
  const cards = [card("c1", T(1, 7)), card("c2", T(2, 7))];
  const handwritingAttempts = [0.1, 0.2, 0.3, 77.7, 12.34].map((score, i) => ({ id: `h${i}`, at: T(1, 12, i), style: "print", score }));
  const data = { sessions, reviews, cards, handwritingAttempts };
  const reversed = { sessions: [...sessions].reverse(), reviews: [...reviews].reverse(), cards: [...cards].reverse(), handwritingAttempts: [...handwritingAttempts].reverse() };
  const A = computeAll(data), B = computeAll(reversed);
  assert.deepEqual([...A.keys()], [...B.keys()]);
  for (const k of A.keys()) assert.equal(canonical(A.get(k)), canonical(B.get(k)));
  // เครื่อง X เห็นช่วงแรก เครื่อง Y เห็นอีกช่วง (ทับซ้อนกัน) → รวมตาม id ต้องเท่ากับชุดเต็ม ไม่ใช่บวกกัน
  const union = (a, b) => [...new Map([...a, ...b].map((e) => [e.id, e])).values()];
  const merged = computeAll({
    sessions: union(sessions.slice(0, 2), sessions.slice(1)), reviews: union(reviews.slice(0, 2), reviews.slice(1)), cards,
    handwritingAttempts: union(handwritingAttempts.slice(0, 3), handwritingAttempts.slice(2)),
  });
  for (const k of A.keys()) assert.equal(canonical(merged.get(k)), canonical(A.get(k)));
  assert.equal(diffStats(A, [...computeAll(data).values()]).length, 0);       // คำนวณซ้ำ = ค่าเดิม ไม่มีอะไรต้องเขียน
});

test("reviews: นับทั้งหมด/ตอบถูก (rating>0)", () => {
  const m = computeAll({ reviews: [rev("1", "c", 0, T(3, 9)), rev("2", "c", 1, T(3, 10)), rev("3", "c", 3, T(3, 11))], cards: [card("c", T(3, 8))] });
  const d = m.get("2026-10-03");
  assert.equal(d.reviews, 3);
  assert.equal(d.correct, 2);
  assert.equal(d.newCards, 1);
});

test("คำที่จำได้: ได้เมื่อ interval ≥ 21 วัน และเสียเมื่อกดลืม; บัตรที่ลบแล้วไม่นับ", () => {
  // ตอบ "จำได้"(2) ต่อเนื่อง: interval 1 → 6 → 15 → 39 (ครั้งที่ 4 ถึง known)
  const day = (n) => T(1 + n, 9);
  const reviews = [0, 1, 2, 3].map((n) => rev(`r${n}`, "c1", 2, day(n))).concat([rev("lapse", "c1", 0, day(4))]);
  const m = computeAll({ reviews, cards: [card("c1", day(0))] });
  assert.equal(m.get("2026-10-04").knownGained, 1);
  assert.equal(m.get("2026-10-05").knownLost, 1);
  assert.equal([...m.values()].reduce((a, d) => a + d.knownGained - d.knownLost, 0), 0);
  const del = computeAll({ reviews, cards: [card("c1", day(0), { deleted: true })] });
  assert.ok([...del.values()].every((d) => d.knownGained === 0 && d.knownLost === 0 && d.newCards === 0));
  assert.equal(del.get("2026-10-04").reviews, 1);          // event ยังนับ (เป็นข้อมูลจริง)
});

test("ข้อผิด: ใหม่/เกิดซ้ำ/แก้ได้ และแยกหมวด", () => {
  const errors = [{ id: "e1", category: "Tense", createdAt: T(4, 9), deleted: false }, { id: "e2", category: "Article", createdAt: T(4, 10), deleted: false }, { id: "e3", category: "Tense", createdAt: T(4, 11), deleted: true }];
  const errorEvents = [
    { id: "x1", errorId: "e1", type: "occurred", at: T(4, 9) }, { id: "x2", errorId: "e1", type: "occurred", at: T(4, 15) },
    { id: "x3", errorId: "e2", type: "occurred", at: T(4, 10) }, { id: "x4", errorId: "e1", type: "resolved", at: T(5, 8) },
  ];
  const m = computeAll({ errors, errorEvents });
  const d = m.get("2026-10-04");
  assert.equal(d.errorsNew, 2);
  assert.equal(d.errorOccur, 3);
  assert.deepEqual(d.errorCat, [{ c: "Article", n: 1 }, { c: "Tense", n: 2 }]);
  assert.equal(m.get("2026-10-05").errorResolved, 1);
});

test("ลายมือ/Shadowing/Practice/Reading/Journal", () => {
  const m = computeAll({
    handwritingAttempts: [{ id: "a", at: T(6, 9), style: "print", score: 80 }, { id: "b", at: T(6, 9, 1), style: "print", score: 60 }, { id: "c", at: T(6, 9, 2), style: "cursive", score: 50 }, { id: "d", at: T(6, 9, 3), style: "print", selfRating: 2 }],
    shadowingEvents: [{ id: "s1", kind: "round", at: T(6, 10) }, { id: "s2", kind: "other", at: T(6, 10) }],
    practiceEvents: [{ id: "p1", at: T(6, 11), correct: true }, { id: "p2", at: T(6, 11), correct: false }],
    readings: [{ id: "r1", at: T(6, 12) }],
    journal: [{ id: "j1", date: "2026-10-06", wordCount: 40 }, { id: "j2", date: "2026-10-06", wordCount: 10, deleted: true }],
  });
  const d = m.get("2026-10-06");
  assert.deepEqual(d.hw, { print: { n: 2, sum: 140 }, cursive: { n: 1, sum: 50 } });
  assert.equal(d.shadowRounds, 1);
  assert.equal(d.practice, 2);
  assert.equal(d.practiceCorrect, 1);
  assert.equal(d.readings, 1);
  assert.equal(d.journalEntries, 1);
  assert.equal(d.journalWords, 40);
});

test("activity ตรงกับ streak.activityCounts (sessions ตามเวลาเริ่ม + reviews)", () => {
  const sessions = [sess("a", T(1, 8), 60), sess("b", T(1, 23, 59), 600), sess("c", T(3, 9), 60)];
  const reviews = [rev("1", "c", 2, T(2, 9)), rev("2", "c", 2, T(2, 10))];
  const m = computeAll({ sessions, reviews, cards: [card("c", T(1, 1))] });
  const counts = activityCounts(sessions, reviews);
  for (const [k, n] of counts) assert.equal(m.get(k).activity, n, k);
  for (const [k, d] of m) assert.equal(d.activity, counts.get(k) || 0, k);
});

test("diffStats / sameStats: ต่างเมื่อค่าเปลี่ยนหรือเวอร์ชันเปลี่ยน และไม่สน createdAt/updatedAt/ลำดับ key", () => {
  const A = computeAll({ reviews: [rev("1", "c", 2, T(8, 9))], cards: [card("c", T(8, 8))] });
  const stored = [...A.values()].map((d) => ({ ...JSON.parse(JSON.stringify(d)), createdAt: 5, updatedAt: 6, deleted: false }));
  assert.equal(diffStats(A, stored).length, 0);
  assert.equal(diffStats(A, stored.map((d) => ({ sec: d.sec, ...d }))).length, 0);
  assert.equal(diffStats(A, stored.map((d) => ({ ...d, reviews: d.reviews + 1 }))).length, 1);
  assert.equal(diffStats(A, stored.map((d) => ({ ...d, v: STATS_VERSION - 1 }))).length, 1);
  assert.equal(diffStats(A, []).length, A.size);
  assert.equal(diffStats(A, stored.map((d) => ({ ...d, deleted: true }))).length, A.size);
  assert.ok(!sameStats({ a: 1 }, { a: 2 }));
});

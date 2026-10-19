import test from "node:test";
import assert from "node:assert/strict";
import { techniqueScores, leastUsed, miniChallenge, countFor } from "../js/techscore.js";
import { computeAll } from "../js/stats.js";
import { TECHNIQUES } from "../js/data/techniques.js";
import { TECHNIQUE_CONFIG } from "../js/data/technique-config.js";

const NOW = new Date(2026, 9, 19, 12).getTime();
const at = (daysAgo, h = 10) => new Date(2026, 9, 19 - daysAgo, h).getTime();
const cards = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, createdAt: at(i % 6), deleted: false }));

test("config ครบทุกเทคนิค มี target > 0 และมีมินิชาเลนจ์", () => {
  for (const t of TECHNIQUES) {
    const c = TECHNIQUE_CONFIG[t.id];
    assert.ok(c && c.target > 0 && c.challenge.goal > 0 && c.challenge.text && c.unit && c.source, t.id);
  }
});

test("นับต่อเทคนิคใน 7 วันล่าสุดจาก events (ผ่าน dailyStats)", () => {
  const reviews = [
    ...Array.from({ length: 30 }, (_, i) => ({ id: `r${i}`, cardId: "c", rating: 2, at: at(i % 7, 9), createdAt: i, answer: i < 12 ? "typed" : "" })),
    { id: "old", cardId: "c", rating: 2, at: at(8, 9), createdAt: 99, answer: "typed" },          // นอกช่วง 7 วัน
  ];
  const map = computeAll({
    reviews, cards: [{ id: "c", createdAt: at(1), deleted: false }, { id: "c2", createdAt: at(30), deleted: false }],
    readings: [{ id: "x", at: at(2) }], shadowingEvents: [1, 2, 3].map((i) => ({ id: `s${i}`, kind: "round", at: at(3) })),
    practiceEvents: [{ id: "p", at: at(0), correct: true }], sessions: [{ id: "s", start: at(4), durationSec: 60, skill: "input" }],
  });
  const s = Object.fromEntries(techniqueScores({ map, now: NOW }).map((x) => [x.id, x]));
  assert.equal(s["01"].count, 30);                             // รีวิวเก่านอกช่วงไม่นับ
  assert.equal(s["02"].count, 12);
  assert.equal(s["03"].count, 1);
  assert.equal(s["04"].count, 1);
  assert.equal(s["05"].count, 3);
  assert.equal(s["06"].count, 1);
  assert.equal(s["07"].count, 0);
  assert.equal(s["08"].count, 7);                              // มีรีวิวทุกวันในช่วง 7 วัน
  assert.equal(s["01"].score, 60);                             // 30/50
  assert.equal(s["08"].score, 100);                            // เกินเป้า → เพดาน 100
  assert.equal(s["07"].available, true);
  assert.equal(s["01"].href, "#/cards");
});

test("leastUsed: คะแนนต่ำสุดเฉพาะเทคนิคที่ใช้งานได้; เสมอกันดูจำนวนแล้วลำดับเลข; ว่างได้ null", () => {
  const sc = [
    { id: "01", score: 50, count: 25, available: true }, { id: "02", score: 10, count: 2, available: true },
    { id: "03", score: 10, count: 1, available: true }, { id: "07", score: 0, count: 0, available: false },
  ];
  assert.equal(leastUsed(sc).id, "03");
  assert.equal(leastUsed([{ id: "05", score: 20, count: 1, available: true }, { id: "04", score: 20, count: 1, available: true }]).id, "04");
  assert.equal(leastUsed(sc.map((s) => ({ ...s, available: false }))), null);
  assert.equal(leastUsed([]), null);
});

test("ไม่มีข้อมูลเลย: ทุกคะแนน 0 และเลือกเทคนิคแรกที่ใช้ได้ (01)", () => {
  const sc = techniqueScores({ map: new Map(), now: NOW });
  assert.ok(sc.every((s) => s.score === 0));
  assert.equal(leastUsed(sc).id, "01");
});

test("miniChallenge: เลือกจากเทคนิคที่ใช้น้อยที่สุด และบอกว่าวันนี้ทำครบหรือยัง", () => {
  const base = {
    reviews: Array.from({ length: 60 }, (_, i) => ({ id: `r${i}`, cardId: "c", rating: 2, at: at(i % 7, 9), createdAt: i, answer: "x" })),
    cards: cards(6), readings: [1, 2].map((i) => ({ id: `rd${i}`, at: at(i) })),
    practiceEvents: Array.from({ length: 10 }, (_, i) => ({ id: `p${i}`, at: at(i % 7), correct: true })),
    interleavingSessions: [1, 2].map((i) => ({ id: `il${i}`, start: at(i) })),
  };
  const ch = miniChallenge({ map: computeAll({ ...base, shadowingEvents: [{ id: "s1", kind: "round", at: at(2) }] }), now: NOW });
  assert.equal(ch.id, "05");                                   // ใช้ทุกอย่างเกือบเต็ม ยกเว้น Shadowing
  assert.equal(ch.goal, 3);
  assert.equal(ch.done, false);
  assert.equal(ch.href, "#/shadowing");
  const rounds = [0, 0, 0, 1, 1].map((d, i) => ({ id: `s${i}`, kind: "round", at: at(d, 8 + i) }));
  const more = computeAll({ ...base, shadowingEvents: rounds });
  assert.notEqual(miniChallenge({ map: more, now: NOW }).id, "05");        // Shadowing ครบเป้าแล้ว เทคนิคอื่นกลายเป็นน้อยที่สุด
  assert.equal(countFor("05", more.get("2026-10-19")), 3);
});

test("เทคนิค 06 ส่ง errorsTab ไปด้วย (ปุ่มลัดพาไปแท็บฝึก)", () => {
  const sc = techniqueScores({ map: new Map(), now: NOW });
  assert.equal(sc.find((s) => s.id === "06").errorsTab, "practice");
});

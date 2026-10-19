import test from "node:test";
import assert from "node:assert/strict";
import * as il from "../js/interleave.js";
import { initialState, applyReview, normalize } from "../js/srs.js";

const NOW = new Date(2026, 9, 19, 12).getTime();
const card = (en, tags = [], extra = {}) => ({ id: `c-${en}`, en, th: `แปล-${en}`, example: `I really like the ${en} very much`, tags, deleted: false, ...extra });
const err = (id, category, wrong, right) => ({ id, category, wrong, right, note: "", deleted: false });
const item = (topic, kind, ref) => ({ key: `${topic}-${kind}-${ref}`, src: "card", kind, topic, ref, priority: 1 });

test("topicOfCard: แท็กชั้นบนสุดของแท็กแรก / ไม่มีแท็ก", () => {
  assert.equal(il.topicOfCard(card("x", ["Science/Biology"])), "tag:science");
  assert.equal(il.topicOfCard(card("x", [])), "tag:-");
});

test("misspell: ต่างจากคำเดิมเสมอ ไม่แตะตัวแรก/ท้าย และไม่ซ้ำกับที่ห้าม", () => {
  const rng = il.rngFrom(3);
  for (const w of ["receive", "beautiful", "definitely", "separate"]) {
    const used = new Set();
    for (let i = 0; i < 20; i++) {
      const m = il.misspell(w, rng, used);
      assert.ok(m && normalize(m) !== normalize(w), `${w} → ${m}`);
      assert.equal(m[0], w[0]);
      assert.equal(m.at(-1), w.at(-1));
    }
  }
  assert.equal(il.misspell("ab", il.rngFrom(1)), null);
});

test("spellingItem: 3 ตัวเลือกไม่ซ้ำ มีคำตอบที่ถูกหนึ่งเดียว; คำสั้น/มีตัวเลขไม่สร้าง", () => {
  const s = il.spellingItem("necessary", il.rngFrom(5));
  assert.equal(s.options.length, 3);
  assert.equal(new Set(s.options.map(normalize)).size, 3);
  assert.equal(s.options.filter((o) => o === s.answer).length, 1);
  assert.equal(il.spellingItem("cat", il.rngFrom(1)), null);
  assert.equal(il.spellingItem("abc123456", il.rngFrom(1)), null);
  const phrase = il.spellingItem("look after carefully", il.rngFrom(2));
  assert.ok(phrase.options.every((o) => o.split(" ").length === 3));
});

test("buildPool: บัตร → ความหมาย+สะกด · ข้อผิด → choose/recall/(cloze) · ข้อสอบ → exam; ข้อผิดที่แก้แล้ว/บัตรที่ลบไม่เข้า", () => {
  const cards = [card("beautiful", ["art/painting"]), card("run", ["verbs"]), card("gone", [], { deleted: true })];
  const errors = [err("e1", "Tense", "I go yesterday", "I went yesterday"), err("e2", "Article", "a apple", "an apple")];
  const errorEvents = [{ id: "r", errorId: "e2", type: "resolved", at: 1 }];
  const questions = [{ id: "q1", question: "Pick one", options: ["a", "b", "c"], answer: "b", section: "grammar" }, { id: "bad", question: "x", options: ["a"], answer: "a" }];
  const pool = il.buildPool({ cards, states: new Map(), errors, errorEvents, questions, now: NOW, rng: il.rngFrom(1) });
  const keys = pool.map((p) => `${p.src}:${p.kind}`);
  assert.ok(keys.includes("card:meaning") && keys.includes("card:spelling") && keys.includes("error:choose") && keys.includes("error:recall") && keys.includes("exam:exam"));
  assert.equal(pool.filter((p) => p.src === "card" && p.kind === "meaning").length, 2);
  assert.ok(!pool.some((p) => p.ref === "e2"));
  assert.ok(!pool.some((p) => p.ref === "c-gone"));
  assert.equal(pool.filter((p) => p.src === "exam").length, 1);
  assert.equal(pool.find((p) => p.src === "error").topic, "cat:Tense");
  const only = il.buildPool({ cards, errors, include: { card: true, error: false, exam: false }, rng: il.rngFrom(1) });
  assert.ok(only.every((p) => p.src === "card"));
});

test("buildPool: บัตรที่ถึงรอบมี priority สูงกว่าที่ยังไม่ถึงรอบ/บัตรใหม่", () => {
  const due = card("alpha1"), later = card("beta11"), fresh = card("gamma1");
  const dueState = applyReview(initialState(), 2, NOW - 5 * 86400000);
  const laterState = { ...applyReview(initialState(), 2, NOW), due: NOW + 9 * 86400000 };
  const pool = il.buildPool({ cards: [due, later, fresh], states: new Map([[due.id, dueState], [later.id, laterState], [fresh.id, initialState()]]), now: NOW, rng: il.rngFrom(1) });
  const p = (id) => pool.find((x) => x.ref === id && x.kind === "meaning").priority;
  assert.ok(p(due.id) > p(later.id) && p(later.id) > p(fresh.id));
});

test("sequence: ไม่มีหัวข้อเดียวกันติดกันเกิน 2 ข้อ (ทดสอบหลายสุ่ม/หลายสัดส่วน)", () => {
  for (let seed = 1; seed <= 60; seed++) {
    const rng = il.rngFrom(seed);
    const topics = ["tag:a", "tag:b", "cat:Tense", "exam:grammar"];
    const pool = Array.from({ length: 60 }, (_, i) => item(topics[i % 4 === 3 && i % 8 !== 3 ? 0 : i % 4], ["meaning", "spelling", "choose", "cloze"][i % 4], `r${i}`));
    for (const n of [10, 12, 15, 20]) {
      const s = il.sequence(pool, n, rng);
      assert.equal(s.items.length, n, `seed ${seed} n ${n}`);
      assert.equal(il.checkRules(s.items).ok, true, `seed ${seed} n ${n}`);
      assert.equal(new Set(s.items.map((x) => x.key)).size, n);
    }
  }
});

test("sequence: ชนิดโจทย์สลับกัน (ไม่ซ้ำติดกันเมื่อมีตัวเลือก) และไม่ซ้ำบัตรเดิมใกล้กัน", () => {
  const rng = il.rngFrom(9);
  const pool = [];
  for (let i = 0; i < 12; i++) for (const k of ["meaning", "spelling", "cloze"]) pool.push(item(`tag:t${i % 3}`, k, `r${i}`));
  const s = il.sequence(pool, 15, rng);
  assert.equal(il.checkRules(s.items).sameKindAdjacent, 0);
  for (let i = 0; i < s.items.length; i++) for (let j = i + 1; j <= Math.min(i + 3, s.items.length - 1); j++) assert.notEqual(s.items[i].ref, s.items[j].ref);
});

test("sequence: หัวข้อไม่หลากหลาย → ได้ไม่ครบแต่ไม่ผิดกฎ และบอก short", () => {
  const onlyA = Array.from({ length: 20 }, (_, i) => item("tag:a", "meaning", `r${i}`));
  const s1 = il.sequence(onlyA, 12, il.rngFrom(1));
  assert.equal(s1.items.length, 2);
  assert.equal(s1.short, true);
  const skewed = [...Array.from({ length: 20 }, (_, i) => item("tag:a", "meaning", `a${i}`)), item("tag:b", "cloze", "b1"), item("tag:b", "cloze", "b2")];
  const s2 = il.sequence(skewed, 12, il.rngFrom(2));
  assert.equal(il.checkRules(s2.items).ok, true);
  assert.equal(s2.items.length, 8);                       // A A B A A B A A
  assert.equal(s2.short, true);
  assert.deepEqual(il.sequence([], 10).items, []);
  assert.equal(il.sequence(onlyA, 99, il.rngFrom(1)).requested, il.SIZE.max);
});

test("sequence: ผลเท่ากันเมื่อ seed เท่ากัน; ข้อที่ priority สูง (ถึงรอบ) มีโอกาสถูกเลือกก่อน", () => {
  const pool = [...Array.from({ length: 10 }, (_, i) => ({ ...item(`tag:t${i % 4}`, "meaning", `lo${i}`), priority: 0.5 })), ...Array.from({ length: 10 }, (_, i) => ({ ...item(`tag:t${i % 4}`, "spelling", `hi${i}`), priority: 3 }))];
  const a = il.sequence(pool, 10, il.rngFrom(4)).items.map((x) => x.key), b = il.sequence(pool, 10, il.rngFrom(4)).items.map((x) => x.key);
  assert.deepEqual(a, b);
  assert.ok(a.filter((k) => k.includes("-spelling-")).length >= 6);
});

test("judge: พิมพ์ความหมาย (correct/near/wrong) · ตัวเลือก · เติมคำแบบตรงเป๊ะ", () => {
  const meaning = { kind: "meaning", answer: "apple" };
  assert.deepEqual(il.judge(meaning, "Apple!"), { result: "correct", correct: true });
  assert.deepEqual(il.judge(meaning, "appel"), { result: "near", correct: false });
  assert.deepEqual(il.judge(meaning, "banana"), { result: "wrong", correct: false });
  assert.deepEqual(il.judge({ kind: "choose", options: ["x", "y"], answer: "y" }, "y"), { result: "correct", correct: true });
  assert.equal(il.judge({ kind: "spelling", options: ["necesary", "necessary"], answer: "necessary" }, "necesary").correct, false);
  assert.equal(il.judge({ kind: "cloze", answer: "went" }, " Went ").correct, true);
  assert.equal(il.judge({ kind: "recall", answer: "an apple" }, "an appel").correct, false);
});

test("eventFor: บัตร → reviews (rating ตามผล) · ข้อผิด → practiceEvents · ข้อสอบ → ไม่มี", () => {
  const e1 = il.eventFor({ src: "card", kind: "meaning", ref: "c1" }, { result: "near", correct: false }, "appel", 5);
  assert.deepEqual(e1, { col: "reviews", data: { cardId: "c1", rating: 1, mode: "interleave", answer: "appel", result: "near", at: 5 } });
  assert.equal(il.eventFor({ src: "card", kind: "spelling", ref: "c1" }, { result: "correct", correct: true }, "x", 5).data.answer, "");
  assert.equal(il.eventFor({ src: "card", kind: "spelling", ref: "c1" }, { result: "wrong", correct: false }, "x", 5).data.rating, 0);
  assert.deepEqual(il.eventFor({ src: "error", kind: "cloze", ref: "e1", cardId: "c9" }, { result: "correct", correct: true }, "x", 7), { col: "practiceEvents", data: { errorId: "e1", drill: "cloze", correct: true, at: 7, cardId: "c9" } });
  assert.deepEqual(il.eventFor({ src: "error", kind: "choose", ref: "e1" }, { result: "wrong", correct: false }, "x", 7).data, { errorId: "e1", drill: "choose", correct: false, at: 7 });
  assert.equal(il.eventFor({ src: "exam", kind: "exam", ref: "q" }, { result: "correct", correct: true }, "x", 1), null);
});

test("sessionDoc / summarize / isValidSession", () => {
  const results = [
    { item: { src: "card", kind: "meaning", topic: "tag:a", ref: "c1" }, correct: true },
    { item: { src: "error", kind: "choose", topic: "cat:Tense", ref: "e1" }, correct: false },
    { item: { src: "card", kind: "spelling", topic: "tag:a", ref: "c2" }, correct: true },
  ];
  const d = il.sessionDoc({ start: 1000, end: 61000, results });
  assert.equal(d.durationSec, 60); assert.equal(d.total, 3); assert.equal(d.correct, 2);
  assert.ok(il.isValidSession(d));
  assert.ok(!il.isValidSession({ ...d, total: 4 }));
  assert.ok(!il.isValidSession({ ...d, items: [{ ...d.items[0], src: "zzz" }, d.items[1], d.items[2]] }));
  const s = il.summarize(results);
  assert.equal(s.total, 3); assert.equal(s.correct, 2);
  assert.deepEqual(s.byTopic.find((t) => t.key === "tag:a"), { key: "tag:a", total: 2, correct: 2 });
  assert.equal(s.mistakes.length, 1);
  assert.equal(il.topicLabel("tag:-"), "บัตรไม่มีแท็ก");
  assert.equal(il.topicLabel("cat:Tense"), "ข้อผิด Tense");
});

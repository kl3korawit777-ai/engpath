// รัน: node --test tests/practice.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as pr from "../js/practice.js";

const DAY = 86400000;
const NOW = new Date(2026, 5, 17, 12).getTime();           // พุธ 17 มิ.ย. 2026 เวลาท้องถิ่น
const err = (id, o = {}) => ({ id, wrong: "I go yesterday", right: "I went yesterday", category: "Tense", ...o });
const occ = (errorId, daysAgo, i = 0) => ({ id: `${errorId}-${daysAgo}-${i}`, errorId, type: "occurred", at: NOW - daysAgo * DAY });
const st = (errorId, type, at) => ({ id: `${errorId}-${type}-${at}`, errorId, type, at });

test("weekKey: จันทร์ของสัปดาห์ (ท้องถิ่น) — อาทิตย์ยังนับเป็นสัปดาห์ก่อนหน้า", () => {
  assert.equal(pr.weekKey(new Date(2026, 5, 17, 12).getTime()), "2026-06-15");   // พุธ
  assert.equal(pr.weekKey(new Date(2026, 5, 15, 0, 5).getTime()), "2026-06-15");  // จันทร์เพิ่งเริ่ม
  assert.equal(pr.weekKey(new Date(2026, 5, 21, 23, 59).getTime()), "2026-06-15"); // อาทิตย์
  assert.equal(pr.weekKey(new Date(2026, 5, 22, 0, 1).getTime()), "2026-06-22");   // จันทร์ถัดไป
});

test("autoFocus: ที่ยังไม่แก้ + occurred มากสุดใน 30 วัน, ได้ 2 อันดับ", () => {
  const errors = [err("a"), err("b"), err("c"), err("d")];
  const events = [
    ...[1, 2, 3, 4].map((d) => occ("a", d)),          // 4
    ...[1, 2].map((d) => occ("b", d)),                // 2
    ...[1, 2, 3].map((d) => occ("c", d)),             // 3
    occ("d", 40), occ("d", 45), occ("d", 50), occ("d", 55), occ("d", 59),   // นอก 30 วัน
  ];
  assert.deepEqual(pr.autoFocus(errors, events, NOW).map((x) => [x.error.id, x.count]), [["a", 4], ["c", 3]]);
  assert.deepEqual(pr.autoFocus(errors, [], NOW), []);
});

test("autoFocus: ข้ามที่แก้ได้แล้ว, เท่ากันใช้ยอดรวมทั้งหมดตัดสิน", () => {
  const errors = [err("a"), err("b"), err("c")];
  const events = [
    ...[1, 2, 3].map((d) => occ("a", d)), st("a", "resolved", NOW - 1000),      // a แก้แล้ว
    ...[1, 2].map((d) => occ("b", d)),
    ...[1, 2].map((d) => occ("c", d)), occ("c", 40), occ("c", 41),              // c มียอดรวมมากกว่า b
  ];
  assert.deepEqual(pr.autoFocus(errors, events, NOW).map((x) => x.error.id), ["c", "b"]);
});

test("focusErrors: ผู้ใช้เลือกเองมีผลเฉพาะสัปดาห์นี้และเฉพาะที่ยังใช้ได้", () => {
  const errors = [err("a"), err("b"), err("c")];
  const events = [...[1, 2, 3].map((d) => occ("a", d)), ...[1, 2].map((d) => occ("b", d)), occ("c", 5)];
  const wk = pr.weekKey(NOW);
  let f = pr.focusErrors({ errors, events, focus: { weekKey: wk, errorIds: ["c", "b"] }, now: NOW });
  assert.equal(f.source, "user");
  assert.deepEqual(f.items.map((x) => [x.error.id, x.count]), [["c", 1], ["b", 2]]);
  f = pr.focusErrors({ errors, events, focus: { weekKey: "2026-06-08", errorIds: ["c"] }, now: NOW });   // ของสัปดาห์ก่อน
  assert.equal(f.source, "auto");
  assert.deepEqual(f.items.map((x) => x.error.id), ["a", "b"]);
  f = pr.focusErrors({ errors, events: [...events, st("c", "resolved", NOW - 5)], focus: { weekKey: wk, errorIds: ["c"] }, now: NOW });
  assert.equal(f.source, "auto");                                                   // ที่เลือกไว้แก้แล้ว → กลับไปอัตโนมัติ
  f = pr.focusErrors({ errors: errors.slice(0, 2), events, focus: { weekKey: wk, errorIds: ["c", "a", "b"] }, now: NOW });
  assert.deepEqual(f.items.map((x) => x.error.id), ["a", "b"]);                     // c ถูกลบ ข้ามไป
  assert.equal(pr.focusErrors({ errors, events, focus: null, now: NOW }).source, "auto");
});

test("relatedCards + clozeFromCard: เว้นช่องวลีของบัตรในประโยคตัวอย่าง", () => {
  const e = err("x", { wrong: "depend of", right: "depend on" });
  const cards = [
    { id: "1", en: "depend on", example: "It all depends on you.", th: "" },
    { id: "2", en: "depend", example: "Prices depend on demand.", th: "" },
    { id: "3", en: "apple", example: "I ate an apple today.", th: "" },
    { id: "4", en: "rely on", example: "You can depend on  me always.", th: "" },       // ตัวอย่างมีแบบที่ถูกอยู่
  ];
  assert.deepEqual(pr.relatedCards(e, cards).map((c) => c.id), ["1", "4", "2"]);        // เรียงตามความยาวของ en (depend on > rely on > depend), apple ไม่เกี่ยว
  assert.equal(pr.clozeFromCard(cards[0]), null);                                       // "depends on" ไม่ใช่ "depend on" ทั้งคำ
  assert.deepEqual(pr.clozeFromCard({ en: "Depend", example: "Prices depend on demand." }), { sentence: "Prices _____ on demand.", answer: "depend" });
  assert.deepEqual(pr.clozeFromCard({ en: "look after", example: "She will Look After the dog." }), { sentence: "She will _____ the dog.", answer: "Look After" });
  assert.equal(pr.clozeFromCard({ en: "art", example: "This is smart." }), null);       // ต้องเจอทั้งคำ
  assert.equal(pr.clozeFromCard({ en: "", example: "x" }), null);
  assert.deepEqual(pr.relatedCards(err("y", { right: "" }), cards), []);
});

test("checkExact: ไม่มี 'เกือบถูก' แต่ไม่สนตัวพิมพ์/เครื่องหมาย", () => {
  assert.equal(pr.checkExact(" I Went yesterday. ", "I went yesterday"), true);
  assert.equal(pr.checkExact("depend of", "depend on"), false);          // ผิดตัวอักษรเดียว = ผิด
  assert.equal(pr.checkExact("", ""), false);
});

test("buildDrills: choose + recall เสมอ, cloze เมื่อมีบัตรที่เกี่ยวข้อง (ไม่เกิน 2), ตำแหน่งตัวเลือกสลับตาม rng", () => {
  const e = err("x", { wrong: "depend of", right: "depend on" });
  const cards = [
    { id: "1", en: "depend", example: "Prices depend on demand." },
    { id: "2", en: "depend on", example: "Success will depend on effort." },
    { id: "3", en: "depend on", example: "No match here." },
  ];
  const d = pr.buildDrills(e, cards, () => 0.1);
  assert.deepEqual(d.map((x) => x.type), ["choose", "recall", "cloze", "cloze"]);
  assert.deepEqual(d[0].options, ["depend on", "depend of"]);
  assert.equal(d[0].answer, "depend on");
  assert.deepEqual(pr.buildDrills(e, cards, () => 0.9)[0].options, ["depend of", "depend on"]);
  assert.equal(d[1].prompt, "depend of");
  assert.deepEqual(d.slice(2).map((x) => x.cardId).sort(), ["1", "2"]);
  assert.deepEqual(pr.buildDrills(e, [], () => 0).map((x) => x.type), ["choose", "recall"]);
});

const pe = (errorId, daysAgo, correct, hour = 10) => ({ id: `${errorId}-${daysAgo}-${hour}-${correct}`, errorId, at: new Date(2026, 5, 17 - daysAgo, hour).getTime(), correct, drill: "recall" });

test("resolveSuggestion: ถูกครบ 3 วันต่างกันล่าสุด → เสนอ", () => {
  const evs = [pe("a", 4, true), pe("a", 2, true), pe("a", 2, true, 15), pe("a", 0, true)];
  const r = pr.resolveSuggestion({ errorId: "a", practiceEvents: evs, errorEvents: [] });
  assert.equal(r.suggest, true);
  assert.deepEqual(r.days.map((d) => d.key), ["2026-06-13", "2026-06-15", "2026-06-17"]);
});

test("resolveSuggestion: วันที่มีข้อผิด/ไม่ครบ 3 วัน/ผิดล่าสุด → ไม่เสนอ", () => {
  const base = { errorId: "a", errorEvents: [] };
  assert.equal(pr.resolveSuggestion({ ...base, practiceEvents: [pe("a", 2, true), pe("a", 0, true)] }).suggest, false);          // แค่ 2 วัน
  assert.equal(pr.resolveSuggestion({ ...base, practiceEvents: [pe("a", 4, true), pe("a", 2, true), pe("a", 2, false, 15), pe("a", 0, true)] }).suggest, false);   // วันที่ 2 มีข้อผิด
  assert.equal(pr.resolveSuggestion({ ...base, practiceEvents: [pe("a", 6, true), pe("a", 4, true), pe("a", 2, true), pe("a", 0, false)] }).suggest, false);        // 3 วันล่าสุดไม่ครบ
  assert.equal(pr.resolveSuggestion({ ...base, practiceEvents: [pe("a", 6, false), pe("a", 4, true), pe("a", 2, true), pe("a", 0, true)] }).suggest, true);        // ผิดเมื่อนานแล้วไม่เป็นไร
  assert.equal(pr.resolveSuggestion({ ...base, practiceEvents: [pe("b", 4, true), pe("b", 2, true), pe("b", 0, true)] }).suggest, false);                        // ข้ออื่น
});

test("resolveSuggestion: แก้แล้วไม่เสนอ; เปิดใหม่นับเฉพาะการฝึกหลังเปิดใหม่", () => {
  const evs = [pe("a", 4, true), pe("a", 2, true), pe("a", 0, true)];
  const resolved = [{ errorId: "a", type: "resolved", at: NOW - 100 }];
  assert.deepEqual(pr.resolveSuggestion({ errorId: "a", practiceEvents: evs, errorEvents: resolved }), { suggest: false, days: [], reason: "resolved" });
  const reopened = [{ errorId: "a", type: "resolved", at: NOW - 10 * DAY }, { errorId: "a", type: "reopened", at: new Date(2026, 5, 15, 20).getTime() }];
  const r = pr.resolveSuggestion({ errorId: "a", practiceEvents: evs, errorEvents: reopened });
  assert.equal(r.suggest, false);                                    // หลังเปิดใหม่มีแค่วันที่ 17
  assert.deepEqual(r.days.map((d) => d.key), ["2026-06-17"]);
});

test("parseAiDrills: เก็บเฉพาะโจทย์ที่มี ___ ช่องเดียวและคำตอบสั้น; อ่านจาก text ที่มีคำนำ", () => {
  const text = 'Here you go:\n{"items":[{"sentence":"I ___ to school yesterday.","answer":"went","hint":"อดีต"},{"sentence":"no blank","answer":"x"},{"sentence":"two ___ blanks ___","answer":"x"},{"sentence":"She ___ home.","answer":""},{"sentence":"We ___ there last year.","answer":"went","hint":"ปีที่แล้ว"}]}';
  const items = pr.parseAiDrills(text);
  assert.equal(items.length, 2);
  assert.deepEqual(items[0], { type: "cloze", ai: true, sentence: "I _____ to school yesterday.", answer: "went", hint: "อดีต" });
  assert.throws(() => pr.parseAiDrills("no json"), (e) => e.kind === "parse");
  assert.throws(() => pr.parseAiDrills('{"items":[]}'), (e) => e.kind === "empty");
});

test("fetchAiDrills: ใช้ Claude API ผ่าน header ที่จำเป็นและคืนโจทย์ที่ผ่านการตรวจ", async () => {
  let req;
  const f = async (url, init) => { req = { url, init }; return { ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: '{"items":[{"sentence":"He ___ late.","answer":"came","hint":"อดีต"}]}' }] }) }; };
  const items = await pr.fetchAiDrills(err("a"), { apiKey: "k", model: "m", fetchImpl: f });
  assert.equal(req.init.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.match(JSON.parse(req.init.body).messages[0].content, /Wrong: "I go yesterday"/);
  assert.equal(items[0].answer, "came");
  await assert.rejects(pr.fetchAiDrills(err("a"), { apiKey: "", fetchImpl: f }), (e) => e.kind === "auth");
});

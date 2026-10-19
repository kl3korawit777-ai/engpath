// รัน: node --test tests/backup.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as bk from "../js/backup.js";

const base = (id, extra) => ({ id, createdAt: 1, updatedAt: 1, deleted: false, ...extra });
const card = (id, up = 1) => ({ ...base(id, { en: "a", th: "ก", example: "one two three four" }), updatedAt: up });
const review = (id) => base(id, { cardId: "c1", rating: 2, at: 5 });
const sample = () => bk.buildExport({
  cards: [card("c1"), card("c2")],
  reviews: [review("r1")],
  errors: [base("e1", { wrong: "x", right: "y", category: "Tense" })],
}, 123);

test("buildExport: ครบทุก collection แม้ว่าง", () => {
  const x = sample();
  assert.equal(x.app, "engpath");
  assert.deepEqual(Object.keys(x.collections), bk.COLLECTIONS);
  assert.deepEqual(x.collections.sessions, []);
});

test("planImport: ข้อมูลใหม่ทั้งหมดถูกเขียน", () => {
  const p = bk.planImport(JSON.parse(JSON.stringify(sample())), {});
  assert.equal(p.writes.length, 4);
  assert.deepEqual(p.skipped, { existing: 0, invalid: 0 });
});

test("planImport: events ที่มีอยู่แล้วไม่เขียนซ้ำ, ข้อมูลที่เครื่องใหม่กว่าไม่ถูกทับ, ไฟล์ใหม่กว่าทับได้", () => {
  const existing = { reviews: new Map([["r1", review("r1")]]), cards: new Map([["c1", card("c1", 9)], ["c2", card("c2", 0)]]) };
  const p = bk.planImport(sample(), existing);
  assert.deepEqual(p.writes.map((w) => `${w.col}:${w.doc.id}`).sort(), ["cards:c2", "errors:e1"]);
  assert.equal(p.skipped.existing, 2);
});

test("planImport: ข้ามเอกสารที่ไม่ถูกต้อง (ไม่ทำให้ทั้งไฟล์ล้ม)", () => {
  const x = sample();
  x.collections.reviews.push({ id: "bad", cardId: "c1", rating: 9, at: 1, createdAt: 1, updatedAt: 1, deleted: false });
  x.collections.cards.push({ ...card("z"), id: "a/b" });
  x.collections.cards.push(card("c1"));                         // id ซ้ำในไฟล์
  const p = bk.planImport(x, {});
  assert.equal(p.skipped.invalid, 3);
  assert.equal(p.writes.length, 4);
});

test("planImport: ปฏิเสธไฟล์ที่ไม่ใช่ของ EngPath", () => {
  assert.throws(() => bk.planImport({ hello: 1 }, {}), /ไม่ใช่ข้อมูลสำรอง/);
  assert.throws(() => bk.planImport(null, {}), /ไม่ใช่ข้อมูลสำรอง/);
  assert.throws(() => bk.planImport({ ...sample(), version: 99 }, {}), /ไม่รองรับ/);
  assert.throws(() => bk.planImport({ ...sample(), collections: { cards: "x" } }, {}), /ผิดรูปแบบ/);
});

test("settings ต้องเป็น id=main และ stage 0–5", () => {
  assert.ok(bk.isValidDoc("settings", base("main", { stage: 3 })));
  assert.ok(!bk.isValidDoc("settings", base("other", { stage: 3 })));
  assert.ok(!bk.isValidDoc("settings", base("main", { stage: 7 })));
});

test("planImport: links และ wordFamilies ถูกตรวจรูปแบบ; ที่ผิดไม่ถูกนำเข้า", async () => {
  const { buildLinkDoc } = await import("../js/links.js");
  const good = base("go", buildLinkDoc("go", "see [[stop]]"));
  const badLink = base("x", { from: "y", notes: "", to: [] });                 // id ไม่ตรง from
  const fam = base("f1", { members: ["decide", "decision"], confirmed: true });
  const badFam = base("f2", { members: ["only"], confirmed: true });
  const x = bk.buildExport({ links: [good, badLink], wordFamilies: [fam, badFam] }, 1);
  const p = bk.planImport(JSON.parse(JSON.stringify(x)), {});
  assert.deepEqual(p.writes.map((w) => `${w.col}:${w.doc.id}`).sort(), ["links:go", "wordFamilies:f1"]);
  assert.equal(p.skipped.invalid, 2);
});

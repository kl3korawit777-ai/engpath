// รัน: node --test tests/errlog.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as el from "../js/errlog.js";

const NOW = 1_800_000_000_000, DAY = 86400000;
const errs = [
  { id: "a", category: "Tense" },
  { id: "b", category: "Article" },
  { id: "c", category: "Tense" },
];
const ev = (id, errorId, type, at) => ({ id, errorId, type, at });

test("count มาจาก occurred; resolved/reopened ตัดสินสถานะ", () => {
  const events = [
    ev("1", "a", "occurred", NOW - 5 * DAY), ev("2", "a", "occurred", NOW - 4 * DAY),
    ev("3", "a", "resolved", NOW - 3 * DAY), ev("4", "b", "occurred", NOW - DAY),
    ev("5", "b", "resolved", NOW - 2 * DAY), ev("6", "b", "reopened", NOW - 1.5 * DAY),
  ];
  const s = el.errorStats(errs, events);
  assert.equal(s.get("a").count, 2);
  assert.equal(s.get("a").resolved, true);
  assert.equal(s.get("b").resolved, false);
  assert.equal(s.get("c").count, 0);
});

test("ลำดับ events ที่ซิงก์มาไม่เรียงไม่มีผล (เรียงตามเวลา)", () => {
  const events = [ev("2", "a", "reopened", 20), ev("1", "a", "resolved", 10), ev("0", "a", "occurred", 5)];
  assert.equal(el.errorStats(errs, events).get("a").resolved, false);
});

test("byCategory: ครบทุกหมวด รวมตาม occurred", () => {
  const events = [ev("1", "a", "occurred", 1), ev("2", "c", "occurred", 2), ev("3", "c", "occurred", 3), ev("4", "b", "occurred", 4)];
  const c = el.byCategory(errs, events);
  assert.equal(c.Tense, 3);
  assert.equal(c.Article, 1);
  assert.equal(c.Grammar, 0);
  assert.deepEqual(Object.keys(c), el.CATEGORIES);
});

test("weeklyFocus: 7 วันล่าสุด, ไม่รวมที่แก้ได้แล้ว, top 2", () => {
  const events = [
    ev("1", "a", "occurred", NOW - DAY), ev("2", "a", "occurred", NOW - 2 * DAY), ev("3", "a", "occurred", NOW - 3 * DAY),
    ev("4", "b", "occurred", NOW - DAY), ev("5", "b", "occurred", NOW - 2 * DAY),
    ev("6", "c", "occurred", NOW - 3 * DAY),
    ev("7", "c", "occurred", NOW - 10 * DAY),            // นอกสัปดาห์
  ];
  let f = el.weeklyFocus(errs, events, NOW);
  assert.deepEqual(f.map((x) => [x.error.id, x.count]), [["a", 3], ["b", 2]]);
  f = el.weeklyFocus(errs, [...events, ev("8", "a", "resolved", NOW - 1000)], NOW);
  assert.deepEqual(f.map((x) => x.error.id), ["b", "c"]);
  assert.deepEqual(el.weeklyFocus(errs, [], NOW), []);
});

test("validateError", () => {
  assert.equal(el.validateError({ wrong: "I go", right: "I went", category: "Tense" }), null);
  assert.ok(el.validateError({ wrong: "", right: "x", category: "Tense" }));
  assert.ok(el.validateError({ wrong: "x", right: "y", category: "ไม่มี" }));
});

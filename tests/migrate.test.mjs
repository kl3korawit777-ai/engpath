import test from "node:test";
import assert from "node:assert/strict";
import { planMigration, summarize, toOps, planUndo, buildAliases, remapReview, isLegacyCard } from "../js/migrate.js";
import * as srs from "../js/srs.js";

const lib = new Map([["run", { wordKey: "run", rank: 120, level: 1 }], ["decide", { wordKey: "decide", rank: 300, level: 1 }], ["happy", { wordKey: "happy", rank: 50, level: 1 }]]);
const peek = (k) => lib.get(k) || null;
const day = (ts) => new Date(ts).toISOString().slice(0, 10);
const T = Date.UTC(2026, 9, 1);
const L = (id, en, extra = {}) => ({ id, en, th: "x", example: "a b c d", createdAt: T, deleted: false, ...extra });

const cards = [
  L("u1", "Run"), L("u2", "decide", { createdAt: T + 86400000 * 3 }), L("u3", "look after"), L("u4", "zzz"),
  L("u5", "happy"), L("u6", "run", { createdAt: T + 1000 }),                    // ซ้ำกับ u1
  L("u7", "gone", { deleted: true }),
  { id: "happy", wordKey: "happy", source: "library", level: 1, rank: 50, status: "known", addedDay: "2026-09-01", deleted: false },   // ผู้ใช้เคยกด “รู้แล้ว”
];

test("planMigration: จับคู่ตรงตัวด้วย wordKey, รวมบัตรซ้ำ, วลี/คำนอกคลังไม่ถูกแตะ, บัตรที่ลบแล้วไม่นับ", () => {
  const p = planMigration(cards, peek, day);
  assert.deepEqual(p.create.map((g) => g.wordKey), ["run", "decide"]);                  // เรียงตาม rank
  assert.deepEqual(p.create[0].legacyIds, ["u1", "u6"]);
  assert.equal(p.create[0].addedDay, "2026-10-01");
  assert.equal(p.create[1].addedDay, "2026-10-04");
  assert.deepEqual(p.update.map((g) => g.wordKey), ["happy"]);
  assert.deepEqual(p.update[0].legacyIds, ["u5"]);
  assert.deepEqual(p.unmatched.map((c) => c.en), ["look after", "zzz"]);
  assert.deepEqual(summarize(p), { words: 3, legacyCards: 4, creates: 2, updates: 1, unmatched: 2 });
});

test("toOps: เขียนบัตรคลังก่อน soft delete บัตรเดิม; ดึงคำที่เคยข้ามกลับมาเรียน", () => {
  const ops = toOps(planMigration(cards, peek, day));
  const firstDelete = ops.findIndex((o) => o.op === "softDelete");
  assert.ok(ops.slice(0, firstDelete).every((o) => o.op !== "softDelete"));
  assert.ok(ops.slice(firstDelete).every((o) => o.op === "softDelete"));
  const run = ops.find((o) => o.op === "create" && o.fields.id === "run").fields;
  assert.deepEqual(run, { id: "run", wordKey: "run", source: "library", level: 1, rank: 120, status: "learning", addedDay: "2026-10-01", legacyIds: ["u1", "u6"], migrated: true });
  assert.deepEqual(ops.find((o) => o.op === "update"), { op: "update", id: "happy", patch: { legacyIds: ["u5"], status: "learning", deleted: false } });
  assert.deepEqual(ops.filter((o) => o.op === "softDelete").map((o) => o.id).sort(), ["u1", "u2", "u5", "u6"]);
});

test("ประวัติทบทวนของบัตรเดิมต่อเนื่อง: alias แปลง cardId แล้ว stateMap ได้สถานะเดียวกับก่อนย้าย", () => {
  const reviews = [
    { id: "r1", cardId: "u1", rating: 2, at: T, createdAt: T }, { id: "r2", cardId: "u1", rating: 3, at: T + 86400000, createdAt: T + 1 },
    { id: "r3", cardId: "u6", rating: 2, at: T + 3 * 86400000, createdAt: T + 2 },
  ];
  const before = srs.stateMap([{ id: "u1" }], reviews.filter((r) => r.cardId === "u1")).get("u1");
  const migrated = [{ id: "run", wordKey: "run", source: "library", legacyIds: ["u1", "u6"], deleted: false }];
  const al = buildAliases(migrated);
  assert.deepEqual([...al], [["u1", "run"], ["u6", "run"]]);
  const mapped = reviews.map((r) => remapReview(r, al));
  assert.ok(mapped.every((r) => r.cardId === "run"));
  assert.equal(reviews[0].cardId, "u1", "ไม่แก้ event ดิบ");
  const after = srs.stateMap(migrated, mapped).get("run");
  assert.equal(after.reps, 3);                                      // 3 ครั้งรวมของสองบัตรเดิม
  assert.equal(srs.stateMap(migrated, mapped.slice(0, 2)).get("run").interval, before.interval);
  assert.equal(remapReview({ cardId: "other" }, al).cardId, "other");
});

test("buildAliases ไม่นับบัตรคลังที่ลบแล้ว/บัตรเดิม", () => {
  const al = buildAliases([{ id: "run", wordKey: "run", source: "library", legacyIds: ["u1"], deleted: true }, { id: "u9", en: "x", legacyIds: ["u2"] }]);
  assert.equal(al.size, 0);
});

test("planUndo: บัตรเดิมกลับมา, บัตรที่สร้างจากการย้ายถูกลบ, บัตรคลังที่มีก่อนแล้วแค่ถอด legacyIds", () => {
  const raw = [
    { id: "u1", en: "run", deleted: true }, { id: "u6", en: "run", deleted: true }, { id: "u5", en: "happy", deleted: true },
    { id: "run", wordKey: "run", source: "library", legacyIds: ["u1", "u6"], migrated: true, deleted: false },
    { id: "happy", wordKey: "happy", source: "library", legacyIds: ["u5"], deleted: false },
    { id: "other", wordKey: "other", source: "library", deleted: false },
  ];
  const ops = planUndo(raw);
  assert.deepEqual(ops, [
    { op: "restore", id: "u1" }, { op: "restore", id: "u6" }, { op: "softDelete", id: "run" },
    { op: "restore", id: "u5" }, { op: "update", id: "happy", patch: { legacyIds: [] } },
  ]);
});

test("isLegacyCard", () => {
  assert.equal(isLegacyCard({ id: "a", en: "x" }), true);
  assert.equal(isLegacyCard({ id: "a", wordKey: "x", en: "x", source: "library" }), false);
});

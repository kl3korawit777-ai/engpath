// รัน: node --test tests/library.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as lib from "../js/library.js";
import * as srs from "../js/srs.js";

const NOW = 1_800_000_000_000, DAY = 86400000;
const card = (id, o = {}) => ({ id, en: id, th: "ก", example: "one two three four", tags: [], createdAt: NOW - 100 * DAY, ...o });

test("normalizeTag", () => {
  assert.equal(lib.normalizeTag("  Science / Biology  "), "science/biology");
  assert.equal(lib.normalizeTag("//a///b/"), "a/b");
  assert.equal(lib.normalizeTag(""), "");
});

test("tagMatches: รวมลูก แต่ไม่ตรงชื่อที่ขึ้นต้นเหมือนกัน", () => {
  const c = card("a", { tags: ["Science/Biology"] });
  assert.ok(lib.tagMatches(c, "science"));
  assert.ok(lib.tagMatches(c, "science/biology"));
  assert.ok(!lib.tagMatches(c, "sci"));
  assert.ok(!lib.tagMatches(card("b", { tags: ["science-fiction"] }), "science"));
});

test("buildTagTree: นับการ์ดไม่ซ้ำต่อกิ่ง รวมลูก", () => {
  const cards = [
    card("1", { tags: ["science/biology", "science"] }),     // มีทั้งแม่และลูก นับครั้งเดียว
    card("2", { tags: ["science/physics"] }),
    card("3", { tags: ["daily-life"] }),
    card("4", { tags: ["Science/Biology/cell"] }),
  ];
  const tree = lib.buildTagTree(cards);
  assert.deepEqual(tree.map((n) => [n.path, n.count]), [["daily-life", 1], ["science", 3]]);
  const sci = tree.find((n) => n.path === "science");
  assert.deepEqual(sci.children.map((n) => [n.path, n.count]), [["science/biology", 2], ["science/physics", 1]]);
  assert.deepEqual(sci.children[0].children.map((n) => [n.path, n.count]), [["science/biology/cell", 1]]);
});

test("renameTag: science → sci เปลี่ยนลูกทั้งกิ่งตาม และไม่แตะ science-fiction", () => {
  const cards = [
    card("1", { tags: ["science", "x"] }),
    card("2", { tags: ["science/biology"] }),
    card("3", { tags: ["Science/biology/cell"] }),
    card("4", { tags: ["science-fiction"] }),
    card("5", { tags: ["other"] }),
  ];
  const p = lib.renameTag(cards, "science", "sci");
  assert.deepEqual(p.map((x) => x.id), ["1", "2", "3"]);
  assert.deepEqual(p[0].tags, ["sci", "x"]);
  assert.deepEqual(p[1].tags, ["sci/biology"]);
  assert.deepEqual(p[2].tags, ["sci/biology/cell"]);
});

test("renameTag: ย้ายกิ่งย่อย, รวมกับแท็กที่มีอยู่แล้ว (ไม่ซ้ำ), ปฏิเสธการย้ายเข้ากิ่งตัวเอง/ชื่อว่าง", () => {
  const cards = [card("1", { tags: ["science/biology", "bio"] }), card("2", { tags: ["science/biology/cell"] })];
  const p = lib.renameTag(cards, "science/biology", "bio");
  assert.deepEqual(p[0].tags, ["bio"]);                      // รวมกับ bio ที่มีอยู่
  assert.deepEqual(p[1].tags, ["bio/cell"]);
  assert.throws(() => lib.renameTag(cards, "science", "science/sub"), /กิ่งของตัวเอง/);
  assert.throws(() => lib.renameTag(cards, "science", " / "), /ว่าง/);
  assert.deepEqual(lib.renameTag(cards, "science", "Science"), []);   // ชื่อเท่าเดิม ไม่ทำอะไร
});

test("levelOf: ใช้เกณฑ์จาก config (พื้นฐาน ≥ 50, กลาง ≥ 5)", () => {
  assert.equal(lib.levelOf(120), "basic");
  assert.equal(lib.levelOf(50), "basic");
  assert.equal(lib.levelOf(49.9), "medium");
  assert.equal(lib.levelOf(5), "medium");
  assert.equal(lib.levelOf(4.9), "academic");
  assert.equal(lib.levelOf(null), "unknown");
  assert.equal(lib.levelOf(undefined), "unknown");
  assert.equal(lib.levelOf(10, { basic: 100, medium: 20 }), "academic");
});

test("memoryStatus: ใหม่ / กำลังเรียน / จำได้ (interval ≥ 21 วัน)", () => {
  assert.equal(lib.memoryStatus(srs.initialState()), "new");
  assert.equal(lib.memoryStatus({ isNew: false, interval: 20 }), "learning");
  assert.equal(lib.memoryStatus({ isNew: false, interval: 21 }), "known");
  assert.equal(lib.memoryStatus(undefined), "new");
});

const reviews = (cardId, ratings) => ratings.map((rating, i) => ({ id: `${cardId}${i}`, cardId, rating, at: NOW - (ratings.length - i) * DAY }));

function setup() {
  const cards = [
    card("bio1", { tags: ["science/biology"], pos: "noun", freq: 3, source: "manual", createdAt: NOW - 2 * DAY }),
    card("bio2", { tags: ["science/biology"], pos: "verb", freq: 80, createdAt: NOW - 50 * DAY }),
    card("phy", { tags: ["science/physics"], pos: "noun", freq: 4, source: "errorlog" }),
    card("misc", { tags: ["daily-life"], pos: undefined, freq: null }),
  ];
  const revs = [
    ...reviews("bio1", [0, 0, 2]),            // ลืม 2 ครั้ง
    ...reviews("bio2", [2, 3, 3, 3, 3]),      // จำได้
    ...reviews("phy", [0]),
  ];
  return { cards, ctx: { states: srs.stateMap(cards, revs), wrong: lib.wrongCounts(revs), now: NOW } };
}

test("wrongCounts นับเฉพาะ rating 0", () => {
  const { ctx } = setup();
  assert.equal(ctx.wrong.get("bio1"), 2);
  assert.equal(ctx.wrong.get("phy"), 1);
  assert.equal(ctx.wrong.get("bio2"), undefined);
});

test("filterCards: Smart folder “science ที่ตอบผิด ≥ 2 ครั้ง” ได้เฉพาะ bio1", () => {
  const { cards, ctx } = setup();
  const r = lib.filterCards(cards, { tags: ["science"], wrongMin: 2 }, ctx);
  assert.deepEqual(r.map((c) => c.id), ["bio1"]);
});

test("filterCards: AND ข้ามฟิลด์, OR ภายในฟิลด์", () => {
  const { cards, ctx } = setup();
  const ids = (cr) => lib.filterCards(cards, cr, ctx).map((c) => c.id);
  assert.deepEqual(ids({ pos: ["noun"] }), ["bio1", "phy"]);
  assert.deepEqual(ids({ pos: ["noun", "verb"], tags: ["science/biology"] }), ["bio1", "bio2"]);
  assert.deepEqual(ids({ pos: [""] }), ["misc"]);                        // ไม่ระบุชนิดคำ
  assert.deepEqual(ids({ levels: ["academic"] }), ["bio1", "phy"]);
  assert.deepEqual(ids({ levels: ["unknown"] }), ["misc"]);
  assert.deepEqual(ids({ sources: ["errorlog"] }), ["phy"]);
  assert.deepEqual(ids({ sources: ["manual"] }), ["bio1", "bio2", "misc"]);   // ว่าง = manual
  assert.deepEqual(ids({ tags: ["science", "daily-life"] }), []);        // ต้องตรงทุกแท็ก
  assert.deepEqual(ids({ q: "BIO" }), ["bio1", "bio2"]);
  assert.deepEqual(ids({}), ["bio1", "bio2", "phy", "misc"]);
  assert.deepEqual(ids(undefined), ["bio1", "bio2", "phy", "misc"]);
});

test("filterCards: สถานะการจำ, เพิ่มภายใน n วัน, ถึงรอบทบทวน", () => {
  const { cards, ctx } = setup();
  const ids = (cr) => lib.filterCards(cards, cr, ctx).map((c) => c.id);
  assert.deepEqual(ids({ memory: ["new"] }), ["misc"]);
  assert.deepEqual(ids({ memory: ["known"] }), ["bio2"]);
  assert.deepEqual(ids({ memory: ["learning"] }), ["bio1", "phy"]);
  assert.deepEqual(ids({ addedWithinDays: 7 }), ["bio1"]);
  assert.deepEqual(ids({ addedWithinDays: 60 }), ["bio1", "bio2"]);
  const due = ids({ dueOnly: true });
  assert.ok(due.includes("misc"));                                       // บัตรใหม่ถึงรอบเสมอ
  assert.ok(!due.includes("bio2"));                                      // เพิ่งทบทวน interval ยาว
});

test("hasCriteria", () => {
  assert.equal(lib.hasCriteria({}), false);
  assert.equal(lib.hasCriteria({ q: "  " }), false);
  assert.equal(lib.hasCriteria({ wrongMin: 0 }), true);
  assert.equal(lib.hasCriteria({ tags: ["a"] }), true);
});

// ---------- Smart folder ----------
test("sanitizeConditions: เก็บเฉพาะที่ถูกต้อง, ไม่รวม q, ล้างค่าว่าง/ผิดชนิด", () => {
  const c = lib.sanitizeConditions({ q: "x", tags: ["Science / Bio", "science/bio", ""], pos: ["noun"], levels: [], wrongMin: "2", addedWithinDays: 0, dueOnly: "yes", junk: 1, memory: [1, "new"] });
  assert.deepEqual(c, { tags: ["science/bio"], pos: ["noun"], memory: ["new"], wrongMin: 2 });
  assert.deepEqual(lib.sanitizeConditions(null), {});
  assert.deepEqual(lib.sanitizeConditions({ dueOnly: true, addedWithinDays: 7.9 }), { dueOnly: true, addedWithinDays: 7 });
});

test("renameTagInConditions: เงื่อนไขของ Smart folder ตามชื่อแท็กใหม่", () => {
  const c = { tags: ["science", "daily-life"], wrongMin: 2 };
  assert.deepEqual(lib.renameTagInConditions(c, "science", "sci"), { tags: ["sci", "daily-life"], wrongMin: 2 });
  assert.deepEqual(lib.renameTagInConditions({ tags: ["Science/biology"] }, "science", "sci"), { tags: ["sci/biology"] });
  assert.equal(lib.renameTagInConditions(c, "physics", "p"), null);               // ไม่เกี่ยวข้อง
  assert.equal(lib.renameTagInConditions({ tags: ["science-fiction"] }, "science", "sci"), null);
  assert.equal(lib.renameTagInConditions({ pos: ["noun"] }, "a", "b"), null);
});

test("Smart folder หลังเปลี่ยนชื่อแท็ก ยังเจอการ์ดชุดเดิม (science → sci)", () => {
  const { cards, ctx } = setup();
  const folder = { conditions: { tags: ["science"], wrongMin: 2 } };
  const before = lib.filterCards(cards, lib.scopeCriteria({ type: "folder", folder }), ctx).map((c) => c.id);
  const patches = new Map(lib.renameTag(cards, "science", "sci").map((p) => [p.id, p.tags]));
  const renamed = cards.map((c) => (patches.has(c.id) ? { ...c, tags: patches.get(c.id) } : c));
  const conds = lib.renameTagInConditions(folder.conditions, "science", "sci");
  const after = lib.filterCards(renamed, lib.scopeCriteria({ type: "folder", folder: { conditions: conds } }), ctx).map((c) => c.id);
  assert.deepEqual(before, ["bio1"]);
  assert.deepEqual(after, before);
});

test("describeConditions", () => {
  assert.equal(lib.describeConditions({ tags: ["science"], wrongMin: 2 }), "แท็ก science · ตอบผิด ≥ 2 ครั้ง");
  assert.equal(lib.describeConditions({}), "ทุกบัตร");
  assert.equal(lib.describeConditions({ memory: ["known"], dueOnly: true }, { memory: { known: "จำได้" } }), "สถานะ จำได้ · ถึงรอบทบทวน");
});

test("scopeCriteria: ทบทวนตามแท็กหรือ Smart folder", () => {
  const { cards, ctx } = setup();
  assert.equal(lib.scopeCriteria(null), null);
  const tagIds = lib.filterCards(cards, lib.scopeCriteria({ type: "tag", path: "science/biology" }), ctx).map((c) => c.id);
  assert.deepEqual(tagIds, ["bio1", "bio2"]);
  assert.deepEqual(lib.scopeCriteria({ type: "folder", folder: { conditions: { wrongMin: 1, evil: true } } }), { wrongMin: 1 });
});

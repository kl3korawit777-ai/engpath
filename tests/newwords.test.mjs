import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as nw from "../js/newwords.js";
import { hydrateCard } from "../js/cardview.js";
import { vocab, TAGS } from "../js/vocab.js";

const words = (n) => Array.from({ length: n }, (_, i) => ({ wordKey: `w${i + 1}`, word: `W${i + 1}`, rank: i + 1, level: i < 5 ? 1 : 2, tags: i % 2 ? ["work"] : ["health"] }));

test("normalizePlan: ค่าเริ่มต้นและกันค่าผิดรูปแบบ", () => {
  assert.deepEqual(nw.normalizePlan({}), { perDay: 10, levels: [1], tags: [] });
  const p = nw.normalizePlan({ newPerDay: 7, vocabLevels: [3, 1, 3, 99, "x", 0], vocabTags: ["work", "work", 5] }, { maxLevel: 11, tagList: TAGS });
  assert.deepEqual(p, { perDay: 10, levels: [1, 3], tags: ["work"] });
  assert.deepEqual(nw.normalizePlan({ vocabLevels: [] }).levels, [1]);
  assert.equal(nw.normalizePlan({ newPerDay: 20 }).perDay, 20);
});

test("candidates: เรียงตาม rank กรองระดับ/แท็ก ไม่เสนอคำที่ใช้แล้ว และเคารพ limit", () => {
  const w = words(10);
  const plan = { perDay: 10, levels: [1], tags: [] };
  assert.deepEqual(nw.candidates(w, { taken: new Set(), plan, limit: 3 }).map((x) => x.wordKey), ["w1", "w2", "w3"]);
  assert.deepEqual(nw.candidates(w, { taken: new Set(["w1", "w3"]), plan, limit: 10 }).map((x) => x.wordKey), ["w2", "w4", "w5"]);
  assert.deepEqual(nw.candidates(w, { taken: new Set(), plan: { ...plan, levels: [2], tags: ["work"] }, limit: 10 }).map((x) => x.wordKey), ["w6", "w8", "w10"].filter((k) => w.find((x) => x.wordKey === k).tags.includes("work")));
  assert.equal(nw.candidates(w, { taken: new Set(), plan, limit: 0 }).length, 0);
});

test("โควตาวัน: นับเฉพาะ learning ของวันนั้น — กด “รู้แล้ว” ไม่กินโควตา", () => {
  const cards = [
    { wordKey: "a", source: "library", status: "learning", addedDay: "2026-10-20" },
    { wordKey: "b", source: "library", status: "learning", addedDay: "2026-10-19" },
    { wordKey: "c", source: "library", status: "known", addedDay: "2026-10-20" },
    { id: "legacy", en: "x", th: "y", example: "z z z z" },
  ];
  assert.equal(nw.addedOn(cards, "2026-10-20"), 1);
  assert.equal(nw.quotaLeft(10, 1), 9);
  assert.equal(nw.quotaLeft(10, 12), 0);
  assert.deepEqual([...nw.takenKeys(cards)].sort(), ["a", "b", "c"]);
});

test("cardFields: id = wordKey และเก็บเฉพาะความคืบหน้า (ไม่ซ้ำเนื้อหาคลัง)", () => {
  const f = nw.cardFields({ wordKey: "monday", word: "Monday", level: 1, rank: 1, th: [{ text: "x" }] }, "2026-10-20");
  assert.deepEqual(f, { id: "monday", wordKey: "monday", source: "library", level: 1, rank: 1, status: "learning", addedDay: "2026-10-20" });
  assert.equal(nw.cardFields({ wordKey: "a", level: 2, rank: 9 }, "d", "known").status, "known");
});

test("remainingCount ตรงกับจำนวนที่ candidates คืนเมื่อไม่จำกัด", () => {
  const w = words(10);
  const plan = { perDay: 10, levels: [1, 2], tags: ["health"] };
  const taken = new Set(["w1"]);
  assert.equal(nw.remainingCount(w, { taken, plan }), nw.candidates(w, { taken, plan, limit: 99 }).length);
});

test("hydrateCard: เติม en/th/example จากคลังจริง และคงที่ id/สถานะ; คำที่คลังยังไม่โหลดไม่พัง", async () => {
  const unresolved = hydrateCard({ id: "monday", wordKey: "monday", source: "library", status: "learning" });
  assert.equal(unresolved.en, "monday");
  assert.equal(unresolved.th, "");
  const idx = JSON.parse(readFileSync(new URL("../vocab/index.json", import.meta.url), "utf8"));
  const lvl = JSON.parse(readFileSync(new URL(`../vocab/${idx.levels[0].file}`, import.meta.url), "utf8"));
  const orig = globalThis.fetch;
  globalThis.fetch = async (u) => ({ ok: true, status: 200, json: async () => (String(u).endsWith("index.json") ? idx : lvl) });
  try {
    await vocab.loadLevel(1);
    const card = { id: "monday", wordKey: "monday", source: "library", status: "learning", level: 1, rank: 1 };
    const h = hydrateCard(card);
    assert.equal(h.en, "Monday");
    assert.match(h.th, /วันจันทร์/);
    assert.ok(h.example.split(" ").length >= 4);
    assert.equal(h.id, "monday");
    assert.equal(h.status, "learning");
    assert.equal(hydrateCard(card), h, "ผลถูก cache ต่อเอกสาร");
    const legacy = { id: "u1", en: "cat", th: "แมว", example: "A cat sat down." };
    assert.equal(hydrateCard(legacy), legacy, "บัตรเดิมไม่ถูกแตะ");
  } finally { globalThis.fetch = orig; }
});

test("wordKey ทุกคำในคลังใช้เป็น Firestore document id ได้", () => {
  const idx = JSON.parse(readFileSync(new URL("../vocab/index.json", import.meta.url), "utf8"));
  for (const l of idx.levels) {
    const j = JSON.parse(readFileSync(new URL(`../vocab/${l.file}`, import.meta.url), "utf8"));
    for (const w of j.words) {
      const k = w.wordKey;
      assert.ok(k && !k.includes("/") && k !== "." && k !== ".." && !/^__.*__$/.test(k) && Buffer.byteLength(k) <= 1500, k);
    }
  }
});

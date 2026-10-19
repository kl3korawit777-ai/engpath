// รัน: node --test tests/journal.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as jn from "../js/journal.js";
import { CATEGORIES } from "../js/errlog.js";

const TEXT = "Yesterday I go to school. I saw a apple tree near the river. We was very happy.\nThen I recieve a letter from my friend.";

test("countText / goalStatus: นับคำและประโยค เป้า 5–10 ประโยค", () => {
  assert.deepEqual(jn.countText(TEXT), { words: 25, sentences: 4 });
  assert.deepEqual(jn.countText(""), { words: 0, sentences: 0 });
  assert.deepEqual([0, 4].map(jn.goalStatus), ["below", "below"]);
  assert.deepEqual([5, 7, 10].map(jn.goalStatus), ["in", "in", "in"]);
  assert.equal(jn.goalStatus(11), "above");
  assert.match(jn.GOAL_TEXT.below(3), /3\/5/);
  assert.equal(jn.GOAL_TEXT.in(), "ตามเป้าแล้ว ✓");
});

test("locate: เจอข้อความเดิมแม้ช่องว่าง/ขึ้นบรรทัดต่างกัน, เริ่มหาจากตำแหน่งที่กำหนด", () => {
  const r = jn.locate(TEXT, "I go to school");
  assert.equal(TEXT.slice(r.start, r.end), "I go to school");
  assert.ok(jn.locate("We was\n  very happy", "We was very happy"));
  assert.equal(jn.locate(TEXT, "does not exist"), null);
  assert.equal(jn.locate(TEXT, "  "), null);
  assert.equal(jn.locate("a. b. a.", "a.", 1).start, 6);
  assert.ok(jn.locate("price is $5 (cheap)", "$5 (cheap)"));                    // อักขระพิเศษของ regex
});

const ITEMS = [
  { original: "I go to school", corrected: "I went to school", category: "Tense", explanation_th: "เหตุการณ์ในอดีต (yesterday) ใช้ went" },
  { original: "a apple", corrected: "an apple", category: "Article", explanation_th: "ใช้ an หน้าเสียงสระ" },
  { original: "We was", corrected: "We were", category: "Grammar", explanation_th: "We ใช้ were" },
  { original: "recieve", corrected: "receive", category: "การสะกด", explanation_th: "i ก่อน e ยกเว้นหลัง c" },
];

test("planEdits/applyEdits: ใช้เฉพาะจุดที่ผิด ไม่แตะส่วนอื่น และตำแหน่งไม่ซ้อนกัน", () => {
  const { placed, skipped } = jn.planEdits(TEXT, [...ITEMS].reverse());          // ลำดับที่ส่งมาไม่สำคัญ
  assert.deepEqual(placed.map((p) => p.item.original), ["I go to school", "a apple", "We was", "recieve"]);
  assert.equal(skipped.length, 0);
  assert.equal(jn.applyEdits(TEXT, placed), "Yesterday I went to school. I saw an apple tree near the river. We were very happy.\nThen I receive a letter from my friend.");
  const overlap = jn.planEdits("I go to school", [{ original: "I go to", corrected: "x", category: "Tense", explanation_th: "." }, { original: "go to school", corrected: "y", category: "Tense", explanation_th: "." }]);
  assert.equal(overlap.placed.length, 1);
  assert.equal(overlap.skipped.length, 1);                                        // ข้อที่ซ้อนกันถูกข้าม ไม่แก้ซ้ำ
});

test("planEdits: ข้อความซ้ำในบันทึก — ข้อที่สองใช้ตำแหน่งถัดไป", () => {
  const t = "I go there. I go there.";
  const item = { original: "I go there", corrected: "I went there", category: "Tense", explanation_th: "." };
  const { placed } = jn.planEdits(t, [item, { ...item }]);
  assert.deepEqual(placed.map((p) => p.start), [0, 12]);
  assert.equal(jn.applyEdits(t, placed), "I went there. I went there.");
});

test("sideBySide: ฝั่งต้นฉบับ/ฉบับแก้ไฮไลต์จุดที่แก้ตรงกัน", () => {
  const { placed } = jn.planEdits(TEXT, ITEMS);
  const s = jn.sideBySide(TEXT, placed);
  assert.equal(s.original.map((x) => x.text).join(""), TEXT);
  assert.equal(s.corrected.map((x) => x.text).join(""), jn.applyEdits(TEXT, placed));
  assert.deepEqual(s.original.filter((x) => x.changed).map((x) => x.text), ["I go to school", "a apple", "We was", "recieve"]);
  assert.deepEqual(s.corrected.filter((x) => x.changed).map((x) => x.text), ["I went to school", "an apple", "We were", "receive"]);
  assert.equal(s.original.find((x) => x.changed).item.category, "Tense");
});

const reply = (items) => `Here is the result:\n${JSON.stringify(items)}\nHope it helps.`;

test("parseAiReview: ผลถูกต้องผ่าน (อ่านจากข้อความที่มีคำนำ) และ [] = ไม่พบข้อผิด", () => {
  assert.deepEqual(jn.parseAiReview(reply(ITEMS), TEXT), ITEMS);
  assert.deepEqual(jn.parseAiReview("[]", TEXT), []);
  assert.deepEqual(jn.parseAiReview(reply([{ ...ITEMS[0], original: "  I go to school  " }]), TEXT)[0].original, "I go to school");
});

test("parseAiReview: โครงสร้าง/หมวด/ข้อความต้นฉบับไม่ตรง → error ทั้งชุด ไม่เดาเติม", () => {
  const fails = (items, re) => assert.throws(() => jn.parseAiReview(reply(items), TEXT), (e) => e.kind === "parse" && re.test(e.detail), re.toString());
  assert.throws(() => jn.parseAiReview("no json here", TEXT), (e) => e.kind === "parse" && /JSON/.test(e.detail));
  assert.throws(() => jn.parseAiReview("[{broken", TEXT), (e) => e.kind === "parse");
  fails([{ ...ITEMS[0], category: "Vocabulary" }], /ข้อที่ 1.*category/);                    // หมวดไม่อยู่ใน Error Log
  fails([ITEMS[0], { ...ITEMS[1], category: "article" }], /ข้อที่ 2.*category/);              // ตัวพิมพ์เล็กก็ไม่ผ่าน ไม่แก้ให้เอง
  fails([{ ...ITEMS[0], explanation_th: undefined }], /explanation_th/);
  fails([{ ...ITEMS[0], corrected: "" }], /corrected/);
  fails([{ ...ITEMS[0], original: 5 }], /original/);
  fails([{ ...ITEMS[0], corrected: ITEMS[0].original }], /เหมือน original/);                   // ห้ามแก้สำนวนที่ไม่ผิด
  fails([{ ...ITEMS[0], original: "I goes to school" }], /ไม่พบ/);                            // original ไม่มีในบันทึกจริง
  fails([ITEMS[0], null], /ข้อที่ 2/);
  fails(Array.from({ length: 31 }, () => ITEMS[0]), /เกิน/);
  fails([{ ...ITEMS[0], explanation_th: "ก".repeat(401) }], /ยาวเกิน/);
  assert.throws(() => jn.parseAiReview('{"items": "x"}', TEXT), (e) => e.kind === "parse");
});

test("aiPrompt: ระบุหมวดตาม Error Log ทุกหมวด, ห้ามแก้สำนวน, ขอ JSON", () => {
  const p = jn.aiPrompt("Hello.");
  for (const c of CATEGORIES) assert.ok(p.includes(`"${c}"`), c);
  assert.match(p, /ONLY a JSON array/);
  assert.match(p, /Do NOT rewrite style/);
  assert.match(p, /explanation_th/);
  assert.ok(p.endsWith("Hello."));
});

test("reviewWithAi: เรียก Claude ผ่าน header ที่จำเป็นแล้วตรวจผล; ผลเพี้ยนโยน error", async () => {
  let body;
  const ok = async (url, init) => { body = JSON.parse(init.body); return { ok: true, status: 200, json: async () => ({ content: [{ type: "thinking", thinking: "…" }, { type: "text", text: reply([ITEMS[0]]) }] }) }; };
  const items = await jn.reviewWithAi(TEXT, { apiKey: "k", model: "m", fetchImpl: ok });
  assert.deepEqual(items, [ITEMS[0]]);
  assert.equal(body.model, "m");
  assert.match(body.messages[0].content, /Yesterday I go to school/);
  const wrong = async () => ({ ok: true, status: 200, json: async () => ({ content: [{ type: "text", text: reply([{ ...ITEMS[0], category: "Nope" }]) }] }) });
  await assert.rejects(jn.reviewWithAi(TEXT, { apiKey: "k", fetchImpl: wrong }), (e) => e.kind === "parse");
  await assert.rejects(jn.reviewWithAi(TEXT, { apiKey: "", fetchImpl: ok }), (e) => e.kind === "auth");
});

test("makeSelfItem: ตรวจเองต้องมีข้อความผิดอยู่ในบันทึก แบบถูกต่างจากเดิม และหมวดถูกต้อง", () => {
  const ok = jn.makeSelfItem({ original: "recieve", corrected: "receive", category: "การสะกด", note: "  i ก่อน e  " }, TEXT);
  assert.deepEqual(ok.item, { original: "recieve", corrected: "receive", category: "การสะกด", explanation_th: "i ก่อน e" });
  assert.match(jn.makeSelfItem({ original: "", corrected: "x", category: "Tense" }, TEXT).error, /ข้อความที่ผิด/);
  assert.match(jn.makeSelfItem({ original: "recieve", corrected: "", category: "Tense" }, TEXT).error, /แบบที่ถูก/);
  assert.match(jn.makeSelfItem({ original: "recieve", corrected: "recieve", category: "Tense" }, TEXT).error, /ต่างจาก/);
  assert.match(jn.makeSelfItem({ original: "recieve", corrected: "receive", category: "?" }, TEXT).error, /หมวด/);
  assert.match(jn.makeSelfItem({ original: "nope", corrected: "yes", category: "Tense" }, TEXT).error, /ตรงกับที่เขียน/);
  assert.equal(jn.SELF_CHECKLIST.length, 4);
  for (const c of jn.SELF_CHECKLIST) assert.ok(CATEGORIES.includes(c.category), c.key);
});

test("findExistingError: wrong/right ตรงกัน (ไม่สนตัวพิมพ์/เครื่องหมาย) → นับซ้ำ, ต่างกัน/ถูกลบ → สร้างใหม่", () => {
  const errors = [
    { id: "a", wrong: "I go to school", right: "I went to school" },
    { id: "b", wrong: "a apple", right: "an apple", deleted: true },
    { id: "c", wrong: "We was", right: "We were" },
  ];
  assert.equal(jn.findExistingError(errors, "i go to school.", "I WENT to school")?.id, "a");
  assert.equal(jn.findExistingError(errors, "a apple", "an apple"), null);          // อันเดิมถูกลบแล้ว
  assert.equal(jn.findExistingError(errors, "We was", "We are"), null);              // right ต่างกัน = คนละข้อผิด
  assert.deepEqual(jn.errorPayload(ITEMS[1]), { wrong: "a apple", right: "an apple", category: "Article", note: "ใช้ an หน้าเสียงสระ" });
});

test("sentenceWith: ประโยคในฉบับแก้ที่มีส่วนที่แก้ (ไว้ใช้เป็นตัวอย่างบัตรคำ)", () => {
  const corrected = "Yesterday I went to school. I saw an apple tree near the river.";
  assert.equal(jn.sentenceWith(corrected, "an apple"), "I saw an apple tree near the river.");
  assert.equal(jn.sentenceWith(corrected, "I  WENT to school"), "Yesterday I went to school.");
  assert.equal(jn.sentenceWith(corrected, "nothing"), null);
});

test("isValidReview: ตรวจเอกสาร review ตอน Import", () => {
  const ok = { source: "ai", at: 1, items: ITEMS };
  assert.equal(jn.isValidReview(ok), true);
  assert.equal(jn.isValidReview({ ...ok, source: "x" }), false);
  assert.equal(jn.isValidReview({ ...ok, items: [{ ...ITEMS[0], category: "Nope" }] }), false);
  assert.equal(jn.isValidReview({ ...ok, items: [{ original: "a" }] }), false);
  assert.equal(jn.isValidReview({ source: "self", at: 1, items: [] }), true);
  assert.equal(jn.isValidReview(null), false);
});

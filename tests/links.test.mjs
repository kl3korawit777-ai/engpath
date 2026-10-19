import test from "node:test";
import assert from "node:assert/strict";
import { parseLinks, buildLinkDoc, backlinks, outgoing, segments, openLink, applySuggestion, suggest, isValidLinkDoc, NOTE_MAX, MAX_OCCURRENCES } from "../js/links.js";

test("parseLinks: [[key]] และ [[key|alias]] อ้างอิงด้วย wordKey", () => {
  const r = parseLinks("see [[Decide]] and [[look  after|ดูแล]] ok");
  assert.deepEqual(r.map((x) => [x.key, x.alias]), [["decide", null], ["look after", "ดูแล"]]);
  assert.equal("see [[Decide]] and".slice(r[0].start, r[0].end), "[[Decide]]");
});

test("parseLinks: ลิงก์ซ้อนนับเฉพาะชั้นใน / วงเล็บไม่ครบ / ว่าง / ข้ามบรรทัดไม่นับ", () => {
  assert.deepEqual(parseLinks("[[a [[b]] c]]").map((x) => x.key), ["b"]);
  assert.deepEqual(parseLinks("[[abc").map((x) => x.key), []);
  assert.deepEqual(parseLinks("[[]] [[ ]] [[|x]]").map((x) => x.key), []);
  assert.deepEqual(parseLinks("[[ab\ncd]]").map((x) => x.key), []);
  assert.deepEqual(parseLinks("[[!!bad]] [[ok]]").map((x) => x.key), ["ok"]);       // เป้าหมายที่ไม่ใช่คำที่ถูกต้องข้าม
  assert.deepEqual(parseLinks("[[x|]]").map((x) => [x.key, x.alias]), [["x", null]]);
  assert.deepEqual(parseLinks("[[x|a|b]]").map((x) => x.alias), ["a|b"]);
});

test("parseLinks: เลขบรรทัดและข้อความบรรทัด", () => {
  const r = parseLinks("line one\n  uses [[go]] here  \n\n[[stop]]");
  assert.deepEqual(r.map((x) => [x.key, x.line, x.lineText]), [["go", 2, "uses [[go]] here"], ["stop", 4, "[[stop]]"]]);
});

test("buildLinkDoc: ซ้ำคำ+บรรทัดเดียวกันนับครั้งเดียว ต่างบรรทัดเก็บทั้งคู่", () => {
  const d = buildLinkDoc("x", "[[a]] [[a]]\n[[a]] and [[b|bee]]");
  assert.deepEqual(d.to.map((t) => [t.key, t.line]), [["a", "[[a]] [[a]]"], ["a", "[[a]] and [[b|bee]]"], ["b", "[[a]] and [[b|bee]]"]]);
  assert.equal(d.to[2].alias, "bee");
  assert.equal(d.from, "x");
});

test("buildLinkDoc: จำกัดความยาวโน้ตและจำนวนลิงก์", () => {
  assert.equal(buildLinkDoc("x", "a".repeat(NOTE_MAX + 50)).notes.length, NOTE_MAX);
  const many = Array.from({ length: MAX_OCCURRENCES + 20 }, (_, i) => `[[w${i}]]`).join("\n");
  assert.equal(buildLinkDoc("x", many).to.length, MAX_OCCURRENCES);
  assert.deepEqual(buildLinkDoc("x", "").to, []);
});

test("backlinks: รวมบรรทัดต่อคำ ไม่นับตัวเอง/ที่ลบ/ที่ไม่เกี่ยว", () => {
  const docs = [
    buildLinkDoc("beta", "uses [[Alpha]] here\nagain [[alpha]]"),
    buildLinkDoc("alpha", "self [[alpha]] and [[beta]]"),
    { ...buildLinkDoc("gamma", "[[alpha]]"), deleted: true },
    buildLinkDoc("delta", "[[other]]"),
    buildLinkDoc("able", "[[alpha|A]]"),
  ];
  const b = backlinks(docs, "Alpha");
  assert.deepEqual(b.map((x) => x.from), ["able", "beta"]);
  assert.deepEqual(b[1].lines, ["uses [[Alpha]] here", "again [[alpha]]"]);
  assert.deepEqual(backlinks(docs, "beta").map((x) => x.from), ["alpha"]);
  assert.deepEqual(outgoing(docs[1]), ["alpha", "beta"]);
});

test("segments: แยกข้อความ/ลิงก์ และบอกว่าคำมีในคลังหรือไม่", () => {
  const s = segments("a [[go]] b [[nope|N]] c", (k) => k === "go");
  assert.deepEqual(s, [
    { type: "text", text: "a " }, { type: "link", key: "go", label: "go", exists: true },
    { type: "text", text: " b " }, { type: "link", key: "nope", label: "N", exists: false }, { type: "text", text: " c" },
  ]);
  assert.deepEqual(segments("", () => true), []);
});

test("openLink: ตรวจว่าเคอร์เซอร์อยู่ในลิงก์ที่ยังไม่จบ", () => {
  assert.deepEqual(openLink("hi [[de", 7), { start: 5, query: "de" });
  assert.deepEqual(openLink("hi [[", 5), { start: 5, query: "" });
  assert.equal(openLink("hi [[done]] x", 13), null);
  assert.equal(openLink("hi [[a|b", 8), null);
  assert.equal(openLink("hi [[a\nb", 8), null);
  assert.equal(openLink("no link", 7), null);
});

test("applySuggestion: เติม key + ]] และคง alias / ไม่ซ้ำ ]] เดิม", () => {
  assert.deepEqual(applySuggestion("a [[de", 6, "decide"), { text: "a [[decide]]", caret: 12 });
  assert.deepEqual(applySuggestion("a [[de]] z", 6, "decide"), { text: "a [[decide]] z", caret: 12 });
  assert.deepEqual(applySuggestion("a [[de|ตัดสินใจ]] z", 6, "decide"), { text: "a [[decide|ตัดสินใจ]] z", caret: 21 });
  assert.deepEqual(applySuggestion("x [[de", 6, "a b"), { text: "x [[a b]]", caret: 9 });
  assert.deepEqual(applySuggestion("no", 2, "k"), { text: "no", caret: 2 });
});

test("suggest: ขึ้นต้นก่อน แล้วค่อยมีอยู่ตรงกลาง จำกัดจำนวน ไม่ซ้ำ", () => {
  const keys = ["decision", "decide", "undecided", "dog", "decide"];
  assert.deepEqual(suggest("dec", keys), ["decide", "decision", "undecided"]);
  assert.deepEqual(suggest("DEC", keys, 2), ["decide", "decision"]);
  assert.deepEqual(suggest("", keys, 3), ["decide", "decision", "dog"]);
  assert.deepEqual(suggest("zzz", keys), []);
});

test("isValidLinkDoc", () => {
  const ok = { ...buildLinkDoc("go", "[[x]]"), id: "go" };
  assert.ok(isValidLinkDoc(ok));
  assert.ok(!isValidLinkDoc({ ...ok, id: "other" }));
  assert.ok(!isValidLinkDoc({ ...ok, notes: 5 }));
  assert.ok(!isValidLinkDoc({ ...ok, to: [{ key: "", line: "" , alias: null }] }));
  assert.ok(!isValidLinkDoc({ ...ok, from: "Go", id: "Go" }));
});

// รัน: node --test tests/speech.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as sp from "../js/speech.js";

test("wordsOf: ตัวพิมพ์เล็ก ตัดเครื่องหมาย เก็บ ' ในคำ ขีดกลางเป็นช่องว่าง", () => {
  assert.deepEqual(sp.wordsOf("Hello, World!"), ["hello", "world"]);
  assert.deepEqual(sp.wordsOf("I don’t know — it’s 'fine'."), ["i", "don't", "know", "it's", "fine"]);
  assert.deepEqual(sp.wordsOf("A well-known fact (really)"), ["a", "well", "known", "fact", "really"]);
  assert.deepEqual(sp.wordsOf("  "), []);
  assert.deepEqual(sp.wordsOf(null), []);
  assert.deepEqual(sp.wordsOf("3.5 dollars"), ["3", "5", "dollars"]);
});

test("lcsMatches: จับคู่คำตามลำดับ ไม่ข้ามลำดับ", () => {
  const { a, b } = sp.lcsMatches(["a", "b", "c", "d"], ["a", "x", "c", "d", "b"]);
  assert.deepEqual([...a], [0, 2, 3]);
  assert.deepEqual([...b], [0, 2, 3]);
  const none = sp.lcsMatches(["a"], ["b"]);
  assert.equal(none.a.size, 0);
});

test("compareWords: พูดครบ = ถูกทุกคำ accuracy 1", () => {
  const r = sp.compareWords("How are you today?", "how are you today");
  assert.equal(r.accuracy, 1);
  assert.deepEqual(r.tokens.map((t) => t.ok), [true, true, true, true]);
  assert.deepEqual(r.tokens.map((t) => t.text), ["How", "are", "you", "today?"]);   // คงรูปที่แสดงไว้
  assert.deepEqual(r.extra, []);
});

test("compareWords: คำที่ขาด/ไม่ตรงถูกไฮไลต์ และคำเกินถูกรายงาน", () => {
  const r = sp.compareWords("The quick brown fox jumps", "the quick fox jumped high");
  assert.deepEqual(r.tokens.map((t) => [t.text, t.ok]), [["The", true], ["quick", true], ["brown", false], ["fox", true], ["jumps", false]]);
  assert.deepEqual(r.extra, ["jumped", "high"]);
  assert.equal(r.matched, 3);
  assert.equal(r.total, 5);
  assert.ok(Math.abs(r.accuracy - 0.6) < 1e-9);
});

test("compareWords: ลำดับสลับ/ซ้ำคำ/ไม่พูดเลย/ประโยคว่าง", () => {
  const swapped = sp.compareWords("one two three", "three two one");
  assert.equal(swapped.matched, 1);                                  // LCS ได้แค่ 1 คำ
  const rep = sp.compareWords("no no no way", "no way");
  assert.deepEqual(rep.tokens.map((t) => t.ok), [true, false, false, true].map((v, i) => rep.tokens[i].ok));   // จับคู่ได้ 2 จาก 4
  assert.equal(rep.matched, 2);
  const silent = sp.compareWords("hello there", "");
  assert.equal(silent.accuracy, 0);
  assert.deepEqual(silent.tokens.map((t) => t.ok), [false, false]);
  const empty = sp.compareWords("", "anything");
  assert.equal(empty.total, 0);
  assert.equal(empty.accuracy, 0);
  assert.deepEqual(empty.extra, ["anything"]);
});

test("compareWords: คำที่มีขีดกลาง/คำย่อ นับตามคำย่อยที่พูดครบ", () => {
  const ok = sp.compareWords("A well-known don't", "a well known don't");
  assert.deepEqual(ok.tokens.map((t) => t.ok), [true, true, true]);
  const part = sp.compareWords("A well-known fact", "a well fact");
  assert.deepEqual(part.tokens.map((t) => t.ok), [true, false, true]);   // พูดแค่ well ไม่ครบ well-known → ไม่ผ่านโทเคนนี้
  assert.equal(part.matched, 3);
  const punct = sp.compareWords("Hello — , world", "hello world");
  assert.equal(punct.total, 2);                                          // เครื่องหมายล้วนไม่นับเป็นคำ
});

test("pickMimeType: iOS (รองรับแค่ mp4) ได้ audio/mp4, Chrome ได้ webm opus, ไม่รองรับเลย = ''", () => {
  const ios = (m) => m === "audio/mp4" || m === "audio/mp4;codecs=mp4a.40.2";
  assert.equal(sp.pickMimeType(ios), "audio/mp4;codecs=mp4a.40.2");
  assert.equal(sp.pickMimeType((m) => m === "audio/mp4"), "audio/mp4");
  const chrome = (m) => m.startsWith("audio/webm") || m.startsWith("audio/ogg");
  assert.equal(sp.pickMimeType(chrome), "audio/webm;codecs=opus");
  assert.equal(sp.pickMimeType(() => false), "");
  assert.equal(sp.pickMimeType(() => { throw new Error("x"); }), "");
});

test("extensionFor / formatBytes / quotaInfo", () => {
  assert.equal(sp.extensionFor("audio/mp4;codecs=mp4a.40.2"), "m4a");
  assert.equal(sp.extensionFor("audio/webm;codecs=opus"), "webm");
  assert.equal(sp.extensionFor("audio/ogg"), "ogg");
  assert.equal(sp.extensionFor(""), "audio");
  assert.equal(sp.formatBytes(500), "500 B");
  assert.equal(sp.formatBytes(2048), "2 KB");
  assert.equal(sp.formatBytes(1.5 * 1024 * 1024), "1.5 MB");
  assert.equal(sp.formatBytes(50 * 1024 * 1024), "50 MB");
  assert.deepEqual(sp.quotaInfo({ usage: 50, quota: 200 }), { usage: 50, quota: 200, pct: 25 });
  assert.equal(sp.quotaInfo(undefined).pct, null);
});

test("ข้อความผิดพลาดภาษาไทย: ไมค์/รู้จำเสียง", () => {
  assert.match(sp.micErrorMessage({ name: "NotAllowedError" }), /ไม่ได้รับอนุญาต/);
  assert.match(sp.micErrorMessage({ name: "NotFoundError" }), /ไม่พบ/);
  assert.match(sp.micErrorMessage({ name: "NotReadableError" }), /แอปอื่น/);
  assert.match(sp.speechErrorMessage("not-allowed"), /Siri/);
  assert.match(sp.speechErrorMessage("no-speech"), /ไม่ได้ยิน/);
  assert.match(sp.speechErrorMessage("network"), /เน็ต/);
  assert.equal(sp.speechErrorMessage("aborted"), "");
  assert.match(sp.speechErrorMessage("weird"), /weird/);
});

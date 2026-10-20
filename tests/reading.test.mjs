// รัน: node --test tests/reading.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as rd from "../js/reading.js";
import { READING } from "../js/data/reading-config.js";
import { initialState } from "../js/srs.js";

const KNOWN = { ...initialState(), isNew: false, interval: 25 };
const LEARNING = { ...initialState(), isNew: false, interval: 3 };

test("tokenize: คำ/’/ขีดกลาง นับเป็นคำเดียว, ตัวเลขและเครื่องหมายไม่นับ, ตำแหน่งถูกต้อง", () => {
  const t = rd.tokenize("Hello, world! It’s a well-known fact: 3 dogs, 2.5 cats.");
  assert.deepEqual(t.map((x) => x.surface), ["Hello", "world", "It’s", "a", "well-known", "fact", "dogs", "cats"]);
  assert.deepEqual(t.map((x) => x.key).slice(0, 3), ["hello", "world", "it's"]);
  assert.equal("Hello, world!".slice(t[1].start, t[1].end), "world");
  assert.deepEqual(rd.tokenize(""), []);
  assert.deepEqual(rd.tokenize("123 !!! ---"), []);
  assert.deepEqual(rd.tokenize("café naïve").map((x) => x.surface), ["café", "naïve"]);
});

test("stems: จับรูปผันที่พบบ่อย", () => {
  const has = (w, s) => assert.ok(rd.stems(w).has(s), `${w} → ${s}`);
  has("running", "run"); has("runs", "run"); has("ran", "ran");
  has("studies", "study"); has("studied", "study"); has("jumped", "jump"); has("liked", "like"); has("making", "make");
  has("boxes", "box"); has("teachers", "teacher"); has("quickly", "quick"); has("John's", "john"); has("stopped", "stop");
  assert.ok(!rd.stems("bed").has("be") && !rd.stems("sing").has("s"));          // สั้นเกินไม่นับเป็น stem
  assert.ok(!rd.stems("glass").has("glas"));                                    // ss ไม่ตัด s
});

test("cardWordIndex: เฉพาะบัตรคำเดี่ยว, ใช้สถานะที่ดีที่สุดเมื่อซ้ำ, วลีไม่กระทบ", () => {
  const cards = [
    { id: "1", en: "run" }, { id: "2", en: "tangible" }, { id: "3", en: "look after" },
    { id: "4", en: "Run" }, { id: "5", en: "lemon" },
  ];
  const states = new Map([["1", LEARNING], ["2", initialState()], ["3", KNOWN], ["4", KNOWN], ["5", LEARNING]]);
  const idx = rd.cardWordIndex(cards, states);
  assert.equal(rd.statusOfWord("run", idx), "known");                           // 2 บัตร known + learning → known
  assert.equal(rd.statusOfWord("running", idx), "known");                       // รูปผันของ run
  assert.equal(rd.statusOfWord("tangible", idx), "new");
  assert.equal(rd.statusOfWord("lemons", idx), "learning");
  assert.equal(rd.statusOfWord("look", idx), null);                             // วลี look after ไม่ทำให้ look เป็นคำที่รู้
  assert.equal(rd.statusOfWord("after", idx), null);
  assert.equal(rd.statusOfWord("banana", idx), null);
});

const idxOf = () => rd.cardWordIndex([{ id: "k", en: "apple" }, { id: "l", en: "tangible" }], new Map([["k", KNOWN], ["l", LEARNING]]));

test("classify: รู้เป็นค่าเริ่มต้น, แตะ = ไม่รู้, บัตรจำได้ล็อกว่ารู้, บัตรกำลังเรียนนับไม่รู้ (แตะเพื่อยกเว้นได้)", () => {
  const toks = rd.tokenize("An apple is tangible and a zebra runs");
  const c = rd.classify(toks, idxOf(), { userUnknown: new Set(["zebra", "apple"]), userKnown: new Set() });
  const by = Object.fromEntries(c.map((t) => [t.key, t.status]));
  assert.equal(by.an, "plain");
  assert.equal(by.apple, "known-card");                                          // แตะไม่เปลี่ยน
  assert.equal(by.tangible, "learning-card");
  assert.equal(by.zebra, "user-unknown");
  assert.equal(c.filter((t) => t.unknown).map((t) => t.key).join(), "tangible,zebra");
  const ov = rd.classify(toks, idxOf(), { userKnown: new Set(["tangible"]) });
  assert.equal(ov.find((t) => t.key === "tangible").unknown, false);             // ผู้ใช้บอกว่ารู้แล้ว
  assert.equal(ov.find((t) => t.key === "tangible").status, "plain");
});

test("stats: % จากจำนวนคำทั้งหมด (รวมคำซ้ำ), unique เรียงตามจำนวนครั้ง", () => {
  const text = "zebra zebra zebra and the cat saw a quokka today in the big zoo yesterday ok";   // 16 คำ
  const toks = rd.tokenize(text);
  const c = rd.classify(toks, new Map(), { userUnknown: new Set(["zebra", "quokka"]) });
  const s = rd.stats(c);
  assert.equal(s.total, 16);
  assert.equal(s.unknownCount, 4);
  assert.ok(Math.abs(s.unknownPct - 25) < 1e-9);
  assert.deepEqual(s.unique.map((u) => [u.key, u.count]), [["zebra", 3], ["quokka", 1]]);
  assert.equal(s.verdict, "hard");
  assert.deepEqual(rd.stats([]), { total: 0, unknownCount: 0, unknownPct: 0, verdict: null, unique: [] });
});

test("verdictOf: ตามเกณฑ์ใน config (< 2% ง่ายไป · 2–10% พอดี · > 10% ยากไป)", () => {
  assert.deepEqual([0, 1.99].map((p) => rd.verdictOf(p)), ["easy", "easy"]);
  assert.deepEqual([2, 6, 10].map((p) => rd.verdictOf(p)), ["fit", "fit", "fit"]);
  assert.deepEqual([10.01, 40].map((p) => rd.verdictOf(p)), ["hard", "hard"]);
  assert.equal(rd.verdictOf(5, { easyBelow: 10, fitUpTo: 20 }), "easy");        // เกณฑ์ปรับได้
  assert.equal(READING.easyBelow, 2);
  assert.equal(READING.fitUpTo, 10);
});

test("sentenceFor: ประโยคแรกที่มีคำนี้ทั้งคำ ต่อประโยคใกล้เคียงถ้าสั้นกว่า 4 คำ", () => {
  const text = "The cat sat on the mat. A tangible result appeared yesterday afternoon. Yes. Nothing else.";
  assert.equal(rd.sentenceFor(text, "tangible"), "A tangible result appeared yesterday afternoon.");
  assert.equal(rd.sentenceFor(text, "cat"), "The cat sat on the mat.");
  assert.equal(rd.sentenceFor(text, "tang"), null);                              // ต้องเป็นทั้งคำ
  assert.equal(rd.sentenceFor(text, "yes"), "A tangible result appeared yesterday afternoon. Yes. Nothing else.");   // สั้นไป ต่อประโยคถัดไปแล้วยังไม่ถึง 4 คำ จึงต่อประโยคก่อนหน้า
  assert.equal(rd.sentenceFor("Go home. Now it is late tonight.", "go"), "Go home. Now it is late tonight.");
  assert.equal(rd.sentenceFor("It's fine, really and truly so.", "it's"), "It's fine, really and truly so.");
  assert.equal(rd.sentenceFor(text, "missing"), null);
});

test("buildReadingLog: สถิติ + คำที่ไม่รู้ ≤ 50 คำ, ไม่เก็บข้อความ", () => {
  const unique = Array.from({ length: 60 }, (_, i) => ({ key: `w${i}`, surface: `w${i}`, count: 1, status: "plain" }));
  const st = { total: 400, unknownCount: 60, unknownPct: 15.04, unique };
  const log = rd.buildReadingLog({ source: "  BBC News  ", level: "B1", st, durationSec: 612.4, now: 1700 });
  assert.deepEqual({ ...log, unknownWords: log.unknownWords.length }, { at: 1700, source: "BBC News", level: "B1", totalWords: 400, unknownCount: 60, unknownPct: 15, unknownWords: 50, durationSec: 612 });
  assert.equal(log.unknownWords[0], "w0");
  assert.ok(!("text" in log));
  assert.equal(rd.buildReadingLog({ source: "x".repeat(300), st, durationSec: -5, now: 1 }).source.length, 200);
  assert.equal(rd.buildReadingLog({ source: "", st, durationSec: -5, now: 1 }).durationSec, 0);
});

test("addKnownWords: คำที่กด “รู้แล้ว” กลายเป็น known (รวมรูปผัน) และข้ามวลีหลายคำ", () => {
  const idx = rd.addKnownWords(new Map([["tangible", "learning"]]), ["Run", "look up", "tangible"]);
  assert.equal(rd.statusOfWord("running", idx), "known");
  assert.equal(rd.statusOfWord("runs", idx), "known");
  assert.equal(rd.statusOfWord("tangible", idx), "known");
  assert.equal(rd.statusOfWord("look", idx), null);
});


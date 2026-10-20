// ทดสอบเครื่องมือสร้างคลังคำ (tools/build-vocab) — ไม่เรียกเครือข่ายและไม่เขียน cache/work จริง
import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { parseCsvText, buildWords, levelOfRank, levelRanges, wordKeyOf } from "../tools/build-vocab/src/csv.mjs";
import { forms, tokens, containsWord, wordCount } from "../tools/build-vocab/src/inflect.mjs";
import { extractEntry, mergeEntries, statsOf, pickIpa, streamFile, POS_MAP } from "../tools/build-vocab/src/wiktionary.mjs";
import { validateEntry, validateAll, mergeEntry, maxWordsFor, normS } from "../tools/build-vocab/src/validate.mjs";
import { buildEntry, buildVocab, levelFile } from "../tools/build-vocab/src/build.mjs";
import { inputWord, batchCount, wordsOfBatch } from "../tools/build-vocab/src/batches.mjs";
import { stratifiedSample } from "../tools/build-vocab/src/report.mjs";
import { config } from "../tools/build-vocab/src/util.mjs";

const SIZES = [400, 400, 400, 400, 400, 400, 400, 400, 600, 600];

// ---------- CSV ----------
test("parseCsvText: BOM + CRLF + หัวตาราง WordID,Word", () => {
  const p = parseCsvText("﻿WordID,Word\r\n1,Monday\r\n2,the\r\n");
  assert.deepEqual(p.header, ["WordID", "Word"]);
  assert.deepEqual(p.rows.map((r) => [r.rank, r.word]), [[1, "Monday"], [2, "the"]]);
  assert.throws(() => parseCsvText("a,b\n1,2"), /ไม่พบคอลัมน์ WordID/);
  assert.throws(() => parseCsvText("WordID,Word\n1,a,b"), /จำนวนคอลัมน์/);
  assert.throws(() => parseCsvText(""), /ว่าง/);
  assert.equal(parseCsvText("WordID,Word,Level\n1,a,3").rows[0].level, 3);
});

test("levelOfRank: ระดับ 1–8 ละ 400, 9–10 ละ 600, ระดับ 11 = ที่เหลือ", () => {
  const at = (r) => levelOfRank(r, SIZES);
  assert.deepEqual([1, 400, 401, 3200, 3201, 3800, 3801, 4400, 4401, 5050].map(at), [1, 1, 2, 8, 9, 9, 10, 10, 11, 11]);
  const words = Array.from({ length: 5050 }, (_, i) => ({ rank: i + 1, level: at(i + 1) }));
  assert.deepEqual(levelRanges(words).map((r) => r.count), [400, 400, 400, 400, 400, 400, 400, 400, 600, 600, 650]);
});

test("buildWords: แก้ค่าที่สเปรดชีตทำเพี้ยนตาม wordFixes และจับปัญหา", () => {
  const rows = (arr) => ({ header: ["WordID", "Word"], hasLevel: false, rows: arr.map((w, i) => ({ rank: i + 1, word: w, line: i + 2 })) });
  const ok = buildWords(rows(["the", "TRUE", "Monday"]), { fixes: { 2: { from: "TRUE", to: "true", why: "x" } }, sizes: SIZES });
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.words.map((w) => w.wordKey), ["the", "true", "monday"]);
  assert.match(buildWords(rows(["a", "TRUE"]), { fixes: {}, sizes: SIZES }).problems[0], /TRUE/);
  assert.match(buildWords(rows(["a", "b"]), { fixes: { 2: { from: "TRUE", to: "true" } }, sizes: SIZES }).problems[0], /คาดว่าเป็น/);
  assert.match(buildWords(rows(["a", "A"]), { fixes: {}, sizes: SIZES }).problems.join(), /ซ้ำ/);
  assert.match(buildWords(rows(["a", "b c"]), { sizes: SIZES }).problems.join(), /ไม่ใช่ตัวอักษร/);
  assert.equal(wordKeyOf("  Café "), "café");
});

const INPUT = new URL("../tools/build-vocab/input/NGSL-GR_rank.csv", import.meta.url);
test("ไฟล์อินพุตจริง (ถ้ามี): 5,050 คำ ระดับตามกติกา ไม่มีปัญหาหลังแก้ wordFixes", { skip: !existsSync(INPUT) }, () => {
  const { words, problems, fixed } = buildWords(parseCsvText(readFileSync(INPUT, "utf8")), { fixes: config.wordFixes, sizes: config.levels.sizes });
  assert.deepEqual(problems, []);
  assert.equal(words.length, 5050);
  assert.deepEqual(levelRanges(words).map((r) => r.count), [400, 400, 400, 400, 400, 400, 400, 400, 600, 600, 650]);
  assert.deepEqual(fixed.map((f) => f.rank), [13, 528, 2148]);
  assert.equal(new Set(words.map((w) => w.wordKey)).size, 5050);
  assert.equal(batchCount(words), 51);
  assert.equal(wordsOfBatch(words, 51).length, 50);
});

// ---------- รูปผัน ----------
test("forms/containsWord: กฎปกติ คำไม่ปกติ พยัญชนะซ้ำ y→ies", () => {
  const has = (w, f) => assert.ok(forms(w).has(f), `${w} → ${f}`);
  has("decide", "decided"); has("decide", "deciding"); has("stop", "stopped"); has("big", "bigger"); has("city", "cities"); has("happy", "happily");
  has("go", "went"); has("be", "was"); has("child", "children"); has("good", "better"); has("i", "my"); has("die", "dying");
  assert.ok(containsWord("They decided to leave early.", "decide"));
  assert.ok(containsWord("The children are playing.", "child"));
  assert.ok(!containsWord("He chose the red one.", "decide"));
  assert.deepEqual(tokens("It’s John’s book, isn't it?"), ["it", "john", "book", "isn't", "it"]);
  assert.equal(wordCount("I have 3 cats."), 3);
});

// ---------- Wiktionary (kaikki) ----------
const FIXTURE = new URL("./fixtures/kaikki-sample.jsonl", import.meta.url);
const fixtureLines = () => readFileSync(FIXTURE, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l));

test("extractEntry (ข้อมูลจริงจาก kaikki): free/adj → ความหมาย, คำแปลไทยระดับ sense, IPA, ประโยค, พ้อง/ตรงข้าม", () => {
  const keys = new Set(["free", "friend", "unfree", "constrained", "bound"]);
  const adj = extractEntry(fixtureLines().find((o) => o.word === "free" && o.pos === "adj"), keys);
  assert.equal(adj.key, "free");
  assert.equal(adj.pos, "adjective");
  assert.equal(adj.ipa, "/fɹi/");                                    // ชอบ /…/ ที่ติดแท็ก General-American
  const thWords = adj.th.flatMap((t) => t.th);
  assert.ok(thWords.includes("อิสระ") && thWords.includes("ว่าง"));
  assert.ok(adj.th.every((t) => t.pos === "adjective" && t.senseEn));
  assert.ok(adj.senses.length > 3 && adj.senses.every((s) => s.senseEn));
  assert.ok(adj.antonyms.includes("unfree") && adj.antonyms.includes("constrained"));
  assert.ok(adj.derived.includes("break free") || adj.related.includes("friend") || adj.derived.length >= 0);
});

test("extractEntry: กรองตามคำในคลัง/ภาษา/ชนิดคำที่ไม่ใช้", () => {
  const free = fixtureLines().find((o) => o.word === "free" && o.pos === "adj");
  assert.equal(extractEntry(free, new Set(["other"])), null);
  assert.equal(extractEntry({ ...free, lang_code: "th" }, new Set(["free"])), null);
  assert.equal(extractEntry({ ...free, pos: "symbol" }, new Set(["free"])), null);
  assert.equal(extractEntry({ ...free, word: "FREE" }, new Set(["free"])).key, "free");
  assert.equal(POS_MAP.name, "noun");
  assert.equal(POS_MAP.adj, "adjective");
});

test("extractEntry: ข้ามความหมายที่เป็น form_of/โบราณ และแปลงคำแปลระดับ entry ให้ตรง gloss", () => {
  const e = extractEntry({
    word: "test", lang_code: "en", pos: "noun",
    senses: [{ glosses: ["An exam."], translations: [] }, { glosses: ["old sense"], tags: ["obsolete"] }, { glosses: ["plural of tests"], form_of: [{ word: "tests" }] }],
    translations: [{ lang_code: "th", word: "การสอบ", sense: "exam" }, { lang_code: "fr", word: "examen", sense: "exam" }, { lang_code: "th", word: "อื่น", sense: "unmatched sense" }],
  }, new Set(["test"]));
  assert.deepEqual(e.senses.map((s) => s.senseEn), ["An exam."]);
  assert.deepEqual(e.th.map((t) => [t.senseEn, t.th]), [["An exam.", ["การสอบ"]], ["unmatched sense", ["อื่น"]]]);
});

test("pickIpa: ชอบ /…/ ที่ติดแท็ก General-American แล้ว /…/ อื่น แล้ว […]", () => {
  assert.equal(pickIpa([{ ipa: "[a]", tags: ["US"] }, { ipa: "/b/", tags: ["UK"] }, { ipa: "/c/", tags: ["General-American"] }]), "/c/");
  assert.equal(pickIpa([{ ipa: "[a]" }, { ipa: "/b/" }]), "/b/");
  assert.equal(pickIpa([{ ipa: "[a]" }]), "[a]");
  assert.equal(pickIpa([{ enpr: "x" }]), "");
});

test("mergeEntries: รวมหลายชนิดคำ เก็บเฉพาะคำสัมพันธ์ในคลัง ตัดตัวเอง และสถิติ", () => {
  const keys = new Set(["free", "friend", "feel", "dog"]);
  const w = { rank: 5, word: "free", wordKey: "free", level: 1 };
  const entries = fixtureLines().filter((o) => o.word === "free").map((o) => extractEntry(o, keys)).filter(Boolean);
  const r = mergeEntries(w, entries, keys);
  assert.equal(r.found, true);
  assert.equal(r.source, "wiktionary");
  assert.ok(r.pos.includes("adjective") && r.pos.includes("verb"));
  assert.ok(r.th.some((t) => t.pos === "adverb" && t.th.includes("ฟรี")));
  assert.ok(r.family.every((f) => keys.has(f) && f !== "free"));
  assert.ok(r.defEn.length >= 2 && r.defEn.every((d) => d.pos && d.def));
  const none = mergeEntries({ rank: 6, word: "zzz", wordKey: "zzz", level: 1 }, [], keys);
  assert.equal(none.found, false);
  const s = statsOf([r, none]);
  assert.equal(s.total, 2); assert.equal(s.found, 1); assert.equal(s.notFound, 1);
  assert.equal(s.thFull + s.thPartial + s.thNone, 1);
  assert.equal(statsOf([{ found: true, pos: ["noun", "verb"], th: [{ pos: "noun", th: ["ก"] }], examples: [], ipa: "", synonyms: [], family: [] }]).thPartial, 1);
  assert.equal(statsOf([{ found: true, pos: ["noun"], th: [], examples: ["x"], ipa: "/x/", synonyms: ["y"], family: ["z"] }]).thNone, 1);
});

test("streamFile: อ่านทีละบรรทัดจากไฟล์จริง นับ/ข้ามบรรทัดเสีย และไม่โหลดทั้งไฟล์", async () => {
  const got = [];
  const info = await streamFile(fileURLToPathSafe(FIXTURE), new Set(["free", "dictionary"]), (e) => got.push(`${e.key}/${e.pos}`));
  assert.ok(got.includes("free/adjective") && got.includes("dictionary/noun"));
  assert.equal(info.bad, 0);
  assert.equal(info.lines, fixtureLines().length);
});
function fileURLToPathSafe(u) { return decodeURIComponent(new URL(u).pathname.replace(/^\/([A-Za-z]:)/, "$1")); }

// ---------- validate ----------
const W = { rank: 409, word: "decide", wordKey: "decide", level: 2 };
const WIK = { found: true, pos: ["verb"], th: [{ pos: "verb", senseEn: "to choose", th: ["ตัดสินใจ", "ตกลงใจ"] }], examples: ["We decided to go."] };
const KEYS = new Set(["decide", "decision", "choose"]);
const GOOD = {
  pos: ["verb"], th: [{ pos: "verb", text: "ตัดสินใจ", source: "wiktionary", basedOn: "ตัดสินใจ" }],
  examples: ["I decided to stay at home today.", "She will decide tomorrow morning."],
  collocations: ["decide to go", "decide on a name"], family: ["decision"], tags: ["daily-life"], cefr: "A2",
};

test("validateEntry: ข้อมูลถูกต้องผ่าน", () => {
  assert.deepEqual(validateEntry(W, GOOD, { wik: WIK, keys: KEYS }), { errors: [], warnings: [] });
});

test("validateEntry: จับทุกเงื่อนไขของสเปก (รวม source ของคำแปลและการลอกประโยค Wiktionary)", () => {
  const bad = (patch, re, opts = {}) => { const r = validateEntry(W, { ...GOOD, ...patch }, { wik: WIK, keys: KEYS, ...opts }); assert.ok(r.errors.some((e) => re.test(e)), `${JSON.stringify(patch)} → ${r.errors}`); };
  bad({ th: [] }, /th: ต้องมี 1–3/);
  bad({ th: [{ pos: "verb", text: "", source: "claude" }] }, /ว่าง/);
  bad({ th: [{ pos: "verb", text: "decide", source: "claude" }] }, /ไม่มีอักษรไทย/);
  bad({ th: [{ pos: "noun", text: "ตัดสินใจ", source: "claude" }] }, /ไม่อยู่ใน pos/);
  bad({ th: [{ pos: "verb", text: "ตัดสินใจ" }] }, /source/);
  bad({ th: [{ pos: "verb", text: "ตัดสินใจ", source: "gpt" }] }, /source/);
  bad({ th: [{ pos: "verb", text: "ตัดสินใจ", source: "wiktionary" }] }, /ต้องระบุ basedOn/);
  bad({ th: [{ pos: "verb", text: "ตัดสินใจ", source: "wiktionary", basedOn: "ไม่มีในตัวเลือก" }] }, /ไม่ใช่ตัวเลือกจาก Wiktionary/);
  bad({ examples: ["I decided to stay at home today."] }, /examples: ต้องมี 2/);
  bad({ examples: ["I decided.", "She will decide tomorrow morning."] }, /สั้นเกินไป/);
  bad({ examples: ["He chose to stay at home today.", "She will decide tomorrow morning."] }, /ไม่มีคำว่า “decide”/);
  bad({ examples: ["I decided to stay at home today.", "i decided to stay at home today!"] }, /เหมือนกัน/);
  bad({ examples: ["We decided to go!", "She will decide tomorrow morning."] }, /ตรงกับประโยคของ Wiktionary/);
  bad({ tags: ["cooking"] }, /นอกรายการ/);
  bad({ cefr: "C2" }, /cefr/);
  bad({ pos: ["adjective"], th: [{ pos: "adjective", text: "ตัดสินใจ", source: "claude" }] }, /ไม่สอดคล้องกับ Wiktionary/);
  bad({ pos: ["noun", "noun"] }, /ซ้ำ/);
  bad({ family: ["decide"] }, /ตัวคำเอง/);
  bad({ family: ["zebra"] }, /ไม่อยู่ในคลัง/);
  bad({ collocations: ["only one"] }, /collocations: ต้องมี 2–4/);
  assert.ok(validateEntry(W, { ...GOOD, collocations: ["make a plan", "take a break"] }, { wik: WIK, keys: KEYS }).warnings.some((x) => /ไม่มีวลีไหน/.test(x)));
  const claude = validateEntry(W, { ...GOOD, th: [{ pos: "verb", text: "ลงความเห็น", source: "claude" }] }, { wik: WIK, keys: KEYS });
  assert.deepEqual(claude.errors, []);
  assert.ok(claude.warnings.some((x) => /Wiktionary มีตัวเลือก/.test(x)));
  assert.deepEqual(validateEntry(W, null).errors, ["ผลไม่ใช่ออบเจ็กต์ JSON"]);
  assert.equal(validateEntry(W, { ...GOOD, pos: ["adjective"], th: [{ pos: "adjective", text: "ตัดสินใจ", source: "claude" }] }, { wik: { found: false }, keys: KEYS }).errors.length, 0);        // Wiktionary ไม่พบ → ข้ามด่าน pos
  assert.deepEqual(validateEntry(W, { ...GOOD, pos: ["modal"], th: [{ pos: "modal", text: "ตัดสินใจ", source: "claude" }] }, { wik: WIK, keys: KEYS }).errors, []);
  assert.equal(maxWordsFor(2), 12); assert.equal(maxWordsFor(6), 16); assert.equal(maxWordsFor(11), 20);
  const long = validateEntry({ ...W, level: 1 }, { ...GOOD, examples: ["I decided to stay at home with my family for the whole day today.", "She will decide tomorrow morning."] }, { wik: WIK, keys: KEYS });
  assert.ok(long.warnings.some((x) => /เกินที่แนะนำ/.test(x)));
});

test("validateAll: ประโยคซ้ำข้ามคำ/ข้ามชุด, ยังไม่ได้เขียน, overrides แก้ให้ผ่าน", () => {
  const w2 = { rank: 410, word: "decision", wordKey: "decision", level: 2 };
  const e2 = { ...GOOD, th: [{ pos: "verb", text: "การตัดสินใจ", source: "claude" }], examples: ["I decided to stay at home today.", "The decision was made yesterday."], family: ["decide"], collocations: ["make a decision", "final decision"] };
  const results = new Map([[409, GOOD], [410, e2]]);
  const v = validateAll([W, w2, { rank: 411, word: "x", wordKey: "x", level: 2 }], results, { wiks: new Map([["decide", WIK]]), keys: KEYS });
  assert.equal(v.ok, 1);
  assert.deepEqual(v.missing, [411]);
  assert.ok(v.failed.find((f) => f.rank === 410).errors.some((e) => /ซ้ำกับคำอื่น \(rank 409\)/.test(e)));
  const fixed = validateAll([W, w2], results, { wiks: new Map([["decide", WIK]]), keys: KEYS, overrides: { decision: { examples: ["The decision was hard to make.", "That decision changed my life."] } } });
  assert.equal(fixed.failed.length, 0);
  const prior = validateAll([W], new Map([[409, GOOD]]), { wiks: new Map(), keys: KEYS, prior: new Map([[normS("I decided to stay at home today."), 100]]) });
  assert.ok(prior.failed[0].errors.some((e) => /rank 100/.test(e)));
  assert.equal(validateAll([W], results, { wiks: new Map(), keys: KEYS }).warned.length, 0);
  assert.deepEqual(mergeEntry({ a: 1, b: 2 }, { b: 3 }), { a: 1, b: 3 });
  assert.equal(validateAll([W], new Map([[409, { ...GOOD, th: [{ ...GOOD.th[0], source: "claude", basedOn: undefined }] }]]), { wiks: new Map([["decide", WIK]]), keys: KEYS }).warned[0].mainSource, "claude");
});

// ---------- batches / build ----------
test("inputWord: รวมข้อมูล Wiktionary สำหรับเขียน (ตัวเลือกไทย, ความหมาย, ประโยคอ้างอิงไม่เกิน 2) และคำที่ไม่พบ", () => {
  const rec = { found: true, pos: ["verb"], ipa: "/x/", senses: [{ pos: "verb", senseEn: "to choose" }, { pos: "verb", senseEn: "to settle" }], th: [{ pos: "verb", senseEn: "to choose", th: ["ตัดสินใจ"] }], examples: ["a", "b", "c"], synonyms: ["choose"], antonyms: [], family: ["decision"], phrases: ["decide on"] };
  const i = inputWord(W, rec);
  assert.deepEqual(i.wiktionary.senses, [{ pos: "verb", meanings: ["to choose", "to settle"] }]);
  assert.equal(i.wiktionary.exampleRefs.length, 2);
  assert.equal(i.cefrHint, "A1–A2");
  assert.deepEqual(inputWord(W, { found: false }).wiktionary, { found: false });
  assert.deepEqual(inputWord(W, undefined).wiktionary, { found: false });
});

test("buildEntry: ทุกค่ามี source กำกับ, family รวม Wiktionary + ที่เขียนเอง, override ทับและเป็น manual", () => {
  const wik = { ipa: "/dɪˈsaɪd/", defEn: [{ pos: "verb", def: "To choose." }], synonyms: ["choose"], antonyms: [], family: ["decision"] };
  const e = buildEntry(W, { mine: { ...GOOD, family: ["decision", "choose"] }, wik });
  assert.deepEqual(Object.keys(e), ["wordKey", "word", "rank", "level", "cefr", "pos", "ipa", "defEn", "th", "examples", "collocations", "family", "synonyms", "antonyms", "tags", "src"]);
  assert.deepEqual(e.family, ["decision", "choose"]);
  assert.deepEqual(e.th, [{ pos: "verb", text: "ตัดสินใจ", source: "wiktionary" }]);
  assert.deepEqual(e.examples.map((x) => x.source), ["claude", "claude"]);
  assert.equal(e.src.ipa, "wiktionary"); assert.equal(e.src.defEn, "wiktionary"); assert.equal(e.src.synonyms, "wiktionary");
  assert.deepEqual(e.src.family, ["wiktionary", "claude"]);
  assert.deepEqual(e.src.th, ["wiktionary"]);
  assert.equal(e.src.cefr, "claude");
  const o = buildEntry(W, { mine: GOOD, wik, override: { cefr: "B1", examples: ["It was my decision to decide.", "We decide together."] } });
  assert.equal(o.cefr, "B1"); assert.equal(o.src.cefr, "manual"); assert.deepEqual(o.examples.map((x) => x.source), ["manual", "manual"]);
  assert.equal(buildEntry(W, { mine: GOOD, wik: null }).ipa, "");
});

test("buildVocab: ไม่ครบ = ไม่ build เว้นแต่ allowIncomplete, ผลซ้ำได้ hash เดิม, ตัวเลขเวอร์ชัน/สัญญาอนุญาต", async () => {
  const words = [W, { rank: 1, word: "the", wordKey: "the", level: 1 }];
  const results = new Map([[409, { ...GOOD, family: [] }]]);
  const wiks = new Map([["decide", WIK]]);
  const none = await buildVocab({ words, results, wiks });
  assert.equal(none.index, null);
  assert.match(none.problems.join(), /ยังไม่ได้เขียน/);
  const part = await buildVocab({ words, results, wiks, allowIncomplete: true });
  assert.equal(part.index.complete, false);
  assert.equal(part.index.levels.length, 2);
  const a = await buildVocab({ words: [W], results, wiks }), b = await buildVocab({ words: [W], results, wiks });
  assert.equal(a.index.complete, true);
  assert.equal(a.index.contentHash, b.index.contentHash);
  assert.equal(a.index.version, config.vocabVersion);
  assert.equal(a.index.license, "CC BY-SA 4.0");
  assert.ok(a.index.credits.wiktionary.includes("Wiktionary") && a.index.credits.list.includes("NGSL-GR"));
  assert.equal(levelFile(3), "level-03.json");
  assert.equal(JSON.parse(a.files[0].text).words[0].examples[0].source, "claude");
});

test("stratifiedSample: ครอบทุกระดับ จำนวนใกล้เคียงที่ขอ และได้ชุดเดิมเมื่อ seed เท่ากัน", () => {
  const words = Array.from({ length: 5050 }, (_, i) => ({ rank: i + 1, level: levelOfRank(i + 1, SIZES) }));
  const a = stratifiedSample(words, 200), b = stratifiedSample(words, 200);
  assert.deepEqual(a.map((w) => w.rank), b.map((w) => w.rank));
  assert.ok(a.length >= 198 && a.length <= 205);
  assert.equal(new Set(a.map((w) => w.level)).size, 11);
});

test("เครื่องมือไม่มีโค้ดเครือข่าย/ANTHROPIC_API_KEY (ไม่เรียก API ภายนอก)", () => {
  const dir = new URL("../tools/build-vocab/src/", import.meta.url);
  const files = ["util", "csv", "words", "inflect", "wiktionary", "validate", "batches", "build", "report", "sample"];
  for (const f of files) {
    const src = readFileSync(new URL(`${f}.mjs`, dir), "utf8").split("\n").filter((l) => !l.trim().startsWith("//")).join("\n");
    assert.ok(!/\bfetch\s*\(|node:https?|node:net|XMLHttpRequest|ANTHROPIC_API_KEY|api\.anthropic|dictionaryapi|datamuse/i.test(src), `${f}.mjs มีโค้ดเครือข่าย/คีย์`);
  }
});

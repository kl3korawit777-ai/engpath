// รัน: node --test tests/lexicon.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as lx from "../js/lexicon.js";

const NOW = 1_800_000_000_000;
const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });
const routeFetch = (routes) => async (url) => {
  for (const [needle, handler] of routes) if (String(url).includes(needle)) return typeof handler === "function" ? handler(url) : handler;
  throw new Error("no route for " + url);
};
const neverFetch = (url, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));

test("wordKey: ตัวพิมพ์เล็ก ตัดหัวท้าย ช่องว่างซ้อน และ / ปลอดภัยกับ doc id", () => {
  assert.equal(lx.wordKey("  Look   AFTER  "), "look after");
  assert.equal(lx.wordKey("and/or"), "and or");
  assert.equal(lx.wordKey("Don't"), "don't");
  assert.equal(lx.wordKey(null), "");
  assert.equal(lx.wordKey("a\t b\n c"), "a b c");
});

test("isValidWord", () => {
  for (const ok of ["hello", "look after", "well-known", "don't", "U.S.", "2nd"]) assert.ok(lx.isValidWord(ok), ok);
  for (const bad of ["", "   ", ".hidden", "__x__", "a".repeat(81), "hello<script>", "-x"]) assert.ok(!lx.isValidWord(bad), bad);
});

test("fetchDictionary: รวมตามชนิดคำ, IPA, เสียง (เติม https), ตัวอย่าง; 404 = null", async () => {
  const f = routeFetch([["dictionaryapi", json([{
    word: "run", phonetic: "/rʌn/",
    phonetics: [{ text: "/rʌn/" }, { text: "/rʌn/", audio: "//ssl.gstatic.com/x.mp3" }],
    meanings: [
      { partOfSpeech: "verb", definitions: [{ definition: "move fast", example: "I run daily." }, { definition: "operate" }] },
      { partOfSpeech: "noun", definitions: [{ definition: "a jog", example: "Go for a run." }] },
    ],
  }])]]);
  const d = await lx.fetchDictionary("run", { fetchImpl: f });
  assert.equal(d.ipa, "/rʌn/");
  assert.equal(d.audioUrl, "https://ssl.gstatic.com/x.mp3");
  assert.deepEqual(d.meanings.map((m) => m.pos), ["verb", "noun"]);
  assert.deepEqual(d.examples, ["I run daily.", "Go for a run."]);
  assert.equal(await lx.fetchDictionary("zzzz", { fetchImpl: routeFetch([["dictionaryapi", json({ title: "No Definitions Found" }, 404)]]) }), null);
});

test("fetchDatamuse: freq + ชนิดคำ + คำที่เกี่ยวข้อง; ล้มบางส่วนยังได้ส่วนที่เหลือ; ล้มหมด = โยน error", async () => {
  const f = routeFetch([
    ["sp=", json([{ word: "happy", tags: ["adj", "f:25.5"] }])],
    ["rel_syn", json([{ word: "glad" }, { word: "joyful" }])],
    ["rel_ant", json([{ word: "sad" }])],
    ["rel_trg", () => { throw new Error("boom"); }],
    ["rel_jjb", json([], 500)],
  ]);
  const d = await lx.fetchDatamuse("happy", { fetchImpl: f });
  assert.equal(d.freq, 25.5);
  assert.deepEqual(d.posTags, ["adjective"]);
  assert.deepEqual(d.related, { syn: ["glad", "joyful"], ant: ["sad"], trg: [], jjb: [] });
  await assert.rejects(lx.fetchDatamuse("x", { fetchImpl: async () => { throw new Error("down"); } }), (e) => e.kind === "network");
});

test("fetchMyMemory: แปลได้ / ส่งคำเดิมกลับ = ไม่ได้แปล / โควตาหมด / ใส่อีเมลเป็น de=", async () => {
  let seen;
  const ok = routeFetch([["mymemory", (u) => { seen = u; return json({ responseStatus: 200, responseData: { translatedText: "สวัสดี" }, matches: [{ translation: "สวัสดี" }, { translation: "ว่าไง" }] }); }]]);
  const r = await lx.fetchMyMemory("hello", { fetchImpl: ok, email: "a@b.co" });
  assert.deepEqual(r.th, [{ sense: "", text: "สวัสดี" }, { sense: "ทางเลือก", text: "ว่าไง" }]);
  assert.match(seen, /langpair=en%7Cth/);
  assert.match(seen, /de=a%40b\.co/);
  const same = routeFetch([["mymemory", json({ responseStatus: 200, responseData: { translatedText: "Xyzzy" } })]]);
  assert.deepEqual((await lx.fetchMyMemory("xyzzy", { fetchImpl: same })).th, []);
  const quota = routeFetch([["mymemory", json({ quotaFinished: true, responseStatus: 429, responseData: {} })]]);
  await assert.rejects(lx.fetchMyMemory("a", { fetchImpl: quota }), (e) => e.kind === "quota");
});

test("timeout: API ที่ค้างถูกตัดและให้ข้อความไทย ไม่ลากตัวอื่นล่ม", async () => {
  const t0 = Date.now();
  const f = async (url, init) => (String(url).includes("dictionaryapi") ? neverFetch(url, init)
    : String(url).includes("datamuse") ? json([{ word: "a", tags: ["n", "f:1"] }])
    : json({ responseStatus: 200, responseData: { translatedText: "เอ" } }));
  const r = await lx.fetchAll("a", { fetchImpl: f, timeout: 50 });
  assert.ok(Date.now() - t0 < 1500);
  assert.equal(r.dictionary.ok, false);
  assert.match(r.dictionary.error, /Free Dictionary.*ไม่ตอบกลับ/);
  assert.equal(r.datamuse.ok, true);
  assert.equal(r.mymemory.data.th[0].text, "เอ");
  assert.equal("ai" in r, false);
});

test("describeError: ทุกกรณีเป็นภาษาไทยและบอกวิธีแก้", () => {
  const E = (api, kind, status) => lx.describeError(new lx.ApiError(api, kind, { status }));
  assert.match(E("mymemory", "quota"), /ตั้งอีเมล/);
  assert.match(E("ai", "auth"), /API key.*ตั้งค่า/);
  assert.match(E("ai", "http", 404), /ชื่อรุ่น/);
  assert.match(E("ai", "http", 429), /429/);
  assert.match(E("dictionary", "network"), /อินเทอร์เน็ต/);
  assert.match(E("dictionary", "http", 503), /ขัดข้อง/);
  assert.match(lx.describeError(new Error("x")), /ไม่คาดคิด/);
});

test("fetchAi: ส่ง header ที่จำเป็น, อ่านเฉพาะ text block, กรองตัวอย่างที่สั้น/ไม่มีวลี", async () => {
  let req;
  const f = async (url, init) => {
    req = { url, init };
    return json({ content: [{ type: "thinking", thinking: "..." }, { type: "text", text: 'Sure:\n{"th":[{"sense":"ดูแล","text":"ดูแล"}],"examples":["She looks after her mother every day.","Look after."],"tags":["Daily-Life","bad tag!"]}' }] });
  };
  const r = await lx.fetchAi("look after", { apiKey: "k", model: "m1", fetchImpl: f });
  assert.equal(req.url, lx.CLAUDE_URL);
  assert.equal(req.init.headers["x-api-key"], "k");
  assert.equal(req.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(req.init.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(JSON.parse(req.init.body).model, "m1");
  assert.deepEqual(r.examples, ["She looks after her mother every day."]);   // "Look after." สั้นเกินไป ถูกตัดทิ้ง
  assert.deepEqual(r.th, [{ sense: "ดูแล", text: "ดูแล" }]);
  assert.deepEqual(r.tags, ["daily-life"]);
  assert.equal(r.examples.every((e) => lx.wordCount(e) >= 4), true);
  await assert.rejects(lx.fetchAi("x", { apiKey: "", fetchImpl: f }), (e) => e.kind === "auth");
  await assert.rejects(lx.fetchAi("x", { apiKey: "bad", fetchImpl: async () => json({ error: { message: "invalid x-api-key" } }, 401) }), (e) => e.kind === "auth");
  await assert.rejects(lx.fetchAi("x", { apiKey: "k", fetchImpl: async () => json({ content: [{ type: "text", text: "no json here" }] }) }), (e) => e.kind === "parse");
});

const ok = (data) => ({ ok: true, data });
const bad = (msg) => ({ ok: false, error: msg });

test("mergeLexicon: ข้อมูลใหม่ครบ + sources + fetchedAt", () => {
  const doc = lx.mergeLexicon(null, {
    dictionary: ok({ ipa: "/a/", audioUrl: "u", meanings: [{ pos: "noun", definitions: [] }], examples: ["An apple a day."] }),
    datamuse: ok({ freq: 3, posTags: ["noun"], related: { syn: [], ant: [], trg: ["tree"], jjb: [] } }),
    mymemory: ok({ th: [{ sense: "", text: "แอปเปิล" }] }),
  }, { word: "apple", now: NOW });
  assert.equal(doc.thSource, "mymemory");
  assert.equal(doc.freq, 3);
  assert.equal(doc.fetchedAt, NOW);
  assert.deepEqual(Object.keys(doc.sources).sort(), ["dictionary", "datamuse", "mymemory"].sort());
  assert.equal(lx.suggestPos(doc), "noun");
  assert.equal(lx.thDisplay(doc.th), "แอปเปิล");
});

test("mergeLexicon: userEdited ห้ามถูก API เขียนทับคำแปล (แต่ส่วนอื่นอัปเดตได้)", () => {
  const existing = { word: "x", th: [{ sense: "", text: "ของฉันเอง" }], thSource: "user", userEdited: true, ipa: "/old/", sources: {} };
  const doc = lx.mergeLexicon(existing, {
    mymemory: ok({ th: [{ sense: "", text: "จาก API" }] }),
    ai: ok({ th: [{ sense: "", text: "จาก AI" }], examples: ["This is a fine example."], tags: ["a/b"] }),
    dictionary: ok({ ipa: "/new/", audioUrl: "", meanings: [], examples: [] }),
  }, { word: "x", now: NOW });
  assert.equal(doc.th[0].text, "ของฉันเอง");
  assert.equal(doc.thSource, "user");
  assert.equal(doc.userEdited, true);
  assert.equal(doc.ipa, "/new/");
  assert.deepEqual(doc.suggestedTags, ["a/b"]);
});

test("mergeLexicon: คำแปลจาก AI ไม่ถูก MyMemory ทับตอนแปลใหม่", () => {
  const existing = { word: "x", th: [{ sense: "s", text: "จาก AI" }], thSource: "ai", sources: {} };
  const doc = lx.mergeLexicon(existing, { mymemory: ok({ th: [{ sense: "", text: "จาก MM" }] }) }, { word: "x", now: NOW });
  assert.equal(doc.th[0].text, "จาก AI");
});

test("mergeLexicon: แหล่งล้มเหลว → คงข้อมูลเดิม และบันทึกเหตุผลใน sources", () => {
  const existing = { word: "x", ipa: "/keep/", meanings: [{ pos: "verb", definitions: [] }], freq: 9, sources: { dictionary: { ok: true, at: 1 } }, fetchedAt: 1 };
  const doc = lx.mergeLexicon(existing, { dictionary: bad("ล่ม"), datamuse: bad("ล่ม2") }, { word: "x", now: NOW });
  assert.equal(doc.ipa, "/keep/");
  assert.equal(doc.freq, 9);
  assert.deepEqual(doc.sources.dictionary, { ok: false, at: NOW, error: "ล่ม" });
  assert.equal(doc.fetchedAt, 1);            // ไม่มีแหล่งไหนสำเร็จ → ไม่ขยับเวลา
});

test("mergeLexicon: พจนานุกรมไม่พบคำ (null) ไม่ใช่ error", () => {
  const doc = lx.mergeLexicon(null, { dictionary: ok(null) }, { word: "look after", now: NOW });
  assert.deepEqual(doc.sources.dictionary, { ok: true, at: NOW, note: "notFound" });
  assert.equal(lx.suggestPos(doc), "phrase");
});

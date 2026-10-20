import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { createVocab, wordKey, describeError, VocabError, TAGS } from "../js/vocab.js";

const root = new URL("../vocab/", import.meta.url);
let fetched = [];
const fsFetch = async (url) => {
  fetched.push(url);
  const file = url.replace(/^vocab\//, "");
  try {
    const text = await readFile(new URL(file, root), "utf8");
    return { ok: true, status: 200, json: async () => JSON.parse(text) };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};
const make = () => { fetched = []; return createVocab({ baseUrl: "vocab/", fetchImpl: fsFetch }); };

test("wordKey: ตัวพิมพ์เล็ก ตัดช่องว่าง และกัน / ใน doc id", () => {
  assert.equal(wordKey("  Look   UP "), "look up");
  assert.equal(wordKey("and/or"), "and or");
  assert.equal(wordKey(null), "");
});

test("loadIndex: อ่าน index จริง 5,050 คำ 11 ระดับ และ cache ไว้ (ไม่ fetch ซ้ำ)", async () => {
  const v = make();
  const [a, b] = await Promise.all([v.loadIndex(), v.loadIndex()]);
  assert.equal(a, b);
  assert.equal(a.count, 5050);
  assert.equal(await v.levelCount(), 11);
  await v.loadIndex();
  assert.equal(fetched.length, 1);
});

test("wordsOfLevel: โหลดเฉพาะระดับที่ขอ, rank ต่อเนื่องตรงกับ index, โหลดซ้ำไม่ fetch", async () => {
  const v = make();
  const idx = await v.loadIndex();
  const w = await v.wordsOfLevel(2);
  const meta = idx.levels.find((l) => l.level === 2);
  assert.equal(w.length, meta.count);
  assert.equal(w[0].rank, meta.rankFrom);
  assert.equal(w.at(-1).rank, meta.rankTo);
  assert.ok(w.every((x, i) => i === 0 || x.rank === w[i - 1].rank + 1));
  const n = fetched.length;
  await v.wordsOfLevel(2);
  assert.equal(fetched.length, n);
  assert.deepEqual(fetched.filter((u) => u.startsWith("vocab/level")), ["vocab/level-02.json"]);
});

test("get: หาข้ามระดับด้วย wordKey (ไม่สนตัวพิมพ์/ช่องว่าง) และ peek ไม่โหลดเพิ่ม", async () => {
  const v = make();
  assert.equal(v.peek("monday"), null);
  const m = await v.get("  MONDAY ");
  assert.equal(m.word, "Monday");
  assert.equal(m.rank, 1);
  assert.equal(v.peek("monday").rank, 1);
  const far = await v.get("assertion");      // อยู่ท้าย ๆ ของคลัง
  assert.equal(far.wordKey, "assertion");
  assert.ok(far.rank > 4000);
  assert.equal(await v.get("zzzznotaword"), null);
  assert.equal(await v.get(""), null);
});

test("levelOfRank: ขอบเขตของแต่ละระดับ", async () => {
  const v = make();
  assert.equal(await v.levelOfRank(1), 1);
  assert.equal(await v.levelOfRank(400), 1);
  assert.equal(await v.levelOfRank(401), 2);
  assert.equal(await v.levelOfRank(5050), 11);
  assert.equal(await v.levelOfRank(0), null);
  assert.equal(await v.levelOfRank(5051), null);
});

test("query: กรองด้วยแท็ก/CEFR/ข้อความ และเรียงตาม rank", async () => {
  const v = make();
  const food = await v.query({ levels: [1, 2], tags: ["health"] });
  assert.ok(food.length > 0);
  assert.ok(food.every((w) => w.tags.includes("health")));
  assert.ok(food.every((w, i) => i === 0 || w.rank > food[i - 1].rank));
  const a1 = await v.query({ levels: [1], cefr: ["A1"] });
  assert.ok(a1.every((w) => w.cefr === "A1"));
  const found = await v.query({ levels: [1], text: "monday" });
  assert.equal(found[0].wordKey, "monday");
  const thai = await v.query({ levels: [1], text: "วันจันทร์" });
  assert.ok(thai.some((w) => w.wordKey === "monday"));
});

test("ทุกคำในคลังจริง: schema ครบ, wordKey ไม่ซ้ำ, แท็กอยู่ในรายการ, ตัวอย่าง 2 ประโยค", async () => {
  const v = make();
  await v.loadAll();
  const all = await v.query();
  assert.equal(all.length, 5050);
  assert.equal(new Set(all.map((w) => w.wordKey)).size, 5050);
  for (const w of all) {
    assert.equal(w.wordKey, wordKey(w.word));
    assert.ok(w.th.length >= 1 && w.examples.length === 2 && w.tags.length >= 1, w.word);
    assert.ok(w.tags.every((t) => TAGS.includes(t)), w.word);
  }
});

test("credits: มีเครดิตและสัญญาอนุญาต CC BY-SA 4.0", async () => {
  const c = await make().credits();
  assert.match(c.license, /CC BY-SA 4\.0/);
  assert.match(c.credits.list, /NGSL/);
  assert.match(c.credits.wiktionary, /Wiktionary/);
  assert.ok(c.credits.claude);
});

test("ข้อผิดพลาด: network / http / parse / schema มีข้อความไทยและไม่ค้างสถานะ", async () => {
  const net = createVocab({ baseUrl: "vocab/", fetchImpl: async () => { throw new Error("x"); } });
  await assert.rejects(net.loadIndex(), (e) => e instanceof VocabError && e.kind === "network");
  const http = createVocab({ baseUrl: "vocab/", fetchImpl: async () => ({ ok: false, status: 404 }) });
  await assert.rejects(http.loadIndex(), (e) => e.kind === "http");
  const parse = createVocab({ baseUrl: "vocab/", fetchImpl: async () => ({ ok: true, json: async () => { throw new Error("bad"); } }) });
  await assert.rejects(parse.loadIndex(), (e) => e.kind === "parse");
  const schema = createVocab({ baseUrl: "vocab/", fetchImpl: async () => ({ ok: true, json: async () => ({ schema: 99, levels: [{}] }) }) });
  await assert.rejects(schema.loadIndex(), (e) => e.kind === "schema");
  for (const k of ["network", "http", "parse", "schema"]) assert.match(describeError(new VocabError(k, "x")), /[ก-๙]/);
  // ล้มเหลวแล้วลองใหม่ได้ (ไม่ cache ความล้มเหลว)
  let ok = false;
  const flaky = createVocab({ baseUrl: "vocab/", fetchImpl: async (u) => (ok ? fsFetch(u) : Promise.reject(new Error("off"))) });
  await assert.rejects(flaky.loadIndex());
  ok = true;
  assert.equal((await flaky.loadIndex()).count, 5050);
});

import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { lexiconFromEntry, familiesFromEntries } from "../js/libentry.js";
import { levelProgress } from "../js/dashboardlogic.js";
import { buildGraph } from "../js/graph.js";

const idx = JSON.parse(readFileSync(new URL("../vocab/index.json", import.meta.url), "utf8"));
const words = idx.levels.flatMap((l) => JSON.parse(readFileSync(new URL(`../vocab/${l.file}`, import.meta.url), "utf8")).words);
const byKey = new Map(words.map((w) => [w.wordKey, w]));

test("lexiconFromEntry: รูปเอกสารที่กราฟ/vault ใช้ได้ (ความหมาย ไทย ตัวอย่าง related)", () => {
  const l = lexiconFromEntry(byKey.get("monday"));
  assert.equal(l.word, "Monday");
  assert.equal(l.th[0].text, "วันจันทร์");
  assert.ok(l.meanings[0].definitions[0].en);
  assert.equal(l.examples.length, 2);
  assert.deepEqual(Object.keys(l.related).sort(), ["ant", "jjb", "syn", "trg"]);
  assert.equal(l.vocabLevel, 1);
  assert.equal(lexiconFromEntry(null), null);
});

test("familiesFromEntries: ไม่ซ้ำ ยืนยันแล้ว และสมาชิก ≥ 2", () => {
  const sample = words.filter((w) => w.family.length).slice(0, 200);
  const fams = familiesFromEntries(sample);
  assert.ok(fams.length > 0);
  assert.equal(new Set(fams.map((f) => f.id)).size, fams.length);
  assert.ok(fams.every((f) => f.confirmed && f.members.length >= 2));
});

test("buildGraph จากข้อมูลคลังจริง: คำพ้อง/ตรงข้าม/ตระกูลคำเกิดเป็นเส้นเมื่อคำอยู่ในกราฟทั้งคู่", () => {
  const pick = words.filter((w) => w.synonyms.length && w.synonyms.every((s) => byKey.has(s))).slice(0, 1)[0];
  assert.ok(pick, "ต้องมีคำที่มีคำพ้องอยู่ในคลัง");
  const syn = pick.synonyms[0];
  const cards = [pick, byKey.get(syn)].map((w) => ({ id: w.wordKey, en: w.word, th: w.th[0].text, tags: [] }));
  const lexicon = new Map([[pick.wordKey, lexiconFromEntry(pick)]]);
  const g = buildGraph({ cards, lexicon });
  assert.ok(g.edges.some((e) => e.type === "syn"), `${pick.wordKey}~${syn}`);
});

test("levelProgress: นับต่อระดับ และ pct = (จำได้ + รู้แล้ว) / ทั้งหมด", () => {
  const levels = [{ level: 1, count: 10 }, { level: 2, count: 20 }];
  const cards = [{ id: "a", level: 1 }, { id: "b", level: 1 }, { id: "c", level: 2 }, { id: "x", level: 9 }];
  const states = new Map([["a", "known"], ["b", "new"], ["c", "known"]]);
  const r = levelProgress({ levels, cards, states, skipped: new Set(["s1", "s2"]), levelOf: (c) => c.level, skippedLevelOf: (k) => (k === "s1" ? 1 : 2), isKnown: (s) => s === "known" });
  assert.deepEqual(r[0], { level: 1, total: 10, learning: 1, known: 1, skipped: 1, pct: 20 });
  assert.deepEqual(r[1], { level: 2, total: 20, learning: 0, known: 1, skipped: 1, pct: 10 });
  assert.equal(r.length, 2);
});

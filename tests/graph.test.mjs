import test from "node:test";
import assert from "node:assert/strict";
import { stem, familyCandidates, familyId, buildGraph, neighborhood, degrees, reviewGroup, findNodes, isValidFamily, DEFAULT_ON } from "../js/graph.js";
import { buildLinkDoc } from "../js/links.js";

const card = (en, extra = {}) => ({ id: `c-${en}`, en, th: `th-${en}`, tags: [], example: "", ...extra });
const typesOf = (g) => g.edges.map((e) => `${e.type}:${e.source}-${e.target}`).sort();

test("stem: decide/decision/decisive รากเดียวกัน; คำสั้น/ไม่ใช่ตัวอักษรเป็น null", () => {
  assert.equal(stem("decide"), stem("decision"));
  assert.equal(stem("decision"), stem("decisive"));
  assert.notEqual(stem("decide"), stem("divide"));
  assert.equal(stem("run"), null);
  assert.equal(stem("look after"), null);
  assert.equal(stem("COVID19"), null);
});

test("familyCandidates: จัดกลุ่ม ≥ 2 คำ และไม่เสนอกลุ่มที่ตัดสินแล้ว", () => {
  const keys = ["decide", "decision", "decisive", "dog", "student", "study", "decide"];
  const c = familyCandidates(keys);
  assert.deepEqual(c, [["decide", "decision", "decisive"]]);
  assert.deepEqual(familyCandidates(keys, new Set([familyId(["decisive", "decide", "decision"])])), []);
  assert.deepEqual(familyCandidates(["decide"]), []);
});

test("buildGraph: ลิงก์เอง เชื่อมเฉพาะคำที่อยู่ในคลังทั้งสองฝั่ง และไม่ซ้ำ", () => {
  const g = buildGraph({ cards: [card("a-word"), card("beta"), card("gamma")], links: [buildLinkDoc("a-word", "[[beta]] [[ghost]] [[a-word]]"), buildLinkDoc("beta", "[[a-word]]")] });
  assert.deepEqual(typesOf(g), ["link:a-word-beta"]);
  assert.equal(g.nodes.length, 3);
});

test("buildGraph: related จาก lexicon → syn/ant/coll และคำที่ไม่มีบัตรเป็นโหนดจางเมื่อเปิดคำแนะนำ", () => {
  const lexicon = new Map([["happy", { related: { syn: ["glad", "joyful"], ant: ["sad"], trg: ["smile"], jjb: [] } }]]);
  const cards = [card("happy"), card("glad"), card("sad")];
  const g = buildGraph({ cards, lexicon });
  assert.deepEqual(typesOf(g), ["ant:happy-sad", "syn:glad-happy"]);
  assert.equal(g.stats.lexiconLoaded, 1);
  const g2 = buildGraph({ cards, lexicon, ghosts: true });
  const ghosts = g2.nodes.filter((n) => n.ghost).map((n) => n.id).sort();
  assert.deepEqual(ghosts, ["joyful", "smile"]);
  assert.ok(g2.edges.some((e) => e.type === "coll" && e.target === "smile" || e.source === "smile"));
  assert.equal(g2.nodes.find((n) => n.id === "joyful").status, "ghost");
});

test("buildGraph: ตระกูลคำเฉพาะที่ยืนยัน", () => {
  const cards = [card("decide"), card("decision"), card("decisive")];
  const none = buildGraph({ cards, families: [{ members: ["decide", "decision"], confirmed: false }] });
  assert.equal(none.edges.length, 0);
  const ok = buildGraph({ cards, families: [{ members: ["decide", "decision", "decisive"], confirmed: true }] });
  assert.equal(ok.edges.length, 3);
  assert.ok(ok.edges.every((e) => e.type === "family"));
});

test("buildGraph: อยู่ประโยคเดียวกัน (รวมวลีหลายคำ) และข้ามประโยคที่มีคำในคลังมากเกิน", () => {
  const cards = [card("apple"), card("look after"), card("tree"), card("zebra")];
  const texts = ["I will look after the apple tree.", "Zebra alone.", "unrelated sentence"];
  const g = buildGraph({ cards, texts });
  assert.deepEqual(typesOf(g), ["cooc:apple-look after", "cooc:apple-tree", "cooc:look after-tree"]);
  const many = Array.from({ length: 10 }, (_, i) => card(`word${String.fromCharCode(97 + i)}`));
  const g2 = buildGraph({ cards: many, texts: [many.map((c) => c.en).join(" ")] });
  assert.equal(g2.edges.length, 0);
  assert.equal(g2.stats.skippedSentences, 1);
});

test("buildGraph: แท็กเดียวกัน (กลุ่มใหญ่ใช้ลูกโซ่ ไม่ระเบิด)", () => {
  const cards = [card("aa", { tags: ["Science"] }), card("bb", { tags: ["science"] }), card("cc", { tags: ["other"] })];
  assert.deepEqual(typesOf(buildGraph({ cards })), ["tag:aa-bb"]);
  const big = Array.from({ length: 20 }, (_, i) => card(`w${i}x`, { tags: ["t"] }));
  assert.equal(buildGraph({ cards: big }).edges.length, 19);
});

test("neighborhood / degrees / reviewGroup / DEFAULT_ON", () => {
  const cards = ["a1", "b1", "c1", "d1"].map((k) => card(k, { tags: ["t"] }));
  const g = buildGraph({ cards, links: [buildLinkDoc("a1", "[[b1]]"), buildLinkDoc("b1", "[[c1]]"), buildLinkDoc("c1", "[[d1]]")] });
  const n1 = neighborhood(g, "a1", 1, ["link"]);
  assert.deepEqual([...n1.ids].sort(), ["a1", "b1"]);
  const n2 = neighborhood(g, "a1", 2, ["link"]);
  assert.deepEqual([...n2.ids].sort(), ["a1", "b1", "c1"]);
  assert.equal(n2.dist.get("c1"), 2);
  assert.deepEqual([...degrees(g, ["link"]).entries()], [["a1", 1], ["b1", 2], ["c1", 2], ["d1", 1]]);
  assert.deepEqual(reviewGroup(g, "b1", ["link"]).map((n) => n.id).sort(), ["a1", "b1", "c1"]);
  assert.ok(!DEFAULT_ON.includes("tag"));
  assert.deepEqual([...neighborhood(g, "a1", 1, ["tag"]).ids].sort(), ["a1", "b1", "c1", "d1"]);
});

test("findNodes: ตรงเป๊ะ → ขึ้นต้น → อยู่ในคำ → คำแปล", () => {
  const g = buildGraph({ cards: [card("run"), card("running"), card("trunk"), card("zzz", { th: "วิ่ง run" })] });
  assert.deepEqual(findNodes(g, "run").map((n) => n.id), ["run", "running", "trunk", "zzz"]);
  assert.deepEqual(findNodes(g, ""), []);
});

test("isValidFamily", () => {
  assert.ok(isValidFamily({ members: ["a b", "c"], confirmed: true }));
  assert.ok(!isValidFamily({ members: ["a"], confirmed: true }));
  assert.ok(!isValidFamily({ members: ["A", "b"], confirmed: true }));
  assert.ok(!isValidFamily({ members: ["a", "b"], confirmed: "yes" }));
});

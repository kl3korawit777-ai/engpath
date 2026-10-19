import test from "node:test";
import assert from "node:assert/strict";
import { safeName, uniqueNames, obsidianTag, yamlStr, rewriteNoteLinks, buildVault } from "../js/vault.js";
import { buildLinkDoc } from "../js/links.js";

const DAY = 86400000;
const card = (en, extra = {}) => ({ id: `c-${en}`, en, th: `แปล ${en}`, example: `Example with ${en} here`, tags: [], createdAt: Date.UTC(2026, 0, 5, 6), freq: 60, ...extra });
const states = (m = {}) => ({ get: (id) => m[id] });

test("safeName: ตัดอักขระต้องห้ามทุกระบบ, คำสงวนของ Windows, ความยาว, ภาษาไทยยังอยู่", () => {
  assert.equal(safeName('a/b:c*d?e"f<g>h|i'), "a b c d e f g h i");
  assert.equal(safeName("[[x]] #tag ^ref"), "x tag ref");
  assert.equal(safeName("  ..hidden.. "), "hidden");
  assert.equal(safeName("con"), "con_");
  assert.equal(safeName("LPT1"), "LPT1_");
  assert.equal(safeName(""), "word");
  assert.equal(safeName("ตัดสินใจ"), "ตัดสินใจ");
  assert.ok(new TextEncoder().encode(safeName("ก".repeat(200))).length <= 100);
  assert.ok(!/[\u0000-\u001f]/.test(safeName("a\u0000b\nc")));
});

test("uniqueNames: ชื่อที่ชนกันแม้ตัวพิมพ์ต่างกันได้ต่อท้าย (2)", () => {
  const m = uniqueNames(["a/b", "a:b", "A B", "ok"]);
  assert.deepEqual([...m.values()], ["a b", "a b (2)", "A B (3)", "ok"]);
});

test("obsidianTag: ไม่มีช่องว่าง ซ้อนชั้นด้วย / ตัวเลขล้วนต้องนำหน้า", () => {
  assert.equal(obsidianTag("Science / Biology"), "science/biology");
  assert.equal(obsidianTag("TGAT 1"), "tgat-1");
  assert.equal(obsidianTag("c++ #1!"), "c-1");
  assert.equal(obsidianTag("2024"), "t2024");
  assert.equal(obsidianTag("!!!"), "");
  assert.equal(obsidianTag("วิทย์/ชีวะ"), "วิทย์/ชีวะ");
});

test("yamlStr: escape เครื่องหมายคำพูด ขึ้นบรรทัด และโคลอน", () => {
  assert.equal(yamlStr('say "hi": ok\nnext'), '"say \\"hi\\": ok\\nnext"');
});

test("rewriteNoteLinks: คงลิงก์เดิม ยกเว้นชื่อไฟล์ต่างจาก key จะชี้ไฟล์จริงและคง alias", () => {
  const names = new Map([["a b", "a b"], ["ok", "ok"], ["etc.", "etc"]]);
  assert.equal(rewriteNoteLinks("see [[ok]] [[OK]] and [[a/b]] and [[a/b|เอบี]] and [[etc.]] and [[none]]", names),
    "see [[ok]] [[OK]] and [[a b|a/b]] and [[a b|เอบี]] and [[etc|etc.]] and [[none]]");
});

test("buildVault: ไฟล์ต่อคำ + frontmatter + แท็ก + Related + โน้ต", () => {
  const cards = [
    card("decide", { ipa: "dɪˈsaɪd", pos: "verb", tags: ["Science/Biology"], source: "reading" }),
    card("choose"), card("a/b"),
  ];
  const links = [{ ...buildLinkDoc("decide", "I [[choose]] fast.\nAlso [[a/b|ab]] and [[ghost]]."), id: "decide" }];
  const lexicon = new Map([["decide", { ipa: "x", meanings: [{ pos: "verb", definitions: [{ en: "to make a choice" }] }], examples: ["He decided."], th: [{ sense: "", text: "ตัดสินใจ" }], related: { syn: ["choose"], ant: [], trg: [], jjb: [] } }]]);
  const now = Date.UTC(2026, 9, 19, 6);
  const st = { "c-decide": { isNew: false, interval: 25, due: now + 3 * DAY, ease: 2.5, reps: 4, lapses: 0 } };
  const v = buildVault({ cards, states: states(st), lexicon, links, texts: [], now });
  const paths = v.files.map((f) => f.path).sort();
  assert.deepEqual(paths, ["EngPath/README.md", "EngPath/words/a b.md", "EngPath/words/choose.md", "EngPath/words/decide.md"]);
  const md = v.files.find((f) => f.path.endsWith("decide.md")).content;
  assert.match(md, /^---\nth: "แปล decide"\nipa: "dɪˈsaɪd"\npos: "verb"\ntags:\n  - "science\/biology"\nlevel: "basic"\nstatus: "known"\ninterval: 25\ndue: 2026-10-22\nsource: "reading"\ncreated: 2026-01-05\n---/);
  assert.match(md, /# decide/);
  assert.match(md, /#science\/biology/);
  assert.match(md, /- \(verb\) to make a choice/);
  assert.match(md, /## โน้ต\n\nI \[\[choose\]\] fast\.\nAlso \[\[a b\|ab\]\] and \[\[ghost\]\]\./);
  assert.match(md, /### ลิงก์เอง \[\[ \]\]\n\n- \[\[a b\]\]\n- \[\[choose\]\]/);
  assert.match(md, /### คำพ้อง\n\n- \[\[choose\]\]/);
  const ch = v.files.find((f) => f.path.endsWith("choose.md")).content;
  assert.match(ch, /status: "new"/);
  assert.ok(!/interval:|due:/.test(ch));
  assert.match(ch, /### คำพ้อง\n\n- \[\[decide\]\]/);          // ความสัมพันธ์เป็นสองทาง
});

test("buildVault: export บางส่วน — Related ชี้เฉพาะคำที่อยู่ใน vault แต่ใช้ความสัมพันธ์จากทั้งคลัง", () => {
  const all = [card("alpha"), card("beta"), card("gamma")];
  const links = [{ ...buildLinkDoc("alpha", "[[beta]] [[gamma]]"), id: "alpha" }];
  const v = buildVault({ cards: [all[0], all[1]], allCards: all, states: states(), links });
  const md = v.files.find((f) => f.path.endsWith("alpha.md")).content;
  assert.match(md, /- \[\[beta\]\]/);
  assert.ok(!/- \[\[gamma\]\]/.test(md.split("## Related")[1] || ""));
  assert.equal(v.stats.words, 2);
});

test("buildVault: ไม่มีบัตร → มีแค่ README; บัตรที่ลบแล้วไม่ถูก export", () => {
  assert.equal(buildVault({ cards: [], states: states() }).files.length, 1);
  assert.equal(buildVault({ cards: [card("x1", { deleted: true })], states: states() }).stats.words, 0);
});

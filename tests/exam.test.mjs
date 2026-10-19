import test from "node:test";
import assert from "node:assert/strict";
import * as ex from "../js/exam.js";

const good = (extra = {}) => ({ question: "Q?", options: ["a", "b", "c", "d"], answer: "B", section: "grammar", ...extra });

test("validateQuestion: ถูกต้อง (คำตอบเป็นตัวอักษรหรือข้อความ) → เก็บ answer เป็นข้อความตัวเลือก", () => {
  assert.equal(ex.validateQuestion(good()).q.answer, "b");
  assert.equal(ex.validateQuestion(good({ answer: "c" })).q.answer, "c");
  assert.equal(ex.validateQuestion(good({ options: ["Go", "Goes"], answer: "goes" })).q.answer, "Goes");
  const q = ex.validateQuestion(good({ section: "READING", set: " Set 1 ", source: "my book", explanation: " why " })).q;
  assert.deepEqual([q.section, q.setName, q.source, q.explanation], ["reading", "Set 1", "my book", "why"]);
});

test("validateQuestion: ข้อผิดพลาดบอกสาเหตุเป็นภาษาไทย", () => {
  const err = (raw) => ex.validateQuestion(raw).error;
  assert.match(err(good({ question: "  " })), /ไม่มีคำถาม/);
  assert.match(err(good({ options: ["only"] })), /อย่างน้อย 2/);
  assert.match(err(good({ options: ["a", "b", "c", "d", "e", "f", "g"] })), /สูงสุด 6/);
  assert.match(err(good({ options: ["a", "A!", "c"] })), /ซ้ำ/);
  assert.match(err(good({ answer: "" })), /ไม่ได้ระบุคำตอบ/);
  assert.match(err(good({ answer: "F" })), /เกินจำนวนตัวเลือก/);
  assert.match(err(good({ answer: "zzz" })), /ไม่ตรงกับตัวเลือก/);
  assert.match(err(good({ section: "math" })), /ส่วนต้องเป็น/);
  assert.match(err(good({ section: "" })), /ส่วนต้องเป็น/);
  assert.match(err(good({ question: "x".repeat(3001) })), /ยาวเกิน/);
});

test("parseCsv: เครื่องหมายคำพูด, \"\" , ขึ้นบรรทัดในช่อง, CRLF, BOM, แถวว่าง และเลขบรรทัดที่เริ่มระเบียน", () => {
  const text = '﻿a,b,c\r\n1,"x, y",3\r\n\r\n"multi\nline","say ""hi""",z\r\n7,8,9';
  const { rows, delimiter } = ex.parseCsv(text);
  assert.equal(delimiter, ",");
  assert.deepEqual(rows.map((r) => r.line), [1, 2, 4, 6]);
  assert.deepEqual(rows[1].cells, ["1", "x, y", "3"]);
  assert.deepEqual(rows[2].cells, ["multi\nline", 'say "hi"', "z"]);
  assert.deepEqual(rows[3].cells, ["7", "8", "9"]);
});

test("parseCsv: ตัวคั่น ; และ tab; เครื่องหมายคำพูดไม่ปิดถูกทำเครื่องหมาย", () => {
  assert.equal(ex.parseCsv("a;b;c\n1;2;3").delimiter, ";");
  assert.equal(ex.parseCsv("a\tb\n1\t2").rows[1].cells[1], "2");
  const r = ex.parseCsv('a,b\n1,"oops\n2,3');
  assert.equal(r.rows.at(-1).unterminated, true);
});

const HEAD = "question,option_a,option_b,option_c,option_d,answer,explanation,section,set,source";

test("importCsv: แถวถูกนำเข้า แถวผิดรายงานเลขบรรทัด (รวมบรรทัดหลังช่องที่ขึ้นบรรทัดใหม่) และไม่ปน", () => {
  const csv = [
    HEAD,
    'Q1?,a,b,c,d,B,because,grammar,S1,book',            // 2 ผ่าน
    'Q2?,a,b,c,d,Z,,grammar,S1,',                        // 3 คำตอบไม่ตรง
    '"Q3\nmultiline",a,b,c,d,A,,vocab,S1,',              // 4–5 ผ่าน (ขึ้นบรรทัดในช่อง)
    'Q4?,a,b,,,A,,grammar,S1,',                           // 6 ผ่าน (2 ตัวเลือก)
    'Q5?,a,a,c,d,A,,grammar,S1,',                         // 7 ตัวเลือกซ้ำ
    'Q6?,a,b,c,d,A,,history,S1,',                         // 8 ส่วนผิด
    ',a,b,c,d,A,,grammar,S1,',                            // 9 ไม่มีคำถาม
    'Q1?,a,b,c,d,B,dup,grammar,S1,book',                  // 10 ซ้ำกับแถว 2
  ].join("\n");
  const r = ex.importCsv(csv);
  assert.equal(r.total, 8);
  assert.deepEqual(r.questions.map((q) => q.question), ["Q1?", "Q3\nmultiline", "Q4?"]);
  assert.deepEqual(r.errors.map((e) => e.line), [3, 7, 8, 9]);
  assert.match(r.errors[0].message, /ไม่ตรงกับตัวเลือก/);
  assert.equal(r.skippedDuplicates, 1);
  assert.equal(ex.describeError(r.errors[0]), `บรรทัด 3: ${r.errors[0].message}`);
});

test("importCsv: ซ้ำกับของที่มีอยู่แล้วข้าม; หัวตารางขาดคอลัมน์ → ไม่นำเข้าอะไรและบอกคอลัมน์ที่ขาด; ไฟล์ว่าง", () => {
  const existing = [ex.validateQuestion(good()).q];
  const r = ex.importCsv(`${HEAD}\nQ?,a,b,c,d,B,,grammar,,`, existing);
  assert.equal(r.questions.length, 0);
  assert.equal(r.skippedDuplicates, 1);
  const bad = ex.importCsv("question,option_a,option_b\nQ,a,b");
  assert.equal(bad.questions.length, 0);
  assert.match(bad.errors[0].message, /answer, section/);
  assert.match(ex.importCsv("").errors[0].message, /ไฟล์ว่าง/);
  assert.match(ex.importCsv("question,answer,section\nQ,A,grammar").errors[0].message, /option_a/);
});

test("importCsv: หัวตารางภาษาไทยและตัวพิมพ์ต่างกันใช้ได้", () => {
  const r = ex.importCsv("คำถาม,ตัวเลือก_a,ตัวเลือก_b,คำตอบ,ส่วน,ชุด\nQ?,x,y,B,Vocab,ชุด 1");
  assert.equal(r.questions.length, 1);
  assert.deepEqual([r.questions[0].answer, r.questions[0].section, r.questions[0].setName], ["y", "vocab", "ชุด 1"]);
});

test("template CSV/JSON: นำเข้ากลับได้ครบ ทุกข้อมีป้าย “ตัวอย่าง”", () => {
  const c = ex.importAuto(ex.templateCsv(), "template.csv");
  assert.equal(c.format, "csv");
  assert.equal(c.errors.length, 0);
  assert.equal(c.questions.length, ex.SAMPLE_QUESTIONS.length);
  assert.ok(c.questions.every((q) => q.source === ex.SAMPLE_SOURCE && q.setName === "ตัวอย่าง"));
  assert.ok(c.questions[2].question.includes("\n"));                       // ช่องที่ขึ้นบรรทัดใหม่ผ่านการ quote กลับมาได้
  const j = ex.importAuto(ex.templateJson(), "template.json");
  assert.equal(j.format, "json");
  assert.equal(j.errors.length, 0);
  assert.equal(j.questions.length, 3);
  assert.deepEqual(j.questions.map((q) => q.answer), c.questions.map((q) => q.answer));
});

test("importJson: รายงาน 'รายการที่ N'; รับ {questions:[]} และ option_a…; JSON เสียบอกสาเหตุ", () => {
  const r = ex.importJson(JSON.stringify({ questions: [
    { question: "ok", options: ["a", "b"], answer: "A", section: "vocab" },
    { question: "bad", options: ["a", "b"], answer: "Q", section: "vocab" },
    "oops",
    { question: "flat", option_a: "x", option_b: "y", answer: "y", section: "reading" },
  ] }));
  assert.equal(r.questions.length, 2);
  assert.deepEqual(r.errors.map((e) => e.index), [2, 3]);
  assert.equal(ex.describeError(r.errors[1]), "รายการที่ 3: รายการนี้ไม่ใช่ออบเจ็กต์");
  assert.match(ex.importJson("{bad").errors[0].message, /อ่าน JSON ไม่ได้/);
  assert.match(ex.importJson('{"a":1}').errors[0].message, /อาร์เรย์/);
});

test("importCsv: เกินจำนวนแถวที่รับได้ → ไม่นำเข้า", () => {
  const big = [HEAD, ...Array.from({ length: ex.LIMITS.importRows + 1 }, (_, i) => `Q${i}?,a,b,c,d,A,,grammar,,`)].join("\n");
  const r = ex.importCsv(big);
  assert.equal(r.questions.length, 0);
  assert.match(r.errors[0].message, /ไม่เกิน/);
});

const Q = (id, section, setName = "S1") => ({ id, question: `Q ${id}`, options: ["a", "b", "c"], answer: "b", explanation: "", section, setName, deleted: false });

test("matchingQuestions / buildExam: กรองชุด+ส่วน, จำกัดจำนวน, เรียงตามส่วน, ไม่ซ้ำ, ไม่มีเฉลยปนใน items ที่ผู้ใช้เห็น (answer มีแต่เก็บใน items สำหรับตรวจ)", () => {
  const qs = [Q("1", "grammar"), Q("2", "reading"), Q("3", "vocab"), Q("4", "reading", "S2"), Q("5", "grammar"), { ...Q("6", "grammar"), deleted: true }];
  assert.equal(ex.matchingQuestions(qs, { setName: "S1", sections: [] }).length, 4);
  assert.equal(ex.matchingQuestions(qs, { setName: "", sections: ["reading"] }).length, 2);
  const e = ex.buildExam(qs, { setName: "S1", sections: [], count: 10 }, () => 0.3);
  assert.equal(e.items.length, 4);
  assert.equal(e.available, 4);
  assert.deepEqual(e.items.map((i) => i.section), ["reading", "grammar", "grammar", "vocab"]);
  assert.equal(new Set(e.items.map((i) => i.qid)).size, 4);
  assert.equal(ex.buildExam(qs, { setName: "S1", sections: [], count: 2 }).items.length, 2);
  assert.equal(ex.buildExam([], { count: 5 }).items.length, 0);
});

test("validateConfig", () => {
  const ok = { count: 20, minutes: 30, sections: ["reading"], targetPercent: 70 };
  assert.equal(ex.validateConfig(ok), null);
  assert.equal(ex.validateConfig({ ...ok, targetPercent: "" }), null);
  assert.match(ex.validateConfig({ ...ok, count: 0 }), /จำนวนข้อ/);
  assert.match(ex.validateConfig({ ...ok, count: 201 }), /จำนวนข้อ/);
  assert.match(ex.validateConfig({ ...ok, minutes: 0 }), /เวลา/);
  assert.match(ex.validateConfig({ ...ok, targetPercent: 120 }), /เป้า/);
  assert.match(ex.validateConfig({ ...ok, sections: ["math"] }), /ส่วน/);
});

test("จับเวลา: remainingSec / isTimeUp / clock — อิงเวลาจริง (หมดเวลาแม้แท็บหลับ)", () => {
  const start = 1_000_000;
  assert.equal(ex.remainingSec(start, 60, start), 60);
  assert.equal(ex.remainingSec(start, 60, start + 59_001), 1);
  assert.equal(ex.remainingSec(start, 60, start + 90_000), 0);
  assert.equal(ex.isTimeUp(start, 60, start + 59_999), false);
  assert.equal(ex.isTimeUp(start, 60, start + 60_000), true);
  assert.equal(ex.isTimeUp(start, 60, start + 3_600_000), true);
  assert.equal(ex.clock(75), "1:15");
  assert.equal(ex.clock(3725), "1:02:05");
  assert.equal(ex.clock(0), "0:00");
});

test("tracker: เวลาต่อข้อรวมทุกครั้งที่กลับมาข้อเดิม และปิดข้อสุดท้ายตอนส่ง", () => {
  const t = ex.createTracker(3, 0);
  ex.enter(t, 1, 10_000);       // ข้อ 0 ใช้ 10 วินาที
  ex.enter(t, 2, 25_000);       // ข้อ 1 ใช้ 15
  ex.enter(t, 1, 30_000);       // ข้อ 2 ใช้ 5
  assert.deepEqual(ex.finalize(t, 42_500), [10, 27.5, 5]);   // ข้อ 1 อีก 12.5
});

test("scoreExam: ไม่ตอบ = ผิด, แยกตามส่วน, เวลาและธงต่อข้อ", () => {
  const items = [{ qid: "a", section: "reading", answer: "x" }, { qid: "b", section: "grammar", answer: "y" }, { qid: "c", section: "grammar", answer: "z" }, { qid: "d", section: "vocab", answer: "w" }];
  const s = ex.scoreExam(items, ["x", "no", null, "w"], [5, 6, 7, 8], [false, true, false, false]);
  assert.equal(s.total, 4); assert.equal(s.correct, 2); assert.equal(s.scorePct, 50);
  assert.deepEqual(s.bySection, [{ section: "reading", total: 1, correct: 1 }, { section: "grammar", total: 2, correct: 0 }, { section: "vocab", total: 1, correct: 1 }]);
  assert.deepEqual(s.results[2], { qid: "c", section: "grammar", chosen: null, correct: false, sec: 7, flagged: false, skipped: true });
  assert.equal(s.results[1].flagged, true);
  assert.equal(ex.scoreExam(items, [], []).scorePct, 0);
  assert.equal(ex.scoreExam([], [], []).total, 0);
  assert.equal(ex.scoreExam(items.slice(0, 3), ["x", "y", "z"]).scorePct, 100);
  assert.equal(ex.scoreExam(items.slice(0, 3), ["x", "y", "no"]).scorePct, 66.7);
});

const mkAttempt = (start, scorePct, cfg = {}) => ({ start, scorePct, config: { presetId: "p1", name: "A-Level", targetPercent: 70, ...cfg } });

test("targetStatus: ถึงเป้า 2 ครั้งติดในชุดแนวเดียวกัน", () => {
  const a = [mkAttempt(1, 50), mkAttempt(2, 72), mkAttempt(3, 75)];
  const s = ex.targetStatus(a);
  assert.equal(s.twoInARow, true);
  assert.deepEqual(s.last2.map((x) => [x.score, x.reached]), [[75, true], [72, true]]);
  assert.equal(ex.targetStatus(a.slice(0, 2)).twoInARow, false);                    // 50 ไม่ถึง
  const mixed = [mkAttempt(1, 90, { presetId: "p2" }), mkAttempt(2, 40), mkAttempt(3, 80)];
  const m = ex.targetStatus(mixed);                                                // ล่าสุดคือ p1: 80 และ 40 → ไม่ติด (90 ของ p2 ไม่ปนมา)
  assert.equal(m.twoInARow, false);
  assert.deepEqual(m.last2.map((x) => x.score), [80, 40]);
  assert.equal(ex.targetStatus([mkAttempt(1, 99, { targetPercent: null })]).latest, null);
  assert.equal(ex.targetStatus([]).twoInARow, false);
  assert.equal(ex.targetStatus([mkAttempt(1, 70)]).last2[0].reached, true);          // เท่าเป้า = ถึง
});

test("configKey: preset เดียวกัน / ไม่มี preset แต่ค่าเหมือนกัน", () => {
  assert.equal(ex.configKey({ presetId: "x", count: 1 }), "preset:x");
  assert.equal(ex.configKey({ setName: "S", sections: ["b", "a"], count: 10, minutes: 20 }), ex.configKey({ setName: "S", sections: ["a", "b"], count: 10, minutes: 20 }));
  assert.notEqual(ex.configKey({ setName: "S", sections: [], count: 10, minutes: 20 }), ex.configKey({ setName: "S", sections: [], count: 10, minutes: 25 }));
});

test("attemptDoc + isValidAttempt / isValidExamSet / isValidQuestionDoc", () => {
  const items = [{ qid: "a", section: "reading", answer: "x" }, { qid: "b", section: "grammar", answer: "y" }];
  const score = ex.scoreExam(items, ["x", null], [3, 4], [false, true]);
  const doc = ex.attemptDoc({ config: { name: "n", presetId: "", setName: "S", sections: ["reading"], count: 2, minutes: 5, targetPercent: "70" }, start: 1000, end: 61000, limitSec: 300, autoSubmitted: true, score });
  assert.equal(doc.durationSec, 60); assert.equal(doc.config.targetPercent, 70); assert.equal(doc.autoSubmitted, true);
  assert.ok(ex.isValidAttempt(doc));
  assert.ok(!ex.isValidAttempt({ ...doc, total: 3 }));
  assert.ok(!ex.isValidAttempt({ ...doc, items: [{ ...doc.items[0], section: "zzz" }, doc.items[1]] }));
  assert.ok(ex.isValidExamSet({ name: "P", count: 10, minutes: 20, sections: ["reading"], targetPercent: 70, setName: "" }));
  assert.ok(!ex.isValidExamSet({ name: "", count: 10, minutes: 20 }));
  assert.ok(!ex.isValidExamSet({ name: "P", count: 0, minutes: 20 }));
  const q = ex.validateQuestion(good()).q;
  assert.ok(ex.isValidQuestionDoc({ ...q, id: "1" }));
  assert.ok(!ex.isValidQuestionDoc({ ...q, answer: "not-an-option" }));
});

test("errorPayload: ส่งข้อสอบที่ผิดเข้า Error Log", () => {
  const it = { question: "She ____ to school.\nevery day", answer: "goes", explanation: "ประธานเอกพจน์" };
  const p = ex.errorPayload(it, "go", "Grammar");
  assert.equal(p.wrong, "go"); assert.equal(p.right, "goes"); assert.equal(p.category, "Grammar");
  assert.match(p.note, /^จากข้อสอบ: She ____ to school\. every day/);
  assert.equal(ex.errorPayload(it, null, "Grammar").wrong, "(ไม่ได้ตอบ)");
  assert.ok(ex.errorPayload({ ...it, question: "x".repeat(900), explanation: "y".repeat(900) }, "a", "Grammar").note.length <= 400);
});

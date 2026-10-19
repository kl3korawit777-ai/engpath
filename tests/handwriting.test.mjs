// รัน: node --test tests/handwriting.test.mjs  (ใช้มาสก์สังเคราะห์ ไม่ต้องมี canvas)
import test from "node:test";
import assert from "node:assert/strict";
import * as hw from "../js/handwriting-core.js";
import { HW } from "../js/data/handwriting-config.js";
import { initialState, applyReview } from "../js/srs.js";

const PX = HW.score.maskPxPerEm;

// ---------- ระดับ ----------
const att = (o) => ({ id: `${o.at}`, wordKey: "cat", style: "print", at: 1, ...o });

test("Trace/Fade: ≥ 80 ขึ้นหนึ่งระดับ, ต่ำกว่านั้นอยู่เดิม; Copy/Recall ตามคะแนนตัวเอง (ยังไม่ได้ = ลด)", () => {
  assert.equal(hw.applyAttempt("trace", att({ level: "trace", score: 80 })), "fade");
  assert.equal(hw.applyAttempt("trace", att({ level: "trace", score: 79 })), "trace");
  assert.equal(hw.applyAttempt("fade", att({ level: "fade", score: 95 })), "copy");
  assert.equal(hw.applyAttempt("copy", att({ level: "copy", selfRating: 0 })), "fade");
  assert.equal(hw.applyAttempt("copy", att({ level: "copy", selfRating: 1 })), "copy");
  assert.equal(hw.applyAttempt("copy", att({ level: "copy", selfRating: 2 })), "recall");
  assert.equal(hw.applyAttempt("recall", att({ level: "recall", selfRating: 2 })), "recall");   // บนสุดแล้ว
  assert.equal(hw.applyAttempt("recall", att({ level: "recall", selfRating: 0 })), "copy");
  assert.equal(hw.applyAttempt("trace", att({ level: "trace", selfRating: 0 })), "trace");       // ล่างสุดแล้ว
  assert.equal(hw.applyAttempt("copy", att({ level: "trace", score: 99 })), "copy");             // ฝึกนอกระดับปัจจุบัน ไม่นับ
});

test("levelsFromAttempts: เล่นซ้ำตามเวลา แยกตามคำและรูปแบบตัวอักษร (Print/Cursive นับแยก)", () => {
  const attempts = [
    att({ at: 5, level: "fade", score: 90 }), att({ at: 1, level: "trace", score: 85 }),         // ส่งมาไม่เรียง
    att({ at: 9, level: "copy", selfRating: 2 }),
    att({ at: 2, style: "cursive", level: "trace", score: 40 }),
    att({ at: 3, wordKey: "dog", level: "trace", score: 82 }),
  ];
  const m = hw.levelsFromAttempts(attempts);
  assert.equal(hw.levelOfWord(m, "cat", "print"), "recall");
  assert.equal(hw.levelOfWord(m, "cat", "cursive"), "trace");
  assert.equal(hw.levelOfWord(m, "dog", "print"), "fade");
  assert.equal(hw.levelOfWord(m, "bird", "print"), "trace");                                    // ยังไม่เคยฝึก
  assert.equal(m.get("cat|print").count, 3);
  assert.equal(m.get("cat|print").lastScore, 90);
  assert.equal(m.get("cat|print").lastRating, 2);
});

// ---------- เรขาคณิต ----------
test("fitBox / toNorm / fromNorm: หมุนจอ (เปลี่ยนขนาดผืน) แล้วเส้นยังตรงรอยเดิม", () => {
  const bw = 6, bh = 2.4;
  const stroke = [0.25, 0.5];
  for (const [cw, ch] of [[1200, 500], [500, 1200], [800, 800]]) {
    const fit = hw.fitBox(cw, ch, bw, bh);
    assert.ok(fit.w <= cw + 1e-9 && fit.h <= ch + 1e-9);
    const [px, py] = hw.fromNorm(stroke[0], stroke[1], fit, bw, bh);
    const [nx, ny] = hw.toNorm(px, py, fit, bw, bh);
    assert.ok(Math.abs(nx - stroke[0]) < 1e-9 && Math.abs(ny - stroke[1]) < 1e-9);
    assert.ok(Math.abs(fit.w / fit.h - bw / bh) < 1e-9);                                       // อัตราส่วนกรอบคงเดิม
  }
  const a = hw.fitBox(1000, 400, 5, 2), b = hw.fitBox(400, 1000, 5, 2);
  assert.ok(Math.abs(a.w / 5 - a.scale) < 1e-9 && b.scale < a.scale);
});

test("layoutFromMetrics: เส้นบรรทัด 4 เส้นเรียงบน → กลาง → ฐาน → หาง และอยู่ในกรอบ", () => {
  const L = hw.layoutFromMetrics({ textWidth: 2.4, ascH: 0.75, xH: 0.5, descG: 0.22, textAsc: 0.8, textDesc: 0.1 });
  assert.ok(L.lines.top < L.lines.mid && L.lines.mid < L.lines.base && L.lines.base < L.lines.tail);
  assert.equal(L.baseY, L.lines.base);
  assert.ok(L.lines.top >= 0 && L.lines.tail <= L.boxH);
  assert.ok(Math.abs(L.lines.base - L.lines.mid - 0.5) < 1e-9);                                  // เส้นกลางสูงเท่า x-height
  assert.ok(Math.abs(L.lines.top - (L.baseY - 0.8)) < 1e-9);                                     // ตัวพิมพ์ใหญ่สูงกว่า 'h' ใช้ค่าที่สูงกว่า
  assert.ok(Math.abs(L.textX * 2 + 2.4 - L.boxW) < 1e-9);
  assert.equal(hw.layoutFromMetrics({ textWidth: 0.2, ascH: 1, xH: 0.5, descG: 0.2 }).boxW, HW.box.minWidthEm);
});

test("letterRanges: ข้ามช่องว่าง และช่วงต่อเนื่องกัน", () => {
  const r = hw.letterRanges("ab c", (p) => p.length * 0.5, 1);
  assert.deepEqual(r.map((x) => x.ch), ["a", "b", "c"]);
  assert.deepEqual([r[0].x0, r[0].x1, r[1].x0, r[1].x1, r[2].x0, r[2].x1], [1, 1.5, 1.5, 2, 2.5, 3]);
});

test("strokeWidthEm: แรงกดมากเส้นหนากว่า, ตามตัวคูณความหนา, เมาส์/นิ้วใช้ค่าคงที่", () => {
  assert.ok(hw.strokeWidthEm(1) > hw.strokeWidthEm(0.5) && hw.strokeWidthEm(0.5) > hw.strokeWidthEm(0.05));
  assert.ok(Math.abs(hw.strokeWidthEm(0.5, 2) - 2 * hw.strokeWidthEm(0.5, 1)) < 1e-12);
  assert.equal(hw.strokeWidthEm(undefined), hw.strokeWidthEm(HW.ink.mousePressure));
  assert.ok(hw.strokeWidthEm(5) === hw.strokeWidthEm(1));                                        // ตัดค่าเกิน
});

test("hitStroke: ยางลบลบเส้นที่แตะ ไม่ลบเส้นที่ไกล", () => {
  const s = { pts: [[0.1, 0.5], [0.9, 0.5]] };
  assert.equal(hw.hitStroke(s, 0.5, 0.5, 5, 2, 0.1), true);
  assert.equal(hw.hitStroke(s, 0.5, 0.6, 5, 2, 0.1), false);        // ห่าง 0.2em
  assert.equal(hw.hitStroke(s, 0.5, 0.52, 5, 2, 0.1), true);
  assert.equal(hw.hitStroke({ pts: [[0.5, 0.5]] }, 0.51, 0.5, 5, 2, 0.1), true);                // เส้นจุดเดียว
  assert.equal(hw.isValidStroke({ pts: [] }), false);
  assert.equal(hw.isValidStroke({ pts: [[0, 0, 0.5], [NaN, 1]] }), false);
});

test("dilate: ขยายสี่เหลี่ยมรัศมี r", () => {
  const w = 7, h = 7, m = new Uint8Array(w * h);
  m[3 * w + 3] = 1;
  const d = hw.dilate(m, w, h, 1);
  assert.equal(d.reduce((a, b) => a + b, 0), 9);
  assert.equal(d[2 * w + 2], 1);
  assert.equal(d[1 * w + 1], 0);
  assert.deepEqual([...hw.dilate(m, w, h, 0)], [...m]);
  assert.equal(hw.dilate(m, w, h, 10).every((v) => v === 1), true);
});

// ---------- การให้คะแนน (ภาพสังเคราะห์: แท่งตั้ง 3 ตัว กว้างตัวละ 1 em) ----------
const BW = 3, BH = 3;
const bar = (i, dx = 0, dy = 0) => ({ pts: [[(i + 0.5 + dx) / BW, (0.3 + dy) / BH], [(i + 0.5 + dx) / BW, (1.7 + dy) / BH]] });
const GLYPH_STROKE_EM = 0.12;                                   // ความหนาเส้นของตัวอักษรจริงในฟอนต์ ~0.08–0.12 em
const guideMask = () => rasterStrokes_([0, 1, 2].map((i) => bar(i)), GLYPH_STROKE_EM);
function rasterStrokes_(strokes, strokeEm) { return hw.rasterStrokes(strokes, BW, BH, PX, strokeEm); }
const letters = () => hw.letterRanges("III", (p) => p.length, 0).map((l) => ({ ch: l.ch, x0: l.x0 * PX, x1: l.x1 * PX }));
const score = (inkStrokes) => {
  const g = guideMask(), ink = rasterStrokes_(inkStrokes, HW.score.inkStrokeEm);
  return hw.scoreAttempt({ guide: g.mask, ink: ink.mask, w: g.w, h: g.h, letters: letters() });
};

test("ให้คะแนน: เขียนทับรอยดี ≥ 80 (ตัวอย่างนี้ได้เกือบเต็ม) ไม่มีตัวอักษรแดง", () => {
  const r = score([0, 1, 2].map((i) => bar(i)));
  assert.ok(r.score >= 90, `score ${r.score}`);
  assert.deepEqual(r.badLetters, []);
  assert.ok(r.coverage > 0.95 && r.accuracy > 0.95);
});

test("ให้คะแนน: เขียนเบี่ยงเล็กน้อยยังผ่าน แต่เบี่ยงมากคะแนนต่ำ", () => {
  assert.ok(score([0, 1, 2].map((i) => bar(i, 0.03, 0.02))).score >= 80);
  const far = score([0, 1, 2].map((i) => bar(i, 0.45, 0)));                       // เลื่อนเกือบเต็มตัวอักษร
  assert.ok(far.score < 40, `score ${far.score}`);
  assert.ok(far.badLetters.length >= 2);
});

test("ให้คะแนน: เขียนนอกรอย (เส้นขวางด้านล่าง) ได้คะแนนต่ำและบอกตัวอักษรที่พลาดทุกตัว", () => {
  const r = score([{ pts: [[0.05, 2.6 / BH], [2.95 / BW, 2.6 / BH]] }]);
  assert.ok(r.score < 30, `score ${r.score}`);
  assert.deepEqual(r.badLetters, ["I", "I", "I"]);
  assert.ok(r.accuracy < 0.3);
});

test("ให้คะแนน: เขียนแค่ตัวแรก → coverage ~1/3, ตัวที่ 2–3 เป็นสีแดง; ไม่ได้เขียน = 0", () => {
  const r = score([bar(0)]);
  assert.ok(r.coverage > 0.28 && r.coverage < 0.4, `coverage ${r.coverage}`);
  assert.deepEqual(r.letters.map((l) => l.bad), [false, true, true]);
  assert.ok(r.accuracy > 0.95);
  const empty = score([]);
  assert.equal(empty.score, 0);
  assert.equal(empty.badLetters.length, 3);
});

test("ให้คะแนน: สูตร 0.55·coverage + 0.45·accuracy และเกณฑ์ปรับได้จาก config", () => {
  const g = guideMask(), ink = rasterStrokes_([bar(0)], HW.score.inkStrokeEm);
  const base = hw.scoreAttempt({ guide: g.mask, ink: ink.mask, w: g.w, h: g.h, letters: letters() });
  assert.equal(base.score, Math.round(100 * (0.55 * base.coverage + 0.45 * base.accuracy)));
  const strict = hw.scoreAttempt({ guide: g.mask, ink: ink.mask, w: g.w, h: g.h, letters: letters() }, { ...HW.score, letterRedBelow: 0 });
  assert.deepEqual(strict.badLetters, []);                                          // เกณฑ์แดงอยู่ใน config
});

// ---------- รูปย่อ ----------
test("fitJpeg: ลด quality จนไม่เกิน 25KB แล้วค่อยลดความกว้าง; ไม่ได้จริงโยน error", async () => {
  const fake = (bytesAt) => async (q, width) => ({ dataUrl: "data:image/jpeg;base64," + "A".repeat(Math.ceil((bytesAt(q, width) * 4) / 3)), w: width, h: 100 });
  const calls = [];
  const r = await hw.fitJpeg(async (q, w) => { calls.push([q, w]); return fake((qq) => (qq <= 0.4 ? 20000 : 30000))(q, w); });
  assert.equal(r.quality, 0.4);
  assert.deepEqual(calls[0], [0.6, 260]);
  assert.ok(r.bytes <= 25000);
  const r2 = await hw.fitJpeg(fake((q, w) => (w < 230 ? 10000 : 40000)));            // ต้องลดความกว้าง
  assert.ok(r2.width === undefined && r2.w < 230);
  await assert.rejects(hw.fitJpeg(fake(() => 99999)), /ใหญ่เกิน/);
  assert.equal(hw.dataUrlBytes("data:image/jpeg;base64,QUJD"), 3);
});

// ---------- แหล่งคำ ----------
test("candidateWords: บัตรถึงรอบ, จุดเน้น Error Log, Shadowing, เพิ่มเอง — แยกแหล่งและไม่ซ้ำ", () => {
  const NOW = 1_800_000_000_000;
  const cards = [
    { id: "c1", en: "look after", th: "ดูแล" }, { id: "c2", en: "Look  After", th: "ซ้ำ" },
    { id: "c3", en: "apple", th: "แอปเปิล" }, { id: "c4", en: "x".repeat(40), th: "ยาวไป" }, { id: "c5", en: "<b>", th: "" },
  ];
  const reviewedToday = applyReview(initialState(), 2, NOW);
  const states = new Map([["c1", initialState()], ["c2", initialState()], ["c3", reviewedToday], ["c4", initialState()], ["c5", initialState()]]);
  const r = hw.candidateWords({
    cards, states, now: NOW,
    focusErrors: [{ id: "e1", right: "depend on" }, { id: "e2", right: "" }],
    customWords: [{ id: "w1", text: "never mind", source: "shadowing" }, { id: "w2", text: "banana", source: "manual" }, { id: "w3", text: "BANANA", source: "manual" }],
  });
  assert.deepEqual(r.due.map((x) => x.text), ["look after"]);                       // c3 ทบทวนแล้วยังไม่ถึงรอบ, c4 ยาวไป, c5 ตัวอักษรไม่รองรับ, c2 ซ้ำ
  assert.deepEqual(r.focus.map((x) => x.text), ["depend on"]);
  assert.deepEqual(r.shadowing.map((x) => x.text), ["never mind"]);
  assert.deepEqual(r.manual.map((x) => x.text), ["banana"]);
  assert.equal(r.due[0].wordKey, "look after");
  assert.equal(r.due[0].th, "ดูแล");
  assert.equal(hw.isWritable("don’t stop."), true);
  assert.equal(hw.isWritable("  "), false);
});

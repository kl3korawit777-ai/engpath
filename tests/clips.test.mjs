// รัน: node --test tests/clips.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import * as c from "../js/clips.js";

const ID = "dQw4w9WgXcQ";

test("parseTime / formatTime / parseClockInput", () => {
  assert.equal(c.parseTime("90"), 90);
  assert.equal(c.parseTime("90s"), 90);
  assert.equal(c.parseTime("1m30s"), 90);
  assert.equal(c.parseTime("1h2m3s"), 3723);
  assert.equal(c.parseTime("2m"), 120);
  assert.equal(c.parseTime("1:30"), 90);
  assert.equal(c.parseTime("1:02:03"), 3723);
  assert.equal(c.parseTime("12.5"), 12.5);
  assert.equal(c.parseTime(""), null);
  assert.equal(c.parseTime("abc"), null);
  assert.equal(c.parseTime(null), null);
  assert.equal(c.formatTime(90), "1:30");
  assert.equal(c.formatTime(3723), "1:02:03");
  assert.equal(c.formatTime(5.9), "0:05");
  assert.equal(c.formatTime(-3), "0:00");
  assert.equal(c.parseClockInput(""), null);
  assert.equal(c.parseClockInput("1:05"), 65);
  assert.equal(c.parseClockInput("x:y"), undefined);
});

test("YouTube: watch, youtu.be, shorts, embed, live, m., nocookie → videoId เดียวกัน", () => {
  const urls = [
    `https://www.youtube.com/watch?v=${ID}`, `youtube.com/watch?v=${ID}&feature=share`, `https://youtu.be/${ID}`, `https://youtu.be/${ID}?si=abc`,
    `https://www.youtube.com/shorts/${ID}`, `https://www.youtube.com/embed/${ID}`, `https://www.youtube.com/live/${ID}`,
    `https://m.youtube.com/watch?v=${ID}`, `https://www.youtube-nocookie.com/embed/${ID}`, `https://music.youtube.com/watch?v=${ID}`,
  ];
  for (const u of urls) {
    const r = c.parseClipUrl(u);
    assert.equal(r.ok, true, u);
    assert.equal(r.type, "youtube");
    assert.equal(r.videoId, ID, u);
    assert.equal(r.url, `https://www.youtube.com/watch?v=${ID}`);
  }
});

test("YouTube: อ่านจุดเริ่มจาก t= / start= (query และ #t=) หลายรูปแบบ", () => {
  const st = (u) => c.parseClipUrl(u).start;
  assert.equal(st(`https://www.youtube.com/watch?v=${ID}&t=90`), 90);
  assert.equal(st(`https://www.youtube.com/watch?v=${ID}&t=1m30s`), 90);
  assert.equal(st(`https://youtu.be/${ID}?t=45`), 45);
  assert.equal(st(`https://www.youtube.com/embed/${ID}?start=12`), 12);
  assert.equal(st(`https://www.youtube.com/watch?v=${ID}#t=75`), 75);
  assert.equal(st(`https://www.youtube.com/watch?v=${ID}&t=1h1m1s`), 3661);
  assert.equal(st(`https://www.youtube.com/watch?v=${ID}`), 0);
  assert.equal(st(`https://www.youtube.com/watch?v=${ID}&t=zzz`), 0);
});

test("YouTube: ลิงก์ที่ไม่ใช่คลิปเดี่ยวหรือ id ผิด → error ภาษาไทย", () => {
  for (const u of ["https://www.youtube.com/playlist?list=PL123", "https://www.youtube.com/@channel", "https://www.youtube.com/watch", "https://youtu.be/short", `https://www.youtube.com/watch?v=${ID}x`, "https://www.youtube.com/results?search_query=a"]) {
    const r = c.parseClipUrl(u);
    assert.equal(r.ok, false, u);
    assert.match(r.error, /YouTube/);
  }
});

test("ไฟล์ตรง: .mp3 .m4a .wav .ogg → audio, .mp4 .webm → video; ไม่สนตัวพิมพ์/query; #t=", () => {
  for (const e of ["mp3", "m4a", "wav", "ogg"]) assert.equal(c.parseClipUrl(`https://cdn.example.com/a/b.${e}`).kind, "audio", e);
  for (const e of ["mp4", "webm"]) assert.equal(c.parseClipUrl(`https://cdn.example.com/x.${e}`).kind, "video", e);
  assert.equal(c.parseClipUrl("https://x.com/CLIP.MP3?token=1").type, "file");
  assert.equal(c.parseClipUrl("https://x.com/a.mp3?token=1").url, "https://x.com/a.mp3?token=1");
  const r = c.parseClipUrl("https://x.com/a.mp3#t=30");
  assert.equal(r.start, 30);
  assert.equal(r.url, "https://x.com/a.mp3");
  assert.equal(c.parseClipUrl("x.com/podcast.m4a").ok, true);                 // ไม่มี scheme ใช้ https
});

test("URL ที่ไม่รองรับ: ว่าง, ไม่ใช่ URL, สคีมอันตราย, ชนิดไฟล์อื่น", () => {
  assert.match(c.parseClipUrl("").error, /วางลิงก์/);
  assert.equal(c.parseClipUrl("   ").ok, false);
  assert.match(c.parseClipUrl("javascript:alert(1)").error, /http/);
  assert.match(c.parseClipUrl("data:audio/mp3;base64,AAAA").error, /http/);
  assert.match(c.parseClipUrl("ftp://x.com/a.mp3").error, /http/);
  assert.match(c.parseClipUrl("https://x.com/page.html").error, /ไม่รู้จัก/);
  assert.match(c.parseClipUrl("https://x.com/file.pdf").error, /\.mp3/);
  assert.equal(c.parseClipUrl("http://").ok, false);
});

test("splitSentences: จบประโยคทั่วไป ?! และไม่ตัดที่คำย่อ/ทศนิยม/ตัวพิมพ์เล็กตามหลัง", () => {
  assert.deepEqual(c.splitSentences("Hello there. How are you? I'm fine! Thanks."), ["Hello there.", "How are you?", "I'm fine!", "Thanks."]);
  assert.deepEqual(c.splitSentences("Dr. Smith met Mr. Jones at 3.5 p.m. yesterday. They talked."), ["Dr. Smith met Mr. Jones at 3.5 p.m. yesterday.", "They talked."]);
  assert.deepEqual(c.splitSentences("He said it costs e.g. five dollars. Really? yes, really."), ["He said it costs e.g. five dollars.", "Really?", "yes, really."]);
  assert.deepEqual(c.splitSentences('She said "stop." Then she left.'), ['She said "stop."', "Then she left."]);
  assert.deepEqual(c.splitSentences("Wait... what happened? Nothing."), ["Wait... what happened?", "Nothing."]);
  assert.deepEqual(c.splitSentences("J. K. Rowling wrote it. Good book."), ["J. K. Rowling wrote it.", "Good book."]);
  assert.deepEqual(c.splitSentences(""), []);
  assert.deepEqual(c.splitSentences("No punctuation at all"), ["No punctuation at all"]);
});

test("splitSentences: ย่อหน้าเป็นขอบเขต, บรรทัดที่ถูกตัดกลางประโยคจะต่อกัน, บรรทัดที่จบประโยคแยกกัน", () => {
  assert.deepEqual(c.splitSentences("This is a long sentence that was\nwrapped by a narrow column. Next one here.\nAnd another line."),
    ["This is a long sentence that was wrapped by a narrow column.", "Next one here.", "And another line."]);
  assert.deepEqual(c.splitSentences("First paragraph without end\n\nSecond paragraph starts"), ["First paragraph without end", "Second paragraph starts"]);
  assert.deepEqual(c.splitSentences("  Many   spaces   here.  "), ["Many spaces here."]);
});

test("mergeSentences: แก้บทแล้วคงเวลาของประโยคที่ข้อความเหมือนเดิม", () => {
  const old = [{ text: "A.", t: 1.5 }, { text: "B.", t: null }, { text: "C.", t: 9 }, { text: "A.", t: 20 }];
  const merged = c.mergeSentences(old, ["A.", "New one.", "C.", "A.", "A."]);
  assert.deepEqual(merged, [{ text: "A.", t: 1.5 }, { text: "New one.", t: null }, { text: "C.", t: 9 }, { text: "A.", t: 20 }, { text: "A.", t: null }]);
  assert.equal(c.sentencesToText(merged.slice(0, 2)), "A.\nNew one.");
});

const S = [{ text: "one", t: 5 }, { text: "two", t: null }, { text: "three", t: 12.5 }, { text: "four", t: 20 }];

test("ผูกเวลา / ประโยคที่กำลังเล่น / ช่วงของประโยค", () => {
  const s2 = c.setSentenceTime(S, 1, 8.26);
  assert.equal(s2[1].t, 8.3);
  assert.equal(S[1].t, null);                                            // ไม่แก้ของเดิม
  assert.equal(c.setSentenceTime(S, 0, null)[0].t, null);
  assert.equal(c.activeSentence(S, 4), -1);
  assert.equal(c.activeSentence(S, 5), 0);
  assert.equal(c.activeSentence(S, 12.4), 0);
  assert.equal(c.activeSentence(S, 13), 2);
  assert.equal(c.activeSentence(S, 99), 3);
  assert.deepEqual(c.sentenceRange(S, 0, 60), { start: 5, end: 12.5 });   // ข้ามประโยคที่ยังไม่ผูกเวลา
  assert.deepEqual(c.sentenceRange(S, 3, 60), { start: 20, end: 60 });
  assert.deepEqual(c.sentenceRange(S, 3), { start: 20, end: null });
  assert.equal(c.sentenceRange(S, 1, 60), null);
  assert.equal(c.sentenceRange(S, 9), null);
});

test("tickDecision: เล่นเฉพาะช่วง, A–B loop, วนประโยค (ลำดับความสำคัญ)", () => {
  const base = { rangeStart: 10, rangeEnd: 30, loopA: null, loopB: null, loopOn: false, sentence: null };
  assert.deepEqual(c.tickDecision(15, base), {});
  assert.deepEqual(c.tickDecision(30, base), { seekTo: 10, pause: true });         // ถึงท้ายช่วง → หยุดและกลับต้นช่วง
  assert.deepEqual(c.tickDecision(29.97, base), { seekTo: 10, pause: true });      // ภายใน eps
  assert.deepEqual(c.tickDecision(2, base), { seekTo: 10 });                       // อยู่ก่อนช่วง
  assert.deepEqual(c.tickDecision(40, { ...base, rangeEnd: null }), {});           // ไม่ตั้งจุดจบ = เล่นถึงท้ายคลิป
  const ab = { ...base, loopA: 12, loopB: 18, loopOn: true };
  assert.deepEqual(c.tickDecision(17, ab), {});
  assert.deepEqual(c.tickDecision(18, ab), { seekTo: 12 });                        // วน ไม่หยุด
  assert.deepEqual(c.tickDecision(25, ab), { seekTo: 12 });                        // หลุดออกนอก A–B กลับเข้า
  assert.deepEqual(c.tickDecision(18, { ...ab, loopOn: false }), {});              // ปิดวน
  assert.deepEqual(c.tickDecision(18, { ...ab, loopA: 18, loopB: 12 }), {});       // B ก่อน A ไม่ถือว่าตั้งครบ
  const sent = { ...ab, sentence: { start: 14, end: 16 } };
  assert.deepEqual(c.tickDecision(16, sent), { seekTo: 14 });                      // วนประโยคมาก่อน A–B
  assert.deepEqual(c.tickDecision(15, sent), {});
  assert.deepEqual(c.tickDecision(100, { ...base, sentence: { start: 14, end: null } }), { seekTo: 10, pause: true });   // ประโยคสุดท้ายไม่มีจุดจบ → ใช้ช่วงที่ตั้ง
});

test("validateClip", () => {
  const ok = { title: "TED", start: 5, end: 60, level: "B1", accent: "us", sentences: [] };
  assert.equal(c.validateClip(ok), null);
  assert.equal(c.validateClip({ ...ok, start: null, end: null }), null);
  assert.match(c.validateClip({ ...ok, title: " " }), /ชื่อ/);
  assert.match(c.validateClip({ ...ok, end: 5 }), /มากกว่า/);
  assert.match(c.validateClip({ ...ok, start: -1 }), /ติดลบ/);
  assert.match(c.validateClip({ ...ok, start: undefined }), /นาที:วินาที/);
  assert.match(c.validateClip({ ...ok, level: "Z9" }), /ระดับ/);
  assert.match(c.validateClip({ ...ok, accent: "xx" }), /สำเนียง/);
  assert.match(c.validateClip({ ...ok, title: "x".repeat(121) }), /120/);
});

test("คลัง: นับรอบ + ตัวกรอง (ค้นหา/ระดับ/สำเนียง/หัวข้อ/ยังไม่เคยฝึก/เพลย์ลิสต์) แบบ AND", () => {
  const clips = [
    { id: "a", title: "Space talk", level: "B1", accent: "us", topic: "Science", sentences: [{ text: "Black holes are strange." }] },
    { id: "b", title: "Cooking", level: "A2", accent: "uk", topic: "Daily life", sentences: [] },
    { id: "c", title: "Space news", level: "B1", accent: "uk", topic: "science", sentences: [] },
  ];
  const events = [{ clipId: "a", kind: "round" }, { clipId: "a", kind: "round" }, { clipId: "b", kind: "sentence" }, { clipId: "c", kind: "round" }];
  const rounds = c.roundCounts(events);
  assert.equal(rounds.get("a"), 2);
  assert.equal(rounds.get("b"), undefined);
  const playlists = [{ id: "p1", clipIds: ["a", "b"] }];
  const ids = (cr) => c.filterClips(clips, cr, { rounds, playlists }).map((x) => x.id);
  assert.deepEqual(ids({}), ["a", "b", "c"]);
  assert.deepEqual(ids({ q: "space" }), ["a", "c"]);
  assert.deepEqual(ids({ q: "black holes" }), ["a"]);                          // ค้นในบทด้วย
  assert.deepEqual(ids({ level: "B1", accent: "uk" }), ["c"]);
  assert.deepEqual(ids({ topic: "SCIENCE" }), ["a", "c"]);
  assert.deepEqual(ids({ unpracticed: true }), ["b"]);                         // b มีแต่ event ระดับประโยค ไม่นับเป็นรอบ
  assert.deepEqual(ids({ playlist: "p1" }), ["a", "b"]);
  assert.deepEqual(ids({ playlist: "p1", level: "A2" }), ["b"]);
  assert.deepEqual(ids({ playlist: "none" }), []);
  assert.deepEqual(c.distinctTopics(clips), ["Daily life", "science", "Science"]);
});

// รัน: node --test tests/lexicon.test.mjs
// ไฟล์ js/lexicon.js เหลือเฉพาะตัวช่วยคำ/ข้อความและตัวเรียก Claude API (คำศัพท์มาจากคลังกลาง ดู vocab.test.mjs)
import test from "node:test";
import assert from "node:assert/strict";
import * as lx from "../js/lexicon.js";

const json = (body, status = 200) => ({ ok: status < 400, status, json: async () => body });

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

test("timeout: getJson ตัดคำขอที่ค้างและให้ข้อความไทย", async () => {
  const never = (url, { signal }) => new Promise((_, rej) => signal.addEventListener("abort", () => rej(new Error("aborted"))));
  const t0 = Date.now();
  await assert.rejects(lx.getJson("ai", "https://x", { fetchImpl: never, timeout: 50 }), (e) => {
    assert.equal(e.kind, "timeout");
    assert.match(lx.describeError(e), /ไม่ตอบกลับ/);
    return true;
  });
  assert.ok(Date.now() - t0 < 1500);
});

test("describeError: ทุกกรณีเป็นภาษาไทยและบอกวิธีแก้", () => {
  const E = (api, kind, status) => lx.describeError(new lx.ApiError(api, kind, { status }));
  assert.match(E("ai", "auth"), /API key.*ตั้งค่า/);
  assert.match(E("ai", "http", 404), /ชื่อรุ่น/);
  assert.match(E("ai", "http", 429), /429/);
  assert.match(E("ai", "http", 400), /ชื่อรุ่น/);
  assert.match(E("ai", "network"), /อินเทอร์เน็ต/);
  assert.match(E("ai", "http", 503), /ขัดข้อง/);
  assert.match(lx.describeError(new Error("x")), /ไม่คาดคิด/);
});

test("claudeText: ส่ง header ที่จำเป็น, อ่านเฉพาะ text block, key ผิด/ว่าง = auth", async () => {
  let req;
  const f = async (url, init) => {
    req = { url, init };
    return json({ content: [{ type: "thinking", thinking: "..." }, { type: "text", text: "สวัสดี" }, { type: "text", text: "!" }] });
  };
  const out = await lx.claudeText("hi", { apiKey: "k", model: "m1", fetchImpl: f });
  assert.equal(out, "สวัสดี!");
  assert.equal(req.url, lx.CLAUDE_URL);
  assert.equal(req.init.headers["x-api-key"], "k");
  assert.equal(req.init.headers["anthropic-version"], "2023-06-01");
  assert.equal(req.init.headers["anthropic-dangerous-direct-browser-access"], "true");
  assert.equal(JSON.parse(req.init.body).model, "m1");
  await assert.rejects(lx.claudeText("x", { apiKey: "", fetchImpl: f }), (e) => e.kind === "auth");
  await assert.rejects(lx.claudeText("x", { apiKey: "bad", fetchImpl: async () => json({ error: { message: "invalid x-api-key" } }, 401) }), (e) => e.kind === "auth");
});

test("thDisplay และ wordCount", () => {
  assert.equal(lx.thDisplay([{ text: "ก" }, { text: "ข" }]), "ก / ข");
  assert.equal(lx.thDisplay(null), "");
  assert.equal(lx.wordCount("She's a well-known doctor."), 4);
});

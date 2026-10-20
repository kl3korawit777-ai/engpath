// ทดสอบ firestore.rules โดยไม่ต้องใช้ emulator: ตีความเงื่อนไขของ rule ที่ใช้ (นิพจน์ง่าย ๆ ที่ตรงกับไวยากรณ์ JS)
// ตรวจ 2 อย่าง: (1) พฤติกรรมหลายผู้ใช้ — เจ้าของเท่านั้น, ไม่ล็อกอินไม่ได้, events ต่อท้ายอย่างเดียว, ห้ามลบ
//               (2) รายชื่อ collection ตรงกับ js/db.js (กันลืมอัปเดต rules แล้วบันทึกไม่ขึ้นแบบเงียบ ๆ)
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (p) => readFileSync(new URL(p, import.meta.url), "utf8");
const rules = read("../firestore.rules");
const dbSrc = read("../js/db.js");

const listFromDb = (name) => [...dbSrc.match(new RegExp(`export const ${name} = \\[([^\\]]*)\\]`))[1].matchAll(/"([^"]+)"/g)].map((m) => m[1]);
const MUTABLE = listFromDb("MUTABLE_COLS");
const EVENTS = listFromDb("EVENT_COLS");

// ---------- ตัวตีความ rule ----------
const stripComments = (s) => s.replace(/\/\/[^\n]*/g, "");
const clean = stripComments(rules);

/** คืนเงื่อนไขของ `allow <ops>: if <cond>;` ทั้งหมดใน match users/{userId}/{col}/{docId} */
function userRules() {
  const m = clean.match(/match \/users\/\{userId\}\/\{col\}\/\{docId\} \{([\s\S]*?)\n    \}/);
  assert.ok(m, "ต้องมี match users/{userId}/{col}/{docId}");
  const out = {};
  for (const a of m[1].matchAll(/allow ([a-z, ]+):\s*if ([\s\S]*?);/g)) for (const op of a[1].split(",").map((x) => x.trim())) out[op] = a[2].replace(/\s+/g, " ").trim();
  return out;
}
const R = userRules();

function evalRule(op, { auth, userId, col, docId, data }) {
  const cond = R[op];
  assert.ok(cond, `ไม่มี allow ${op}`);
  const isOwner = (u) => auth != null && auth.uid === u;
  const js = cond.replace(/\bcol in \[([^\]]*)\]/g, "[$1].includes(col)");
  return Boolean(new Function("request", "isOwner", "userId", "col", "docId", `return (${js});`)({ auth, resource: { data } }, isOwner, userId, col, docId));
}
const req = (extra) => ({ auth: { uid: "alice" }, userId: "alice", docId: "d1", data: { id: "d1" }, ...extra });
const ALL = [...MUTABLE, ...EVENTS];

test("เจ้าของอ่านได้ทุก collection ที่แอปใช้ — ผู้ใช้อื่น/ไม่ล็อกอินอ่านไม่ได้", () => {
  for (const col of ALL) {
    assert.equal(evalRule("read", req({ col })), true, col);
    assert.equal(evalRule("read", req({ col, auth: { uid: "bob" } })), false, `${col}: bob อ่านของ alice`);
    assert.equal(evalRule("read", req({ col, auth: null })), false, `${col}: ไม่ล็อกอิน`);
  }
});

test("สร้างได้เฉพาะเจ้าของใน collection ของแอป และ id ต้องตรงกับ doc id", () => {
  for (const col of ALL) {
    assert.equal(evalRule("create", req({ col })), true, col);
    assert.equal(evalRule("create", req({ col, auth: { uid: "bob" } })), false, `${col}: bob เขียนของ alice`);
    assert.equal(evalRule("create", req({ col, auth: null })), false, `${col}: ไม่ล็อกอิน`);
    assert.equal(evalRule("create", req({ col, data: { id: "other" } })), false, `${col}: id ไม่ตรง`);
  }
  assert.equal(evalRule("create", req({ col: "lexicon" })), false, "lexicon ถูกถอดออกแล้ว");
  assert.equal(evalRule("create", req({ col: "unknownCollection" })), false);
});

test("แก้ไขได้เฉพาะ collection ที่แก้ได้ — events ต่อท้ายอย่างเดียว; ผู้ใช้อื่นแก้ไม่ได้", () => {
  for (const col of MUTABLE) {
    assert.equal(evalRule("update", req({ col })), true, col);
    assert.equal(evalRule("update", req({ col, auth: { uid: "bob" } })), false, `${col}: bob แก้ของ alice`);
    assert.equal(evalRule("update", req({ col, auth: null })), false, col);
  }
  for (const col of EVENTS) assert.equal(evalRule("update", req({ col })), false, `${col} เป็น event แก้ไม่ได้`);
});

test("บัตรจากคลังกลาง (id = wordKey) และ doc id ที่มีช่องว่าง/อัญประกาศสร้างได้", () => {
  assert.equal(evalRule("create", req({ col: "cards", docId: "look after", data: { id: "look after" } })), true);
  assert.equal(evalRule("create", req({ col: "cards", docId: "o'clock", data: { id: "o'clock" } })), true);
});

test("ห้ามลบจริง และมี default deny สำหรับ path อื่นทั้งหมด", () => {
  assert.equal(R.delete, "false");
  assert.match(clean, /match \/\{document=\*\*\} \{\s*allow read, write: if false;\s*\}/);
  assert.equal([...clean.matchAll(/match \//g)].length, 3, "ต้องมีแค่ databases/.../documents, users/... และ default deny");
});

test("รายชื่อ collection ใน rules ตรงกับ js/db.js ทุกตัว (create = mutable + events, update = mutable)", () => {
  const list = (op) => [...R[op].match(/col in \[([^\]]*)\]/)[1].matchAll(/'([^']+)'/g)].map((m) => m[1]);
  assert.deepEqual([...list("create")].sort(), [...ALL].sort());
  assert.deepEqual([...list("update")].sort(), [...MUTABLE].sort());
  assert.ok(!ALL.includes("lexicon"), "db.js ต้องไม่มี lexicon แล้ว");
});

test("ทุก allow ใน users/... ต้องเช็กความเป็นเจ้าของ (ยกเว้น delete = false)", () => {
  for (const [op, cond] of Object.entries(R)) if (op !== "delete") assert.match(cond, /isOwner\(userId\)/, op);
  assert.match(clean, /request\.auth != null && request\.auth\.uid == userId/);
});

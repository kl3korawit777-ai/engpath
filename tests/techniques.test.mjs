// รัน: node --test tests/techniques.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { TECHNIQUES } from "../js/data/techniques.js";

const appSource = readFileSync(new URL("../js/app.js", import.meta.url), "utf8");
const routeKeys = [...appSource.matchAll(/^\s{2}(\w+): \{/gm)].map((m) => m[1]);

test("8 เทคนิค เรียง 01–08 ตามชื่อในไฟล์ Roadmap", () => {
  assert.deepEqual(TECHNIQUES.map((t) => t.id), ["01", "02", "03", "04", "05", "06", "07", "08"]);
  assert.deepEqual(TECHNIQUES.map((t) => t.name), [
    "Spaced Repetition", "Active Recall", "Comprehensible Input", "Chunking", "Shadowing", "Deliberate Practice", "Interleaving", "Consistency",
  ]);
  for (const t of TECHNIQUES) for (const k of ["subtitle", "text", "tryIt"]) assert.ok(t[k] && typeof t[k] === "string", `${t.id}.${k}`);
});

test("เทคนิคที่มีฟีเจอร์ต้องพาไปหน้าที่มีอยู่จริงในแอป; ที่ยังไม่มีเป็น planned", () => {
  assert.ok(routeKeys.includes("today") && routeKeys.includes("cards") && routeKeys.includes("errors"), "อ่านรายการ route จาก app.js ไม่ได้");
  for (const t of TECHNIQUES) {
    const f = t.feature;
    assert.ok(["available", "planned"].includes(f.status), t.id);
    if (f.status === "available") {
      assert.ok(f.label && f.href, `${t.id} ต้องมี label และ href`);
      assert.ok(routeKeys.includes(f.href.replace("#/", "")), `${t.id}: ไม่มีหน้า ${f.href}`);
    }
    if (f.href) assert.ok(routeKeys.includes(f.href.replace("#/", "")), `${t.id}: ไม่มีหน้า ${f.href}`);
  }
});

test("สถานะตามที่ตกลง: ทั้ง 8 เทคนิคใช้ได้แล้ว", () => {
  const by = Object.fromEntries(TECHNIQUES.map((t) => [t.id, t.feature.status]));
  assert.deepEqual(by, { "01": "available", "02": "available", "03": "available", "04": "available", "05": "available", "06": "available", "07": "available", "08": "available" });
  assert.equal(TECHNIQUES.find((t) => t.id === "06").feature.errorsTab, "practice");
});

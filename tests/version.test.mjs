import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { APP_VERSION, CHANGELOG } from "../js/version.js";

test("เวอร์ชันแอปเป็น semver และตรงกับรายการบนสุดของ changelog", () => {
  assert.match(APP_VERSION, /^\d+\.\d+\.\d+$/);
  assert.equal(CHANGELOG[0].version, APP_VERSION);
  assert.equal(new Set(CHANGELOG.map((c) => c.version)).size, CHANGELOG.length);
  for (const c of CHANGELOG) { assert.match(c.version, /^\d+\.\d+\.\d+$/); assert.ok(c.title && c.notes.length); }
});

test("service worker: ไฟล์ทุกไฟล์ใน SHELL มีอยู่จริง (กันลืมเพิ่ม/พิมพ์ผิดตอนเพิ่มโมดูลใหม่)", () => {
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  const shell = sw.slice(sw.indexOf("SHELL"), sw.indexOf("];", sw.indexOf("SHELL")));
  const files = [...shell.matchAll(/"([^"]+\.[a-z]+)"/g)].map((m) => m[1]).filter((f) => !f.startsWith("http"));
  assert.ok(files.length > 50);
  for (const f of files) assert.doesNotThrow(() => readFileSync(new URL(`../${f}`, import.meta.url)), f);
});

test("ทุกไฟล์ .js ใน js/ (ยกเว้นไฟล์ตั้งค่า Firebase) อยู่ใน SHELL ของ service worker", () => {
  const sw = readFileSync(new URL("../sw.js", import.meta.url), "utf8");
  const missing = [];
  const walk = (dir, rel) => {
    for (const e of readdirSync(new URL(`../${dir}`, import.meta.url), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${dir}/${e.name}`, rel);
      else if (e.name.endsWith(".js") && !/firebase-config/.test(e.name) && !sw.includes(`"${dir}/${e.name}"`)) missing.push(`${dir}/${e.name}`);
    }
  };
  walk("js", "");
  assert.deepEqual(missing, []);
});

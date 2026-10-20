// ตรวจ workflow ที่ deploy GitHub Pages: เผยแพร่เฉพาะไฟล์ของแอป และไฟล์ที่ service worker/หน้าเว็บต้องใช้อยู่ครบ
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";

const read = (p) => readFileSync(new URL(`../${p}`, import.meta.url), "utf8");
const wf = read(".github/workflows/pages.yml");
const cp = wf.match(/cp -r ([^\n]+) _site\//);
const published = cp ? cp[1].trim().split(/\s+/) : [];

test("workflow คัดลอกเฉพาะไฟล์ของแอป ไม่รวม tools/ tests/ docs/ .git", () => {
  assert.ok(published.length >= 7, "ต้องมีรายการไฟล์ที่เผยแพร่");
  for (const must of ["index.html", "manifest.json", "sw.js", "css", "js", "icons", "vendor", "vocab"]) assert.ok(published.includes(must), must);
  for (const never of ["tools", "tests", "docs", ".git", ".", "*", "work", "node_modules", "package.json", "firestore.rules", ".claude"]) assert.ok(!published.includes(never), `ห้ามเผยแพร่ ${never}`);
  for (const p of published) assert.ok(existsSync(new URL(`../${p}`, import.meta.url)), `${p} ต้องมีอยู่จริง`);
  assert.doesNotMatch(wf, /cp -r \.\s|cp -r \*|rsync[^\n]*\.\s/);
});

test("ทุกไฟล์ใน SHELL ของ service worker อยู่ในชุดที่เผยแพร่", () => {
  const sw = read("sw.js");
  const shell = sw.slice(sw.indexOf("const SHELL"), sw.indexOf("];", sw.indexOf("const SHELL")));
  const files = [...shell.matchAll(/"([^"]+)"/g)].map((m) => m[1]).filter((f) => f !== "./");
  const isPublished = (f) => published.some((p) => f === p || f.startsWith(`${p}/`));
  const missing = files.filter((f) => !isPublished(f));
  assert.deepEqual(missing, []);
});

test("index.html อ้างอิงเฉพาะไฟล์ที่เผยแพร่", () => {
  const html = read("index.html");
  const refs = [...html.matchAll(/(?:src|href)="([^"#?]+)"/g)].map((m) => m[1]).filter((u) => !/^(https?:|\/\/|data:)/.test(u));
  for (const r of refs) assert.ok(published.some((p) => r === p || r.startsWith(`${p}/`)), `${r} ไม่ได้ถูกเผยแพร่`);
});

test("workflow ใช้สิทธิ์ที่จำเป็นของ Pages และไม่ใส่ secret", () => {
  assert.match(wf, /pages: write/);
  assert.match(wf, /id-token: write/);
  assert.match(wf, /actions\/deploy-pages@v4/);
  assert.doesNotMatch(wf, /secrets\./);
});

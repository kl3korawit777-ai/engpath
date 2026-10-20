import test from "node:test";
import assert from "node:assert/strict";
import { findInLibrary } from "../js/wordnav.js";

const lib = new Map(["run", "study", "decide", "happy", "box"].map((k) => [k, { wordKey: k, word: k }]));
const peek = (k) => lib.get(k) || null;

test("findInLibrary: ตรงตัว, รูปผัน (ing/ed/s/ies/es) และคำนอกคลัง", () => {
  assert.equal(findInLibrary("Run", peek).wordKey, "run");
  assert.equal(findInLibrary("running", peek).wordKey, "run");
  assert.equal(findInLibrary("studies", peek).wordKey, "study");
  assert.equal(findInLibrary("studied", peek).wordKey, "study");
  assert.equal(findInLibrary("decided", peek).wordKey, "decide");
  assert.equal(findInLibrary("deciding", peek).wordKey, "decide");
  assert.equal(findInLibrary("boxes", peek).wordKey, "box");
  assert.equal(findInLibrary("zzzword", peek), null);
  assert.equal(findInLibrary("", peek), null);
});

test("findInLibrary: ตรงตัวมาก่อนรูปพื้นฐาน", () => {
  const l2 = new Map([["runs", { wordKey: "runs" }], ["run", { wordKey: "run" }]]);
  assert.equal(findInLibrary("runs", (k) => l2.get(k) || null).wordKey, "runs");
});

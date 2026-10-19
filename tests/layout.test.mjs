import test from "node:test";
import assert from "node:assert/strict";
import { forceLayout } from "../js/layout.js";

const dist = (p, a, b) => Math.hypot(p[2 * a] - p[2 * b], p[2 * a + 1] - p[2 * b + 1]);

test("forceLayout: ผลคงที่เมื่อ seed เท่ากัน และค่าทุกตัวเป็นตัวเลขจำกัด", () => {
  const edges = [0, 1, 1, 2, 2, 3];
  const a = forceLayout({ n: 4, edges, seed: 7 }), b = forceLayout({ n: 4, edges, seed: 7 });
  assert.deepEqual([...a], [...b]);
  assert.ok([...a].every(Number.isFinite));
  assert.notDeepEqual([...a], [...forceLayout({ n: 4, edges, seed: 8 })]);
});

test("forceLayout: โหนดที่เชื่อมกันอยู่ใกล้กว่าโหนดที่ไม่เชื่อม", () => {
  // สองกลุ่มสามเหลี่ยมแยกกัน
  const edges = [0, 1, 1, 2, 0, 2, 3, 4, 4, 5, 3, 5];
  const p = forceLayout({ n: 6, edges, iterations: 400, seed: 3 });
  const within = (dist(p, 0, 1) + dist(p, 1, 2) + dist(p, 0, 2) + dist(p, 3, 4) + dist(p, 4, 5) + dist(p, 3, 5)) / 6;
  const across = (dist(p, 0, 3) + dist(p, 1, 4) + dist(p, 2, 5)) / 3;
  assert.ok(within < across, `within ${within} across ${across}`);
});

test("forceLayout: โหนดไม่ซ้อนกัน และเคารพตำแหน่งเริ่มต้นที่ให้มา (n=1 / ว่างไม่พัง)", () => {
  const p = forceLayout({ n: 30, edges: [], iterations: 200, seed: 1 });
  let min = Infinity;
  for (let i = 0; i < 30; i++) for (let j = i + 1; j < 30; j++) min = Math.min(min, dist(p, i, j));
  assert.ok(min > 5, `min ${min}`);
  assert.equal(forceLayout({ n: 1 }).length, 2);
  assert.equal(forceLayout({ n: 0 }).length, 0);
  const init = new Float32Array([100, 100, NaN, NaN]);
  const q = forceLayout({ n: 2, edges: [0, 1], iterations: 0, init });
  assert.deepEqual([q[0], q[1]], [100, 100]);
  assert.ok(Number.isFinite(q[2]));
});

test("forceLayout: 1,000 โหนด / 7,000 เส้น เสร็จในเวลาที่ยอมรับได้", () => {
  const n = 1000, edges = [];
  let s = 5; const r = () => (s = (s * 1103515245 + 12345) % 2147483648) / 2147483648;
  for (let i = 0; i < 7000; i++) { const c = Math.floor(r() * (n / 20)) * 20; edges.push(c + Math.floor(r() * 20), c + Math.floor(r() * 20)); }
  const t = Date.now();
  const p = forceLayout({ n, edges: edges.filter((_, i) => true), iterations: 250, seed: 2 });
  const ms = Date.now() - t;
  assert.ok([...p].every(Number.isFinite));
  assert.ok(ms < 8000, `ใช้เวลา ${ms} ms`);
  console.log(`# layout 1000 โหนด: ${ms} ms`);
});

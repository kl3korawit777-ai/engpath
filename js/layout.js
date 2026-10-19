// Force-directed layout (Fruchterman–Reingold + spatial grid) แบบ pure — รันใน Web Worker ได้ (layout-worker.js) ไม่บล็อกหน้าจอ
// เร็วกว่า layout cose ที่มากับ Cytoscape มากเมื่อโหนดหลักพัน (cose 1,000 โหนด/7,000 เส้น ≈ 24 วินาทีบนเครื่องทดสอบ)

function mulberry(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}

/**
 * n โหนด, edges = [a0,b0,a1,b1,...] (index โหนด) → Float32Array [x0,y0,x1,y1,...] กึ่งกลางที่ (0,0)
 * init (ไม่บังคับ) = ตำแหน่งเริ่มต้นรูปแบบเดียวกัน (NaN = สุ่มให้)
 */
export function forceLayout({ n, edges = [], iterations = 300, seed = 1, k = 55, init = null }) {
  const rnd = mulberry(seed);
  const pos = new Float32Array(2 * n), disp = new Float32Array(2 * n);
  const R0 = Math.sqrt(n) * k * 0.6;
  for (let i = 0; i < n; i++) {
    const hasInit = init && Number.isFinite(init[2 * i]) && Number.isFinite(init[2 * i + 1]);
    if (hasInit) { pos[2 * i] = init[2 * i]; pos[2 * i + 1] = init[2 * i + 1]; }
    else { const r = R0 * Math.sqrt(rnd()), a = rnd() * Math.PI * 2; pos[2 * i] = r * Math.cos(a); pos[2 * i + 1] = r * Math.sin(a); }
  }
  if (n < 2) return pos;
  const cutoff = k * 3, cutoff2 = cutoff * cutoff;
  let temp = k * 4;
  const cool = Math.pow(0.02, 1 / Math.max(1, iterations));        // อุณหภูมิลดเหลือ ~2% ตอนท้าย

  for (let it = 0; it < iterations; it++) {
    disp.fill(0);
    // grid: เซลล์ขนาด cutoff → เทียบเฉพาะโหนดในเซลล์ใกล้เคียง
    const cells = new Map();
    for (let i = 0; i < n; i++) {
      const key = Math.floor(pos[2 * i] / cutoff) * 100003 + Math.floor(pos[2 * i + 1] / cutoff);
      const c = cells.get(key);
      if (c) c.push(i); else cells.set(key, [i]);
    }
    for (let i = 0; i < n; i++) {
      const cx = Math.floor(pos[2 * i] / cutoff), cy = Math.floor(pos[2 * i + 1] / cutoff);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const c = cells.get((cx + dx) * 100003 + (cy + dy));
        if (!c) continue;
        for (const j of c) {
          if (j <= i) continue;
          let vx = pos[2 * i] - pos[2 * j], vy = pos[2 * i + 1] - pos[2 * j + 1];
          let d2 = vx * vx + vy * vy;
          if (d2 >= cutoff2) continue;
          if (d2 < 0.01) { vx = rnd() - 0.5; vy = rnd() - 0.5; d2 = vx * vx + vy * vy + 0.01; }
          const f = (k * k) / d2;                                  // แรงผลัก k²/d (หารเวกเตอร์ด้วย d อีกครั้งรวมเป็น /d²)
          disp[2 * i] += vx * f; disp[2 * i + 1] += vy * f;
          disp[2 * j] -= vx * f; disp[2 * j + 1] -= vy * f;
        }
      }
    }
    for (let e = 0; e + 1 < edges.length; e += 2) {
      const a = edges[e], b = edges[e + 1];
      const vx = pos[2 * a] - pos[2 * b], vy = pos[2 * a + 1] - pos[2 * b + 1];
      const d = Math.sqrt(vx * vx + vy * vy) || 0.01;
      const f = d / k;                                             // แรงดึง d²/k หารด้วย d
      disp[2 * a] -= vx * f; disp[2 * a + 1] -= vy * f;
      disp[2 * b] += vx * f; disp[2 * b + 1] += vy * f;
    }
    for (let i = 0; i < n; i++) {
      // แรงโน้มถ่วงอ่อน ๆ เข้าศูนย์กลาง กันกลุ่มที่ไม่เชื่อมกันลอยหาย
      disp[2 * i] -= pos[2 * i] * 0.05; disp[2 * i + 1] -= pos[2 * i + 1] * 0.05;
      const dx = disp[2 * i], dy = disp[2 * i + 1];
      const len = Math.sqrt(dx * dx + dy * dy) || 1;
      const step = Math.min(len, temp);
      pos[2 * i] += (dx / len) * step; pos[2 * i + 1] += (dy / len) * step;
    }
    temp *= cool;
  }
  return pos;
}

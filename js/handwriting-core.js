// Handwriting แบบ pure (ไม่แตะ DOM/canvas/DB): ระดับ, เรขาคณิตกรอบเขียน, เส้นหมึก, การให้คะแนน, แหล่งคำ
import { HW } from "./data/handwriting-config.js";
import { isDue } from "./srs.js";
import { wordKey } from "./lexicon.js";

export const LEVELS = ["trace", "fade", "copy", "recall"];
export const LEVEL_LABELS = { trace: "Trace", fade: "Fade", copy: "Copy", recall: "Recall" };
export const STYLES = ["print", "cursive"];

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
export const levelKey = (key, style) => `${key}|${style}`;

// ---------- ระดับ (คำนวณจาก attempts เสมอ ไม่เก็บตัวนับ) ----------
/**
 * Trace/Fade: ได้ ≥ levelUpAt ในระดับปัจจุบัน → ขึ้นหนึ่งระดับ, ต่ำกว่านั้นอยู่ที่เดิม
 * Copy/Recall: ตามการให้คะแนนตัวเอง (cfg.selfRatingDelta: ยังไม่ได้ = -1, เขียนได้ = 0, ง่ายมาก = +1)
 * ฝึกนอกระดับปัจจุบัน (เลือกระดับเอง) ไม่นับเป็นการเลื่อน
 */
export function applyAttempt(level, attempt, cfg = HW) {
  if (attempt.level !== level) return level;
  const i = LEVELS.indexOf(level);
  if (level === "trace" || level === "fade") {
    return typeof attempt.score === "number" && attempt.score >= cfg.score.levelUpAt ? LEVELS[Math.min(i + 1, LEVELS.length - 1)] : level;
  }
  const d = cfg.selfRatingDelta[attempt.selfRating] ?? 0;
  return LEVELS[clamp(i + d, 0, LEVELS.length - 1)];
}

const byTime = (a, b) => (a.at - b.at) || ((a.createdAt || 0) - (b.createdAt || 0)) || (a.id < b.id ? -1 : 1);

/** Map "wordKey|style" → { level, count, lastAt, lastScore, lastRating } */
export function levelsFromAttempts(attempts, cfg = HW) {
  const m = new Map();
  for (const a of [...attempts].sort(byTime)) {
    const k = levelKey(a.wordKey, a.style);
    const cur = m.get(k) || { level: "trace", count: 0, lastAt: 0, lastScore: null, lastRating: null };
    m.set(k, {
      level: applyAttempt(cur.level, a, cfg), count: cur.count + 1, lastAt: a.at,
      lastScore: typeof a.score === "number" ? a.score : cur.lastScore, lastRating: typeof a.selfRating === "number" ? a.selfRating : cur.lastRating,
    });
  }
  return m;
}

export const levelOfWord = (levels, key, style) => levels.get(levelKey(key, style))?.level || "trace";

// ---------- เรขาคณิตกรอบเขียน ----------
/** วางกรอบ (bw×bh) ลงในผืน (cw×ch) แบบรักษาอัตราส่วน กึ่งกลาง */
export function fitBox(cw, ch, bw, bh) {
  const scale = Math.min(cw / bw, ch / bh);
  return { scale, ox: (cw - bw * scale) / 2, oy: (ch - bh * scale) / 2, w: bw * scale, h: bh * scale };
}

/** พิกเซลบนผืน → พิกัด normalized (0–1) ของกรอบ */
export function toNorm(px, py, fit, bw, bh) {
  return [(px - fit.ox) / (bw * fit.scale), (py - fit.oy) / (bh * fit.scale)];
}
export function fromNorm(nx, ny, fit, bw, bh) {
  return [fit.ox + nx * bw * fit.scale, fit.oy + ny * bh * fit.scale];
}

/**
 * จาก metrics ของฟอนต์จริง (หน่วย em ที่ได้จาก measureText) → กรอบและเส้นบรรทัด 4 เส้น
 * ascH = ความสูง 'h' (เส้นบน), xH = ความสูง 'x' (เส้นประกลาง), descG = ความลึกของ 'gjpqy' (เส้นหาง)
 * textAsc/textDesc = ขอบเขตจริงของข้อความ (ตัวพิมพ์ใหญ่อาจสูงกว่า 'h')
 */
export function layoutFromMetrics(m, box = HW.box) {
  const asc = Math.max(m.ascH, m.textAsc ?? 0);
  const desc = Math.max(m.descG, m.textDesc ?? 0);
  const boxW = Math.max(box.minWidthEm, m.textWidth + 2 * box.padX);
  const baseY = box.padY + asc;
  return {
    boxW, boxH: asc + desc + 2 * box.padY,
    textX: (boxW - m.textWidth) / 2, baseY, textWidth: m.textWidth,
    lines: { top: baseY - asc, mid: baseY - m.xH, base: baseY, tail: baseY + desc },
  };
}

/** ช่วงแนวนอนของแต่ละตัวอักษร (em) จากความกว้างของ prefix — ใช้ตัดแบ่งตัวอักษรตอนให้คะแนน */
export function letterRanges(text, widthOfPrefix, textX = 0) {
  const out = [];
  for (let i = 0; i < text.length; i++) {
    if (/\s/.test(text[i])) continue;
    out.push({ ch: text[i], i, x0: textX + widthOfPrefix(text.slice(0, i)), x1: textX + widthOfPrefix(text.slice(0, i + 1)) });
  }
  return out;
}

// ---------- เส้นหมึก ----------
/** stroke = { w: ตัวคูณความหนา, pts: [[x, y, pressure], ...] } พิกัด x,y เป็น 0–1 ของกรอบ */
export function strokeWidthEm(pressure, thickness = 1, cfg = HW.ink) {
  const p = clamp(pressure ?? cfg.mousePressure, 0, 1);
  return cfg.baseWidthEm * thickness * (cfg.pressureMin + (cfg.pressureMax - cfg.pressureMin) * p);
}

function distToSeg(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? clamp(((px - ax) * dx + (py - ay) * dy) / len2, 0, 1) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/** ยางลบ: จุด (nx, ny) แตะเส้นนี้ไหม (ระยะวัดเป็น em ในกรอบ bw×bh) */
export function hitStroke(stroke, nx, ny, bw, bh, radiusEm) {
  const pts = stroke.pts;
  const px = nx * bw, py = ny * bh;
  if (pts.length === 1) return Math.hypot(px - pts[0][0] * bw, py - pts[0][1] * bh) <= radiusEm;
  for (let i = 1; i < pts.length; i++) {
    if (distToSeg(px, py, pts[i - 1][0] * bw, pts[i - 1][1] * bh, pts[i][0] * bw, pts[i][1] * bh) <= radiusEm) return true;
  }
  return false;
}

/** เส้นนี้ยังอยู่ในกรอบ (กรองข้อมูลผิดรูป) */
export const isValidStroke = (s) => Boolean(s) && Array.isArray(s.pts) && s.pts.length > 0 && s.pts.every((p) => Array.isArray(p) && p.length >= 2 && p.every((v) => Number.isFinite(v)));

// ---------- มาสก์พิกเซล + การให้คะแนน ----------
/** วาดเส้นหมึกลงมาสก์ (ไม่ใช้ canvas) คืน { mask, w, h } — กรอบ boxW×boxH em ที่ pxPerEm */
export function rasterStrokes(strokes, boxW, boxH, pxPerEm = HW.score.maskPxPerEm, strokeEm = HW.score.inkStrokeEm) {
  const w = Math.max(1, Math.ceil(boxW * pxPerEm)), h = Math.max(1, Math.ceil(boxH * pxPerEm));
  const mask = new Uint8Array(w * h);
  const r = Math.max(1, (strokeEm * pxPerEm) / 2);
  const stamp = (cx, cy) => {
    const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(w - 1, Math.ceil(cx + r));
    const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(h - 1, Math.ceil(cy + r));
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) if ((x - cx) ** 2 + (y - cy) ** 2 <= r * r) mask[y * w + x] = 1;
  };
  for (const s of strokes) {
    if (!isValidStroke(s)) continue;
    const P = s.pts.map(([x, y]) => [x * w, y * h]);
    stamp(P[0][0], P[0][1]);
    for (let i = 1; i < P.length; i++) {
      const [ax, ay] = P[i - 1], [bx, by] = P[i];
      const steps = Math.max(1, Math.ceil(Math.hypot(bx - ax, by - ay) / Math.max(1, r / 2)));
      for (let k = 1; k <= steps; k++) stamp(ax + ((bx - ax) * k) / steps, ay + ((by - ay) * k) / steps);
    }
  }
  return { mask, w, h };
}

/** ขยายมาสก์ด้วยตัวแปลงสี่เหลี่ยมรัศมี r (แยกแกน ใช้ prefix sum) */
export function dilate(mask, w, h, r) {
  if (r <= 0) return Uint8Array.from(mask);
  const tmp = new Uint8Array(w * h), out = new Uint8Array(w * h);
  const prefix = new Int32Array(Math.max(w, h) + 1);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) prefix[x + 1] = prefix[x] + mask[y * w + x];
    for (let x = 0; x < w; x++) tmp[y * w + x] = prefix[Math.min(w, x + r + 1)] - prefix[Math.max(0, x - r)] > 0 ? 1 : 0;
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) prefix[y + 1] = prefix[y] + tmp[y * w + x];
    for (let y = 0; y < h; y++) out[y * w + x] = prefix[Math.min(h, y + r + 1)] - prefix[Math.max(0, y - r)] > 0 ? 1 : 0;
  }
  return out;
}

/**
 * ให้คะแนนลายมือเทียบรอย (Trace/Fade)
 *   coverage = % พิกเซลของรอยที่ถูกหมึก (ขยายเส้น) ทับ
 *   accuracy = % พิกเซลหมึกที่อยู่ในแถบรอบตัวอักษร
 *   score = 100 · (0.55·coverage + 0.45·accuracy)   (น้ำหนัก/รัศมี/เกณฑ์สีแดงอยู่ใน HW.score)
 * letters: [{ ch, x0, x1 }] ช่วงคอลัมน์ในมาสก์ (px) — ตัวที่ coverage < letterRedBelow ถูกทำเครื่องหมาย bad
 */
export function scoreAttempt({ guide, ink, w, h, letters = [] }, cfg = HW.score) {
  const rInk = Math.max(0, Math.round(cfg.inkRadiusEm * cfg.maskPxPerEm));
  const rBand = Math.max(0, Math.round(cfg.bandRadiusEm * cfg.maskPxPerEm));
  const inkD = dilate(ink, w, h, rInk);
  const band = dilate(guide, w, h, rBand);
  let guideN = 0, covered = 0, inkN = 0, inBand = 0;
  for (let i = 0; i < guide.length; i++) {
    if (guide[i]) { guideN++; if (inkD[i]) covered++; }
    if (ink[i]) { inkN++; if (band[i]) inBand++; }
  }
  const coverage = guideN ? covered / guideN : 0;
  const accuracy = inkN ? inBand / inkN : 0;
  const perLetter = letters.map((l) => {
    const x0 = Math.max(0, Math.floor(l.x0)), x1 = Math.min(w, Math.ceil(l.x1));
    let g = 0, c = 0;
    for (let y = 0; y < h; y++) for (let x = x0; x < x1; x++) { const i = y * w + x; if (guide[i]) { g++; if (inkD[i]) c++; } }
    const cov = g ? c / g : 0;
    return { ch: l.ch, x0: l.x0, x1: l.x1, coverage: cov, bad: cov < cfg.letterRedBelow };
  });
  const score = Math.round(100 * (cfg.coverageWeight * coverage + cfg.accuracyWeight * accuracy));
  return { coverage, accuracy, score, letters: perLetter, badLetters: perLetter.filter((l) => l.bad).map((l) => l.ch) };
}

// ---------- รูปลายมือย่อ ----------
export const dataUrlBytes = (dataUrl) => {
  const b64 = String(dataUrl).split(",")[1] || "";
  return Math.floor((b64.length * 3) / 4) - (b64.endsWith("==") ? 2 : b64.endsWith("=") ? 1 : 0);
};

/**
 * เข้ารหัส JPEG ให้ไม่เกิน maxBytes: ลด quality ทีละขั้น ถ้ายังใหญ่ลดความกว้างลง 15% แล้วเริ่มใหม่
 * encode(quality, width) → { dataUrl, w, h } (ฟังก์ชันที่ผู้เรียกให้ — ใช้ canvas.toDataURL ในเบราว์เซอร์)
 */
export async function fitJpeg(encode, cfg = HW.image) {
  let width = cfg.width;
  for (let shrink = 0; shrink < 4; shrink++) {
    for (let q = cfg.quality; q >= cfg.minQuality - 1e-9; q -= cfg.qualityStep) {
      const r = await encode(Math.round(q * 100) / 100, width);
      const bytes = dataUrlBytes(r.dataUrl);
      if (bytes <= cfg.maxBytes) return { ...r, bytes, quality: Math.round(q * 100) / 100 };
    }
    width = Math.round(width * 0.85);
  }
  throw new Error("ภาพลายมือใหญ่เกินกำหนด");
}

// ---------- แหล่งคำ ----------
export const isWritable = (text, max = HW.maxPhraseLength) => {
  const t = String(text || "").trim();
  return t.length > 0 && t.length <= max && /^[\p{L}\p{N} '’.,!?-]+$/u.test(t);
};

const uniqBy = (items) => {
  const seen = new Set();
  return items.filter((i) => (seen.has(i.wordKey) ? false : (seen.add(i.wordKey), true)));
};
const item = (text, source, extra = {}) => ({ text: text.trim(), wordKey: wordKey(text), source, ...extra });

/**
 * คำที่เสนอให้คัดลายมือแยกตามแหล่ง:
 *   due       บัตรคำที่ถึงรอบ
 *   focus     คำ/วลีที่ถูกจากข้อผิดในจุดเน้น Error Log
 *   shadowing วลีที่ส่งมาจาก Shadowing (handwritingWords source=shadowing)
 *   manual    รายการที่เพิ่มเอง
 */
export function candidateWords({ cards = [], states = new Map(), focusErrors = [], customWords = [], now, max = HW.maxPhraseLength }) {
  const ok = (t) => isWritable(t, max);
  const word = (w) => item(w.text, w.source, { id: w.id });
  return {
    due: uniqBy(cards.filter((c) => ok(c.en) && states.get(c.id) && isDue(states.get(c.id), now)).map((c) => item(c.en, "due", { th: c.th, cardId: c.id }))),
    focus: uniqBy(focusErrors.filter((e) => ok(e.right)).map((e) => item(e.right, "focus", { errorId: e.id }))),
    shadowing: uniqBy(customWords.filter((w) => w.source === "shadowing" && ok(w.text)).map(word)),
    manual: uniqBy(customWords.filter((w) => w.source !== "shadowing" && ok(w.text)).map(word)),
  };
}

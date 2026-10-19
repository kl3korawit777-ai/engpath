// Handwriting: ส่วนที่ต้องใช้ canvas/ฟอนต์ (เบราว์เซอร์เท่านั้น) — ตรรกะคำนวณอยู่ใน handwriting-core.js
import { HW } from "./data/handwriting-config.js";
import * as core from "./handwriting-core.js";

const REF = 100;                          // ขนาดอ้างอิง (px) ตอนวัดฟอนต์
const COLORS = {
  line: "#D9D0BF", lineStrong: "#B9AF9B", guideFill: "rgba(120, 112, 96, .26)", guideDash: "#9C9482",
  reveal: "rgba(46, 94, 78, .48)", bad: "rgba(180, 67, 47, .7)", paper: "#FFFDF8",
};

// ---------- ฟอนต์ ----------
/** โหลดฟอนต์ของรูปแบบนี้ (ต้องออนไลน์ครั้งแรก แล้ว service worker cache ไว้ใช้ออฟไลน์) คืน true ถ้าได้ฟอนต์จริง */
export async function ensureFont(style, sample = "abcdefghijklmnopqrstuvwxyz") {
  const f = HW.fonts[style];
  try { await document.fonts.load(`400 ${REF}px ${f.css}`, sample); } catch { /* ใช้ฟอนต์สำรอง */ }
  return [...document.fonts].some((ff) => ff.family.replace(/["']/g, "") === f.family && ff.status === "loaded");
}

let measureCtx = null;
const mctx = () => (measureCtx ||= document.createElement("canvas").getContext("2d"));

/** วัดฟอนต์จริงด้วย measureText → กรอบ เส้นบรรทัด 4 เส้น และช่วงตัวอักษร (หน่วย em) */
export function measureLayout(text, style) {
  const c = mctx();
  c.font = `400 ${REF}px ${HW.fonts[style].css}`;
  const m = (s) => c.measureText(s);
  const em = (v, fb) => (Number.isFinite(v) ? v / REF : fb);
  const all = m(text);
  const layout = core.layoutFromMetrics({
    textWidth: all.width / REF,
    ascH: em(m("h").actualBoundingBoxAscent, 0.75),
    xH: em(m("x").actualBoundingBoxAscent, 0.5),
    descG: em(m("gjpqy").actualBoundingBoxDescent, 0.22),
    textAsc: em(all.actualBoundingBoxAscent, 0),
    textDesc: em(all.actualBoundingBoxDescent, 0),
  });
  const letters = core.letterRanges(text, (p) => (p ? m(p).width / REF : 0), layout.textX);
  return { ...layout, letters };
}

// ---------- วาด ----------
const px = (fit, em) => fit.scale * em;

function setFont(ctx, style, fit) { ctx.font = `400 ${fit.scale}px ${HW.fonts[style].css}`; ctx.textBaseline = "alphabetic"; }

/** เส้นบรรทัด 4 เส้น: บน / เส้นประกลาง / ฐาน / หาง */
export function drawLines(ctx, layout, fit) {
  const { lines, boxW } = layout;
  ctx.save();
  const hline = (y, color, dash, w) => {
    ctx.strokeStyle = color; ctx.lineWidth = w; ctx.setLineDash(dash);
    ctx.beginPath(); ctx.moveTo(fit.ox, fit.oy + y * fit.scale); ctx.lineTo(fit.ox + boxW * fit.scale, fit.oy + y * fit.scale); ctx.stroke();
  };
  hline(lines.top, COLORS.line, [], 1);
  hline(lines.mid, COLORS.lineStrong, [6, 6], 1);
  hline(lines.base, COLORS.lineStrong, [], 1.5);
  hline(lines.tail, COLORS.line, [], 1);
  ctx.restore();
}

/** ชั้นรอยจาง: Trace = ตัวอักษรเทาจาง, Fade = เส้นขอบประ, Copy/Recall = เหลือแต่เส้นบรรทัด */
export function drawGuide(ctx, layout, text, style, level, fit) {
  drawLines(ctx, layout, fit);
  if (level !== "trace" && level !== "fade") return;
  ctx.save();
  setFont(ctx, style, fit);
  const x = fit.ox + layout.textX * fit.scale, y = fit.oy + layout.baseY * fit.scale;
  if (level === "trace") { ctx.fillStyle = COLORS.guideFill; ctx.fillText(text, x, y); }
  else { ctx.strokeStyle = COLORS.guideDash; ctx.lineWidth = 1.5; ctx.setLineDash([5, 5]); ctx.strokeText(text, x, y); }
  ctx.restore();
}

/** ชั้นทับ: เฉลยสีเขียวมอสทับลายมือ + ตัวอักษรที่พลาดเป็นสีแดง */
export function drawOverlay(ctx, layout, text, style, fit, { reveal = false, badLetters = [] } = {}) {
  ctx.save();
  setFont(ctx, style, fit);
  const x = fit.ox + layout.textX * fit.scale, y = fit.oy + layout.baseY * fit.scale;
  if (reveal) { ctx.fillStyle = COLORS.reveal; ctx.fillText(text, x, y); }
  for (const l of badLetters) {
    ctx.save();
    ctx.beginPath();
    ctx.rect(fit.ox + l.x0 * fit.scale, fit.oy, (l.x1 - l.x0) * fit.scale, fit.scale * layout.boxH);
    ctx.clip();
    ctx.fillStyle = COLORS.bad; ctx.fillText(text, x, y);
    ctx.restore();
  }
  ctx.restore();
}

export function drawSegment(ctx, a, b, fit, layout, thickness) {
  const w = Math.max(1, px(fit, core.strokeWidthEm((a[2] + b[2]) / 2, thickness)));
  ctx.lineWidth = w; ctx.lineCap = "round"; ctx.lineJoin = "round"; ctx.strokeStyle = HW.ink.color;
  ctx.beginPath();
  ctx.moveTo(fit.ox + a[0] * layout.boxW * fit.scale, fit.oy + a[1] * layout.boxH * fit.scale);
  ctx.lineTo(fit.ox + b[0] * layout.boxW * fit.scale, fit.oy + b[1] * layout.boxH * fit.scale);
  ctx.stroke();
}

export function drawStroke(ctx, stroke, fit, layout) {
  const pts = stroke.pts;
  if (pts.length === 1) { drawSegment(ctx, [pts[0][0], pts[0][1], pts[0][2] ?? 0.5], [pts[0][0] + 1e-4, pts[0][1], pts[0][2] ?? 0.5], fit, layout, stroke.w); return; }
  for (let i = 1; i < pts.length; i++) drawSegment(ctx, pts[i - 1], pts[i], fit, layout, stroke.w);
}

export function drawInk(ctx, strokes, fit, layout) {
  ctx.save();
  for (const s of strokes) if (core.isValidStroke(s)) drawStroke(ctx, s, fit, layout);
  ctx.restore();
}

// ---------- การให้คะแนน (offscreen, ความละเอียดลด) ----------
export function guideMask(layout, text, style) {
  const PX = HW.score.maskPxPerEm;
  const w = Math.max(1, Math.ceil(layout.boxW * PX)), h = Math.max(1, Math.ceil(layout.boxH * PX));
  const cv = document.createElement("canvas");
  cv.width = w; cv.height = h;
  const c = cv.getContext("2d", { willReadFrequently: true });
  c.font = `400 ${PX}px ${HW.fonts[style].css}`; c.textBaseline = "alphabetic"; c.fillStyle = "#000";
  c.fillText(text, layout.textX * PX, layout.baseY * PX);
  const data = c.getImageData(0, 0, w, h).data;
  const mask = new Uint8Array(w * h);
  for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] >= HW.score.guideAlphaMin ? 1 : 0;
  return { mask, w, h };
}

/** ให้คะแนนจากเส้นที่เขียน (strokes normalized) กับรอยของคำนี้ */
export function scoreStrokes(layout, text, style, strokes) {
  const PX = HW.score.maskPxPerEm;
  const g = guideMask(layout, text, style);
  const ink = core.rasterStrokes(strokes, layout.boxW, layout.boxH, PX, HW.score.inkStrokeEm);
  const letters = layout.letters.map((l) => ({ ch: l.ch, x0: l.x0 * PX, x1: l.x1 * PX }));
  const r = core.scoreAttempt({ guide: g.mask, ink: ink.mask, w: g.w, h: g.h, letters });
  // ส่งช่วงตัวอักษรกลับเป็น em ให้ชั้นทับวาดสีแดงได้
  r.letters = r.letters.map((l) => ({ ...l, x0: l.x0 / PX, x1: l.x1 / PX }));
  return r;
}

// ---------- รูปย่อ (JPEG) ----------
export async function exportJpeg(layout, strokes, { fitJpeg = core.fitJpeg } = {}) {
  const encode = async (quality, width) => {
    const cv = document.createElement("canvas");
    const scale = width / layout.boxW;
    cv.width = Math.round(width); cv.height = Math.round(layout.boxH * scale);
    const c = cv.getContext("2d");
    c.fillStyle = COLORS.paper; c.fillRect(0, 0, cv.width, cv.height);
    const fit = { scale, ox: 0, oy: 0 };
    drawLines(c, layout, fit);
    drawInk(c, strokes, fit, layout);
    return { dataUrl: cv.toDataURL("image/jpeg", quality), w: cv.width, h: cv.height };
  };
  return fitJpeg(encode);
}

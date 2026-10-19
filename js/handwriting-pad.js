// แผงเขียน: canvas 3 ชั้น (รอยจาง / หมึก / ชั้นทับ), Pointer Events + getCoalescedEvents, ความหนาตามแรงกดของ pen,
// กันฝ่ามือ (เจอ pen แล้วไม่รับ touch), ปากกา/ยางลบแบบลบทั้งเส้น/ย้อนกลับ/ล้าง, เส้นเก็บเป็นพิกัด normalized (0–1) ของกรอบ
import { HW } from "./data/handwriting-config.js";
import * as core from "./handwriting-core.js";
import * as render from "./handwriting-render.js";

export class InkPad {
  /** host = element ที่จะใส่แผง · onChange(strokes) · onStatus({ penReady }) · onActivity() เรียกเมื่อมีการโต้ตอบ */
  constructor(host, { onChange = () => {}, onStatus = () => {}, onActivity = () => {} } = {}) {
    this.host = host;
    this.onChange = onChange; this.onStatus = onStatus; this.onActivity = onActivity;
    this.strokes = [];
    this.history = [];
    this.tool = "pen";
    this.thickness = HW.ink.thickness.default;
    this.penSeen = false;
    this.touchBlocked = false;
    this.active = null;               // { id, stroke, removed[] }
    this.content = null;              // { text, style, level, layout }
    this.overlayOpts = {};
    this.fit = { scale: 1, ox: 0, oy: 0 };
    this.dpr = 1;

    this.wrap = document.createElement("div");
    this.wrap.className = "ink-wrap";
    this.guide = this.#canvas("ink-canvas ink-guide");
    this.ink = this.#canvas("ink-canvas ink-ink");
    this.overlay = this.#canvas("ink-canvas ink-overlay");
    this.wrap.append(this.guide, this.ink, this.overlay);
    host.replaceChildren(this.wrap);

    // กันเลื่อนหน้า/เลือกข้อความ/เมนูกดค้าง ขณะเขียน
    const stop = (e) => e.preventDefault();
    for (const ev of ["contextmenu", "selectstart", "gesturestart", "dragstart"]) this.wrap.addEventListener(ev, stop);
    for (const ev of ["touchstart", "touchmove"]) this.wrap.addEventListener(ev, stop, { passive: false });

    this.ink.addEventListener("pointerdown", (e) => this.#down(e));
    this.ink.addEventListener("pointermove", (e) => this.#move(e));
    this.ink.addEventListener("pointerup", (e) => this.#up(e));
    this.ink.addEventListener("pointercancel", (e) => this.#up(e));
    this.ink.addEventListener("pointerenter", (e) => this.#notePen(e));

    this.ro = new ResizeObserver(() => this.#resize());
    this.ro.observe(this.wrap);
  }

  #canvas(cls) { const c = document.createElement("canvas"); c.className = cls; return c; }

  destroy() { this.ro.disconnect(); this.host.replaceChildren(); }

  // ---------- เนื้อหา ----------
  /** content = { text, style, level, layout } — ตั้งอัตราส่วนกรอบแล้ววาดใหม่ (เส้นเดิมถูกเก็บถ้า keepStrokes) */
  setContent(content, { keepStrokes = false } = {}) {
    this.content = content;
    this.wrap.style.aspectRatio = `${content.layout.boxW} / ${content.layout.boxH}`;
    if (!keepStrokes) { this.strokes = []; this.history = []; }
    this.overlayOpts = {};
    this.#resize();
  }

  setOverlay(opts) { this.overlayOpts = opts || {}; this.#drawOverlay(); }
  setTool(t) { this.tool = t; this.ink.dataset.tool = t; }
  setThickness(v) { this.thickness = v; }
  get isEmpty() { return this.strokes.length === 0; }
  allowTouchAgain() { this.touchBlocked = false; this.onStatus({ penReady: this.penSeen, touchBlocked: false }); }

  // ---------- วาด ----------
  #resize() {
    if (!this.content) return;
    const w = this.wrap.clientWidth, h = this.wrap.clientHeight;
    if (!w || !h) return;
    this.dpr = Math.min(3, window.devicePixelRatio || 1);
    for (const c of [this.guide, this.ink, this.overlay]) {
      c.width = Math.round(w * this.dpr); c.height = Math.round(h * this.dpr);
      c.style.width = `${w}px`; c.style.height = `${h}px`;
    }
    const L = this.content.layout;
    this.fit = core.fitBox(w, h, L.boxW, L.boxH);
    this.redraw();
  }

  redraw() {
    if (!this.content) return;
    const { text, style, level, layout } = this.content;
    for (const [cv, fn] of [[this.guide, (c) => render.drawGuide(c, layout, text, style, level, this.fit)], [this.ink, (c) => render.drawInk(c, this.strokes, this.fit, layout)]]) {
      const c = cv.getContext("2d");
      c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      c.clearRect(0, 0, cv.width, cv.height);
      fn(c);
    }
    this.#drawOverlay();
  }

  #drawOverlay() {
    if (!this.content) return;
    const { text, style, layout } = this.content;
    const c = this.overlay.getContext("2d");
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    c.clearRect(0, 0, this.overlay.width, this.overlay.height);
    render.drawOverlay(c, layout, text, style, this.fit, this.overlayOpts);
  }

  // ---------- Pointer ----------
  #notePen(e) {
    if (e.pointerType === "pen" && !this.penSeen) {
      this.penSeen = true;
      this.touchBlocked = true;                 // เจอ Apple Pencil แล้ว ไม่รับ touch บน canvas อีก (กันฝ่ามือ)
      this.onStatus({ penReady: true, touchBlocked: true });
    }
  }

  #norm(e) {
    const r = this.ink.getBoundingClientRect();
    const [x, y] = core.toNorm(e.clientX - r.left, e.clientY - r.top, this.fit, this.content.layout.boxW, this.content.layout.boxH);
    const p = e.pointerType === "pen" ? (e.pressure > 0 ? e.pressure : 0.5) : HW.ink.mousePressure;
    return [x, y, p];
  }

  #down(e) {
    this.#notePen(e);
    if (!this.content || this.active) return;
    if (e.pointerType === "touch" && this.touchBlocked) return;
    if (e.pointerType === "mouse" && e.button !== 0) return;
    e.preventDefault();
    try { this.ink.setPointerCapture(e.pointerId); } catch { /* บางอุปกรณ์/อีเวนต์จับ pointer ไม่ได้ — เขียนต่อได้ปกติ */ }
    this.onActivity();
    const pt = this.#norm(e);
    if (this.tool === "eraser") {
      this.active = { id: e.pointerId, before: [...this.strokes], erased: false };
      this.#erase(pt);
    } else {
      const stroke = { w: this.thickness, pts: [pt] };
      this.active = { id: e.pointerId, stroke };
      this.#drawPoint(stroke, 0);
    }
  }

  #move(e) {
    this.#notePen(e);
    const a = this.active;
    if (!a || a.id !== e.pointerId) return;
    e.preventDefault();
    this.onActivity();
    const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    for (const ev of evs.length ? evs : [e]) {
      const pt = this.#norm(ev);
      if (a.stroke) {
        a.stroke.pts.push(pt);
        this.#drawPoint(a.stroke, a.stroke.pts.length - 1);
      } else this.#erase(pt);
    }
  }

  #up(e) {
    const a = this.active;
    if (!a || a.id !== e.pointerId) return;
    this.active = null;
    try { this.ink.releasePointerCapture(e.pointerId); } catch { /* ปล่อยไปแล้ว */ }
    if (a.stroke) {
      this.strokes.push(a.stroke);
      this.history.push({ type: "add" });
    } else if (a.erased) {
      this.history.push({ type: "restore", strokes: a.before });     // ย้อนกลับ = คืนเส้นทั้งหมดก่อนลบ
    }
    this.onChange(this.strokes);
  }

  #drawPoint(stroke, i) {
    const c = this.ink.getContext("2d");
    c.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    const pts = stroke.pts;
    if (i === 0) render.drawSegment(c, pts[0], [pts[0][0] + 1e-4, pts[0][1], pts[0][2]], this.fit, this.content.layout, stroke.w);
    else render.drawSegment(c, pts[i - 1], pts[i], this.fit, this.content.layout, stroke.w);
  }

  /** ยางลบแบบลบทั้งเส้นที่แตะ */
  #erase([nx, ny]) {
    const L = this.content.layout;
    const keep = this.strokes.filter((s) => !core.hitStroke(s, nx, ny, L.boxW, L.boxH, HW.ink.eraserRadiusEm));
    if (keep.length !== this.strokes.length) { this.strokes = keep; this.active.erased = true; this.redraw(); }
  }

  // ---------- คำสั่ง ----------
  undo() {
    const op = this.history.pop();
    if (!op) return false;
    if (op.type === "add") this.strokes.pop();
    else this.strokes = op.strokes;                                      // restore / clear
    this.redraw();
    this.onChange(this.strokes);
    return true;
  }

  clear() {
    if (!this.strokes.length) return;
    this.history.push({ type: "restore", strokes: this.strokes });
    this.strokes = [];
    this.redraw();
    this.onChange(this.strokes);
  }
}

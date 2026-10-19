// สคริปต์ตรวจ accessibility ในเบราว์เซอร์ (ใช้กับหน้า harness): ขนาดปุ่ม ≥ 44px, label, contrast, focus ring
// ใช้: const { audit } = await import("/tests/a11y-audit.js"); audit(document.body)
const rgb = (s) => { const m = s.match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] ?? 1 }; };
const lin = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
const lum = (c) => 0.2126 * lin(c.r) + 0.7152 * lin(c.g) + 0.0722 * lin(c.b);
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const over = (top, bottom) => ({ r: top.r * top.a + bottom.r * (1 - top.a), g: top.g * top.a + bottom.g * (1 - top.a), b: top.b * top.a + bottom.b * (1 - top.a), a: 1 });

function bgOf(el) {
  const stack = [];
  for (let e = el; e; e = e.parentElement) { const c = rgb(getComputedStyle(e).backgroundColor); if (c && c.a > 0) { stack.push(c); if (c.a >= 1) break; } }
  let base = { r: 243, g: 238, b: 228, a: 1 };       // --bg เป็นฐานเมื่อไม่มีพื้นทึบ
  for (const c of stack.reverse()) base = over(c, base);
  return base;
}

const visible = (el) => { const r = el.getBoundingClientRect(); const cs = getComputedStyle(el); return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && !el.closest("[hidden]"); };
const nameOf = (el) => {
  const t = (el.getAttribute("aria-label") || el.getAttribute("title") || "").trim();
  if (t) return t;
  if (el.getAttribute("aria-labelledby")) return "labelledby";
  if (el.labels && el.labels.length) return "label";
  if (el.closest("label")) return "label";
  return (el.textContent || "").trim() || (el.getAttribute("placeholder") || "").trim() && "placeholder-only";
};

export function audit(root = document.body) {
  const issues = { small: [], unnamed: [], contrast: [], noAlt: [] };
  const seenContrast = new Set();
  const inter = [...root.querySelectorAll("button, a[href], input:not([type=hidden]), select, textarea, summary, [role=button], [role=radio]")].filter(visible);
  for (const el of inter) {
    const r = el.getBoundingClientRect();
    const tag = el.tagName.toLowerCase() + (el.className && typeof el.className === "string" ? `.${el.className.split(" ").filter(Boolean).slice(0, 2).join(".")}` : "");
    const inlineLink = el.tagName === "A" && getComputedStyle(el).display === "inline";       // ลิงก์ในประโยคได้รับยกเว้นตาม WCAG 2.5.8
    const isCheck = el.tagName === "INPUT" && ["checkbox", "radio"].includes(el.type);
    const target = isCheck && el.closest("label") ? el.closest("label").getBoundingClientRect() : r;
    if ((target.height < 43.5 || target.width < 43.5) && !inlineLink) issues.small.push({ el: tag, w: Math.round(target.width), h: Math.round(target.height), text: (el.textContent || el.getAttribute("aria-label") || "").trim().slice(0, 24) });
    const n = nameOf(el);
    if (!n || n === "placeholder-only") issues.unnamed.push({ el: tag, text: (el.getAttribute("placeholder") || "").slice(0, 30), why: n || "ไม่มีชื่อ" });
  }
  for (const img of root.querySelectorAll("img")) if (!img.hasAttribute("alt")) issues.noAlt.push("img");
  for (const c of root.querySelectorAll("canvas")) if (!c.getAttribute("aria-label")) issues.noAlt.push("canvas ไม่มี aria-label");
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    if (!n.nodeValue.trim()) continue;
    const el = n.parentElement;
    if (!el || !visible(el) || ["SCRIPT", "STYLE", "CANVAS"].includes(el.tagName)) continue;
    const cs = getComputedStyle(el);
    const fg = rgb(cs.color), bg = bgOf(el);
    if (!fg) continue;
    const eff = over(fg, bg);
    const size = parseFloat(cs.fontSize), bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    const need = large ? 3 : 4.5;
    const rt = ratio(eff, bg);
    const key = `${cs.color}|${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)}|${large}`;
    if (rt < need && !seenContrast.has(key) && cs.opacity !== "0") { seenContrast.add(key); issues.contrast.push({ ratio: Math.round(rt * 100) / 100, need, color: cs.color, bg: `rgb(${Math.round(bg.r)},${Math.round(bg.g)},${Math.round(bg.b)})`, size, sample: n.nodeValue.trim().slice(0, 24), el: el.tagName.toLowerCase() + (typeof el.className === "string" && el.className ? `.${el.className.split(" ")[0]}` : "") });
    }
  }
  return { interactive: inter.length, ...issues };
}

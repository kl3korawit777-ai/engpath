// Dashboard การเรียนรู้: อ่านจาก dailyStats ในหน่วยความจำ (ไม่ query events) · กราฟด้วย Chart.js · ทุกกราฟมีตารางข้อมูลให้เปิดดู
import * as db from "../db.js";
import * as srs from "../srs.js";
import * as lib from "../library.js";
import * as dl from "../dashboardlogic.js";
import * as rl from "../roadmap-logic.js";
import { ROADMAP } from "../data/roadmap.js";
import { techniqueScores, leastUsed } from "../techscore.js";
import { setErrorsTab } from "../scope.js";
import { vocab } from "../vocab.js";
import { h } from "../dom.js";

const CHART = "../../vendor/chart-4.5.1.umd.js";
let chartPromise = null;
const loadChart = () => (chartPromise ||= import(CHART).then(() => {
  if (typeof globalThis.Chart !== "function") throw new Error("โหลด Chart.js ไม่สำเร็จ");
  return globalThis.Chart;
}));

const css = (n, fallback) => getComputedStyle(document.documentElement).getPropertyValue(n).trim() || fallback;
const fmtDay = (k) => { const [, m, d] = k.split("-"); return `${Number(d)}/${Number(m)}`; };
const WEEKDAYS = ["จ.", "อ.", "พ.", "พฤ.", "ศ.", "ส.", "อา."];
const BUCKET_OVER = 90;                 // เกินกี่วันให้รวมเป็นสัปดาห์ในกราฟเวลา (อ่านง่ายและเบา)

export function render(root) {
  let range = "week";
  let Chart = null;
  let charts = [];
  let timer = null;
  let alive = true;

  const body = h("div", { class: "stack" });
  root.replaceChildren(
    h("div", { class: "page-head" }, h("h1", { text: "สถิติการเรียน" }), h("p", { class: "muted", text: "สรุปจากกิจกรรมที่บันทึกไว้ — คำนวณใหม่ได้เสมอที่หน้า “ตั้งค่า”" })), body);

  const colors = () => ({
    skill: { srs: css("--seg-srs", "#2E5E4E"), input: css("--seg-input", "#3D5A80"), output: css("--seg-output", "#7A4E7E"), weak: css("--seg-weak", "#C98A2B"), shadowing: "#6F9BC8", writing: "#A67BAA", journal: "#C9A7CC", all: css("--accent", "#2E5E4E") },
    ink: css("--ink", "#1F1D1A"), muted: css("--muted", "#6F685D"), line: css("--line", "#E4DCCD"), accent: css("--accent", "#2E5E4E"),
    good: css("--good", "#2E7D55"), bad: css("--bad", "#B4432F"), butter: css("--butter", "#F1D36B"),
  });

  function destroyCharts() { charts.forEach((c) => c.destroy()); charts = []; }

  // ---------- ส่วนประกอบ ----------
  function table(head, rows) {
    return h("div", { class: "table-wrap" }, h("table", { class: "data-table" },
      h("thead", {}, h("tr", {}, ...head.map((x) => h("th", { scope: "col", text: x })))),
      h("tbody", {}, ...rows.map((r) => h("tr", {}, ...r.map((c, i) => (i === 0 ? h("th", { scope: "row", text: String(c) }) : h("td", { text: String(c) }))))))));
  }

  function chartCard(title, note, label, tbl) {
    const canvas = h("canvas", { role: "img", "aria-label": label });
    return {
      canvas,
      el: h("section", { class: "card stack chart-card" },
        h("h2", { text: title }), note ? h("p", { class: "muted", text: note }) : null,
        h("div", { class: "chart-box" }, canvas),
        h("details", { class: "lex-details" }, h("summary", { text: "ดูตารางข้อมูล" }), tbl ? table(tbl.head, tbl.rows) : null)),
    };
  }

  function makeChart(canvas, config) {
    const c = new Chart(canvas, config);
    charts.push(c);
    return c;
  }

  const delta = (c, unit = "") => {
    if (!c) return h("small", { class: "muted", text: "ไม่มีช่วงก่อนหน้าให้เทียบ" });
    const up = c.abs > 0, flat = c.abs === 0;
    return h("small", { class: flat ? "muted" : up ? "good" : "bad", text: `${flat ? "เท่าเดิม" : `${up ? "▲" : "▼"} ${up ? "+" : ""}${unit === "นาที" ? Math.round(c.abs / 60) : c.abs}${unit === "นาที" ? " นาที" : unit}${c.pct != null ? ` (${c.pct > 0 ? "+" : ""}${c.pct}%)` : ""}`} เทียบช่วงก่อนหน้า` });
  };

  // ---------- วาดทั้งหน้า ----------
  function draw() {
    destroyCharts();
    const C = colors();
    const map = new Map(db.list("dailyStats").map((d) => [d.id, d]));
    const now = Date.now();
    const st = db.getSettings();
    const cards = db.list("cards");
    const states = srs.stateMap(cards, db.list("reviews"));
    const liveKnown = cards.filter((c) => lib.memoryStatus(states.get(c.id)) === "known").length;

    const rangeBar = h("div", { class: "row", role: "group", "aria-label": "ช่วงเวลา" }, ...Object.entries(dl.RANGES).map(([k, label]) => h("button", {
      class: `btn ${range === k ? "" : "btn--secondary"}`, type: "button", text: label, "aria-pressed": String(range === k), onclick: () => { range = k; draw(); } })));

    if (!map.size) {
      body.replaceChildren(rangeBar, h("div", { class: "notice", role: "status", text: "ยังไม่มีสถิติ — เริ่มเรียนหรือทบทวนบัตรสักครั้ง สถิติจะถูกสร้างจากกิจกรรมที่บันทึกไว้โดยอัตโนมัติ (ถ้าเพิ่งอัปเดตแอป รอสักครู่หรือกด “คำนวณสถิติใหม่ทั้งหมด” ที่หน้า “ตั้งค่า”)" }));
      return;
    }

    const k = dl.kpis({ map, range, now, liveKnown });
    const kpi = (label, value, extra, hint) => h("section", { class: "card statcard", title: hint }, h("div", { class: "big-num" }, value), h("div", { class: "muted", text: label }), extra);
    const kpiRow = h("div", { class: "grid2 kpis" },
      kpi("เวลาเรียนรวม", h("span", { text: dl.formatDuration(k.studySec.value) }), delta(k.studySec.change, "นาที"), "รวมทุกทักษะในช่วงที่เลือก"),
      kpi("คำที่จำได้ (ตอนนี้)", h("span", { text: String(k.known.value) }), h("small", { class: k.known.delta > 0 ? "good" : k.known.delta < 0 ? "bad" : "muted", text: `ในช่วงนี้ ${k.known.delta > 0 ? "+" : ""}${k.known.delta} คำ${k.known.prevDelta != null ? ` (ช่วงก่อนหน้า ${k.known.prevDelta > 0 ? "+" : ""}${k.known.prevDelta})` : ""}` }), "บัตรที่ interval ของ SM-2 ≥ 21 วัน"),
      kpi("ตอบบัตรคำถูก", h("span", { text: k.accuracy.value == null ? "—" : `${k.accuracy.value}%` }), k.accuracy.value == null ? h("small", { class: "muted", text: "ยังไม่มีการทบทวนในช่วงนี้" }) : h("small", { class: "muted", text: `${k.accuracy.reviews} ครั้ง${k.accuracy.prev != null ? ` · ช่วงก่อนหน้า ${k.accuracy.prev}%` : ""}` }), "นับ “ตอบถูก” เมื่อให้คะแนนมากกว่า 0 (ไม่ใช่ “ลืม”)"),
      kpi("Streak", h("span", {}, String(k.streak.current), h("span", { class: "muted", text: " วัน" })), h("small", { class: "muted", text: `ยาวที่สุด ${k.streak.longest} วัน · เรียน ${k.activeDays} วันในช่วงนี้` }), "นับจากวันที่มี session หรือการทบทวน (ตรงกับหน้า “วันนี้”)"));

    // 1) เวลาเรียนรายวัน
    const ts = dl.timeSeries({ map, range, now, dailyMinutes: st.dailyMinutes });
    let labels = ts.labels, sets = ts.datasets, goal = ts.goal, bucketNote = "";
    if (ts.kind === "day" && labels.length > BUCKET_OVER) {
      const size = 7, n = Math.ceil(labels.length / size);
      labels = Array.from({ length: n }, (_, i) => `สัปดาห์ ${fmtDay(ts.labels[i * size])}`);
      sets = sets.map((d) => ({ ...d, data: Array.from({ length: n }, (_, i) => Math.round(d.data.slice(i * size, (i + 1) * size).reduce((a, b) => a + b, 0) * 10) / 10) }));
      goal = goal * size; bucketNote = " (รวมเป็นสัปดาห์เพราะช่วงยาว)";
    } else if (ts.kind === "day") labels = labels.map(fmtDay);
    const totalsPer = labels.map((_, i) => Math.round(sets.reduce((a, d) => a + d.data[i], 0) * 10) / 10);
    const timeCard = chartCard(ts.kind === "hour" ? "เวลาเรียนวันนี้ แยกตามชั่วโมง" : `เวลาเรียนรายวัน${bucketNote}`,
      ts.kind === "hour" ? "นาทีที่เรียนในแต่ละชั่วโมงของวันนี้" : `แยกตามทักษะ เทียบเป้าหมาย ${goal} นาที`,
      `กราฟแท่งเวลาเรียน (นาที) ${ts.kind === "hour" ? "รายชั่วโมงของวันนี้" : "แยกตามทักษะ"} รวม ${Math.round(totalsPer.reduce((a, b) => a + b, 0))} นาที`,
      { head: ["", ...sets.map((d) => d.label), "รวม (นาที)"], rows: labels.map((l, i) => [l, ...sets.map((d) => d.data[i]), totalsPer[i]]) });

    // 2) heatmap ชั่วโมง × วัน
    const hm = dl.weekdayHour({ map, range, now });
    const level = (v) => (v <= 0 || !hm.max ? 0 : Math.min(4, Math.ceil((v / hm.max) * 4)));
    const heat = h("div", { class: "hm", role: "img", "aria-label": hm.best ? `ช่วงที่เรียนบ่อยที่สุดคือ ${String(hm.best.hour).padStart(2, "0")}:00 รวม ${hm.best.minutes} นาที` : "ยังไม่มีข้อมูลเวลาเรียน" },
      h("div", { class: "hm__corner" }), ...Array.from({ length: 24 }, (_, hr) => h("div", { class: "hm__h", text: hr % 3 === 0 ? String(hr) : "" })),
      ...hm.cells.flatMap((row, wd) => [h("div", { class: "hm__d", text: WEEKDAYS[wd] }), ...row.map((v, hr) => h("div", { class: `hm__c l${level(v)}`, title: `${WEEKDAYS[wd]} ${String(hr).padStart(2, "0")}:00 — ${Math.round(v)} นาที` }))]));
    const hmCard = h("section", { class: "card stack chart-card" },
      h("h2", { text: "ช่วงเวลาที่เรียน (ชั่วโมง × วัน)" }),
      h("p", { class: "muted", text: hm.best ? `เรียนบ่อยที่สุดช่วง ${String(hm.best.hour).padStart(2, "0")}:00–${String(hm.best.hour + 1).padStart(2, "0")}:00 (รวม ${hm.best.minutes} นาทีในช่วงที่เลือก${range === "day" ? " — ใช้ 7 วันล่าสุดเพราะวันเดียวน้อยเกินไป" : ""})` : "ยังไม่มีข้อมูลเวลาเรียนในช่วงนี้" }),
      h("div", { class: "hm-scroll" }, heat),
      h("details", { class: "lex-details" }, h("summary", { text: "ดูตารางข้อมูล" }),
        table(["วัน", ...Array.from({ length: 24 }, (_, i) => String(i))], hm.cells.map((r, wd) => [WEEKDAYS[wd], ...r.map((v) => Math.round(v))]))));

    // 3) Input / Output
    const io = dl.ioShare({ map, range, now, stage: st.stage, dailyMinutes: st.dailyMinutes });
    const ioCard = chartCard("สัดส่วน Input / Output", `เทียบกับที่ขั้น ${st.stage} แนะนำ (Input = ช่วง Input · Output = ช่วง Output + Shadowing + เขียนมือ + Journal)`,
      io.actual == null ? "ยังไม่มีข้อมูล Input/Output ในช่วงนี้" : `สัดส่วน Input จริง ${io.actual}% แนะนำ ${io.recommended}%`,
      { head: ["", "Input", "Output", "นาที Input", "นาที Output"], rows: [["จริง", io.actual == null ? "—" : `${io.actual}%`, io.actual == null ? "—" : `${100 - io.actual}%`, io.inputMin, io.outputMin], [`แนะนำ (ขั้น ${st.stage})`, `${io.recommended}%`, `${100 - io.recommended}%`, io.recommendedMin.input, io.recommendedMin.output]] });

    // 4) คลังคำ
    const vg = dl.vocabGrowth({ map, range, now });
    const vocabCard = chartCard("การเติบโตของคลังคำ", "สะสมคำใหม่เทียบกับคำที่จำได้", `กราฟเส้นคลังคำ สิ้นสุดที่ ${vg.cards.at(-1) ?? 0} คำ จำได้ ${vg.known.at(-1) ?? 0} คำ`,
      { head: ["", "คำสะสม", "จำได้สะสม"], rows: vg.labels.map((l, i) => [l, vg.cards[i], vg.known[i]]) });

    // 5) คาดการณ์บัตรถึงรอบ
    const fc = dl.forecast({ cards, states, now, days: 14 });
    const fcCard = chartCard("บัตรที่จะถึงรอบ 14 วันข้างหน้า", "นับเฉพาะบัตรที่เคยทบทวนแล้ว (ที่เลยกำหนดนับเป็นวันนี้) ยังไม่รวมบัตรใหม่", `กราฟแท่งบัตรถึงรอบ 14 วัน รวม ${fc.counts.reduce((a, b) => a + b, 0)} ใบ`,
      { head: ["", "จำนวนบัตร"], rows: fc.labels.map((l, i) => [l, fc.counts[i]]) });

    // 6) ข้อผิดตามหมวด
    const em = dl.errorMonths({ map, now });
    const errCard = chartCard("ข้อผิดตามหมวด: เดือนนี้เทียบเดือนก่อน", "จำนวนครั้งที่เกิดข้อผิด (จากการบันทึกใน Error Log และ Journal)", em.labels.length ? `กราฟข้อผิดตามหมวด ${em.labels.length} หมวด` : "ยังไม่มีข้อมูลข้อผิดใน 2 เดือนนี้",
      { head: ["หมวด", em.prevMonth, em.month], rows: em.labels.map((l, i) => [l, em.previous[i], em.current[i]]) });

    // 7) ลายมือ
    const hw = dl.handwritingSeries({ map, range, now });
    const hwCard = chartCard("คะแนนลายมือเฉลี่ย", "เฉลี่ยรายวัน แยก Print / Cursive (เฉพาะที่ให้คะแนนอัตโนมัติ)", "กราฟเส้นคะแนนลายมือเฉลี่ยตามเวลา",
      { head: ["", "Print", "Cursive"], rows: hw.labels.map((l, i) => [l, hw.print[i] ?? "—", hw.cursive[i] ?? "—"]).filter((r) => r[1] !== "—" || r[2] !== "—") });

    body.replaceChildren(rangeBar, kpiRow,
      levelCard(cards, states),
      h("div", { class: "grid2 charts" }, timeCard.el, hmCard, ioCard.el, vocabCard.el, fcCard.el, errCard.el, hwCard.el),
      techniqueCard(map, now),
      roadmapCard(st));

    if (!Chart) return;
    const axis = { ticks: { color: C.muted, font: { family: "JetBrains Mono, monospace", size: 11 }, maxRotation: 0, autoSkip: true }, grid: { color: C.line } };
    const yaxis = (extra = {}) => ({ beginAtZero: true, ticks: { color: C.muted, precision: 0, font: { family: "JetBrains Mono, monospace", size: 11 } }, grid: { color: C.line }, ...extra });

    makeChart(timeCard.canvas, {
      type: "bar",
      data: {
        labels,
        datasets: [
          ...sets.map((d) => ({ type: "bar", label: d.label, data: d.data, backgroundColor: C.skill[d.skill] || C.accent, stack: "t", borderRadius: 3 })),
          ...(goal ? [{ type: "line", label: `เป้าหมาย ${goal} นาที`, data: labels.map(() => goal), borderColor: C.ink, borderDash: [6, 4], borderWidth: 1.5, pointRadius: 0, fill: false }] : []),
        ],
      },
      options: { scales: { x: { ...axis, stacked: true }, y: yaxis({ stacked: true, title: { display: true, text: "นาที", color: C.muted } }) } },
    });
    makeChart(ioCard.canvas, {
      type: "bar",
      data: { labels: ["จริง", `แนะนำ (ขั้น ${st.stage})`], datasets: [
        { label: "Input", data: [io.actual ?? 0, io.recommended], backgroundColor: C.skill.input },
        { label: "Output", data: [io.actual == null ? 0 : 100 - io.actual, 100 - io.recommended], backgroundColor: C.skill.output },
      ] },
      options: { indexAxis: "y", scales: { x: { ...axis, stacked: true, max: 100, ticks: { ...axis.ticks, callback: (v) => `${v}%` } }, y: { ...axis, stacked: true, grid: { display: false } } } },
    });
    makeChart(vocabCard.canvas, {
      type: "line",
      data: { labels: vg.labels.map(fmtDay), datasets: [
        { label: "คำสะสม", data: vg.cards, borderColor: C.skill.input, backgroundColor: C.skill.input, tension: 0.2, pointRadius: vg.labels.length > 40 ? 0 : 3 },
        { label: "จำได้สะสม", data: vg.known, borderColor: C.good, backgroundColor: C.good, tension: 0.2, pointRadius: vg.labels.length > 40 ? 0 : 3 },
      ] },
      options: { scales: { x: axis, y: yaxis() } },
    });
    makeChart(fcCard.canvas, {
      type: "bar",
      data: { labels: fc.labels.map(fmtDay), datasets: [{ label: "บัตรถึงรอบ", data: fc.counts, backgroundColor: C.accent, borderRadius: 3 }] },
      options: { plugins: { legend: { display: false } }, scales: { x: axis, y: yaxis() } },
    });
    makeChart(errCard.canvas, {
      type: "bar",
      data: { labels: em.labels, datasets: [{ label: em.prevMonth, data: em.previous, backgroundColor: C.line, borderColor: C.muted, borderWidth: 1 }, { label: em.month, data: em.current, backgroundColor: C.bad }] },
      options: { scales: { x: axis, y: yaxis() } },
    });
    makeChart(hwCard.canvas, {
      type: "line",
      data: { labels: hw.labels.map(fmtDay), datasets: [
        { label: "Print", data: hw.print, borderColor: C.skill.input, backgroundColor: C.skill.input, spanGaps: true, tension: 0.2 },
        { label: "Cursive", data: hw.cursive, borderColor: C.skill.output, backgroundColor: C.skill.output, spanGaps: true, tension: 0.2 },
      ] },
      options: { scales: { x: axis, y: yaxis({ max: 100 }) } },
    });
  }

  // ---------- ความคืบหน้าตามระดับของคลังกลาง ----------
  function levelCard(cards, states) {
    const idx = vocab.cachedIndex();
    if (!idx) return h("div", { class: "notice", text: "ยังโหลดคลังคำศัพท์ไม่เสร็จ จึงยังไม่แสดงความคืบหน้าตามระดับ" });
    const rows = dl.levelProgress({
      levels: idx.levels, cards, states, skipped: db.skippedKeys(),
      levelOf: (c) => c.level ?? vocab.peek(c.en)?.level ?? 0, skippedLevelOf: (k) => vocab.peek(k)?.level ?? 0,
      isKnown: (s) => lib.memoryStatus(s) === "known",
    });
    return h("section", { class: "card stack", id: "level-progress" },
      h("h2", { text: "ความคืบหน้าตามระดับ" }),
      h("p", { class: "muted", text: "จำได้ = บัตรที่ interval ≥ 21 วัน · รู้แล้ว = คำที่คุณกดข้าม · แถบ = (จำได้ + รู้แล้ว) / คำทั้งหมดของระดับ" }),
      h("div", { class: "table-wrap" }, h("table", { class: "data-table" },
        h("thead", {}, h("tr", {}, ...["ระดับ", "ทั้งหมด", "กำลังเรียน", "จำได้", "รู้แล้ว", "ความคืบหน้า"].map((x) => h("th", { scope: "col", text: x })))),
        h("tbody", {}, ...rows.map((r) => h("tr", {}, h("th", { scope: "row", text: String(r.level) }), h("td", { text: String(r.total) }), h("td", { text: String(r.learning) }), h("td", { text: String(r.known) }), h("td", { text: String(r.skipped) }),
          h("td", {}, h("div", { class: "progress", role: "img", "aria-label": `ระดับ ${r.level} คืบหน้า ${r.pct}%` }, h("i", { style: `width:${Math.min(100, r.pct)}%` })), h("span", { class: "mono muted", text: ` ${r.pct}%` }))))))));
  }

  // ---------- Technique Score ----------
  function techniqueCard(map, now) {
    const scores = techniqueScores({ map, now });
    const least = leastUsed(scores);
    return h("section", { class: "card stack", id: "technique-score" },
      h("h2", { text: "Technique Score (7 วันล่าสุด)" }),
      h("p", { class: "muted", text: "นับการใช้แต่ละเทคนิคจากกิจกรรมที่บันทึกไว้ เทียบกับเป้าต่อสัปดาห์ (ค่าตั้งต้นของแอป ปรับได้ใน js/data/technique-config.js) — ไฮไลต์เทคนิคที่ใช้น้อยที่สุด" }),
      h("ul", { class: "tech-list" }, ...scores.map((s) => h("li", { class: `tech-row ${least && least.id === s.id ? "is-least" : ""} ${s.available ? "" : "is-planned"}` },
        h("div", { class: "row tech-row__head" },
          h("strong", { text: `${s.id} ${s.name}` }),
          least && least.id === s.id ? h("span", { class: "badge", text: "ใช้น้อยที่สุด" }) : null,
          !s.available ? h("span", { class: "badge", text: "ยังไม่มีฟีเจอร์" }) : null,
          h("span", { class: "mono muted tech-row__n", text: `${s.count} / ${s.target} ${s.unit}` })),
        h("div", { class: "meter", role: "meter", "aria-valuemin": "0", "aria-valuemax": "100", "aria-valuenow": String(s.score), "aria-label": `${s.name} ${s.score}%` }, h("i", { style: `width:${s.score}%` })),
        s.href ? h("a", { class: "wlink", href: s.href, text: "ไปทำ", onclick: () => { if (s.errorsTab) setErrorsTab(s.errorsTab); } }) : null))),
      h("details", { class: "lex-details" }, h("summary", { text: "ดูตารางข้อมูล" }),
        table(["เทคนิค", "ครั้ง", "เป้า/สัปดาห์", "คะแนน %", "นับจาก"], scores.map((s) => [`${s.id} ${s.name}`, s.count, s.target, s.score, s.source]))));
  }

  // ---------- ความคืบหน้า Roadmap ----------
  function roadmapCard(st) {
    const cps = db.list("checkpoints").filter(rl.isValidCheckpoint).sort((a, b) => b.at - a.at);
    const status = rl.checkpointStatus({ checkpoints: cps, onboarding: st.onboarding, weeks: st.checkpointWeeks, now: Date.now() });
    const fmt = new Intl.DateTimeFormat("th-TH", { day: "numeric", month: "short", year: "numeric" });
    return h("section", { class: "card stack", id: "roadmap-progress" },
      h("h2", { text: "ความคืบหน้า Roadmap" }),
      h("ol", { class: "stage-line" }, ...ROADMAP.map((s) => h("li", { class: `stage-line__i ${s.stage < st.stage ? "is-done" : s.stage === st.stage ? "is-now" : ""}`, "aria-current": s.stage === st.stage ? "step" : null },
        h("span", { class: "mono", text: `ขั้น ${s.stage}` }), h("span", { text: s.name })))),
      status.dueAt ? h("p", { class: status.due ? "bad" : "muted", text: status.due ? `ถึงรอบวัดผลแล้ว (ครบกำหนด ${fmt.format(status.dueAt)})` : `วัดผลครั้งถัดไป ${fmt.format(status.dueAt)} (อีก ${status.daysLeft} วัน)` }) : h("p", { class: "muted", text: "ยังไม่ได้ตั้งวันวัดผล — ทำ Onboarding หรือบันทึก checkpoint แรกที่หน้า Roadmap" }),
      cps.length ? h("div", { class: "stack" }, h("strong", { text: "ผล checkpoint" }), table(["วันที่", "ขั้น", "ผล", "คะแนน"], cps.slice(0, 8).map((c) => [fmt.format(c.at), `ขั้น ${c.stage}`, c.passed ? "ผ่าน" : "ยังไม่ผ่าน",
        rl.SKILLS.filter((s) => typeof c.scores?.[s.key] === "number").map((s) => `${s.label} ${c.scores[s.key]}`).join(" · ") || "—"]))) : h("p", { class: "muted", text: "ยังไม่มี checkpoint" }),
      h("a", { class: "btn btn--secondary", href: "#/roadmap", text: "ไปที่ Roadmap" }));
  }

  const unsub = db.subscribe(() => { clearTimeout(timer); timer = setTimeout(() => { if (alive) draw(); }, 600); });
  draw();
  loadChart().then((C) => {
    if (!alive) return;
    Chart = C;
    C.defaults.font.family = "Anuphan, system-ui, sans-serif";
    C.defaults.color = css("--ink", "#1F1D1A");
    C.defaults.responsive = true;
    C.defaults.maintainAspectRatio = false;
    C.defaults.plugins.legend.position = "bottom";
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) C.defaults.animation = false;
    draw();
  }).catch((e) => { console.error(e); body.prepend(h("div", { class: "notice notice--bad", role: "alert", text: "โหลดไลบรารีกราฟไม่สำเร็จ — ยังดูตัวเลขและตารางข้อมูลได้ (ถ้าเพิ่งอัปเดตแอป ให้รีเฟรช 2 ครั้งตอนออนไลน์)" })); });

  return () => { alive = false; clearTimeout(timer); unsub(); destroyCharts(); };
}


import * as db from "../db.js";
import { vocab } from "../vocab.js";
import { dayKey } from "../streak.js";
import { h } from "../dom.js";
import * as mg from "../migrate.js";

/** เขียนคำสั่งย้าย/ย้อนกลับลง db (ผ่าน js/db.js เท่านั้น) */
export function applyOps(ops) {
  for (const o of ops) {
    if (o.op === "create") db.create("cards", o.fields);
    else if (o.op === "update") db.update("cards", o.id, o.patch);
    else if (o.op === "softDelete") db.softDelete("cards", o.id);
    else if (o.op === "restore") db.restore("cards", o.id);
  }
}

const downloadJson = (data, name) => {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const a = h("a", { href: URL.createObjectURL(blob), download: name });
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};

// ย้ายบัตรคำเดิมเข้าคลังกลาง — แสดงเฉพาะเมื่อมีบัตรเดิมให้ย้าย หรือมีการย้ายที่ย้อนกลับได้
export function mountMigration(el, { toast } = {}) {
  let alive = true, backedUp = false, busy = false, message = "";
  const card = h("section", { class: "card stack", id: "migration" });
  el.append(card);

  function draw() {
    if (!alive) return;
    const raw = db.all("cards");
    const plan = mg.planMigration(raw, (k) => vocab.peek(k), dayKey);
    const sum = mg.summarize(plan);
    const undoOps = mg.planUndo(raw);
    const hasLegacy = raw.some((c) => !c.deleted && mg.isLegacyCard(c));
    card.hidden = !hasLegacy && !undoOps.length;
    if (card.hidden) return;

    const backup = h("button", { class: "btn btn--secondary", type: "button", disabled: busy, text: backedUp ? "สำรองข้อมูลแล้ว ✓ (ดาวน์โหลดอีกครั้ง)" : "1) สำรองข้อมูลก่อน (Export JSON)", onclick: async () => {
      try { downloadJson(await db.exportData(), `engpath-backup-before-migration-${dayKey(Date.now())}.json`); backedUp = true; message = "ดาวน์โหลดไฟล์สำรองแล้ว"; }
      catch (e) { message = `สำรองไม่สำเร็จ: ${e.message}`; }
      draw();
    } });
    const run = h("button", { class: "btn", type: "button", disabled: busy || !backedUp || !sum.words, text: `2) ย้าย ${sum.words} คำเข้าคลังกลาง`, onclick: () => {
      if (!confirm(`ย้ายบัตรเดิม ${sum.legacyCards} ใบ เป็นบัตรจากคลังกลาง ${sum.words} คำ?\n\n• ประวัติทบทวนและตารางทบทวนต่อเนื่อง\n• คำแปล/ตัวอย่างที่คุณเคยแก้จะเปลี่ยนเป็นของคลังกลาง (บัตรเดิมถูกเก็บไว้ ย้อนกลับได้)`)) return;
      busy = true; draw();
      try { applyOps(mg.toOps(mg.planMigration(db.all("cards"), (k) => vocab.peek(k), dayKey))); message = `ย้ายแล้ว ${sum.words} คำ`; toast?.(message); }
      catch (e) { message = `ย้ายไม่สำเร็จ: ${e.message}`; }
      busy = false; draw();
    } });
    const undo = undoOps.length ? h("button", { class: "btn btn--secondary", type: "button", disabled: busy, text: "ย้อนกลับการย้าย", onclick: () => {
      if (!confirm("ย้อนกลับ: บัตรเดิมกลับมา และบัตรคลังที่สร้างจากการย้ายจะถูกเอาออก\n(การทบทวนที่ทำหลังย้ายจะไม่ย้อนไปอยู่กับบัตรเดิม)")) return;
      applyOps(mg.planUndo(db.all("cards"))); message = "ย้อนกลับแล้ว"; toast?.(message); draw();
    } }) : null;

    card.replaceChildren(...[
      h("h2", { text: "ย้ายบัตรเดิมเข้าคลังกลาง" }),
      h("p", { class: "muted", text: "บัตรที่เคยเพิ่มเองหรือดึงจาก API จะถูกจับคู่กับคำเดียวกันในคลังกลางแบบตรงตัว ประวัติทบทวนไม่ถูกแก้ (ใช้ต่อได้) และบัตรเดิมไม่ถูกลบจริง" }),
      h("ul", { class: "plain-list" },
        h("li", { text: `จับคู่ได้ ${sum.words} คำ (บัตรเดิม ${sum.legacyCards} ใบ${sum.updates ? ` · ${sum.updates} คำมีบัตรคลังอยู่แล้วจะรวมประวัติเข้าด้วยกัน` : ""})` }),
        h("li", { text: `ไม่อยู่ในคลัง ${sum.unmatched} ใบ — คงเป็นบัตรเดิมต่อไป` })),
      sum.unmatched ? h("details", { class: "lex-details" }, h("summary", { text: "ดูบัตรที่ไม่ถูกย้าย" }), h("p", { class: "muted", text: plan.unmatched.map((c) => c.en).join(", ") })) : null,
      sum.words ? h("details", { class: "lex-details" }, h("summary", { text: "ดูคำที่จะถูกย้าย" }), h("p", { class: "muted", text: [...plan.create, ...plan.update].map((g) => g.entry.wordKey).join(", ") })) : null,
      h("div", { class: "row" }, backup, run, undo),
      message ? h("p", { class: "muted", role: "status", text: message }) : null,
    ].filter(Boolean));
  }

  const unsub = db.subscribe(draw);
  draw();
  return () => { alive = false; unsub(); };
}

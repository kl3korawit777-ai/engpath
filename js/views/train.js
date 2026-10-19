// หน้า "ฝึก": รวมเครื่องมือฝึกทั้งหมด (ที่ยังไม่พร้อมขึ้นว่า “เร็ว ๆ นี้”)
import { setErrorsTab } from "../scope.js";
import { h } from "../dom.js";

export const TOOLS = [
  { key: "write", title: "เขียน", text: "คัดลายมือตามรอยจาง 4 ระดับ (Trace → Fade → Copy → Recall) เหมาะกับ iPad + Apple Pencil", href: "#/write", ready: true },
  { key: "shadowing", title: "Shadowing", text: "ฟังคลิปแล้วพูดตาม อัดเสียงเทียบต้นฉบับ", href: "#/shadowing", ready: true },
  { key: "reading", title: "ตัวเช็ก i+1", text: "วางข้อความแล้วดูว่ายากพอดีกับระดับของคุณไหม", href: "#/reading", ready: true },
  { key: "journal", title: "Journal", text: "เขียนบันทึกรายวัน ให้ AI ตรวจแล้วส่งข้อผิดเข้า Error Log", href: "#/journal", ready: true },
  { key: "interleave", title: "คละโจทย์", text: "ชุด 10–20 ข้อคละบัตรคำ / Error Log / ข้อสอบ สลับหัวข้อและทักษะ ผลกลับเข้า SRS และ Error Log", href: "#/interleave", ready: true },
  { key: "exam", title: "สอบจับเวลา", text: "คลังข้อสอบที่คุณนำเข้าเอง + ทำข้อสอบจับเวลา ตรวจแล้วส่งข้อผิดเข้า Error Log", href: "#/exam", ready: true },
  { key: "practice", title: "ฝึกเจาะจุด", text: "แบบฝึกจากข้อผิดใน Error Log (จุดเน้นสัปดาห์)", href: "#/errors", ready: true, errorsTab: "practice" },
];

export function render(root) {
  root.replaceChildren(
    h("div", { class: "page-head" }, h("h1", { text: "ฝึก" }), h("p", { class: "muted", text: "เลือกเครื่องมือฝึกของวันนี้" })),
    h("div", { class: "tech-grid" }, ...TOOLS.map((t) => h("article", { class: `card tech ${t.ready ? "" : "tech--planned"}` },
      h("div", { class: "row" }, h("h2", { text: t.title }), h("span", { class: `badge ${t.ready ? "" : "badge--off"}`, text: t.ready ? "ใช้ได้แล้ว" : "เร็ว ๆ นี้" })),
      h("p", { text: t.text }),
      t.ready ? h("div", {}, h("a", { class: "btn btn--secondary", href: t.href, text: "เปิด", onclick: () => { if (t.errorsTab) setErrorsTab(t.errorsTab); } })) : null)))
  );
}

// Techniques Hub: 8 เทคนิค + ฟีเจอร์ในแอปที่ใช้เทคนิคนั้น (ที่ยังไม่มีขึ้นว่า “มาในเฟสถัดไป”)
import { TECHNIQUES } from "../data/techniques.js";
import { setErrorsTab } from "../scope.js";
import { h } from "../dom.js";

export function render(root) {
  const available = TECHNIQUES.filter((t) => t.feature.status === "available").length;
  root.replaceChildren(
    h("div", { class: "page-head" }, h("h1", { text: "เทคนิคการเรียน" }),
      h("p", { class: "muted", text: `8 เทคนิคที่มีหลักฐานรองรับ ใช้ได้กับทุกขั้น · มีฟีเจอร์ในแอปแล้ว ${available}/${TECHNIQUES.length} ข้อ` })),
    h("div", { class: "tech-grid" }, ...TECHNIQUES.map((t) => {
      const f = t.feature, ready = f.status === "available";
      return h("article", { class: `card tech ${ready ? "" : "tech--planned"}` },
        h("div", { class: "row" }, h("span", { class: "tech__num mono", text: t.id }), h("span", { class: `badge ${ready ? "" : "badge--off"}`, text: ready ? "ใช้ได้แล้ว" : "มาในเฟสถัดไป" })),
        h("div", {}, h("h2", { text: t.name }), h("div", { class: "muted", text: t.subtitle })),
        h("p", { text: t.text }),
        h("div", { class: "answer" }, h("small", { class: "mono muted", text: "ลองทำ" }), h("div", { text: t.tryIt })),
        ready
          ? h("div", { class: "stack" }, h("div", { class: "muted", text: `ในแอป: ${f.label}` }),
              h("div", {}, h("a", { class: "btn btn--secondary", href: f.href, text: "ไปที่ฟีเจอร์", onclick: () => { if (f.errorsTab) setErrorsTab(f.errorsTab); } })))
          : h("div", { class: "stack" }, f.note ? h("div", { class: "muted", text: f.note }) : null,
              f.href ? h("div", {}, h("a", { class: "btn btn--secondary btn--chip", href: f.href, text: "ดูหน้าที่เกี่ยวข้อง" })) : null));
    })));
}

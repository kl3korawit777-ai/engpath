import { vocab, describeError } from "../vocab.js";
import { h } from "../dom.js";

const LICENSE_URL = "https://creativecommons.org/licenses/by-sa/4.0/";

export function render(root) {
  const body = h("div", { class: "stack" }, h("p", { class: "muted", text: "กำลังโหลด…" }));
  root.replaceChildren(
    h("div", { class: "page-head" }, h("h1", { text: "เครดิตและสัญญาอนุญาต" }), h("p", { class: "muted", text: "ที่มาของคลังคำศัพท์ในแอปนี้" })),
    body
  );
  let alive = true;

  vocab.credits().then((c) => {
    if (!alive) return;
    const item = (title, text) => h("li", {}, h("strong", { text: title }), h("p", { text }));
    body.replaceChildren(
      h("section", { class: "card stack" },
        h("h2", { text: "คลังคำศัพท์กลาง" }),
        h("p", { class: "mono muted", text: `เวอร์ชัน ${c.version} · ${c.count.toLocaleString("th-TH")} คำ` }),
        h("ul", { class: "plain-list stack" },
          item("รายการคำ", c.credits.list),
          item("ข้อมูลจาก Wiktionary", c.credits.wiktionary),
          item("ส่วนที่เขียนโดย Claude", c.credits.claude))),
      h("section", { class: "card stack" },
        h("h2", { text: "สัญญาอนุญาต" }),
        h("p", { text: c.license }),
        h("p", { class: "muted", text: "นำไปใช้ต่อได้ตามเงื่อนไข CC BY-SA 4.0: ให้เครดิตแหล่งที่มา ระบุหากมีการแก้ไข และเผยแพร่งานดัดแปลงภายใต้สัญญาอนุญาตเดียวกัน" }),
        h("a", { class: "btn btn--secondary", href: LICENSE_URL, target: "_blank", rel: "noopener noreferrer", text: "อ่านเงื่อนไขฉบับเต็ม" })),
      h("section", { class: "card stack" },
        h("h2", { text: "ความหมายที่ควรตรวจซ้ำ" }),
        h("p", { class: "muted", text: "คำแปลไทยหลายคำเขียนโดย Claude เมื่อ Wiktionary ไม่มีข้อมูลภาษาไทย และผ่านการตรวจโดยโปรแกรมตรวจรูปแบบ แต่อาจยังมีสำนวนที่ไม่เป็นธรรมชาติ หากพบคำที่ควรแก้ แจ้งผู้ดูแลเพื่อปรับในรุ่นถัดไป" })),
      h("p", { class: "muted" }, h("a", { href: "#/settings", text: "← กลับไปตั้งค่า" }))
    );
  }).catch((e) => {
    if (!alive) return;
    body.replaceChildren(h("div", { class: "notice notice--bad", role: "alert", text: describeError(e) }));
  });

  return () => { alive = false; };
}

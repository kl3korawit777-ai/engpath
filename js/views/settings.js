import * as db from "../db.js";

import { dayKey } from "../streak.js";
import { h } from "../dom.js";
import { exportVault, scopeOptions } from "../vaultexport.js";
import { sync as syncStats } from "../statsync.js";
import { APP_VERSION, CHANGELOG } from "../version.js";
import { lexiconConfig, saveLexiconConfig } from "../localsettings.js";
import { DEFAULT_CLAUDE_MODEL } from "../lexicon.js";
import { mountPlan } from "./newwords.js";
import { mountMigration } from "./migration.js";

export function render(el, { toast } = {}) {
  el.innerHTML = `
    <div class="page-head"><h1>ตั้งค่า</h1><p class="muted">บัญชีและสถานะการซิงก์</p></div>
    <section class="card">
      <h2>บัญชี</h2>
      <div class="row" id="acct"></div>
    </section>
    <section class="card">
      <h2>การซิงก์</h2>
      <p class="muted" id="syncText"></p>
    </section>`;

  const acct = el.querySelector("#acct");
  const u = db.currentUser();
  if (u) {
    if (u.photoURL) {
      const img = document.createElement("img");
      img.className = "avatar";
      img.alt = "";
      img.referrerPolicy = "no-referrer";
      img.src = u.photoURL;
      acct.append(img);
    }
    const info = document.createElement("div");
    const name = document.createElement("div");
    name.textContent = u.displayName || "ผู้ใช้";
    const mail = document.createElement("div");
    mail.className = "muted mono";
    mail.textContent = u.email || "";
    info.append(name, mail);
    const out = document.createElement("button");
    out.className = "btn btn--secondary";
    out.textContent = "ออกจากระบบ";
    out.addEventListener("click", () => db.signOut());
    acct.append(info, out);
  }

  // ---- สำรองข้อมูล ----
  const msg = h("p", { class: "muted", role: "status" });
  const file = h("input", { type: "file", accept: "application/json,.json", hidden: true });
  file.addEventListener("change", async () => {
    const f = file.files[0];
    file.value = "";
    if (!f) return;
    try {
      const json = JSON.parse(await f.text());
      if (!confirm("นำเข้าข้อมูลจากไฟล์นี้? (ไม่ทับข้อมูลที่ใหม่กว่าในบัญชี และไม่ลบอะไร)")) return;
      const r = await db.importData(json);
      msg.textContent = `นำเข้า ${r.written} รายการ · ข้าม ${r.skipped.existing} (มีอยู่แล้ว/ใหม่กว่า) · ไม่ถูกต้อง ${r.skipped.invalid}`;
      toast?.("นำเข้าแล้ว");
    } catch (e) {
      msg.textContent = `นำเข้าไม่สำเร็จ: ${e.message}`;
    }
  });
  const backup = h("section", { class: "card stack" },
    h("h2", { text: "สำรองข้อมูล" }),
    h("p", { class: "muted", text: "ส่งออกข้อมูลทั้งหมดเป็นไฟล์ JSON หรือนำเข้ากลับมา" }),
    h("div", { class: "row" },
      h("button", { class: "btn", type: "button", text: "Export JSON", onclick: async () => {
        let data;
        try { data = await db.exportData(); } catch (e) { msg.textContent = `ส่งออกไม่สำเร็จ: ${e.message}`; return; }
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
        const a = h("a", { href: URL.createObjectURL(blob), download: `engpath-backup-${dayKey(Date.now())}.json` });
        document.body.append(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      } }),
      h("button", { class: "btn btn--secondary", type: "button", text: "Import JSON", onclick: () => file.click() }), file),
    msg);
  // ---- เกี่ยวกับแอป: เวอร์ชัน + changelog ----
  const cacheLine = h("span", { class: "mono muted", text: "" });
  try { if (window.caches) caches.keys().then((ks) => { const v = ks.map((k) => k.match(/^engpath-shell-(v\d+)$/)?.[1]).filter(Boolean).sort().at(-1); cacheLine.textContent = v ? `แคชออฟไลน์ ${v}` : "ยังไม่มีแคชออฟไลน์ (เปิดซ้ำตอนออนไลน์เพื่อติดตั้ง)"; }).catch(() => {}); } catch { /* ไม่รองรับ */ }
  const about = h("section", { class: "card stack", id: "about" },
    h("h2", { text: "เกี่ยวกับแอป" }),
    h("div", { class: "row" }, h("strong", { class: "mono", text: `EngPath v${APP_VERSION}` }), cacheLine),
    h("div", {}, h("a", { class: "btn btn--secondary", href: "#/credits", text: "เครดิตและสัญญาอนุญาตของคลังคำศัพท์" })),
    h("details", { class: "lex-details" }, h("summary", { text: "มีอะไรใหม่ (changelog)" }),
      ...CHANGELOG.map((c) => h("div", { class: "stack" }, h("strong", { text: `v${c.version} — ${c.title}` }), h("ul", { class: "plain-list" }, ...c.notes.map((n) => h("li", { text: n })))))));
  // ---- สถิติ (dailyStats) ----
  const statsMsg = h("p", { class: "muted", role: "status" });
  const statsCard = h("section", { class: "card stack" },
    h("h2", { text: "สถิติการเรียน" }),
    h("p", { class: "muted", text: "สถิติรายวันเป็นแค่ cache ที่คำนวณจากกิจกรรมที่บันทึกไว้ (แก้ด้วยมือไม่ได้) — ถ้าตัวเลขดูไม่ตรง กดคำนวณใหม่ได้เสมอ ข้อมูลกิจกรรมจริงไม่ถูกแตะ" }),
    h("div", {}, h("button", { class: "btn btn--secondary", type: "button", text: "คำนวณสถิติใหม่ทั้งหมด", onclick: () => {
      const r = syncStats({ removeStale: true });
      statsMsg.textContent = r.days ? `คำนวณ ${r.days} วันแล้ว · เขียนใหม่ ${r.written} วัน (ที่เหลือตรงกับของเดิมอยู่แล้ว)${r.removed ? ` · ลบวันที่ไม่มีกิจกรรมรองรับ ${r.removed} วัน` : ""}` : "ยังไม่มีกิจกรรมให้คำนวณ (หรือข้อมูลยังโหลดไม่เสร็จ)";
    } })), statsMsg);
  // ---- Export Obsidian vault ----
  const vaultMsg = h("p", { class: "muted", role: "status" });
  const vaultScope = h("select", { class: "input select", "aria-label": "ขอบเขตที่จะส่งออก" }, ...scopeOptions().map((o) => h("option", { value: o.value, text: o.label })));
  const vaultLex = h("input", { type: "checkbox", checked: true });
  const vaultBtn = h("button", { class: "btn", type: "button", text: "Export vault (.zip)", onclick: async () => {
    vaultBtn.disabled = true; vaultMsg.textContent = "กำลังสร้างไฟล์…";
    try {
      const r = await exportVault({ scope: vaultScope.value, includeLexicon: vaultLex.checked });
      const a = h("a", { href: URL.createObjectURL(r.blob), download: r.filename });
      document.body.append(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
      vaultMsg.textContent = `ส่งออก ${r.stats.words} คำ (${Math.round(r.blob.size / 1024)} KB)${r.stats.missingLexicon ? ` · ${r.stats.missingLexicon} คำไม่มีข้อมูลคลังคำในเครื่องนี้ จึงไม่มีส่วนความหมาย/คำพ้อง` : ""} — แตกไฟล์แล้วเปิดโฟลเดอร์ EngPath เป็น vault ใน Obsidian`;
    } catch (e) {
      vaultMsg.textContent = `ส่งออกไม่สำเร็จ: ${e.message}`;
    }
    vaultBtn.disabled = false;
  } });
  const vault = h("section", { class: "card stack" },
    h("h2", { text: "Export Obsidian vault" }),
    h("p", { class: "muted", text: "หนึ่งคำต่อหนึ่งไฟล์ .md พร้อม frontmatter, แท็ก, โน้ตที่คงลิงก์ [[ ]] และส่วน Related — เป็นสำเนา ณ ตอนนี้ แก้ใน Obsidian ไม่ย้อนกลับมาที่แอป" }),
    h("label", { class: "field" }, h("span", { text: "ขอบเขต" }), vaultScope),
    h("label", { class: "row check" }, vaultLex, h("span", { text: "รวมความหมาย/ตัวอย่าง/คำพ้องจากคลังกลาง (อ่านจากไฟล์ในแอป ไม่เรียก API หรือ server)" })),
    h("div", {}, vaultBtn), vaultMsg);
  // ---- Claude API key (เก็บในเครื่องนี้เท่านั้น) — ใช้กับ Journal ตรวจ AI และแบบฝึกเจาะจุด ไม่ได้ใช้กับคำศัพท์แล้ว ----
  const cfg = lexiconConfig();
  const f = {
    apiKey: h("input", { class: "input", type: "password", value: cfg.apiKey, placeholder: "sk-ant-… (ไม่บังคับ)", autocomplete: "off", spellcheck: false }),
    model: h("input", { class: "input", value: cfg.model === DEFAULT_CLAUDE_MODEL ? "" : cfg.model, placeholder: `ค่าเริ่มต้น: ${DEFAULT_CLAUDE_MODEL}`, autocomplete: "off", spellcheck: false }),
  };
  const cfgMsg = h("p", { class: "muted", role: "status" });
  const field = (label, input, hint) => h("label", { class: "field" }, h("span", { text: label }), input, hint ? h("small", { class: "muted", text: hint }) : null);
  const lexCard = h("section", { class: "card stack" },
    h("h2", { text: "Claude API key (ไม่บังคับ)" }),
    h("p", { class: "muted", text: "ค่าเหล่านี้เก็บในเครื่องนี้เท่านั้น (localStorage) ไม่ถูกซิงก์ขึ้น Firestore และไม่รวมในไฟล์ Export ต้องตั้งแยกในแต่ละเครื่อง" }),
    field("Claude API key", f.apiKey, "ใช้กับ Journal (ตรวจด้วย AI) และแบบฝึกเจาะจุดเท่านั้น — คำศัพท์มาจากคลังกลางในแอป ไม่ต้องใช้ key · เรียกตรงจากเบราว์เซอร์ไปที่ api.anthropic.com ใครใช้เครื่องนี้ได้ก็เห็นคีย์ได้ — ตั้งวงเงินในคอนโซลและใช้เฉพาะเครื่องที่ไว้ใจ"),
    field("ชื่อรุ่น Claude", f.model, "เว้นว่างเพื่อใช้ค่าเริ่มต้น ดูชื่อรุ่นที่ใช้ได้ในเอกสารของ Anthropic"),
    h("div", { class: "row" },
      h("button", { class: "btn", type: "button", text: "บันทึก", onclick: () => {
        const ok = saveLexiconConfig({ email: cfg.email, apiKey: f.apiKey.value, model: f.model.value });
        cfgMsg.textContent = ok ? "บันทึกในเครื่องนี้แล้ว" : "บันทึกไม่ได้ — เบราว์เซอร์บล็อกการเก็บข้อมูล (เช่น private mode)";
      } }),
      h("button", { class: "btn btn--secondary", type: "button", text: "ล้างคีย์", onclick: () => {
        f.apiKey.value = "";
        saveLexiconConfig({ email: cfg.email, apiKey: "", model: f.model.value });
        cfgMsg.textContent = "ล้าง API key ออกจากเครื่องนี้แล้ว";
      } })),
    cfgMsg);
  // ---- แผนการเรียน ----
  const st = db.getSettings();
  const plan = h("section", { class: "card stack" },
    h("h2", { text: "แผนการเรียน" }),
    h("label", { class: "field" }, h("span", { text: "เวลาเรียนต่อวัน" }),
      h("select", { class: "input select", onchange: (e) => { db.saveSettings({ dailyMinutes: Number(e.target.value) }); toast?.("บันทึกแล้ว — ตัวจับเวลาที่ยังไม่เริ่มจะใช้เวลาใหม่"); } },
        ...[30, 45, 60, 90, 120].map((m) => h("option", { value: m, text: `${m} นาที${m === 60 ? " (ค่าเริ่มต้น)" : ""}`, selected: m === st.dailyMinutes })))),
    h("label", { class: "field" }, h("span", { text: "วงจร checkpoint ทุกกี่สัปดาห์" }),
      h("select", { class: "input select", onchange: (e) => { db.saveSettings({ checkpointWeeks: Number(e.target.value) }); toast?.("บันทึกแล้ว"); } },
        ...[4, 5, 6].map((w) => h("option", { value: w, text: `${w} สัปดาห์${w === 5 ? " (ค่าเริ่มต้น)" : ""}`, selected: w === st.checkpointWeeks })))),
    h("label", { class: "field" }, h("span", { text: "รูปแบบตัวอักษรเริ่มต้น (หน้าเขียน)" }),
      h("select", { class: "input select", onchange: (e) => { db.saveSettings({ handwritingStyle: e.target.value }); toast?.("บันทึกแล้ว"); } },
        h("option", { value: "print", text: "Print (Andika)", selected: (st.handwritingStyle || "print") === "print" }),
        h("option", { value: "cursive", text: "Cursive (Playwrite US Trad)", selected: st.handwritingStyle === "cursive" }))),
    h("div", {}, h("a", { class: "btn btn--secondary", href: "#/onboarding", text: st.onboarding?.done ? "ทำ Onboarding ใหม่ / แก้เป้าหมาย" : "ทำ Onboarding (ตั้งเป้าหมายและขั้นเริ่มต้น)" })));
  el.append(plan);
  const offVocab = mountPlan(el, { toast });
  const offMigration = mountMigration(el, { toast });
  el.append(lexCard, statsCard, backup, vault, about);

  const text = { synced: "ข้อมูลทั้งหมดซิงก์ขึ้นเซิร์ฟเวอร์แล้ว", pending: "มีข้อมูลรอส่งขึ้นเซิร์ฟเวอร์ จะส่งอัตโนมัติเมื่อออนไลน์", offline: "ออฟไลน์ — ใช้งานต่อได้ ข้อมูลจะซิงก์เมื่อต่อเน็ต" };
  const offSync = db.onSync((s) => { el.querySelector("#syncText").textContent = text[s]; });
  return () => { offSync(); offVocab(); offMigration(); };
}

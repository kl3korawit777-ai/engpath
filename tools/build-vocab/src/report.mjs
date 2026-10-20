// รายงานตรวจทาน HTML (ไฟล์ในเครื่อง): คำที่ความหมายหลักเป็นของ claude/แก้เอง + คำที่ validate มีปัญหา + สุ่มตรวจ 200 คำจากทุกระดับ
// แก้ค่าในหน้าได้ แล้วบันทึกเป็น overrides.json (สคริปต์ใช้ overrides ทับผลที่เขียนไว้ตอน validate/build)
import { writeFileSync } from "node:fs";
import { config, cachePath } from "./util.mjs";
import { loadWords } from "./words.mjs";
import { loadWiktionary } from "./wiktionary.mjs";
import { allAcceptedResults } from "./batches.mjs";
import { loadOverrides, validateAll, mainMeaningSource } from "./validate.mjs";
import { rngFrom } from "./sample.mjs";

/** สุ่มกระจายทุกระดับ: n คำ แบ่งตามสัดส่วนระดับ (อย่างน้อยระดับละ 1) ใช้ seed คงที่ เปิดซ้ำได้ชุดเดิม */
export function stratifiedSample(words, n, seed = 7) {
  const rng = rngFrom(seed);
  const levels = [...new Set(words.map((w) => w.level))].sort((a, b) => a - b);
  const by = new Map(levels.map((l) => [l, words.filter((w) => w.level === l)]));
  const take = new Map(levels.map((l) => [l, Math.max(1, Math.round((n * by.get(l).length) / words.length))]));
  const out = [];
  for (const l of levels) {
    const pool = [...by.get(l)];
    for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
    out.push(...pool.slice(0, take.get(l)));
  }
  return out.sort((a, b) => a.rank - b.rank);
}

export function buildReportData({ words, results, wiks, overrides }) {
  const val = validateAll(words, results, { wiks, overrides });
  const failedBy = new Map(val.failed.map((f) => [f.rank, f]));
  const warnedBy = new Map(val.warned.map((f) => [f.rank, f]));
  const written = words.filter((w) => results.has(w.rank));
  const mainClaude = new Set(written.filter((w) => { const s = mainMeaningSource({ ...results.get(w.rank), ...(overrides[w.wordKey] || {}) }); return s && s !== "wiktionary"; }).map((w) => w.rank));
  const flagged = new Set([...failedBy.keys(), ...warnedBy.keys(), ...mainClaude]);
  const sample = stratifiedSample(written, 200);
  const picks = [...new Map([...words.filter((w) => flagged.has(w.rank)), ...sample].map((w) => [w.rank, w])).values()].sort((a, b) => a.rank - b.rank);
  const entries = picks.map((w) => {
    const errors = failedBy.get(w.rank)?.errors || [], warnings = [...(warnedBy.get(w.rank)?.warnings || [])];
    const wik = wiks.get(w.wordKey);
    if (mainClaude.has(w.rank)) warnings.unshift(`ความหมายหลักไม่ได้มาจาก Wiktionary (source: ${mainMeaningSource({ ...results.get(w.rank), ...(overrides[w.wordKey] || {}) })}) — ตรวจเป็นพิเศษ`);
    return {
      rank: w.rank, word: w.word, wordKey: w.wordKey, level: w.level, ai: results.get(w.rank) || null, override: overrides[w.wordKey] || null,
      errors, warnings, flagged: errors.length > 0 || warnings.length > 0,
      wik: wik ? { found: wik.found, pos: wik.pos, ipa: wik.ipa, th: wik.th, examples: wik.examples.slice(0, 3), synonyms: wik.synonyms, antonyms: wik.antonyms, family: wik.family } : null,
    };
  });
  return {
    summary: { total: words.length, written: written.length, ok: val.ok, failed: val.failed.length, missing: val.missing.length, warned: val.warned.length, mainClaude: mainClaude.size, shown: entries.length },
    entries, tags: config.tags, pos: config.posAllowed, cefr: config.cefrAllowed,
  };
}

const PAGE = (data, overrides) => `<!doctype html><html lang="th"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>รายงานตรวจทานคลังคำ</title>
<style>
:root{--bg:#F3EEE4;--surface:#FBF8F1;--ink:#1F1D1A;--muted:#5C564C;--line:#D9D0BF;--accent:#2E5E4E;--bad:#B4432F;--butter:#F1D36B}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.6 "Anuphan",system-ui,sans-serif;padding:16px}
h1{font-size:1.4rem;margin:.2em 0}.bar{position:sticky;top:0;background:var(--bg);padding:10px 0;z-index:5;display:flex;gap:8px;flex-wrap:wrap;align-items:center;border-bottom:1px solid var(--line)}
button,select,input,textarea{font:inherit}button{min-height:40px;padding:0 16px;border-radius:99px;border:1px solid var(--ink);background:var(--ink);color:var(--bg);cursor:pointer}button.sec{background:transparent;color:var(--ink)}
.card{background:var(--surface);border:1px solid var(--line);border-radius:16px;padding:14px;margin:12px 0}.card.flag{border-color:var(--bad)}.card.edited{box-shadow:inset 0 0 0 2px var(--butter)}
.head{display:flex;gap:10px;align-items:baseline;flex-wrap:wrap}.head b{font-size:1.2rem}.mono{font-family:ui-monospace,monospace;color:var(--muted);font-size:.85rem}
.err{color:var(--bad)}.warn{color:#8a5a00}.muted{color:var(--muted)}label{display:block;font-size:.85rem;color:var(--muted);margin-top:8px}
input[type=text],textarea,select{width:100%;padding:6px 10px;border:1px solid var(--line);border-radius:10px;background:#fff}textarea{min-height:44px}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:12px}.throw{display:grid;grid-template-columns:110px 1fr 90px;gap:6px;margin-top:4px;align-items:center}
.tags label{display:inline-block;margin-right:12px;color:var(--ink)}.rel{font-size:.85rem;color:var(--muted)}.src{font-size:.75rem;border-radius:99px;padding:0 8px;background:#fff;border:1px solid var(--line)}
</style></head><body>
<h1>รายงานตรวจทานคลังคำ</h1>
<p class="muted">ทั้งหมด ${data.summary.total} คำ · เขียนแล้ว ${data.summary.written} · ผ่าน ${data.summary.ok} · ไม่ผ่าน ${data.summary.failed} · ยังไม่ได้เขียน ${data.summary.missing} · ผ่านแต่มีคำเตือน ${data.summary.warned} · ความหมายหลักไม่ใช่ Wiktionary ${data.summary.mainClaude} · แสดงในหน้านี้ ${data.summary.shown} คำ</p>
<div class="bar"><label style="margin:0"><input type="checkbox" id="only"> เฉพาะที่ถูก flag</label><span id="count" class="mono"></span><span style="flex:1"></span>
<button id="save">บันทึก overrides.json</button><button class="sec" id="copy">คัดลอก JSON</button></div>
<p class="muted">แก้ค่าในช่องได้เลย — เฉพาะฟิลด์ที่แก้จะถูกบันทึกเป็น override (ความหมายไทยที่แก้จะมี source “manual”) · วางไฟล์ที่ได้ที่ <code>tools/build-vocab/overrides.json</code> แล้วรัน <code>validate</code> ใหม่</p>
<div id="list"></div>
<script type="application/json" id="data">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>
<script>
const D=JSON.parse(document.getElementById("data").textContent);
const overrides=${JSON.stringify(overrides).replace(/</g, "\\u003c")};
const $=(t,a={},...c)=>{const e=document.createElement(t);for(const[k,v]of Object.entries(a)){if(k==="class")e.className=v;else if(k==="text")e.textContent=v;else if(k.startsWith("on"))e.addEventListener(k.slice(2),v);else e.setAttribute(k,v)}for(const x of c.flat())if(x!=null)e.append(x);return e};
const cur=(e)=>({...(e.ai||{}),...(overrides[e.wordKey]||{})});
function setOv(e,key,val){const ai=(e.ai||{})[key];const same=JSON.stringify(ai)===JSON.stringify(val);const o=overrides[e.wordKey]||(overrides[e.wordKey]={});if(same)delete o[key];else o[key]=val;if(!Object.keys(o).length)delete overrides[e.wordKey];render()}
const lines=(s)=>s.split("\\n").map(x=>x.trim()).filter(Boolean);const csv=(s)=>s.split(",").map(x=>x.trim()).filter(Boolean);
function card(e){const c=cur(e),ed=!!overrides[e.wordKey];
 const th=(c.th||[]).map((t,i)=>{const edit=(k,v)=>{const n=JSON.parse(JSON.stringify(c.th));n[i][k]=v;if(k==="text"||k==="pos"){n[i].source="manual";delete n[i].basedOn}setOv(e,"th",n)};return $("div",{class:"throw"},$("input",{type:"text",value:t.pos||"",onchange:ev=>edit("pos",ev.target.value.trim())}),$("input",{type:"text",value:t.text||"",onchange:ev=>edit("text",ev.target.value.trim())}),$("span",{class:"src",text:t.source+(t.basedOn?" ← "+t.basedOn:"")}))});
 const ex=$("textarea",{onchange:ev=>setOv(e,"examples",lines(ev.target.value))});ex.value=(c.examples||[]).join("\\n");
 const co=$("textarea",{onchange:ev=>setOv(e,"collocations",lines(ev.target.value))});co.value=(c.collocations||[]).join("\\n");
 const sel=$("select",{onchange:ev=>setOv(e,"cefr",ev.target.value)},...D.cefr.map(x=>$("option",{value:x,...(x===c.cefr?{selected:""}:{})},x)));
 const w=e.wik;
 return $("div",{class:"card"+(e.flagged?" flag":"")+(ed?" edited":"")},
  $("div",{class:"head"},$("b",{text:e.word}),$("span",{class:"mono",text:"rank "+e.rank+" · ระดับ "+e.level}),w?.ipa?$("span",{class:"mono",text:w.ipa}):null,ed?$("span",{class:"warn",text:"(แก้แล้ว)"}):null),
  ...e.errors.map(x=>$("div",{class:"err",text:"✗ "+x})),...e.warnings.map(x=>$("div",{class:"warn",text:"⚠ "+x})),
  w?.found?$("div",{class:"rel",text:"Wiktionary คำแปลไทย: "+(w.th.length?w.th.map(t=>t.pos+" ("+t.senseEn+"): "+t.th.join(", ")).join(" | "):"ไม่มี")}):$("div",{class:"rel",text:"Wiktionary: ไม่พบคำนี้"}),
  $("div",{class:"grid"},
   $("div",{},$("label",{text:"pos (คั่นด้วย ,)"}),$("input",{type:"text",value:(c.pos||[]).join(", "),onchange:ev=>setOv(e,"pos",csv(ev.target.value))}),$("label",{text:"ความหมายไทย (pos / ข้อความ / source)"}),th,$("label",{text:"CEFR"}),sel),
   $("div",{},$("label",{text:"ประโยคตัวอย่าง (บรรทัดละประโยค)"}),ex,$("label",{text:"วลีที่ใช้บ่อย (บรรทัดละวลี)"}),co),
   $("div",{},$("label",{text:"ตระกูลคำเพิ่ม (คั่นด้วย , เฉพาะคำในคลัง)"}),$("input",{type:"text",value:(c.family||[]).join(", "),onchange:ev=>setOv(e,"family",csv(ev.target.value))}),$("label",{text:"แท็ก"}),
     $("div",{class:"tags"},...D.tags.map(t=>$("label",{},$("input",{type:"checkbox",...((c.tags||[]).includes(t)?{checked:""}:{}),onchange:ev=>{const s=new Set(c.tags||[]);ev.target.checked?s.add(t):s.delete(t);setOv(e,"tags",[...s])}})," "+t))))),
  w?$("div",{class:"rel"},"พ้อง: "+(w.synonyms.join(", ")||"-")+" · ตรงข้าม: "+(w.antonyms.join(", ")||"-")+" · ตระกูล (Wiktionary): "+(w.family.join(", ")||"-")):null);}
function render(){const only=document.getElementById("only").checked;const L=document.getElementById("list");L.replaceChildren(...D.entries.filter(e=>!only||e.flagged).map(card));document.getElementById("count").textContent="แก้แล้ว "+Object.keys(overrides).length+" คำ"}
document.getElementById("only").addEventListener("change",render);
const json=()=>JSON.stringify(overrides,null,2)+"\\n";
document.getElementById("copy").onclick=()=>navigator.clipboard.writeText(json());
document.getElementById("save").onclick=async()=>{try{if(window.showSaveFilePicker){const h=await showSaveFilePicker({suggestedName:"overrides.json",types:[{accept:{"application/json":[".json"]}}]});const w=await h.createWritable();await w.write(json());await w.close();return}}catch(e){if(e.name==="AbortError")return}
 const a=document.createElement("a");a.href=URL.createObjectURL(new Blob([json()],{type:"application/json"}));a.download="overrides.json";a.click()};
render();
</script></body></html>`;

export async function cmdReport(flags = {}, { log = console.log } = {}) {
  const words = loadWords();
  const overrides = loadOverrides();
  const data = buildReportData({ words, results: allAcceptedResults(), wiks: loadWiktionary(), overrides });
  const out = cachePath("report.html");
  writeFileSync(out, PAGE(data, overrides), "utf8");
  log(`สร้างรายงาน ${data.entries.length} คำ → ${out}\nเปิดไฟล์นี้ในเบราว์เซอร์ (ดับเบิลคลิก)`);
  return data;
}

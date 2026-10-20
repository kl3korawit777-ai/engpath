// รูปผันของคำอังกฤษ (กฎปกติ + ตารางคำไม่ปกติที่พบบ่อย) — ใช้ตรวจว่าประโยค/วลีมี "คำนั้นหรือรูปผันของมัน" จริง
// ผ่อนปรนโดยตั้งใจ (ยอมรับรูปที่อาจไม่ใช่คำจริง เช่น "runned") เพราะใช้เป็นด่านกรอง ไม่ใช่ตัววิเคราะห์ไวยากรณ์

const IRREGULAR = {
  be: "am is are was were been being", have: "has had having", do: "does did done doing", go: "goes went gone going", say: "says said saying",
  make: "makes made making", get: "gets got gotten getting", know: "knows knew known knowing", think: "thinks thought thinking", take: "takes took taken taking",
  see: "sees saw seen seeing", come: "comes came coming", give: "gives gave given giving", find: "finds found finding", tell: "tells told telling",
  become: "becomes became becoming", leave: "leaves left leaving", feel: "feels felt feeling", bring: "brings brought bringing", begin: "begins began begun beginning",
  keep: "keeps kept keeping", hold: "holds held holding", write: "writes wrote written writing", stand: "stands stood standing", hear: "hears heard hearing",
  let: "lets letting", mean: "means meant meaning", set: "sets setting", meet: "meets met meeting", run: "runs ran running", pay: "pays paid paying",
  sit: "sits sat sitting", speak: "speaks spoke spoken speaking", lie: "lies lay lain lying lied", lead: "leads led leading", read: "reads reading",
  grow: "grows grew grown growing", lose: "loses lost losing", fall: "falls fell fallen falling", send: "sends sent sending", build: "builds built building",
  understand: "understands understood understanding", draw: "draws drew drawn drawing", break: "breaks broke broken breaking", spend: "spends spent spending",
  cut: "cuts cutting", rise: "rises rose risen rising", drive: "drives drove driven driving", buy: "buys bought buying", wear: "wears wore worn wearing",
  choose: "chooses chose chosen choosing", eat: "eats ate eaten eating", sell: "sells sold selling", win: "wins won winning", teach: "teaches taught teaching",
  catch: "catches caught catching", fight: "fights fought fighting", throw: "throws threw thrown throwing", forget: "forgets forgot forgotten forgetting",
  hit: "hits hitting", put: "puts putting", shoot: "shoots shot shooting", sing: "sings sang sung singing", swim: "swims swam swum swimming",
  fly: "flies flew flown flying", hide: "hides hid hidden hiding", shake: "shakes shook shaken shaking", steal: "steals stole stolen stealing",
  wake: "wakes woke woken waking", bear: "bears bore born borne bearing", bind: "binds bound binding", blow: "blows blew blown blowing", burn: "burns burnt burned burning",
  deal: "deals dealt dealing", dream: "dreams dreamt dreamed dreaming", feed: "feeds fed feeding", forgive: "forgives forgave forgiven", freeze: "freezes froze frozen freezing",
  hang: "hangs hung hanged hanging", hurt: "hurts hurting", lay: "lays laid laying", lend: "lends lent lending", ride: "rides rode ridden riding",
  ring: "rings rang rung ringing", seek: "seeks sought seeking", shut: "shuts shutting", sleep: "sleeps slept sleeping", slide: "slides slid sliding",
  spread: "spreads spreading", strike: "strikes struck stuck striking", swing: "swings swung swinging", tear: "tears tore torn tearing", wind: "winds wound winding",
  can: "could", will: "would", shall: "should", may: "might", must: "", ought: "",
  good: "better best", bad: "worse worst", well: "better best", far: "farther further farthest furthest", little: "less least", many: "more most", much: "more most",
  old: "older oldest elder eldest", late: "later latest latter",
  child: "children", man: "men", woman: "women", person: "people persons", foot: "feet", tooth: "teeth", mouse: "mice", goose: "geese", ox: "oxen",
  life: "lives", wife: "wives", knife: "knives", leaf: "leaves", half: "halves", shelf: "shelves", wolf: "wolves", thief: "thieves", self: "selves", loaf: "loaves",
  datum: "data", crisis: "crises", analysis: "analyses", basis: "bases", hypothesis: "hypotheses", thesis: "theses", phenomenon: "phenomena", criterion: "criteria",
  medium: "media mediums", index: "indices indexes", appendix: "appendices", curriculum: "curricula", formula: "formulae formulas", stimulus: "stimuli", bacterium: "bacteria",
  i: "me my mine myself", he: "him his himself", she: "her hers herself", we: "us our ours ourselves", they: "them their theirs themselves", you: "your yours yourself yourselves",
  it: "its itself", who: "whom whose whoever", what: "whatever", which: "whichever", a: "an", this: "these", that: "those", one: "ones", other: "others", another: "",
  no: "none", every: "everyone everybody everything everywhere", some: "someone somebody something somewhere sometimes", any: "anyone anybody anything anywhere",
};

const VOWELS = "aeiou";
const isVowel = (c) => VOWELS.includes(c);

/** รูปผันที่เป็นไปได้ทั้งหมดของคำ (ตัวพิมพ์เล็ก รวมคำเดิม) */
export function forms(word) {
  const w = String(word).toLowerCase();
  const out = new Set([w]);
  for (const f of (IRREGULAR[w] || "").split(" ")) if (f) out.add(f);
  if (!/^[a-z]+$/.test(w)) return out;
  const last = w.at(-1), prev = w.at(-2) || "";
  const cons = !isVowel(last) && last !== "y";
  out.add(`${w}s`);
  if (/(s|x|z|ch|sh|o)$/.test(w)) out.add(`${w}es`);
  if (last === "y" && !isVowel(prev)) { const st = w.slice(0, -1); out.add(`${st}ies`); out.add(`${st}ied`); out.add(`${st}ier`); out.add(`${st}iest`); out.add(`${st}ily`); out.add(`${st}iness`); }
  if (last === "e") { const st = w.slice(0, -1); ["d", "r", "st"].forEach((x) => out.add(`${w}${x}`)); out.add(`${st}ing`); out.add(`${st}ably`); out.add(`${st}ly`); }
  else { ["ed", "er", "est", "ing", "ly", "ness", "y"].forEach((x) => out.add(`${w}${x}`)); }
  if (w.endsWith("ic")) out.add(`${w}ally`);
  if (w.endsWith("le")) out.add(`${w.slice(0, -1)}y`);
  if (w.endsWith("ue")) out.add(`${w.slice(0, -2)}uing`);
  if (w.endsWith("ie")) out.add(`${w.slice(0, -2)}ying`);
  // พยัญชนะท้ายซ้ำ (stop → stopped/stopping, big → bigger) เมื่อรูปเป็น พยัญชนะ-สระ-พยัญชนะ
  if (w.length >= 3 && cons && isVowel(prev) && !isVowel(w.at(-3)) && !/[wxy]/.test(last)) ["ed", "er", "est", "ing", "y"].forEach((x) => out.add(`${w}${last}${x}`));
  if (w.length === 3 && cons && isVowel(prev) && !isVowel(w[0]) && !/[wxy]/.test(last)) ["ed", "er", "est", "ing", "y"].forEach((x) => out.add(`${w}${last}${x}`));
  return out;
}

/** แยกคำจากข้อความ: ตัวอักษร (รวม ' ’ -) ตัวพิมพ์เล็ก ตัด 's ท้ายคำ */
export function tokens(text) {
  return (String(text).toLowerCase().normalize("NFC").match(/[\p{L}]+(?:['’-][\p{L}]+)*/gu) || []).map((t) => t.replace(/['’]s$/, "").replace(/’/g, "'"));
}

/** จำนวนคำในประโยค (ตัวเลขไม่นับ) */
export const wordCount = (text) => tokens(text).length;

/** ข้อความมีคำนั้นหรือรูปผัน (เป็นโทเค็นทั้งคำ) — ถ้าไม่เจอ ลองแยกคำที่มีขีด (well-known → well, known) ด้วย */
export function containsWord(text, word) {
  const f = forms(word);
  const toks = tokens(text);
  if (toks.some((t) => f.has(t))) return true;
  return toks.some((t) => t.includes("-") && t.split("-").some((p) => f.has(p)));
}

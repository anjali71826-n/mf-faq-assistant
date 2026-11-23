// Facts-only FAQ engine for Groww Mutual Fund schemes.
// Pipeline: guardrails (PII → advice → performance → out-of-scope) → intent + scheme
// detection → structured fact lookup or BM25 retrieval → ≤3-sentence answer with ONE source link.
// Runs in the browser and in Node (scripts/run_samples.mjs uses it to produce sample_qa.md).

const EDU = {
  advice: { title: "AMFI – Mutual Funds Sahi Hai (investor education)", url: "https://www.mutualfundssahihai.com/en" },
  sebiFaq: { title: "SEBI – FAQs for Mutual Fund Investors", url: "https://www.sebi.gov.in/sebi_data/faqfiles/sep-2024/1727242783639.pdf" },
  factsheet: { title: "Groww MF – Fact sheet downloads", url: "https://www.growwmf.in/downloads/fact-sheet" },
  pii: { title: "SEBI investor site", url: "https://investor.sebi.gov.in/" },
  kimHub: { title: "Groww MF – KIM downloads", url: "https://www.growwmf.in/downloads/kim" },
};

const SCHEME_PATTERNS = [
  ["elss", /\belss\b|tax[\s-]?saver|tax[\s-]?saving|80\s?c\b/i],
  ["total-market", /total[\s-]?market|\bindex fund\b/i],
  ["small-cap", /small[\s-]?cap(?![\s-]?250)/i],
  ["multicap", /multi[\s-]?cap/i],
  ["large-cap", /large[\s-]?cap|blue[\s-]?chip/i],
];

const OTHER_AMC = /\b(hdfc|sbi|icici|axis|nippon|kotak|mirae|parag|ppfas|quant|uti|aditya|birla|tata|dsp|motilal|franklin|canara|bandhan|edelweiss|invesco|hsbc|sundaram|baroda|lic|mahindra|navi|zerodha|whiteoak|bajaj)\b/i;

// --- Guardrails -------------------------------------------------------------
const PII = [
  ["PAN", /\b[a-z]{5}\d{4}[a-z]\b/i],
  ["Aadhaar", /\b\d{4}[\s-]?\d{4}[\s-]?\d{4}\b/],
  ["phone number", /(\+91[\s-]?)?\b[6-9]\d{9}\b/],
  ["email address", /[^\s@]+@[^\s@]+\.[a-z]{2,}/i],
  ["OTP", /\botp\b[^\n]{0,20}\d{4,8}|\d{4,8}[^\n]{0,20}\botp\b/i],
  ["account/folio number", /\b(account|a\/c|acct|folio)\b[^\n]{0,15}\d{6,}/i],
  ["long ID number", /\b\d{9,18}\b/],
];
const ADVICE = /\b(should|shall|must) i\b|\bis it (a )?(good|safe|wise|right|worth)\b|\bworth (it|investing|buying)\b|\b(recommend|suggest|advi[cs]e)\b|\bbest\b|\bbetter\b|\bwhich (one|fund|scheme)\b|\bgood (investment|fund|time|option|choice)\b|\b(right|suitable|ideal) for me\b|\bmy portfolio\b|\ballocat|\bwill (it|the fund|nav) (go|grow|rise|fall|increase|double)\b|\b(buy|sell|hold) (now|or)\b/i;
const PERFORMANCE = /\breturns?\b|\bcagr\b|\bxirr\b|\bperform(ance|ed|ing)?\b|\bhow much (will|would|can|did) (i|it)\b|\bprofit\b|\boutperform|\bbeat (the )?(market|index|benchmark)\b|\b(compare|comparison)\b.*\b(return|growth)/i;

// --- Intent (which fact is being asked) --------------------------------------
const INTENTS = [
  ["statement", /statement|\bcas\b|capital[\s-]?gains?|tax (doc|document|proof|report)|holding(s)? report/i],
  ["lock_in", /lock[\s-]?in|locked|lock period|before (3|three) years|(redeem|withdraw|exit|sell)\w* (it )?(early|before)/i],
  ["tax_benefit", /tax (benefit|saving|deduction|exemption)|\b80\s?c\b|deduction/i],
  ["exit_load", /exit[\s-]?load|\bloads?\b|redemption (charge|fee)|charge.*(redeem|withdraw|exit)|(redeem|withdraw).*(charge|fee|penalty)/i],
  ["expense_ratio", /expense|\bter\b|fees?\b|management (fee|charge)|annual charge/i],
  ["min_sip", /\bsip\b|systematic investment/i],
  ["min_lumpsum", /lump[\s-]?sum|one[\s-]?time|minimum (investment|amount|purchase)|min(imum)? (to )?invest/i],
  ["riskometer", /risk/i],
  ["benchmark", /benchmark|track(s|ing)?\b|which index/i],
  ["fund_manager", /fund manager|managers?\b|who manages/i],
  ["objective", /objective|aim of|goal of|invest(s)? in what|what does .* invest/i],
  ["nav", /\bnav\b|net asset value/i],
  ["category", /category|what type|kind of fund/i],
];

// Preferred sources for general (scheme-less) questions – retrieval is restricted to these.
const GENERAL_SOURCES = {
  statement: ["S20", "S16", "S18", "S14"],
  lock_in: ["S22", "S18"],
  exit_load: ["S17", "S23", "S18"],
  expense_ratio: ["S18", "S21"],
  riskometer: ["S18"],
  benchmark: ["S18"],
  min_sip: ["S24", "S15"],
  nav: ["S18", "S15"],
};

// Curated answers for frequent "how-to" questions. Every sentence paraphrases the cited
// official page closely (checked by hand against the corpus text); retrieval handles the rest.
const CURATED = [
  {
    id: "capital_gains",
    when: /capital[\s-]?gains?|tax (statement|report|proof|document)/i,
    text: "Sign up on MFCentral (the investor portal run jointly by CAMS and KFintech) and generate a 'Detailed' CAS, choosing the Current Financial Year, Previous Financial Year or a specific period of up to 365 days. You can also request an e-CAS by email from CAMS or KFintech; it is sent to the email address registered with your mutual fund. My official sources don't describe a separate capital-gains report, so check the Detailed CAS for the transactions you need.",
    source: { title: "AMFI – Download CAS", url: "https://www.amfiindia.com/online-center/download-cas" },
  },
  {
    id: "cas_when",
    when: /\b(when|how often|frequency|by what date|which date|by when|every month|monthly|half[\s-]?year)/i,
    intent: "statement",
    text: "Groww Mutual Fund's Investor Charter says the monthly Consolidated Account Statement (CAS) is provided by the 12th of the following month in electronic mode (15th for physical). If there were no transactions, a half-yearly CAS is provided by the 18th of the following month electronically (21st for physical).",
    source: { title: "Investor Charter – Groww Mutual Fund", url: "https://assets-netstorage.growwmf.in/compliance_docs/Downloads/Investor%20charter/Investor%20Charter_GrowwMF.pdf" },
  },
  {
    id: "cas_how",
    intent: "statement",
    text: "A Consolidated Account Statement (CAS) shows your mutual fund holdings across all fund houses in one document. CAMS and KFintech email an e-CAS to investors who have registered their email with their mutual funds, and MFCentral lets registered users view and download a Summary or Detailed CAS. Your PAN must be updated on your folios and demat account to receive a CAS.",
    source: { title: "AMFI – Download CAS", url: "https://www.amfiindia.com/online-center/download-cas" },
  },
  {
    id: "exit_load_def",
    intent: "exit_load",
    text: "An exit load is a fee a mutual fund charges when you redeem or switch out units before a pre-defined period. It is expressed as a percentage of the redemption value and is meant to discourage short-term trading. Ask about a specific Groww scheme to get its exact exit load.",
    source: { title: "SEBI investor site – Exit load", url: "https://investor.sebi.gov.in/exit_load.html" },
  },
  {
    id: "min_sip_general",
    intent: "min_sip",
    text: "The minimum SIP differs by scheme. Name one of the five schemes (Large Cap, ELSS Tax Saver, Multicap, Small Cap or Nifty Total Market Index Fund) and I'll quote its official figure.",
    source: { title: "Groww MF – KIM downloads", url: "https://www.growwmf.in/downloads/kim" },
  },
];

const STOP = new Set("a an the of to in on for and or is are was be by with what whats which how do does i my me it its this that from at as can about tell please much any there their give get show us you your fund funds scheme schemes groww mutual mf direct growth plan".split(" "));
const tok = (s) => (s.toLowerCase().match(/[a-z0-9]+/g) || []).filter((w) => !STOP.has(w)).map((w) => (w.length > 4 && w.endsWith("s") ? w.slice(0, -1) : w));

function buildIndex(chunks) {
  const docs = chunks.map((c) => tok(c.title + " " + c.text));
  const df = new Map();
  docs.forEach((d) => new Set(d).forEach((w) => df.set(w, (df.get(w) || 0) + 1)));
  const avg = docs.reduce((a, d) => a + d.length, 0) / docs.length;
  const tfs = docs.map((d) => { const m = new Map(); d.forEach((w) => m.set(w, (m.get(w) || 0) + 1)); return m; });
  const N = docs.length;
  return function search(query, allow) {
    const q = [...new Set(tok(query))];
    const scored = [];
    chunks.forEach((c, i) => {
      if (allow && !allow.has(c.source_id)) return;
      let s = 0;
      for (const w of q) {
        const f = tfs[i].get(w); if (!f) continue;
        const idf = Math.log(1 + (N - df.get(w) + 0.5) / (df.get(w) + 0.5));
        s += idf * (f * 2.2) / (f + 1.2 * (0.25 + 0.75 * docs[i].length / avg));
      }
      if (s > 0) scored.push([s, c]);
    });
    return scored.sort((a, b) => b[0] - a[0]);
  };
}

const fmtDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const rupees = (n) => "₹" + Number(n).toLocaleString("en-IN");

function bestSentences(text, query, max = 2) {
  const q = new Set(tok(query));
  const seen = new Set();
  const sents = text.split(/(?<=[.!?])\s+(?=[A-Z0-9"(])/)
    .map((s) => s.replace(/\(?\s*https?:\/\/\S+?\s*\)?(?=[\s,.]|$)/g, "").replace(/\s{2,}/g, " ").replace(/\s+([,.])/g, "$1").trim())
    .filter((s) => s.length > 40 && s.length < 420 && /[a-z]{3}/.test(s) && /[.!?]$/.test(s) && !seen.has(s) && seen.add(s));
  const scored = sents.map((s, i) => [tok(s).filter((w) => q.has(w)).length, i, s]).filter((x) => x[0] > 0);
  return scored.sort((a, b) => b[0] - a[0] || a[1] - b[1]).slice(0, max).sort((a, b) => a[1] - b[1]).map((x) => x[2]);
}

export function createEngine(corpus, schemesDoc) {
  const chunks = corpus.chunks;
  const schemes = schemesDoc.schemes;
  const search = buildIndex(chunks);
  const updated = fmtDate(corpus.meta.last_updated);

  const reply = (kind, text, source, extra = {}) => ({ kind, text, source, updated: `Last updated from sources: ${updated}`, ...extra });

  function schemeFact(key, intent) {
    const s = schemes[key];
    const short = s.name.replace(/ Direct Growth$/, "");
    const src = (field) => (s.field_sources[field] ? { title: `KIM – ${short}`, url: s.field_sources[field].url } : { title: `${short} – official scheme page`, url: s.url });
    switch (intent) {
      case "expense_ratio":
        if (s.expense_ratio_pct == null) return null;
        return [`The expense ratio (TER) of ${short} – Direct Plan is ${s.expense_ratio_pct}% per year, inclusive of GST.`, src("expense_ratio_pct")];
      case "exit_load":
        return [`Exit load for ${short}: ${s.exit_load.replace(/\s*,\s*;/g, ";").replace(/\.$/, "")}.`, src("exit_load")];
      case "min_sip":
        if (s.min_sip == null) return null;
        return [`The minimum SIP amount for ${short} is ${rupees(s.min_sip)}; the minimum lumpsum is ${rupees(s.min_lumpsum)}.`, src("min_sip")];
      case "min_lumpsum":
        return [`The minimum lumpsum (one-time) investment in ${short} is ${rupees(s.min_lumpsum)}, and additional purchases start at ${rupees(s.min_additional)}.`, src("min_lumpsum")];
      case "lock_in":
        return s.lock_in
          ? [`${short} has a lock-in of ${s.lock_in} from the date of allotment of units, as it is an ELSS (Section 80C) scheme.`, src("lock_in")]
          : [`${short} has no lock-in period; exit load rules apply instead (${s.exit_load.split(/[,;]/)[0].trim()}).`, src("lock_in")];
      case "riskometer":
        return [`The riskometer of ${short} is at "${s.riskometer}" risk. Its benchmark (${s.benchmark}) riskometer is at "${s.benchmark_riskometer}".`, src("riskometer")];
      case "benchmark":
        return [`The benchmark of ${short} is the ${s.benchmark}.`, src("benchmark")];
      case "fund_manager":
        return [`${short} is managed by ${s.fund_managers.join(", ").replace(/, ([^,]*)$/, " and $1")}.`, src("fund_managers")];
      case "objective":
        return [s.objective.split(/(?<=\.)\s/).slice(0, 2).join(" "), src("objective")];
      case "tax_benefit":
        return s.lock_in
          ? [`${short} is an ELSS scheme that offers tax benefits under Section 80C of the Income Tax Act, 1961, with a ${s.lock_in.replace(/ years?$/, "-year")} lock-in. Whether you can claim it depends on your own tax situation, which I can't advise on.`, src("objective")]
          : [`${short} is not an ELSS scheme, so it is not described as offering Section 80C tax benefits on its official page.`, src("objective")];
      case "category":
        return [`${short} is in the ${s.category} category (${s.plan}).`, src("category")];
      case "nav":
        return [`The latest NAV of ${short} is published daily on its official scheme page; I don't quote prices or compute returns.`, src("nav")];
      default:
        return null;
    }
  }

  function retrieve(query, allowIds, minScore = 4) {
    const hits = search(query, allowIds ? new Set(allowIds) : null);
    for (const [score, c] of hits.slice(0, 5)) {
      if (score < minScore) break;
      const sents = bestSentences(c.text, query);
      if (sents.length) return { text: sents.join(" "), source: { title: c.title, url: c.url }, score };
    }
    return null;
  }

  return function answer(raw) {
    const q = (raw || "").trim().slice(0, 500);
    if (!q) return reply("refuse", "Please type a question about one of the five Groww Mutual Fund schemes listed below.", EDU.kimHub, { rule: "empty" });

    if (/^(hi|hello|hey|namaste|good (morning|afternoon|evening)|thanks?|thank you)\b[\s!.]*$/i.test(q)) {
      return reply("answer", "Hello! Ask me a factual question about Groww Mutual Fund's Large Cap, ELSS Tax Saver, Multicap, Small Cap or Nifty Total Market Index Fund, for example its expense ratio, exit load or minimum SIP.", EDU.kimHub, { rule: "greeting" });
    }
    for (const [label, re] of PII) {
      if (re.test(q)) {
        return reply("pii", `It looks like your message contains ${/^[aeiou]/i.test(label) ? "an" : "a"} ${label}. For your safety I don't accept or store personal details such as PAN, Aadhaar, account numbers, OTPs, email or phone numbers, so I've discarded it. Please ask your question without them.`, EDU.pii, { redact: true, rule: "pii", piiType: label });
      }
    }

    const detected = SCHEME_PATTERNS.filter(([, re]) => re.test(q)).map(([k]) => k);
    if (ADVICE.test(q)) {
      return reply("refuse", "I can only share facts from official documents, not investment advice or recommendations on what to buy, sell or hold. For help deciding, consider a SEBI-registered investment adviser; AMFI's investor-education site explains how to evaluate schemes.", EDU.advice, { rule: "advice", scheme: detected[0] });
    }
    if (PERFORMANCE.test(q) && !/capital[\s-]?gain/i.test(q)) {
      const key = detected[0];
      const src = key ? { title: `${schemes[key].name.replace(/ Direct Growth$/, "")} – official scheme page`, url: schemes[key].url } : EDU.factsheet;
      return reply("refuse", "I don't quote, compute or compare returns or performance. Please see the official scheme page or the AMC factsheet for performance data.", src, { rule: "performance", scheme: key });
    }
    if (OTHER_AMC.test(q) && !detected.length) {
      return reply("refuse", "I only cover five Groww Mutual Fund schemes: Large Cap, ELSS Tax Saver, Multicap, Small Cap and Nifty Total Market Index Fund. For other fund houses, please check that AMC's own scheme documents.", EDU.kimHub, { rule: "scope" });
    }

    const intents = INTENTS.filter(([, re]) => re.test(q)).map(([k]) => k);
    const intent = intents[0] || null;

    if (detected.length && intent && intent !== "statement") {
      const key = detected[0];
      const fact = schemeFact(key, intent);
      const more = detected.length > 1 ? " Ask about one scheme at a time so I can cite its source." : "";
      if (fact) {
        // A second fact is added only when it comes from the same page (one citation per answer).
        const second = intents.slice(1).map((i) => schemeFact(key, i)).find((f) => f && f[1].url === fact[1].url);
        const skipped = !more && intents.length > 1 && !second && intents[1] !== "statement" ? " Ask about the other fact separately so I can cite its own source." : "";
        return reply("answer", fact[0] + (second && !more ? " " + second[0] : "") + more + skipped, fact[1], { intent, scheme: key, rule: "fact" });
      }
      if (intent === "expense_ratio") {
        return reply("answer", `The official scheme page for ${schemes[key].name.replace(/ Direct Growth$/, "")} doesn't currently show an expense ratio. Its KIM says current expenses are published on the AMC's expense-ratio page, along with notices of any TER change at least three working days in advance.`, { title: "Groww MF – Expense ratio / TER notices", url: "https://www.growwmf.in/downloads/expense-ratio" }, { intent, scheme: key, rule: "fact" });
      }
      return reply("answer", `The official scheme page for ${schemes[key].name.replace(/ Direct Growth$/, "")} does not currently list this. Please check the scheme's Key Information Memorandum (KIM).`, { title: "KIM (official)", url: schemes[key].kim_url }, { intent, scheme: key, rule: "fact" });
    }

    if (detected.length && !intent) {
      const s = schemes[detected[0]];
      const short = s.name.replace(/ Direct Growth$/, "");
      return reply("answer", `${short}: expense ratio ${s.expense_ratio_pct ?? "see KIM"}${s.expense_ratio_pct != null ? "%" : ""}, minimum SIP ${s.min_sip ? rupees(s.min_sip) : "see KIM"}, riskometer "${s.riskometer}", benchmark ${s.benchmark}. Ask about any one fact (e.g. exit load or lock-in) for detail.`, { title: `${short} – official scheme page`, url: s.url }, { scheme: detected[0], rule: "fact" });
    }

    // Curated how-to answers (statements, definitions).
    const card = CURATED.find((c) => (c.when ? c.when.test(q) : true) && (c.intent ? c.intent === intent : true));
    if (card) return reply("answer", card.text, card.source, { intent, via: "curated", rule: "curated" });

    // General question (no scheme named): retrieve from the preferred official sources.
    const pool = intent && GENERAL_SOURCES[intent];
    const hit = (pool && retrieve(q + " " + intent.replace("_", " "), pool, 2)) || retrieve(q, null, 6);
    if (hit) return reply("answer", hit.text, hit.source, { intent, via: "retrieval", rule: "retrieval", score: hit.score });

    return reply("refuse", "I couldn't find that in my official sources. I answer factual questions (expense ratio, exit load, minimum SIP, lock-in, riskometer, benchmark, statements) about five Groww Mutual Fund schemes.", EDU.kimHub, { rule: "notfound" });
  };
}

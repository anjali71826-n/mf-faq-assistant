import { createEngine } from "./engine.js?v=3";

/* ---------------- helpers ---------------- */
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v == null || v === false) continue;
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else n.setAttribute(k, v);
  }
  n.append(...kids.filter((k) => k != null && k !== false));
  return n;
};
const svg = (markup, cls) => { const t = document.createElement("template"); t.innerHTML = markup.trim(); const s = t.content.firstChild; if (cls) s.setAttribute("class", cls); return s; };
const LINK_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3M9 3h4v4M13 3 7.5 8.5"/></svg>';
const fmtDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const rupees = (n) => "₹" + Number(n).toLocaleString("en-IN");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
const params = new URLSearchParams(location.search);
const EMBED = params.get("embed") === "1";
if (EMBED) document.body.classList.add("embed");

const INTENT_LABEL = { expense_ratio: "Expense ratio", exit_load: "Exit load", min_sip: "Minimum SIP", min_lumpsum: "Lumpsum", lock_in: "Lock-in", tax_benefit: "80C / tax", riskometer: "Riskometer", benchmark: "Benchmark", fund_manager: "Fund manager", objective: "Objective", nav: "NAV", category: "Category", statement: "Statements" };
const RULE_LABEL = { fact: "Structured fact", curated: "Curated answer", retrieval: "Retrieved passage", greeting: "Greeting", advice: "Advice refused", performance: "Returns refused", scope: "Out of scope", pii: "PII blocked", notfound: "Not found", empty: "Empty question" };
const OUTCOME = (r) => (["fact", "curated", "retrieval", "greeting"].includes(r) ? "answered" : r === "pii" ? "pii" : r === "notfound" ? "notfound" : "refused");
const OUTCOME_LABEL = { answered: "Answered", refused: "Refused (advice, returns, scope)", pii: "PII blocked", notfound: "Not found" };
const SCHEME_LABEL = { "large-cap": "Groww Large Cap Fund", elss: "Groww ELSS Tax Saver Fund", multicap: "Groww Multicap Fund", "small-cap": "Groww Small Cap Fund", "total-market": "Groww Nifty Total Market Index Fund" };

const state = { answer: null, schemes: null, sources: null, meta: null, log: [] };

/* ---------------- routing + drawer ---------------- */
const TITLES = { assistant: "Assistant", knowledge: "Knowledge base", sources: "Sources", guardrails: "Guardrails", insights: "Insights", embed: "Embed widget", about: "About & compliance" };
function route() {
  let name = (location.hash.match(/^#\/(\w+)/) || [])[1];
  if (EMBED || !TITLES[name]) name = "assistant";
  $$(".view").forEach((v) => (v.hidden = v.dataset.view !== name));
  $$("[data-route]").forEach((a) => (a.dataset.route === name ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  $("#page-title").textContent = TITLES[name];
  document.title = `${TITLES[name]} · MF Facts`;
  $("#content").scrollTop = 0;
  setDrawer(false);
  if (name === "insights") renderInsights();
  if (name === "embed") loadEmbedPreview();
  if (name === "assistant" && !EMBED && matchMedia("(min-width: 861px)").matches) setTimeout(() => input.focus({ preventScroll: true }), 50);
}
function setDrawer(open) {
  document.body.classList.toggle("drawer-open", open);
  $(".scrim").hidden = !open;
  $(".menu-btn").setAttribute("aria-expanded", String(open));
}
$$("[data-drawer]").forEach((b) => b.addEventListener("click", () => setDrawer(b.dataset.drawer === "open")));
addEventListener("keydown", (e) => { if (e.key === "Escape") setDrawer(false); });
addEventListener("hashchange", route);

/* ---------------- assistant ---------------- */
const thread = $("#thread");
const input = $("#q");
const scroller = $("#chat-scroll");
let busy = false;
let stick = true; // follow new content unless the user scrolled up to read

const atBottom = () => scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 60;
const toBottom = (smooth) => { if (stick) scroller.scrollTo({ top: scroller.scrollHeight, behavior: smooth && !reduceMotion ? "smooth" : "auto" }); };
// Only a real upward scroll (the user reading back) stops auto-follow; reaching the bottom resumes it.
let lastTop = 0;
scroller.addEventListener("scroll", () => {
  const top = scroller.scrollTop;
  if (top < lastTop - 4) stick = false;
  if (atBottom()) stick = true;
  lastTop = top;
}, { passive: true });

function prefill(q) {
  if (location.hash !== "#/assistant" && !EMBED) location.hash = "#/assistant";
  input.value = q;
  input.focus();
  input.setSelectionRange(q.length, q.length);
}
$$(".suggest-card").forEach((b) => b.addEventListener("click", () => prefill(b.dataset.q)));

function addUser(text, redacted) {
  thread.append(el("div", { class: "bubble-user" + (redacted ? " redacted" : ""), text: redacted ? "Message hidden: it contained personal details" : text }));
}

function addAnswer(r) {
  const label = r.kind === "answer" ? "Answer" : r.kind === "pii" ? "Privacy" : "Facts only";
  const chip = el("a", { class: "src-chip", href: r.source.url, target: "_blank", rel: "noopener noreferrer", title: r.source.title }, svg(LINK_ICON), el("span", { text: r.source.title }));
  const text = el("p", { class: "streaming" });
  const foot = el("div", { class: "card-foot" }, chip, r.updated ? el("span", { class: "updated", text: r.updated }) : null);
  foot.hidden = true;
  const card = el("article", { class: `card-answer ${r.kind}`, "aria-busy": "true" },
    el("div", { class: "card-head" }, el("span", { class: "dot", "aria-hidden": "true" }), label), text, foot);
  thread.append(card);
  toBottom(true);

  // Stream the answer a couple of words at a time, then reveal the citation.
  const parts = r.text.split(/(\s+)/);
  let i = 0;
  const finish = () => {
    text.textContent = r.text;
    text.classList.remove("streaming");
    foot.hidden = false;
    foot.classList.add("reveal");
    card.removeAttribute("aria-busy");
    busy = false;
    toBottom(true);
  };
  if (reduceMotion) return finish();
  (function tick() {
    if (i >= parts.length) return finish();
    text.textContent += parts.slice(i, i + 4).join("");
    i += 4;
    toBottom(false);
    setTimeout(tick, 22 + Math.random() * 30);
  })();
}

function ask(q) {
  q = (q || "").trim();
  if (!q || busy) return;
  if (!state.answer) return;
  busy = true;
  stick = true;
  const r = state.answer(q);
  addUser(q, r.redact);
  input.value = "";
  record(q, r);
  renderTrace(q, r);
  const typing = el("div", { class: "typing", role: "status", "aria-label": "Finding the answer" }, el("i"), el("i"), el("i"));
  thread.append(typing);
  toBottom(true);
  setTimeout(() => { typing.remove(); addAnswer(r); }, reduceMotion ? 0 : 380);
}
$("#composer").addEventListener("submit", (e) => { e.preventDefault(); ask(input.value); });

function renderTrace(q, r) {
  const outcome = OUTCOME(r.rule);
  const tag = (cls, t) => el("span", { class: `tag ${cls}`, text: t });
  const row = (k, ...v) => el("div", {}, el("dt", { text: k }), el("dd", {}, ...v));
  const guard = r.rule === "pii" ? tag("warn", `Blocked: ${r.piiType}`) : ["advice", "performance", "scope"].includes(r.rule) ? tag("warn", RULE_LABEL[r.rule]) : tag("ok", "Passed");
  $("#trace").replaceChildren(...[
    row("Question", document.createTextNode(r.redact ? "Hidden (personal details)" : q)),
    row("Guardrails", guard),
    row("Scheme", document.createTextNode(r.scheme ? SCHEME_LABEL[r.scheme] : "None detected")),
    row("Topic", document.createTextNode(r.intent ? INTENT_LABEL[r.intent] || r.intent : "General")),
    row("Answer route", tag(outcome === "answered" ? "info" : "warn", RULE_LABEL[r.rule] || r.rule)),
    r.score ? row("BM25 score", document.createTextNode(r.score.toFixed(2))) : null,
    row("Source", el("a", { href: r.source.url, target: "_blank", rel: "noopener noreferrer", text: r.source.title })),
    row("Length", document.createTextNode(`${(r.text.match(/[.!?](\s|$)/g) || []).length || 1} sentence(s) · 1 citation`)),
  ].filter(Boolean));
  $("#trace").hidden = false;
  $("#trace-empty").hidden = true;
}

/* ---------------- insights (session only) ---------------- */
function record(q, r) {
  state.log.unshift({ t: new Date(), q: r.redact ? "[hidden: personal details]" : q, rule: r.rule, intent: r.intent, source: r.source });
  const c = $("#nav-q-count"); c.hidden = false; c.textContent = state.log.length;
}
function renderInsights() {
  const L = state.log;
  const n = L.length;
  const by = (f) => L.reduce((m, x) => { const k = f(x); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
  const outcomes = by((x) => OUTCOME(x.rule));
  const pct = (v) => (n ? Math.round((v / n) * 100) + "%" : "–");
  const kpi = (k, v, s) => el("div", { class: "kpi" }, el("div", { class: "kpi-k", text: k }), el("div", { class: "kpi-v", text: v }), el("div", { class: "kpi-s", text: s }));
  $("#kpis").replaceChildren(
    kpi("Questions", String(n), "this session"),
    kpi("Answered", pct(outcomes.answered || 0), `${outcomes.answered || 0} with a citation`),
    kpi("Refused", String(outcomes.refused || 0), "advice, returns or scope"),
    kpi("PII blocked", String(outcomes.pii || 0), "never stored"),
  );
  const bars = (target, counts, labels, warnKeys = []) => {
    const entries = Object.entries(counts).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...entries.map((e) => e[1]));
    $(target).replaceChildren(...(entries.length ? entries.map(([k, v]) =>
      el("div", { class: "bar-row" }, el("span", { text: labels[k] || k }), el("div", { class: "bar-track" }, el("div", { class: `bar-fill${warnKeys.includes(k) ? " warn" : ""}`, style: `width:${(v / max) * 100}%` })), el("span", { class: "bar-n", text: String(v) })))
      : [el("p", { class: "empty", text: "No data yet." })]));
  };
  bars("#intent-bars", by((x) => x.intent || (OUTCOME(x.rule) === "answered" ? "general" : null)), { ...INTENT_LABEL, general: "General" });
  bars("#outcome-bars", outcomes, OUTCOME_LABEL, ["refused", "pii", "notfound"]);
  const tbody = $("#log-table tbody");
  tbody.replaceChildren(...L.slice(0, 50).map((x) => el("tr", {},
    el("td", { class: "muted", text: x.t.toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) }),
    el("td", { text: x.q }),
    el("td", {}, el("span", { class: `tag ${OUTCOME(x.rule) === "answered" ? "ok" : "warn"}`, text: RULE_LABEL[x.rule] || x.rule })),
    el("td", { class: "muted", text: x.intent ? INTENT_LABEL[x.intent] || x.intent : "–" }),
    el("td", {}, el("a", { href: x.source.url, target: "_blank", rel: "noopener noreferrer", text: x.source.title })),
  )));
  $("#log-table").hidden = !n;
  $("#log-empty").hidden = !!n;
}
$("#reset-insights").addEventListener("click", () => { state.log = []; $("#nav-q-count").hidden = true; renderInsights(); });

/* ---------------- knowledge base ---------------- */
const RISK = ["Low", "Low to Moderate", "Moderate", "Moderately High", "High", "Very High"];
const ORDER = ["large-cap", "elss", "multicap", "small-cap", "total-market"];
const CAT = { "large-cap": "Large Cap", elss: "ELSS · Tax saver", multicap: "Multi Cap", "small-cap": "Small Cap", "total-market": "Index fund" };
function renderSchemes() {
  $("#scheme-grid").replaceChildren(...ORDER.filter((k) => state.schemes[k]).map((key) => {
    const s = state.schemes[key];
    const short = s.name.replace(/ Direct Growth$/, "");
    const level = RISK.findIndex((r) => r.toLowerCase() === String(s.riskometer).toLowerCase());
    const meter = el("div", { class: "meter", role: "img", "aria-label": `Riskometer: ${s.riskometer}` }, ...RISK.map((_, i) => el("i", { class: i <= level ? "on" : null })));
    const row = (k, ...v) => el("li", {}, el("span", { class: "k", text: k }), el("span", {}, ...v));
    const notes = Object.entries(s.field_sources || {}).map(([, o]) => o.note);
    const askBtn = el("button", { class: "btn ghost", type: "button", text: "Ask about it" });
    askBtn.addEventListener("click", () => prefill(`Exit load of ${short}?`));
    return el("article", { class: "scheme" },
      el("span", { class: "scheme-cat", text: CAT[key] }),
      el("h2", { text: short }),
      s.expense_ratio_pct != null
        ? el("div", { class: "big" }, el("b", { text: `${s.expense_ratio_pct}%` }), el("span", { text: "expense ratio (TER, incl. GST)" }))
        : el("div", { class: "big na" }, el("b", { text: "Not listed" }), el("span", { text: "expense ratio, see KIM" })),
      el("ul", { class: "facts" },
        row("Exit load", s.exit_load || "–"),
        row("Minimum SIP", s.min_sip ? rupees(s.min_sip) : "Not listed (see KIM)"),
        row("Lumpsum", s.min_lumpsum ? rupees(s.min_lumpsum) : "–"),
        row("Lock-in", s.lock_in ? `${s.lock_in} (Section 80C)` : "None"),
        row("Riskometer", el("span", { text: s.riskometer }), meter),
        row("Benchmark", s.benchmark || "–"),
      ),
      notes.length ? el("p", { class: "note-src", text: notes.join(" ") }) : null,
      el("div", { class: "scheme-actions" },
        el("a", { class: "btn", href: s.url, target: "_blank", rel: "noopener noreferrer", text: "Official page" }),
        el("a", { class: "btn ghost", href: s.kim_url, target: "_blank", rel: "noopener noreferrer", text: "KIM (PDF)" }),
        askBtn),
    );
  }));
}

/* ---------------- sources ---------------- */
const pubKind = (p) => (p.startsWith("SEBI") ? ["s", "SEBI"] : p.startsWith("AMFI") ? ["a", "AMFI"] : ["g", "Groww MF"]);
function renderSources(filter = "all") {
  const S = state.sources;
  const count = (f) => S.filter((s) => s.publisher.startsWith(f)).length;
  const kpi = (k, v, s) => el("div", { class: "kpi" }, el("div", { class: "kpi-k", text: k }), el("div", { class: "kpi-v", text: v }), el("div", { class: "kpi-s", text: s }));
  $("#src-kpis").replaceChildren(
    kpi("Sources", String(S.length), `${state.meta.chunk_count} indexed passages`),
    kpi("Groww MF (AMC)", String(count("Groww")), "scheme pages, KIMs, charter"),
    kpi("SEBI", String(count("SEBI")), "investor pages, FAQ, circular"),
    kpi("AMFI", String(count("AMFI")), "CAS, TER, investor education"),
  );
  $("#source-table tbody").replaceChildren(...S.filter((s) => filter === "all" || s.publisher.startsWith(filter)).map((s) => {
    const [cls, name] = pubKind(s.publisher);
    return el("tr", {},
      el("td", { class: "title" }, el("a", { href: s.url, target: "_blank", rel: "noopener noreferrer", text: s.title })),
      el("td", {}, el("span", { class: `pub ${cls}` }, el("i", { "aria-hidden": "true" }), name)),
      el("td", { class: "muted", text: s.type }),
      el("td", { class: "muted", text: s.topics }),
      el("td", { class: "muted", text: fmtDate(s.fetched_on) }),
    );
  }));
}
$$(".filter button").forEach((b) => b.addEventListener("click", () => {
  $$(".filter button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  renderSources(b.dataset.pub);
}));

/* ---------------- guardrails ---------------- */
const POLICIES = [
  { name: "Personal data block", status: "Enforced", desc: "Detects PAN, Aadhaar, phone numbers, email addresses, OTPs, folio or account numbers and long ID numbers. The message is hidden in the chat, never stored, and the user is asked to rephrase.", eg: "My PAN is ABCDE1234F, what is the exit load?", test: "My PAN is ABCDE1234F, what is the exit load of Groww Small Cap Fund?" },
  { name: "No investment advice", status: "Enforced", desc: "Questions such as should I, best, better, which fund, recommend or right for me get a polite facts-only reply that points to AMFI investor education and SEBI-registered advisers.", eg: "Should I buy Groww Small Cap Fund now?", test: "Should I buy Groww Small Cap Fund now?" },
  { name: "No performance claims", status: "Enforced", desc: "Returns, CAGR, performance and comparisons are never quoted or computed. The user gets a link to the official scheme page or factsheet instead. Return fields are removed from the index when it is built.", eg: "What returns did Groww Large Cap Fund give?", test: "What returns did Groww Large Cap Fund give in 3 years?" },
  { name: "Scope lock", status: "Enforced", desc: "Only the five Groww Mutual Fund schemes in this workspace are answered. Questions about other fund houses get a scope message.", eg: "Expense ratio of HDFC Top 100?", test: "Expense ratio of HDFC Top 100?" },
  { name: "Grounded and cited", status: "Enforced", desc: "Every answer is at most three sentences from an official AMC, SEBI or AMFI page, with exactly one source link and the date the sources were last updated. If nothing matches confidently, it says so instead of guessing.", eg: "How do I download my capital-gains statement?", test: "How do I download my capital-gains statement?" },
];
function renderPolicies() {
  $("#policy-list").replaceChildren(...POLICIES.map((p, i) => {
    const b = el("button", { class: "btn ghost", type: "button", text: "Test" });
    b.addEventListener("click", () => prefill(p.test));
    return el("article", { class: "policy" },
      el("span", { class: "policy-n", text: String(i + 1) }),
      el("div", {}, el("h3", {}, p.name, el("span", { class: "tag ok", text: p.status })), el("p", { text: p.desc }), el("p", { class: "eg" }, "Example: ", el("code", { text: p.eg }))),
      b);
  }));
}

/* ---------------- embed ---------------- */
const embedUrl = () => `${location.origin}${location.pathname}?embed=1`;
function renderEmbed() {
  $("#embed-code").textContent = `<iframe\n  src="${embedUrl()}"\n  title="Mutual fund facts assistant"\n  width="400" height="620"\n  style="border:0;border-radius:16px"\n  loading="lazy"></iframe>`;
}
function loadEmbedPreview() { const f = $("#embed-preview"); if (!f.src) f.src = embedUrl(); }
$("#copy-embed").addEventListener("click", async (e) => {
  try { await navigator.clipboard.writeText($("#embed-code").textContent); e.target.textContent = "Copied"; }
  catch { e.target.textContent = "Select and copy the snippet above"; }
  setTimeout(() => (e.target.textContent = "Copy snippet"), 1800);
});

/* ---------------- boot ---------------- */
renderPolicies();
renderEmbed();
route();
Promise.all(["corpus", "schemes", "sources"].map((f) => fetch(`data/${f}.json?v=3`).then((r) => r.json())))
  .then(([corpus, schemes, sources]) => {
    state.answer = createEngine(corpus, schemes);
    state.schemes = schemes.schemes;
    state.sources = sources.sources;
    state.meta = { ...corpus.meta, chunk_count: corpus.chunks.length };
    const upd = fmtDate(corpus.meta.last_updated);
    $("#index-status").textContent = `Index updated ${upd}`;
    $("#ws-sub").textContent = `${Object.keys(state.schemes).length} schemes · ${state.sources.length} sources`;
    $("#nav-src-count").textContent = state.sources.length;
    renderSchemes();
    renderSources();
  })
  .catch(() => { $("#index-status").textContent = "Index failed to load. Please refresh."; });

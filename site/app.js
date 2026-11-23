import { createEngine } from "./engine.js";

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (tag, attrs = {}, ...kids) => {
  const n = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === "class") n.className = v; else if (k === "text") n.textContent = v; else if (v != null) n.setAttribute(k, v);
  }
  n.append(...kids.filter((k) => k != null));
  return n;
};
const svg = (markup, cls) => { const t = document.createElement("template"); t.innerHTML = markup.trim(); const s = t.content.firstChild; if (cls) s.setAttribute("class", cls); return s; };
const LINK_ICON = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6.5 3.5h-3v9h9v-3M9 3h4v4M13 3 7.5 8.5"/></svg>';
const CHEV = '<svg viewBox="0 0 10 16" aria-hidden="true"><path d="m2 2 6 6-6 6"/></svg>';
const fmtDate = (iso) => new Date(iso + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
const rupees = (n) => "₹" + Number(n).toLocaleString("en-IN");
const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;

const state = { answer: null, schemes: null, sources: null, updated: "" };

/* ---------------- Routing ---------------- */
const ROUTES = ["ask", "schemes", "sources", "about"];
function route() {
  const name = (location.hash.match(/^#\/(\w+)/) || [])[1];
  const view = ROUTES.includes(name) ? name : "ask";
  $$(".view").forEach((v) => (v.hidden = v.dataset.view !== view));
  $$("[data-route]").forEach((a) => (a.dataset.route === view ? a.setAttribute("aria-current", "page") : a.removeAttribute("aria-current")));
  $("#composer").hidden = view !== "ask";
  document.title = view === "ask" ? "MF Facts" : `${view[0].toUpperCase() + view.slice(1)} · MF Facts`;
  if (!reduceMotion) window.scrollTo({ top: 0 });
}
addEventListener("hashchange", route);

/* ---------------- Ask ---------------- */
const thread = $("#thread");
const input = $("#q");

function addUser(text, redacted) {
  thread.append(el("div", { class: "bubble-user" + (redacted ? " redacted" : "") , text: redacted ? "Message hidden: it contained personal details" : text }));
}
let busy = false;
function addAnswer(r) {
  const label = r.kind === "answer" ? "Answer" : r.kind === "pii" ? "Privacy" : "Facts only";
  const chip = el("a", { class: "src-chip", href: r.source.url, target: "_blank", rel: "noopener noreferrer", title: r.source.title }, svg(LINK_ICON), el("span", { text: r.source.title }));
  const text = el("p", { class: "streaming" });
  const foot = el("div", { class: "card-foot" }, chip, r.updated ? el("span", { class: "updated", text: r.updated }) : null);
  foot.hidden = true;
  const card = el("article", { class: `card-answer ${r.kind}`, "aria-busy": "true" },
    el("div", { class: "card-head" }, el("span", { class: "dot", "aria-hidden": "true" }), label), text, foot);
  thread.append(card);

  // Stream the answer word by word (like a chat model), then reveal the citation.
  const words = r.text.split(/(\s+)/);
  let i = 0;
  const done = () => { text.textContent = r.text; text.classList.remove("streaming"); foot.hidden = false; foot.classList.add("reveal"); card.removeAttribute("aria-busy"); busy = false; card.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "nearest" }); };
  if (reduceMotion) return done();
  (function tick() {
    if (i >= words.length) return done();
    text.textContent += words.slice(i, i + 2).join("");
    i += 2;
    if (i % 12 === 0) card.scrollIntoView({ block: "nearest" });
    setTimeout(tick, 18 + Math.random() * 28);
  })();
}

function ask(q) {
  q = (q || "").trim();
  if (!q || busy) return;
  busy = true;
  if (location.hash !== "#/ask") location.hash = "#/ask";
  if (!state.answer) {
    busy = false;
    addAnswer({ kind: "refuse", text: "Still loading the official sources. Please try again in a second.", source: { title: "Groww MF – KIM downloads", url: "https://www.growwmf.in/downloads/kim" } });
    return;
  }
  const r = state.answer(q);
  addUser(q, r.redact);
  input.value = "";
  const typing = el("div", { class: "typing", "aria-label": "Finding the answer" }, el("i"), el("i"), el("i"));
  thread.append(typing);
  typing.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "end" });
  setTimeout(() => { typing.remove(); addAnswer(r); }, reduceMotion ? 0 : 420);
}

$("#composer").addEventListener("submit", (e) => { e.preventDefault(); ask(input.value); });
// Suggestions only fill the composer, so the user can edit before sending.
function prefill(q) {
  input.value = q;
  input.focus();
  input.setSelectionRange(q.length, q.length);
  input.dispatchEvent(new Event("input"));
}
$$(".suggest-card").forEach((b) => b.addEventListener("click", () => prefill(b.dataset.q)));

/* ---------------- Schemes ---------------- */
const RISK = ["Low", "Low to Moderate", "Moderate", "Moderately High", "High", "Very High"];
const ORDER = ["large-cap", "elss", "multicap", "small-cap", "total-market"];
const CAT = { "large-cap": "Large Cap", elss: "ELSS · Tax saver", multicap: "Multi Cap", "small-cap": "Small Cap", "total-market": "Index fund" };

function renderSchemes() {
  const grid = $("#scheme-grid");
  grid.replaceChildren();
  for (const key of ORDER) {
    const s = state.schemes[key];
    if (!s) continue;
    const short = s.name.replace(/ Direct Growth$/, "");
    const level = RISK.findIndex((r) => r.toLowerCase() === String(s.riskometer).toLowerCase());
    const meter = el("div", { class: "meter", role: "img", "aria-label": `Riskometer: ${s.riskometer}` }, ...RISK.map((_, i) => el("i", { class: i <= level ? "on" : null })));
    const row = (k, v) => el("li", {}, el("span", { class: "k", text: k }), el("span", { class: "v" }, ...(Array.isArray(v) ? v : [v])));
    const er = s.expense_ratio_pct;
    const overrides = Object.entries(s.field_sources || {}).map(([f, o]) => `${f === "benchmark" ? "Benchmark" : "Expense ratio"} from the KIM: ${o.note}`);
    grid.append(el("article", { class: "scheme" },
      el("span", { class: "scheme-cat", text: CAT[key] }),
      el("h2", { text: short }),
      er != null
        ? el("div", { class: "big" }, el("b", { text: `${er}%` }), el("span", { text: "expense ratio (TER, incl. GST)" }))
        : el("div", { class: "big na" }, el("b", { text: "Not listed" }), el("span", { text: "expense ratio, see KIM" })),
      el("ul", { class: "facts" },
        row("Exit load", s.exit_load || "—"),
        row("Minimum SIP", s.min_sip ? rupees(s.min_sip) : "Not listed (see KIM)"),
        row("Lumpsum", s.min_lumpsum ? rupees(s.min_lumpsum) : "—"),
        row("Lock-in", s.lock_in ? `${s.lock_in} (Section 80C)` : "None"),
        row("Riskometer", [el("span", { text: s.riskometer }), meter]),
        row("Benchmark", s.benchmark || "—"),
      ),
      overrides.length ? el("p", { class: "note-src", text: overrides.join(" ") }) : null,
      el("div", { class: "scheme-actions" },
        el("a", { class: "btn", href: s.url, target: "_blank", rel: "noopener noreferrer", text: "Official page" }),
        el("a", { class: "btn ghost", href: s.kim_url, target: "_blank", rel: "noopener noreferrer", text: "KIM (PDF)" }),
        (() => { const b = el("button", { class: "btn ghost", type: "button", text: "Ask about it" }); b.addEventListener("click", () => { location.hash = "#/ask"; setTimeout(() => prefill(`Exit load of ${short}?`), 50); }); return b; })(),
      ),
    ));
  }
}

/* ---------------- Sources ---------------- */
function renderSources(filter = "all") {
  const list = $("#source-list");
  list.replaceChildren();
  for (const s of state.sources) {
    if (filter !== "all" && !s.publisher.startsWith(filter)) continue;
    const kind = s.publisher.startsWith("SEBI") ? ["s", "SEBI"] : s.publisher.startsWith("AMFI") ? ["a", "AMFI"] : ["g", "AMC"];
    list.append(el("a", { class: "row", href: s.url, target: "_blank", rel: "noopener noreferrer" },
      el("span", { class: `row-icon ${kind[0]}`, "aria-hidden": "true", text: kind[1] }),
      el("span", { class: "row-main" }, el("span", { class: "row-title", text: s.title }), el("span", { class: "row-sub", text: `${s.type} · ${s.topics}` })),
      svg(CHEV, "row-chev"),
    ));
  }
}
$$(".filter button").forEach((b) => b.addEventListener("click", () => {
  $$(".filter button").forEach((x) => x.setAttribute("aria-selected", String(x === b)));
  renderSources(b.dataset.pub);
}));

/* ---------------- Boot ---------------- */
route();
Promise.all(["corpus", "schemes", "sources"].map((f) => fetch(`data/${f}.json`).then((r) => r.json())))
  .then(([corpus, schemes, sources]) => {
    state.answer = createEngine(corpus, schemes);
    state.schemes = schemes.schemes;
    state.sources = sources.sources;
    state.updated = fmtDate(corpus.meta.last_updated);
    $("#sources-eyebrow").textContent = `${sources.sources.length} public pages · updated ${state.updated}`;
    renderSchemes();
    renderSources();
  })
  .catch(() => addAnswer({ kind: "refuse", text: "Couldn't load the source index. Please refresh the page.", source: { title: "Groww MF – KIM downloads", url: "https://www.growwmf.in/downloads/kim" } }));

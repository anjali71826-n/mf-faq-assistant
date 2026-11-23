import { createEngine } from "./engine.js";

const log = document.getElementById("log");
const form = document.getElementById("ask");
const input = document.getElementById("q");
let answer = null;

const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };

function addUser(text, redacted) {
  // PII is never echoed back: the bubble shows a placeholder instead of the text.
  log.append(el("div", "msg user" + (redacted ? " redacted" : ""), redacted ? "[message hidden – it contained personal details]" : text));
}

function addBot(r) {
  const box = el("div", `msg bot ${r.kind}`);
  box.append(el("div", "label", r.kind === "answer" ? "Answer" : r.kind === "pii" ? "Privacy" : "Facts only"));
  box.append(el("p", null, r.text));
  const src = el("div", "src", "Source: ");
  const a = el("a", null, r.source.title);
  a.href = r.source.url; a.target = "_blank"; a.rel = "noopener noreferrer";
  src.append(a);
  box.append(src, el("div", "upd", r.updated));
  log.append(box);
  box.scrollIntoView({ behavior: "smooth", block: "nearest" });
}

function ask(q) {
  if (!q.trim()) return;
  if (!answer) { addBot({ kind: "refuse", text: "Still loading the official sources – try again in a second.", source: { title: "Groww MF downloads", url: "https://www.growwmf.in/downloads/kim" }, updated: "" }); return; }
  const r = answer(q);
  addUser(q, r.redact);
  addBot(r);
  input.value = "";
}

form.addEventListener("submit", (e) => { e.preventDefault(); ask(input.value); });
document.querySelectorAll(".chip").forEach((b) => b.addEventListener("click", () => ask(b.dataset.q)));

Promise.all([fetch("data/corpus.json").then((r) => r.json()), fetch("data/schemes.json").then((r) => r.json())])
  .then(([corpus, schemes]) => {
    answer = createEngine(corpus, schemes);
    document.getElementById("srcCount").textContent = corpus.meta.source_count;
    document.getElementById("updated").textContent = `Last updated from sources: ${new Date(corpus.meta.last_updated + "T00:00:00").toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" })}.`;
  })
  .catch(() => addBot({ kind: "refuse", text: "Couldn't load the source index. Please refresh the page.", source: { title: "Groww MF downloads", url: "https://www.growwmf.in/downloads/kim" }, updated: "" }));

# Prompt and response design (W1 + W2)

The assistant makes no LLM call at runtime. The steps an LLM-based RAG would take are built as explicit, testable code instead: classify, refuse, retrieve, then write a short reply with one citation. This guarantees the two hard requirements (one citation every time, no advice) and makes hallucinated numbers impossible.

## 1. Thinking like a model: what exactly is being asked? (W1)

Each query goes through these checks in order. The first match wins.

| Step | Check | Example | Outcome |
|---|---|---|---|
| 1 | Personal data (PAN, Aadhaar, phone, email, OTP, folio/account no., long IDs) | "My PAN is …" | Privacy refusal; the message is hidden in the UI and never stored |
| 2 | Advice intent (`should I`, `best`, `better`, `recommend`, `which fund`, `right for me`…) | "Should I buy small cap now?" | Polite facts-only refusal + AMFI investor-education link |
| 3 | Performance intent (`returns`, `CAGR`, `performance`, `beat the index`…) | "3-year returns of Large Cap?" | Refuse to quote or compute; link to the official scheme page or factsheet |
| 4 | Out-of-scope AMC | "Expense ratio of HDFC Top 100?" | Scope message |
| 5 | Scheme + fact | "Exit load of Groww Multicap?" | Structured fact from the AMC scheme page (or its KIM if the page is blank) |
| 6 | General how-to | "How do I download my capital-gains statement?" | Curated answer written from one official page |
| 7 | Anything else | "What is a riskometer?" | BM25 retrieval over the corpus → best 1–2 sentences |
| 8 | No confident match | "What's the weather?" | "Couldn't find that in my official sources" |

Fact intents detected: expense ratio/TER, exit load, minimum SIP, minimum lumpsum, lock-in, 80C tax benefit, riskometer, benchmark, fund manager, objective, category, NAV (link only), statements/CAS.

## 2. Instruction style used for every answer (W2)

These rules are enforced in `site/engine.js`. They are also the system prompt you'd give an LLM to do the same job:

```
You are a facts-only assistant for five Groww Mutual Fund schemes.
- Answer ONLY from the provided context passages. If the answer is not in them, say you couldn't find it.
- Answer in at most 3 sentences. Lead with the exact fact (number, %, period, name).
- Include exactly ONE source link: the passage the fact came from.
- End with "Last updated from sources: <date>".
- Never give advice, opinions, rankings or suitability judgements; never quote, compute or compare returns.
  For such questions reply politely that you share facts only, and link an investor-education or factsheet page.
- Never ask for, repeat or store personal data (PAN, Aadhaar, account/folio numbers, OTPs, email, phone).
- If the scheme page and the KIM disagree, prefer the KIM and cite it.
```

## 3. Wording templates

**Fact:** `The expense ratio (TER) of {scheme} – Direct Plan is {x}% per year, inclusive of GST.`
**Two facts, same page:** the two sentences are joined; facts from different pages are split ("Ask about the other fact separately so I can cite its own source").
**Advice refusal:** "I can only share facts from official documents, not investment advice or recommendations on what to buy, sell or hold. For help deciding, consider a SEBI-registered investment adviser; AMFI's investor-education site explains how to evaluate schemes."
**Performance refusal:** "I don't quote, compute or compare returns or performance. Please see the official scheme page or the AMC factsheet for performance data."
**PII refusal:** "It looks like your message contains a {PAN}. For your safety I don't accept or store personal details … so I've discarded it."
**Citation line:** `Source: <page title>` (one link), followed by `Last updated from sources: <date>`.

## 4. Retrieval (W3)

* Corpus: 24 official pages turned into about 1,650 sentence-aware chunks of about 700 characters. Each chunk repeats the last sentence of the one before it.
* Index: BM25 (k1 = 1.2, b = 0.75) built in the browser at load time, with simple stop-wording and plural stemming.
* General questions are first restricted to a short list of official sources for that intent. For example, statements search AMFI's Download CAS page, SEBI's CAS page, the SEBI FAQ and the Investor Charter. If nothing scores above the threshold, the search widens to the whole corpus.
* Sentence picker: keep sentences with at least 40 characters, real words and an end mark. Rank them by overlap with the query terms and return the top 2 in their original order. URLs are stripped from the text, since the citation carries the link.

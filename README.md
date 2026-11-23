# MF Facts Assistant: Groww Mutual Fund FAQ (facts-only RAG)

A small FAQ assistant that answers **factual** questions about Groww Mutual Fund schemes, such as expense ratio, exit load, minimum SIP, ELSS lock-in, riskometer, benchmark and how to download statements. It uses **only official public pages** from the AMC, SEBI and AMFI. Every answer carries **exactly one source link** and a "Last updated from sources" date. It gives **no advice**.

- **Product chosen (for all milestones):** Groww
- **Live prototype:** https://anjali71826-n.github.io/mf-faq-assistant/
- **Repository:** https://github.com/anjali71826-n/mf-faq-assistant

## Scope

| | |
|---|---|
| **AMC** | Groww Mutual Fund (Groww Asset Management Ltd., SEBI Reg. MF/068/11/03) |
| **Schemes (Direct Plan – Growth)** | Groww Large Cap Fund (large-cap) · Groww ELSS Tax Saver Fund (ELSS) · Groww Multicap Fund (multi-cap) · Groww Small Cap Fund (small-cap) · Groww Nifty Total Market Index Fund (index) |
| **Corpus** | 24 public pages: 15 Groww MF (scheme pages, KIMs, downloads hubs, Investor Charter, investor-education PDF), 4 SEBI, 5 AMFI |
| **Questions handled** | expense ratio / TER, exit load, minimum SIP & lumpsum, lock-in, 80C status, riskometer, benchmark, fund managers, objective, category, CAS / capital-gains statement, general definitions |
| **Refused politely** | buy/sell/hold or "which is better" advice, returns or performance questions, other fund houses, any personal data |

## The web app

The app's design is inspired by Apple: system fonts, large titles, a translucent navigation bar with segmented tabs (an iOS-style tab bar on phones), and light and dark modes. It is static HTML/CSS/JS with no build step and no backend.

| View | What it shows |
|---|---|
| **Ask** | Welcome line, the "Facts-only. No investment advice." note and three suggestion cards. Tapping a suggestion **fills the input** so you can edit it before pressing Enter. Answers **stream in word by word** and then show their single source link and the "Last updated" date. |
| **Schemes** | One card per scheme: expense ratio, exit load, minimum SIP and lumpsum, lock-in, a riskometer gauge, the benchmark, and links to the official page and KIM. Returns are left out on purpose. |
| **Sources** | All 24 official pages in an inset list, filterable by Groww MF, SEBI or AMFI. |
| **About** | How it works, privacy, known limits and the disclaimer. |

## How it works

```
question ─▶ guardrails ─────────────▶ intent + scheme ─▶ answer builder ─────────────────▶ reply (≤3 sentences)
            1 PII  (PAN, Aadhaar,…)    expense_ratio,     • scheme fact  → schemes.json      + ONE source link
            2 advice  (should I…)      exit_load, sip,    • how-to       → curated card      + "Last updated from
            3 performance (returns…)   lock_in, risk…     • anything else→ BM25 over chunks     sources: <date>"
            4 other AMC
```

1. **Ingestion** (`scripts/build_corpus.py`): fetches the 24 URLs, extracts text from HTML and PDF (pypdf) and strips menus and footers. It then splits the text into ~700-character sentence-aware chunks and writes `site/data/corpus.json`. From each scheme page's embedded data it also writes `site/data/schemes.json`, which holds the structured facts. **Return/NAV-history fields are deliberately dropped**, so the bot cannot make performance claims.
2. **Source conflicts:** where a scheme page is blank or disagrees with the scheme's KIM, the KIM wins and is cited. For example, the Multicap page widget shows "Nifty 50 TRI", but the KIM names *Nifty 500 Multicap 50:25:25 Index TRI*.
3. **Answering** (`site/engine.js`, runs fully in the browser): rule-based guardrails, then intent and scheme detection. A structured fact is used when one exists; otherwise a curated how-to card, otherwise BM25 retrieval with an extractive 1–2 sentence answer. See [docs/prompt_design.md](docs/prompt_design.md) for the decision table, instruction style and refusal wording.
4. **Privacy:** nothing is stored or sent anywhere; there is no backend and no analytics. A message containing PII is not echoed back; the UI shows a placeholder instead.

## Setup

Requirements: Python 3.9+ (with `pypdf`) to rebuild the corpus, and Node 18+ only for the sample-Q&A script. The app itself is static HTML/JS.

```bash
git clone https://github.com/anjali71826-n/mf-faq-assistant.git && cd mf-faq-assistant
pip install pypdf
python3 scripts/build_corpus.py --refresh   # re-fetch all sources → site/data/*.json + sources.csv
python3 -m http.server 8000 --directory site  # open http://localhost:8000
node scripts/run_samples.mjs                  # regenerate sample_qa.md from the live engine
```

Deployment: pushing to `main` publishes `site/` to GitHub Pages via `.github/workflows/pages.yml`.

## Project structure

```
site/            index.html · style.css · app.js (views, routing, streaming) · engine.js (guardrails + retrieval) · data/ (corpus, schemes, sources JSON)
scripts/         build_corpus.py (ingestion) · run_samples.mjs (sample Q&A generator)
docs/            prompt_design.md (W1/W2 decisions, instruction style, refusal templates)
sources.csv      the 24 source URLs        sample_qa.md   generated sample answers
```

## Source list (24 URLs)

Also available as [sources.csv](sources.csv). All were fetched on 2026-11-23.

| # | Publisher | Type | Page | Used for |
|---|---|---|---|---|
| S01 | Groww MF (AMC) | Scheme page | [Groww Large Cap Fund – scheme page](https://www.growwmf.in/mutual-funds/groww-large-cap-fund-direct-growth) | expense ratio; exit load; min SIP; riskometer; benchmark |
| S02 | Groww MF (AMC) | Scheme page | [Groww ELSS Tax Saver Fund – scheme page](https://www.growwmf.in/mutual-funds/groww-elss-tax-saver-fund-direct-growth) | expense ratio; lock-in; min SIP; riskometer; benchmark |
| S03 | Groww MF (AMC) | Scheme page | [Groww Multicap Fund – scheme page](https://www.growwmf.in/mutual-funds/groww-multicap-fund-direct-growth) | expense ratio; exit load; min SIP; riskometer; benchmark |
| S04 | Groww MF (AMC) | Scheme page | [Groww Small Cap Fund – scheme page](https://www.growwmf.in/mutual-funds/groww-small-cap-fund-direct-growth) | expense ratio; exit load; min SIP; riskometer; benchmark |
| S05 | Groww MF (AMC) | Scheme page | [Groww Nifty Total Market Index Fund – scheme page](https://www.growwmf.in/mutual-funds/groww-nifty-total-market-index-fund-direct-growth) | expense ratio; exit load; min SIP; riskometer; benchmark |
| S06 | Groww MF (AMC) | KIM (PDF) | [KIM – Groww Large Cap Fund](https://assets-netstorage.growwmf.in/compliance_docs/Downloads/KIM/Equity%20Funds/KIM_Groww%20Largecap%20Fund.pdf) | loads; min amounts; benchmark; riskometer |
| S07 | Groww MF (AMC) | KIM (PDF) | [KIM – Groww ELSS Tax Saver Fund](https://assets-netstorage.growwmf.in/compliance_docs/Downloads/KIM/Equity%20Funds/KIM_Groww%20ELSS%20Tax%20Saver%20Fund.pdf) | lock-in; loads; min amounts; benchmark |
| S08 | Groww MF (AMC) | KIM (PDF) | [KIM – Groww Multicap Fund](https://assets-netstorage.growwmf.in/compliance_docs/Downloads/KIM/Equity%20Funds/KIM%20-%20Groww%20Multicap%20Fund.pdf) | loads; min amounts; benchmark |
| S09 | Groww MF (AMC) | KIM (PDF) | [KIM – Groww Small Cap Fund](https://assets-netstorage.growwmf.in/compliance_docs/Downloads/KIM/Equity%20Funds/KIM_Groww%20Small%20cap%20Fund.pdf) | loads; min amounts; benchmark |
| S10 | Groww MF (AMC) | KIM (PDF) | [KIM – Groww Nifty Total Market Index Fund](https://assets-netstorage.growwmf.in/compliance_docs/Downloads/KIM/Index%20Funds/KIM_Groww%20Nifty%20Total%20Market%20Index%20Fund.pdf) | loads; min amounts; tracking; benchmark |
| S11 | Groww MF (AMC) | Downloads page | [Riskometer disclosures (downloads)](https://www.growwmf.in/downloads/riskometer) | riskometer history |
| S12 | Groww MF (AMC) | Downloads page | [Fact sheet (downloads)](https://www.growwmf.in/downloads/fact-sheet) | factsheet; performance (link only) |
| S13 | Groww MF (AMC) | Downloads page | [Expense ratio / TER change notices (downloads)](https://www.growwmf.in/downloads/expense-ratio) | TER change notices |
| S14 | Groww MF (AMC) | Investor charter (PDF) | [Investor Charter – Groww Mutual Fund](https://assets-netstorage.growwmf.in/compliance_docs/Downloads/Investor%20charter/Investor%20Charter_GrowwMF.pdf) | statements; services; grievances |
| S15 | Groww MF (AMC) | Investor education (PDF) | [Basics of Mutual Funds – Groww MF investor education](https://cms-resources.growwmf.in/uploads/Basics_of_Mutual_Fund_49ab4e2810.pdf) | basics; NAV; loads; SIP |
| S16 | SEBI | Investor page | [SEBI investor site – Consolidated Account Statement (CAS)](https://investor.sebi.gov.in/consolidated_account_statement.html) | CAS; statements |
| S17 | SEBI | Investor page | [SEBI investor site – Exit load](https://investor.sebi.gov.in/exit_load.html) | exit load definition |
| S18 | SEBI | FAQ (PDF) | [SEBI – FAQs for Mutual Fund Investors (Sep 2024)](https://www.sebi.gov.in/sebi_data/faqfiles/sep-2024/1727242783639.pdf) | expense ratio; riskometer; ELSS; CAS |
| S19 | SEBI | Circular | [SEBI – Categorization and Rationalization of MF Schemes (Oct 2017)](https://www.sebi.gov.in/legal/circulars/oct-2017/categorization-and-rationalization-of-mutual-fund-schemes_36199.html) | scheme categories; large/small cap definitions |
| S20 | AMFI | Investor page | [AMFI – Download CAS](https://www.amfiindia.com/online-center/download-cas) | CAS download; capital gains statement |
| S21 | AMFI | Investor page | [AMFI – TER of MF schemes](https://www.amfiindia.com/ter-of-mf-schemes) | expense ratio / TER disclosure |
| S22 | AMFI (Mutual Funds Sahi Hai) | Investor education | [AMFI – ELSS: tax-saving mutual funds](https://www.mutualfundssahihai.com/en/elss-fund-tax-saving-mutual-fund) | ELSS lock-in; 80C |
| S23 | AMFI (Mutual Funds Sahi Hai) | Investor education | [AMFI – What are loads?](https://www.mutualfundssahihai.com/en/what-are-loads) | entry/exit load |
| S24 | AMFI (Mutual Funds Sahi Hai) | Investor education | [AMFI – What is SIP?](https://www.mutualfundssahihai.com/en/what-is-sip) | SIP basics |

## Sample Q&A

Generated from the live engine by `node scripts/run_samples.mjs` (full file: [sample_qa.md](sample_qa.md)).

#### 1. What is the expense ratio of Groww Large Cap Fund?
*Type: factual answer*

> The expense ratio (TER) of Groww Large Cap Fund – Direct Plan is 1.27% per year, inclusive of GST.
>
> Source: [Groww Large Cap Fund – official scheme page](https://www.growwmf.in/mutual-funds/groww-large-cap-fund-direct-growth)
> Last updated from sources: 23 Nov 2026

#### 2. ELSS lock-in?
*Type: factual answer*

> Groww ELSS Tax Saver Fund has a lock-in of 3 years from the date of allotment of units, as it is an ELSS (Section 80C) scheme.
>
> Source: [Groww ELSS Tax Saver Fund – official scheme page](https://www.growwmf.in/mutual-funds/groww-elss-tax-saver-fund-direct-growth)
> Last updated from sources: 23 Nov 2026

#### 3. Minimum SIP for Groww Small Cap Fund?
*Type: factual answer*

> The minimum SIP amount for Groww Small Cap Fund is ₹500; the minimum lumpsum is ₹500.
>
> Source: [Groww Small Cap Fund – official scheme page](https://www.growwmf.in/mutual-funds/groww-small-cap-fund-direct-growth)
> Last updated from sources: 23 Nov 2026

#### 4. Exit load of Groww Multicap Fund?
*Type: factual answer*

> Exit load for Groww Multicap Fund: 1% if units are redeemed / switched out within 1 year from the date of allotment, Nil, if redeemed / switched out after 1 year from the date of allotment.
>
> Source: [Groww Multicap Fund – official scheme page](https://www.growwmf.in/mutual-funds/groww-multicap-fund-direct-growth)
> Last updated from sources: 23 Nov 2026

#### 5. What is the riskometer and benchmark of the Nifty Total Market Index Fund?
*Type: factual answer*

> The riskometer of Groww Nifty Total Market Index Fund is at "Very High" risk. Its benchmark (Nifty Total Market TRI) riskometer is at "Very High". The benchmark of Groww Nifty Total Market Index Fund is the Nifty Total Market TRI.
>
> Source: [Groww Nifty Total Market Index Fund – official scheme page](https://www.growwmf.in/mutual-funds/groww-nifty-total-market-index-fund-direct-growth)
> Last updated from sources: 23 Nov 2026

#### 6. Benchmark of Groww Multicap Fund?
*Type: factual answer*

> The benchmark of Groww Multicap Fund is the Nifty 500 Multicap 50:25:25 Index TRI.
>
> Source: [KIM – Groww Multicap Fund](https://assets-netstorage.growwmf.in/compliance_docs/Downloads/KIM/Equity%20Funds/KIM%20-%20Groww%20Multicap%20Fund.pdf)
> Last updated from sources: 23 Nov 2026

#### 7. How do I download my capital-gains statement?
*Type: factual answer*

> Sign up on MFCentral (the investor portal run jointly by CAMS and KFintech) and generate a 'Detailed' CAS, choosing the Current Financial Year, Previous Financial Year or a specific period of up to 365 days. You can also request an e-CAS by email from CAMS or KFintech; it is sent to the email address registered with your mutual fund. My official sources don't describe a separate capital-gains report, so check the Detailed CAS for the transactions you need.
>
> Source: [AMFI – Download CAS](https://www.amfiindia.com/online-center/download-cas)
> Last updated from sources: 23 Nov 2026

#### 8. How do I get a consolidated account statement (CAS)?
*Type: factual answer*

> A Consolidated Account Statement (CAS) shows your mutual fund holdings across all fund houses in one document. CAMS and KFintech email an e-CAS to investors who have registered their email with their mutual funds, and MFCentral lets registered users view and download a Summary or Detailed CAS. Your PAN must be updated on your folios and demat account to receive a CAS.
>
> Source: [AMFI – Download CAS](https://www.amfiindia.com/online-center/download-cas)
> Last updated from sources: 23 Nov 2026

#### 9. What is an exit load?
*Type: factual answer*

> An exit load is a fee a mutual fund charges when you redeem or switch out units before a pre-defined period. It is expressed as a percentage of the redemption value and is meant to discourage short-term trading. Ask about a specific Groww scheme to get its exact exit load.
>
> Source: [SEBI investor site – Exit load](https://investor.sebi.gov.in/exit_load.html)
> Last updated from sources: 23 Nov 2026

#### 10. Should I buy Groww Small Cap Fund now?
*Type: polite refusal*

> I can only share facts from official documents, not investment advice or recommendations on what to buy, sell or hold. For help deciding, consider a SEBI-registered investment adviser; AMFI's investor-education site explains how to evaluate schemes.
>
> Source: [AMFI – Mutual Funds Sahi Hai (investor education)](https://www.mutualfundssahihai.com/en)
> Last updated from sources: 23 Nov 2026

#### 11. What returns did Groww Large Cap Fund give in 3 years?
*Type: polite refusal*

> I don't quote, compute or compare returns or performance. Please see the official scheme page or the AMC factsheet for performance data.
>
> Source: [Groww Large Cap Fund – official scheme page](https://www.growwmf.in/mutual-funds/groww-large-cap-fund-direct-growth)
> Last updated from sources: 23 Nov 2026

#### 12. My PAN is [redacted], show my holdings
*Type: PII refusal*

> It looks like your message contains a PAN. For your safety I don't accept or store personal details such as PAN, Aadhaar, account numbers, OTPs, email or phone numbers, so I've discarded it. Please ask your question without them.
>
> Source: [SEBI investor site](https://investor.sebi.gov.in/)
> Last updated from sources: 23 Nov 2026

#### 13. Expense ratio of HDFC Top 100?
*Type: polite refusal*

> I only cover five Groww Mutual Fund schemes: Large Cap, ELSS Tax Saver, Multicap, Small Cap and Nifty Total Market Index Fund. For other fund houses, please check that AMC's own scheme documents.
>
> Source: [Groww MF – KIM downloads](https://www.growwmf.in/downloads/kim)
> Last updated from sources: 23 Nov 2026

## Disclaimer (as shown in the UI)

> **Facts-only. No investment advice.** I won't recommend schemes, compare returns, or accept personal details (PAN, Aadhaar, account numbers, OTPs, email, phone).
>
> **Disclaimer:** This assistant provides factual information from official public documents only. It is not investment, tax or legal advice and does not recommend any scheme. Mutual fund investments are subject to market risks; read all scheme-related documents carefully. This is an independent learning project and is not affiliated with Groww, SEBI or AMFI.

## Known limits

- **Snapshot, not live:** facts are as of the "last updated" date. Expense ratios and riskometers change, so re-run `build_corpus.py --refresh` to update them.
- **Gaps on the official pages:** the Groww Multicap Fund page doesn't list an expense ratio or minimum SIP. The assistant says so and links the KIM or the expense-ratio page instead of guessing.
- **Capital-gains statement:** none of the AMC/SEBI/AMFI sources describes a dedicated capital-gains report. The answer points to AMFI's guidance on the Detailed CAS (MFCentral, CAMS, KFintech) and says so.
- **Rule-based understanding:** intents and refusals use keyword patterns, so unusual phrasing can miss an intent or trigger a refusal. Retrieval is lexical (BM25), not semantic.
- **One scheme per question:** to keep one citation per answer, a question that names several schemes gets an answer for the first one only.
- **No LLM at runtime:** answers are extracted or templated, which keeps every number traceable. Retrieved general answers can read less fluently than generated text. `docs/prompt_design.md` gives the system prompt for adding an LLM generation step.
- **KIM text extraction** uses the first 40 pages of each PDF; some tables lose their layout.

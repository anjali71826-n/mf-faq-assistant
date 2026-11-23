"""Build the retrieval corpus for the Groww Mutual Fund FAQ assistant.

Fetches every URL in SOURCES (official Groww MF / SEBI / AMFI pages only),
extracts plain text (HTML or PDF), splits it into small chunks and writes:

  site/data/corpus.json   – chunks used by the in-browser retriever
  site/data/schemes.json  – structured scheme facts (from the AMC's own scheme pages)
  sources.csv             – the source list submitted with the project

Usage:  python3 scripts/build_corpus.py
Needs:  Python 3.9+, `pip install pypdf` (PDF text extraction)
"""
from __future__ import annotations

import csv
import datetime as dt
import html
import io
import json
import re
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RAW = ROOT / ".cache"
OUT = ROOT / "site" / "data"
UA = "Mozilla/5.0 (compatible; mf-faq-assistant corpus builder)"

G = "https://www.growwmf.in"
DOC = "https://assets-netstorage.growwmf.in/compliance_docs/Downloads"

# The five schemes in scope (all Groww Mutual Fund, Direct Plan - Growth).
SCHEMES = {
    "large-cap": "groww-large-cap-fund-direct-growth",
    "elss": "groww-elss-tax-saver-fund-direct-growth",
    "multicap": "groww-multicap-fund-direct-growth",
    "small-cap": "groww-small-cap-fund-direct-growth",
    "total-market": "groww-nifty-total-market-index-fund-direct-growth",
}

# id, publisher, doc type, title, url, topics (used only for the source list)
SOURCES = [
    # --- AMC: scheme pages (expense ratio, exit load, min SIP, lock-in, riskometer, benchmark)
    ("S01", "Groww MF (AMC)", "Scheme page", "Groww Large Cap Fund – scheme page", f"{G}/mutual-funds/{SCHEMES['large-cap']}", "expense ratio; exit load; min SIP; riskometer; benchmark"),
    ("S02", "Groww MF (AMC)", "Scheme page", "Groww ELSS Tax Saver Fund – scheme page", f"{G}/mutual-funds/{SCHEMES['elss']}", "expense ratio; lock-in; min SIP; riskometer; benchmark"),
    ("S03", "Groww MF (AMC)", "Scheme page", "Groww Multicap Fund – scheme page", f"{G}/mutual-funds/{SCHEMES['multicap']}", "expense ratio; exit load; min SIP; riskometer; benchmark"),
    ("S04", "Groww MF (AMC)", "Scheme page", "Groww Small Cap Fund – scheme page", f"{G}/mutual-funds/{SCHEMES['small-cap']}", "expense ratio; exit load; min SIP; riskometer; benchmark"),
    ("S05", "Groww MF (AMC)", "Scheme page", "Groww Nifty Total Market Index Fund – scheme page", f"{G}/mutual-funds/{SCHEMES['total-market']}", "expense ratio; exit load; min SIP; riskometer; benchmark"),
    # --- AMC: Key Information Memoranda
    ("S06", "Groww MF (AMC)", "KIM (PDF)", "KIM – Groww Large Cap Fund", f"{DOC}/KIM/Equity%20Funds/KIM_Groww%20Largecap%20Fund.pdf", "loads; min amounts; benchmark; riskometer"),
    ("S07", "Groww MF (AMC)", "KIM (PDF)", "KIM – Groww ELSS Tax Saver Fund", f"{DOC}/KIM/Equity%20Funds/KIM_Groww%20ELSS%20Tax%20Saver%20Fund.pdf", "lock-in; loads; min amounts; benchmark"),
    ("S08", "Groww MF (AMC)", "KIM (PDF)", "KIM – Groww Multicap Fund", f"{DOC}/KIM/Equity%20Funds/KIM%20-%20Groww%20Multicap%20Fund.pdf", "loads; min amounts; benchmark"),
    ("S09", "Groww MF (AMC)", "KIM (PDF)", "KIM – Groww Small Cap Fund", f"{DOC}/KIM/Equity%20Funds/KIM_Groww%20Small%20cap%20Fund.pdf", "loads; min amounts; benchmark"),
    ("S10", "Groww MF (AMC)", "KIM (PDF)", "KIM – Groww Nifty Total Market Index Fund", f"{DOC}/KIM/Index%20Funds/KIM_Groww%20Nifty%20Total%20Market%20Index%20Fund.pdf", "loads; min amounts; tracking; benchmark"),
    # --- AMC: documents hubs and guides
    ("S11", "Groww MF (AMC)", "Downloads page", "Riskometer disclosures (downloads)", f"{G}/downloads/riskometer", "riskometer history"),
    ("S12", "Groww MF (AMC)", "Downloads page", "Fact sheet (downloads)", f"{G}/downloads/fact-sheet", "factsheet; performance (link only)"),
    ("S13", "Groww MF (AMC)", "Downloads page", "Expense ratio / TER change notices (downloads)", f"{G}/downloads/expense-ratio", "TER change notices"),
    ("S14", "Groww MF (AMC)", "Investor charter (PDF)", "Investor Charter – Groww Mutual Fund", f"{DOC}/Investor%20charter/Investor%20Charter_GrowwMF.pdf", "statements; services; grievances"),
    ("S15", "Groww MF (AMC)", "Investor education (PDF)", "Basics of Mutual Funds – Groww MF investor education", "https://cms-resources.growwmf.in/uploads/Basics_of_Mutual_Fund_49ab4e2810.pdf", "basics; NAV; loads; SIP"),
    # --- SEBI
    ("S16", "SEBI", "Investor page", "SEBI investor site – Consolidated Account Statement (CAS)", "https://investor.sebi.gov.in/consolidated_account_statement.html", "CAS; statements"),
    ("S17", "SEBI", "Investor page", "SEBI investor site – Exit load", "https://investor.sebi.gov.in/exit_load.html", "exit load definition"),
    ("S18", "SEBI", "FAQ (PDF)", "SEBI – FAQs for Mutual Fund Investors (Sep 2024)", "https://www.sebi.gov.in/sebi_data/faqfiles/sep-2024/1727242783639.pdf", "expense ratio; riskometer; ELSS; CAS"),
    ("S19", "SEBI", "Circular", "SEBI – Categorization and Rationalization of MF Schemes (Oct 2017)", "https://www.sebi.gov.in/legal/circulars/oct-2017/categorization-and-rationalization-of-mutual-fund-schemes_36199.html", "scheme categories; large/small cap definitions"),
    # --- AMFI
    ("S20", "AMFI", "Investor page", "AMFI – Download CAS", "https://www.amfiindia.com/online-center/download-cas", "CAS download; capital gains statement"),
    ("S21", "AMFI", "Investor page", "AMFI – TER of MF schemes", "https://www.amfiindia.com/ter-of-mf-schemes", "expense ratio / TER disclosure"),
    ("S22", "AMFI (Mutual Funds Sahi Hai)", "Investor education", "AMFI – ELSS: tax-saving mutual funds", "https://www.mutualfundssahihai.com/en/elss-fund-tax-saving-mutual-fund", "ELSS lock-in; 80C"),
    ("S23", "AMFI (Mutual Funds Sahi Hai)", "Investor education", "AMFI – What are loads?", "https://www.mutualfundssahihai.com/en/what-are-loads", "entry/exit load"),
    ("S24", "AMFI (Mutual Funds Sahi Hai)", "Investor education", "AMFI – What is SIP?", "https://www.mutualfundssahihai.com/en/what-is-sip", "SIP basics"),
]

# Lines that appear on every page of a site (menus, footers) – dropped before chunking.
BOILERPLATE = re.compile(
    r"^(Skip to main content|Download Documents|SEBI Registration No\.|MF/068/11/03|CIN|"
    r"KFintech Branches|Business Centres|Contact info for (investors|partners)|Groww MF|About Us|"
    r"Historical NAV|Creation Unit|Blog|Grievance Redressal|Investor Education|Update KYC|"
    r"Check KYC Status|Social Media Platforms|KYC guidelines & FAQs|Important Links|Contact Us|"
    r"Privacy Policy|DISCLAIMER|TERMS AND CONDITIONS|here\.|\[email.*protected\]|\+91 [0-9 ]+)$",
    re.I,
)


def fetch(url: str, name: str) -> bytes:
    RAW.mkdir(exist_ok=True)
    path = RAW / name
    if path.exists() and "--refresh" not in sys.argv:
        return path.read_bytes()
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=60) as r:
        data = r.read()
    path.write_bytes(data)
    return data


def html_text(raw: str) -> str:
    raw = re.sub(r"<(script|style|noscript|svg|nav|footer|header|title)\b.*?</\1>", " ", raw, flags=re.S | re.I)
    raw = re.sub(r"<br\s*/?>|</(p|div|li|h[1-6]|tr|td|th|section)>", "\n", raw, flags=re.I)
    txt = html.unescape(re.sub(r"<[^>]+>", " ", raw))
    lines = [re.sub(r"\s+", " ", l).strip() for l in txt.splitlines()]
    lines = [l for l in lines if l and not BOILERPLATE.match(l) and "::" not in l and not re.match(r"^Home\b.{0,80}$", l)]
    # Short unpunctuated lines are headings/menu items: end them so they don't glue onto the next sentence.
    lines = [l + "." if len(l) < 70 and not re.search(r"[.!?:;,]$", l) else l for l in lines]
    return "\n".join(lines)


def pdf_text(data: bytes) -> str:
    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(data))
    pages = []
    for p in reader.pages[:40]:  # KIMs/FAQs: the facts we need are in the first pages
        try:
            pages.append(p.extract_text() or "")
        except Exception:
            pass
    txt = "\n".join(pages)
    return "\n".join(re.sub(r"[ \t]+", " ", l).strip() for l in txt.splitlines() if l.strip())


def chunk(text: str, size: int = 700) -> list[str]:
    """Sentence-aware chunks of ~size characters; the last sentence of a chunk
    is repeated at the start of the next one so no fact is split across a seam."""
    text = re.sub(r"\n(?=[a-z(])", " ", text)  # re-join lines broken mid-sentence
    sents = [s.strip() for s in re.split(r"(?<=[.!?])\s+|\n", text) if s.strip()]
    out, cur = [], []
    for s in sents:
        if cur and sum(len(x) + 1 for x in cur) + len(s) > size:
            out.append(" ".join(cur))
            cur = [cur[-1]] if len(cur[-1]) < 250 else []
        cur.append(s)
    if cur:
        out.append(" ".join(cur))
    return [c for c in out if len(c) > 60]


def scheme_facts(raw: str, url: str) -> dict:
    m = re.search(r'<script id="__NEXT_DATA__"[^>]*>(.*?)</script>', raw, re.S)
    d = json.loads(m.group(1))["props"]["pageProps"]["mfData"]
    bench = [b.get("benchmarkName") or b.get("name") for b in (d.get("benchmarkDetailsList") or [])]
    bench = [b for b in bench if b]
    # Deliberately NOT copied: returns*, NAV history, holdings – the assistant makes no performance claims.
    return {
        "name": d["fundName"],
        "url": url,
        "category": f'{d.get("category")} – {d.get("subCategory")}',
        "plan": "Direct Plan – Growth option",
        "expense_ratio_pct": round(d["expenseRatio"] * 100, 2) if d.get("expenseRatio") is not None else None,
        "exit_load": re.sub(r"^\*", "", re.sub(r"(\d%|NIL|Nil)\s+(?=If\b)", r"\1; ", re.sub(r"\s*\n\s*", " ", d.get("exitLoadDesc") or "").replace("•", ";")).replace(", ;", ";")).strip(" ;"),
        "min_sip": d.get("minSipAmount"),
        "min_lumpsum": d.get("minLumpsumAmount"),
        "min_additional": d.get("minSecondInvestmentAmount"),
        "lock_in": d.get("lockInPeriod"),
        "riskometer": d.get("risk"),
        "benchmark": bench[0] if bench else None,
        "benchmark_riskometer": d.get("benchmarkRiskRating"),
        "objective": d.get("investmentObjective"),
        "fund_managers": [f["fundManagerName"] for f in d.get("fundManagerDetailsList") or []],
        "nav_date": d.get("navDate"),
    }


# Where a scheme page is blank or disagrees with the scheme's KIM (the regulatory
# document), the KIM wins and is cited instead. Each override records why.
OVERRIDES = {
    "multicap": {
        "benchmark": ("Nifty 500 Multicap 50:25:25 Index TRI", "S08",
                      "Scheme page widget shows 'Nifty 50 TRI'; the KIM names Nifty 500 Multicap 50:25:25 Index TRI."),
    },
    "small-cap": {
        "expense_ratio_pct": (0.49, "S09", "Scheme page leaves expense ratio blank; KIM discloses Direct Plan total TER 0.49%."),
    },
}


def main() -> None:
    today = dt.date.today().isoformat()
    OUT.mkdir(parents=True, exist_ok=True)
    chunks, schemes, rows = [], {}, []
    slug_to_key = {v: k for k, v in SCHEMES.items()}

    for sid, pub, kind, title, url, topics in SOURCES:
        ext = ".pdf" if url.lower().endswith(".pdf") else ".html"
        try:
            data = fetch(url, sid + ext)
        except Exception as e:  # keep going; report at the end
            print(f"!! {sid} fetch failed: {e}")
            continue
        if ext == ".pdf":
            text = pdf_text(data)
        else:
            raw = data.decode("utf-8", "replace")
            text = html_text(raw)
            slug = url.rsplit("/", 1)[-1]
            if slug in slug_to_key:
                key = slug_to_key[slug]
                facts = scheme_facts(raw, url)
                facts["field_sources"] = {}
                kim = next(s for s in SOURCES if s[0] == f"S{int(sid[1:]) + 5:02d}")
                facts["kim_url"] = kim[4]
                for field, (val, src, why) in OVERRIDES.get(key, {}).items():
                    facts[field] = val
                    facts["field_sources"][field] = {"url": next(s[4] for s in SOURCES if s[0] == src), "note": why}
                schemes[key] = facts
                # Put a clean fact sheet chunk first so retrieval can also find it.
                text = (
                    f"{facts['name']}. Category: {facts['category']}. Expense ratio: {facts['expense_ratio_pct']}% (inclusive of GST). "
                    f"Exit load: {facts['exit_load']}. Minimum SIP: Rs {facts['min_sip']}. Minimum lumpsum: Rs {facts['min_lumpsum']}. "
                    f"Lock-in: {facts['lock_in'] or 'none'}. Riskometer: {facts['riskometer']}. Benchmark: {facts['benchmark']}.\n" + text
                )
        parts = chunk(text)
        for i, c in enumerate(parts):
            chunks.append({"id": f"{sid}-{i}", "source_id": sid, "title": title, "publisher": pub, "url": url, "text": c})
        rows.append([sid, pub, kind, title, url, topics, today])
        print(f"ok {sid} {len(text):>7} chars -> {len(parts):>3} chunks  {title}")

    meta = {"amc": "Groww Mutual Fund (Groww Asset Management Ltd.)", "last_updated": today, "source_count": len(rows)}
    (OUT / "corpus.json").write_text(json.dumps({"meta": meta, "chunks": chunks}, ensure_ascii=False))
    (OUT / "schemes.json").write_text(json.dumps({"meta": meta, "schemes": schemes}, ensure_ascii=False, indent=1))
    keys = ["id", "publisher", "type", "title", "url", "topics", "fetched_on"]
    (OUT / "sources.json").write_text(json.dumps({"meta": meta, "sources": [dict(zip(keys, r)) for r in rows]}, ensure_ascii=False, indent=1))
    with open(ROOT / "sources.csv", "w", newline="") as f:
        w = csv.writer(f)
        w.writerow(["id", "publisher", "type", "title", "url", "topics", "fetched_on"])
        w.writerows(rows)
    print(f"\n{len(rows)} sources, {len(chunks)} chunks, {len(schemes)} schemes -> {OUT}")


if __name__ == "__main__":
    main()

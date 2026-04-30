#!/usr/bin/env python3
"""Build a single-page HTML dashboard from cached PredictLeads signals.

Usage:
  python3 scripts/predictleads-dashboard.py \
      --leads-json path/to/leads.json \
      --out ~/Desktop/predictleads-dashboard.html

leads.json shape (one entry per company; domain must already have signals
in ~/.gtm-os/gtm-os.db via `signals:fetch`):

  [
    {
      "domain": "personio.com",
      "company": "Personio",
      "vertical": "HR-tech",
      "geo": "DE",
      "lead_name": "Lee Komeda",
      "lead_title": "VP Brand and Product Marketing",
      "linkedin": "https://www.linkedin.com/in/..."
    },
    ...
  ]
"""
import argparse
import json
import sqlite3
from pathlib import Path

DEFAULT_DB = Path.home() / ".gtm-os" / "gtm-os.db"


def pull_signals(con: sqlite3.Connection, domain: str) -> dict:
    counts: dict[str, int] = {}
    for st in ("job_opening", "financing", "technology", "news", "similar_company"):
        row = con.execute(
            "SELECT COUNT(*) AS c FROM company_signals WHERE domain=? AND signal_type=?",
            (domain, st),
        ).fetchone()
        counts[st] = row["c"]

    def fetch(st: str, limit: int) -> list[dict]:
        rows = con.execute(
            "SELECT event_date, payload FROM company_signals "
            "WHERE domain=? AND signal_type=? "
            "ORDER BY event_date DESC NULLS LAST, last_seen_at DESC LIMIT ?",
            (domain, st, limit),
        ).fetchall()
        return [{"date": r["event_date"], "payload": json.loads(r["payload"])} for r in rows]

    return {
        "counts": counts,
        "jobs": fetch("job_opening", 8),
        "financing": fetch("financing", 5),
        "technology": fetch("technology", 12),
        "news": fetch("news", 8),
        "similar": fetch("similar_company", 10),
    }


HTML_TEMPLATE = r"""<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><title>__TITLE__</title>
<meta name="viewport" content="width=device-width,initial-scale=1" />
<style>
  :root {
    --bg:#0b0d10;--panel:#14171c;--panel-2:#1a1f26;--line:#232932;--text:#e7ebf0;--muted:#8a93a0;
    --accent:#ffb84a;--green:#6ed98a;--blue:#6aa9ff;--purple:#c08bff;--pink:#ff7eb6;
  }
  @media (prefers-color-scheme: light) {
    :root {
      --bg:#fafaf7;--panel:#ffffff;--panel-2:#f3f4f1;--line:#e2e4dc;--text:#14181e;--muted:#5e6773;
      --accent:#b8741b;--green:#2c8a4a;--blue:#2c5fb8;--purple:#7b3eb5;--pink:#b53e7e;
    }
  }
  *{box-sizing:border-box}html,body{margin:0;padding:0}
  body{background:var(--bg);color:var(--text);font:14px/1.5 ui-sans-serif,-apple-system,"Inter","Segoe UI",sans-serif}
  .wrap{max-width:1400px;margin:0 auto;padding:32px 28px 80px}
  header{display:flex;justify-content:space-between;align-items:flex-end;gap:24px;margin-bottom:28px;flex-wrap:wrap}
  h1{margin:0;font-size:26px;font-weight:600;letter-spacing:-0.02em}
  .sub{color:var(--muted);margin-top:4px;font-size:13px}
  .meta{display:flex;gap:18px;color:var(--muted);font-size:12px}
  .meta b{color:var(--text);font-weight:600}
  .controls{display:flex;gap:8px;margin-bottom:24px;flex-wrap:wrap;align-items:center}
  .controls .label{color:var(--muted);font-size:12px;margin-right:4px}
  .pill{background:var(--panel);border:1px solid var(--line);color:var(--text);padding:5px 12px;border-radius:999px;font-size:12px;cursor:pointer;transition:border-color 120ms ease,background 120ms ease}
  .pill:hover{border-color:var(--accent)}
  .pill.active{background:var(--accent);color:#000;border-color:var(--accent);font-weight:600}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(420px,1fr));gap:16px}
  .card{background:var(--panel);border:1px solid var(--line);border-radius:12px;padding:20px;display:flex;flex-direction:column;transition:border-color 160ms ease}
  .card:hover{border-color:var(--accent)}
  .card-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:14px}
  .company-name{font-size:18px;font-weight:600;letter-spacing:-0.01em}
  .company-meta{color:var(--muted);font-size:12px;margin-top:2px}
  .domain{font-size:11px;color:var(--muted);font-family:ui-monospace,Menlo,monospace}
  .lead-row{background:var(--panel-2);border-radius:8px;padding:10px 12px;margin-bottom:14px;display:flex;justify-content:space-between;align-items:center;gap:8px}
  .lead-row .name{font-weight:600}
  .lead-row .title{color:var(--muted);font-size:12px;margin-top:2px}
  .lead-row a{color:var(--blue);text-decoration:none;font-size:12px;border:1px solid var(--line);padding:4px 10px;border-radius:6px;white-space:nowrap}
  .lead-row a:hover{border-color:var(--blue)}
  .badges{display:flex;flex-wrap:wrap;gap:6px;margin-bottom:14px}
  .badge{display:inline-flex;align-items:center;gap:4px;padding:3px 9px;border-radius:6px;font-size:11px;border:1px solid;background:transparent;cursor:pointer}
  .badge .n{font-weight:700}
  .badge.jobs{color:var(--green);border-color:var(--green)}
  .badge.financing{color:var(--accent);border-color:var(--accent)}
  .badge.news{color:var(--blue);border-color:var(--blue)}
  .badge.tech{color:var(--purple);border-color:var(--purple)}
  .badge.similar{color:var(--pink);border-color:var(--pink)}
  .top-signal{background:var(--panel-2);border-left:2px solid var(--accent);padding:10px 12px;border-radius:0 8px 8px 0;margin-bottom:12px;font-size:13px}
  .top-signal .label{font-size:10px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin-bottom:4px}
  .top-signal .body{line-height:1.4}
  .top-signal .date{color:var(--muted);font-size:11px;margin-top:4px;font-family:ui-monospace,Menlo,monospace}
  .toggle{margin-top:auto;background:transparent;border:1px solid var(--line);color:var(--text);border-radius:8px;padding:8px 12px;cursor:pointer;font-size:12px;text-align:left}
  .toggle:hover{border-color:var(--accent)}
  .details{display:none;margin-top:16px}.details.open{display:block}
  .section-title{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:0.08em;margin:16px 0 8px}
  .section-title:first-child{margin-top:0}
  ul.list{list-style:none;padding:0;margin:0}
  ul.list li{padding:8px 0;border-bottom:1px dashed var(--line);display:flex;gap:10px;align-items:flex-start}
  ul.list li:last-child{border-bottom:none}
  ul.list .date{color:var(--muted);font-size:11px;min-width:80px;font-family:ui-monospace,Menlo,monospace;padding-top:2px}
  ul.list .text{flex:1;line-height:1.45}
  ul.list .text a{color:var(--blue);text-decoration:none}
  ul.list .text a:hover{text-decoration:underline}
  ul.list .cat{display:inline-block;font-size:10px;background:var(--panel-2);color:var(--muted);padding:1px 6px;border-radius:4px;margin-right:6px;text-transform:lowercase}
  .tech-grid{display:flex;flex-wrap:wrap;gap:4px}
  .tech-grid .tag{background:var(--panel-2);border:1px solid var(--line);color:var(--text);padding:3px 8px;border-radius:4px;font-size:11px}
  .empty{color:var(--muted);font-size:12px;font-style:italic;padding:8px 0}
  .vertical-tag{display:inline-block;font-size:10px;text-transform:uppercase;letter-spacing:0.06em;padding:2px 7px;border-radius:4px;background:var(--panel-2);color:var(--muted);margin-right:4px}
  footer{color:var(--muted);font-size:11px;margin-top:40px;text-align:center}
  @media (max-width:720px){.grid{grid-template-columns:1fr}h1{font-size:22px}}
</style>
</head><body>
<div class="wrap">
  <header>
    <div>
      <h1>__TITLE__</h1>
      <div class="sub">__SUBTITLE__</div>
    </div>
    <div class="meta">
      <div><b id="totalCompanies">0</b> companies</div>
      <div><b id="totalSignals">0</b> signals</div>
      <div>__DATE__</div>
    </div>
  </header>
  <div class="controls">
    <span class="label">Filter:</span>
    <button class="pill active" data-filter="all">All</button>
    <span id="verticalPills"></span>
    <span class="label" style="margin-left:18px">Sort:</span>
    <button class="pill active" data-sort="density">Signal density</button>
    <button class="pill" data-sort="recency">Recency</button>
    <button class="pill" data-sort="vertical">Vertical</button>
  </div>
  <div id="grid" class="grid"></div>
  <footer>Data: PredictLeads · stored locally in ~/.gtm-os/gtm-os.db</footer>
</div>
<script>
const DATA = __DATA__;
function escape(s){return String(s??"").replace(/[&<>"']/g,c=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#39;"}[c]))}
function fmtDate(d){return d?d.slice(0,10):""}
function totalCount(c){return Object.values(c.counts).reduce((a,b)=>a+b,0)}
function jobLine(j){const t=j.payload.title||j.payload.normalized_title||"role";const loc=j.payload.location||"";return`<li><span class="date">${fmtDate(j.date)}</span><span class="text">${escape(t)}${loc?` · <span style="color:var(--muted)">${escape(loc.slice(0,50))}</span>`:""}</span></li>`}
function newsLine(n){const summary=n.payload.summary||n.payload.title||"";const cat=n.payload.category||"";return`<li><span class="date">${fmtDate(n.date)}</span><span class="text">${cat?`<span class="cat">${escape(cat)}</span>`:""}${escape(summary)}</span></li>`}
function fundingLine(f){const round=f.payload.round||f.payload.financing_type||"Funding";const amount=f.payload.amount||f.payload.amount_normalized||"";return`<li><span class="date">${fmtDate(f.date)}</span><span class="text"><b>${escape(round)}</b>${amount?` · ${escape(amount)}`:""}</span></li>`}
function techTag(t){const name=t.payload.technology||t.payload.name||"";return name?`<span class="tag">${escape(name)}</span>`:""}
function similarLine(s){const dom=s.payload.similar_company||"";const sc=s.payload.score?` · ${(s.payload.score*100).toFixed(0)}%`:"";const reason=s.payload.reason||"";return`<li><span class="date">${dom?"#"+(s.payload.position||""):""}</span><span class="text"><b>${escape(dom)}</b>${sc}${reason?`<div style="color:var(--muted);font-size:12px;margin-top:2px">${escape(reason)}</div>`:""}</span></li>`}
function topSignal(c){const all=[...c.financing.map(x=>({...x,kind:"financing"})),...c.news.map(x=>({...x,kind:"news"})),...c.jobs.map(x=>({...x,kind:"job"}))].filter(x=>x.date).sort((a,b)=>(b.date||"").localeCompare(a.date||""));if(!all.length)return null;const top=all[0];let body="";if(top.kind==="news")body=top.payload.summary||top.payload.title||"";else if(top.kind==="job")body=`Hiring: ${top.payload.title||top.payload.normalized_title||"role"}`;else body=`${top.payload.round||"Funding"}${top.payload.amount?" · "+top.payload.amount:""}`;return{kind:top.kind,body,date:top.date}}
function card(c){const ts=topSignal(c);return`<div class="card" data-vertical="${escape(c.vertical)}" data-density="${totalCount(c)}" data-recency="${ts?ts.date:""}"><div class="card-head"><div><div class="company-name">${escape(c.company)} <span class="vertical-tag">${escape(c.vertical)}</span></div><div class="company-meta"><span class="domain">${escape(c.domain)}</span> · ${escape(c.geo||"")}</div></div></div>${c.lead_name?`<div class="lead-row"><div><div class="name">${escape(c.lead_name)}</div><div class="title">${escape(c.lead_title||"")}</div></div>${c.linkedin?`<a href="${escape(c.linkedin)}" target="_blank" rel="noopener">LinkedIn ↗</a>`:""}</div>`:""}<div class="badges"><span class="badge jobs"><span class="n">${c.counts.job_opening}</span> jobs</span><span class="badge financing"><span class="n">${c.counts.financing}</span> funding</span><span class="badge news"><span class="n">${c.counts.news}</span> news</span><span class="badge tech"><span class="n">${c.counts.technology}</span> tech</span><span class="badge similar"><span class="n">${c.counts.similar_company}</span> similar</span></div>${ts?`<div class="top-signal"><div class="label">Top signal · ${escape(ts.kind)}</div><div class="body">${escape(ts.body)}</div><div class="date">${fmtDate(ts.date)}</div></div>`:""}<button class="toggle" data-toggle>+ Show all signals</button><div class="details"><div class="section-title">Recent jobs</div>${c.jobs.length?`<ul class="list">${c.jobs.map(jobLine).join("")}</ul>`:'<div class="empty">no jobs in last cycle</div>'}<div class="section-title">News events</div>${c.news.length?`<ul class="list">${c.news.map(newsLine).join("")}</ul>`:'<div class="empty">no news events</div>'}<div class="section-title">Funding events</div>${c.financing.length?`<ul class="list">${c.financing.map(fundingLine).join("")}</ul>`:'<div class="empty">no funding events on file</div>'}<div class="section-title">Technology stack (top ${c.technology.length})</div>${c.technology.length?`<div class="tech-grid">${c.technology.map(techTag).join("")}</div>`:'<div class="empty">no tech detections</div>'}${c.similar.length?`<div class="section-title">Similar companies</div><ul class="list">${c.similar.slice(0,8).map(similarLine).join("")}</ul>`:""}</div></div>`}
let activeFilter="all",activeSort="density";
function render(){let list=DATA.slice();if(activeFilter!=="all")list=list.filter(c=>c.vertical===activeFilter);if(activeSort==="density")list.sort((a,b)=>totalCount(b)-totalCount(a));else if(activeSort==="recency"){list.sort((a,b)=>(topSignal(b)?.date||"").localeCompare(topSignal(a)?.date||""))}else if(activeSort==="vertical")list.sort((a,b)=>(a.vertical||"").localeCompare(b.vertical||""));document.getElementById("grid").innerHTML=list.map(card).join("");document.getElementById("totalCompanies").textContent=DATA.length;document.getElementById("totalSignals").textContent=DATA.reduce((s,c)=>s+totalCount(c),0).toLocaleString();document.querySelectorAll("[data-toggle]").forEach(btn=>{btn.addEventListener("click",()=>{const d=btn.parentElement.querySelector(".details");d.classList.toggle("open");btn.textContent=d.classList.contains("open")?"− Hide signals":"+ Show all signals"})})}
const verticals=[...new Set(DATA.map(c=>c.vertical).filter(Boolean))];
document.getElementById("verticalPills").innerHTML=verticals.map(v=>`<button class="pill" data-filter="${escape(v)}">${escape(v)}</button>`).join("");
document.querySelectorAll(".pill[data-filter]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".pill[data-filter]").forEach(x=>x.classList.remove("active"));b.classList.add("active");activeFilter=b.dataset.filter;render()}));
document.querySelectorAll(".pill[data-sort]").forEach(b=>b.addEventListener("click",()=>{document.querySelectorAll(".pill[data-sort]").forEach(x=>x.classList.remove("active"));b.classList.add("active");activeSort=b.dataset.sort;render()}));
render();
</script></body></html>
"""


def main():
    parser = argparse.ArgumentParser(description="Build a PredictLeads HTML dashboard from cached SQLite signals.")
    parser.add_argument("--leads-json", type=Path, required=True,
                        help="Path to JSON file describing the companies to render.")
    parser.add_argument("--out", type=Path, required=True,
                        help="Output HTML file path.")
    parser.add_argument("--db", type=Path, default=DEFAULT_DB,
                        help=f"SQLite DB path (default: {DEFAULT_DB})")
    parser.add_argument("--title", default="PredictLeads Dashboard",
                        help="Page title shown in the header.")
    parser.add_argument("--subtitle", default="Cached company-level signals.",
                        help="Subtitle shown under the title.")
    parser.add_argument("--date", default=None,
                        help="Date label shown in the meta strip. Defaults to today.")
    args = parser.parse_args()

    with open(args.leads_json) as f:
        leads = json.load(f)
    if not isinstance(leads, list) or not leads:
        raise SystemExit("leads-json must be a non-empty JSON array")

    con = sqlite3.connect(args.db)
    con.row_factory = sqlite3.Row

    companies = []
    for entry in leads:
        domain = entry.get("domain")
        if not domain:
            raise SystemExit(f"Each lead entry must include 'domain'. Got: {entry}")
        sig = pull_signals(con, domain)
        companies.append({**entry, **sig})
    con.close()

    if args.date is None:
        from datetime import date as _date
        args.date = _date.today().isoformat()

    html = (
        HTML_TEMPLATE
        .replace("__TITLE__", args.title)
        .replace("__SUBTITLE__", args.subtitle)
        .replace("__DATE__", args.date)
        .replace("__DATA__", json.dumps(companies))
    )
    args.out.write_text(html)
    total = sum(sum(c["counts"].values()) for c in companies)
    print(f"Wrote {args.out}")
    print(f"Companies: {len(companies)} · Signals: {total}")


if __name__ == "__main__":
    main()

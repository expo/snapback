#!/usr/bin/env python3
"""Print Markdown tables from a results directory's *.jsonl files.
   python3 -I scripts/tables.py <results-dir>"""
import json, os, sys


def s1a_tables(directory):
    """S1a has three independent, load-qualified repetition records/setting."""
    import glob
    import statistics
    groups = {}
    rejected = []
    for path in sorted(glob.glob(os.path.join(directory, "*.json"))):
        if not os.path.basename(path).startswith(("raw-", "execution-", "commit-", "sqlite-", "ping-")):
            continue
        record = json.load(open(path))
        if "result" not in record:
            continue
        if not record.get("accepted"):
            rejected.append(path)
            continue
        r = record["result"]
        key = (r.get("cell"), r.get("net", {}).get("label", "local"),
               r.get("connections", r.get("threads", r.get("writers", 1))),
               r.get("batch", 1), r.get("non_head_pct", 0), r.get("counters", "disjoint"))
        groups.setdefault(key, []).append(record)
    stats = {}
    for key, records in sorted(groups.items()):
        if key[0] == "ping":
            r = records[0]["result"]
            print(f"Ping {key[1]}: p50={r['p50_us']:.1f} µs, p99={r['p99_us']:.1f} µs")
    print()
    print("| Cell | RTT | C/threads/producers | N | Non-head % | Keys | /s median (min–max) | p50 ms | p99 ms | Max run p99 ms | Max load |")
    print("| --- | --- | ---: | ---: | ---: | --- | ---: | ---: | ---: | ---: | ---: |")
    for key, records in sorted(groups.items()):
        if key[0] == "ping":
            continue
        runs = [run for record in records for run in record["result"].get("runs", [])]
        complete = (len(runs) == 3 and all(r["status"] == "complete" for r in runs)
                    and all(r["exit_status"] == 0 for r in records))
        if not complete:
            print(f"| {' | '.join(map(str,key))} | FAILED/INCOMPLETE ({len(runs)} runs) | | | | |")
            continue
        rate = [r["commits_per_s"] for r in runs]
        s = {"rate":statistics.median(rate), "p50":statistics.median(r["p50_ms"] for r in runs),
             "p99":statistics.median(r["p99_ms"] for r in runs), "max_p99":max(r["p99_ms"] for r in runs)}
        stats[key] = s
        print(f"| {' | '.join(map(str,key))} | {s['rate']:,.0f} ({min(rate):,.0f}–{max(rate):,.0f}) | {s['p50']:.3f} | {s['p99']:.3f} | {s['max_p99']:.3f} | {max(r['max_load'] for r in records):.2f} |")
    print(f"\nRejected load attempts retained: {len(rejected)}")
    print("\n| RTT | Execution C32 /s | Best full commit 0/10/30% /s (N) | Predicted 0% /s | Raw C32 disjoint/hot1 /s | Predicted/raw disjoint |")
    print("| --- | ---: | --- | ---: | --- | ---: |")
    for net in ["rtt200", "rtt500", "rtt1000"]:
        execution = stats.get(("pg-execution",net,32,1,0,"disjoint"))
        raw = [stats.get(("raw",net,32,1,0,keys)) for keys in ["disjoint","hot1"]]
        best = []
        for pct in [0,10,30]:
            choices = [(s["rate"],k[3]) for k,s in stats.items() if k[0]=="model" and k[1]==net and k[4]==pct and s["max_p99"]<=100]
            best.append(max(choices) if choices else None)
        if execution and all(raw) and all(best):
            ceiling = min(execution["rate"],best[0][0])
            detail = " / ".join(f"{rate:,.0f} (N={n})" for rate,n in best)
            print(f"| {net} | {execution['rate']:,.0f} | {detail} | {ceiling:,.0f} | {raw[0]['rate']:,.0f} / {raw[1]['rate']:,.0f} | {ceiling/raw[0]['rate']:.1%} |")
            if net == "rtt500":
                bar = max(2000,raw[0]["rate"]*0.5)
                print(f"\nSizing rule: {'BUILD' if ceiling>=bar else 'DO NOT BUILD'}; ceiling={ceiling:.1f}/s, 2× bar={bar:.1f}/s.")
    sqread = [(s["rate"],k[2]) for k,s in stats.items() if k[0]=="sqlite-execution"]
    sqwrite = [(s["rate"],k[3]) for k,s in stats.items() if k[0]=="sqlite-commit" and s["max_p99"]<=100]
    if len(sqread)==4 and len(sqwrite)==4:
        er,threads = max(sqread)
        cr,n = max(sqwrite)
        ceiling = min(er,cr)
        c32 = stats[("sqlite-execution","local",32,1,0,"disjoint")]["rate"]
        print(f"\nSQLite model: best read={er:,.0f}/s ({threads} threads), commit={cr:,.0f}/s (N={n}), ceiling={ceiling:,.0f}/s; C32 ceiling={min(c32,cr):,.0f}/s; vs S0 3,700–4,200/s = {ceiling/4200:.2f}–{ceiling/3700:.2f}×.")


if any(name.endswith(".before.txt") for name in os.listdir(sys.argv[1])):
    s1a_tables(sys.argv[1])
    sys.exit(0)

d = sys.argv[1]
NETS = ["unix", "rtt0", "rtt200", "rtt500", "rtt1000"]


def load(name):
    p = os.path.join(d, name + ".jsonl")
    if not os.path.exists(p):
        return []
    return [json.loads(l) for l in open(p) if l.strip()]


def f(v, nd=0):
    if v is None:
        return "—"
    return f"{v:,.{nd}f}"


def cell(r):
    s = r.get("summary", {})
    if r.get("cell") == "crashed" or s.get("status") != "complete":
        return "FAILED"
    return f"{f(s['commits_per_s_median'])} ({f(s['commits_per_s_min'])}–{f(s['commits_per_s_max'])})"


def load_note(r):
    return f"{r.get('loadavg_before', ['?'])[0]}→{r.get('loadavg_after', ['?'])[0]}"


ping = load("ping")
if ping:
    print("### RTT verification (SELECT 1 ping, µs)\n")
    print("| Setting | p50 | p90 | p99 | min |\n| --- | ---: | ---: | ---: | ---: |")
    for r in ping:
        print(f"| {r['net']['label']} | {f(r['p50_us'],1)} | {f(r['p90_us'],1)} | {f(r['p99_us'],1)} | {f(r['min_us'],1)} |")
    print()


def table(title, rows, keyf, cols):
    print(f"### {title}\n")
    print("| " + " | ".join(["Cell"] + NETS) + " |")
    print("| --- |" + " ---: |" * len(NETS))
    for label, match in cols:
        line = [label]
        for n in NETS:
            hit = [r for r in rows if keyf(r) == (match, n)]
            line.append(cell(hit[0]) if hit else "")
        print("| " + " | ".join(line) + " |")
    print()


def detail(title, rows):
    print(f"### {title} — detail\n")
    print("| Cell | Net | Writers | commits/s median (min–max) | p50 ms | p99 ms | calls/op | WAL B/commit | load before→after |")
    print("| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |")
    for r in rows:
        s = r.get("summary", {})
        name = r.get("cell", "?")
        if name == "model":
            name = f"{r['protocol']}" + (f" N={r['batch']}" if r["protocol"] != "R" else "") + (f" {r['tail']}" if r.get("tail") == "coalesced" else "") + (f" {r['txn']}" if r.get("txn") == "implicit" else "")
        name += f" {r.get('counters','')}"
        print(f"| {name} | {r.get('net',{}).get('label','')} | {r.get('writers','')} | {cell(r)} | {f(s.get('p50_ms_median'),2)} | {f(s.get('p99_ms_median'),2)} | {f(s.get('calls_per_op_median'),1)} | {f(s.get('wal_bytes_per_commit_median'))} | {load_note(r)} |")
    print()


eng = load("engine")
modR = load("model-R")
if eng or modR:
    table("Reference committer: real engine (cell 1) vs model R (cell 2), commits/s", eng + modR,
          lambda r: ((r["cell"], r["counters"]) if r["cell"] == "engine" else ("R", r["counters"]), r["net"]["label"]),
          [("engine disjoint", ("engine", "disjoint")), ("engine same", ("engine", "same")),
           ("model R disjoint", ("R", "disjoint")), ("model R same", ("R", "same"))])
    detail("Reference", eng + modR)

m0 = load("model-0")
if m0:
    cols = [(f"(0) N={n} {c}", (n, c)) for n in [1, 2, 4, 8, 16, 32, 64] for c in ["disjoint", "same"]]
    table("Serial batch (0), MODEL, per-member tail, commits/s", m0, lambda r: ((r["batch"], r["counters"]), r["net"]["label"]), cols)
    detail("Serial batch (0)", m0)

mA = load("model-A")
if mA:
    cols = [(f"(A) N={n}", n) for n in [1, 2, 4, 8, 16, 32, 64]]
    table("Commit stage of (a), UPPER BOUND, disjoint, commits/s", mA, lambda r: (r["batch"], r["net"]["label"]), cols)
    detail("Commit stage (A)", mA)

for extra in ["model-0-coalesced", "model-A-implicit"]:
    rows = load(extra)
    if rows:
        detail(extra, rows)

raw = load("raw")
if raw:
    cols = [(f"raw W={w} {c}", (w, c)) for w in [4, 16, 64] for c in ["disjoint", "same"]]
    table("Raw Postgres control, autocommit UPDATE, commits/s", raw, lambda r: ((r["writers"], r["counters"]), r["net"]["label"]), cols)
    detail("Raw Postgres", raw)

sq = load("sqlite") + load("sqlite-old")
if sq:
    print("### SQLite\n")
    print("| Cell | Writers | Counters | commits/s median (min–max) | p50 ms | p99 ms | load before→after |\n| --- | ---: | --- | ---: | ---: | ---: | --- |")
    for r in sq:
        if r["cell"] == "sqlite-exec-flush":
            continue
        s = r["summary"]
        print(f"| {r['cell']} | {r.get('writers')} | {r.get('counters')} | {cell(r)} | {f(s.get('p50_ms_median'),3)} | {f(s.get('p99_ms_median'),3)} | {load_note(r)} |")
    print()
    for r in sq:
        if r["cell"] == "sqlite-exec-flush":
            print(f"exec (synchronous=OFF, mean) {r['exec_ms']*1000:.1f} µs; FULL {r['full_ms']*1000:.1f} µs; flush = FULL − OFF = {r['flush_ms']*1000:.1f} µs; load {load_note(r)}\n")
            print("| N | ESTIMATED serial batch commits/s |\n| ---: | ---: |")
            for e in r["serial_batch_estimate"]:
                print(f"| {e['batch']} | {f(e['predicted_commits_per_s'])} |")
            print()

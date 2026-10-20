#!/usr/bin/env python3
"""H1 prediction vs measurement, the model-vs-engine calibration and the
decision-rule inputs, from a results directory (plus the ping file).
   python3 -I scripts/analysis.py <results-dir> <ping-jsonl>"""
import json, os, sys

d, ping_path = sys.argv[1], sys.argv[2]


def load(name):
    p = os.path.join(d, name + ".jsonl")
    return [json.loads(l) for l in open(p) if l.strip()] if os.path.exists(p) else []


ping = {r["net"]["label"]: r["p50_us"] / 1e3 for r in (json.loads(l) for l in open(ping_path) if l.strip())}
NETS = ["unix", "rtt0", "rtt200", "rtt500", "rtt1000"]
added = {n: ping[n] - ping["rtt0"] for n in NETS if n.startswith("rtt")}


def med(r):
    return r["summary"]["commits_per_s_median"] if r["summary"]["status"] == "complete" else None


eng = {(r["net"]["label"], r["counters"]): r for r in load("engine")}
modR = {(r["net"]["label"], r["counters"]): r for r in load("model-R")}

print("### H1: reference committer, prediction vs measurement\n")
print("RTT is the measured SELECT 1 ping p50 at each setting (it includes the proxy's own overhead).")
print("H1 as written: `1/(k·RTT + exec + F)` with k = 15 and exec + F taken as 0 (an upper bound).")
print("A least-squares fit of serial time per commit against the added RTT follows the table.\n")
print("| Setting | ping RTT ms | H1 k=15, exec+F=0 | measured engine disjoint / same | measured ÷ H1 |")
print("| --- | ---: | ---: | ---: | ---: |")
for n in NETS:
    rtt = ping[n]
    pred = 1 / (15 * rtt / 1e3)
    a, b = med(eng[(n, "disjoint")]), med(eng[(n, "same")])
    print(f"| {n} | {rtt:.3f} | {pred:,.0f} | {a:,.0f} / {b:,.0f} | {((a + b) / 2) / pred:.2f} |")
print()

# Linear fit of serial time per commit (1/throughput) against the added RTT.
xs, ys = [], []
for n in ["rtt0", "rtt200", "rtt500", "rtt1000"]:
    for c in ["disjoint", "same"]:
        v = med(eng[(n, c)])
        if v:
            xs.append(added.get(n, 0.0))
            ys.append(1e3 / v)
mx, my = sum(xs) / len(xs), sum(ys) / len(ys)
slope = sum((x - mx) * (y - my) for x, y in zip(xs, ys)) / sum((x - mx) ** 2 for x in xs)
icept = my - slope * mx
print(f"Least-squares fit over the proxied engine cells: serial ms per commit = {icept:.2f} + {slope:.2f} × added RTT (ms).")
print(f"The slope is the number of round trips inside the serial section: {slope:.1f} (captured sequence: 12 after the lock grant, 13 lock-holding statements; 18 calls per mutation in all).\n")

print("### Model R vs engine (calibration)\n")
print("| Setting | counters | engine | model R | model ÷ engine |\n| --- | --- | ---: | ---: | ---: |")
for n in NETS:
    for c in ["disjoint", "same"]:
        a, b = med(eng[(n, c)]), med(modR[(n, c)])
        print(f"| {n} | {c} | {a:,.0f} | {b:,.0f} | {b / a:.2f} |")
print()

m0 = load("model-0")
mA = load("model-A")
raw = load("raw")
m0c = load("model-0-coalesced")
mAi = load("model-A-implicit")
print("### Decision-rule inputs at rtt500\n")
best0 = max((r for r in m0 if r["net"]["label"] == "rtt500" and med(r)), key=med, default=None)
for c in ["disjoint", "same"]:
    rows = [r for r in m0 if r["net"]["label"] == "rtt500" and r["counters"] == c and med(r)]
    if rows:
        b = max(rows, key=med)
        print(f"- (0) per-member tail, {c}: best N = {b['batch']} at {med(b):,.0f} commits/s (writers {b['writers']}).")
    rows = [r for r in m0c if r["net"]["label"] == "rtt500" and r["counters"] == c and med(r)]
    if rows:
        b = max(rows, key=med)
        print(f"- (0) coalesced tail, {c}: best N = {b['batch']} at {med(b):,.0f} commits/s (writers {b['writers']}).")
rowsA = [r for r in mA if r["net"]["label"] == "rtt500" and med(r)]
if rowsA:
    b = max(rowsA, key=med)
    print(f"- (A) commit stage, explicit transaction: best N = {b['batch']} at {med(b):,.0f} commits/s (UPPER BOUND).")
rowsA = [r for r in mAi if r["net"]["label"] == "rtt500" and med(r)]
if rowsA:
    b = max(rowsA, key=med)
    print(f"- (A) commit stage, implicit transaction: best N = {b['batch']} at {med(b):,.0f} commits/s (UPPER BOUND).")
for c in ["disjoint", "same"]:
    rows = [r for r in raw if r["net"]["label"] == "rtt500" and r["counters"] == c and med(r)]
    for r in sorted(rows, key=lambda r: r["writers"]):
        print(f"- raw Postgres, {c}, {r['writers']} writers: {med(r):,.0f} commits/s.")

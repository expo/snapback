from pathlib import Path
import json
root = Path(__file__).resolve().parents[1]
lines = ['# LL before/after measurements', '', 'Milliseconds, nearest-rank p50/p95; 20 samples per flow per cell. Both loads use four permitted CPUs (0–3); load 3 adds three owned busy workers. All original stage and work-count distributions remain in the summary JSONs.', '', '| Tier / busy workers | Flow | Before publication p50/p95 | After publication p50/p95 | Before queries p50/p95 | After queries p50/p95 | Before/after asset-home p95 |', '|---|---|---:|---:|---:|---:|---:|']
for tier in ['wasm','process']:
    for load in [0,3]:
        before,after = [json.loads((root/f'll-{label}-{tier}-{load}-summary.json').read_text())['flows'] for label in ['before','after']]
        for name,b in before.items():
            a=after[name]
            pair=lambda x,k:f"{x[k]['p50']}/{x[k]['p95']}"
            lines.append(f"| {tier} / {load} | {name} | {pair(b,'commitToPublication')} | {pair(a,'commitToPublication')} | {pair(b,'deviceQueries')} | {pair(a,'deviceQueries')} | {b['assetHomeReads']['p95']}/{a['assetHomeReads']['p95']} |")
        print(tier,load,'max publication p95',max(x['commitToPublication']['p95'] for x in before.values()),max(x['commitToPublication']['p95'] for x in after.values()), 'timeouts',sum(x['timeouts'] for x in before.values()),sum(x['timeouts'] for x in after.values()))
(root/'LL-COMPARISON.md').write_text('\n'.join(lines)+'\n')

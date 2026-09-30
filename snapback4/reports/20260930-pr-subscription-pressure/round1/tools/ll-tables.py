from pathlib import Path
import json
root=Path(__file__).resolve().parents[1]
data={(label,tier,load):json.loads((root/f'll-{label}-{tier}-{load}-summary.json').read_text()) for label in ['round0','round1','final'] for tier in ['wasm','process'] for load in [0,3]}
lines=['# LL measurements', '', 'All latencies are milliseconds. Publication is the receiver observable publication, measured from the server post-SQLite-commit timestamp. Each cell contains 20 trials per flow, 160 total. Zero/three denotes harness load workers on four pinned cores; other lanes shared this host. The final four cells include the new-mount fence, after the first paired matrix.', '', '| Tier / workers | Round 0 maximum flow p95 | Initial round 1 maximum flow p95 | Final round 1 maximum flow p95 | Final timeouts |', '|---|---:|---:|---:|---:|']
for tier in ['wasm','process']:
 for load in [0,3]:
  cells=[data[label,tier,load]['flows'] for label in ['round0','round1','final']]
  values=[max(v['commitToPublication']['p95'] for v in d.values()) for d in cells]
  lines.append(f'| {tier} / {load} | '+ ' | '.join(f'{v:.3f}' for v in values)+f" | {sum(v['timeouts'] for v in cells[2].values())} |")
for tier in ['wasm','process']:
 for load in [0,3]:
  lines += ['',f'## {tier} / {load} workers','', '| Flow | Round 0 publication p95 | Final publication p95 | Final React p95 | Round 0 → final server-query median | Round 0 → final asset-home median |', '|---|---:|---:|---:|---:|---:|']
  before,after=[data[label,tier,load]['flows'] for label in ['round0','final']]
  for flow,b in before.items():
   a=after[flow]
   lines.append(f"| {flow} | {b['commitToPublication']['p95']:.3f} | {a['commitToPublication']['p95']:.3f} | {a['commitToReact']['p95']:.3f} | {b['serverQueries']['p50']} → {a['serverQueries']['p50']} | {b['assetHomeReads']['p50']} → {a['assetHomeReads']['p50']} |")
lines += ['', 'The initial paired matrix and all final traces/summaries are retained. Across all 12 cells: '+str(sum(len(d['flows'])*20 for d in data.values()))+' action trials; '+str(sum(v['timeouts'] for d in data.values() for v in d['flows'].values()))+' timeouts. Stable asset-home medians and no new server-query loop support preservation of the measured LL path. Shared-host latency variation prevents a controlled performance claim.', '']
(root/'LL-TABLES.md').write_text('\n'.join(lines))
print('\n'.join(lines[:10]))

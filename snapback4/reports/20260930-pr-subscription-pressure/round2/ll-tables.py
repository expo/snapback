from pathlib import Path
import json

root = Path(__file__).resolve().parent
labels = ['round1', 'final', 'qualified', 'shipped']
data = {(label, tier, load): json.loads((root / f'll-{label}-{tier}-{load}-summary.json').read_text())
        for label in labels for tier in ['wasm', 'process'] for load in [0, 3]}
lines = ['# LL measurements', '',
    'All latencies are milliseconds from server post-SQLite-commit to receiver publication or React commit. Each cell has 20 repetitions of eight flows (160 actions), pinned to four cores, with zero or three harness load workers. The same current instrumented server and current devices serve the paired SDK comparison. Host load is recorded in every trace; other work, including this lane’s suite, shared the host. These are live-path checks, not a controlled speedup claim.', '',
    'The first paired matrix alternates the round-1 SDK (`round1`) and initial round-2 SDK (`final`). The `qualified` matrix follows later queue/terminal fixes. The last matrix (`shipped`, a measurement label only) includes stable terminal-refusal comparison. The later correction that lets a closed facade copy follow existence metadata changes only app-client.ts; this raw-local-client harness does not import or invoke that facade. Its measured paths match the final code.', '',
    '| Tier / workers | Round 1 max flow p95 | Initial round 2 max flow p95 | Later round 2 max flow p95 | Last round 2 max flow p95 | Last timeouts |',
    '|---|---:|---:|---:|---:|---:|']
for tier in ['wasm', 'process']:
    for load in [0, 3]:
        cells = [data[label, tier, load]['flows'] for label in labels]
        values = [max(v['commitToPublication']['p95'] for v in d.values()) for d in cells]
        lines.append(f'| {tier} / {load} | ' + ' | '.join(f'{v:.3f}' for v in values)
                     + f" | {sum(v['timeouts'] for v in cells[-1].values())} |")
for tier in ['wasm', 'process']:
    for load in [0, 3]:
        lines += ['', f'## {tier} / {load} workers', '',
            '| Flow | Round 1 publication p95 | Last publication p95 | Last React p95 | Round 1 → last server-query median | Round 1 → last asset-home median |',
            '|---|---:|---:|---:|---:|---:|']
        before, after = [data[label, tier, load]['flows'] for label in ['round1', 'shipped']]
        for flow, b in before.items():
            a = after[flow]
            lines.append(f"| {flow} | {b['commitToPublication']['p95']:.3f} | {a['commitToPublication']['p95']:.3f} | {a['commitToReact']['p95']:.3f} | {b['serverQueries']['p50']} → {a['serverQueries']['p50']} | {b['assetHomeReads']['p50']} → {a['assetHomeReads']['p50']} |")
lines += ['', 'Across the 16 complete cells: '
    + str(sum(v['runs'] for d in data.values() for v in d['flows'].values())) + ' action trials and '
    + str(sum(v['timeouts'] for d in data.values() for v in d['flows'].values())) + ' timeouts. '
    + 'The incomplete `verified` matrix is excluded: its process/0 run was disrupted by our live SDK rebuild (see FAILURES.md). No harness delays, flow shapes, deadlines or scheduler limits were changed.', '']
(root / 'LL-TABLES.md').write_text('\n'.join(lines))
print('\n'.join(lines[:12]))

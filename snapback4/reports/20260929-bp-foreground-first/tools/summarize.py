"""Summarize every SQ batch without resampling, using SQ's frozen rules."""
import json, pathlib, statistics, subprocess, sys

root = pathlib.Path(__file__).resolve().parents[4]
base = pathlib.Path(sys.argv[1]).resolve()
for kind in ['immediate', 'warm']:
    combined = {'method': 'SQ live protocol; monotonic checkpoints; every batch retained', 'rounds': []}
    for checkpoint, stage in [('10%', '10pct'), ('50%', '50pct'), ('full', 'full')]:
        data = json.loads((base / f'{checkpoint}-live-{kind}-curve.json').read_text())
        for batch in data['rounds']:
            batch['stage'] = stage
            combined['rounds'].append(batch)
    (base / f'live-{kind}-curve.json').write_text(json.dumps(combined, indent=2)+'\n')
sq = root / 'snapback4/reports/20260929-sq-storage-read-path/tools/summarize.py'
subprocess.run([sys.executable, str(sq), str(base)], check=True, stdout=subprocess.DEVNULL)
summary = json.loads((base / 'summary.json').read_text())
lines = []
for kind in ['immediate', 'warm']:
    s = summary[f'live-{kind}-curve']
    lines += [f'\n{kind}: p95 milliseconds', '| Probe | 10% | 50% | Full | Full / small |', '| --- | ---: | ---: | ---: | ---: |']
    for probe, points in s['points'].items():
        values = [points[stage]['p95'] for stage in ['10pct','50pct','full']]
        lines.append(f'| {probe} | {values[0]:.3f} | {values[1]:.3f} | {values[2]:.3f} | {values[2]/values[0]:.3f} |')
    lines += ['', '| Probe | 10% p50 / p95 / max | 50% p50 / p95 / max | Full p50 / p95 / max |', '| --- | ---: | ---: | ---: |']
    for probe, points in s['points'].items():
        cells = [' / '.join(f'{points[stage][key]:.3f}' for key in ['p50','p95','max']) for stage in ['10pct','50pct','full']]
        lines.append('| '+probe+' | '+' | '.join(cells)+' |')
    lines += ['', '| Frozen rule | Measured | Ceiling | Margin | Result |', '| --- | ---: | ---: | ---: | --- |']
    for name, rule in s['rules'].items():
        lines.append(f"| {name} | {rule['measured']:.3f} | {rule['ceiling']:.3f} | {rule['margin']:+.3f} | {'PASS' if rule['pass'] else 'FAIL'} |")
    if kind == 'warm':
        lines += ['', 'All nine batches, rule pass counts:']
        for name in s['rules']:
            count = sum(r['rules'][name]['pass'] for r in s['roundRules'])
            lines.append(f'- {name}: {count}/9')
lines += ['', 'Deep paging is not sampled by SQ’s live protocol; no inferred pass.',
          'The write rule and correctness proofs are in live/evidence/replay/.']
verification = json.loads((base/'live/evidence/replay/verification-final.json').read_text())
writes = verification['probes']
ratio = writes['celebrityWrite']['p95']/writes['fiveFollowerWrite']['p95']
lines += [f"Frozen celebrity write ratio: {ratio:.6f} <= 3; margin {3-ratio:+.6f}; "
          f"n={writes['celebrityWrite']['n']} / {writes['fiveFollowerWrite']['n']}."]
drain = json.loads((base / 'drain.json').read_text())
lines += [f"Final drain observation: {drain['end']-drain['start']:.3f} s; three empty samples: {drain['clean']}."]
text = '\n'.join(lines)+'\n'
(base / 'CURVES.md').write_text(text)
print(text)

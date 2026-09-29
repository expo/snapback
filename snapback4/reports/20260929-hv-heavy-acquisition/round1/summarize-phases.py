"""Exclusive nested timer totals. Run after browser.mjs on the diagnostic wasm."""
import gzip
import json
from pathlib import Path
from statistics import median
import sys
root = Path(sys.argv[1]) if len(sys.argv) > 1 else Path(__file__).parent
labels = ['other and JSON decode', 'snapshot row staging', 'replacement row traversal and bookkeeping',
          'word key validation and encoding', 'ordinary key validation and encoding',
          'word bulk-buffer insertion', 'ordinary bulk-buffer insertion',
          'word bulk sort/page construction', 'ordinary bulk sort/page construction',
          'delivery publication', 'durable change construction (commit)']
result = {}
for account in ['u0001', 'u0500']:
    path = root / f'browser-profile-{account}.json'
    samples = json.loads(path.read_bytes() if path.exists() else gzip.decompress(path.with_suffix('.json.gz').read_bytes()))
    for mode in ['default', 'worker']:
        selected = [s for s in samples if s['mode'] == mode]
        calls = [[c for c in s['profile']['calls'] if c['op'] == 'apply'] for s in selected]
        phases = [[sum(c['phases']['ms'][i] for c in cs) for i in range(len(labels))] for cs in calls]
        apply = [sum(c['ms'] for c in cs) for cs in calls]
        row = {'applyMs': median(apply), 'phaseMedianMs': {name: median(p[i] for p in phases) for i, name in enumerate(labels)},
               'phaseSamplesMs': phases, 'applySamplesMs': apply, 'load1': [s['host']['load'][0] for s in selected]}
        for name, indices in [('word', [3, 5, 7]), ('ordinary', [4, 6, 8]), ('rowsPublication', [0, 1, 2, 9, 10])]:
            row[name + 'Ms'] = median(sum(p[i] for i in indices) for p in phases)
            row[name + 'Share'] = median(sum(p[i] for i in indices) / t for p, t in zip(phases, apply))
        result[account + '/' + mode] = row
(root / 'phase-summary.json').write_text(json.dumps(result, indent=2) + '\n')

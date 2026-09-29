#!/usr/bin/env python3
"""Repeat the clean-workspace, warm-cache install comparison from snapback4/."""
from pathlib import Path
import json, subprocess, tempfile, time

root = Path.cwd()
base = 'd08c43ed6a'
manifest_paths = ['package.json', 'bun.lock', 'bunfig.toml'] + [
    str(p) for area in ['packages', 'apps'] for p in Path(area).glob('*/package.json')
]
trials = Path(tempfile.mkdtemp(prefix='hv-round4-installs-', dir=root / 'target'))
records = []
for i in range(3):
    for variant in (['baseline', 'pinned'] if i % 2 == 0 else ['pinned', 'baseline']):
        dest = trials / f'{i}-{variant}'
        dest.mkdir()
        for name in manifest_paths:
            p = dest / name
            p.parent.mkdir(parents=True, exist_ok=True)
            data = subprocess.check_output(['git', 'show', base + ':snapback4/' + name]) if name in ['package.json', 'bun.lock'] and variant == 'baseline' else (root / name).read_bytes()
            p.write_bytes(data)
        start = time.monotonic()
        with (trials / f'{i}-{variant}.log').open('wb') as log:
            result = subprocess.run(['bun', 'install', '--frozen-lockfile'], cwd=dest, stdout=log, stderr=subprocess.STDOUT)
        wall = time.monotonic() - start
        assert result.returncode == 0, (variant, result.returncode)
        size = int(subprocess.check_output(['du', '-sb', str(dest / 'node_modules')]).split()[0])
        disk = int(subprocess.check_output(['du', '-sB1', str(dest / 'node_modules')]).split()[0])
        records.append(dict(round=i, variant=variant, wallSeconds=wall, apparentBytes=size, diskBytes=disk))
        (trials / 'install-measurements.json').write_text(json.dumps(records, indent=2) + '\n')
        print(records[-1], flush=True)
print('Evidence:', trials)

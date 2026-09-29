#!/usr/bin/env python3
"""Paired cold browser repetitions. Run from snapback4, with a private server."""
import json
import os
from pathlib import Path
import subprocess
import sys

url, output, before, after = sys.argv[1:]
out = Path(output).resolve()
out.mkdir(parents=True, exist_ok=True)
browser = Path(__file__).with_name('browser.mjs').resolve()
for account, diagnostic in [('u0500', False), ('u0500', True), ('u0001', True)]:
    tag = account + ('-phases' if diagnostic else '-timing')
    results = {'before': [], 'after': []}
    for run in range(5):
        for variant in (['before', 'after'] if run % 2 == 0 else ['after', 'before']):
            label = f'{tag}-{run}-{variant}'
            env = {**os.environ, 'AQ_ACCOUNT': account,
                   'AQ_MODES': 'worker' if account == 'u0001' else ('default,worker' if run % 2 == 0 else 'worker,default'),
                   'AQ_DIAGNOSTIC': '1' if diagnostic else '0'}
            with (out / f'{label}.log').open('w') as log:
                result = subprocess.run(['node', str(browser), url, str(out / f'{label}.json'), before if variant == 'before' else after, '1'],
                                        env=env, stdout=log, stderr=subprocess.STDOUT)
            if result.returncode:
                print(f'FAIL {label}: exit {result.returncode}', flush=True)
                raise SystemExit(result.returncode)
            rows = json.loads((out / f'{label}.json').read_text())
            for row in rows:
                row['run'] = run
                results[variant].append(row)
            (out / f'{tag}-{variant}.json').write_text(json.dumps(results[variant], indent=2))
            print(label, [(row['mode'], round(row['acquiredMs'], 1)) for row in rows], flush=True)

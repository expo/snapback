"""Replay the three compiler corrections against the entire builder program."""
from pathlib import Path
import json
import subprocess

p = Path(__file__).resolve().parent
bins = {'published': p / '.work/published/node_modules/snapback4-linux-x64/snapback4',
        'main': p.parents[1] / 'target/debug/snapback4'}
records = []
for version, binary in bins.items():
    for name in ['aggregate-explicit-sync', 'aggregate-narrow-read', 'digest-query']:
        run = subprocess.run([str(binary), 'check', '--json'],
                             cwd=p / '.work/diagnostics' / name, text=True, capture_output=True)
        (p / 'results' / f'{version}-{name}.json').write_text(run.stdout)
        records.append({'version': version, 'case': name, 'exit': run.returncode, 'stderr': run.stderr[:1000]})
(p / 'results/diagnostics.json').write_text(json.dumps(records, indent=2) + '\n')

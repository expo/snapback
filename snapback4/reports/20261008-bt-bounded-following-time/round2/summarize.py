#!/usr/bin/env python3
"""Require complete passes and extract every unchanged test's elapsed time."""
from pathlib import Path
import gzip
import json
import re
import statistics

ROOT = Path(__file__).resolve().parent
original = json.loads((ROOT.parent / 'timings.json').read_text())
previous = json.loads((ROOT.parent / 'round1/timings.json').read_text())


def run(label):
    path = ROOT / f'{label}.tap'
    tap = path.read_text() if path.exists() else gzip.decompress(path.with_suffix('.tap.gz').read_bytes()).decode()
    tests = [dict(name=name, seconds=float(duration) / 1000)
             for name, duration in re.findall(r'^ok \d+ - (.+)\n  ---\n  duration_ms: ([\d.]+)', tap, re.M)]
    summary = {key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|cancelled|skipped) (\d+)$', tap, re.M)}
    assert summary == {'tests': len(tests), 'pass': len(tests), 'fail': 0, 'cancelled': 0, 'skipped': 0}, label
    seconds = float(re.search(r'^# duration_ms ([\d.]+)', tap, re.M)[1]) / 1000
    return dict(file=f'{label}.tap.gz', tests=tests, seconds=seconds, summary=summary)


results, files = {}, []
lines = ['# Round-2 per-test timings', '',
         'Seconds from Node TAP, including setup and cleanup. Original and round-1 '
         'measurements are retained from the prior reports, not rerun here. Round 2 '
         'run 1 overlaps controls/regressions; runs 2 and 3 have no other test jobs '
         'from this lane. Shared-host measurements, not latency guarantees.', '']
for name, old in original.items():
    runs = [run(f'{name}-after-{i}') for i in range(1, 4)]
    before = old['before']
    round1 = previous[name]['round1']
    names = [test['name'] for test in before['tests']]
    for attempt in runs + round1:
        assert [test['name'] for test in attempt['tests']] == names, name
    old_median = statistics.median(attempt['seconds'] for attempt in round1)
    median = statistics.median(attempt['seconds'] for attempt in runs)
    files.append(dict(name=name, count=len(names), original_s=before['seconds'],
                      round1_median_s=old_median, round2_s=[attempt['seconds'] for attempt in runs], median_s=median))
    lines += [f'## {name}.test.mjs', '',
              '| Test | Original | Round 1 median | Round 2 / 1 | Round 2 / 2 | Round 2 / 3 |',
              '| --- | ---: | ---: | ---: | ---: | ---: |']
    values = [before['seconds'], old_median, *(attempt['seconds'] for attempt in runs)]
    lines.append('| **Whole file** | ' + ' | '.join(f'{value:.3f}' for value in values) + ' |')
    rows = []
    for index, test in enumerate(names):
        baseline = before['tests'][index]['seconds']
        prior = statistics.median(attempt['tests'][index]['seconds'] for attempt in round1)
        current = [attempt['tests'][index]['seconds'] for attempt in runs]
        rows.append(dict(name=test, original_s=baseline, round1_median_s=prior, round2_s=current))
        lines.append('| ' + test.replace('|', '\\|') + ' | ' + ' | '.join(f'{value:.3f}' for value in [baseline, prior, *current]) + ' |')
    results[name] = dict(files=[attempt['file'] for attempt in runs], tests=rows)
    lines.append('')
(ROOT / 'timings.json').write_text(json.dumps(results, indent=2) + '\n')
(ROOT / 'timing-summary.json').write_text(json.dumps(files, indent=2) + '\n')
(ROOT / 'TIMINGS.md').write_text('\n'.join(lines))
print(json.dumps(files, indent=2))

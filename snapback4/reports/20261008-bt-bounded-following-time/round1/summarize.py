#!/usr/bin/env python3
"""Extract all test/file durations; require identical test names and full passes."""
from pathlib import Path
import gzip
import json
import re
import statistics

ROOT = Path(__file__).resolve().parent
previous = json.loads((ROOT.parent / 'timings.json').read_text())


def read(path):
    return path.read_text() if path.exists() else gzip.decompress(path.with_suffix(path.suffix + '.gz').read_bytes()).decode()


def run(label):
    tap = read(ROOT / f'{label}.tap')
    tests = [dict(name=name, seconds=float(duration) / 1000)
             for name, duration in re.findall(r'^ok \d+ - (.+)\n  ---\n  duration_ms: ([\d.]+)', tap, re.M)]
    summary = {key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|cancelled|skipped) (\d+)$', tap, re.M)}
    assert summary == {'tests': len(tests), 'pass': len(tests), 'fail': 0, 'cancelled': 0, 'skipped': 0}, label
    return dict(file=f'{label}.tap.gz', tests=tests, seconds=float(re.search(r'^# duration_ms ([\d.]+)', tap, re.M)[1]) / 1000, summary=summary)


results, files = {}, []
lines = ['# Round-1 per-test timings', '',
         'Seconds from Node TAP, including setup and cleanup. Original and round-0 '
         'measurements are retained from the prior report, not rerun here. Round 1 '
         'run 1 overlaps controls/regressions; runs 2 and 3 have no other test jobs '
         'from this lane. Shared-host measurements, not latency guarantees.', '']
for name, old in previous.items():
    runs = [run(f'{name}-after-{i}') for i in range(1, 4)]
    names = [test['name'] for test in old['before']['tests']]
    for attempt in runs:
        assert [test['name'] for test in attempt['tests']] == names, name
    old_median = statistics.median(old[f'after-{i}']['seconds'] for i in range(1, 4))
    median = statistics.median(attempt['seconds'] for attempt in runs)
    files.append(dict(name=name, count=len(names), original_s=old['before']['seconds'],
                      round0_median_s=old_median, round1_s=[attempt['seconds'] for attempt in runs], median_s=median))
    prior = lambda result: {**result, 'file': '../' + result['file']}
    results[name] = dict(original=prior(old['before']), round0=[prior(old[f'after-{i}']) for i in range(1, 4)], round1=runs)
    lines += [f'## {name}.test.mjs', '',
              '| Test | Original | Round 0 median | Round 1 / 1 | Round 1 / 2 | Round 1 / 3 |',
              '| --- | ---: | ---: | ---: | ---: | ---: |']
    values = [old['before']['seconds'], old_median, *(attempt['seconds'] for attempt in runs)]
    lines.append('| **Whole file** | ' + ' | '.join(f'{value:.3f}' for value in values) + ' |')
    for index, test in enumerate(names):
        values = [old['before']['tests'][index]['seconds'], statistics.median(old[f'after-{i}']['tests'][index]['seconds'] for i in range(1, 4)), *(attempt['tests'][index]['seconds'] for attempt in runs)]
        lines.append('| ' + test.replace('|', '\\|') + ' | ' + ' | '.join(f'{value:.3f}' for value in values) + ' |')
    lines.append('')
(ROOT / 'timings.json').write_text(json.dumps(results, indent=2) + '\n')
(ROOT / 'timing-summary.json').write_text(json.dumps(files, indent=2) + '\n')
(ROOT / 'TIMINGS.md').write_text('\n'.join(lines))
print(json.dumps(files, indent=2))

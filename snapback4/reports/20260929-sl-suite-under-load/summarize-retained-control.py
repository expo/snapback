"""Extract an empty-publication episode through retained recovery from a trace.

Usage: python3 summarize-retained-control.py RUN OUTPUT.json
Reads existing evidence only. The raw log retains each complete timeline.
"""
import json
from pathlib import Path
import sys

report = Path(__file__).resolve().parent
run, output = sys.argv[1:]
windows = []
case = None
for line in (report / f'{run}.log').read_text().splitlines():
    if line.startswith('✖ repetition '):
        case = line.removeprefix('✖ ')
    marker = 'retained timeline: '
    if marker not in line:
        continue
    events = json.loads(line.split(marker, 1)[1])
    zero = next(i for i, e in enumerate(events)
                if e['event'] == 'publish' and e.get('detail', {}).get('rows') == 0)
    retained = next(i for i in range(zero + 1, len(events))
                    if events[i]['event'] == 'publish' and events[i].get('detail', {}).get('rows') == 25)
    assert case is not None, 'a failed case must identify its timeline'
    windows.append({
        'failure': len(windows) + 1, 'case': case, 'empty_index': zero,
        'leave': [e for e in events[:zero] if e['event'] in ('leave-begin', 'leave-committed')],
        'timeline': events[max(0, zero - 10):retained + 1],
    })
(report / output).write_text(json.dumps(windows, indent=2) + '\n')
print(f'{run}: {len(windows)} empty-publication episodes with retained recovery.')

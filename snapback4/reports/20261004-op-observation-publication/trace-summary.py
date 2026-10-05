#!/usr/bin/env python3
"""Summarize LU per-update events, keeping the longest idle repost's guard trace."""
import collections, json, sys
from pathlib import Path

source = Path(sys.argv[1])
rows, worst = [], None
with source.open() as f:
    for line in f:
        sample = json.loads(line)
        if sample['shape'] != 'repost' or sample['burners'] != 0:
            continue
        for viewer, view in enumerate(sample['views']):
            start = sample['commit']['at']
            evaluated = view['trial'].get('evaluated')
            published = view['trial']['published']
            events = [e for e in view['events'] if e['at'] >= start and e['at'] <= published]
            counts = collections.Counter(e['event'] for e in events if e['stage'] == 'op' and e.get('name') == 'home')
            row = dict(run=sample['run'], viewer=viewer, commit=start,
                       evaluated=evaluated-start if evaluated else None,
                       published=published-start, render=view['trial']['render']-start,
                       guards=dict(counts))
            rows.append(row)
            if worst is None or row['published'] > worst['sample']['published']:
                selected = [e for e in events if e['stage'] == 'op' and e.get('name', 'home') == 'home'
                            or e['stage'] in ['server-evaluated','published','render']
                            or e['stage'] == 'response' and e.get('path') in ['/changes','/sync','/q/home']]
                worst = {'sample': row, 'events': [{**e, 'at': round(e['at']-start, 3)} for e in selected]}
result = {'samples': rows, 'worst': worst}
out = source.with_suffix('.guards.json')
out.write_text(json.dumps(result, indent=2)+'\n')
print(out, json.dumps(worst['sample']))

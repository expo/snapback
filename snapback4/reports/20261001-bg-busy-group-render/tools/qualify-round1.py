#!/usr/bin/env python3
"""Check the retained final BG/LL traces and report CPU during measured sends."""
import gzip, json, math, os
from pathlib import Path

root = Path(__file__).resolve().parents[1] / os.environ.get('BG_ROUND', 'round1')

def read(name):
    path = root / (name + '.json')
    if path.exists():
        return json.loads(path.read_text())
    return json.loads(gzip.decompress(path.with_suffix('.json.gz').read_bytes()))

def stats(values):
    values = sorted(values)
    assert values
    return {'n': len(values), 'p50': values[math.ceil(len(values) * .5) - 1],
            'p95': values[math.ceil(len(values) * .95) - 1], 'max': values[-1]}

results = {}
for condition in ['idle', 'loaded']:
    name = 'qualification-' + condition
    assert (root / (name + '.exit')).read_text().strip() == '0'
    trace, summary = read(name), read(name + '-summary')
    metadata = trace['metadata']
    assert metadata['profile'] == 'production'
    for key, expected in [('members', 50), ('messages', 10000), ('viewers', 3),
                          ('runs', 50), ('mountedWindow', 20), ('acquisitionWindow', 500)]:
        assert metadata[key] == expected, key
    assert len(trace['samples']) == 50
    assert all(len(sample['views']) == 2 and all(view['trial']['reactCommit'] for view in sample['views']) for sample in trace['samples'])
    assert 'BROWSER ' not in trace['errors']
    assert summary['stages']['live_count_rows'] == {'n': 100, 'p50': 0, 'p95': 0, 'max': 0}
    assert all(view['history_window'] == 20 for sample in summary['samples'] for view in sample['views'])
    # Every active device receives every measured send's notification. The
    # continuous trace includes notifications arriving after a render window.
    assert len(trace['allEvents']) == 3
    for events in trace['allEvents']:
        for sample in trace['samples']:
            assert any(e['stage'] == 'response' and e.get('path') == '/changes'
                       and e.get('seq', -1) >= sample['commit']['seq']
                       and e['at'] >= sample['commit']['at'] for e in events)
    samples = summary['samples']
    start = min(v['at']['send'] for s in samples for v in s['views']) / 1000
    end = max(v['at']['react'] for s in samples for v in s['views']) / 1000
    log = []
    for line in (root / (name + '.log')).read_text().splitlines():
        if line.startswith('{'):
            log.append(json.loads(line))
    utilization = stats([entry['cpu_busy_percent'] for entry in log
                         if start <= entry.get('host_sample', 0) <= end])
    if condition == 'idle':
        assert summary['stages']['send_slowest_remote_render_ms']['p95'] < 250
    else:
        workers = next(entry['workers'] for entry in log if 'workers' in entry)
        assert workers == log[0]['host_affinity_cpus'] == 96
        assert next(entry['reaped'] for entry in log if 'reaped' in entry) == workers
    results[condition] = {'sends': 50, 'remote_renders': 100, 'notifications': 150,
                          'send_render_ms': summary['stages']['send_slowest_remote_render_ms'],
                          'history_rows_recertified': 0, 'cpu_busy_percent_during_sends': utilization}
assert (root / 'll-final.exit').read_text().strip() == '0'
flows = read('ll-final-summary')['flows']
assert len(flows) == 8 and all(flow['runs'] == 20 and flow['timeouts'] == 0 for flow in flows.values())
results['ll'] = {'flows': 8, 'samples': 160, 'timeouts': 0,
                 'once_photo_commit_render_ms': flows['once-photo']['commitToReact']}
results['passed'] = True
(root / 'qualification-final.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results, indent=2))

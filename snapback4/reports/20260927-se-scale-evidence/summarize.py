"""Summarize retained paired samples; no interpolation across different corpora."""
from pathlib import Path
import gzip
import json
import math
import statistics

ROOT = Path(__file__).resolve().parent


def read(path):
    if not path.exists():
        return json.loads(gzip.decompress(path.with_suffix(path.suffix + '.gz').read_bytes()))
    return json.loads(path.read_text())


def p(values, percentile=95):
    return sorted(values)[math.ceil(len(values) * percentile / 100) - 1]


def distribution(values):
    return {'p50': p(values, 50), 'p95': p(values), 'p99': p(values, 99), 'max': max(values)}


def cpu_stat(host):
    return {row.split()[0]: list(map(int, row.split()[1:9])) for row in host['stat']}


summary = {}
for condition in ['quiet', 'cpu', 'writes']:
    data = read(ROOT / f'{condition}-samples.json')
    samples = [s for s in data['samples'] if not s['warmup']]
    result = {'metadata': data['metadata'], 'measuredSamples': len(samples), 'probes': {}}
    host_path = ROOT / f'{condition}-host.jsonl'
    text = host_path.read_text() if host_path.exists() else gzip.decompress(host_path.with_suffix('.jsonl.gz').read_bytes()).decode()
    hosts = [json.loads(line) for line in text.splitlines()]
    result['hostLoad1'] = {'min': min(h['load'][0] for h in hosts), 'max': max(h['load'][0] for h in hosts)}
    busy = []
    affinity = data['metadata']['affinity'].split(',')
    for before, after in zip(hosts, hosts[1:]):
        a, b = cpu_stat(before), cpu_stat(after)
        delta = [sum(b[f'cpu{cpu}'][i] - a[f'cpu{cpu}'][i] for cpu in affinity) for i in range(8)]
        busy.append(100 * (sum(delta) - delta[3] - delta[4]) / sum(delta))
    result['assignedCpuBusyPercent'] = distribution(busy)
    result['bursts'] = data['bursts']
    for probe in sorted({s['probe'] for s in samples}):
        rows = [s for s in samples if s['probe'] == probe]
        metrics = {'n': len(rows)}
        for name in ['builderClient', 'client', 'total', 'wait', 'engine', 'cpu']:
            metrics[name] = distribution([s[name] if name in ['client', 'builderClient'] else s['server'][name] for s in rows])
        metrics['pairedServerMinusCpu'] = distribution([s['server']['total'] - s['server']['cpu'] for s in rows])
        metrics['pairedClientMinusServer'] = distribution([s['client'] - s['server']['total'] for s in rows])
        metrics['slowest'] = sorted(rows, key=lambda s: s['builderClient'], reverse=True)[:5]
        checkpoints = []
        for r in range(data['metadata']['rounds']):
            group = [s for s in rows if s['round'] == r]
            checkpoints.append(p([s['builderClient'] for s in group]))
        metrics['roundP95s'] = checkpoints
        if condition != 'writes':
            # Same-corpus negative control, NOT a 10/50/100% growth curve.
            triples = [checkpoints[i:i+3] for i in range(0, len(checkpoints) - 2, 3)]
            metrics['sameCorpusMidpointControl'] = {
                'triples': triples, 'failed': sum(b > a + (c-a)*4/9 for a, b, c in triples), 'n': len(triples)}
        result['probes'][probe] = metrics
    summary[condition] = result

(ROOT / 'summary.json').write_text(json.dumps(summary, indent=2) + '\n')
for condition, result in summary.items():
    print(condition, 'load', result['hostLoad1'], 'assigned busy', result['assignedCpuBusyPercent'])
    for probe in ['following500', 'globalSearch', 'trending']:
        row = result['probes'][probe]
        print(probe, {name: round(row[name]['p95'], 3) for name in ['builderClient', 'total', 'wait', 'engine', 'cpu']})

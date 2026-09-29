#!/usr/bin/env python3
"""Summarize retained samples; medians are independent column statistics."""
import collections
import gzip
import json
from pathlib import Path
import re
import statistics
import sys

root = Path(sys.argv[1])
summary = {}
for file in sorted(root.glob('u*-*.json*')):
    if file.suffix == '.gz' and file.with_suffix('').exists():
        continue
    name = file.name.removesuffix('.gz').removesuffix('.json')
    if re.search(r'-\d+-', file.name):
        continue
    samples = json.loads(gzip.decompress(file.read_bytes()) if file.suffix == '.gz' else file.read_bytes())
    for mode in sorted({s['mode'] for s in samples}):
        rows = []
        for s in samples:
            if s['mode'] != mode:
                continue
            p = s.get('profile') or {}
            origin = s['origin']
            end = s['start'] + s['acquiredMs']
            offset = p.get('origin', origin) - origin
            within = lambda c: s['start'] <= c['at'] + offset < end
            calls = [c for c in p.get('calls', []) if within(c)]
            saves = [c for c in p.get('saves', []) if within(c)]
            txs = [c for c in p.get('transactions', []) if within(c)]
            bulk = [c for c in saves if c['changes'] > 1000]
            bulk_txs = [t for t in txs if t['mode'] == 'readwrite' and any(c['at'] <= t['at'] < c['at'] + c['ms'] for c in bulk)]
            wire = s['wire'][:len(s['responseStats'])]
            server = collections.Counter()
            for w in wire:
                for key, ms in re.findall(r'(\w+);dur=([\d.]+)', w['serverTiming'] or ''):
                    server[key] += float(ms)
            requests = [r for r in s['requests'] if r['path'] == '/sync' and r['at'] < end]
            rows.append({
                'run': s['run'], 'acquiredMs': s['acquiredMs'], 'firstScreenMs': s.get('firstScreenMs'),
                'load1': s['host']['load'][0], 'load5': s['host']['load'][1],
                'logicalBytes': s['residency']['totalBytes'], 'wasmHeapBytes': s['residency']['wasmHeapBytes'],
                'rows': sum(s['counts'].values()), 'wireBytes': sum(w['bytes'] for w in wire), 'syncRequests': len(wire),
                'completedApiRequests': sum(r['at'] + r['headersMs'] <= end for r in s['requests']),
                'completedScreenRequests': sum(r['path'] == '/q/chat.inbox' and r['at'] + r['headersMs'] <= end for r in s['requests']),
                'serverTotalMs': server['total'], 'serverEngineMs': server['engine'], 'serverCpuMs': server['cpu'],
                'serverPreparationMs': server['total'] - server['engine'] - server['wait'],
                'requestHeadersMs': sum(r['headersMs'] for r in requests),
                'bodyReadMs': sum(r.get('bodyReadMs', 0) for r in requests),
                'jsonDecodeMs': sum(r.get('decodeMs', 0) for r in requests),
                'wireBodyMs': sum(max(0, w['timing']['responseEnd'] - w['timing']['responseStart']) for w in wire),
                'wasmApplyMs': sum(c['ms'] for c in calls if c['op'] == 'apply'),
                'wasmDrainMs': sum(c['ms'] for c in calls if c['op'] in ['drain','drain_chunk']),
                'otherWasmMs': sum(c['ms'] for c in calls if c['op'] not in ['apply', 'drain', 'drain_chunk']),
                'saveMs': sum(c['ms'] for c in saves), 'saves': len(saves),
                'transactions': len(txs), 'strictTransactions': sum(t['mode'] == 'readwrite' and t['durability'] == 'strict' for t in txs),
                'idbReads': sum(t['gets'] for t in txs), 'idbPuts': sum(t['puts'] for t in txs),
                'idbDeletes': sum(t['deletes'] for t in txs),
                'bulkSaveMs': sum(c['ms'] for c in bulk), 'bulkTransactions': len(bulk_txs),
                'bulkReads': sum(t['gets'] for t in bulk_txs), 'bulkPuts': sum(t['puts'] for t in bulk_txs),
                'pageCharsWritten': sum(v.get('pageChars',0) for t in bulk_txs for v in t['sizes']),
                'pagePuts': sum(v.get('store') == 'pages' for t in bulk_txs for v in t['sizes']),
                'pageKeyPuts': sum(v.get('store') == 'page-keys' for t in bulk_txs for v in t['sizes']),
                'bucketCharsWritten': sum(v['chars'] for t in bulk_txs for v in t['sizes'] if v.get('s') == '$bucket'),
                'longestPageTaskMs': max([t['ms'] for t in s['tasks'] if t['at'] < end and t['at'] + t['ms'] > s['start']] or [0]),
                'verification': s['verification'],
            })
            if not s['diagnostic']:
                for key in ['bodyReadMs','jsonDecodeMs','wasmApplyMs','wasmDrainMs','otherWasmMs','saveMs','saves','transactions','strictTransactions','idbReads','idbPuts','idbDeletes','bulkSaveMs','bulkTransactions','bulkReads','bulkPuts','bucketCharsWritten','pageCharsWritten','pagePuts','pageKeyPuts']:
                    rows[-1][key] = None
        medians = {k: statistics.median(values) if (values := [r[k] for r in rows if r[k] is not None]) else None for k in rows[0] if k not in ['verification','run']}
        summary[name + '-' + mode] = {'samples': rows, 'median': medians,
            'rangeMs': [min(r['acquiredMs'] for r in rows), max(r['acquiredMs'] for r in rows)]}
        print(name, mode, json.dumps(medians))
(root / 'summary.json').write_text(json.dumps(summary, indent=2))

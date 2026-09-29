#!/usr/bin/env python3
"""Summarize allocator phases without copying the private captured rows."""
import json
import gzip
from pathlib import Path
import sys
capture, log = map(Path, sys.argv[1:])
commands = [json.loads(c)['op'] for c in json.loads(capture.read_text())['commands']]
result, host = {}, None
lines = gzip.decompress(log.read_bytes()).decode() if log.suffix == '.gz' else log.read_text()
for line in lines.splitlines():
    if not line.startswith('{'):
        continue
    p = json.loads(line)
    if 'peak' not in p:
        continue
    label = p.get('phase','')
    if label in ['memory-open','sqlite-open']:
        host = label.split('-')[0]
        result[host] = {'inputAndHarness':p['start'],'peak':0,'retained':0,'applyMs':0,'drainMs':0,'allocated':0,'apply':[]}
    if not host:
        continue
    r = result[host]
    r['peak'] = max(r['peak'],p['peak'])
    r['retained'] = p['retained']
    if label.startswith('call-') and commands[int(label.split('-')[1])] == 'apply':
        r['applyMs'] += p['ms'];r['allocated'] += p['allocated'];r['apply'].append(p)
    elif label.startswith('drain-'):
        r['drainMs'] += p['ms']
for r in result.values():
    r['incrementalPeak'] = r['peak'] - r['inputAndHarness']
    r['incrementalRetained'] = r['retained'] - r['inputAndHarness']
print(json.dumps(result,indent=2))

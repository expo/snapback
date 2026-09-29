#!/usr/bin/env python3
"""Inclusive and exclusive sampled functions, cropped to acquisition."""
import collections
import gzip
import json
from pathlib import Path
import sys

root = Path(sys.argv[1])
result = {}
for variant in ['before', 'after']:
    path = root / f'{variant}.json.default.0.cpuprofile'
    profile = json.loads(path.read_bytes() if path.exists() else gzip.decompress(path.with_name(path.name + '.gz').read_bytes()))
    window = json.loads((root / f'{variant}.json.default.0.window.json').read_text())
    nodes = {node['id']: node for node in profile['nodes']}
    parents = {child: node['id'] for node in profile['nodes'] for child in node.get('children', [])}
    inclusive, exclusive = collections.Counter(), collections.Counter()
    tick = profile['startTime']
    for sample, duration in zip(profile['samples'], profile['timeDeltas']):
        previous, tick = tick, tick + duration
        duration = max(0, min(tick, window['to']) - max(previous, window['from'])) / 1000
        if not duration:
            continue
        names, current = set(), sample
        while current in nodes:
            names.add(nodes[current]['callFrame']['functionName'])
            current = parents.get(current)
        exclusive[nodes[sample]['callFrame']['functionName']] += duration
        for name in names:
            inclusive[name] += duration
    result[variant] = {'inclusive': inclusive.most_common(60), 'exclusive': exclusive.most_common(60)}
print(json.dumps(result, indent=2))

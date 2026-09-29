#!/usr/bin/env python3
"""Sampled CPU attribution, cropped to acquisition using Chrome TimeTicks.

Use AQ_PROFILE=1 AQ_MODES=default and wasm built with
CARGO_PROFILE_WASM_STRIP=false. Sampling and inlining prevent exact accounting;
the wasm/apply wall timer in the ordinary phase witness is authoritative.
"""
from collections import defaultdict
import json
from pathlib import Path
import statistics
import sys

root = Path(sys.argv[1])
out = {}
for variant in ['before', 'after']:
    rows = []
    for path in sorted(root.glob(f'{variant}.json.default.*.cpuprofile')):
        profile = json.loads(path.read_text())
        window = json.loads(path.with_suffix('.window.json').read_text())
        nodes = {node['id']: node for node in profile['nodes']}
        parents = {child: node['id'] for node in profile['nodes'] for child in node.get('children', [])}
        totals = defaultdict(float)
        tick = profile['startTime']
        for sample, duration in zip(profile['samples'], profile['timeDeltas']):
            previous, tick = tick, tick + duration
            duration = max(0, min(tick, window['to']) - max(previous, window['from']))
            if not duration:
                continue
            stack, current = [], sample
            while current in nodes:
                stack.append(nodes[current]['callFrame'])
                current = parents.get(current)
            name = '\n'.join(frame['functionName'] for frame in stack)
            wasm = any(frame['url'].startswith('wasm:') for frame in stack)
            if not wasm:
                category = 'non-wasm / idle'
            elif '::boundary::' in name:
                category = 'coverage'
            elif '::set_entry' in name or 'stored_index_keys' in name or ('Rows>::put' in name and '::key::' in name):
                category = 'row and index construction'
            elif '::snapshot::stage' in name:
                category = 'staging other'
            elif '::replace_rows' in name:
                category = 'publication other'
            elif 'DeviceTx>::commit' in name:
                category = 'commit encoding'
            elif 'WebDevice>::drain' in name:
                category = 'drain encoding'
            elif 'serde_json' in name:
                category = 'other wasm JSON encode/decode'
            else:
                category = 'other wasm'
            totals[category] += duration / 1000
        rows.append({'profile': path.name, 'host': window['host'], 'sampledMs': dict(totals)})
    categories = {key for row in rows for key in row['sampledMs']}
    out[variant] = {'samples': rows, 'medianMs': {
        key: statistics.median(row['sampledMs'].get(key, 0) for row in rows) for key in sorted(categories)
    }}
print(json.dumps(out, indent=2))

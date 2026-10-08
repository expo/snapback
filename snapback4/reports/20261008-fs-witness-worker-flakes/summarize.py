#!/usr/bin/env python3
"""Summarize retained raw runs without converting known failures into passes."""
from pathlib import Path
import collections
import gzip
import hashlib
import json
import re

report = Path(__file__).resolve().parent
root = report.parents[1]
summary = {}
for path in sorted(report.glob('*/summary.json')):
    stage = json.loads(path.read_text())
    failures = collections.Counter()
    results = []
    for log in sorted(path.parent.glob('*.log.gz')):
        text = gzip.open(log, 'rt').read()
        # Each isolated child has another libtest result; only the final one
        # describes the outer inventory. Keep the raw nested output as evidence.
        result = re.findall(r'^test result: .+$', text, re.M)
        if result:
            results.append(result[-1])
        for name in set(re.findall(r'^test (\S+) \.\.\. FAILED$', text, re.M)):
            failures[name] += 1
    stage['failures_by_case'] = dict(failures)
    stage['outer_rust_results'] = dict(collections.Counter(results))
    summary[path.parent.name] = stage
(report/'evidence.json').write_text(json.dumps(summary, indent=2)+'\n')
paths = [root/'target/fs-final/debug/snapback4', root/'target/fs-final/debug/deps/fs-unit',
         root/'packages/snapback4/test/worker-regressions.test.mjs', root/'packages/snapback4/test/supervised-workers.test.mjs',
         root/'crates/snapback4/src/verbs/witness.rs',
         *sorted((root/'crates/snapback4/src/verbs/witness').glob('*.rs'))]
(report/'final-sha256.txt').write_text(''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(root)}\n' for p in paths))
for label, stage in summary.items():
    counts = collections.Counter(str(r['status']) for r in stage['results'])
    print(label, dict(counts), stage['failures_by_case'])

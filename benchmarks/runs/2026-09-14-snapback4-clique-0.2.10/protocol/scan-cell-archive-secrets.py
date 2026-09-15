#!/usr/bin/env python3
"""Scoped credential-pattern scan; findings are hashes/locations, never literals."""
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path('/Users/ccheever/projects/snapback-lanebriefs')
ARCHIVE = Path('/Users/ccheever/projects/snapback-relaxed-record/benchmarks/runs/2026-09-14-snapback4-clique-0.2.10')
PATTERNS = {
    'private-key': rb'-----BEGIN [^-]*PRIVATE KEY-----',
    'sk-token': rb'\bsk-[A-Za-z0-9_-]{20,}',
    'jwt': rb'\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}',
    'credential-literal': rb'''(?i)(?:password|passwd|api[_-]?key|client[_-]?secret)\s*["']?\s*[:=]\s*["'`][^"'`\r\n]{1,180}["'`]''',
    'bearer-literal': rb'''(?i)bearer\s+[^\s"'`<>]{1,220}''',
}


def main():
    files, findings = [], []
    for path in sorted(ARCHIVE.rglob('*')):
        if not path.is_file():
            continue
        assert not path.is_symlink(), str(path)
        data = path.read_bytes()
        name = str(path.relative_to(ARCHIVE))
        files.append({'path': name, 'bytes': len(data), 'sha256': hashlib.sha256(data).hexdigest()})
        for category, pattern in PATTERNS.items():
            for match in re.finditer(pattern, data):
                findings.append({'path': name, 'line': data[:match.start()].count(b'\n') + 1,
                                 'category': category, 'matchBytes': len(match.group()),
                                 'matchSha256': hashlib.sha256(match.group()).hexdigest()})
    result = {'observedAt': datetime.now(timezone.utc).isoformat(), 'archive': str(ARCHIVE),
              'files': files, 'findings': findings,
              'patterns': {name: p.decode() for name, p in PATTERNS.items()},
              'toolSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
              'limits': 'Scoped pattern scan of the listed bytes only. Match locations/hashes require manual classification; no automatic claim that all credentials are absent. No matched literal is emitted. Files added or changed afterward require a separate observation.'}
    out = ROOT / ('cell-archive-secret-scan-' + datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%S') + '.json')
    with out.open('x') as f:
        json.dump(result, f, indent=2)
        f.write('\n')
    print(json.dumps({'receipt': str(out), 'files': len(files), 'bytes': sum(x['bytes'] for x in files), 'findings': findings}, indent=2))


if __name__ == '__main__':
    main()

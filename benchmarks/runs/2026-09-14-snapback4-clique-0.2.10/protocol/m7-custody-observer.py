#!/usr/bin/env python3
"""Passively retain changing M7 JSON evidence and source hashes outside the packet.

No process signals, app requests, grading, or packet writes. Sensitive-looking
JSON is hashed only. Stable, parseable versions are observations, not verdicts.
"""
import argparse
import hashlib
import json
import os
import re
import time
from datetime import datetime, timezone
from pathlib import Path

PACKET = Path('/Users/ccheever/clique-sb4-20260913-relaxed-3models')
ROOT = Path('/Users/ccheever/projects/snapback-lanebriefs')
EXCLUDED = {'node_modules', '.git', '.expo', '.snapback4', 'dist', 'build',
            'stores', 'store', 'grading', 'instrument'}
SECRET_NAME = re.compile(r'(?i)secret|credential|password|passwd|\.env|token')
SECRET_KEY = re.compile(r'(?i)password|passwd|secret|token|authorization|api.?key|credential')
TOKEN = re.compile(rb'-----BEGIN [^-]*PRIVATE KEY-----|\bsk-[A-Za-z0-9_-]{20,}|\beyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}')


def stamp():
    return datetime.now(timezone.utc).isoformat()


def files(base, suffixes):
    if not base.is_dir() or base.is_symlink():
        return
    for folder, dirs, names in os.walk(base, followlinks=False):
        dirs[:] = sorted(n for n in dirs if n not in EXCLUDED
                         and not SECRET_NAME.search(n)
                         and not (Path(folder) / n).is_symlink())
        for name in sorted(names):
            p = Path(folder) / name
            if p.suffix in suffixes and not p.is_symlink() and not SECRET_NAME.search(name):
                yield p


def sensitive(value):
    if isinstance(value, dict):
        return any((SECRET_KEY.search(str(k)) and v not in [None, '', False, 0, [], {}])
                   or sensitive(v) for k, v in value.items())
    return isinstance(value, list) and any(sensitive(v) for v in value)


def stable_bytes(path):
    before = path.stat()
    data = path.read_bytes()
    after = path.stat()
    if (before.st_mtime_ns, before.st_size) != (after.st_mtime_ns, after.st_size):
        return None
    return data, {'mtimeNs': after.st_mtime_ns, 'bytes': len(data),
                  'sha256': hashlib.sha256(data).hexdigest()}


def root_files(lane, suffixes):
    for p in sorted(lane.iterdir()):
        if p.is_file() and not p.is_symlink() and p.suffix in suffixes and not SECRET_NAME.search(p.name):
            yield p


def evidence_files(lane):
    # Builders also write receipts-all*.jsonl and suite-status*.json at root.
    # Root app configuration is source custody, not evidence to copy.
    evidence_name = re.compile(r'(?i)receipt|suite-status|coverage|snapshot|migration|performance|milestone|run-record|correction|native-artifact|setup-identity')
    for p in root_files(lane, {'.json', '.jsonl'}):
        if evidence_name.search(p.name):
            yield p
    for name in ['m7', 'evidence', 'receipts', 'acceptance', 'coverage']:
        yield from files(lane / name, {'.json', '.jsonl'})


def source_files(lane):
    suffixes = {'.q', '.ts', '.tsx', '.js', '.mjs', '.cjs', '.json', '.md', '.swift'}
    for name in ['app', 'src', 'lib', 'snapback', 'schema', 'scripts', 'config',
                 'choreography', 'scaffold', 'ui', 'ui-kit', 'packages', 'm7']:
        yield from files(lane / name, suffixes)
    for p in root_files(lane, suffixes):
        if p.name in {'package.json', 'package-lock.json', 'app.json', 'tsconfig.json', 'babel.config.js'}:
            yield p


def observe(wave):
    lane = PACKET / 'lanes' / f'{wave}-snapback4'
    out = ROOT / 'cell-custody-0.2.10' / wave / 'm7-observer'
    start_path = PACKET / 'logs' / f'{wave}-snapback4.m7.start.json'
    end_path = PACKET / 'logs' / f'{wave}-snapback4.m7.end.json'
    assert not end_path.exists(), 'M7 already ended; do not claim a live observer'
    out.mkdir(parents=True, exist_ok=False)
    (out / 'objects').mkdir()
    (out / 'source-versions').mkdir()
    began = time.monotonic()
    start = {'observedAt': stamp(), 'pid': os.getpid(), 'lane': wave,
             'phaseAlreadyStarted': start_path.exists(), 'pollSeconds': 2,
             'deadlineSeconds': 18000, 'observerSha256': hashlib.sha256(Path(__file__).read_bytes()).hexdigest(),
             'method': 'Stable JSON/JSONL versions copied by hash; sensitive-looking evidence hashed only. '
                       'Source contents hashed only, never copied. Original paths preserved in events. '
                       'This is a passive observer, not a snapshot exporter, verifier or grader.'}
    (out / 'start.json').write_text(json.dumps(start, indent=2) + '\n')
    seen = {}
    last_sources = None
    with (out / 'events.jsonl').open('x') as events:
        while True:
            at = stamp()
            for p in evidence_files(lane):
                try:
                    stat = p.stat()
                    signature = (stat.st_mtime_ns, stat.st_size)
                    rel = str(p.relative_to(lane))
                    if seen.get(rel) == signature:
                        continue
                    pair = stable_bytes(p)
                    if pair is None:
                        continue
                    data, identity = pair
                    decoded = data.decode('utf-8')
                    records = ([json.loads(line) for line in decoded.splitlines() if line.strip()]
                               if p.suffix == '.jsonl' else [json.loads(decoded)])
                    if p.suffix == '.jsonl' and not data.endswith(b'\n'):
                        continue
                    private = bool(TOKEN.search(data)) or sensitive(records)
                    dest = out / 'objects' / identity['sha256']
                    if not private and not dest.exists():
                        dest.write_bytes(data)
                    event = {'observedAt': at, 'path': rel, **identity,
                             'copied': not private,
                             'object': None if private else str(dest.relative_to(out)),
                             'reason': 'sensitive-looking JSON; hash only' if private else 'stable parseable version'}
                    events.write(json.dumps(event) + '\n')
                    seen[rel] = signature
                except (FileNotFoundError, UnicodeDecodeError, json.JSONDecodeError):
                    continue
            sources = {}
            for p in source_files(lane):
                try:
                    pair = stable_bytes(p)
                    if pair:
                        sources[str(p.relative_to(lane))] = pair[1]
                except FileNotFoundError:
                    continue
            identity = hashlib.sha256(json.dumps(sources, sort_keys=True).encode()).hexdigest()
            if identity != last_sources:
                (out / 'source-versions' / f'{identity}.json').write_text(json.dumps({'observedAt': at, 'sources': sources}, indent=2) + '\n')
                events.write(json.dumps({'observedAt': at, 'kind': 'source-hashes', 'manifest': f'source-versions/{identity}.json'}) + '\n')
                last_sources = identity
            events.flush()
            if end_path.exists() or time.monotonic() - began >= 18000:
                break
            time.sleep(2)
    ended = {'observedAt': stamp(), 'pid': os.getpid(),
             'reason': 'phase-end-present' if end_path.exists() else 'observer-deadline',
             'wallSeconds': round(time.monotonic() - began, 3),
             'phaseEnd': json.loads(end_path.read_text()) if end_path.exists() else None}
    (out / 'end.json').write_text(json.dumps(ended, indent=2) + '\n')
    print(json.dumps(ended))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('wave', choices=['astra', 'grok', 'muse'])
    observe(parser.parse_args().wave)

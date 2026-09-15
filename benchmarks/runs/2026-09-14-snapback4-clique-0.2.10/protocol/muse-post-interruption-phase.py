#!/usr/bin/env python3
"""Run a Muse postphase with one qualified builder-tail exception.

The original runner and its lifecycle files stay intact. Only its builder
completion expression is substituted in memory. No other completed() call,
model, prompt, command, port check, phase ordering gate or lock changes.
"""
import argparse
import ast
import datetime
import hashlib
import json
import os
import sys
import time
from pathlib import Path

BASE = Path('/Users/ccheever/projects/snapback-lanebriefs')
PACKET = Path('/Users/ccheever/clique-sb4-20260913-relaxed-3models')
QUALIFICATION = BASE / 'muse-builder-exception-qualification.json'
QUALIFICATION_SHA = '0a7dfc94696e5216cbe44f91e7c0c96a73a382505af3b81d25be585bf40dc6ea'
RUNNER = PACKET / 'scripts/run_phase.py'
BUILDER_END = PACKET / 'logs/muse-snapback4.end.json'
OLD = 'elif not completed(logs / f"{wave}-snapback4.end.json") or not (lane / "final-report.md").is_file():'
NEW = 'elif not _qualified_muse_builder(logs / f"{wave}-snapback4.end.json") or not (lane / "final-report.md").is_file():'


def digest(data):
    return hashlib.sha256(data).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def qualify():
    raw = QUALIFICATION.read_bytes()
    require(digest(raw) == QUALIFICATION_SHA, 'Qualification bytes changed')
    q = json.loads(raw)
    for name, expected in q['files'].items():
        data = Path(name).read_bytes()
        require(len(data) == expected['bytes'] and digest(data) == expected['sha256'], f'Qualified file changed: {name}')
    end = json.loads(BUILDER_END.read_text())
    start = json.loads((PACKET / 'logs/muse-snapback4.start.json').read_text())
    require(end['exitCode'] == 130 and end['pid'] == start['pid'] == 65229, 'Wrong builder exit or identity')
    require(end['phase'] == start['phase'] == 'builder', 'Wrong lifecycle phase')
    require(end['lane'] == start['lane'] == 'muse-snapback4', 'Wrong lifecycle lane')
    require(json.loads((PACKET / 'PACKAGE_PINS.json').read_text()) == {'snapback4': '0.2.10', 'snapback4-expo': '0.2.3', 'frozen': True}, 'Wrong frozen pins')
    intervention = json.loads((BASE / 'muse-tail-interruption-20260914.json').read_text())
    answers = intervention['publicCompletedAnswers']
    require(len(answers) == 3 and 'Lane complete.' in answers[0]['payload']['text'], 'Missing completed builder answer')
    require(all('server' in a['payload']['text'].lower() and 'complete' in a['payload']['text'].lower() for a in answers[1:]), 'Tail is not the qualified idle-server continuation')
    return q


def patched_source():
    source = RUNNER.read_text()
    require(source.count(OLD) == 1, 'Expected exactly one builder predicate')
    patched = source.replace(OLD, NEW, 1)
    require(patched.replace(NEW, OLD, 1) == source, 'Unexpected source change')
    before = ast.parse(source)
    after = ast.parse(patched)
    original_completed = next(n for n in before.body if isinstance(n, ast.FunctionDef) and n.name == 'completed')
    patched_completed = next(n for n in after.body if isinstance(n, ast.FunctionDef) and n.name == 'completed')
    require(ast.dump(original_completed) == ast.dump(patched_completed), 'Global completed() changed')
    return patched


def qualified_path(path):
    return path == BUILDER_END


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('phase', choices=['score', 'grade', 'm7'])
    parser.add_argument('--verify-only', action='store_true')
    args = parser.parse_args()
    qualify()
    source = patched_source()
    receipt = {'observedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'phase': args.phase, 'wave': 'muse', 'qualificationSha256': QUALIFICATION_SHA, 'originalRunnerSha256': digest(RUNNER.read_bytes()), 'inMemoryRunnerSha256': digest(source.encode()), 'helperSha256': digest(Path(__file__).read_bytes()), 'changedExpression': 'Only the Muse builder completion predicate; retained exit130 is not reclassified.', 'globalCompletedUnchanged': True, 'frozenRunnerModified': False, 'verifyOnly': args.verify_only}
    if args.verify_only:
        print(json.dumps(receipt, indent=2))
        return 0
    stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%S%fZ')
    stem = BASE / f'muse-{args.phase}-builder-exception-{stamp}'
    receipt.update({'pid': os.getpid(), 'argv': [str(RUNNER), args.phase, 'muse'], 'startedAt': datetime.datetime.now(datetime.timezone.utc).isoformat()})
    with Path(str(stem) + '.start.json').open('x') as f:
        json.dump(receipt, f, indent=2)
        f.write('\n')
    started = time.monotonic()
    code = 1
    try:
        sys.argv = [str(RUNNER), args.phase, 'muse']
        scope = {'__name__': '__main__', '__file__': str(RUNNER), '_qualified_muse_builder': qualified_path}
        exec(compile(source, str(RUNNER), 'exec'), scope)
        code = 0
    except SystemExit as exc:
        code = exc.code if isinstance(exc.code, int) else (0 if exc.code is None else 1)
        if isinstance(exc.code, str):
            print(exc.code, file=sys.stderr)
    finally:
        receipt.update({'endedAt': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'wallSeconds': time.monotonic() - started, 'exitCode': code, 'phaseLifecycle': {}})
        for suffix in ['start', 'end']:
            p = PACKET / 'logs' / f'muse-snapback4.{args.phase}.{suffix}.json'
            if p.exists():
                raw = p.read_bytes()
                receipt['phaseLifecycle'][suffix] = {'path': str(p), 'sha256': digest(raw), 'record': json.loads(raw)}
        with Path(str(stem) + '.end.json').open('x') as f:
            json.dump(receipt, f, indent=2)
            f.write('\n')
    return code


if __name__ == '__main__':
    raise SystemExit(main())

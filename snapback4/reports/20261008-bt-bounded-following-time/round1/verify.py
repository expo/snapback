#!/usr/bin/env python3
"""Run from snapback4/. Owned child processes only; never signals host processes."""
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
import json
import os
import re
import subprocess
import threading
import time

REPORT = Path('reports/20261008-bt-bounded-following-time/round1')
TEST = Path('packages/snapback4/test')
BYPASS = './reports/20261008-bt-bounded-following-time/custody-bypass.mjs'
LATE = './reports/20261008-bt-bounded-following-time/round1/late-publication.mjs'
FILES = ['bounded-following', 'retained-history', 'following-routing', 'client-lifecycle']
COUNTS = [39, 78, 4, 57]
records, lock = [], threading.Lock()


def run(label, files, count, *, pattern=None, loader=None, env=None, negative=False, slots=1):
    command = ['node']
    for path in loader or []:
        command += ['--import', path]
    command += ['--test', f'--test-concurrency={slots}', '--test-reporter=tap']
    if pattern:
        command += [f'--test-name-pattern={pattern}']
    command += [str(TEST / f'{name}.test.mjs') for name in files]
    started = time.monotonic()
    with (REPORT / f'{label}.tap').open('w') as output:
        result = subprocess.run(command, env={**os.environ, **(env or {})}, stdout=output, stderr=subprocess.STDOUT)
    tap = (REPORT / f'{label}.tap').read_text()
    summary = {key: int(value) for key, value in re.findall(r'^# (tests|pass|fail|cancelled|skipped) (\d+)$', tap, re.M)}
    valid = (result.returncode == int(negative) and summary.get('tests') == count
             and summary.get('fail') == (count if negative else 0)
             and summary.get('pass') == (0 if negative else count)
             and summary.get('cancelled') == 0 and summary.get('skipped') == 0)
    if negative:
        valid &= tap.count('code: \'ERR_ASSERTION\'') == count
        valid &= tap.count('settled while custody was held') == count
        if label.startswith('delayed-'):
            valid &= tap.count('# BT_EARLY_PUBLICATION ') == count
            valid &= tap.count('# BT_RELEASE_HOLD') == (count if env['BT_LATE_STAGE'] == 'apply' else 0)
    record = dict(label=label, command=command, env=env or {}, exit=result.returncode,
                  elapsed_s=time.monotonic() - started, summary=summary, expected_tests=count, valid=valid)
    with lock:
        records.append(record)
        (REPORT / 'run-results.json').write_text(json.dumps(records, indent=2) + '\n')
        print(json.dumps(record), flush=True)
    return valid


def measurement(repeat):
    ok = True
    for name, count in zip(FILES, COUNTS):
        disabled = dict(loader=[BYPASS, LATE], env={'BT_BYPASS_STAGE': 'disabled', 'BT_LATE_STAGE': 'disabled'}) if repeat == 1 else {}
        ok &= run(f'{name}-after-{repeat}', [name], count, **disabled)
    return ok


def mutations():
    ok = run('bypass-admission', FILES, 26, loader=[BYPASS], env={'BT_BYPASS_STAGE': 'admission'}, negative=True,
             pattern='owned-event fallback|rejected owned|unrelated held reads|unknown conditions|speculative profile|composed reads withhold|predicted post fences|online-only repost cards|response racing prediction|inbox floors|native query module|MQ speculative events|population growth|re-observation: pending')
    ok &= run('bypass-receipt', [FILES[0]], 9, loader=[BYPASS], env={'BT_BYPASS_STAGE': 'receipt'}, negative=True,
              pattern='unknown conditions|predicted post fences|online-only repost cards|inbox floors|native query module')
    for query, name, pattern in [('conditionalEventsHeld', FILES[0], 'owned-event fallback'),
                                  ('speculativePage', FILES[0], 'unrelated held reads'),
                                  ('conditionalOriginal', FILES[0], 'unknown conditions'),
                                  ('homePage', FILES[1], 'MQ speculative events')]:
        ok &= run(f'bypass-{query}', [name], 2, pattern=pattern, loader=[BYPASS],
                  env={'BT_BYPASS_STAGE': 'admission', 'BT_BYPASS_QUERY': query}, negative=True)
    for stage, query, name, pattern in [('post', 'ownedEvent', FILES[0], 'owned-event fallback'),
                                      ('post', 'homePage', FILES[1], 'MQ speculative events'),
                                      ('apply', 'conditionalHelper', FILES[0], 'unknown conditions')]:
        ok &= run(f'delayed-{stage}-{query}', [name], 2, pattern=pattern, loader=[LATE],
                  env={'BT_LATE_STAGE': stage, 'BT_LATE_QUERY': query}, negative=True)
    return ok


def regressions():
    files = sorted(path.name.removesuffix('.test.mjs') for path in TEST.glob('one-shot*.test.mjs'))
    ok = run('one-shot-regressions', files + ['query-dependencies', 'query-publication-session'], 378, slots=4)
    for repeat in range(1, 4):
        ok &= run(f'helper-regressions-{repeat}', ['custody-read'], 17)
    return ok


if __name__ == '__main__':
    # First measurement overlaps this lane's independent controls/regressions.
    # Later repeats have no other tests from this driver running on the host.
    with ThreadPoolExecutor(max_workers=3) as pool:
        futures = [pool.submit(measurement, 1), pool.submit(mutations), pool.submit(regressions)]
        ok = all([future.result() for future in futures])
    for repeat in [2, 3]:
        ok &= measurement(repeat)
    raise SystemExit(0 if ok else 1)

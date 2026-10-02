#!/usr/bin/env python3
"""Linux /proc sampling; report evidence, not a qualification gate.

Run from snapback4: profile.py BINARY PREFIX SOFT [libtest arguments...].
Child limit changes preserve the hard limit. Samples belong to the entire
process; use --test-threads=1 for per-test attribution without overlap.
"""
import collections
import hashlib
import json
import os
from pathlib import Path
import resource
import subprocess
import sys
import threading
import time

binary, prefix, soft, *args = sys.argv[1:]
prefix = Path(prefix)
soft = int(soft)
def limit():
    resource.setrlimit(resource.RLIMIT_NOFILE, (soft, resource.getrlimit(resource.RLIMIT_NOFILE)[1]))

start = time.monotonic()
digest = hashlib.sha256(Path(binary).read_bytes()).hexdigest()
child = subprocess.Popen([binary, '-Z', 'unstable-options', '--format=json', *args],
    env={**os.environ, 'RUSTC_BOOTSTRAP': '1'}, preexec_fn=limit,
    stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
active = set()
tests = {}
summary = {}
def output():
    with prefix.with_suffix('.log').open('w') as log:
        for line in child.stdout:
            log.write(line)
            log.flush()
            try:
                event = json.loads(line)
            except ValueError:
                continue
            if event.get('type') == 'test':
                name = event['name']
                if event['event'] == 'started':
                    tests[name] = {'peak_process_fds': 0}
                    active.add(name)
                else:
                    active.discard(name)
                    tests.setdefault(name, {})['result'] = event['event']
            elif event.get('type') == 'suite' and event.get('event') != 'started':
                summary.update(event)
thread = threading.Thread(target=output)
thread.start()
peak = 0
peak_targets = []
peak_active = []
timed_out = False
with prefix.with_suffix('.csv').open('w') as samples:
    samples.write('seconds,fds,threads,active_tests\n')
    while child.poll() is None:
        elapsed = time.monotonic() - start
        try:
            fds = list(Path(f'/proc/{child.pid}/fd').iterdir())
            count = len(fds)
            threads = len(os.listdir(f'/proc/{child.pid}/task'))
            names = active.copy()
            for name in names:
                tests[name]['peak_process_fds'] = max(tests[name]['peak_process_fds'], count)
            if count > peak:
                peak = count
                peak_active = sorted(names)
                peak_targets = []
                for fd in fds:
                    try:
                        peak_targets.append(os.readlink(fd))
                    except OSError:
                        pass
            samples.write(f'{elapsed:.3f},{count},{threads},{len(names)}\n')
        except (OSError, ProcessLookupError):
            pass
        if elapsed > 180:
            timed_out = True
            child.kill()
            break
        time.sleep(0.01)
child.wait()
thread.join()
result = dict(binary=binary, sha256=digest,
    soft=soft, hard=resource.getrlimit(resource.RLIMIT_NOFILE)[1], args=args,
    exit=child.returncode, timed_out=timed_out, seconds=round(time.monotonic()-start, 3),
    peak_fds=peak, peak_active_tests=peak_active,
    peak_fd_targets=dict(collections.Counter(peak_targets)), summary=summary, tests=tests)
prefix.with_suffix('.json').write_text(json.dumps(result, indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items() if k not in ['peak_fd_targets','tests','peak_active_tests']}), flush=True)

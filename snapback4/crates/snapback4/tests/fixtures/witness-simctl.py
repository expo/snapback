#!/usr/bin/python3
"""Fake simctl for the Rust driver tests. No simulator access or native claim."""
import json
import os
from pathlib import Path
import signal
import sys
import time

root = Path(os.environ['WITNESS_TEST_DIR'])
mode = os.environ['WITNESS_TEST_MODE']
udid = os.environ.get('WITNESS_TEST_UDID', 'dedicated')
a = sys.argv[1:]
assert a[0] == 'simctl'
a = a[1:]
if a[0] == 'list':
    devices = [{'udid': udid, 'state': 'Booted'}]
    if mode == 'ambiguous':
        devices.append({'udid': 'someone-else', 'state': 'Booted'})
    print(json.dumps({'devices': {'com.apple.CoreSimulator.SimRuntime.iOS-26-5': devices}}))
elif a[0] == 'get_app_container':
    if mode == 'missing':
        print('No such app', file=sys.stderr)
        sys.exit(1)
    print(root / a[-1])
elif a[0] == 'terminate':
    with (root / 'process-events.jsonl').open('a') as f:
        f.write(json.dumps({'terminate': a[-1]}) + '\n')
    (root / 'app-pid').unlink(missing_ok=True)
elif a[0] == 'launch':
    assert a[1:] in [['--terminate-running-process', udid, 'dev.test'], [udid, 'dev.test']]
    count = int((root / 'launch-count').read_text()) + 1 if (root / 'launch-count').exists() else 1
    (root / 'launch-count').write_text(str(count))
    pid = 7000 + count
    (root / 'app-pid').write_text(str(pid))
    with (root / 'process-events.jsonl').open('a') as f:
        f.write(json.dumps({'launch': pid, 'args': a}) + '\n')
    print('dev.test: ' + str(pid), flush=True)
    print('launch-stderr-' + str(count), file=sys.stderr, flush=True)
    config = json.loads(os.environ['SIMCTL_CHILD_SNAPBACK4_WITNESS'])
    folder = root / 'data/Documents/.snapback4-witness' / config['run']
    receipt = folder / 'receipts.jsonl'
    def emit(step):
        with receipt.open('a') as f:
            f.write(json.dumps({'own': {'keep': True}, 'witness': {'at': '2026-09-14T00:00:00.000Z', 'step': step}}) + '\n')
    if config['segment'] == 'prime':
        emit('primed')
    elif mode == 'json':
        with receipt.open('a') as f:
            f.write('not JSON\n')
    elif mode == 'timeout':
        pass
    elif mode == 'relaunch' and 'relaunch' not in receipt.read_text():
        emit('relaunch')
    else:
        emit('offline-done')
        if mode == 'failed-batch':
            emit('check:failed')
        if mode == 'envelope':
            with receipt.open('a') as f:
                f.write('{"witness":{"step":"between-steps"}}\n')
        if mode == 'out-of-order':
            emit('done')
        else:
            # Only the fake log-capture child reports done after the signal.
            # No detached background process is left by this fixture.
            (root / 'waiting').write_text(str(folder))
elif a[0] == 'io':
    if mode != 'empty-video':
        Path(a[-1]).write_bytes(b'fake video for process tests only')
    print('Recording started', file=sys.stderr, flush=True)
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
    while True:
        time.sleep(.05)
elif a[0] == 'spawn' and a[2:] == ['launchctl', 'list']:
    print('PID\tStatus\tLabel')
    pid = (root / 'app-pid').read_text() if (root / 'app-pid').exists() else ('6999' if mode == 'running' else '-')
    print(pid + '\t0\tUIKitApplication:dev.test[fixture]')
elif a[0] == 'spawn' and a[2:4] == ['kill', '-TERM']:
    pid = int(a[4])
    with (root / 'process-events.jsonl').open('a') as f:
        f.write(json.dumps({'terminate': pid}) + '\n')
    assert int((root / 'app-pid').read_text()) == pid
    (root / 'app-pid').unlink()
elif a[0] == 'spawn':
    def finish(*_):
        if (root / 'waiting').exists():
            folder = Path((root / 'waiting').read_text())
            step = {'failed-after-done': 'check:failed', 'reordered-after-done': 'primed', 'step-after-done': 'history:running'}.get(mode)
            if step:
                with (folder / 'receipts.jsonl').open('a') as f:
                    f.write(json.dumps({'witness': {'at': '2026-09-14T00:00:02.000Z', 'step': step}}) + '\n')
            if mode in ['normal', 'relaunch']:
                with (folder / 'receipts.jsonl').open('a') as f:
                    f.write(json.dumps({'app': 'after done', 'witness': {'at': '2026-09-14T00:00:02.000Z', 'step': 'between-steps'}}) + '\n')
            if mode == 'replacement':
                (root / 'app-pid').write_text('9999')
        sys.exit(0)
    signal.signal(signal.SIGINT, finish)
    print('{"fake-device-log":true}', flush=True)
    emitted = False
    while True:
        if (root / 'waiting').exists() and not emitted:
            folder = Path((root / 'waiting').read_text())
            if (folder / 'reconnect').exists():
                with (folder / 'receipts.jsonl').open('a') as f:
                    f.write('{"witness":{"at":"2026-09-14T00:00:01.000Z","step":"done"}}\n')
                emitted = True
        time.sleep(.05)
else:
    raise RuntimeError(a)

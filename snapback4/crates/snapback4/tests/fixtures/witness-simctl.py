#!/usr/bin/python3
"""Fake simctl for the Rust driver tests. No simulator access or native claim."""
import json
import os
from pathlib import Path
import signal
import socket
import sqlite3
import sys
import time

root = Path(os.environ['WITNESS_TEST_DIR'])
mode = os.environ['WITNESS_TEST_MODE']
udid = os.environ.get('WITNESS_TEST_UDID', 'dedicated')
a = sys.argv[1:]
if a == ['--sdk', 'iphonesimulator', '--show-sdk-version']:
    print('27.0')
    sys.exit(0)
assert a[0] == 'simctl'
a = a[1:]
with (root / 'simctl-calls.jsonl').open('a') as f:
    f.write(json.dumps(a) + '\n')
if a[0] == 'list':
    if mode == 'timeout-prepare':
        # Withhold readiness until the driver times out and reaps us.
        while True:
            signal.pause()
    if mode == 'no-xcode':
        print('tool noise that must not reach the user', file=sys.stderr)
        sys.exit(1)
    runtime = 'com.apple.CoreSimulator.SimRuntime.iOS-26-5'
    kind = {'identifier': 'com.apple.CoreSimulator.SimDeviceType.iPhone-17', 'productFamily': 'iPhone'}
    kinds = [dict(kind, identifier='com.apple.CoreSimulator.SimDeviceType.iPhone-' + model)
             for model in os.environ.get('WITNESS_TEST_DEVICE_TYPES', '17,11').split(',')]
    if a[1] == 'runtimes':
        runtimes = [{'identifier': runtime, 'version': '26.5', 'isAvailable': True, 'supportedDeviceTypes': kinds}]
        if mode.startswith('auto-create') or mode == 'reuse-order':
            runtimes += [{'identifier': 'com.apple.CoreSimulator.SimRuntime.iOS-9-3', 'version': '9.3', 'isAvailable': True},
                         {'identifier': 'com.apple.CoreSimulator.SimRuntime.iOS-99', 'version': '99', 'isAvailable': False}]
        if mode == 'reuse-order':
            runtimes.append({'identifier': 'com.apple.CoreSimulator.SimRuntime.iOS-18-0', 'version': '18.0', 'isAvailable': True})
        print(json.dumps({'runtimes': [] if mode == 'no-runtime' else runtimes}))
    elif a[1] == 'devicetypes':
        # Keep the older-device-last control; invert only Air cases so their
        # runtime order must win over this independent global list.
        print(json.dumps({'devicetypes': list(reversed(kinds)) if any(t['identifier'].endswith('iPhone-Air') for t in kinds) else kinds}))
    else:
        devices = [{'udid': os.environ.get('WITNESS_TEST_PRIOR_UDID', udid), 'name': os.environ.get('SNAPBACK4_SMOKE_DEVICE_PREFIX', 'snapback4-smoke-') + 'prior', 'state': 'Booted', 'isAvailable': True}]
        if mode.startswith('auto-create'):
            devices[0]['state'] = 'Shutdown'
            devices += [{'udid': 'unavailable', 'name': 'snapback4-smoke-unavailable', 'state': 'Booted', 'isAvailable': False}]
        devices += [{'udid': 'someone-else', 'name': 'mini-verify-iphone', 'state': 'Booted', 'isAvailable': True},
                    {'udid': 'near-prefix', 'name': 'other-snapback4-smoke-not-ours', 'state': 'Booted', 'isAvailable': True}]
        groups = {runtime: devices}
        if mode == 'reuse-order':
            # Lexically 18 < 26 < 9, numerically 26 > 18 > 9.
            groups['com.apple.CoreSimulator.SimRuntime.iOS-18-0'] = [dict(devices[0], udid='owned-18')]
            groups['com.apple.CoreSimulator.SimRuntime.iOS-9-3'] = [dict(devices[0], udid='owned-old')]
        print(json.dumps({'devices': groups}))
elif a[0] == 'create':
    assert a[1].startswith(os.environ.get('SNAPBACK4_SMOKE_DEVICE_PREFIX', 'snapback4-smoke-'))
    assert a[3] == 'com.apple.CoreSimulator.SimRuntime.iOS-26-5'
    print(udid)
elif a[0] in ['boot', 'bootstatus']:
    assert a[1] == udid
    if mode == 'auto-create-' + a[0] + '-fails':
        sys.exit(1)
elif a[0] == 'getenv':
    assert a == ['getenv', udid, 'HOME']
    print(root / 'data')
elif a[0] == 'get_app_container':
    if mode == 'port-custody' and not (root / '.snapback4/store.sqlite').exists():
        try:
            with socket.socket() as contender:
                contender.bind(('127.0.0.1', int(os.environ['WITNESS_TEST_PORT'])))
                (root / 'port-stolen').write_text('bound')
        except OSError:
            pass
    if mode == 'missing':
        print('No such app', file=sys.stderr)
        sys.exit(1)
    print(root / a[-1])
elif a[0] == 'terminate':
    # Record which instance a terminate stops, as the real simulator would.
    pid = int((root / 'app-pid').read_text()) if (root / 'app-pid').exists() else None
    with (root / 'process-events.jsonl').open('a') as f:
        f.write(json.dumps({'terminate': pid}) + '\n')
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
    if mode in ['scene-exit', 'scene-exit-after-prime']:
        if mode == 'scene-exit-after-prime':
            emit('primed')
        reports = root / 'Library/Logs/DiagnosticReports'
        reports.mkdir(parents=True)
        (reports / 'App.ips').write_text(json.dumps({'bundleID': 'dev.test'}) + '\n' + json.dumps({
            'pid': pid, 'procPath': '/CoreSimulator/Devices/' + udid + '/data/App', 'faultingThread': 0,
            'threads': [{'frames': [{'symbol': '___UIApplicationEvaluateRuntimeIssueForNoSceneLifecycleAdoption_block_invoke'}]}]}))
        (root / 'app-pid').unlink()
        sys.exit(0)
    if config.get('smoke'):
        (root / 'smoke-folder').write_text(str(folder))
        segment = config['segment']
        with sqlite3.connect(root / '.snapback4/store.sqlite') as db:
            store_id = db.execute("SELECT value FROM _meta WHERE key='store_id'").fetchone()[0]
            watermark = db.execute('SELECT COALESCE(MAX(seq),0) FROM _commits').fetchone()[0]
        smoke = dict(segment=segment, pass_=True, rows={}, errors=[], acquired=True, backendRequired=False,
                     origin=config['origin'], viewer='dev:alice', storeId=store_id, generation=1, watermark=watermark,
                     link='offline' if segment == 'offline' else 'online', queries=[])
        smoke['pass'] = smoke.pop('pass_')
        smoke['queryFacts'] = config['queryFacts']
        smoke['queryGeneration'] = config['queryGeneration']
        for field in ['queryGeneration', 'generation']:
            if mode == 'smoke-wrong-' + field:
                smoke[field] = config['queryGeneration'] + 1
        smoke['queries'] = [dict(name=name, classification='online-only' if fact['runs']=='server' else 'device-answerable',
            **(dict(state='loading', expectation='online-only: unavailable offline (expected)') if fact['runs']=='server' and segment=='offline' else dict(state='ready', count=0)))
            for name, fact in config['queryFacts'].items() if segment=='offline' or fact['runs']=='server']
        if mode == 'smoke-wrong-origin':
            smoke['origin'] = 'http://127.0.0.1:1'
        if segment == 'restart':
            assert config['barrierSeq'] == watermark
            if mode == 'smoke-stale-restart':
                smoke['watermark'] = watermark - 1
        if mode == 'smoke-broken' and segment == 'offline':
            smoke['pass'] = False
            smoke['errors'] = [{'message': 'deliberate offline crash', 'fatal': True}]
        step = {'prime': 'primed', 'offline': 'offline-done', 'restart': 'done'}[segment]
        with receipt.open('a') as f:
            f.write(json.dumps({'smoke': smoke, 'witness': {'at': '2026-09-14T00:00:00.000Z', 'step': step + ':running'}}) + '\n')
        emit(step if smoke['pass'] else step + ':failed')
        if segment == 'prime':
            # A tail committed after prime's receipt can already be on disk at
            # restart. It must not substitute for consuming the later barrier.
            with sqlite3.connect(root / '.snapback4/store.sqlite') as db:
                db.execute("INSERT INTO _commits VALUES (?, 0, 'test-tail', 'system', 'witness', '[]', 0)", (watermark + 1,))
        if mode == 'smoke-crash-after-done-' + segment:
            (root / 'app-pid').unlink()
    elif config['segment'] == 'prime':
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
    if a[2] == 'screenshot':
        sys.exit(0)
    print('Recording started', file=sys.stderr, flush=True)
    signal.signal(signal.SIGINT, lambda *_: sys.exit(0))
    while True:
        time.sleep(.05)
elif a[0] == 'spawn' and a[2:] == ['launchctl', 'list']:
    if mode == 'smoke-source-race':
        count_file = root / 'stopped-checks'
        count = int(count_file.read_text()) + 1 if count_file.exists() else 1
        count_file.write_text(str(count))
        if count == 2:
            # After driver preparation, before it starts dev's compilation.
            schema = root / 'snapback/schema.q'
            schema.write_text(schema.read_text().replace("  public 'fixture'", "  read <- allow\n  online only"))
    print('PID\tStatus\tLabel')
    pid = (root / 'app-pid').read_text() if (root / 'app-pid').exists() else ('6999' if mode == 'running' else '-')
    print(pid + '\t0\tUIKitApplication:dev.test[fixture]')
elif a[0] == 'spawn' and a[2] == 'kill':
    # The iOS simulator runtime has no kill binary (observed natively 2026-09-14).
    print('An error was encountered processing the command (domain=NSPOSIXErrorDomain, code=2):', file=sys.stderr)
    print('No such file or directory', file=sys.stderr)
    sys.exit(1)
elif a[0] == 'spawn':
    def finish(*_):
        if mode == 'smoke-collected-generation' and (root / 'smoke-folder').exists():
            # All three launches validated genuine receipts. A later app receipt
            # must undergo the same generation check during final collection.
            receipt = Path((root / 'smoke-folder').read_text()) / 'receipts.jsonl'
            rows = [json.loads(line) for line in receipt.read_text().splitlines()]
            row = next(r for r in reversed(rows) if r.get('smoke', {}).get('segment') == 'restart')
            row['smoke']['queryGeneration'] += 1
            row['witness']['step'] = 'between-steps'
            with receipt.open('a') as f:
                f.write(json.dumps(row) + '\n')
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

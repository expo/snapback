#!/usr/bin/env python3
"""Run and bind the shared Release runtime baseline through NativeDriver.Bridge."""
import argparse
import base64
import fcntl
import hashlib
import json
import os
import plistlib
import signal
import shutil
import struct
import subprocess
import sys
import time
import uuid
from pathlib import Path

HERE = Path(__file__).resolve().parent
NATIVE = HERE.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(NATIVE / 'driver'))
from binding import compiled_inputs, expected_proof_inputs, inventory_digest
from run import Bridge, flush_observation_writer  # Exact generic driver transport used by measured runs.
from video import decoded_video

UDID = '3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B'
BUNDLE_ID = 'dev.clique.native.runtimebaseline'

def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def command(argv, **kwargs):
    result = subprocess.run(argv, capture_output=True, text=True, timeout=kwargs.pop('timeout', 60), **kwargs)
    if result.returncode:
        raise RuntimeError(f"command-exit:{result.returncode}:{argv[0]}:{result.stderr.strip()}")
    return result.stdout.strip()

def verify_build_inputs(work):
    receipt = json.loads((work / 'runtime-inputs.json').read_text())
    if receipt.get('schemaVersion') != 'clique-native-runtime-inputs.v1':
        raise RuntimeError('runtime-input-receipt-version')
    current = compiled_inputs()
    recorded = receipt.get('sourceFiles', {})
    for name, digest in current.items():
        if recorded.get(name) != digest: raise RuntimeError('runtime-built-source-drift:' + name)
    for name, digest in receipt.get('appFiles', {}).items():
        path = work / 'app' / name
        if not path.is_file() or sha(path) != digest: raise RuntimeError('runtime-app-input-drift:' + name)
    return {'schemaVersion': 'clique-native-runtime-compiled-inputs.v1',
            'compiledSourceFiles': current,
            'compiledSourceInventorySha256': inventory_digest(current),
            'appFiles': receipt['appFiles'],
            'originalReceiptSha256': sha(work / 'runtime-inputs.json')}

def nodes(tree):
    yield tree
    for child in tree.get('children', []): yield from nodes(child)

def snapshot(bridge, output, name):
    result = bridge.send('tree', screenshot=True)
    (output / f'{name}.json').write_text(json.dumps(result['tree'], indent=2) + '\n')
    (output / f'{name}.png').write_bytes(base64.b64decode(result['png']))
    return result['tree']

def wait_for(bridge, output, name, identifier, value=None, seconds=30, interruptions=None):
    deadline = time.monotonic() + seconds
    serial = 0
    while time.monotonic() < deadline:
        serial += 1
        tree = snapshot(bridge, output, f'{name}-poll-{serial:02d}')
        matches = [node for node in nodes(tree) if node.get('id') == identifier and
                   (value is None or node.get('value') == value)]
        if matches:
            (output / f'{name}.json').write_text(json.dumps(tree, indent=2) + '\n')
            return matches[0]
        # iOS may offer to save the test password after the form submits. This
        # is an OS-owned modal, so dismiss it through the same generic UI tree.
        flattened = list(nodes(tree))
        prompt = any(str(node.get('label', '')).startswith('Save Password') for node in flattened)
        dismiss = next((node for node in flattened
                        if node.get('id') and node.get('label') in {'Not Now', 'Never'}), None)
        if prompt or dismiss:
            action = dismiss['id'] if dismiss else 'Not Now'
            bridge.send('tap', selector={'id': action})
            if interruptions is not None: interruptions.append({'kind': 'password-save', 'action': action})
            continue
        if bridge.send('state')['state'] == 1: raise RuntimeError('application-exited-before:' + identifier)
        time.sleep(.25)
    raise RuntimeError('selector-timeout:' + identifier)

def entitlement_plist(raw):
    start = raw.find(b'<?xml'); end = raw.find(b'</plist>', start)
    if start < 0 or end < 0: return {}
    return plistlib.loads(raw[start:end + len(b'</plist>')])

def macho_section(binary, segment_name, section_name):
    """Read a section from the thin little-endian Mach-O produced for arm64."""
    raw = binary.read_bytes()
    if len(raw) < 32 or struct.unpack_from('<I', raw)[0] != 0xfeedfacf:
        raise RuntimeError('runtime-native-not-thin-arm64-mach-o')
    ncmds = struct.unpack_from('<I', raw, 16)[0]
    cursor = 32
    for _ in range(ncmds):
        if cursor + 8 > len(raw): raise RuntimeError('runtime-mach-o-load-command-truncated')
        command, size = struct.unpack_from('<II', raw, cursor)
        if size < 8 or cursor + size > len(raw): raise RuntimeError('runtime-mach-o-load-command-invalid')
        if command == 0x19:  # LC_SEGMENT_64
            segment = raw[cursor + 8:cursor + 24].split(b'\0', 1)[0].decode()
            sections = struct.unpack_from('<I', raw, cursor + 64)[0]
            section = cursor + 72
            for _ in range(sections):
                if section + 80 > cursor + size: raise RuntimeError('runtime-mach-o-section-truncated')
                name = raw[section:section + 16].split(b'\0', 1)[0].decode()
                owner = raw[section + 16:section + 32].split(b'\0', 1)[0].decode()
                length = struct.unpack_from('<Q', raw, section + 40)[0]
                offset = struct.unpack_from('<I', raw, section + 48)[0]
                if segment == segment_name and owner == segment_name and name == section_name:
                    if offset + length > len(raw): raise RuntimeError('runtime-mach-o-section-out-of-range')
                    return raw[offset:offset + length]
                section += 80
        cursor += size
    return b''

def signature(app, output):
    result = subprocess.run(['/usr/bin/codesign', '-d', '--entitlements', ':-', str(app)], capture_output=True)
    (output / 'codesign.stdout').write_bytes(result.stdout)
    (output / 'codesign.stderr').write_bytes(result.stderr)
    if result.returncode: raise RuntimeError('codesign-inspection-failed')
    signed = entitlement_plist(result.stdout + b'\n' + result.stderr)
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    binary = app / info['CFBundleExecutable']
    embedded_raw = macho_section(binary, '__TEXT', '__entitlements')
    embedded = entitlement_plist(embedded_raw.rstrip(b'\0'))
    (output / 'simulator-entitlements.raw').write_bytes(embedded_raw)
    entitlements = signed if signed.get('keychain-access-groups') else embedded
    carrier = 'code-signature' if entitlements is signed else 'xcode-simulator-mach-o'
    application = entitlements.get('application-identifier')
    groups = entitlements.get('keychain-access-groups', [])
    if not isinstance(application, str) or not application.endswith(BUNDLE_ID):
        raise RuntimeError('effective-application-identifier-missing')
    if not any(isinstance(group, str) and group.endswith(BUNDLE_ID) for group in groups):
        raise RuntimeError('effective-keychain-access-group-missing')
    (output / 'signed-entitlements.plist').write_bytes(plistlib.dumps(entitlements))
    return {'carrier': carrier, 'effective': entitlements, 'codeSignature': signed, 'simulatorMachO': embedded}

def stop_process(process, interrupt=False):
    if not process: return None
    if process.poll() is None:
        os.killpg(process.pid, signal.SIGINT if interrupt else signal.SIGTERM)
        try: process.wait(timeout=30)
        except subprocess.TimeoutExpired:
            os.killpg(process.pid, signal.SIGKILL); process.wait(timeout=10)
    return process.returncode

def absent_app(udid):
    return subprocess.run(['/usr/bin/xcrun', 'simctl', 'get_app_container', udid, BUNDLE_ID, 'app'],
                          capture_output=True).returncode != 0

def simulator_processes(udid, installed_app):
    info = plistlib.loads((installed_app / 'Info.plist').read_bytes())
    expected = str(installed_app / info['CFBundleExecutable'])
    if udid not in expected: raise RuntimeError('installed-executable-not-bound-to-dedicated-simulator')
    # Simulator application processes are visible in the macOS host process
    # table. The absolute container executable includes the dedicated UDID.
    argv = ['/bin/ps', '-wwaxo', 'pid=,comm=,args=']
    result = subprocess.run(argv, capture_output=True, text=True, timeout=10)
    matches = []
    if result.returncode == 0:
        for line in result.stdout.splitlines():
            fields = line.strip().split(None, 2)
            if len(fields) == 3 and fields[0].isdigit():
                if fields[2].split(None, 1)[0] == expected:
                    matches.append(int(fields[0]))
    return {'command': argv, 'exitCode': result.returncode, 'expectedExecutable': expected,
            'processIds': sorted(matches), 'stderr': result.stderr.strip()}

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--work', required=True, type=Path)
    parser.add_argument('--runner', required=True, type=Path)
    parser.add_argument('--out', required=True, type=Path)
    parser.add_argument('--udid', default=UDID)
    args = parser.parse_args()
    if args.udid != UDID: raise RuntimeError('dedicated-simulator-required')
    developer = '/Applications/Xcode.app/Contents/Developer'
    os.environ['DEVELOPER_DIR'] = developer
    os.environ['PATH'] = developer + '/usr/bin' + os.pathsep + os.environ.get('PATH', '')
    # xcodebuild strips TEST_RUNNER_ and forwards the unprefixed variables to
    # XCTest, so diagnostics launched inside the runner resolve pinned tools.
    os.environ['TEST_RUNNER_DEVELOPER_DIR'] = developer
    os.environ['TEST_RUNNER_PATH'] = os.environ['PATH']
    args.work = args.work.resolve(); args.runner = args.runner.resolve(); args.out = args.out.resolve()
    args.out.mkdir(parents=True, exist_ok=False)
    lease = open('/tmp/clique-native-' + args.udid + '.lock', 'a')
    try: fcntl.flock(lease, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError: raise RuntimeError('unavailable-simulator:leased') from None

    app = Path((args.work / 'runtime-app.path').read_text().strip()).resolve()
    if not app.is_dir() or not app.is_relative_to(args.work): raise RuntimeError('runtime-app-missing-or-unbound')
    runner = json.loads(args.runner.read_text())
    xctestrun = Path(runner['xctestrun']).resolve(); binary = Path(runner['binary']).resolve()
    if not xctestrun.is_file() or not binary.is_file(): raise RuntimeError('runner-missing')
    inputs = expected_proof_inputs()
    input_digest = inventory_digest(inputs)
    build_inputs = verify_build_inputs(args.work)
    (args.out / 'runtime-inputs.json').write_bytes((args.work / 'runtime-inputs.json').read_bytes())
    run_id = str(uuid.uuid4()); principal = 'runtime.' + run_id + '@example.com'
    bridge = None; test = None; recorder = None; test_log = None; video_log = None
    installed_app = None; container = None
    recorder_exit = None
    started = time.time(); checks = []; failure = None; ready = []; interruptions = []
    entitlements = signature(app, args.out)
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    native_sha = sha(app / info['CFBundleExecutable']); hermes_sha = sha(app / 'main.jsbundle')
    retained_app = args.out / 'built-app'; retained_app.mkdir()
    for name in ['Info.plist', info['CFBundleExecutable'], 'main.jsbundle']:
        shutil.copyfile(app / name, retained_app / name)
    try:
        if not absent_app(args.udid): raise RuntimeError('runtime-app-already-installed')
        command(['/usr/bin/xcrun', 'simctl', 'install', args.udid, str(app)])
        installed_app = Path(command(['/usr/bin/xcrun', 'simctl', 'get_app_container', args.udid, BUNDLE_ID, 'app']))
        container = Path(command(['/usr/bin/xcrun', 'simctl', 'get_app_container', args.udid, BUNDLE_ID, 'data']))
        bridge = Bridge(49492)
        video = args.out / 'runtime-launch-through-restore.mp4'
        video_log = (args.out / 'record-video.log').open('wb')
        recorder = subprocess.Popen(['/usr/bin/xcrun', 'simctl', 'io', args.udid, 'recordVideo',
                                     '--codec=h264', '--force', str(video)],
                                    stdout=subprocess.DEVNULL, stderr=video_log, start_new_session=True)
        test_log = (args.out / 'xctest.log').open('wb')
        test = subprocess.Popen(['/usr/bin/xcodebuild', 'test-without-building', '-xctestrun', str(xctestrun),
                                 '-resultBundlePath', str(args.out / 'runtime.xcresult'),
                                 '-destination', 'platform=iOS Simulator,id=' + args.udid,
                                 '-parallel-testing-enabled', 'NO', '-maximum-concurrent-test-simulator-destinations', '1',
                                 '-only-testing:CliqueDriver/NativeDriver/testCommands'],
                                stdout=test_log, stderr=subprocess.STDOUT, env=os.environ.copy(), start_new_session=True)
        bridge.send('attach', bundleId=BUNDLE_ID)
        if bridge.send('launch', args=['--clique-run', run_id]).get('state') != 4:
            raise RuntimeError('first-launch-not-foreground')
        checks.append('first-os-launch')
        wait_for(bridge, args.out, 'reset-ready', 'runtime-secure-reset', interruptions=interruptions)
        bridge.send('tap', selector={'id': 'runtime-secure-reset'})
        wait_for(bridge, args.out, 'auth-ready', 'sm-auth-email', interruptions=interruptions)
        checks.append('secure-store-reset-through-ui')
        bridge.send('type', selector={'id': 'sm-auth-email'}, text=principal)
        bridge.send('type', selector={'id': 'sm-auth-password'}, text='runtime-proof-only')
        bridge.send('tap', selector={'id': 'sm-auth-submit'})
        wait_for(bridge, args.out, 'secure-write-read', 'runtime-secure-write-read', principal,
                 interruptions=interruptions)
        checks.append('secure-store-write-read')
        request, ack = flush_observation_writer(container / 'Documents/clique-native' / run_id, run_id)
        (args.out / 'runtime-flush-1-request.json').write_text(json.dumps(request, indent=2) + '\n')
        (args.out / 'runtime-flush-1-ack.json').write_text(json.dumps(ack, indent=2) + '\n')
        bridge.send('terminate')
        if bridge.send('state')['state'] != 1: raise RuntimeError('first-process-survived')
        checks.append('first-process-terminated')
        if bridge.send('launch', args=['--clique-run', run_id]).get('state') != 4:
            raise RuntimeError('relaunch-not-foreground')
        wait_for(bridge, args.out, 'secure-restored', 'runtime-secure-restored', principal,
                 interruptions=interruptions)
        checks.append('secure-store-restored-after-relaunch')
        before_terminate = simulator_processes(args.udid, installed_app)
        terminal_state = {'before': before_terminate, 'termination': None, 'after': None}
        (args.out / 'terminal-process-state.json').write_text(json.dumps(terminal_state, indent=2) + '\n')
        if before_terminate['exitCode'] or not before_terminate['processIds']:
            raise RuntimeError('restored-process-not-found')
        request, ack = flush_observation_writer(container / 'Documents/clique-native' / run_id, run_id)
        (args.out / 'runtime-flush-2-request.json').write_text(json.dumps(request, indent=2) + '\n')
        (args.out / 'runtime-flush-2-ack.json').write_text(json.dumps(ack, indent=2) + '\n')
        terminated_at = time.time()
        command(['/usr/bin/xcrun', 'simctl', 'terminate', args.udid, BUNDLE_ID])
        time.sleep(.2)
        after_terminate = simulator_processes(args.udid, installed_app)
        terminal_state = {
            'before': before_terminate,
            'termination': {'command': ['/usr/bin/xcrun', 'simctl', 'terminate', args.udid, BUNDLE_ID],
                            'at': terminated_at},
            'after': after_terminate}
        (args.out / 'terminal-process-state.json').write_text(json.dumps(terminal_state, indent=2) + '\n')
        recorder_exit = stop_process(recorder, True); recorder = None
        if video_log: video_log.close(); video_log = None
        if after_terminate['exitCode'] or after_terminate['processIds']:
            raise RuntimeError('second-process-survived')
        checks.append('terminal-process-absent')
        journal = container / 'Documents/clique-native' / run_id / 'native-observations.jsonl'
        if not journal.is_file(): raise RuntimeError('helper-journal-missing')
        (args.out / 'native-observations.jsonl').write_bytes(journal.read_bytes())
        events = [json.loads(line) for line in journal.read_text().splitlines()]
        ready = [event for event in events if event.get('kind') == 'ready' and event.get('runId') == run_id and
                 event.get('payload', {}).get('principal') == principal]
        if len({event['processNonce'] for event in ready}) != 2:
            raise RuntimeError('helper-did-not-observe-both-processes')
        checks.append('helper-observed-both-processes')
    except BaseException as error:
        failure = error
    finally:
        if installed_app is not None and container is not None:
            state = simulator_processes(args.udid, installed_app)
            if state['processIds'] and bridge:
                try:
                    request, ack = flush_observation_writer(container / 'Documents/clique-native' / run_id, run_id)
                    (args.out / 'runtime-flush-cleanup-request.json').write_text(json.dumps(request, indent=2) + '\n')
                    (args.out / 'runtime-flush-cleanup-ack.json').write_text(json.dumps(ack, indent=2) + '\n')
                    bridge.send('terminate')
                except BaseException as cleanup_error:
                    if failure is None: failure = cleanup_error
        if bridge:
            try: bridge.send('stop')
            except BaseException: pass
        if test:
            try: test_exit = test.wait(timeout=30)
            except subprocess.TimeoutExpired: test_exit = stop_process(test)
        else: test_exit = None
        if test_log: test_log.close()
        if bridge: bridge.close()
        if recorder is not None: recorder_exit = stop_process(recorder, True)
        if video_log: video_log.close()
        state = simulator_processes(args.udid, installed_app) if installed_app is not None else {'processIds': []}
        if not state['processIds']:
            subprocess.run(['/usr/bin/xcrun', 'simctl', 'uninstall', args.udid, BUNDLE_ID], capture_output=True)
        cleanup = {'runnerExit': test_exit, 'recorderExit': recorder_exit, 'appAbsent': absent_app(args.udid)}
        (args.out / 'cleanup.json').write_text(json.dumps(cleanup, indent=2) + '\n')
        fcntl.flock(lease, fcntl.LOCK_UN); lease.close()

    try:
        if failure: raise failure
        if cleanup != {'runnerExit': 0, 'recorderExit': 0, 'appAbsent': True}:
            raise RuntimeError('runtime-cleanup-failed:' + json.dumps(cleanup, sort_keys=True))
        video_info = decoded_video(args.out / 'runtime-launch-through-restore.mp4')
        checks.append('launch-through-restore-video-decodes')
        xcode = command(['/usr/bin/xcodebuild', '-version'])
        sdk = command(['/usr/bin/xcrun', '--sdk', 'iphonesimulator', '--show-sdk-version'])
        if xcode != 'Xcode 27.0\nBuild version 27A266a' or not sdk.startswith('27.'):
            raise RuntimeError('pinned-apple-toolchain-required')
        evidence = {}
        for path in sorted(args.out.rglob('*')):
            if path.is_file() and path.name != 'runtime-proof.json' and 'runtime.xcresult' not in path.parts:
                evidence[str(path.relative_to(args.out))] = sha(path)
        result = {'schemaVersion': 'clique-native-runtime-proof.v1', 'pass': True,
                  'instrument': '0.4.0-native.2', 'expo': '57.0.22', 'reactNative': '0.86.3',
                  'expoSecureStore': '57.0.4', 'iosSdk': sdk, 'xcode': xcode,
                  'udid': args.udid, 'bundleId': BUNDLE_ID, 'runId': run_id, 'principal': principal,
                  'nativeSha256': native_sha, 'hermesSha256': hermes_sha,
                  'runnerBinarySha256': sha(binary), 'xctestrunSha256': sha(xctestrun),
                  'xcodeTestEnvironment': {'developerDir': developer, 'path': os.environ['PATH']},
                  'signedEntitlements': entitlements, 'inputInventorySha256': input_digest,
                  'inputFiles': inputs, 'buildInputs': build_inputs, 'evidenceFiles': evidence, 'video': video_info,
                  'checks': checks, 'readyProcessNonces': sorted({event['processNonce'] for event in ready}),
                  'cleanup': cleanup, 'startedAt': started, 'finishedAt': time.time()}
        result['systemInterruptions'] = interruptions
    except BaseException as error:
        result = {'schemaVersion': 'clique-native-runtime-proof.v1', 'pass': False,
                  'instrument': '0.4.0-native.2', 'runId': run_id, 'checks': checks,
                  'inputInventorySha256': input_digest, 'inputFiles': inputs,
                  'nativeSha256': native_sha, 'hermesSha256': hermes_sha,
                  'reason': f'{type(error).__name__}: {error}', 'cleanup': cleanup,
                  'startedAt': started, 'finishedAt': time.time()}
        (args.out / 'runtime-proof.json').write_text(json.dumps(result, indent=2) + '\n')
        raise
    (args.out / 'runtime-proof.json').write_text(json.dumps(result, indent=2) + '\n')
    print(json.dumps(result))

if __name__ == '__main__': main()

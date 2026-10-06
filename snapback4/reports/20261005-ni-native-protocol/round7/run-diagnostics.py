#!/usr/bin/env python3
"""Round 7 operator overlay. The revision-7 packet and instrument stay sealed.

Run with the packet root as the sole argument on the Apartment mini. Each
backend gets a fresh verified APFS copy; only its two seed body literals change.
This is a one-use diagnostic, never an admission or product retry mechanism.
"""
import difflib
import sys
import tempfile

sys.path.insert(0, str(__import__('pathlib').Path(sys.argv[1]) / 'scripts'))
from common import *
from verify import verify
from after import (relocate_work_links, static_admission, handoff_mapping, expand,
                   check_release_target, build_wrapper, app_hash, simulator_product,
                   bind_backend, verify_backend_evidence)
from audit import audit
from operator_inputs import execution_environment
import derived_data

LABEL = 'diagnostic: operator-patched seed body format; audit-refused; never admissible; no pass claimed'
NAME = 'diagnostic-round7-operator-patched-seed-setup-repair'


def diagnostic(backend):
    attempt = ROOT / 'results' / backend / NAME
    attempt.mkdir()
    started = time.time()
    summary = dict(label=LABEL, backend=backend, startedAt=started, segments={},
                   admissible=False, passClaimed=False, scoredUse=False,
                   nativeOutcome='handoff-refused-by-source-audit')
    put(attempt / 'DIAGNOSTIC.md', LABEL + '\n\nApplies to every artifact below and in the retained scratch tree. Raw driver and validator booleans are diagnostic observations only.\n')
    put(attempt / 'operator-source.py', Path(__file__).read_text())
    put(attempt / 'start.json', dict(at=started, pid=os.getpid(), packetSha256=sha(ROOT / 'PACKET.sha256'), label=LABEL))
    stage = 'custody'
    server = None
    setting = None
    setting_captured = False
    work = None
    try:
        free_ports(backend)
        custody = ROOT / 'attempts' / (backend + '-builder-completed')
        baseline = ROOT / 'results' / backend / 'attempt-01/custody.clone.json'
        if inventory(custody) != read(baseline):
            raise RuntimeError('custody-drift')
        scratch = Path(tempfile.mkdtemp(prefix='clique-round7-' + backend + '-', dir='/tmp'))
        work = scratch / 'app'
        clone(custody, work, attempt / 'work-copy')
        relocate_work_links(work, ROOT / 'lanes' / backend, attempt / 'work-link-relocations.json')
        put(attempt / 'scratch.json', dict(path=str(scratch), retained=True, label=LABEL))
        put(scratch / 'DIAGNOSTIC.md', LABEL + '\n')
        before = inventory(work)
        seed = work / 'scripts/native-seed.mjs'
        original = seed.read_text()
        old = { 'convex': "['First queued message '+input.runId,'Second queued message '+input.runId]",
                'snapback4': "['Native queued first '+input.runId,'Native queued second '+input.runId]" }[backend]
        replacement = "[input.runId+':first',input.runId+':second']"
        if original.count(old) != 1:
            raise RuntimeError('seed-patch-context-mismatch')
        changed = original.replace(old, replacement)
        seed.write_text(changed)
        after = inventory(work)
        delta = [p for p in set(before) | set(after) if before.get(p) != after.get(p)]
        if delta != ['scripts/native-seed.mjs']:
            raise RuntimeError('nonminimal-patch:' + repr(delta))
        put(attempt / 'seed-body-format.diff', ''.join(difflib.unified_diff(original.splitlines(True), changed.splitlines(True), fromfile='a/scripts/native-seed.mjs', tofile='b/scripts/native-seed.mjs')))
        put(attempt / 'seed-patch.json', dict(label=LABEL, changedPaths=delta,
            before=before[delta[0]], after=after[delta[0]],
            diffSha256=sha(attempt / 'seed-body-format.diff'), custodyManifest=str(baseline),
            custodyManifestSha256=sha(baseline)))
        # Preparation and driver inherit write denial on originals. Release
        # builds use the packet's normal execution environment: Expo's Swift
        # macros cannot create their own sandbox under an outer sandbox.
        protected = [ROOT / p for p in ('lanes', 'attempts', 'inputs', 'logs')]
        protected += [p for b in BACKENDS for p in (ROOT / 'results' / b).iterdir() if p != attempt]
        profile = scratch / 'protect-originals.sb'
        put(profile, '(version 1)\n(allow default)\n' + ''.join('(deny file-write* (subpath ' + json.dumps(str(p.resolve())) + '))\n' for p in protected))
        def native(argv):
            return ['/usr/bin/sandbox-exec', '-f', str(profile), *argv]
        handoff = read(work / 'native-operator.json')
        admission = static_admission(backend, work, scratch, attempt)
        put(attempt / 'static-admission.json', admission)
        if not admission['valid']:
            raise RuntimeError('static-admission-refused')
        env = execution_environment(backend)
        mapping = handoff_mapping(backend, work, scratch)
        build = expand(handoff, mapping)
        setting = derived_data.manifest_setting()
        setting_captured = True
        put(attempt / 'xcode-setting.json', dict(before=setting, label=LABEL))
        derived_data.set_manifest_setting(True)
        stage = 'prepare'
        run(native(build['prepareArgv']), work, attempt / 'prepare.log', env)
        put(attempt / 'prepared-inputs.json', inventory(work))
        stage = 'prepared-source-audit'
        try:
            audit(work, attempt, name='prepared-source-audit', gating=False, env=env)
        except Exception as error:
            put(attempt / 'prepared-source-audit-error.json', dict(error=str(error), gating=False, label=LABEL))
        stage = 'release-build'
        derived = scratch / 'DerivedData'
        app = Path(build['app'])
        if not app.is_absolute(): app = work / app
        check_release_target(build['buildArgv'], app, derived, build_wrapper(build['buildArgv'], work, derived))
        run(build['buildArgv'], work, attempt / 'release-build.log', env)
        identity = app_hash(app, mapping['BUNDLE_ID'])
        # Compare the three identity fields as a unit; platform metadata is
        # separate so it cannot make an equal installed binary appear changed.
        put(attempt / 'release-identity.json', dict(**identity, platform=simulator_product(app, derived)))
        runner = runner_config()
        python = str(ROOT / 'runtime/venv/bin/python')
        run(['xcrun', 'swiftc', str(NATIVE / 'driver/video.swift'), '-o', str(scratch / 'video-check')], work, attempt / 'video-decoder-build.log', env, timeout=90)
        with (attempt / 'web-server.log').open('xb') as log:
            server = subprocess.Popen(native(build['webArgv']), cwd=work, env=env, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
        put(attempt / 'web-server.json', dict(pid=server.pid, argv=build['webArgv'], at=time.time()))
        devices = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', 'available', '--json']))['devices']
        selected = [d for ds in devices.values() for d in ds if d['udid'] == UDID]
        if len(selected) != 1: raise RuntimeError('dedicated-simulator-unavailable')
        if selected[0]['state'] != 'Booted':
            run(['xcrun', 'simctl', 'boot', UDID], work, attempt / 'simulator-boot.log', env)
            run(['xcrun', 'simctl', 'bootstatus', UDID, '-b'], work, attempt / 'simulator-ready.log', env)
        for segment in ('m6', 'm8'):
            stage = segment
            seg = attempt / segment
            seg.mkdir()
            put(seg / 'DIAGNOSTIC.md', LABEL + '\n')
            store = scratch / (segment + '-store')
            store.mkdir()
            cfg = expand(build, dict(STORE=store, SEGMENT=segment, BACKEND_EVIDENCE=seg / 'backend-images.jsonl'))
            config = {key: cfg[key] for key in ('backendArgv', 'seedArgv', 'oracleArgv')}
            config.update(app=str(app), bundleId=mapping['BUNDLE_ID'], udid=UDID, origin=mapping['ORIGIN'], webOrigin=mapping['WEB_ORIGIN'], backendCwd=str(work), dataDirectory=str(store), ordinaryImage=str(work / cfg['ordinaryImage']), viewOnceImage=str(work / cfg['viewOnceImage']), videoCheckArgv=[str(scratch / 'video-check')], driverBinarySha256=sha(runner['binary']), runnerCwd=str(work), runnerArgv=['xcodebuild', 'test-without-building', '-xctestrun', runner['xctestrun'], '-resultBundlePath', str(seg / 'test.xcresult'), '-destination', 'platform=iOS Simulator,id=' + UDID, '-parallel-testing-enabled', 'NO', '-maximum-concurrent-test-simulator-destinations', '1', '-only-testing:CliqueDriver/NativeDriver/testCommands'], instrument=read(NATIVE / 'QUALIFIED.json')['instrument'])
            binding = bind_backend(backend, config['backendArgv'], store, mapping['ORIGIN'], seg / 'backend-images.jsonl')
            if binding: put(seg / 'backend-binding.json', binding)
            put(seg / 'operator.json', config)
            bundle = mapping['BUNDLE_ID']
            existing = subprocess.run(['xcrun', 'simctl', 'get_app_container', UDID, bundle, 'app'], capture_output=True)
            if existing.returncode == 0: raise RuntimeError('refuse-replacing-existing-app')
            row = dict(label=LABEL, admissible=False, passClaimed=False)
            summary['segments'][segment] = row
            try:
                with (seg / 'driver.log').open('xb') as log:
                    row['driverExit'] = subprocess.run(native([python, str(ROOT / 'scripts/driver-entry.py'), '--config', str(seg / 'operator.json'), '--segment', segment, '--out', str(seg / 'evidence')]), cwd=work, env=env, stdout=log, stderr=subprocess.STDOUT, timeout=1800).returncode
                status = seg / 'evidence/status.json'
                row['driverStatus'] = read(status) if status.exists() else None
                put(seg / 'driver-observed.json', row)
                validation = subprocess.run([python, str(NATIVE / 'driver/validate.py'), str(seg / 'evidence'), '--segment', segment], cwd=work, env=env, capture_output=True, text=True, timeout=300)
                put(seg / 'independent-validation.stdout', validation.stdout)
                put(seg / 'independent-validation.stderr', validation.stderr)
                row['validation'] = dict(exitCode=validation.returncode, **json.loads(validation.stdout))
                put(seg / 'independent-validation.json', row['validation'])
                if binding: put(seg / 'backend-image-check.json', verify_backend_evidence(seg / 'backend-images.jsonl', binding, require_restart=False))
            except Exception as error:
                row['error'] = str(error)
            finally:
                installed = subprocess.run(['xcrun', 'simctl', 'get_app_container', UDID, bundle, 'app'], capture_output=True, text=True)
                if installed.returncode == 0:
                    actual = app_hash(Path(installed.stdout.strip()), bundle)
                    put(seg / 'installed-identity.json', actual)
                    if actual != identity: raise RuntimeError('installed-app-changed')
                    data = subprocess.check_output(['xcrun', 'simctl', 'get_app_container', UDID, bundle, 'data'], text=True).strip()
                    run(['/bin/cp', '-cRp', data, str(scratch / (segment + '-app-data'))], work, seg / 'retain-app-data.log', env)
                    run(['xcrun', 'simctl', 'uninstall', UDID, bundle], work, seg / 'cleanup-install.log', env)
            put(seg / 'summary.json', row)
            free_ports(backend) if server.poll() is not None else None
        if app_hash(app, bundle) != identity: raise RuntimeError('built-app-changed')
        summary['outcome'] = 'diagnostic-completed'
    except BaseException as error:
        summary.update(outcome='diagnostic-incomplete', failureStage=stage, reason=str(error))
    finally:
        stop(server)
        if setting_captured:
            derived_data.set_manifest_setting(setting)
            put(attempt / 'xcode-setting-restored.json', dict(before=setting, restored=derived_data.manifest_setting() == setting))
        summary.update(endedAt=time.time(), operatorWallSeconds=time.time() - started, retainedScratch=str(work.parent) if work else None)
        put(attempt / 'summary.json', summary)
        put(attempt / 'custody-final.json', dict(unchanged=inventory(custody) == read(baseline), label=LABEL))
        # One directory-level label binds hash inventories without duplicating
        # the same long label hundreds of thousands of times.
        put(attempt / 'artifact-binding.json', dict(label=LABEL, artifacts=inventory(attempt), scratch=inventory(work.parent) if work else None))
    print(json.dumps(summary), flush=True)
    free_ports(backend)
    return summary


if __name__ == '__main__':
    host_check()
    verify(ready=True)
    lease = lock('authoring-or-operator.lock')
    try:
        # The driver independently holds the dedicated simulator lease.
        for backend in ('convex', 'snapback4'):
            diagnostic(backend)
        verify(ready=True)
    finally:
        lease.close()

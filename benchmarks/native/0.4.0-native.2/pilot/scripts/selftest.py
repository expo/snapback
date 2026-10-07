#!/usr/bin/env python3
"""Safety tests using temporary files and inert subprocesses; no builds/models."""
import json, os, plistlib, signal, subprocess, sys, tempfile, time, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch
import after, builder, chain, common, processes, restart, isolation, derived_data, reclassification, runtime_proof
import audit as source_audit
import operator_inputs, source_ruling, xcode_environment
import round5
from cleanup_selftest import CleanupSafety
from environment_selftest import EnvironmentSafety

def native_component_root():
    """Resolve fixtures in both the assembled packet and source checkout."""
    if common.NATIVE.is_dir():return common.NATIVE
    return Path(__file__).resolve().parents[2]

class Safety(unittest.TestCase):
    def test_product_resume_record_rejects_evidence_source_and_release_drift(self):
        import product_resume
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); old = root / product_resume.OLD; work = root / 'scratch/app'; work.mkdir(parents=True)
            (root / 'attempts').mkdir()
            failure = {'reason': 'selector-not-hittable', 'outcomeClass': 'setup', 'appState': {'state': 'foreground'}}
            common.put(old / 'summary.json', {'segments': {'m6': {'pass': None}}, 'cleanupComplete': True, 'cleanupErrors': []})
            common.put(old / 'm6/evidence/status.json', {'pass': None, 'reason': failure['reason']})
            common.put(old / 'm6/evidence/m6-ios-run.json', {'failure': failure})
            common.put(old / 'm6/independent-validation.json', {'exitCode': 0, 'valid': True, 'pass': None})
            for name in ('source-audit', 'prepared-source-audit'): common.put(old / name / 'review.json', {'ready': True})
            common.put(old / 'semantic-handoff/result.json', {'pass': True})
            common.put(old / 'scratch.json', {'path': str(work.parent)})
            identity = {'bundleId': 'app', 'nativeSha256': 'native', 'hermesSha256': 'hermes'}
            common.put(old / 'release-identity.json', identity)
            common.put(work / 'native-operator.json', {'app': str(work.parent / 'Release.app')})
            common.put(work / 'src/Chat.tsx', 'retained source')
            common.put(root / 'logs/chain-old/end.json', {'exitCode': 2})
            common.put(root / 'preparation/revision10/DIAGNOSIS.md', 'read-only diagnosis')
            common.put(root / 'PACKET.sha256', 'prior seal'); common.put(root / 'PACKET.v9.sha256', 'prior seal')
            binding = product_resume.capture(root); common.put(root / 'metadata/revision-10.json', {'disposition': binding})
            with patch.object(after, 'app_hash', return_value=identity):
                self.assertEqual(product_resume.verify_record(root)['order'], product_resume.ORDER)
                for path in [work / 'src/Chat.tsx', old / 'summary.json', root / 'logs/chain-old/end.json',
                             root / 'preparation/revision10/DIAGNOSIS.md', root / 'PACKET.v9.sha256']:
                    original = path.read_bytes(); path.write_bytes(original + b' ')
                    with self.subTest(path=path), self.assertRaisesRegex(RuntimeError, 'drift'):
                        product_resume.verify_record(root)
                    path.write_bytes(original)
            with patch.object(after, 'app_hash', return_value={**identity, 'nativeSha256': 'changed'}):
                with self.assertRaisesRegex(RuntimeError, 'release-drift'): product_resume.verify_record(root)
            target = root / product_resume.LOCATION; target.chmod(0o755)
            for path in target.iterdir(): path.chmod(0o644)

    def test_app_setup_null_is_retained_and_infrastructure_still_blocks(self):
        import product_resume
        for reason in sorted(product_resume.APP_PRIME_REASONS):
            state = 'not-running' if reason.startswith('app-') else 'foreground'
            status = {'pass': None, 'reason': reason}
            failure = {'reason': reason, 'outcomeClass': 'setup', 'appState': {'state': state}}
            with self.subTest(reason=reason):
                self.assertIsNone(after.driver_verdict(0, status, {'valid': True, 'pass': None}, failure))
                self.assertEqual(status['pass'], None)
                for changed in ({**failure, 'outcomeClass': 'instrument'},
                                {**failure, 'appState': {'state': 'unknown'}},
                                {**failure, 'secondaryFailures': [{'reason': 'cleanup:live-process', 'outcomeClass': 'instrument'}]}):
                    with self.assertRaises(common.HarnessDefect):
                        after.driver_verdict(0, status, {'valid': True, 'pass': None}, changed)
                with self.assertRaises(common.HarnessDefect):
                    after.driver_verdict(0, status, {'valid': False, 'pass': None}, failure)
        for reason in ('unavailable-simulator', 'backend-start-unavailable', 'native-runner-unavailable',
                       'origin-port-occupied', 'command-exit:1:xcrun', 'unknown-setup'):
            with self.subTest(reason=reason), self.assertRaises(common.HarnessDefect):
                after.driver_verdict(0, {'pass': None, 'reason': reason}, {'valid': True, 'pass': None},
                    {'reason': reason, 'outcomeClass': 'setup', 'appState': {'state': 'foreground'}})

    def test_startup_video_tail_does_not_erase_observed_selector_failure(self):
        failure = {'reason': 'selector-not-hittable', 'outcomeClass': 'setup',
            'appState': {'state': 'foreground'}, 'secondaryFailures': [
                {'reason': 'invalid-startup-video:video-endpoint-uncovered', 'outcomeClass': 'instrument'}]}
        self.assertIsNone(after.driver_verdict(0, {'pass': None, 'reason': failure['reason']},
            {'valid': True, 'pass': None}, failure))
        failure['secondaryFailures'][0]['reason'] = 'invalid-startup-video:corrupt'
        with self.assertRaises(common.HarnessDefect):
            after.driver_verdict(0, {'pass': None, 'reason': failure['reason']}, {'valid': True, 'pass': None}, failure)

    def test_product_resume_runs_only_m8_on_same_build_and_keeps_m6(self):
        import product_resume
        from contextlib import ExitStack
        with tempfile.TemporaryDirectory() as d, ExitStack() as stack:
            root = Path(d); old = root / product_resume.OLD; old.mkdir(parents=True)
            (old.parent / 'attempt-01').mkdir(); scratch = root / 'scratch'; work = scratch / 'app'; work.mkdir(parents=True)
            app = scratch / 'DerivedData/Build/Products/Release-iphonesimulator/Clique.app'
            identity = {'bundleId': 'dev.clique.pilot.snapback4', 'nativeSha256': 'native', 'hermesSha256': 'hermes'}
            common.put(old / 'scratch.json', {'path': str(scratch)})
            common.put(old / 'release-identity.json', identity)
            retained = {'segments': {'m6': {'pass': None, 'outcomeClass': 'setup', 'evidence': 'original-m6'}}}
            common.put(old / 'summary.json', retained); before = common.inventory(old)
            common.put(work / 'native-operator.json', {'bundleId': identity['bundleId'], 'app': str(app),
                'webArgv': ['web'], 'backendArgv': ['backend'], 'seedArgv': ['seed'], 'oracleArgv': ['oracle'],
                'ordinaryImage': 'ordinary.png', 'viewOnceImage': 'once.png'})
            common.put(root / 'native/QUALIFIED.json', {'instrument': {}})
            common.put(root / 'runner', 'binary')
            segments = []; builds = []
            def command(argv, **kwargs):
                if '--config' in argv:
                    segment = argv[argv.index('--segment') + 1]; segments.append(segment)
                    config = common.read(Path(argv[argv.index('--config') + 1])); self.assertEqual(config['app'], str(app))
                    out = Path(argv[argv.index('--out') + 1]); common.put(out / 'status.json', {'pass': None, 'reason': 'selector-not-hittable'})
                    common.put(out / (segment + '-ios-run.json'), {'failure': {'reason': 'selector-not-hittable',
                        'outcomeClass': 'setup', 'appState': {'state': 'foreground'}}})
                    return SimpleNamespace(returncode=0)
                if 'validate.py' in argv[1]:
                    return SimpleNamespace(returncode=0, stdout=json.dumps({'valid': True, 'pass': None}), stderr='')
                if 'get_app_container' in argv: return SimpleNamespace(returncode=1)
                raise AssertionError(argv)
            for name, value in [('ROOT', root), ('NATIVE', root / 'native')]: stack.enter_context(patch.object(after, name, value))
            for name in ('host_check', 'verify', 'free_ports', 'stop'): stack.enter_context(patch.object(after, name))
            stack.enter_context(patch.object(after, 'wait_builder', return_value={}))
            stack.enter_context(patch.object(after, 'lock', return_value=SimpleNamespace(close=lambda: None)))
            stack.enter_context(patch.object(product_resume, 'verify_record', return_value={'sha256': 'sealed'}))
            stack.enter_context(patch.object(after, 'execution_environment', return_value={}))
            stack.enter_context(patch.object(after, 'app_hash', return_value=identity))
            stack.enter_context(patch.object(after, 'runner_config', return_value={'binary': str(root / 'runner'), 'xctestrun': 'qualified'}))
            stack.enter_context(patch.object(after, 'run', side_effect=lambda argv, *a, **k: builds.append(argv)))
            stack.enter_context(patch.object(after.subprocess, 'Popen', return_value=SimpleNamespace(pid=123)))
            stack.enter_context(patch.object(after.subprocess, 'check_output', return_value=json.dumps({'devices': {'iOS': [{'udid': common.UDID, 'state': 'Booted'}]}})))
            stack.enter_context(patch.object(after.subprocess, 'run', side_effect=command))
            self.assertEqual(after.execute('snapback4', resume_product_setup=True), 0)
            self.assertEqual(segments, ['m8']); self.assertEqual(common.inventory(old), before)
            self.assertTrue(all('xcodebuild' not in argv and 'prepare' not in ' '.join(argv) for argv in builds))
            result = common.read(old.parent / 'attempt-03/summary.json')
            self.assertEqual(result['outcome'], 'product-unmeasured')
            self.assertIsNone(result['segments']['m6']['pass']); self.assertTrue(result['segments']['m6']['retained'])
            self.assertIsNone(result['segments']['m8']['pass']); self.assertTrue(result['cleanupComplete'])

    def test_app_setup_continuation_starts_convex_but_host_failure_stops(self):
        import product_resume
        for infra in (False, True):
            with self.subTest(infra=infra), tempfile.TemporaryDirectory() as d:
                root = Path(d); (root / 'logs').mkdir(); calls = []
                def step(argv, **kwargs):
                    calls.append(argv[1:])
                    return SimpleNamespace(returncode=2 if infra else 0)
                with patch.object(chain, 'ROOT', root), patch.object(chain, 'host_check'), patch.object(chain, 'lock'), \
                     patch.object(chain, 'verify'), patch.object(product_resume, 'admission', return_value={'order': product_resume.ORDER}), \
                     patch.object(chain.subprocess, 'run', side_effect=step):
                    self.assertEqual(chain.main(resume_product_setup=True), 2 if infra else 0)
                self.assertEqual(calls, [[str(root / 'after-builder.sh'), 'snapback4', '--resume-product-setup'],
                    [str(root / 'launch-builder.sh'), 'convex'], [str(root / 'after-builder.sh'), 'convex']][:1 if infra else 3])

    def test_product_resume_admission_is_one_use_and_requires_cold_convex(self):
        import product_resume
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            for name in ('logs/chain-old', 'results/snapback4/attempt-01', 'results/snapback4/attempt-02', 'lanes/convex/instrument'):
                (root / name).mkdir(parents=True)
            receipt = {'priorChains': ['chain-old'], 'order': product_resume.ORDER}
            with patch.object(product_resume, 'verify_record', return_value=receipt), \
                 patch.object(processes.ProcessOwner, 'resume') as owner, patch.object(product_resume, 'free_ports'):
                owner.return_value.sample.return_value = {}
                self.assertEqual(product_resume.admission(root), receipt)
                (root / 'logs/chain-new').mkdir()
                with self.assertRaisesRegex(RuntimeError, 'already-consumed'): product_resume.admission(root)
                (root / 'logs/chain-new').rmdir(); (root / 'lanes/convex/builder-file').touch()
                with self.assertRaisesRegex(RuntimeError, 'convex-not-cold'): product_resume.admission(root)

    @unittest.skipUnless(sys.platform == 'darwin', 'macOS diagnostic custody write protection')
    def test_diagnostic_cannot_write_original_builder_or_custody(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve()
            protected = ['lanes/snapback4', 'lanes/convex', 'attempts/snapback4-builder-completed',
                'results/snapback4/attempt-01', 'logs/snapback4', 'inputs']
            for name in protected: common.put(root / name / 'probe', 'original')
            common.put(root / 'scratch/app/probe', 'work')
            profile = root / 'diagnostic.sb'; common.put(profile, source_ruling.diagnostic_profile(root))
            for name in [*protected, 'scratch/app']:
                path = root / name / 'probe'
                command = ['/usr/bin/sandbox-exec', '-f', str(profile), sys.executable, '-c',
                    'from pathlib import Path; import sys; Path(sys.argv[1]).write_text("changed")', str(path)]
                result = subprocess.run(command, capture_output=True)
                self.assertEqual(result.returncode == 0, name == 'scratch/app')
                self.assertEqual(path.read_text(), 'changed' if name == 'scratch/app' else 'original')

    def test_operator_environment_exact_sealed_bytes_and_live_drift(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); home = root / 'home'; home.mkdir()
            script = 'export VOLTA_HOME=$HOME/.volta\nexport CARGO_INCREMENTAL=0\n'
            common.put(home / '.snapback-env.sh', script)
            common.put(root / 'metadata/operator-environment.sh', script)
            common.put(root / 'metadata/operator-environment.json', {'sha256': common.sha(home / '.snapback-env.sh')})
            result = operator_inputs.sealed_environment(root, home)
            self.assertEqual(result['exactContents'], script)
            self.assertEqual(result['sha256'], common.sha(home / '.snapback-env.sh'))
            (home / '.snapback-env.sh').write_text(script + 'echo substituted\n')
            with self.assertRaisesRegex(RuntimeError, 'seal-drift'):
                operator_inputs.sealed_environment(root, home)

    def test_fixed_operator_environment_scrubs_binary_and_source_overrides(self):
        with patch.dict(os.environ, {'SNAPBACK4_BIN': '/wrong/binary', 'ENTRY_FILE': '/other/app.js',
            'SKIP_BUNDLING': '1', 'EXPO_PUBLIC_ORIGIN': 'https://wrong.example', 'VOLTA_HOME': '/operator/volta'}):
            env = operator_inputs.clean_environment()
        for key in ('SNAPBACK4_BIN', 'ENTRY_FILE', 'SKIP_BUNDLING', 'EXPO_PUBLIC_ORIGIN'):
            self.assertNotIn(key, env)
        self.assertEqual(env['VOLTA_HOME'], '/operator/volta')

    def test_amended_audit_records_inputs_and_still_gates_both_blockers(self):
        for gating in (True, False):
            with tempfile.TemporaryDirectory() as d:
                root = Path(d); work = root / 'work'; target = root / 'attempt'
                work.mkdir(); target.mkdir()
                common.put(work / 'native-operator.json', {'bundleId': 'dev.clique.pilot.snapback4'})
                sealed = {'source': {'sha256': 'sealed-hash', 'exactContents': 'export CARGO_INCREMENTAL=0\n'},
                          'fixedEnvironment': {'SNAPBACK4_BIN': None}}
                def launch(*args, **kw):
                    schema = common.read(target / 'source-audit/schema.json')
                    review = {k: True for k in schema['required']}
                    review.update(ready=False, hooksPassive=False, oracleReadOnly=False,
                        findings=['send awaits journal', 'query sends receipts'], citations=['src/Chats.tsx:54'])
                    common.put(target / 'source-audit/review.json', review)
                    return type('Proc', (), {'pid': 123, 'returncode': 0, 'wait': lambda self, **kw: 0})()
                with patch.object(source_audit, 'audit_inputs', return_value=sealed), \
                     patch.object(source_audit.subprocess, 'Popen', side_effect=launch), patch.object(source_audit, 'stop'):
                    if gating:
                        with self.assertRaises(source_audit.SourceAuditRefused):
                            source_audit.audit(work, target, gating=gating, env={})
                    else:
                        result = source_audit.audit(work, target, gating=gating, env={})
                        self.assertFalse(result['hooksPassive']); self.assertFalse(result['oracleReadOnly'])
                prompt = (target / 'source-audit/prompt.md').read_text()
                for text in ('MANDATES sourcing', 'sealed-hash', 'CARGO_INCREMENTAL=0', 'BUILDER-AUTHORED', 'not chosen by the builder', 'generic/platform=iOS Simulator', 'do not assume $2 exists', 'compile custody source'):
                    self.assertIn(text, prompt)
                self.assertEqual(common.read(target / 'source-audit/operator-inputs.json'), sealed)
                self.assertFalse(common.read(target / 'source-audit/disposition.json')['qualified'])

    def test_round4_chain_diagnostic_last_even_after_each_setup_failure(self):
        for failure in (None, 1, 2, 3, 'exception', 'readiness'):
            with tempfile.TemporaryDirectory() as d:
                root = Path(d); (root / 'logs').mkdir(); calls = []
                def call(argv, **kw):
                    calls.append(argv)
                    if failure == 'exception' and len(calls) == 1: raise OSError('launch unavailable')
                    return type('Result', (), {'returncode': 2 if len(calls) == failure else 0})()
                receipt = {'order': ['convex-builder', 'convex-after-builder', 'snapback4-diagnostic']}
                with patch.object(chain, 'ROOT', root), patch.object(chain, 'host_check'), patch.object(chain, 'lock'), \
                     patch.object(chain, 'source_admission', return_value=receipt), \
                     patch.object(chain, 'verify', side_effect=RuntimeError('setup') if failure == 'readiness' else None), \
                     patch.object(chain.subprocess, 'run', side_effect=call):
                    result = chain.main(continue_source_audit_ruling=True)
                self.assertEqual(len(calls), 3)
                self.assertEqual(calls[0][-2:], [str(root / 'launch-builder.sh'), 'convex'])
                self.assertEqual(calls[1][-2:], [str(root / 'after-builder.sh'), 'convex'])
                self.assertEqual(calls[2][-3:], [str(root / 'after-builder.sh'), 'snapback4', '--diagnostic-audit-refused'])
                self.assertEqual(result, 2 if failure is not None else 0)

    def test_diagnostic_complete_operator_path_preserves_no_pass_after_m6_setup_failure(self):
        from contextlib import ExitStack
        from types import SimpleNamespace
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); work = root / 'scratch/app'; work.mkdir(parents=True)
            (root / 'results').mkdir(); events = []
            handoff = {'bundleId': 'dev.clique.pilot.snapback4', 'app': '@DERIVED@/Clique.app',
                'prepareArgv': ['prepare'], 'buildArgv': ['bash', 'build.sh', '@DERIVED@', '@UDID@'],
                'backendArgv': ['backend'], 'webArgv': ['web'], 'seedArgv': ['seed'],
                'oracleArgv': ['oracle'], 'ordinaryImage': 'ordinary.png', 'viewOnceImage': 'once.png'}
            common.put(work / 'native-operator.json', handoff); common.put(work / 'build.sh', 'build')
            common.put(work / 'ordinary.png', 'image'); common.put(work / 'once.png', 'image')
            common.put(root / 'native/QUALIFIED.json', {'instrument': {}})
            common.put(root / 'runner', 'runner')
            def command(argv, cwd, out, env=None, **kw):
                if argv[0] == '/usr/bin/sandbox-exec': argv = argv[3:]
                events.append(argv[0]); common.put(out, 'diagnostic command log')
            def review(*args, **kw):
                events.append('prepared-audit'); self.assertFalse(kw['gating'])
                return {'ready': False}
            def invoke(argv, **kw):
                if argv[0] == '/usr/bin/sandbox-exec': argv = argv[3:]
                if argv[0] == 'xcrun': return SimpleNamespace(returncode=1, stdout='', stderr='')
                segment = argv[argv.index('--segment') + 1]; events.append(Path(argv[1]).name + ':' + segment)
                if 'driver-entry.py' in argv[1]:
                    common.put(Path(argv[argv.index('--out') + 1]) / 'status.json', {
                        'pass': None if segment == 'm6' else True, 'outcomeClass': 'setup' if segment == 'm6' else None})
                    return SimpleNamespace(returncode=0)
                return SimpleNamespace(returncode=0, stdout=json.dumps({
                    'valid': segment == 'm8', 'pass': True if segment == 'm8' else None}), stderr='')
            with ExitStack() as stack:
                patches = [(xcode_environment, 'normalize', lambda *args: None), (after, 'ROOT', root), (after, 'NATIVE', root / 'native'),
                    (after, 'host_check', lambda: None), (after, 'verify', lambda **kw: None),
                    (after, 'lock', lambda name: SimpleNamespace(close=lambda: None)),
                    (after, 'free_ports', lambda backend: None), (after, 'execution_environment', lambda backend: {}),
                    (after, 'run', command), (after, 'audit', review), (after, 'stop', lambda process: None),
                    (after, 'validate_handoff_descriptor', lambda *args: events.append('semantic-handoff')),
                    (after, 'runner_config', lambda: {'binary': root / 'runner', 'xctestrun': 'runner.xctestrun'}),
                    (after, 'app_hash', lambda *args: {'bundleId': 'dev.clique.pilot.snapback4',
                        'nativeSha256': 'binary', 'hermesSha256': 'bundle'}),
                    (after, 'simulator_product', lambda *args: {}),
                    (source_ruling, 'protect_diagnostic', lambda: root / 'profile.sb'),
                    (derived_data, 'manifest_setting', lambda: False),
                    (derived_data, 'set_manifest_setting', lambda value: None),
                    (source_ruling, 'verify_retained', lambda *args, **kw: {'work': str(work)})]
                common.put(root / source_ruling.RULING, {})
                for module, name, value in patches: stack.enter_context(patch.object(module, name, value))
                clone = stack.enter_context(patch.object(after, 'clone'))
                stack.enter_context(patch.object(after.subprocess, 'run', side_effect=invoke))
                stack.enter_context(patch.object(after.subprocess, 'Popen', return_value=SimpleNamespace(pid=123)))
                stack.enter_context(patch.object(after.subprocess, 'check_output', return_value=json.dumps({
                    'devices': {'runtime': [{'udid': common.UDID, 'state': 'Booted'}]}})))
                self.assertEqual(after.execute('snapback4', diagnostic=True), 0)
                clone.assert_not_called()
            self.assertEqual(events, ['prepare', 'prepared-audit', 'semantic-handoff', 'bash', 'xcrun',
                'driver-entry.py:m6', 'validate.py:m6', 'driver-entry.py:m8', 'validate.py:m8'])
            summary = common.read(root / source_ruling.DIAGNOSTIC / 'summary.json')
            self.assertEqual(summary['nativeOutcome'], source_ruling.OUTCOME)
            self.assertFalse(summary['admissible']); self.assertFalse(summary['passClaimed'])
            for row in summary['segments'].values(): self.assertIsNone(row['pass'])
            self.assertTrue(summary['segments']['m8']['diagnosticDriverVerdict'])
            self.assertIn('error', summary['segments']['m6'])

    def test_diagnostic_labels_bind_every_raw_artifact_without_rewriting_pass(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); attempt = root / 'diagnostic'; scratch = root / 'scratch'
            common.put(attempt / 'm6/evidence/status.json', {'pass': True})
            common.put(scratch / 'app/binary', 'raw-binary')
            before = common.sha(attempt / 'm6/evidence/status.json')
            source_ruling.label_artifacts(attempt, scratch)
            labels = common.read(attempt / 'diagnostic-artifact-labels.json')
            for rows in labels['artifacts'].values():
                for row in rows.values():
                    self.assertEqual(row['label'], source_ruling.LABEL)
                    self.assertFalse(row['admissible']); self.assertFalse(row['passClaimed'])
            self.assertEqual(labels['artifacts']['artifacts']['m6/evidence/status.json']['sha256'], before)
            self.assertEqual(common.sha(attempt / 'm6/evidence/status.json'), before)
            self.assertFalse(labels['passClaimed'])

    def test_diagnostic_prepared_audit_is_recorded_not_gating(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            with patch.object(after, 'audit', return_value={'ready': False}) as run:
                self.assertEqual(after.diagnostic_audit(root, root, {}), {'ready': False})
                self.assertFalse(run.call_args.kwargs['gating'])
                self.assertEqual(run.call_args.kwargs['name'], 'prepared-source-audit')
            with patch.object(after, 'audit', side_effect=RuntimeError('auditor unavailable')):
                after.diagnostic_audit(root, root, {})
            self.assertEqual(common.read(root / 'prepared-source-audit-error.json')['label'], source_ruling.LABEL)

    def test_source_ruling_once_with_original_findings_and_custody_unchanged(self):
        import shutil
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); lane = root / 'lanes/snapback4'; work = root / 'scratch/app'
            common.put(lane / 'app.ts', 'await observation; send()')
            shutil.copytree(lane, work)
            shutil.copytree(lane, root / 'attempts/snapback4-builder-completed')
            common.put(root / 'lanes/convex/instrument', 'aid')
            common.put(root / 'PACKET.sha256', 'v4'); common.put(root / 'PACKET.v4.sha256', 'v4')
            common.put(root / 'logs/chain-old/end.json', {'exitCode': 2})
            old = root / 'results/snapback4/attempt-01'
            common.put(old / 'summary.json', {'reason': 'independent-source-audit-refused; see retained findings', 'segments': {}})
            common.put(old / 'source-audit/review.json', {'ready': False, 'hooksPassive': False,
                'oracleReadOnly': False, 'findings': ['journal gates send', 'oracle sends receipts', 'environment unauditable']})
            common.put(old / 'source-audit/source-binding.json', common.inventory(work))
            for name in ('custody.before.json', 'custody.clone.json'): common.put(old / name, common.inventory(lane))
            common.put(old / 'scratch.json', {'path': str(work.parent)})
            source_ruling.capture(root)
            before = common.inventory(old)
            review = root / source_ruling.REAUDIT / 'source-audit/review.json'
            common.put(review, {'ready': False})
            common.put(root / source_ruling.REAUDIT / 'verdicts.json', {
                'originalReviewSha256': common.sha(old / 'source-audit/review.json'),
                'reAuditReviewSha256': common.sha(review)})
            receipt = source_ruling.admission(root)
            self.assertEqual(receipt['nativeOutcome'], source_ruling.OUTCOME)
            self.assertEqual(common.inventory(old), before)
            self.assertEqual(len(common.read(root / source_ruling.RULING)['originalFindings']), 3)
            (root / 'logs/chain-new').mkdir()
            with self.assertRaisesRegex(RuntimeError, 'already-consumed'): source_ruling.admission(root)
            (root / 'logs/chain-new').rmdir()
            (lane / 'app.ts').write_text('modified')
            with self.assertRaisesRegex(RuntimeError, 'custody-drift'): source_ruling.admission(root)

    def test_xcode_preference_restores_prior_value_even_on_archive_refusal(self):
        for original in [None, False, True]:
            with self.subTest(original=original), tempfile.TemporaryDirectory() as d:
                root = Path(d); shared = root / 'DerivedData'; shared.mkdir()
                private = root / 'runtime/private'; private.mkdir(parents=True)
                logs = root / 'logs'; logs.mkdir(); state = {'value': original}
                with patch.object(derived_data, 'ROOT', root), patch.object(derived_data, 'directory', return_value=shared), \
                     patch.object(derived_data, 'manifest_setting', side_effect=lambda: state['value']), \
                     patch.object(derived_data, 'set_manifest_setting', side_effect=lambda v: state.update(value=v)):
                    before = derived_data.begin(private, logs)
                    self.assertIs(state['value'], True)
                    (shared / 'bad-link').symlink_to(logs, target_is_directory=True)
                    with self.assertRaisesRegex(RuntimeError, 'new-nondirectory'): derived_data.finish(before)
                    self.assertIs(state['value'], original)
                    self.assertTrue(common.read(logs / 'xcode-setting-restored.json')['restored'])
                    self.assertTrue((root / 'runtime/derived-data-active.json').exists())

    @unittest.skipUnless(sys.platform == 'darwin', 'macOS native-toolchain file access')
    def test_native_allowances_preserve_product_denials(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve(); home = root / 'home'; home.mkdir()
            ro = [home / '.gitconfig', home / '.config/settings', home / 'Library/Preferences/test.plist',
                  home / 'Library/Developer/metadata']
            dd = home / 'Library/Developer/Xcode/DerivedData'; dd.mkdir(parents=True)
            denied = [dd / 'Reference/Build/binary', home / 'Library/Developer/Xcode/Archives/Driver/binary',
                      home / 'Library/Developer/CoreSimulator/Devices/fixture/data/Containers/app']
            for p in ro + denied: p.parent.mkdir(parents=True, exist_ok=True); p.write_text('fixture')
            for backend in common.BACKENDS:
                with self.subTest(backend=backend):
                    private = root / ('runtime/' + backend); private.mkdir(parents=True)
                    lane = root / 'lanes' / backend; lane.mkdir(parents=True)
                    boundary = private / 'boundary'; boundary.touch()
                    with patch.object(isolation, 'ROOT', root), patch.object(Path, 'home', return_value=home):
                        value = isolation.profile(backend, private, boundary)
                    sandbox = private / 'test.sb'; sandbox.write_text(value)
                    rw = [home / n / 'probe' for n in ['.cocoapods', '.expo', '.convex']]
                    rw.append(dd / ('New' + backend) / 'binary')
                    probe = """import json,sys
from pathlib import Path
ro,rw,denied=json.loads(sys.argv[1])
for name in ro:
    p=Path(name); assert p.read_text()=='fixture'
    try: p.write_text('changed')
    except PermissionError: pass
    else: raise AssertionError('read-only file writable: '+name)
for name in rw:
    p=Path(name); p.parent.mkdir(parents=True,exist_ok=True); p.write_text('allowed'); assert p.read_text()=='allowed'
for name in denied:
    try: Path(name).read_bytes()
    except PermissionError: pass
    else: raise AssertionError('product exposed: '+name)
print('native allowances and denials passed')
"""
                    result = subprocess.run(['/usr/bin/sandbox-exec', '-f', str(sandbox), '/usr/bin/python3',
                        '-c', probe, json.dumps([list(map(str, x)) for x in [ro, rw, denied]])], capture_output=True, text=True)
                    self.assertEqual(result.returncode, 0, result.stderr)

    def test_derived_data_serial_custody(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); shared = root / 'DerivedData'; shared.mkdir()
            (shared / 'ModuleCache.noindex').mkdir()
            (shared / 'existing').mkdir()
            private = root / 'runtime/builder-snapback4'; private.mkdir(parents=True)
            logs = root / 'logs/snapback4'; logs.mkdir(parents=True)
            with patch.object(derived_data, 'ROOT', root), patch.object(derived_data, 'directory', return_value=shared):
                before = derived_data.begin(private, logs, configure_xcode=False)
                with self.assertRaises(FileExistsError): derived_data.begin(private, logs, configure_xcode=False)
                product = shared / 'NewApp'; product.mkdir(); (product / 'binary').write_text('snapback-product')
                result = derived_data.finish(before)
                self.assertEqual(result['created'], ['NewApp'])
                self.assertFalse(product.exists())
                self.assertEqual((private / 'derived-data/NewApp/binary').read_text(), 'snapback-product')
                next_private = root / 'runtime/builder-convex'; next_private.mkdir()
                next_logs = root / 'logs/convex'; next_logs.mkdir()
                next_before = derived_data.begin(next_private, next_logs, configure_xcode=False)
                self.assertNotIn('NewApp', next_before['before'])
                self.assertTrue(derived_data.finish(next_before)['complete'])

    def test_derived_data_refuses_replaced_baseline_and_symlink(self):
        for kind in ['replacement', 'symlink']:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as d:
                root = Path(d); shared = root / 'DerivedData'; shared.mkdir()
                (shared / 'existing').mkdir()
                private = root / 'runtime/private'; private.mkdir(parents=True)
                logs = root / 'logs'; logs.mkdir()
                with patch.object(derived_data, 'ROOT', root), patch.object(derived_data, 'directory', return_value=shared):
                    before = derived_data.begin(private, logs, configure_xcode=False)
                    if kind == 'replacement':
                        (shared / 'existing').rename(root / 'saved'); (shared / 'existing').mkdir()
                    else: (shared / 'escape').symlink_to(root / 'logs', target_is_directory=True)
                    with self.assertRaisesRegex(RuntimeError, 'derived-data-'): derived_data.finish(before)
                    self.assertTrue((root / 'runtime/derived-data-active.json').exists())

    def test_refuses_overwrite(self):
        with tempfile.TemporaryDirectory() as d:
            p = Path(d) / 'result.json'; common.put(p, {'pass': False})
            with self.assertRaises(FileExistsError): common.put(p, {'pass': True})
            self.assertFalse(common.read(p)['pass'])

    def test_failed_command_receipt(self):
        with tempfile.TemporaryDirectory() as d:
            log = Path(d) / 'failure.log'
            with self.assertRaises(RuntimeError):
                common.run([sys.executable, '-c', 'raise SystemExit(7)'], d, log)
            self.assertEqual(common.read(str(log) + '.json')['exitCode'], 7)

    def test_timeout_retained(self):
        with tempfile.TemporaryDirectory() as d:
            log = Path(d) / 'timeout.log'
            with self.assertRaises(common.subprocess.TimeoutExpired):
                common.run([sys.executable, '-c', 'import time; time.sleep(5)'], d, log, timeout=.05)
            value = common.read(str(log) + '.json')
            self.assertIsNotNone(value['error']); self.assertIsNotNone(value['exitCode'])

    def test_late_meter_observes_prior_phase(self):
        turns = [{'completedAt': '1970-01-01T00:00:%02dZ' % t,
                  'usage': {'input': n, 'output': 1, 'cacheRead': 2, 'cacheWrite': 3, 'reasoning': 1}}
                 for t, n in [(10, 2000000), (30, 100)]]
        result = builder.phase_tokens({'turns': turns}, [{'phase': 'm1', 'at': 1}, {'phase': 'm2', 'at': 20}])
        self.assertEqual(result, {'m1': 2000001, 'm2': 101})

    def test_runner_is_bound_to_executed_target(self):
        with tempfile.TemporaryDirectory() as d:
            r = Path(d); (r / 'runtime').mkdir(); (r / 'native').mkdir()
            host = r / 'Runner.app'; bundle = host / 'PlugIns/CliqueDriver.xctest'; bundle.mkdir(parents=True)
            binary = bundle / 'CliqueDriver'; binary.write_bytes(b'qualified')
            x = r / 'runner.xctestrun'
            x.write_bytes(plistlib.dumps({'CliqueDriver': {'TestHostPath': '__TESTROOT__/Runner.app',
                'TestBundlePath': '__TESTHOST__/PlugIns/CliqueDriver.xctest'}}))
            common.put(r / 'runtime/runner.json', {'binary': str(binary), 'xctestrun': str(x)})
            common.put(r / 'native/QUALIFIED.json', {'driverBinarySha256': common.sha(binary)})
            with patch.object(common, 'ROOT', r), patch.object(common, 'NATIVE', r / 'native'):
                self.assertEqual(common.runner_config()['binary'], str(binary))
                binary.write_bytes(b'wrong binary')
                with self.assertRaisesRegex(RuntimeError, 'binary-mismatch'): common.runner_config()
                binary.write_bytes(b'qualified')
                x.write_bytes(plistlib.dumps({'CliqueDriver': {'TestHostPath': '__TESTROOT__/Runner.app',
                    'TestBundlePath': '__TESTHOST__/PlugIns/Other.xctest'}}))
                with self.assertRaisesRegex(RuntimeError, 'not-bound'): common.runner_config()

    def test_chain_serial_order_and_setup_stop(self):
        for failure, count in [(None, 4), (2, 2)]:
            with tempfile.TemporaryDirectory() as d:
                r = Path(d); (r / 'logs').mkdir(); calls = []
                def call(argv, **kwargs):
                    calls.append(argv[-2:])
                    return type('Result', (), {'returncode': 2 if len(calls) == failure else 0})()
                class Lease:
                    def close(self): pass
                with patch.object(chain, 'ROOT', r), patch.object(chain, 'host_check'), patch.object(chain, 'verify'), \
                     patch.object(chain, 'lock', return_value=Lease()), patch.object(chain.subprocess, 'run', side_effect=call):
                    self.assertEqual(chain.main(), 2 if failure else 0)
                self.assertEqual(len(calls), count)
                self.assertEqual(calls, [[script, backend] for backend in ['snapback4', 'convex']
                    for script in [str(r / 'launch-builder.sh'), str(r / 'after-builder.sh')]][:count])

    def test_product_retry_refused_without_commands(self):
        with tempfile.TemporaryDirectory() as d:
            r = Path(d); old = r / 'results/snapback4/attempt-01'; old.mkdir(parents=True)
            common.put(old / 'summary.json', {'outcome': 'product-failure', 'segments': {'m6': {'pass': False}}})
            class Lease:
                def close(self): pass
            with patch.object(after, 'ROOT', r), patch.object(after, 'host_check'), patch.object(after, 'verify'), \
                 patch.object(after, 'wait_builder', return_value={}), patch.object(after, 'lock', return_value=Lease()), \
                 patch.object(after, 'run', side_effect=AssertionError('must not execute')):
                with self.assertRaisesRegex(RuntimeError, 'product-retry-forbidden'):
                    after.execute('snapback4', r / 'repair.json')

    def test_release_artifact_identity(self):
        with tempfile.TemporaryDirectory() as d:
            app = Path(d)
            (app / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': 'dev.test', 'CFBundleExecutable': 'Test'}))
            (app / 'Test').write_bytes(b'native'); (app / 'main.jsbundle').write_bytes(b'plain JS')
            with self.assertRaisesRegex(RuntimeError, 'Hermes'): after.app_hash(app, 'dev.test')
            (app / 'main.jsbundle').write_bytes(bytes.fromhex('c61fbc03c103191f') + b'bundle')
            self.assertEqual(after.app_hash(app, 'dev.test')['nativeSha256'], common.sha(app / 'Test'))


    def test_real_attempt_usage_at_409_seconds(self):
        fixture = Path(__file__).parent / 'fixtures/attempt-01-token-events.jsonl'
        adapter = common.WEB / 'tools/social-messenger/metering/adapters/codex-session.mjs'
        if not adapter.exists():
            adapter = Path(__file__).resolve().parents[5] / 'benchmarks/tools/social-messenger/metering/adapters/codex-session.mjs'
        result = subprocess.run(['node', str(Path(__file__).parent / 'native-tokens.mjs'), str(adapter), str(fixture)],
                                capture_output=True, text=True, check=True)
        usage = builder.phase_usage(json.loads(result.stdout), [{'phase': 'm1', 'at': 1791219712.132749}])['m1']
        self.assertEqual(usage, {'input': 125756, 'output': 9857, 'cacheRead': 1874304,
                                'cacheWrite': 0, 'reasoning': 476, 'nonCachedTokens': 135613})
        self.assertLess(usage['nonCachedTokens'], 2000000 / 10)
        self.assertEqual(sum(usage[k] for k in ['input', 'output', 'cacheRead', 'cacheWrite']), 2009917)

    def test_detached_child_cleanup_and_foreign_port(self):
        # A real server in a new session survives its leader, ignores TERM,
        # and must be killed without touching an unrelated listener.
        import socket
        with tempfile.TemporaryDirectory() as d, socket.socket() as foreign:
            foreign.bind(('127.0.0.1', 0)); foreign.listen()
            with patch.object(processes, 'booted_simulators', return_value=[]):
                owner = processes.ProcessOwner(d)
                env = dict(os.environ, **{processes.TAG: owner.state['token']})
                ready = Path(d) / 'ready.json'
                child = ("import json,os,signal,socket,time; from pathlib import Path; "
                    "signal.signal(signal.SIGTERM,signal.SIG_IGN); s=socket.socket(); "
                    "s.bind(('127.0.0.1',0)); s.listen(); Path(%r).write_text(json.dumps({'pid':os.getpid(),'port':s.getsockname()[1]})); time.sleep(60)" % str(ready))
                parent = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',%r],start_new_session=True); time.sleep(60)" % child
                p = subprocess.Popen([sys.executable, '-c', parent], env=env, start_new_session=True)
                try:
                    owner.start(p)
                    deadline = time.monotonic() + 5
                    while not ready.exists() and time.monotonic() < deadline: time.sleep(.02)
                    data = common.read(ready)
                    # End leader BEFORE discovering the detached server: inherited
                    # ownership must still find it after reparenting.
                    p.terminate(); p.wait(timeout=5)
                    receipt = owner.cleanup(p, grace=.15)
                    self.assertTrue(receipt['complete'])
                    with patch.dict(common.PORTS, snapback4=(data['port'], data['port'])):
                        common.free_ports('snapback4')
                    port = foreign.getsockname()[1]
                    with patch.dict(common.PORTS, snapback4=(port, port)):
                        with self.assertRaisesRegex(RuntimeError, 'occupied-port:'): common.free_ports('snapback4')
                    events = [json.loads(x) for x in (Path(d) / 'cleanup.jsonl').read_text().splitlines()]
                    self.assertTrue(any(e.get('pid') == data['pid'] and e.get('signal') == signal.SIGKILL for e in events))
                finally:
                    owner.cleanup(p, grace=.05)

    def test_environment_cleared_child_still_in_owned_group(self):
        with tempfile.TemporaryDirectory() as d, patch.object(processes, 'booted_simulators', return_value=[]):
            owner = processes.ProcessOwner(d); ready = Path(d) / 'ready'
            child = "import os,signal,time; from pathlib import Path; signal.signal(signal.SIGTERM,signal.SIG_IGN); Path(%r).write_text(str(os.getpid())); time.sleep(60)" % str(ready)
            parent = "import subprocess,sys,time; subprocess.Popen([sys.executable,'-c',%r],env={}); time.sleep(60)" % child
            p = subprocess.Popen([sys.executable, '-c', parent], start_new_session=True)
            try:
                owner.start(p); deadline = time.monotonic() + 5
                while not ready.exists() and time.monotonic() < deadline: time.sleep(.02)
                pid = int(ready.read_text()); p.terminate(); p.wait(timeout=5)
                self.assertTrue(owner.cleanup(p, grace=.1)['complete'])
                events = [json.loads(x) for x in (Path(d) / 'cleanup.jsonl').read_text().splitlines()]
                self.assertTrue(any(e.get('pid') == pid and e.get('signal') == signal.SIGKILL for e in events))
            finally: owner.cleanup(p, grace=.05)

    def test_simulator_cleanup_preserves_dedicated_and_baseline(self):
        self.assertEqual(processes.simulator_targets(['foreign'], ['foreign', common.UDID, 'builder']), ['builder'])

    def test_setup_repair_never_replaces_app_commands(self):
        with tempfile.TemporaryDirectory() as d:
            old = Path(d) / 'attempt-01'; old.mkdir()
            common.put(old / 'summary.json', {'outcome': 'setup-failure', 'segments': {}, 'setupRerunEligible': True})
            repair = Path(d) / 'repair.json'
            common.put(repair, {'scope': 'operator-setup-only', 'reason': 'fix tools', 'operatorConfig': '/replacement'})
            with self.assertRaisesRegex(RuntimeError, 'cannot-replace'): after.check_repair(old, repair)

    def test_product_status_survives_validator_timeout_and_refuses_retry(self):
        with tempfile.TemporaryDirectory() as d:
            old = Path(d); seg = old / 'm6'; (seg / 'evidence').mkdir(parents=True)
            common.put(seg / 'evidence/status.json', {'pass': False})
            summary = {'outcome': 'setup-failure', 'segments': {}, 'setupRerunEligible': True}
            after.observe_driver(seg, summary, 'm6', 1)
            common.put(old / 'summary.json', summary)
            self.assertTrue(summary['observedProductFailure'])
            with self.assertRaisesRegex(RuntimeError, 'product-retry-forbidden'): after.check_repair(old, old / 'missing.json')
            # Even a stale/incomplete summary cannot erase the on-disk product failure.
            summary.pop('observedProductFailure'); summary['segments'] = {}
            (old / 'summary.json').write_text(json.dumps(summary))
            with self.assertRaisesRegex(RuntimeError, 'product-retry-forbidden'): after.check_repair(old, old / 'missing.json')

    def test_driver_exit_must_match_verdict(self):
        with self.assertRaisesRegex(RuntimeError, 'unexpected-driver-exit:17'):
            after.driver_verdict(17, {'pass': True}, {'valid': True, 'pass': True})
        self.assertFalse(after.driver_verdict(1, {'pass': False}, {'valid': True, 'pass': False}))

    def handoff_fixture(self, root, backend):
        fixtures = Path(__file__).parent / 'fixtures'
        work = root / 'work'; work.mkdir()
        handoff = common.read(fixtures / (backend + '-round6-operator.json'))
        common.put(work / 'native-operator.json', handoff)
        common.put(work / 'scripts/native-build.sh', (fixtures / (backend + '-round6-build.sh')).read_text())
        for name in ('native-prepare.sh', 'native-backend.sh', 'serve-web.mjs', 'native-seed.mjs', 'native-oracle.mjs'):
            common.put(work / 'scripts' / name, 'fixture entrypoint; never executed')
        for name in ('ordinary.png', 'once.png'): common.put(work / 'native-fixtures' / name, 'image bytes')
        common.put(root / 'inputs/convex/convex-local-backend', 'sealed binary')
        common.put(root / 'metadata/convex-preflight.json', {
            'backendSha256': common.sha(root / 'inputs/convex/convex-local-backend')})
        return work, handoff

    def test_both_round6_unsigned_build_handoffs_refuse_without_execution(self):
        for backend in ('convex', 'snapback4'):
            with self.subTest(backend=backend), tempfile.TemporaryDirectory() as d:
                root = Path(d); work, handoff = self.handoff_fixture(root, backend)
                with patch.object(after, 'ROOT', root), patch.object(after, 'audit') as audit_mock, \
                     patch.object(after.subprocess, 'run') as run_mock, patch.object(after.subprocess, 'Popen') as popen:
                    report = after.static_admission(backend, work, root / 'fresh', root / 'attempt')
                    self.assertFalse(report['valid'], report)
                    self.assertEqual(len(report['checks']), 22)
                    refusal = next(row for row in report['refusals']
                                   if row['gate'] == 'build-wrapper-or-direct-target')
                    self.assertIn('signing-required', refusal['reason'])
                    audit_mock.assert_not_called(); run_mock.assert_not_called(); popen.assert_not_called()
                self.assertIn('exec xcodebuild', (work / 'scripts/native-build.sh').read_text())
                self.assertIn('CODE_SIGNING_ALLOWED=NO', (work / 'scripts/native-build.sh').read_text())
                self.assertEqual(len(handoff['buildArgv']), 3 if backend == 'convex' else 4)

    def test_real_handoff_validator_refuses_gap_fixtures_and_foreign_run_before_build(self):
        gap = common.read(native_component_root() / 'tests/fixtures/fixture-schema-gap.json')
        foreign = 'f2106546-215d-4063-a277-99b0e0a36d4e'
        cases = {
            'passing': (lambda requested: (requested, [requested + ':first', requested + ':second']), None),
            'cleanup-after-success': (lambda requested: (requested, [requested + ':first', requested + ':second']), None),
            'validator-unavailable': (lambda requested: (requested, [requested + ':first', requested + ':second']), None),
            'convex-round7': (lambda requested: (requested, gap['convex']['queuedBodies']),
                              'fixture-queued-bodies-current-run'),
            'snapback4-round7': (lambda requested: (requested, gap['snapback4']['queuedBodies']),
                                 'fixture-queued-bodies-current-run'),
            'foreign-run-id': (lambda requested: (foreign, [foreign + ':first', foreign + ':second']),
                               'fixture-run-id-current'),
        }
        real_run = subprocess.run
        real_popen = subprocess.Popen

        class ReadySocket:
            def __enter__(self): return self
            def __exit__(self, *unused): return None
            def settimeout(self, unused): pass
            def connect_ex(self, unused): return 0

        for name, (identity, expected_code) in cases.items():
            with self.subTest(name=name), tempfile.TemporaryDirectory() as d:
                root = Path(d); work = root / 'work'; scratch = root / 'scratch'; attempt = root / 'attempt'
                work.mkdir(); scratch.mkdir(); attempt.mkdir()
                handoff = {'backendArgv': ['inert-backend'], 'seedArgv': ['inert-seed']}
                build_stages = []

                def invoke(argv, **kwargs):
                    if argv[0] == 'node':
                        if name == 'validator-unavailable': raise OSError('validator spawn failed')
                        return real_run(argv, **kwargs)
                    self.assertEqual(argv, ['inert-seed'])
                    requested = json.loads(kwargs['input'])['runId']
                    descriptor_run, bodies = identity(requested)
                    descriptor = {
                        'protocol': 'clique-native/1', 'runId': descriptor_run,
                        'bundleId': 'dev.clique.pilot.snapback4', 'origin': 'http://127.0.0.1:49540',
                        'alice': 'alice', 'bob': 'bob', 'conversationId': 'conversation',
                        'chatValue': 'dm:bob', 'history': {'messageId': 'history', 'body': 'history'},
                        'ordinary': {'messageId': 'ordinary', 'assetId': 'ordinary-asset', 'sha256': '1' * 64},
                        'viewOnce': {'messageId': 'once', 'assetId': 'once-asset', 'sha256': '2' * 64},
                        'search': {'token': 'needle', 'messageId': 'history'}, 'queuedBodies': bodies,
                    }
                    return SimpleNamespace(returncode=0, stdout=json.dumps(descriptor), stderr='')

                def launch(argv, *args, **kwargs):
                    if argv[0] == 'node':
                        return real_popen(argv, *args, **kwargs)
                    self.assertEqual(argv, ['inert-backend'])
                    return SimpleNamespace(pid=123, poll=lambda: None)

                def validate_then_build():
                    result = after.validate_handoff_descriptor('snapback4', handoff, work, scratch, attempt,
                                                      os.environ.copy(), lambda argv: argv)
                    self.assertTrue(result['valid'])
                    self.assertTrue(common.read(attempt / 'semantic-handoff/result.json')['pass'])
                    common.require_cleanup(result['cleanupErrors'])
                    build_stages.append('release-build')

                with patch.object(after, 'NATIVE', native_component_root()), \
                     patch.object(after.subprocess, 'Popen', side_effect=launch), \
                     patch.object(after.subprocess, 'run', side_effect=invoke), \
                     patch.object(after.socket, 'socket', ReadySocket), patch.object(after, 'stop',
                         side_effect=PermissionError(1, 'Operation not permitted') if name == 'cleanup-after-success' else None):
                    if name == 'passing':
                        validate_then_build()
                    else:
                        with self.assertRaises(Exception) as raised: validate_then_build()
                        summary = {'segments': {}, 'observedProductFailure': False, 'outcome': 'setup-failure'}
                        after.classify_failure(summary, raised.exception, 'builder-handoff-semantic')
                        if expected_code:
                            self.assertIsInstance(raised.exception, after.SemanticHandoffRefused)
                            self.assertEqual(summary['outcome'], 'handoff-refused-by-semantic-validator')
                        else:
                            self.assertEqual(summary['outcome'], 'harness-defect')
                            self.assertEqual(summary['failureStage'], 'operator-setup')
                            self.assertFalse(summary['observedProductFailure'])
                if name == 'passing':
                    self.assertEqual(build_stages, ['release-build']); continue
                self.assertEqual(build_stages, [])
                if name == 'cleanup-after-success':
                    self.assertTrue(common.read(attempt / 'semantic-handoff/result.json')['pass'])
                    self.assertFalse(common.read(attempt / 'semantic-handoff/cleanup.json')['complete'])
                if not expected_code: continue
                validator = common.read(attempt / 'semantic-handoff/validator-exit.json')
                self.assertEqual(validator['exitCode'], 2)
                refusal = json.loads((attempt / 'semantic-handoff/validator.stderr').read_text())
                self.assertEqual(refusal['code'], expected_code)

    def test_native_component_root_prefers_assembled_packet(self):
        with tempfile.TemporaryDirectory() as d:
            source=native_component_root()
            packet=Path(d).resolve()/'packet';native=packet/'inputs/components/native-0.4.0-native.2';native.mkdir(parents=True)
            for relative in ('tests/fixtures/fixture-schema-gap.json','schemas/fixture.schema.json','helper/fixture.mjs'):
                common.put(native/relative,(source/relative).read_text())
            packet_selftest=packet/'scripts/selftest.py';common.put(packet_selftest,'# assembled selftest path\n')
            module=sys.modules[__name__]
            with patch.object(common,'NATIVE',native),patch.object(module,'__file__',str(packet_selftest)):
                legacy_root=Path(__file__).resolve().parents[2]
                self.assertFalse((legacy_root/'schemas/fixture.schema.json').exists())
                self.assertFalse((legacy_root/'helper/fixture.mjs').exists())
                self.assertEqual(native_component_root(),native)
                self.test_real_handoff_validator_refuses_gap_fixtures_and_foreign_run_before_build()

    def test_static_admission_collects_all_refusals_and_confines_every_argv(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); work, handoff = self.handoff_fixture(root, 'convex')
            for key in ('prepareArgv', 'webArgv', 'seedArgv', 'oracleArgv'):
                handoff[key] += ['../escape']
            handoff['buildArgv'] += ['wrong-udid']
            handoff['backendArgv'] = ['node', 'scripts/native-seed.mjs']
            handoff['bundleId'] = 'wrong'; handoff['app'] = '../outside.app'
            handoff['ordinaryImage'] = 'absent.png'; handoff['viewOnceImage'] = '@UNKNOWN@/once.png'
            (work / 'native-operator.json').write_text(json.dumps(handoff))
            with patch.object(after, 'ROOT', root):
                report = after.static_admission('convex', work, root / 'fresh', root / 'attempt')
            refused = {r['gate'] for r in report['refusals']}
            self.assertTrue({'bundle-id', 'app-path', 'ordinaryImage', 'viewOnceImage',
                'build-wrapper-or-direct-target', 'm6:backend-binding', 'm8:backend-binding'} <= refused)
            for seg in ('m6', 'm8'):
                for key in ('prepareArgv', 'webArgv', 'seedArgv', 'oracleArgv'): self.assertIn(seg + ':' + key, refused)

    def test_wrapper_symlink_and_wrong_arguments_refused(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); work = root / 'work'; work.mkdir()
            common.put(root / 'outside.sh', 'xcodebuild')
            (work / 'build.sh').symlink_to(root / 'outside.sh')
            with self.assertRaisesRegex(RuntimeError, 'outside-custody'):
                after.build_wrapper(['bash', 'build.sh', str(root / 'DerivedData')], work, root / 'DerivedData')
            with self.assertRaisesRegex(RuntimeError, 'optional-dedicated-udid'):
                after.build_wrapper(['bash', 'build.sh', str(root / 'DerivedData'), 'wrong'], work, root / 'DerivedData')

    def test_packet_entry_wrappers_use_prepared_python(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); packet = root / 'packet'; packet.mkdir()
            home = root / 'home'; home.mkdir(); common.put(home / '.snapback-env.sh', ':\n')
            hostile = root / 'hostile'; hostile.mkdir()
            hostile_record = root / 'hostile-python-used'
            common.put(hostile / 'python3',
                '#!/bin/bash\nprintf used > "$HOSTILE_RECORD"\nexit 97\n')
            common.put(hostile / 'caffeinate', '''#!/bin/bash
while [ "$#" -gt 0 ]; do
  case "$1" in -i|-s) shift;; *) break;; esac
done
exec "$@"
''')
            for path in (hostile / 'python3', hostile / 'caffeinate'): path.chmod(0o755)

            prepared = packet / 'runtime/venv/bin/python'; prepared.parent.mkdir(parents=True)
            common.put(prepared, '#!/bin/bash\nprintf "%s\\n" "$0" "$@" > "$ENTRY_RECORD"\n')
            prepared.chmod(0o755)
            entries = {
                'launch-builder.sh': ['scripts/builder.py', 'launch', 'snapback4'],
                'after-builder.sh': ['scripts/after.py', 'snapback4'],
                'pilot-chain.sh': ['scripts/chain.py', 'snapback4'],
            }
            env = {**os.environ, 'HOME': str(home),
                   'PATH': str(hostile) + ':/usr/bin:/bin',
                   'HOSTILE_RECORD': str(hostile_record)}
            for name, expected in entries.items():
                entry = packet / name
                entry.write_bytes((common.ROOT / name).read_bytes()); entry.chmod(0o755)
                record = root / (name + '.argv'); env['ENTRY_RECORD'] = str(record)
                result = subprocess.run([str(entry), 'snapback4'], env=env,
                                        capture_output=True, text=True)
                self.assertEqual(result.returncode, 0, (name, result.stdout, result.stderr))
                self.assertEqual(record.read_text().splitlines(), [str(prepared), *expected])
                self.assertFalse(hostile_record.exists(), name)
            self.assertIn('runtime/venv/bin/python scripts/selftest.py',
                          (common.ROOT / 'README.md').read_text())

    def test_direct_generic_simulator_and_build_only(self):
        args = ['xcodebuild', '-configuration', 'Release', '-sdk', 'iphonesimulator',
                '-destination', 'generic/platform=iOS Simulator', 'build']
        after.direct_build(args)
        for original, replacement in [('Release', 'Debug'), ('iphonesimulator', 'iphoneos'),
                ('generic/platform=iOS Simulator', 'generic/platform=iOS'), ('build', 'test')]:
            with self.assertRaises(RuntimeError): after.direct_build([replacement if x == original else x for x in args])
        with self.assertRaisesRegex(RuntimeError, 'build-action-only'): after.direct_build(args + ['clean'])
        with self.assertRaisesRegex(RuntimeError, 'signing-required'):
            after.direct_build(args + ['CODE_SIGNING_ALLOWED=NO'])

    def test_product_requires_arm64_simulator_release_and_confined_app(self):
        with tempfile.TemporaryDirectory() as d:
            derived = Path(d) / 'DerivedData'
            app = derived / 'Build/Products/Release-iphonesimulator/Clique.app'; app.mkdir(parents=True)
            (app / 'Info.plist').write_bytes(plistlib.dumps({'CFBundleExecutable': 'Clique',
                'DTPlatformName': 'iphonesimulator', 'CFBundleSupportedPlatforms': ['iPhoneSimulator']}))
            (app / 'Clique').write_bytes(b'binary')
            for outputs, error in [(['arm64', 'platform IOSSIMULATOR'], None),
                                   (['x86_64'], 'arm64-required'), (['arm64', 'platform IOS'], 'mach-o-required')]:
                with patch.object(after.subprocess, 'check_output', side_effect=outputs):
                    if error:
                        with self.assertRaisesRegex(RuntimeError, error): after.simulator_product(app, derived)
                    else: self.assertEqual(after.simulator_product(app, derived)['configuration'], 'Release')
            with self.assertRaisesRegex(RuntimeError, 'outside-fresh'): after.simulator_product(app, Path(d) / 'elsewhere')

    def test_harness_refusal_does_not_consume_setup_retry_or_allow_product_retry(self):
        import round6
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); common.put(root / 'metadata/revision-7.json', {})
            old = root / 'attempt-01'; measured = root / 'attempt-02'; retry = root / 'attempt-03'
            common.put(old / 'summary.json', {'outcome': 'unclassified-failure'})
            summary = {'outcome': 'setup-failure', 'setupRerunEligible': True, 'segments': {}}
            common.put(measured / 'summary.json', summary)
            repair = root / 'repair.json'; common.put(repair, {'reason': 'operator tool repair', 'scope': 'operator-setup-only'})
            with patch.object(after, 'ROOT', root), patch.object(round6, 'verify_record') as bound:
                self.assertEqual(after.setup_repair_previous('convex', [old, measured], repair), measured)
                bound.assert_called_once_with(root)
                with self.assertRaisesRegex(RuntimeError, 'only one'): after.setup_repair_previous('convex', [old, measured, retry], repair)
                summary['outcome'] = 'product-failure'; (measured / 'summary.json').write_text(json.dumps(summary))
                with self.assertRaisesRegex(RuntimeError, 'product-retry-forbidden'): after.setup_repair_previous('convex', [old, measured], repair)

    def test_round6_continuation_is_bound_and_one_use(self):
        import round6
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / 'logs/chain-old').mkdir(parents=True)
            (root / 'results/convex/attempt-01').mkdir(parents=True)
            common.put(root / 'metadata/round6-static.json', {'convex': {'valid': True},
                'snapback4FreshProjection': {'valid': True}})
            common.put(root / 'metadata/revision-7.json', {'staticAdmission': {
                'path': 'metadata/round6-static.json', 'sha256': common.sha(root / 'metadata/round6-static.json')}})
            with patch.object(round6, 'verify_record', return_value={'priorChains': ['chain-old']}):
                round6.admission(root)
                (root / 'logs/chain-new').mkdir()
                with self.assertRaisesRegex(RuntimeError, 'already-consumed'): round6.admission(root)
                (root / 'logs/chain-new').rmdir(); (root / 'results/convex/attempt-02').mkdir()
                with self.assertRaisesRegex(RuntimeError, 'already-started'): round6.admission(root)
                (root / 'metadata/round6-static.json').write_text('{}')
                with self.assertRaisesRegex(RuntimeError, 'binding'): round6.admission(root)

    def test_round6_chain_uses_normal_convex_gates_and_no_diagnostic_retry(self):
        for code in (0, 2):
            with tempfile.TemporaryDirectory() as d:
                root = Path(d); (root / 'logs').mkdir()
                with patch.object(chain, 'ROOT', root), patch.object(chain, 'host_check'), \
                     patch.object(chain, 'lock'), patch.object(chain, 'verify'), \
                     patch.object(chain, 'round6_admission', return_value={'order': ['convex-after-builder']}), \
                     patch.object(chain.subprocess, 'run') as run:
                    run.return_value.returncode = code
                    self.assertEqual(chain.main(continue_round6=True), code)
                self.assertEqual(run.call_count, 1)
                self.assertEqual(run.call_args[0][0][-2:], ['convex', '--resume-wrapper-refusal'])

    def test_convex_rejects_alternate_executable(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); binary = root / 'inputs/convex/convex-local-backend'; binary.parent.mkdir(parents=True)
            binary.write_bytes(b'qualified')
            common.put(root / 'metadata/convex-preflight.json', {'backendSha256': common.sha(binary)})
            with patch.object(after, 'ROOT', root):
                with self.assertRaisesRegex(RuntimeError, 'owned-preflight-launcher'):
                    after.bind_backend('convex', ['bash', 'wrapper.sh'])
                self.assertEqual(after.bind_backend('convex', [sys.executable, str(root / 'scripts/convex-owned.py'), 'None', 'None', 'None'])['sha256'], common.sha(binary))
                binary.write_bytes(b'changed')
                with self.assertRaisesRegex(RuntimeError, 'owned-preflight-launcher'):
                    after.bind_backend('convex', [sys.executable, str(root / 'scripts/convex-owned.py'), 'None', 'None', 'None'])

    def test_custody_rejects_corrupted_copy(self):
        import shutil
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); src = root / 'src'; src.mkdir(); (src / 'app').write_text('builder')
            dst = root / 'dst'
            def corrupt(*args, **kw):
                shutil.copytree(src, dst); (dst / 'app').write_text('corrupt')
            with patch.object(common, 'run', side_effect=corrupt):
                with self.assertRaisesRegex(RuntimeError, 'custody-mismatch'):
                    common.clone(src, dst, root / 'custody')

    def test_restart_needs_bound_void_and_cannot_be_reused(self):
        import shutil
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); old = root / 'logs/chain-old'; old.mkdir(parents=True)
            common.put(old / 'end.json', {'exitCode': 2})
            with self.assertRaisesRegex(RuntimeError, 'requires-explicit-VOID'): restart.admission(root)
            void = root / 'attempts/snapback4-attempt-01-void'; void.mkdir(parents=True)
            with self.assertRaises(FileNotFoundError): restart.admission(root, void)
            for name in ['logs', 'lanes', 'results']: (void / name).mkdir()
            shutil.copytree(old, void / 'logs/chain-old')
            (root / 'PACKET.v1.sha256').write_text('original seal')
            common.put(void / 'VOID.md', 'Two harness defects; not a product outcome or setup rerun.')
            common.put(void / 'VOID.json', {'classification': 'harness-defect-void', 'setupRerunsConsumed': 0,
                'productOutcome': None, 'priorChains': ['chain-old'], 'backends': ['snapback4'],
                'packetV1Sha256': common.sha(root / 'PACKET.v1.sha256')})
            common.put(void / 'retained-inventory.json', {n: common.inventory(void / n) for n in ['logs', 'lanes', 'results']})
            receipt = restart.admission(root, void)
            self.assertEqual(receipt['setupRerunsConsumed'], 0)
            (root / 'logs/chain-restarted').mkdir()
            with self.assertRaisesRegex(RuntimeError, 'does-not-cover'): restart.admission(root, void)


    def test_release_target_cannot_substitute_prepared_bundle(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); derived = root / 'DerivedData'
            args = ['xcodebuild', '-derivedDataPath', str(derived)]
            with self.assertRaisesRegex(RuntimeError, 'outside-fresh'):
                after.check_release_target(args, root / 'prebuilt.app', derived)
            after.check_release_target(args, derived / 'Products/Clique.app', derived)
            derived.mkdir()
            with self.assertRaisesRegex(RuntimeError, 'must-be-absent'):
                after.check_release_target(args, derived / 'Products/Clique.app', derived)

    def test_measurement_scrubs_hosted_environment(self):
        with patch.dict(os.environ, CONVEX_DEPLOYMENT='hosted', CONVEX_DEPLOY_KEY='secret', VITE_URL='hosted'):
            env = after.clean_environment()
            self.assertNotIn('CONVEX_DEPLOYMENT', env); self.assertNotIn('CONVEX_DEPLOY_KEY', env)
            self.assertNotIn('VITE_URL', env)

    def test_null_driver_verdict_cannot_measure(self):
        with self.assertRaisesRegex(RuntimeError, 'setup-or-instrument'):
            after.driver_verdict(0, {'pass': None}, {'valid': True, 'pass': None})

    def test_capped_builder_cannot_measure(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); logs = root / 'logs/snapback4'; logs.mkdir(parents=True)
            common.put(logs / 'launch.json', {'pid': 1})
            common.put(logs / 'end.json', {'outcome': 'capability-failure', 'reason': 'token-cap',
                'cleanup': {'complete': True}, 'derivedDataCleanup': {'complete': True}})
            with patch.object(after, 'ROOT', root), patch.object(after.ProcessOwner, 'resume'):
                with self.assertRaisesRegex(RuntimeError, 'not-measurable'): after.wait_builder('snapback4')

    @unittest.skipUnless(sys.platform == 'darwin', 'macOS seatbelt enforcement')
    def test_builder_sandbox_hides_operator_other_lane_and_escapes(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d).resolve(); lane = root / 'lanes/snapback4'; lane.mkdir(parents=True)
            private = root / 'runtime/private'; private.mkdir(parents=True)
            aids = root / 'inputs/builder'; aids.mkdir(parents=True)
            (aids / 'allowed').write_text('aid')
            forbidden = [root / 'inputs/components/native/reference', root / 'inputs/components/native/driver',
                         root / 'lanes/convex/app', root / 'attempts/old/app', root / 'logs/convex/rollout',
                         root / 'runtime/builder-convex/derived-data/App/binary']
            for path in forbidden: path.parent.mkdir(parents=True, exist_ok=True); path.write_text('forbidden')
            (lane / 'escape').symlink_to(forbidden[0])
            boundary = root / 'logs/snapback4/boundary'; boundary.parent.mkdir(); boundary.touch()
            with patch.object(isolation, 'ROOT', root): value = isolation.profile('snapback4', private, boundary)
            sandbox = private / 'test.sb'; sandbox.write_text(value)
            probe = """import json,sys
from pathlib import Path
allowed,boundary,*denied=json.loads(sys.argv[1])
assert Path(allowed).read_text()=='aid'
with Path(boundary).open('a') as f: f.write('boundary')
for item in denied:
    try: Path(item).read_text()
    except PermissionError: continue
    raise AssertionError('read escaped sandbox: '+item)
print('isolated')
"""
            args = [str(aids / 'allowed'), str(boundary), *map(str, forbidden), str(lane / 'escape')]
            result = subprocess.run(['/usr/bin/sandbox-exec', '-f', str(sandbox), '/usr/bin/python3', '-c', probe, json.dumps(args)],
                                    capture_output=True, text=True, cwd=lane)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn('isolated', result.stdout)


    def replay_supervision(self, schedule, initial, expected_reason=None, expected_outcome=None):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); logs = root / 'logs/snapback4'; logs.mkdir(parents=True)
            (root / 'lanes/snapback4').mkdir(parents=True); (root / 'prompts').mkdir()
            (root / 'prompts/snapback4.md').write_text('fixture')
            native = root / 'rollout.jsonl'; native.write_text('{}\n')
            boundary = logs / 'boundary-requests.jsonl'
            def request(phase): common.record(boundary, phase=phase)
            class Clock:
                now = 100; step = 0
                def time(self): return self.now
                def sleep(self, n):
                    self.now, phase = schedule[self.step]; self.step += 1
                    if phase is not None: request(phase)
            clock = Clock()
            class Proc:
                pid = 999999; returncode = 0
                def poll(self): return 0 if clock.step == len(schedule) else None
                def wait(self, **kw): return 0
            class Lease:
                def close(self): pass
            def launch(*args, **kw):
                kw['stdout'].write(b'{"type":"thread.started","thread_id":"fixture"}\n'); kw['stdout'].flush()
                for phase in initial: request(phase)
                return Proc()
            meter = {'adapterVersion': 'fixture', 'turns': [{'completedAt': '1970-01-01T00:01:40Z',
                'usage': {'input': 1, 'output': 1, 'cacheRead': 0, 'cacheWrite': 0, 'reasoning': 0}}]}
            with patch.object(builder, 'ROOT', root), patch.object(builder, 'time', clock), \
                 patch.object(builder, 'lock', return_value=Lease()), patch.object(builder, 'ProcessOwner') as owner, \
                 patch.object(builder, 'prepare_isolation', return_value=(root, root, root, root / 'fixture.sb')), \
                 patch.object(derived_data, 'begin', return_value={}), \
                 patch.object(derived_data, 'finish', return_value={'complete': True}), \
                 patch.object(builder.subprocess, 'Popen', side_effect=launch), \
                 patch.object(builder, 'session_path', return_value=native), patch.object(builder, 'usage', return_value=meter):
                owner.return_value.state = {'token': 'fixture'}; owner.return_value.cleanup.return_value = {'complete': True}
                if expected_outcome == 'setup-failure':
                    with self.assertRaisesRegex(RuntimeError, expected_reason): builder.supervise('snapback4')
                else: builder.supervise('snapback4')
            result = common.read(logs / 'end.json')
            self.assertEqual(result['outcome'], expected_outcome or 'builder-ended')
            if expected_reason: self.assertEqual(result['reason'], expected_reason)
            return result


    def test_second_replay_cannot_reset_wall_budget(self):
        for phase in ('m6', 'm8'):
            self.replay_supervision([(101, 'replay-start'), (10101, 'replay-end'),
                (10102, 'replay-start'), (20102, 'replay-end'), (20103, None)],
                list(common.MILESTONES[1:common.MILESTONES.index(phase)+1]),
                'wall-cap', 'capability-failure')

    def test_replay_budget_survives_m8_boundary_and_multiple_intervals(self):
        initial = ['m2', 'm3', 'm4', 'm5', 'm6']
        result = self.replay_supervision([(101, 'replay-start'), (1101, 'replay-end'),
            (1102, 'm8'), (1103, 'replay-start'), (3103, 'replay-end'),
            (3104, 'replay-start'), (3105, 'replay-end'), (3106, None)], initial)
        self.assertEqual(result['replayWallSeconds'], 3001)
        self.replay_supervision([(101, 'replay-start'), (10101, 'replay-end'),
            (10102, 'm8'), (10103, 'replay-start'), (14503, 'replay-end'), (14504, None)],
            initial, 'wall-cap', 'capability-failure')

    def test_real_convex_m6_replay_then_post_m8_rerun_sequence(self):
        requests = common.read(Path(__file__).parent / 'fixtures/convex-round4-boundaries.json')
        started = 1791235050.714678
        schedule = [(e['at'] - started + 100, e['phase']) for e in requests]
        end = schedule[-1][0] + 2000
        result = self.replay_supervision(schedule + [(end, 'replay-end'), (end+1, None)], [])
        self.assertEqual(result['lastMilestone'], 'm8')
        self.assertAlmostEqual(result['replayWallSeconds'], requests[6]['at'] - requests[5]['at'] + 2000)

    def test_closed_replays_pause_only_their_own_milestone_wall_clock(self):
        self.replay_supervision([(101, 'replay-start'), (1101, 'replay-end'),
            (1102, 'replay-start'), (2102, 'replay-end'), (16500, None), (16501, None)],
            ['m2', 'm3', 'm4', 'm5', 'm6'], 'wall-cap', 'capability-failure')

    def test_round5_only_measures_convex_without_builder_or_sb4_retry(self):
        for code in (0, 2):
            with tempfile.TemporaryDirectory() as d:
                root = Path(d); (root / 'logs').mkdir()
                receipt = {'order': ['convex-after-builder'], 'snapback4DiagnosticRerun': False}
                with patch.object(chain, 'ROOT', root), patch.object(chain, 'host_check'), \
                     patch.object(chain, 'lock'), patch.object(chain, 'verify'), \
                     patch.object(chain, 'round5_admission', return_value=receipt), \
                     patch.object(chain.subprocess, 'run') as run:
                    run.return_value.returncode = code
                    self.assertEqual(chain.main(continue_round5=True), code)
                    run.assert_called_once_with(['bash', str(root / 'after-builder.sh'), 'convex'], cwd=root)
                log = next((root / 'logs').glob('chain-*'))
                self.assertEqual(common.read(log / 'end.json')['exitCode'], code)
                self.assertEqual(common.read(log / 'round5-continuation.json'), receipt)

    def test_real_snapback4_post_m8_replay_sequence(self):
        requests = common.read(Path(__file__).parent / 'fixtures/snapback4-round3-boundaries.json')
        # Preserve real inter-boundary delays against a simulated clock.
        schedule = [(e['at'] - 1791225100.72654 + 100, e['phase']) for e in requests]
        schedule += [(6970, 'replay-end'), (6971, None)]
        result = self.replay_supervision(schedule, [])
        self.assertEqual(result['lastMilestone'], 'm8')

    def convex_reclassification_fixture(self, root):
        requests = common.read(Path(__file__).parent / 'fixtures/convex-round4-boundaries.json')
        lane = root / 'lanes/convex'; logs = root / 'logs/convex'
        common.put(logs / 'boundary-requests.jsonl', ''.join(json.dumps(e)+'\n' for e in requests))
        events = [{'kind': 'boundary', 'phase': e['phase'], 'requestedAt': e['at']} for e in requests[:-1]]
        events.append({'kind': 'replay-end', 'wallSeconds': 1875.452301979065})
        common.put(logs / 'watchdog.jsonl', ''.join(json.dumps(e)+'\n' for e in events))
        common.put(logs / 'end.json', {'outcome': 'setup-failure', 'reason': 'invalid-replay-boundary',
            'lastMilestone': 'm8', 'exitCode': -15, 'at': time.time()+100,
            'termination': {'reason': 'invalid-replay-boundary', 'observedAt': requests[-1]['at']+1},
            'cleanup': {'complete': True}, 'derivedDataCleanup': {'complete': True}})
        common.put(logs / 'phase-token-sampling.json', {'tokens': {'m8': 72525}})
        common.put(lane / 'run-log.md', ''.join(str(1791242600+i)+' '+m+' terminal green\n'
            for i,m in enumerate(common.MILESTONES)))
        common.put(lane / 'evidence/scale-replay-receipt.json', {'pass': True})
        (root / 'runtime/builder-convex/derived-data').mkdir(parents=True)
        (root / 'attempts').mkdir()
        common.put(root / 'PACKET.v5.sha256', 'retained v5 seal')
        common.put(root / 'logs/chain-round4/end.json', {'exitCode': 2})
        with patch.object(round5, 'live_cleanup', return_value={'complete': True}):
            binding = round5.capture(root)
        diagnosis = root / 'metadata/round5-diagnosis.json'
        common.put(diagnosis, {'cause': 'builder-fixture-compose-nonce-before-launch', 'diagnosticRerun': False, 'evidence': {}})
        common.put(root / 'metadata/revision-6.json', {'reclassification': binding,
            'diagnosis': {'path': str(diagnosis.relative_to(root)), 'sha256': common.sha(diagnosis)}})
        return binding

    def test_convex_reclassification_retains_m6_replay_and_consumes_no_setup_rerun(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); binding = self.convex_reclassification_fixture(root)
            with patch.object(round5, 'live_cleanup'):
                receipt = round5.admission(root)
                self.assertEqual(receipt['setupRerunsConsumed'], 0)
                self.assertEqual(receipt['postM8Replay'], round5.MISSING)
                self.assertEqual(receipt['M6Replay']['supervisorWallSeconds'], 1875.452301979065)
                self.assertTrue(receipt['asymmetry'].startswith('resolved:'))
                (root / 'logs/chain-round5').mkdir()
                with self.assertRaisesRegex(RuntimeError, 'already-consumed'): round5.admission(root)
                common.put(root / 'lanes/convex/new-edit', 'changed')
                with self.assertRaisesRegex(RuntimeError, 'custody-drift'): round5.verify_record(root)

    def test_convex_after_builder_requires_sealed_reclassification(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); self.convex_reclassification_fixture(root)
            common.put(root / 'logs/convex/launch.json', {'pid': 1})
            with patch.object(after, 'ROOT', root), patch.object(round5, 'verify_record', return_value={'sealed': True}) as verify:
                self.assertEqual(after.wait_builder('convex')['measurementAdmission'], {'sealed': True})
                verify.assert_called_once_with(root)
            with patch.object(after, 'ROOT', root), patch.object(round5, 'verify_record', side_effect=RuntimeError('seal-drift')):
                with self.assertRaisesRegex(RuntimeError, 'seal-drift'): after.wait_builder('convex')

    def test_convex_reclassification_rejects_missing_green_or_admitted_rerun(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); self.convex_reclassification_fixture(root)
            with (root / 'logs/convex/watchdog.jsonl').open('a') as f:
                f.write(json.dumps({'kind': 'boundary', 'phase': 'replay-start', 'requestedAt': 1791242650.875353})+'\n')
            with self.assertRaisesRegex(RuntimeError, 'admitted-boundaries'): round5.facts(root)
            (root / 'lanes/convex/run-log.md').write_text('1791242650 m8 terminal green\n')
            with self.assertRaisesRegex(RuntimeError, 'authoring-incomplete'): round5.facts(root)

    def test_replay_admission_and_four_hour_ceiling(self):
        for phase in ('m6', 'm8'):
            initial = list(common.MILESTONES[1:common.MILESTONES.index(phase)+1])
            self.replay_supervision([(101, 'replay-start'), (14501, 'replay-end'), (14502, None)],
                initial, 'wall-cap', 'capability-failure')
            self.replay_supervision([(101, 'replay-start'), (102, 'replay-start'), (103, None)],
                initial, 'invalid-replay-boundary', 'setup-failure')
            self.replay_supervision([(101, 'replay-end'), (102, None)],
                initial, 'invalid-replay-boundary', 'setup-failure')
        self.replay_supervision([(101, 'replay-start'), (102, None)], ['m2', 'm3', 'm4', 'm5'],
            'invalid-replay-boundary', 'setup-failure')
        self.replay_supervision([(101, 'replay-start'), (102, 'm8'), (103, None)],
            ['m2', 'm3', 'm4', 'm5', 'm6'], 'milestone-order', 'setup-failure')

    def test_resume_chain_starts_with_measurement(self):
        for failure, count in [(None, 3), (1, 1)]:
            with tempfile.TemporaryDirectory() as d:
                root = Path(d); (root / 'logs').mkdir(); calls = []
                def call(argv, **kw):
                    calls.append(argv[-2:])
                    return type('Result', (), {'returncode': 2 if len(calls) == failure else 0})()
                with patch.object(chain, 'ROOT', root), patch.object(chain, 'host_check'), \
                     patch.object(chain, 'verify'), patch.object(chain, 'lock'), \
                     patch.object(chain, 'resume_admission', return_value={'sha256': 'bound'}), \
                     patch.object(chain.subprocess, 'run', side_effect=call):
                    self.assertEqual(chain.main(resume_reclassification=Path('record.json')), 2 if failure else 0)
                expected = [('after-builder.sh', 'snapback4'), ('launch-builder.sh', 'convex'), ('after-builder.sh', 'convex')]
                self.assertEqual(calls, [[str(root / s), b] for s, b in expected][:count])
                self.assertEqual(common.read(next((root / 'logs').glob('chain-*')) / 'resume.json')['sha256'], 'bound')

    def reclassification_fixture(self, root):
        logs = root / 'logs/snapback4'; logs.mkdir(parents=True)
        lane = root / 'lanes/snapback4'; lane.mkdir(parents=True)
        (lane / 'node_modules').mkdir(); (lane / 'evidence/native-adapter-store').mkdir(parents=True)
        (lane / 'evidence/native-adapter-store/node_modules').symlink_to(lane / 'node_modules')
        (root / 'lanes/convex/instrument').mkdir(parents=True)
        (root / 'runtime/builder-snapback4/derived-data').mkdir(parents=True)
        (root / 'attempts').mkdir()
        common.put(root / 'PACKET.v3.sha256', 'prior seal')
        common.put(logs / 'end.json', {'outcome': 'setup-failure', 'reason': 'invalid-replay-boundary',
            'lastMilestone': 'm8', 'exitCode': -15, 'at': time.time()+100,
            'termination': {'reason': 'invalid-replay-boundary', 'observedAt': time.time()},
            'cleanup': {'complete': True}, 'derivedDataCleanup': {'complete': True}})
        common.put(logs / 'boundary-requests.jsonl', ''.join(json.dumps({'phase': phase, 'at': 10+i})+'\n'
            for i, phase in enumerate([*common.MILESTONES[1:], 'replay-start'])))
        common.put(lane / 'run-log.md', ''.join(str(i+1)+' milestone='+m+' terminal=green\n'
            for i,m in enumerate(common.MILESTONES)))
        common.put(logs / 'watchdog.jsonl', '')
        common.put(logs / 'phase-token-sampling.json', {'tokens': {'m8': 50}})
        common.put(root / 'logs/chain-old/end.json', {'exitCode': 2})
        with patch.object(reclassification, 'live_cleanup', return_value={'complete': True}):
            binding = reclassification.capture(root)
        common.put(root / 'metadata/revision-4.json', {'reclassification': binding})
        return Path(binding['path'])

    def test_reclassification_bound_custody_and_single_resume(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); path = self.reclassification_fixture(root)
            with patch.object(reclassification, 'live_cleanup'):
                self.assertEqual(reclassification.admission(root, path)['setupRerunsConsumed'], 0)
                result = reclassification.verify_record(root)
                self.assertEqual(result['O5'], 'not-executed (harness defect)')
                (root / 'logs/chain-resumed').mkdir()
                with self.assertRaisesRegex(RuntimeError, 'already-consumed'):
                    reclassification.admission(root, path)
                (root / 'logs/chain-resumed').rmdir()
                common.put(root / 'lanes/snapback4/changed-source', 'mutation')
                with self.assertRaisesRegex(RuntimeError, 'custody-drift'):
                    reclassification.verify_record(root)
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); path = self.reclassification_fixture(root)
            record = root / path; record.chmod(0o644); record.write_text('{}')
            with self.assertRaisesRegex(RuntimeError, 'seal-binding'):
                reclassification.verify_record(root, live=False)

    def test_reclassification_refuses_missing_green_caps_and_changed_termination(self):
        for field in ('green', 'cap', 'termination', 'cleanup'):
            with tempfile.TemporaryDirectory() as d:
                root = Path(d); self.reclassification_fixture(root)
                logs = root / 'logs/snapback4'
                if field == 'green': (root / 'lanes/snapback4/run-log.md').write_text('')
                elif field == 'cap': (logs / 'phase-token-sampling.json').write_text(json.dumps({'tokens': {'m8': 2000000}}))
                else:
                    value = common.read(logs / 'end.json')
                    if field == 'termination': value['reason'] = 'wall-cap'
                    else: value['cleanup']['complete'] = False
                    (logs / 'end.json').write_text(json.dumps(value))
                with self.assertRaises(RuntimeError): reclassification.verify_record(root, live=False)

    def test_work_copy_links_relocate_without_touching_source(self):
        import shutil
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); source = root / 'source'; source.mkdir()
            (source / 'node_modules').mkdir(); (source / 'evidence').mkdir()
            (source / 'evidence/node_modules').symlink_to(source / 'node_modules')
            before = common.inventory(source)
            work = root / 'work'; shutil.copytree(source, work, symlinks=True)
            after.relocate_work_links(work, source, root / 'relocations.json')
            self.assertEqual(common.inventory(source), before)
            self.assertEqual((work / 'evidence/node_modules').resolve(), (work / 'node_modules').resolve())
            self.assertEqual(len(common.read(root / 'relocations.json')['links']), 1)
            (work / 'foreign').symlink_to(root / 'foreign')
            with self.assertRaisesRegex(RuntimeError, 'external-work-copy-symlink'):
                after.relocate_work_links(work, source, root / 'refused.json')

    def test_custody_refusal_recovery_preserves_failure_without_product_retry(self):
        import shutil
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); path = self.reclassification_fixture(root)
            common.put(root / 'PACKET.sha256', 'initial revision 4')
            original = common.sha(root / path)
            chain_dir = root / 'logs/chain-refused'
            common.put(chain_dir / 'resume.json', {'sha256': original})
            common.put(chain_dir / 'end.json', {'exitCode': 2})
            common.put(chain_dir / 'steps.jsonl', ''.join(json.dumps({'backend': 'snapback4',
                'script': 'after-builder.sh', 'kind': kind})+'\n' for kind in ('start', 'end')))
            attempt = root / 'results/snapback4/attempt-01'
            summary = {'reason': 'external-work-copy-symlink:evidence/native-adapter-store/node_modules',
                'failureStage': 'operator-setup', 'segments': {}, 'observedProductFailure': False}
            common.put(attempt / 'summary.json', summary)
            inv = common.read(root / reclassification.LOCATION / 'lane.json')['inventory']
            common.put(attempt / 'custody.clone.json', inv)
            shutil.copytree(root / 'lanes/snapback4', root / 'attempts/snapback4-builder-completed', symlinks=True)
            (attempt / 'prepare.log').touch()
            with patch.object(reclassification, 'live_cleanup'):
                with self.assertRaisesRegex(RuntimeError, 'cannot-retry-execution'):
                    reclassification.capture_custody_refusal(root)
                (attempt / 'prepare.log').unlink()
                recovery = reclassification.capture_custody_refusal(root)
                meta = common.read(root / 'metadata/revision-4.json'); meta['custodyRecovery'] = recovery
                (root / 'metadata/revision-4.json').write_text(json.dumps(meta))
                admitted = reclassification.admission(root, path)
                self.assertEqual(admitted['custodyRecovery']['setupRerunsConsumed'], 0)
                self.assertEqual(common.read(root / reclassification.RECOVERY / 'results/attempt-01/summary.json'), summary)
                (root / 'logs/chain-new').mkdir()
                with self.assertRaisesRegex(RuntimeError, 'already-consumed'): reclassification.admission(root, path)

    def test_authored_build_wrapper_binding(self):
        with tempfile.TemporaryDirectory() as d:
            work = Path(d) / 'app'; work.mkdir(); (work / 'build.sh').write_text('exec xcodebuild')
            derived = Path(d) / 'DerivedData'; args = ['bash', 'build.sh', str(derived), common.UDID]
            self.assertTrue(after.build_wrapper(args, work, derived))
            after.check_release_target(args, derived / 'Build/App.app', derived, wrapper=True)
            with self.assertRaisesRegex(RuntimeError, 'dedicated-udid'):
                after.build_wrapper([*args[:-1], 'booted'], work, derived)
            with self.assertRaisesRegex(RuntimeError, 'outside-custody'):
                after.build_wrapper(['bash', '../other.sh', *args[2:]], work, derived)
            (work / 'build.sh').write_text('exec xcodebuild CODE_SIGNING_ALLOWED=NO')
            with self.assertRaisesRegex(RuntimeError, 'signing-required'):
                after.build_wrapper(args, work, derived)
            with self.assertRaisesRegex(RuntimeError, 'outside-fresh'):
                after.check_release_target(args, work / 'App.app', derived, wrapper=True)

    @unittest.skipUnless(sys.platform == 'darwin', 'macOS kernel executable identity')
    def test_live_executable_witness_without_backend_launch(self):
        import importlib.util
        spec = importlib.util.spec_from_file_location('convex_owned', Path(__file__).parent / 'convex-owned.py')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        # Apple's /usr/bin/python3 is a launcher, so use a direct inert image.
        proc = subprocess.Popen(['/bin/sleep', '30'])
        try:
            self.assertEqual(module.image_path(proc.pid), Path('/bin/sleep').resolve())
            self.assertEqual(common.sha(module.image_path(proc.pid)), common.sha('/bin/sleep'))
        finally:
            proc.terminate(); proc.wait(timeout=5)

    def test_convex_requires_both_start_witnesses(self):
        with tempfile.TemporaryDirectory() as d:
            evidence = Path(d) / 'images.jsonl'
            binding = {'binary': '/sealed/binary', 'sha256': 'expected'}
            event = {'kind': 'backend-image', **binding}
            evidence.write_text(json.dumps(event) + '\n')
            with self.assertRaisesRegex(RuntimeError, 'two-start-image'): after.verify_backend_evidence(evidence, binding)
            evidence.write_text((json.dumps(event) + '\n') * 2)
            self.assertEqual(len(after.verify_backend_evidence(evidence, binding)), 2)
            event['sha256'] = 'wrong'; evidence.write_text((json.dumps(event) + '\n') * 2)
            with self.assertRaisesRegex(RuntimeError, 'two-start-image'): after.verify_backend_evidence(evidence, binding)

    def runtime_claim(self, run_id):
        return {'schemaVersion': 'clique-native-runtime-proof.v1', 'pass': True,
            'instrument': '0.4.0-native.2', 'udid': common.UDID,
            'bundleId': 'dev.clique.native.runtimebaseline', 'expo': '57.0.22',
            'reactNative': '0.86.3', 'expoSecureStore': '57.0.4',
            'xcode': 'Xcode 27.0\nBuild version 27A266a', 'iosSdk': '27.0',
            'checks': sorted(runtime_proof.REQUIRED_CHECKS), 'runId': run_id,
            'principal': 'runtime.' + run_id + '@example.com'}

    def test_runtime_proof_rejects_missing_authoritative_input(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); evidence = root / 'preparation/runtime-baseline'; evidence.mkdir(parents=True)
            run_id = '2a1cd94a-0565-49a9-b69b-1de75070f389'; claim = self.runtime_claim(run_id)
            claim.update(inputFiles={}, inputInventorySha256=runtime_proof.inventory_digest({}))
            common.put(evidence / 'runtime-proof.json', claim)
            binding = {'evidenceRoot': 'preparation/runtime-baseline',
                       'proofSha256': common.sha(evidence / 'runtime-proof.json')}
            with patch.object(runtime_proof, 'ROOT', root), \
                 patch.object(runtime_proof, 'expected_proof_inputs', return_value={'helper/index.ts': '0' * 64}):
                with self.assertRaisesRegex(RuntimeError, 'input-inventory-drift'):
                    runtime_proof.verify_runtime_proof(binding)

    def test_runtime_proof_rejects_self_hashed_arbitrary_evidence(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); evidence = root / 'preparation/runtime-baseline'; evidence.mkdir(parents=True)
            for name in runtime_proof.REQUIRED_EVIDENCE:
                path = evidence / name; path.parent.mkdir(parents=True, exist_ok=True); path.write_bytes(b'arbitrary')
            run_id = '2a1cd94a-0565-49a9-b69b-1de75070f389'; claim = self.runtime_claim(run_id)
            claim.update(inputFiles={}, inputInventorySha256=runtime_proof.inventory_digest({}),
                buildInputs={'schemaVersion': 'clique-native-runtime-compiled-inputs.v1',
                    'compiledSourceFiles': {}, 'compiledSourceInventorySha256': runtime_proof.inventory_digest({}),
                    'appFiles': {}, 'originalReceiptSha256': common.sha(evidence / 'runtime-inputs.json')},
                evidenceFiles=runtime_proof.exact_evidence(evidence))
            common.put(evidence / 'runtime-proof.json', claim)
            binding = {'evidenceRoot': 'preparation/runtime-baseline',
                       'proofSha256': common.sha(evidence / 'runtime-proof.json')}
            with patch.object(runtime_proof, 'ROOT', root), \
                 patch.object(runtime_proof, 'expected_proof_inputs', return_value={}), \
                 patch.object(runtime_proof, 'compiled_inputs', return_value={}):
                with self.assertRaises(Exception): runtime_proof.verify_runtime_proof(binding)

    def test_runtime_proof_rejects_false_helper_claims(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'native-observations.jsonl'; claim = self.runtime_claim('2a1cd94a-0565-49a9-b69b-1de75070f389')
            claim.update(nativeSha256='1' * 64, hermesSha256='2' * 64, readyProcessNonces=[])
            event = {'protocol': 'clique-native/1', 'runId': claim['runId'],
                'processNonce': 'a09e9644-4b78-4657-ade7-327935642d18', 'sequence': 1,
                'elapsedMs': 1, 'kind': 'ready', 'payload': {'principal': 'invented',
                    'origin': 'runtime-baseline://local', 'authenticationRestored': True,
                    'build': {'bundleId': claim['bundleId'], 'nativeSha256': claim['nativeSha256'],
                              'hermesSha256': claim['hermesSha256']}, 'development': False}}
            path.write_text(json.dumps(event) + '\n' + json.dumps({**event,
                'processNonce': '71f4971e-01d9-4971-b9d5-13278dd90cf1'}) + '\n')
            with self.assertRaisesRegex(RuntimeError, 'helper-'):
                runtime_proof.validate_helper(path, claim)

    def test_runtime_proof_accepts_valid_prereset_then_two_processes(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'native-observations.jsonl'; claim = self.runtime_claim('2a1cd94a-0565-49a9-b69b-1de75070f389')
            first = 'a09e9644-4b78-4657-ade7-327935642d18'; second = '71f4971e-01d9-4971-b9d5-13278dd90cf1'
            claim.update(nativeSha256='1' * 64, hermesSha256='2' * 64,
                         readyProcessNonces=sorted([first, second]))
            build = {'bundleId': claim['bundleId'], 'nativeSha256': claim['nativeSha256'],
                     'hermesSha256': claim['hermesSha256']}
            def event(nonce, sequence, principal):
                return {'protocol': 'clique-native/1', 'runId': claim['runId'], 'processNonce': nonce,
                    'sequence': sequence, 'elapsedMs': sequence, 'kind': 'ready', 'payload': {
                        'principal': principal, 'origin': 'runtime-baseline://local',
                        'authenticationRestored': True, 'build': build, 'development': False}}
            rows = [event(first, 1, 'runtime.64b3fd4a-e12c-4417-a389-51fdd685bedf@example.com'),
                    event(first, 2, claim['principal']), event(second, 1, claim['principal'])]
            path.write_text(''.join(json.dumps(row) + '\n' for row in rows))
            runtime_proof.validate_helper(path, claim)

    def test_runtime_proof_rejects_stale_principal_on_second_process(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'native-observations.jsonl'; claim = self.runtime_claim('2a1cd94a-0565-49a9-b69b-1de75070f389')
            first = 'a09e9644-4b78-4657-ade7-327935642d18'; second = '71f4971e-01d9-4971-b9d5-13278dd90cf1'
            claim.update(nativeSha256='1' * 64, hermesSha256='2' * 64, readyProcessNonces=sorted([first, second]))
            build = {'bundleId': claim['bundleId'], 'nativeSha256': claim['nativeSha256'], 'hermesSha256': claim['hermesSha256']}
            def event(nonce, sequence, principal):
                return {'protocol': 'clique-native/1', 'runId': claim['runId'], 'processNonce': nonce,
                    'sequence': sequence, 'elapsedMs': sequence, 'kind': 'ready', 'payload': {
                        'principal': principal, 'origin': 'runtime-baseline://local', 'authenticationRestored': True,
                        'build': build, 'development': False}}
            prior = 'runtime.64b3fd4a-e12c-4417-a389-51fdd685bedf@example.com'
            rows = [event(first, 1, claim['principal']), event(second, 1, prior),
                    event(second, 2, claim['principal'])]
            path.write_text(''.join(json.dumps(row) + '\n' for row in rows))
            with self.assertRaisesRegex(RuntimeError, 'helper-processes'):
                runtime_proof.validate_helper(path, claim)

    def test_runtime_proof_rejects_noncanonical_prior_uuid(self):
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'native-observations.jsonl'; claim = self.runtime_claim('2a1cd94a-0565-49a9-b69b-1de75070f389')
            first = 'a09e9644-4b78-4657-ade7-327935642d18'; second = '71f4971e-01d9-4971-b9d5-13278dd90cf1'
            claim.update(nativeSha256='1' * 64, hermesSha256='2' * 64, readyProcessNonces=sorted([first, second]))
            build = {'bundleId': claim['bundleId'], 'nativeSha256': claim['nativeSha256'], 'hermesSha256': claim['hermesSha256']}
            def event(nonce, sequence, principal):
                return {'protocol': 'clique-native/1', 'runId': claim['runId'], 'processNonce': nonce,
                    'sequence': sequence, 'elapsedMs': sequence, 'kind': 'ready', 'payload': {
                        'principal': principal, 'origin': 'runtime-baseline://local', 'authenticationRestored': True,
                        'build': build, 'development': False}}
            upper = 'runtime.64B3FD4A-E12C-4417-A389-51FDD685BEDF@example.com'
            rows = [event(first, 1, upper), event(first, 2, claim['principal']),
                    event(second, 1, claim['principal'])]
            path.write_text(''.join(json.dumps(row) + '\n' for row in rows))
            with self.assertRaisesRegex(RuntimeError, 'helper-processes'):
                runtime_proof.validate_helper(path, claim)

    def test_runtime_proof_rejects_mismatched_qualified_anchor(self):
        with tempfile.TemporaryDirectory() as d:
            native = Path(d); common.put(native / 'QUALIFIED.json', {'runtimeBaseline': {
                'schemaVersion': 'clique-native-runtime-anchor.v1', 'proofSha256': 'wrong',
                'inputInventorySha256': 'a', 'nativeSha256': 'b', 'hermesSha256': 'c'}})
            proof = {'inputInventorySha256': 'a', 'nativeSha256': 'b', 'hermesSha256': 'c'}
            with patch.object(runtime_proof, 'NATIVE', native):
                with self.assertRaisesRegex(RuntimeError, 'qualified-anchor'):
                    runtime_proof.qualified_anchor(proof, 'right')

if __name__ == '__main__': unittest.main(verbosity=2)

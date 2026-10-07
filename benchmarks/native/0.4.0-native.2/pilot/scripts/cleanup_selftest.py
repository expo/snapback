"""Regression coverage for signal races and result-preserving cleanup."""
import errno, signal, subprocess, sys, tempfile, unittest
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock, patch
import common, processes, after, chain, cleanup_recovery

class CleanupSafety(unittest.TestCase):
    def test_completed_cleanup_preserves_every_unowned_simulator(self):
        with tempfile.TemporaryDirectory() as d:
            owner = processes.ProcessOwner(d, {'rootPid': 123, 'known': {}, 'simulatorsBefore': ['baseline'], 'token': 'inert'})
            with patch.object(owner, 'sample', return_value={}), \
                 patch.object(processes, 'booted_simulators', return_value=['baseline', 'other-lane', common.UDID]), \
                 patch.object(processes.subprocess, 'run') as command:
                result = owner.cleanup()
            command.assert_not_called()
            self.assertTrue(result['complete'])
            self.assertEqual(result['simulators'], [])
            self.assertEqual(result['preservedSimulators'], ['other-lane'])

    def test_reclassification_binds_passing_evidence_and_rejects_tampering(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); old = root / cleanup_recovery.OLD
            common.put(old / 'summary.json', {'reason': '[Errno 1] Operation not permitted',
                'outcome': 'handoff-refused-by-semantic-validator', 'failureStage': 'builder-handoff-semantic',
                'segments': {}, 'observedProductFailure': False})
            common.put(old / 'semantic-handoff/native-fixture.json', {'runId': 'retained'})
            common.put(old / 'semantic-handoff/result.json', {'pass': True, 'beforeCompilation': True,
                'beforeDeviceWork': True, 'descriptorSha256': common.sha(old / 'semantic-handoff/native-fixture.json')})
            common.put(old / 'semantic-handoff/validator-exit.json', {'exitCode': 0})
            for name in ('source-audit', 'prepared-source-audit'):
                common.put(old / name / 'schema.json', {'required': ['ready', 'hooksPassive', 'citations', 'findings']})
                common.put(old / name / 'review.json', {'ready': True, 'hooksPassive': True})
            common.put(root / 'logs/snapback4/end.json', {'outcome': 'builder-ended', 'exitCode': 0,
                'lastMilestone': 'm8', 'cleanup': {'complete': True}, 'derivedDataCleanup': {'complete': True}})
            common.put(root / 'logs/chain-original/end.json', {'exitCode': 2})
            for name in ('final-report.md', 'essay.md'): common.put(root / 'lanes/snapback4' / name, 'retained')
            (root / 'scratch/app').mkdir(parents=True)
            (root / 'attempts/snapback4-builder-completed').mkdir(parents=True)
            common.put(old / 'scratch.json', {'path': str(root / 'scratch')})
            common.put(root / 'PACKET.sha256', 'original seal')
            common.put(root / 'PACKET.v7.sha256', 'original seal')
            binding = cleanup_recovery.capture(root)
            common.put(root / 'metadata/revision-8.json', {'reclassification': binding})
            self.assertEqual(cleanup_recovery.verify_record(root)['setupRerunsConsumed'], 0)
            value = common.read(root / binding['path']); self.assertIsNone(value['productOutcome'])
            common.put(root / 'scratch/app/changed', 'drift')
            with self.assertRaisesRegex(RuntimeError, 'retained-drift'): cleanup_recovery.verify_record(root)
            (root / 'scratch/app/changed').unlink()
            common.put(old / 'release-build.log', 'unexpected product execution')
            with self.assertRaisesRegex(RuntimeError, 'prebuild-EPERM'): cleanup_recovery.verify_record(root)
            # Restore permissions for TemporaryDirectory's portable cleanup.
            target = root / cleanup_recovery.LOCATION
            target.chmod(0o755)
            for file in target.iterdir(): file.chmod(0o644)

    def test_stop_rechecks_zombies_after_eperm_in_term_and_final_kill(self):
        for group in (True, False):
            for zombie_signal in (signal.SIGTERM, signal.SIGKILL):
                with self.subTest(group=group, zombie_signal=zombie_signal):
                    state = {'value': 'S'}; signals = []
                    proc = SimpleNamespace(pid=123, poll=Mock(), wait=Mock())
                    def table():
                        return {123: {'pid': 123, 'pgid': 123, 'state': state['value']}}
                    def send(pid, sig):
                        self.assertEqual(pid, 123); signals.append(sig)
                        if sig == zombie_signal: state['value'] = 'Z'
                        raise PermissionError(errno.EPERM, 'Operation not permitted')
                    with patch.object(processes, 'process_table', side_effect=table), \
                         patch.object(common.os, 'killpg' if group else 'kill', side_effect=send):
                        common.stop(proc, grace=0, kill_grace=0, group=group)
                    self.assertIn(zombie_signal, signals); proc.wait.assert_called_once()

    def test_stop_fails_only_when_live_members_survive_escalation(self):
        for error in (PermissionError(errno.EPERM, 'denied'), ProcessLookupError(errno.ESRCH, 'gone')):
            proc = SimpleNamespace(pid=123, poll=Mock(), wait=Mock())
            with patch.object(processes, 'process_table', return_value={
                    123: {'pid': 123, 'pgid': 123, 'state': 'S'}}), \
                 patch.object(common.os, 'killpg', side_effect=error) as send:
                with self.assertRaises(common.HarnessDefect): common.stop(proc, grace=0, kill_grace=0)
            self.assertEqual([c.args[1] for c in send.call_args_list], [signal.SIGTERM, signal.SIGKILL])
            proc.wait.assert_not_called()

    def test_pid_owner_rechecks_eperm_without_harming_foreign_pid(self):
        for survives in (False, True):
            with self.subTest(survives=survives), tempfile.TemporaryDirectory() as d:
                row = {'pid': 123, 'pgid': 123, 'ppid': 1, 'state': 'S', 'started': 'identity', 'executable': 'inert'}
                owner = processes.ProcessOwner(d, {'rootPid': 123, 'known': {'123': row},
                    'simulatorsBefore': [], 'token': 'inert-token'})
                live = {123: row}; sent = []
                def send(pid, sig):
                    sent.append((pid, sig))
                    if not survives: live.clear()
                    raise PermissionError(errno.EPERM, 'denied')
                ticks = iter(range(0, 1000, 100))
                with patch.object(owner, 'sample', side_effect=lambda: dict(live)), \
                     patch.object(processes, 'process_table', return_value={123: row, 999: {**row, 'pid': 999}}), \
                     patch.object(processes, 'booted_simulators', return_value=[]), \
                     patch.object(processes.os, 'kill', side_effect=send), \
                     patch.object(processes.time, 'monotonic', side_effect=lambda: next(ticks)):
                    if survives:
                        with self.assertRaises(common.HarnessDefect): owner.cleanup(grace=0)
                    else: self.assertTrue(owner.cleanup(grace=0)['complete'])
                self.assertTrue(all(pid == 123 for pid, _ in sent))

    def test_command_cleanup_preserves_primary_error_and_success_receipt(self):
        for fails in (False, True):
            with tempfile.TemporaryDirectory() as d:
                log = Path(d) / 'command.log'
                primary = subprocess.TimeoutExpired('inert', 1)
                proc = SimpleNamespace(pid=123, returncode=0,
                    wait=Mock(side_effect=primary) if fails else Mock(return_value=0))
                with patch.object(common.subprocess, 'Popen', return_value=proc), \
                     patch.object(common, 'stop', side_effect=RuntimeError('cleanup broke')):
                    with self.assertRaises(subprocess.TimeoutExpired if fails else common.HarnessDefect) as raised:
                        common.run(['inert'], Path(d), log)
                if fails: self.assertIs(raised.exception, primary)
                receipt = common.read(str(log) + '.json')
                self.assertEqual(receipt['exitCode'], 0)
                self.assertEqual(receipt['cleanupErrors'][0]['outcomeClass'], 'operator-setup')

    def test_resume_chain_runs_fresh_measurement_then_unchanged_convex(self):
        for fail_first in (False, True):
            with tempfile.TemporaryDirectory() as d:
                root = Path(d); (root / 'logs').mkdir(); calls = []
                def invoke(argv, **kw):
                    calls.append(argv)
                    return SimpleNamespace(returncode=2 if fail_first else 0)
                with patch.object(chain, 'ROOT', root), patch.object(chain, 'host_check'), \
                     patch.object(chain, 'lock'), patch.object(chain, 'verify'), \
                     patch.object(chain, 'cleanup_admission', return_value={'order': ['snapback4-after-builder', 'convex-builder', 'convex-after-builder']}), \
                     patch.object(chain.subprocess, 'run', side_effect=invoke):
                    self.assertEqual(chain.main(resume_cleanup_refusal=True), 2 if fail_first else 0)
                self.assertEqual(calls[0][1:], [str(root / 'after-builder.sh'), 'snapback4', '--resume-cleanup-refusal'])
                if fail_first: self.assertEqual(len(calls), 1)
                else:
                    self.assertEqual(calls[1][1:], [str(root / 'launch-builder.sh'), 'convex'])
                    self.assertEqual(calls[2][1:], [str(root / 'after-builder.sh'), 'convex'])

    def test_resume_admission_rejects_reuse_or_warm_convex(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / 'logs/prior').mkdir(parents=True)
            (root / 'results/snapback4/attempt-01').mkdir(parents=True)
            (root / 'lanes/convex/instrument').mkdir(parents=True)
            receipt = {'priorChains': []}
            with patch.object(cleanup_recovery, 'verify_record', return_value=receipt):
                (root / 'logs/chain-new').mkdir()
                with self.assertRaisesRegex(RuntimeError, 'already-consumed'): cleanup_recovery.admission(root)
                (root / 'logs/chain-new').rmdir()
                (root / 'results/snapback4/attempt-02').mkdir()
                with self.assertRaisesRegex(RuntimeError, 'measurement-already-started'): cleanup_recovery.admission(root)
                (root / 'results/snapback4/attempt-02').rmdir()
                common.put(root / 'lanes/convex/changed', 'not cold')
                with self.assertRaisesRegex(RuntimeError, 'convex-not-cold'): cleanup_recovery.admission(root)

"""Regressions for Node pinning, generated-file custody and one-use recovery."""
import os, subprocess, tempfile, unittest
from pathlib import Path
from unittest.mock import patch
import common, xcode_environment as xe, environment_recovery as er

class EnvironmentSafety(unittest.TestCase):
    def test_normalization_preserves_original_bytes_and_custody_for_both_lanes(self):
        for backend in common.BACKENDS:
            with self.subTest(backend=backend), tempfile.TemporaryDirectory() as d:
                root = Path(d); node = root / 'node'; node.write_text('#!/bin/sh\necho v24.18.0\n'); node.chmod(0o755)
                work = root / backend; (work / 'ios').mkdir(parents=True)
                local = work / 'ios/.xcode.env.local'; original = b'export NODE_BINARY=/wrong/node\n'
                local.write_bytes(original); local.chmod(0o444)
                authored = work / 'ios/.xcode.env'; authored.write_text('authored input\n')
                with patch.object(xe, 'node_path', return_value=node):
                    row = xe.normalize(work, root / 'before.json', os.environ)
                    self.assertEqual(row['before']['content'], original.decode())
                    self.assertEqual(row['before']['sha256'], common.hashlib.sha256(original).hexdigest())
                    self.assertIn(str(node), local.read_text())
                    first = local.read_bytes()
                    # CocoaPods recreating a stale file must be repaired again.
                    local.write_bytes(original)
                    xe.normalize(work, root / 'after.json', os.environ)
                    self.assertEqual(local.read_bytes(), first)
                    self.assertEqual(authored.read_text(), 'authored input\n')
                    with self.assertRaises(FileExistsError): xe.normalize(work, root / 'before.json', os.environ)

    def test_normalization_refuses_symlink_and_wrong_node(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); node = root / 'node'; node.write_text('#!/bin/sh\necho v24.18.0\n'); node.chmod(0o755)
            (root / 'app/ios').mkdir(parents=True); outside = root / 'outside'; outside.write_text('unchanged')
            (root / 'app/ios/.xcode.env.local').symlink_to(outside)
            with patch.object(xe, 'node_path', return_value=node):
                with self.assertRaisesRegex(common.HarnessDefect, 'regular-file'): xe.normalize(root / 'app', root / 'receipt.json', os.environ)
                self.assertEqual(outside.read_text(), 'unchanged')
                node.write_text('#!/bin/sh\necho v26.9.0\n')
                with self.assertRaisesRegex(common.HarnessDefect, 'pin-drift'): xe.normalize(root / 'app', root / 'receipt.json', os.environ)

    def test_absent_ios_is_recorded_without_creating_project(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); node = root / 'node'; node.write_text('#!/bin/sh\necho v24.18.0\n'); node.chmod(0o755)
            with patch.object(xe, 'node_path', return_value=node):
                row = xe.normalize(root, root / 'receipt.json', os.environ)
                self.assertFalse(row['before']['exists']); self.assertIsNone(row['afterContent'])
                self.assertFalse((root / 'ios').exists())

    def test_builder_shell_reasserts_pin_after_login_path_reset(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); node = xe.node_path(root); node.parent.mkdir(parents=True)
            node.write_text('#!/bin/sh\necho pinned\n'); node.chmod(0o755)
            bad = root / 'brew'; bad.mkdir(); (bad / 'node').write_text('#!/bin/sh\necho wrong\n'); (bad / 'node').chmod(0o755)
            env = xe.pinned_environment({'PATH': str(bad) + ':/bin'}, root)
            self.assertEqual(subprocess.check_output(['node'], env=env, text=True).strip(), 'pinned')
            startup = root / 'profile'; startup.write_text(xe.shell_startup(root))
            self.assertEqual(subprocess.check_output(['/bin/sh', '-c', 'PATH="$1:/bin"; . "$2"; node', 'probe', str(bad), str(startup)], text=True).strip(), 'pinned')

    def test_recovery_refuses_other_checks_and_native_outcomes(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); old = root / er.OLD
            summary = {'outcome': 'handoff-refused-by-source-audit', 'segments': {}, 'observedProductFailure': False, 'cleanupComplete': True}
            common.put(old / 'summary.json', summary)
            common.put(old / 'source-audit/schema.json', {'required': ['ready', 'releaseTargetBound', 'hooksPassive', 'findings', 'citations']})
            review = {'ready': False, 'releaseTargetBound': False, 'hooksPassive': False, 'findings': ['ios/.xcode.env.local'], 'citations': ['a:1']}
            common.put(old / 'source-audit/review.json', review)
            with self.assertRaisesRegex(RuntimeError, 'other-audit'): er.facts(root)
            (old / 'm6').mkdir()
            with self.assertRaisesRegex(RuntimeError, 'prebuild'): er.facts(root)

    def test_recovery_admission_is_one_use(self):
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / 'logs/chain-old').mkdir(parents=True)
            (root / 'results/convex/attempt-01').mkdir(parents=True)
            receipt = {'priorChains': ['chain-old']}
            with patch.object(er, 'verify_record', return_value=receipt), patch('processes.ProcessOwner.resume') as resume, patch.object(er, 'free_ports'):
                resume.return_value.sample.return_value = []
                self.assertEqual(er.admission(root), receipt)
                (root / 'results/convex/attempt-02').mkdir()
                with self.assertRaisesRegex(RuntimeError, 'measurement-already'): er.admission(root)
                (root / 'logs/chain-new').mkdir()
                with self.assertRaisesRegex(RuntimeError, 'already-consumed'): er.admission(root)

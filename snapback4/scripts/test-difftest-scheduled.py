#!/usr/bin/env python3
"""Runner failure, rotation and ticket tests. Never install a schedule or push."""
import importlib.util
import json
import os
from pathlib import Path
import subprocess
import tempfile
import sys
import unittest
from unittest.mock import patch

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def load(name):
    spec = importlib.util.spec_from_file_location(name, HERE / f'{name}.py')
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


tickets = load('difftest-tickets')
runner = load('difftest-scheduled')


class ScheduledTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='quarry-schedule-test-')
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        (self.repo / 'issues').mkdir()
        self.run = self.root / 'run'
        found = self.run / 'stores' / 'test-control--data--int'
        found.mkdir(parents=True)
        historical = ROOT / 'snapback4/crates/snapback4-difftest/cases/found/rewrite-let--refusal--NULL_ASSERT'
        self.artifact = json.loads((historical / 'case.json').read_text())
        self.artifact['finding']['signature'] = 'test-control--data--int'
        self.signature = self.artifact['finding']['signature']
        (found / 'case.json').write_text(json.dumps(self.artifact))
        (found / 'case.q').write_text((historical / 'case.q').read_text())
        self.found = found
        self.preview = self.root / 'preview'

    def tearDown(self):
        self.temp.cleanup()

    def file(self, run_id='fixture-1'):
        return tickets.file_tickets(self.repo, self.run, 'a' * 40, run_id,
                                    output=self.preview, date='2026-10-07')

    def test_dry_run_filing_extract_and_idempotent_recurrence(self):
        first = self.file()[0]
        self.assertEqual(list((self.repo / 'issues').iterdir()), [])
        self.assertEqual(self.file(), [])
        self.assertEqual(self.file('fixture-2'), [first])
        text = first.read_text()
        self.assertEqual(text.count('run `fixture-2`'), 1)
        destination = self.root / 'extracted'
        tickets.extract(first, destination)
        self.assertEqual(json.loads((destination / 'case.json').read_text()), self.artifact)
        self.assertEqual((destination / 'case.q').read_text(), (self.found / 'case.q').read_text())

    def test_open_only_search_ignores_closed_shelved_and_status_closed(self):
        text = self.file()[0].read_text()
        for directory in ['closed', 'shelved']:
            (self.repo / 'issues' / directory).mkdir()
            (self.repo / 'issues' / directory / 'old.md').write_text(text)
        (self.repo / 'issues' / 'closed-status.md').write_text(text.replace('**Status:** Open', '**Status:** Closed'))
        self.assertEqual(tickets.open_tickets(self.repo, self.signature), [])
        existing = self.repo / 'issues' / 'existing.md'
        existing.write_text(text)
        # Remove the preview from the previous fixture to model a new run.
        for p in (self.preview / 'issues').iterdir():
            p.unlink()
        paths = self.file('new-run')
        self.assertEqual([p.name for p in paths], ['existing.md'])
        self.assertNotIn('new-run', existing.read_text())
        self.assertIn('new-run', paths[0].read_text())

    def test_stability_replay_twice_and_refuse_a_pass(self):
        binary = self.root / 'fake-replay'
        binary.write_text('#!/usr/bin/env python3\nimport json,sys\nprint(json.dumps({"signature":' + repr(self.signature) + '}))\nsys.exit(1)\n')
        binary.chmod(0o755)
        with patch.object(tickets, 'publish', side_effect=AssertionError('no publishing in a dry run')):
            paths = tickets.file_tickets(self.repo, self.run, 'b' * 40, 'stable-fixture', binary=binary, output=self.preview)
        self.assertEqual(len(paths), 1)
        self.assertEqual(len(list(self.run.glob('replay-*.log'))), 2)
        binary.write_text('#!/usr/bin/env python3\nprint("pass")\n')
        with self.assertRaisesRegex(RuntimeError, 'unstable'):
            tickets.file_tickets(self.repo, self.run, 'b' * 40, 'unstable', binary=binary, output=self.preview)

    def test_empty_or_partial_campaign_never_validates(self):
        report = {'cases': 10, 'generated': 9, 'compiled': 9, 'generator_errors': {},
                  'binder_refused_unexpected': 0, 'runtime_refused_unexpected': {}, 'by_oracle': {}}
        path = self.root / 'report.json'
        path.write_text(json.dumps(report))
        with self.assertRaisesRegex(RuntimeError, 'incomplete'):
            runner.validate_report(path, 10, True)
        report.update(generated=10, compiled=10)
        report['by_oracle'] = {name: {'attempted': 10, 'passed': 0, 'disagreeing': 0, 'unsupported': {'example': 10}}
                               for name in ['store-postgres-on', 'store-postgres-off']}
        path.write_text(json.dumps(report))
        with self.assertRaisesRegex(RuntimeError, 'no supported work'):
            runner.validate_report(path, 10, True)

    def test_atomic_seed_state(self):
        path = self.root / 'next-seed.json'
        runner.atomic_json(path, {'version': 1, 'next_seed': 1_000_000})
        self.assertEqual(json.loads(path.read_text())['next_seed'], 1_000_000)
        self.assertFalse(path.with_suffix('.tmp').exists())

    def test_clean_fast_forward_and_dirty_or_diverged_refusal(self):
        def git(*args):
            return subprocess.check_output(['git', '-C', str(self.repo), *args], text=True, stderr=subprocess.DEVNULL).strip()
        git('init')
        git('config', 'user.name', 'Quarry test')
        git('config', 'user.email', 'noreply@example.invalid')
        git('config', 'core.hooksPath', '/dev/null')
        (self.repo / 'example').write_text('one')
        git('add', 'example'); git('commit', '-m', 'scratch fixture')
        first = git('rev-parse', 'HEAD')
        (self.repo / 'example').write_text('two')
        git('commit', '-am', 'scratch successor')
        second = git('rev-parse', 'HEAD')
        git('update-ref', 'refs/remotes/origin/main', second)
        git('reset', '--hard', first)
        original = runner.tickets.git
        def local_fetch(root, *args, **kwargs):
            if args == ('fetch', 'origin'):
                return subprocess.CompletedProcess(args, 0, '', '')
            return original(root, *args, **kwargs)
        with patch.object(runner.tickets, 'git', side_effect=local_fetch):
            self.assertEqual(runner.clean_fast_forward(self.repo), second)
            (self.repo / 'untracked').write_text('do not discard')
            with self.assertRaisesRegex(RuntimeError, 'dirty'):
                runner.clean_fast_forward(self.repo)
            (self.repo / 'untracked').unlink()
            git('update-ref', 'refs/remotes/origin/main', first)
            with self.assertRaisesRegex(RuntimeError, 'cannot fast-forward'):
                runner.clean_fast_forward(self.repo)

    def test_completed_and_failed_runs_rotate_only_after_cleanup(self):
        # Simulated tools test scheduling/state behavior, not store correctness.
        for fail_start, external, calibrate in [(True,False,False),(False,False,False),(False,True,False),(False,True,True)]:
            state=self.root / f'state-{fail_start}-{external}-{calibrate}'
            lock=state / 'lock'; lock.mkdir(parents=True)
            (lock / 'owner.json').write_text(json.dumps({'pid':os.getpid(),'host':runner.platform.node()}))
            binary=self.root / 'target/release/snapback4-difftest'
            binary.parent.mkdir(parents=True,exist_ok=True); binary.write_text('test fixture binary')
            pg=self.root / f'pg-{fail_start}-{external}-{calibrate}'; pg.mkdir()
            calls=[]
            def command(command, **kwargs):
                command=list(map(str,command)); calls.append(command)
                if command[0]=='initdb':
                    (pg/'data').mkdir()
                    return 0
                if command[0]=='pg_ctl' and command[-1]=='start':
                    if fail_start: return 2
                    (pg/'data/postmaster.pid').write_text('fixture')
                if command[0]=='pg_ctl' and command[-1]=='stop':
                    (pg/'data/postmaster.pid').unlink()
                if len(command)>1 and command[1] in ['run','run-stores']:
                    output=Path(command[command.index('--out')+1]); output.mkdir()
                    names=['repeat','meter'] if command[1]=='run' else ['store-postgres-on','store-postgres-off']
                    (output/'report.json').write_text(json.dumps({'cases':int(command[command.index('--cases')+1]),'generated':int(command[command.index('--cases')+1]),'compiled':int(command[command.index('--cases')+1]),
                        'generator_errors':{},'binder_refused_unexpected':0,'runtime_refused_unexpected':{},
                        'by_oracle':{n:{'attempted':int(command[command.index('--cases')+1]),'passed':int(command[command.index('--cases')+1]),'disagreeing':0} for n in names}}))
                return 0
            def git(_root,*args,**kwargs):
                return subprocess.CompletedProcess(args,0,'a'*40 if args==('rev-parse','HEAD') else '', '')
            def toolchain(command,**kwargs):
                return json.dumps({'target_directory':str(self.root/'target')}) if 'metadata' in command else 'fixture toolchain'
            argv=['runner','--checkout',str(self.repo),'--state-dir',str(state),'--cases','10','--dry-run','--prepared-commit','a'*40]
            if external: argv += ['--external-postgres','host=test-external user=test']
            if calibrate: argv[argv.index('--cases'):argv.index('--cases')+2] = ['--hours','0.01']
            with patch.object(sys,'argv',argv), patch.object(runner,'run',side_effect=command), \
                 patch.object(runner.tickets,'git',side_effect=git), patch.object(runner.subprocess,'check_output',side_effect=toolchain), \
                 patch.object(runner.tempfile,'mkdtemp',return_value=str(pg)), patch.object(runner.platform,'platform',return_value='fixture-host'), patch.dict(os.environ,{}):
                status=runner.main()
            self.assertEqual(status,2 if fail_start else 0)
            self.assertFalse(lock.exists())
            self.assertEqual((state/'next-seed.dry-run.json').exists(),not fail_start)
            self.assertFalse((state/'next-seed.json').exists())
            if not fail_start:
                next_seed=json.loads((state/'next-seed.dry-run.json').read_text())['next_seed']
                self.assertGreaterEqual(next_seed,256) if calibrate else self.assertEqual(next_seed,10)
                if external:
                    self.assertFalse(any(c[0] in ['initdb','pg_ctl'] for c in calls))
                    self.assertTrue(any(c[0]=='psql' for c in calls))
                else:
                    self.assertEqual(calls[-1][-1],'stop')
                    start=next(c for c in calls if c[0]=='pg_ctl' and c[-1]=='start')
                    for setting in ['fsync=off','synchronous_commit=off','full_page_writes=off','shared_buffers=1GB','max_connections=200']:
                        self.assertIn(setting,' '.join(start))
            report=json.loads(next((state/'runs').glob('*/run.json')).read_text())
            self.assertEqual(report['status'],'failed' if fail_start else 'completed')

    def test_owned_worker_group_is_stopped_on_timeout(self):
        with self.assertRaises(subprocess.TimeoutExpired):
            runner.run(['python3', '-c', 'import time; time.sleep(30)'], timeout=0.1, supervise=True)


if __name__ == '__main__':
    unittest.main()

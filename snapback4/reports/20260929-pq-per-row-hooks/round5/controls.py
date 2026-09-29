"""Run detecting removals in isolated SDK copies inside this worktree."""
from pathlib import Path
import os, re, shutil, subprocess, tempfile
root = Path.cwd()
report = root / 'reports/20260929-pq-per-row-hooks/round5'
variants = [
 ('subscription-acquires', 'local', 'scheduleExpiry(watch, d.device, d.server, d.localWakeup); void scheduleRead(watch);', 'scheduleExpiry(watch, d.device, d.server, d.localWakeup); void acquireRead(watch);', 'starts a bounded episode', 'raw-read-deadlines'),
 ('no-local-change-version', 'local', 'watch.changeVersion = (watch.changeVersion ?? 0) + 1;', '', 'changes retire', 'per-row-inflight'),
 ('final-change-version', 'local', 'if (signal.aborted || closed || watches.get(watch.key) !== watch || resetVersion !== watch.resetVersion || changeVersion !== watch.changeVersion)', 'if (signal.aborted || closed || watches.get(watch.key) !== watch || resetVersion !== watch.resetVersion)', 'final callback checks a change version', 'per-row-inflight'),
 ('local-running-episode', 'local', 'watch.reload({ queued: true }); notify(watch); acquireRead(watch);', 'watch.reload({ queued: !watch.running }); notify(watch); acquireRead(watch);', 'invalidating an acquisition', 'per-row-inflight'),
 ('commit-running-episode', 'local-reads', 'else watch.reload({ queued: true });', 'else watch.reload({ queued: !watch.running });', 'invalidating an acquisition', 'per-row-inflight'),
 ('online-running-episode', 'client', 'watch.reload({ queued: true }); notify(watch);', 'watch.reload({ queued: !watch.inFlight }); notify(watch);', 'invalidating an acquisition', 'per-row-inflight'),
 ('online-retry-episode', 'read-observation', 'if (this.kept) this.reload();', '', 'online: invalidating an acquisition', 'per-row-inflight'),
 ('clear-order-barrier', 'local-reads', 'this.forget(key);', 'this.answers.delete(key); this.written.delete(key);', 'selective clear fences', 'remembered-answers'),
 ('no-final-abort', 'local', 'if (signal.aborted || closed || watches.get(watch.key) !== watch || resetVersion !== watch.resetVersion || changeVersion !== watch.changeVersion)', 'if (closed || watches.get(watch.key) !== watch || resetVersion !== watch.resetVersion || changeVersion !== watch.changeVersion)', 'cancellation after checkRead', 'per-row-retention'),
]

with tempfile.TemporaryDirectory(prefix='.pq-r5-controls-', dir=root) as directory:
 home = Path(directory) / 'snapback4'; package = home / 'packages/snapback4'
 package.mkdir(parents=True); original = root / 'packages/snapback4'
 for name in ['dist', 'test', 'src']: shutil.copytree(original / name, package / name)
 for name in ['node_modules', 'apps', 'witness']: (home / name).symlink_to(root / name, target_is_directory=True)
 (package / 'node_modules').symlink_to(original / 'node_modules', target_is_directory=True)
 for path in [Path('package.json'), Path('packages/snapback4/package.json')]: shutil.copy(root / path, home / path)
 env = {**os.environ, 'SNAPBACK4_BIN': str(root / 'target/debug/snapback4')}
 for name, module, old, new, pattern, test in variants:
  if os.environ.get('PQ_CONTROL_ONLY') and name != os.environ['PQ_CONTROL_ONLY']: continue
  paths = [package / 'dist' / (module + '.js'), package / 'src' / (module + '.ts')]
  saved = {path: path.read_text() for path in paths}
  pattern_source = r'\s*'.join(map(re.escape, re.findall(r'\S+', old)))
  try:
   for path, source in saved.items():
    assert len(re.findall(pattern_source, source)) == 1, (name, str(path), len(re.findall(pattern_source, source)))
    path.write_text(re.sub(pattern_source, lambda _: new, source))
   with (report / (name + '.log')).open('w') as log:
    run = subprocess.run(['node', '--test', '--test-name-pattern=' + pattern, str(package / 'test' / (test + '.test.mjs'))], env=env, stdout=log, stderr=subprocess.STDOUT, timeout=90)
   output = (report / (name + '.log')).read_text()
   print(name, run.returncode, '\n' + '\n'.join(line for line in output.splitlines() if line.startswith(('ℹ tests', 'ℹ pass', 'ℹ fail', '✖ '))), flush=True)
   assert run.returncode == 1 and re.search(r'ℹ fail [1-9]', output), name + ' survived or failed outside tests'
  finally:
   for path, source in saved.items(): path.write_text(source)

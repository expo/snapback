"""Run detecting removals in isolated SDK copies inside this worktree."""
from pathlib import Path
import os, re, shutil, subprocess, tempfile
root = Path.cwd()
report = root / 'reports/20260929-pq-per-row-hooks/round4'
variants = [
 ('local-sweep-reloads', 'local', 'localReadDeadlines(watches, answers, clock, () => closed, () => unavailable(), acquireRead)', 'localReadDeadlines(watches, answers, clock, () => closed, () => unavailable(), scheduleRead)', 'queued publication rechecks', 'per-row-boundaries'),
 ('online-sweep-reloads', 'client', 'watch => { if (watches.get(watch.key) === watch) void acquireRead(watch); }', 'watch => { if (watches.get(watch.key) === watch) void scheduleRead(watch); }', 'held-only expiry preserves', 'per-row-retention'),
 ('sign-out-reloads', 'local', 'if (closed || sessionDead) return; watch.reload', 'if (closed) return; watch.reload', 'sign-out never replaces', 'per-row-retention'),
 ('missing-footprint', 'local', 'answers.committed(affected, operation, touched)', 'answers.committed(affected, operation)', 'unrelated replicated write', 'per-row-retention'),
 ('clear-all-memory', 'local-reads', 'this.serverAnswers.clear(reset ? undefined : touched)', 'this.serverAnswers.clear()', 'remembered dependencies', 'per-row-retention'),
 ('episode-at-enqueue', 'read-observation', 'revalidatingAnswer(this.snapshot, !queued && !this.linger)', 'revalidatingAnswer(this.snapshot, !this.linger)', 'queued keep=undefined', 'per-row-retention'),
 ('episode-at-enqueue-react', 'read-observation', 'revalidatingAnswer(this.snapshot, !queued && !this.linger)', 'revalidatingAnswer(this.snapshot, !this.linger)', 'with the real clock', 'per-row-react'),
 ('callback-reset', 'local', 'if (signal.aborted || closed || watches.get(watch.key) !== watch || resetVersion !== watch.resetVersion)', 'if (signal.aborted || closed || watches.get(watch.key) !== watch)', 'reset after the early fence', 'per-row-retention'),
 ('no-attempt-episode', 'local', 'if (watch.kept) watch.reload();', '', 'active attempt has its own bounded episode', 'per-row-retention'),
]
with tempfile.TemporaryDirectory(prefix='.pq-r4-controls-', dir=root) as directory:
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

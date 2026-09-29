"""Run detecting removals in isolated SDK copies inside this worktree."""
from pathlib import Path
import os, re, shutil, subprocess, tempfile
root = Path.cwd()
report = root / 'reports/20260929-pq-per-row-hooks/round6'
variants = [
 ('presence-final-callback', 'local', 'if (watches.get(watch.key) !== watch || watch.snapshot !== shown || watch.running || watch.changeVersion !== changeVersion) return false;', 'if (watches.get(watch.key) !== watch || watch.snapshot !== shown || watch.running) return false;', 'queued presence checks a second change at the callback', 'per-row-boundaries'),
 ('memory-checkpoint', 'local-query', 'if (origin === "server" || origin === "composed") { checkpoint();', 'if (origin === "server" || origin === "composed") {', 'final memory checkpoint', 'remembered-answers'),
 ('presence-generation', 'local', 'const owner = watch ?? backgroundWatch, changeVersion = owner?.changeVersion;', 'const owner = watch, changeVersion = owner?.changeVersion;', 'queued presence checks a second change at the response', 'per-row-boundaries'),
 ('selective-forget', 'local-reads', 'this.answers.delete(key); this.fence(key);', 'this.answers.delete(key); this.written.delete(key);', 'selective deletion rejects', 'remembered-answers'),
 ('request-listeners', 'read-work', 'return run(controller.signal).finally(clean);', 'return run(controller.signal);', 'request abort listeners', 'per-row-work'),
]

with tempfile.TemporaryDirectory(prefix='.pq-r6-controls-', dir=root) as directory:
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

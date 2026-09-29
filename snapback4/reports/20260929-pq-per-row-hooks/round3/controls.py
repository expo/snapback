"""Mutate isolated built SDK copies; never edit the live checkout's artifacts."""
from pathlib import Path
import os, re, shutil, subprocess, tempfile
root = Path.cwd()
report = root / 'reports/20260929-pq-per-row-hooks/round3'
variants = [
 ('queued-withdrawal', 'local', 'watch.reload();\n        notify(watch);\n        acquireRead(watch);', 'if (watch.retain) { watch.reload(); notify(watch); }\n        acquireRead(watch);', 'keep=false: a full queue', 'per-row-boundaries'),
 ('late-queued-floor', 'local', 'if (withdrawnLocalResult(watches.values(), watch, result))\n                return;', 'if (result.deadlineWithdrawn) return;', 'queued publication rechecks', 'per-row-boundaries'),
 ('late-presence-floor', 'local', 'if (withdrawnLocalResult(watches.values(), watch, result)) {', 'if (result.deadlineWithdrawn) {', 'presence publication rechecks', 'per-row-boundaries'),
 ('online-abort-diagnostic', 'client', 'if (signal?.aborted)\n                return { ok: false };', '', 'online: cancelled transport', 'per-row-liveness'),
 ('local-abort-diagnostic', 'local', 'if (signal?.aborted)\n                return { ok: false };', '', '(?:wasm|process): cancelled transport', 'per-row-liveness'),
 ('due-online-newer', 'client', 'if (!storeRefusal && result.nextExpiry !== null && result.nextExpiry <= clock.estimatedServerNow() && "data" in watch.snapshot && answerIdentity(watch.snapshot) !== startedWith) { retryExpired = true; return; }', '', 'online.*due completion', 'per-row-retry'),
 ('due-local-newer', 'local', 'if (retryExpired && "data" in watch.snapshot && answerIdentity(watch.snapshot) !== startedWith) return;', '', '(?:wasm|process).*due completion', 'per-row-retry'),
 ('backoff-holds-slot', 'local', 'readWork.retry(watch, Math.min(25 * 2 ** (watch.expiredRetries - 1), 1000), signal => rerun(watch, signal));', 'await new Promise(resolve => setTimeout(resolve, 25)); readWork.schedule(watch, signal => rerun(watch, signal));', 'eight expiry backoffs', 'per-row-retry'),
 ('accept-floor', 'client', 'if (result.deadlineWithdrawn?.()) return true;', '', 'accept-time floor', 'per-row-retry'),
 ('delayed-cancel', 'read-work', 'const delayed = this.stopDelay(watch), pending = this.pending.delete(watch), active = this.active.get(watch);', 'const delayed = false, pending = this.pending.delete(watch), active = this.active.get(watch);', 'delayed retries cancel', 'per-row-retry'),
 ('delayed-invalidation', 'read-work', 'this.stopDelay(watch); this.pending.set(watch, run);', 'this.pending.set(watch, run);', 'delayed retries cancel', 'per-row-retry'),
 ('delayed-stale-callback', 'read-work', 'if (this.delayed.get(watch) !== timer) return;', '', 'close watch, keep=true', 'expired-server-watch'),
]
with tempfile.TemporaryDirectory(prefix='.pq-r3-controls-', dir=root) as directory:
 home = Path(directory) / 'snapback4'; package = home / 'packages/snapback4'
 package.mkdir(parents=True); original = root / 'packages/snapback4'
 for name in ['dist', 'test', 'src']: shutil.copytree(original / name, package / name)
 (package / 'node_modules').symlink_to(original / 'node_modules', target_is_directory=True)
 shutil.copy(original / 'package.json', package / 'package.json')
 env = {**os.environ, 'SNAPBACK4_BIN': str(root / 'target/debug/snapback4')}
 for name, module, old, new, pattern, test in variants:
  if os.environ.get('PQ_CONTROL_ONLY') and name != os.environ['PQ_CONTROL_ONLY']: continue
  path = package / 'dist' / (module + '.js'); source = path.read_text()
  pattern_source = r"\s+".join(map(re.escape, old.split()))
  assert len(re.findall(pattern_source, source)) == 1, (name, len(re.findall(pattern_source, source)))
  try:
   path.write_text(re.sub(pattern_source, lambda _: new, source))
   with (report / (name + '.log')).open('w') as log:
    run = subprocess.run(['node', '--test', '--test-name-pattern=' + pattern, str(package / 'test' / (test + '.test.mjs'))], env=env, stdout=log, stderr=subprocess.STDOUT, timeout=60)
   print(name, run.returncode, flush=True)
   assert run.returncode == 1, name + ' survived'
  finally: path.write_text(source)

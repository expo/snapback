"""Final affected checks and saved measurement artifacts; no benchmark overlap."""
from pathlib import Path
import datetime, hashlib, json, os, shutil, subprocess

root = Path(__file__).resolve().parents[3]
repo = root.parent
tools = Path(__file__).resolve().parent
report = tools.parent / 'round5'
artifacts = root / 'target/bg-round5-artifacts'
env = {**os.environ, 'LIBSQLITE3_FLAGS': '-USQLITE_ENABLE_MEMORY_MANAGEMENT'}

def run(name, args, extra=None):
    print('START', name, flush=True)
    with (report / (name + '.log')).open('w') as out:
        result = subprocess.run(args, cwd=root, env={**env, **(extra or {})}, stdout=out, stderr=subprocess.STDOUT)
    (report / (name + '.exit')).write_text(str(result.returncode) + '\n')
    print('END', name, result.returncode, flush=True)
    if result.returncode: raise SystemExit(result.returncode)

files = json.loads((tools.parent / 'round4/final-source.json').read_text())['files']
for p in subprocess.check_output(['git', 'ls-files', '--others', '--exclude-standard', 'snapback4/crates'], cwd=repo, text=True).splitlines():
    files[p] = ''
files = {p: hashlib.sha256((repo / p).read_bytes()).hexdigest() for p in sorted(files)}
(report / 'final-source.json').write_text(json.dumps({'captured': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=repo, text=True).strip(), 'files': files}, indent=2) + '\n')

for name, args in [
    ('core-final', ['-p', 'snapback4-core', '--lib', 'engine::row_views', '--', '--nocapture']),
    ('witness-final', ['-p', 'snapback4-core', '--test', 'row_view_witness', '--', '--nocapture']),
    ('device-final', ['-p', 'snapback4-device', '--test', 'row_view_expiry', '--', '--nocapture']),
    ('admission-final', ['-p', 'snapback4-lang', '--test', 'row_keyed_views', '--', '--nocapture']),
    ('http-final', ['-p', 'snapback4', '--test', 'clock', 'maintained_value_rule', '--', '--nocapture']),
    ('scale-final', ['-p', 'snapback4', '--test', 'scale_row_ranges', '--', '--nocapture']),
    ('guide-final', ['-p', 'snapback4-lang', '--test', 'guide', '--test', 'ephemeral_compat', '--', '--nocapture']),
]: run(name, ['cargo', 'test', *args])
run('wasm-final', ['bash', 'scripts/build-wasm.sh'])
run('web-prediction-final', ['node', '--test', 'packages/snapback4/test/row-view-prediction.test.mjs'])
run('sdk-measurement', ['bun', 'run', '--cwd', 'packages/snapback4', 'build'])
run('instrument-client', ['python3', str(tools / 'instrument-client.py')])
artifacts.mkdir(exist_ok=True)
base = root / 'target/bg-round4-artifacts'
hashes = json.loads((tools.parent / 'round4/measurement-artifacts.json').read_text())['base']
for name, digest in hashes.items():
    assert hashlib.sha256((base / name).read_bytes()).hexdigest() == digest, name
for name in ['base-dev', 'base-production']:
    shutil.copy2(base / name, artifacts / name)
shutil.copytree(base / 'base-dist', artifacts / 'base-dist', dirs_exist_ok=True)
shutil.copytree(root / 'packages/snapback4/dist', artifacts / 'candidate-dist', dirs_exist_ok=True)
(report / 'baseline-reuse.json').write_text(json.dumps({'source': 'round4/measurement-artifacts.json', 'verified_files': len(hashes), 'baseline_commit': 'fcc4b644f9', 'hashes': hashes}, indent=2) + '\n')
for profile in ['dev', 'production']:
    run('instrument-server-' + profile, ['python3', str(tools / 'instrument-server.py')], {'BG_PROFILE': profile})
    shutil.copy2(root / 'target/debug/snapback4-ll-measure', artifacts / ('candidate-' + profile))
for p, digest in files.items():
    assert hashlib.sha256((repo / p).read_bytes()).hexdigest() == digest, p
print('READY: final affected checks and artifacts; sources restored', flush=True)

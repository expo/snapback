#!/usr/bin/env python3
"""Run the requested complete suite once, preserving status and source bindings."""
from pathlib import Path
import hashlib, json, os, subprocess
report = Path(__file__).resolve().parent
workspace = report.parents[1]
repo = workspace.parent
def sources():
    files = subprocess.check_output(['git','ls-files','-z','--cached','--others','--exclude-standard','snapback4'],cwd=repo).decode().split('\0')
    kept = {}
    for name in sorted(set(files)):
        if not name: continue
        relative = name.removeprefix('snapback4/')
        if not (relative.startswith(('crates/','packages/','scripts/','apps/','fixtures/','corpus/','vendor/'))
                or relative in ['Cargo.toml','Cargo.lock','package.json','bun.lock']): continue
        path = repo/name
        if path.is_file(): kept[name] = hashlib.sha256(path.read_bytes()).hexdigest()
    return kept
before = sources()
(report/'source-before-suite.json').write_text(json.dumps(before,indent=2)+'\n')
env = dict(os.environ, LIBSQLITE3_FLAGS='-USQLITE_ENABLE_MEMORY_MANAGEMENT', CARGO_BUILD_JOBS='8', RUST_TEST_THREADS='8')
with (report/'full-suite.log').open('w') as log:
    status = subprocess.run(['bash','scripts/test.sh'],cwd=workspace,env=env,stdout=log,stderr=subprocess.STDOUT).returncode
(report/'full-suite.exit').write_text(str(status)+'\n')
after = sources()
(report/'source-after-suite.json').write_text(json.dumps(after,indent=2)+'\n')
(report/'suite-binding.json').write_text(json.dumps({'exit':status,'files':len(before),
    'changed':[p for p in before.keys() | after.keys() if before.get(p) != after.get(p)]},indent=2)+'\n')
raise SystemExit(status)

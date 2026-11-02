#!/usr/bin/env python3
"""Run a recorded check from snapback4; retain exact output and summaries."""
import json, os, subprocess, sys
from pathlib import Path
root = Path(__file__).resolve().parents[2]
name, command = sys.argv[1:]
env = dict(os.environ, PATH='/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.volta/bin:' + os.environ['PATH'], CARGO_INCREMENTAL='0', CARGO_PROFILE_DEV_DEBUG='0', CARGO_PROFILE_TEST_DEBUG='0', TMPDIR=str(root / 'target/progressive-history-2c/tmp'))
Path(env['TMPDIR']).mkdir(parents=True, exist_ok=True)
node = subprocess.check_output(['node', '--version'], env=env, text=True).strip()
assert node == 'v24.18.0', node
log = Path(__file__).parent / (name + '.log')
with log.open('w') as out:
    result = subprocess.run(command, shell=True, executable='/bin/bash', cwd=root, env=env, stdout=out, stderr=subprocess.STDOUT)
lines = log.read_text().splitlines()
summary = [line for line in lines if line.startswith(('test result:', '# pass', '# fail', '# skipped', '# tests', 'ℹ pass', 'ℹ fail', 'ℹ skipped', 'ℹ tests', 'wasm ', 'docs budget:', 'ref-check:'))]
if not summary: summary = lines[-8:]
with (Path(__file__).parent/'CHECKS.jsonl').open('a') as out:
    out.write(json.dumps(dict(command=command,cwd=str(root),node=node,exit=result.returncode,log=log.name,summary=summary))+'\n')
print(json.dumps(dict(command=command,exit=result.returncode,summary=summary)), flush=True)
sys.exit(result.returncode)

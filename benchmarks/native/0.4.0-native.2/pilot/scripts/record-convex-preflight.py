#!/usr/bin/env python3
"""Run the retained local Convex proof and bind its result into packet metadata."""
import json
from common import *

host_check()
binary = ROOT / 'inputs/convex/convex-local-backend'
project = ROOT / 'runtime/node'
target = ROOT / 'preparation/convex-preflight'; target.mkdir(parents=True)
if not binary.is_file() or binary.is_symlink(): raise RuntimeError('convex-preflight-binary-missing')
proc = subprocess.run(['node', str(ROOT / 'scripts/convex-preflight.mjs'), str(project), str(binary)],
    capture_output=True, text=True, timeout=300)
put(target / 'stdout.log', proc.stdout); put(target / 'stderr.log', proc.stderr)
put(target / 'exit.json', {'exitCode': proc.returncode, 'argv': proc.args})
try: result = json.loads(proc.stdout.strip().splitlines()[-1])
except (IndexError, json.JSONDecodeError): raise RuntimeError('convex-preflight-output-invalid') from None
attempt = Path(result.get('attempt', '')).resolve()
if (proc.returncode != 0 or result.get('pass') is not True or
    result.get('backendSha256') != sha(binary) or not attempt.is_relative_to(project.resolve())):
    raise RuntimeError('convex-preflight-failed:' + json.dumps(result, sort_keys=True))
retained = read(attempt / 'result.json')
if retained.get('pass') is not True or retained.get('backendSha256') != sha(binary):
    raise RuntimeError('convex-preflight-retained-result-invalid')
metadata = {**retained, 'attempt': str(attempt), 'resultSha256': sha(attempt / 'result.json'),
            'stdoutSha256': sha(target / 'stdout.log')}
put(ROOT / 'metadata/convex-preflight.json', metadata)
print(json.dumps(metadata))

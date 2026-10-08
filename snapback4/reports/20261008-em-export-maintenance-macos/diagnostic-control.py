#!/usr/bin/env python3
"""Run the custody-priority regression against the old collector in a private copy."""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

os.umask(0o077)
here = Path(__file__).resolve().parent
workspace = here.parents[1]
repo = workspace.parent
test = workspace / 'packages/snapback4/test'
pin = workspace / 'target/em/binaries/da8d88838c98b49f1a417415587b07c8c52938fbc68955e19ef729af1ee551b3/snapback4'
with tempfile.TemporaryDirectory(prefix='diagnostic-control-',dir=workspace/'target/em') as directory:
    copy = Path(directory)
    (copy/'helpers').mkdir()
    shutil.copyfile(test/'maintenance-evidence.test.mjs',copy/'maintenance-evidence.test.mjs')
    for name in ['maintenance-evidence.mjs','maintenance_processes.py']:
        shutil.copyfile(test/'helpers'/name,copy/'helpers'/name)
    old = subprocess.check_output(['git','show','affcd4919b:snapback4/packages/snapback4/test/helpers/maintenance-evidence.py'],cwd=repo)
    (copy/'helpers/maintenance-evidence.py').write_bytes(old)
    command = ['node','--test','--test-name-pattern=bounded snapshots retain concurrent retention custody',str(copy/'maintenance-evidence.test.mjs')]
    result = subprocess.run(command,env={**os.environ,'SNAPBACK4_EXPORT_TEST_BINARY':str(pin)},stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
    (here/'evidence/diagnostic-control.log').write_bytes(result.stdout)
    record = dict(source='affcd4919b',collectorSha256=hashlib.sha256(old).hexdigest(),command=command,exitCode=result.returncode,
                  expected='missing current worker or retention group journal under the unchanged 64-file cap')
    (here/'evidence/diagnostic-control.json').write_text(json.dumps(record,indent=2)+'\n')
    assert result.returncode == 1 and b'ENOENT' in result.stdout and any(n in result.stdout for n in [b'/worker.json',b'/retention-group.json']), result.stdout
    print(json.dumps(record))

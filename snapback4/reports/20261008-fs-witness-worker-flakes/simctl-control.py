#!/usr/bin/env python3
"""Portable check of the Darwin driver's fixture premise, not a driver run."""
from pathlib import Path
import os
import subprocess
import sys
import tempfile

root = Path(__file__).resolve().parents[2]
source = (root / 'crates/snapback4/tests/fixtures/witness-simctl.py').read_text()
if '--mutant' in sys.argv:
    source = source.replace("('6999' if mode == 'running' else '-')", "'-'")
with tempfile.TemporaryDirectory(prefix='fs-simctl-') as tmp:
    for mode, pid in [('normal', '-'), ('running', '6999'), ('running', '9999')]:
        if pid == '9999':
            Path(tmp, 'app-pid').write_text(pid)
        result = subprocess.run(['python3', '-c', source, 'simctl', 'spawn', 'dedicated', 'launchctl', 'list'],
            env={**os.environ, 'WITNESS_TEST_DIR': tmp, 'WITNESS_TEST_MODE': mode}, capture_output=True, text=True)
        assert result.returncode == 0, result.stderr
        assert f'{pid}\t0\tUIKitApplication:dev.test[fixture]' in result.stdout, result.stdout
        assert not Path(tmp, 'process-events.jsonl').exists()
        assert not Path(tmp, '.snapback4').exists()
print('FS_SIMCTL: cold running state, no-app and replacement controls passed (fixture only)')

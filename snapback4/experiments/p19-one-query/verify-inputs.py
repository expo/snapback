"""Confirm the supplied evidence stayed byte-identical; no database opens."""
import hashlib
import json
import os
from pathlib import Path
p = Path(__file__).resolve().parent
source = Path(os.environ.get('P19_EVIDENCE', '/home/ccheever/sb4-intent/rg-evidence/lane'))
before = json.loads((p / 'results/inputs.json').read_text())
after = {}
for name, expected in before.items():
    path = source / name
    with path.open('rb') as f:
        actual = {'bytes': path.stat().st_size, 'sha256': hashlib.file_digest(f, 'sha256').hexdigest()}
    assert actual == expected, name
    after[name] = actual
(p / 'results/inputs-after.json').write_text(json.dumps(after, indent=2) + '\n')
print('All original input hashes unchanged, including SQLite and WAL.')

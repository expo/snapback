"""Read-only wave-15 survey; compile private scratch copies, never evidence dirs."""
from pathlib import Path
import hashlib
import json
import re
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
BIN = ROOT / 'target/debug/snapback4'
OUT = Path(__file__).resolve().parent
EVIDENCE = Path.home() / 'sb4-loop/wave15/apps'

def digest(data):
    return hashlib.sha256(data).hexdigest()

def check(source):
    with tempfile.TemporaryDirectory(prefix='sb4-rules5-survey-') as scratch:
        cwd = Path(scratch)
        (cwd / 'snapback').mkdir()
        (cwd / 'snapback/schema.q').write_text(source)
        result = subprocess.run([str(BIN), 'check', '--json'], cwd=cwd,
                                capture_output=True, text=True, timeout=30)
        body = json.loads(result.stdout)
        return {'exit': result.returncode, 'ok': body['ok'],
                'diagnostics': body.get('problems', []), 'notes': body.get('notes', [])}

rows = []
for path in sorted(EVIDENCE.glob('*/snapback/schema.q')):
    before = path.read_bytes()
    rows.append({'lane': path.parents[1].name, 'sha256': digest(before), **check(before.decode())})
    assert path.read_bytes() == before
assert len(rows) == 100, len(rows)
(OUT / 'schema-survey.json').write_text(json.dumps({
    'binarySha256': digest(BIN.read_bytes()), 'schemas': rows,
    'summary': {'passed': sum(r['ok'] for r in rows),
                'notes': sum(len(r['notes']) for r in rows)}}, indent=2) + '\n')

candidates = []
for lane in ['077', '085']:
    path = next(EVIDENCE.glob(lane + '-*/snapback/schema.q'))
    original = path.read_text()
    candidates.append({'name': lane + '-original', **check(original)})
    if lane == '077':
        # Preserve all authored policies; test direct inheritance against the
        # mutable immediate section. No staff grant or owner branch is deleted.
        candidate = re.sub(r'(table checks:.*?)(  read <- [^\n]+)',
                           r'\1  read through live .section', original, count=1, flags=re.S)
        candidates.append({'name': '077-checks-live-section', **check(candidate)})
        # A chain of live parents is intentionally outside LIVE's first form.
        chain = re.sub(r'(table sections:.*?)(  read <- [^\n]+)',
                       r'\1  read through live .proposal', candidate, count=1, flags=re.S)
        candidates.append({'name': '077-live-chain', **check(chain)})
    else:
        candidate = re.sub(r'(table entries:.*?)(  read <- [^\n]+)',
                           r'\1  read through live .service', original, count=1, flags=re.S)
        candidates.append({'name': '085-live-with-cascade', **check(candidate)})
        candidates.append({'name': '085-live-restrict',
                           **check(candidate.replace('services on delete cascade', 'services'))})
        authority = re.sub(r'query hymnUsage\(.*?(?=mutation addHymn)', '', candidate, flags=re.S)
        candidates.append({'name': '085-authority-cascade', **check(authority)})
        candidates.append({'name': '085-authority-restrict',
                           **check(authority.replace('services on delete cascade', 'services'))})
    assert path.read_text() == original
(OUT / 'live-shapes.json').write_text(json.dumps(candidates, indent=2) + '\n')
print(json.dumps({'schemas': len(rows), 'passed': sum(r['ok'] for r in rows),
                  'notes': sum(len(r['notes']) for r in rows),
                  'candidates': [(r['name'], r['ok']) for r in candidates]}))

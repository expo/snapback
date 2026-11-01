#!/bin/bash
# Preserve the interrupted attempt's pending framework record before a fresh proof.
set -euo pipefail
C=${1:?publication source}
python3 - "$C" <<'PY'
from pathlib import Path
from datetime import datetime, timezone
import hashlib, json, shutil, subprocess, sys
k=Path.home()/'sb4-pub-0452';w=Path.home()/'sb4-pub-0444-wt';c=sys.argv[1]
assert subprocess.check_output(['git','rev-parse','HEAD'],cwd=w,text=True).strip()==c
assert not subprocess.check_output(['git','status','--porcelain'],cwd=w,text=True).strip()
assert (k/'chain-a1.env-invalid').exists() and not (k/'native-a2-started.sha').exists()
assert (k/'native-a1-power-cleanup.sha').read_text().strip()==c
d=w/'snapback4/reports/20261101-expo-0.4.52';p=d/'qualified.json';b=p.read_bytes();q=json.loads(b)
assert q['source']==c and q['published'] is False
assert q['qualification']=='Framework rebuilt; Release app and native witness pending.'
assert not any(x in q for x in ['witnesses','app','cli','toolchainProvenance'])
assert sorted(str(x.relative_to(d)) for x in d.rglob('*') if x.is_file())==['qualified.json']
archive=k/'archive-native-a1-power-20261101T162617Z';archive.mkdir(exist_ok=False)
dest=archive/d.name;shutil.move(str(d),str(dest))
digest=hashlib.sha256(b).hexdigest();assert hashlib.sha256((dest/'qualified.json').read_bytes()).hexdigest()==digest
record={'at':datetime.now(timezone.utc).isoformat(),'source':c,'sha256':digest,'status':'pending framework record only; no witness, not qualification evidence','reason':'native attempt1 power invalidation before witness; fresh attempt2 required','archivedRecord':str(dest/'qualified.json')}
(archive/'archive.json').write_text(json.dumps(record,indent=2)+'\n')
print(json.dumps(record,indent=2))
PY

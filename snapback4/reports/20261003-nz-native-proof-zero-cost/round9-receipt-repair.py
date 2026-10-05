"""Record the narrowly affected terminal-receipt fixture correction, without rerunning unchanged checks."""
import hashlib, json, pathlib, re, subprocess, time
from measure import ROOT, REPORT, retain, snapshot
out=REPORT/'round9'
initial=json.loads((out/'focused.json').read_text())
assert initial['state']=='finished' and initial['inputsUnchanged']
assert [x['label'] for x in initial['checks'] if x['status']] == ['export']
for entry in initial['inputs']:
    assert hashlib.sha256((ROOT.parent/entry['path']).read_bytes()).hexdigest()==entry['sha256'],entry['path']
log=pathlib.Path('/tmp/sb4-nz-r9-final-receipt-repair.log')
text=log.read_text()
assert re.search(r'ℹ tests 3\nℹ suites 0\nℹ pass 3\nℹ fail 0',text),text
path='snapback4/packages/snapback4/test/export-native-round2.test.mjs'
before=subprocess.check_output(['git','show','HEAD:'+path],cwd=ROOT.parent)
after=(ROOT.parent/path).read_bytes()
assert after==before.replace(b'{"exitStatus":0}',b'{"exitStatus":0,"endedAt":1}')
inputs=initial['inputs']+[dict(path=path,sha256=hashlib.sha256(after).hexdigest())]
changed=subprocess.check_output(['git','diff','--name-only','HEAD'],cwd=ROOT.parent,text=True).splitlines()
assert set(p for p in changed if '/crates/' in p or '/packages/' in p)==set(p['path'] for p in inputs)
record=out/'focused-repaired.json'
assert not record.exists()
record.write_text(json.dumps(dict(state='finished',status=0,inputsUnchanged=True,finishedAt=time.time(),inputs=inputs,
    initial='focused.json',initialExportResult='93/94; only concurrent pruning fixture failed',
    correction='Only the seeded smoke receipts gained an end timestamp; all eight prior changed code/guide/test inputs remain byte-identical.',
    command=['node','--test',path],passes=3,durationSeconds=float(re.search(r'duration_ms ([0-9.]+)',text)[1])/1000,
    evidence=retain(log),host=snapshot()),indent=2)+'\n')
print('Affected qualification resolved: unchanged 66 witness units, 76 integrations, 93 export passes; corrected receipt file 3/3.')

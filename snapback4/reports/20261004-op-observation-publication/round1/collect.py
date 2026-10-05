"""Collect the completed round-1 runs without rewriting round-0 custody."""
from pathlib import Path
import hashlib,json,re,shutil,subprocess,time
root=Path(__file__).resolve().parents[3]
out=Path(__file__).resolve().parent
raw=root/'target/op/round1'
def digest(p):
 with p.open('rb') as f:return hashlib.file_digest(f,'sha256').hexdigest()
def counts(p):
 return {k:int(v) for k,v in re.findall(r'^(?:#|ℹ) (tests|pass|fail|cancelled|skipped|todo) (\d+)$',p.read_text(),re.M)}
record={'collected':time.time(),'files':{},'stress':[]}
for folder in ['stress','stress-b','stress-c']:
 d=json.loads((raw/folder/'results.json').read_text())
 for r in d['runs']:
  p=raw/folder/f"{r['run']:02}.log";r.update(counts(p));r['log_sha256']=digest(p)
  assert r['exit']==0 and r['fail']==0 and r['cancelled']==0 and r['skipped']==0 and r['hog_alive']
 record['stress'].append(d)
assert sorted(r['run'] for group in record['stress'] for r in group['runs'])==list(range(1,11))
record['stress_cleanup']=json.loads((raw/'stress-cleanup.json').read_text())
for p in raw.glob('*affinity.json'):
 if p.stat().st_size:record.setdefault('affinity',{})[p.name]=json.loads(p.read_text())
record['full_suite']=json.loads((raw/'full-suite-result.json').read_text())
assert record['full_suite']['exit']==0
log=(raw/'full-suite.log').read_text()
record['full_suite']['log_sha256']=digest(raw/'full-suite.log')
record['full_suite']['client_groups']=[{'files':files,'failed_files':int(failed),'counts':json.loads(counts)} for files,failed,counts in re.findall(r'^-- client files: ([^;]+); failed (\d+); tests (\{.*\})$',log,re.M)]
record['full_suite']['client_summaries']=[dict(zip(['tests','pass','fail','cancelled','skipped','todo'],map(int,x))) for x in re.findall(r'# tests (\d+)\n# suites \d+\n# pass (\d+)\n# fail (\d+)\n# cancelled (\d+)\n# skipped (\d+)\n# todo (\d+)',log)]
record['full_suite']['phases']=re.findall(r'^-- (?:ok|FAIL):.*$',log,re.M)
record['full_suite']['rust']={}
rust_log=log.split('== cargo test\n',1)[1].split('-- ok: cargo test',1)[0]
for kind,pattern in [('targets',r'^-- rust target:.*test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored'),('doctests',r'^test result: ok\. (\d+) passed; (\d+) failed; (\d+) ignored')]:
 rows=[tuple(map(int,x)) for x in re.findall(pattern,rust_log,re.M)]
 record['full_suite']['rust'][kind]={'summaries':len(rows),'passed':sum(x[0] for x in rows),'failed':sum(x[1] for x in rows),'ignored':sum(x[2] for x in rows)}
record['full_suite']['wasm']=[s for s in log.splitlines() if 'gzip' in s or 'wasm budget' in s]
for name in ['local.ts','local-query.ts','local-reads.ts']:
 p=root/'packages/snapback4/src'/name;record['files'][str(p.relative_to(root))]=digest(p)
for name in ['observation-publication.test.mjs','retained-history-cut.test.mjs']:
 p=root/'packages/snapback4/test'/name;record['files'][str(p.relative_to(root))]=digest(p)
record['sdk_match']=all(digest(p)==digest(root/'packages/snapback4/dist'/p.relative_to(raw/'sdk-final-plain/dist')) for p in (raw/'sdk-final-plain/dist').rglob('*') if p.is_file())
record['sdk_files']=len([p for p in (raw/'sdk-final-plain/dist').rglob('*') if p.is_file()])
assert record['sdk_match']
for name in ['publication.log','focused.log','late-debug2.log','ref-check.log','full-suite.log']:
 p=raw/name;record['files'][str(p.relative_to(root))]={'bytes':p.stat().st_size,'sha256':digest(p),'counts':counts(p)}
(out/'qualification.json').write_text(json.dumps(record,indent=2)+'\n')
for name in ['full-suite-result.json','stress-cleanup.json','ref-check.log']:
 shutil.copy2(raw/name,out/name)
print('stress passes',sum(r['pass'] for g in record['stress'] for r in g['runs']))
print('full',record['full_suite']['phases'])
print('sdk match',record['sdk_match'])

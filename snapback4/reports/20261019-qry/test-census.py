#!/usr/bin/env python3
"""Audit retained Cargo logs against the captured default target inventory."""
import re,json,pathlib,hashlib,gzip,sys
root=pathlib.Path(__file__).resolve().parent
expected=json.loads((root/'cargo-targets.json').read_text())
logs=['cargo-final','lang-final','lang-resume-0','lang-resume-1','lang-resume-2','sim-difftest-final','native-final']
passed={k:{} for k in expected}; provenance={}
for name in logs:
 p=root/'logs'/(name+'.log.gz'); raw=gzip.decompress(p.read_bytes()); text=raw.decode();pkg='snapback4-lang' if name.startswith('lang') else None
 provenance[name]={'sha256':hashlib.sha256(raw).hexdigest(),'path':str(p.relative_to(root))}
 for seg in re.split(r'(?=^\s+Running )',text,flags=re.M):
  m=re.search(r'Running (?:unittests )?(\S+) \(target/debug/deps/(\S+)\)',seg)
  if not m:continue
  source,binary=m.groups()
  if source.startswith('src/'):pkg=re.sub('-[a-f0-9]+$','',binary).replace('_','-')
  assert pkg in passed,(name,m[0],pkg)
  result=re.search(r'^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;',seg,re.M)
  if result:
   source='crates/'+pkg+'/'+source
   passed[pkg][source]={'log':name,'binary':binary,'status':result[1],'passed':int(result[2]),'failed':int(result[3]),'ignored':int(result[4])}
doc=gzip.decompress((root/'logs/workspace-doc.log.gz').read_bytes()).decode()
docs={}
for seg in re.split(r'(?=^\s*Doc-tests )',doc,flags=re.M):
 m=re.search(r'Doc-tests (\S+)',seg); r=re.search(r'^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;',seg,re.M)
 if m and r: docs[m[1]]={'status':r[1],'passed':int(r[2]),'failed':int(r[3]),'ignored':int(r[4])}
summary={pkg:{'expected':len(targets),'completed':len(passed[pkg]),'missing':sorted(set(targets)-set(passed[pkg])),'tests_passed':sum(r['passed'] for r in passed[pkg].values()),'tests_failed':sum(r['failed'] for r in passed[pkg].values()),'tests_ignored':sum(r['ignored'] for r in passed[pkg].values())} for pkg,targets in expected.items()}
out={'description':'Complete Cargo default unit/integration target census. Bounded workspace/language commands resumed with the remaining target inventory; original timeouts are not reported as successful commands. Diagnostic-only final refinements covered by full language rerun; final max implementation also covered by focused core/device tests.','logs':provenance,'summary':summary,'targets':passed,'doctests':docs}
assert all(not r['missing'] and not r['tests_failed'] for r in summary.values()),summary
assert len(docs)==6 and all(r['status']=='ok' for r in docs.values()),docs
if '--write' in sys.argv:(root/'rust-coverage.json').write_text(json.dumps(out,indent=2)+'\n')
else:assert json.loads((root/'rust-coverage.json').read_text())==out
print(json.dumps(summary,indent=2));print('doctests',docs)

import json,math,statistics
from pathlib import Path
P=Path('/home/ccheever/sb4-loop/reports/integration27')
load=lambda p:json.loads(p.read_text())
key=lambda r:(r['wave'],r['lane'])
old={key(r):r for r in load(P/'survey-final/results.json')}
new={key(r):r for r in load(P/'survey-write-free/results.json')}
assert old.keys()==new.keys() and len(new)==117
issues=[]
def signature(reviews):
 return sorted((r['id'],r['code'],str(r['site']),r['gated'],r['acknowledged'],(r.get('witness')or{}).get('id')) for r in reviews)
for k,r in new.items():
 b=old[k]
 for field in ['sha256','checkExit','checkFixes']:
  if b[field]!=r[field]:issues.append([k,field])
 for field in ['defaultCheck','defaultDeploy','fresh']:
  if b[field]['exit']!=r[field]['exit']:issues.append([k,field,'exit'])
 if signature(b['reviews'])!=signature(r['reviews']):issues.append([k,'check dispositions'])
 if signature(b['fresh']['reviews'])!=signature(r['fresh']['reviews']):issues.append([k,'deploy dispositions'])
 if b['fresh']['fixes']!=r['fresh']['fixes']:issues.append([k,'fresh fixes'])
 for reviews,rendered in [(r['reviews'],r['defaultCheck']),(r['fresh']['reviews'],r['defaultDeploy'])]:
  assert rendered['exit'] in [0,1],(k,rendered['exit'])
  for d in reviews:
   if d['gated'] and not d['acknowledged']:
    assert not any(line.startswith('fix question '+d['code']) and str(d['site']) in line for line in (rendered['stdout']+rendered['stderr']).splitlines()),(k,d)
assert not issues,issues
allrows={key(r):r for r in load(P/'survey/results.json')};allrows.update(new)
def stats(xs):return {'median':statistics.median(xs),'p90':sorted(xs)[math.ceil(.9*len(xs))-1],'max':max(xs)}
timing=[r for r in new.values() if r['wave'] in [29,30]]
gates=[]
for r in new.values():
 for g in r['gates']:gates.append({'wave':r['wave'],'lane':r['lane'],'sameWitnessId':True})
d={'finalCopies':117,'timingCopies':len(timing),'issues':issues,'sourceVerdictsAndFixesUnchanged':True,'blockingFindingsNeverAlsoQuestions':True,'baselineGateWitnessIds':gates,'all800DefaultCheckLines':stats([r['defaultCheck']['lines']for r in allrows.values()]),'all800DefaultDeployLines':stats([r['defaultDeploy']['lines']for r in allrows.values()]),'finalWaves29And30ColdCheckSeconds':stats([r['defaultCheck']['seconds']for r in timing]),'finalWaves29And30ProductionDeploySeconds':stats([r['defaultDeploy']['seconds']for r in timing]),'binarySha256':load(P/'survey-write-free/measurement.json')['binarySha256'],'measurement':'Final 80411b9d8f optimized Cargo test profile, eight workers and concurrent host verification. All waves 29/30 and every prior refused source copy rerun after the write-free call-graph optimization; output/verdict/witness identity parity checked against prior final sample. Other source/engine outcomes retain the complete 800-schema classified survey.'}
(P/'survey-write-free-summary.json').write_text(json.dumps(d,indent=2)+'\n')
print(json.dumps(d,indent=2))

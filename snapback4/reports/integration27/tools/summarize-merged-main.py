import json,math,statistics,hashlib,re
from pathlib import Path
P=Path('/home/ccheever/sb4-loop/reports/integration27');R=Path('/home/ccheever/projects/snapback-sb4loop');load=lambda p:json.loads(p.read_text());key=lambda r:(r['wave'],r['lane'])
old={key(r):r for r in load(P/'survey-write-free/results.json')};new={key(r):r for r in load(P/'survey-merged-main/results.json')};assert old.keys()==new.keys() and len(new)==117
sig=lambda rs:sorted((r['id'],r['code'],str(r['site']),r['gated'],r['acknowledged'],(r.get('witness')or{}).get('id'))for r in rs)
for k,row in new.items():
 before=old[k]
 for field in ['sha256','checkExit','checkFixes']:assert before[field]==row[field],(k,field)
 for field in ['defaultCheck','defaultDeploy','fresh']:assert before[field]['exit']==row[field]['exit'],(k,field)
 for field in ['defaultCheck','defaultDeploy']:assert before[field]['lines']==row[field]['lines'],(k,field,'lines')
 assert sig(before['reviews'])==sig(row['reviews']),(k,'check dispositions')
 assert sig(before['fresh']['reviews'])==sig(row['fresh']['reviews']),(k,'deploy dispositions')
 assert before['fresh']['fixes']==row['fresh']['fixes'],(k,'fixes')
 for rs,render in [(row['reviews'],row['defaultCheck']),(row['fresh']['reviews'],row['defaultDeploy'])]:
  for d in rs:
   if d['gated']and not d['acknowledged']:assert not any(line.startswith('fix question '+d['code'])and str(d['site'])in line for line in(render['stdout']+render['stderr']).splitlines()),(k,d)
rb=load(P/'replay-write-free.json');rn=load(P/'replay-merged-main.json');assert len(rn['results'])==150
assert rb['results']==rn['results'],'replay outcomes differ, inspect before claiming parity'
metrics=lambda xs:{'median':statistics.median(xs),'p90':sorted(xs)[math.ceil(.9*len(xs))-1],'max':max(xs)}
timing=[r for r in new.values()if r['wave']in[29,30]]
allrows={key(r):r for r in load(P/'survey/results.json')};allrows.update(new)
counts={}
for name in ['incoming-core.log','incoming-cli.log']:
 s=(P/name).read_text();ms=re.findall(r'test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;',s);assert ms and all(int(m[1])==0 for m in ms),name
 counts[name]={'observations':sum(int(m[0])for m in ms),'ignored':sum(int(m[2])for m in ms),'resultLines':len(ms)}
assert load(P/'incoming-cli-receipt.json')['status']==0
products=load(P/'merged-main-product-receipt.json');assert len(products)==3 and all(r['status']==0 for r in products),products
native=load(P/'merged-main-binary.json');d={'merge':'8eabb1f777da3297dace2939271851b4c8f6b88b','incomingMain':'e0ad590a1bd39d629753c2cbc22ba0038f0beabf','native':native,'surveyCopies':117,'surveyVerdictsWitnessIdsFixesAndLineCountsIdentical':True,'noDuplicateBlockingQuestion':True,'all800CheckLines':metrics([r['defaultCheck']['lines']for r in allrows.values()]),'all800DeployLines':metrics([r['defaultDeploy']['lines']for r in allrows.values()]),'final100ColdCheckSeconds':metrics([r['defaultCheck']['seconds']for r in timing]),'final100ProductionDeploySeconds':metrics([r['defaultDeploy']['seconds']for r in timing]),'replayStores':150,'allReplayRecordsByteStructuralEqual':True,'replayFalseRefusals':0,'hiddenV1Rows':0,'successfulMoves':724,'expectedRefusals':26,'consistentShapes':290,'rustResults':counts,'products':products,'timingMethod':'Optimized Cargo test-profile immutable pin, eight survey workers alongside eight replay workers, focused client verification and host work; not isolated production-build performance qualification.'}
(P/'merged-main-summary.json').write_text(json.dumps(d,indent=2)+'\n');print(json.dumps(d,indent=2))

from pathlib import Path
import json,gzip,time,collections,csv,hashlib
b=Path.home()/'sb4-loop/integ24';out=b/'evidence-wave26-r8';out.mkdir(exist_ok=True)
while not(b/'survey-wave26-after-r8/summary.json').exists():time.sleep(3)
def read(mode):return {r['project']:r for p in(b/('survey-wave26-'+mode)).glob('w*.json.gz')for r in[json.loads(gzip.decompress(p.read_bytes()))]}
before=read('before-optimized');after=read('after-r8');assert len(before)==len(after)==600
audit={r['project']:r for p in(b/'survey-wave26-audit-r8').glob('w*.json.gz')for r in[json.loads(gzip.decompress(p.read_bytes()))]};assert len(audit)==49
bad=lambda r:bool(r['gates'])or any(r['calls'][k]['exit']for k in['freshDeploy','afterTestDeploy'])
assert {k for k,r in after.items()if bad(r)}==set(audit)
for key in after:
 assert before[key]['sourceHashes']==after[key]['sourceHashes'] and before[key]['fixtureHashes']==after[key]['fixtureHashes'],key
for r in audit.values():assert not any(r[k]for k in['checkExit','freshExit','afterTestExit'])and r['classification']in['real','cleared by one-line intent'],r['project']
summary={'before':json.loads((b/'survey-wave26-before-optimized/summary.json').read_text()),'after':json.loads((b/'survey-wave26-after-r8/summary.json').read_text()),'classifications':dict(collections.Counter(r['classification']for r in audit.values())),'falseGates':0,'falseDeployRefusals':0,'unclearedConditionalCopies':0,'sameSchemaAndFixtureHashes':True,'fixedFalsePostTestRefusals':[k for k in after if before[k]['calls']['afterTestDeploy']['exit']and not after[k]['calls']['afterTestDeploy']['exit']],'fixedFalseFreshRefusals':[k for k in after if before[k]['calls']['freshDeploy']['exit']and not after[k]['calls']['freshDeploy']['exit']],'scope':'Finite copied-schema campaign and per-refusal specification audit, not universal proof; conditional choices do not accept intent on original authors behalf.'}
fixed=[r for r in after.values()if r['wave']not in[24,25,26]];summary['sec9Fixed450']={'projects':len(fixed),'gated':sum(bool(r['gates'])for r in fixed),'freshRefused':sum(r['calls']['freshDeploy']['exit']!=0 for r in fixed),'afterTestRefused':sum(r['calls']['afterTestDeploy']['exit']!=0 for r in fixed)}
(out/'day-one-summary.json').write_text(json.dumps(summary,indent=2)+'\n')
with(out/'day-one-projects.tsv').open('w')as f:
 w=csv.writer(f,delimiter='\t');w.writerow(['project','wave','beforeCheck','beforeGates','beforeFresh','beforeTest','beforePostTest','afterCheck','afterGates','afterFresh','afterTest','afterPostTest','classification','gateIDsAndSites','conditionalEdits','conditionalCommands'])
 for key,r in sorted(after.items()):
  a=before[key];review=audit.get(key);w.writerow([key,r['wave'],a['calls']['check']['exit'],len(a['gates']),a['calls']['freshDeploy']['exit'],a['calls']['test']['exit'],a['calls']['afterTestDeploy']['exit'],r['calls']['check']['exit'],len(r['gates']),r['calls']['freshDeploy']['exit'],r['calls']['test']['exit'],r['calls']['afterTestDeploy']['exit'],review['classification']if review else'clear',json.dumps([{'id':g['id'],'code':g['code'],'site':g['site']}for g in r['gates']]),json.dumps(review['edits'])if review else'[]',json.dumps(review['decisions'])if review else'[]'])
for label,rows in[('before',before),('after',after)]:
 (out/('day-one-'+label+'-raw.jsonl.gz')).write_bytes(gzip.compress(('\n'.join(json.dumps(rows[k])for k in sorted(rows))+'\n').encode(),mtime=0))
print(json.dumps(summary),flush=True)

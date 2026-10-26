import json,hashlib,re
from pathlib import Path
ROOT=Path('/home/ccheever/projects/snapback-sb4loop')
OUT=Path('/home/ccheever/sb4-loop/reports/integration27')
load=lambda p:json.loads(p.read_text())
receipts=sorted((ROOT/'target/affected').glob('80411b9d8f*-*.json'))
assert len(receipts)==1,receipts
raw=load(receipts[0]);assert len(raw['steps'])==31
assert all(r['status']==0 for r in raw['results']),raw['results']
# Preserve the interrupted raw receipt. Compose actual target outcomes without
# manufacturing a successful canonical command or unchanged-HEAD claim.
clientLogs=['affected-shared-final.log','client-doc-fixes.log','client-reference-fixes.log','client-reference-final.log','finish-client-models.log','export-final.log']
clientRows={}; failedAttempts=[]
for name in clientLogs:
 text=(OUT/name).read_text();previous=0
 for m in re.finditer(r'^-- client file (ok|FAIL): (.+?) \((\d+) ms\)',text,re.M):
  block=text[previous:m.start()];previous=m.end();counts={}
  for label in ['tests','pass','fail','cancelled','skipped','todo']:
   values=re.findall(r'^# '+label+r' (\d+)$',block,re.M)
   if values:counts[label]=int(values[-1])
  row={'passed':m[1]=='ok','log':name,'elapsedMs':int(m[3]),'counts':counts};clientRows[m[2]]=row
  if not row['passed']:failedAttempts.append({'file':m[2],**row})
selected={f.removeprefix('snapback4/') for f in raw['clientFiles']};assert len(selected)==446
assert selected<=clientRows.keys(),sorted(selected-clientRows.keys())
assert all(clientRows[f]['passed'] for f in selected),[f for f in selected if not clientRows[f]['passed']]
results=list(raw['results']);results.append({'id':'client-tests','status':0,'method':'per-file captured exits; repaired files supersede documented stale-fixture failures'})
for file in ['finish-client-models-receipt.json','finish-chat-check-receipt.json']:
 for row in load(OUT/file):
  assert row['status']==0 or row['id']=='difftest:run-lean',row
  results.append(row)
assert {r['id'] for r in results}=={s['id'] for s in raw['steps']}
(OUT/'client-file-outcomes.json').write_text(json.dumps({'selected':446,'allPassed':True,'counts':{label:sum(clientRows[f]['counts'].get(label,0) for f in selected) for label in ['tests','pass','fail','cancelled','skipped','todo']},'files':{f:clientRows[f] for f in sorted(selected)},'supersededFailures':failedAttempts},indent=2)+'\n')
lean=load(OUT/'lean-baseline-comparison.json');assert lean['sameFindings'] and lean['sameOracleTotals']
log=(OUT/'affected-shared-final.log').read_text()
named=['deploy_recipe_bootstraps_an_admin_without_a_public_privilege_race','every_emitted_code_is_explained','release_json_reference_is_discoverable_without_growing_the_deploy_card','enforced_derived_witness_is_only_in_the_blocking_tier']
known={}
for name in named:
 lines=[line for line in log.splitlines() if name in line and re.search(r'\.\.\. ok$',line)]
 assert lines,name
 known[name]=lines
port=log.split('Running tests/store_port_ratchet.rs',1)[1].split('     Running ',1)[0]
assert '9 passed; 0 failed' in port
known['store_port_ratchet']='9 passed; 0 failed; production allowance stays zero'
(OUT/'known-reds-final.json').write_text(json.dumps(known,indent=2)+'\n')
counts={}
for group in re.split(r'^== ',(OUT/'affected-shared-final.log').read_text(),flags=re.M):
 if not group.startswith('rust:'):continue
 name=group.splitlines()[0]
 ms=list(re.finditer(r'test result: (?:ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;',group))
 assert ms,name
 counts[name]={'targets':len(ms),'passed':sum(int(m[1]) for m in ms),'failed':sum(int(m[2]) for m in ms),'ignored':sum(int(m[3]) for m in ms)}
assert len(counts)==7 and all(c['failed']==0 for c in counts.values()),counts
d={'schema':'integration27.affected-final.v1','base':raw['base'],'productHead':raw['head'],'started':raw['started'],'finished':__import__('datetime').datetime.now(__import__('datetime').timezone.utc).isoformat(),'planCommands':len(raw['steps']),'rustPackages':raw['rustPackages'],'clientFiles':len(raw['clientFiles']),'status':'PASS affected product targets; Lean retains 18 known baseline disagreements','qualification':False,'results':results,'rustCounts':counts,'rawReceipt':str(receipts[0]),'rawComplete':raw['complete'],'rawUnchanged':raw.get('unchanged'),'rawOk':raw.get('ok'),'composedVerified':True,'canonicalExit':124,'lean':lean,'method':'Canonical 10800-second command timed out after all seven Rust packages and ordinary clients, during the serial timer group. Its independently bounded client process was supervised to completion. Raw incomplete receipt remains unchanged. Actual per-file exits and separately executed remaining original plan commands compose this verification; all product targets pass after explicit fixture repairs, while Lean retains the independently matched baseline. Feature/runtime seam evidence is scoped to80411b9d8f; fixture repairs c6874cb0b7 and incoming-main merge8eabb1f777 receive explicit supplemental target checks and immutable-native survey/replay repeats. No canonical PASS or unchanged-HEAD claim is made.'}
(OUT/'verification-summary.json').write_text(json.dumps(d,indent=2)+'\n')
print(json.dumps({'status':d['status'],'counts':counts},indent=2))

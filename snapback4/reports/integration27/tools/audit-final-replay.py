import json
from pathlib import Path
P=Path('/home/ccheever/sb4-loop/reports/integration27')
data=json.loads((P/'replay-write-free.json').read_text());old=json.loads((P/'replay.json').read_text())
expected={}
for lane in ['004','024']:
 for phase in ['deploy','rollback1','forward1','rollback2','forward2']:
  expected[25,lane,phase]=['E_ADOPT','E_QUARRY_TYPE'] if lane=='024' and phase not in ['rollback1','rollback2'] else ['E_ADOPT']
for wave,lane in [(25,'030'),(27,'012'),(27,'042')]:
 for phase in ['rollback1','rollback2']:expected[wave,lane,phase]=['E_ADOPT']
operations={'008':'advanceWall','018':'addRescan','020':'removeOutingHiker','025':'retest','033':'signFailing'}
for lane in operations:
 for phase in ['forward1','forward2']:expected[27,lane,phase]=['E_SECURITY_REVIEW']
oldrows={(r['wave'],r['lane']):r for r in old['results']};observed={}
for r in data['results']:
 for phase in ['deploy','rollback1','forward1','rollback2','forward2']:
  q=r[phase];key=(r['wave'],r['lane'],phase);prior=oldrows[r['wave'],r['lane']][phase]
  assert (q['exit'],q['codes'])==(prior['exit'],prior['codes']),(key,'prior drift')
  if q['exit']:
   assert q['exit']==1 and key in expected and q['codes']==expected[key],(key,q)
   observed[key]=q['codes']
   if q['codes']==['E_SECURITY_REVIEW']:
    assert any(f['operation']==operations[r['lane']] for f in q['security']['refutations']),(key,q)
  else:assert key not in expected,(key,'expected control unexpectedly absent')
assert observed==expected
result={'stores':len(data['results']),'moves':750,'successful':724,'expectedRefusals':26,'falseRefusals':0,'all750PhaseExitAndCodePairsMatchPriorReplay':True,'exactRefusalMatrix':[{'wave':w,'lane':lane,'phase':phase,'codes':codes,'operation':operations.get(lane)if w==27 else None}for(w,lane,phase),codes in observed.items()],'securityRefusalsHaveConcreteOperationTraces':True,'binarySha256':data['sha256']}
(P/'replay-refusal-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print('All 750 phase exits/codes unchanged; exact 26-case refusal matrix and concrete security operations verified.')

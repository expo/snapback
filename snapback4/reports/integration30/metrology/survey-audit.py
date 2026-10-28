from pathlib import Path
import json,collections,hashlib
out=Path(__file__).parent
rows=json.loads((out/'survey-final/results.json').read_text());assert len(rows)==1020
old=json.loads((Path.home()/'sb4-loop/reports/integration29/survey-final/results.json').read_text())
idx={(r['wave'],r['lane']):r for r in old}
missing=[];notVisible=[];counts=collections.Counter();compared=0
for r in rows:
 ids=[d['id']for d in r['reviews']];assert len(ids)==len(set(ids)),(r['wave'],r['lane'],'duplicate ID')
 default=r['defaultCheck']['stdout']+r['defaultCheck']['stderr']
 for d in r['reviews']:
  tier='gate'if d['gated']else'question'if d.get('witness')else'advisory'
  counts[tier]+=1
  if tier!='advisory'and d['id']not in default:notVisible.append(dict(wave=r['wave'],lane=r['lane'],id=d['id'],code=d['code'],tier=tier))
 b=idx.get((r['wave'],r['lane']))
 if not b:continue
 assert b['sha256']==r['sha256'];compared+=1
 def key(d):return(d['code'],d['site'],(d.get('witness')or{}).get('operation'))
 after={key(d)for d in r['reviews']if d['gated']or d.get('witness')}
 for d in b['reviews']:
  if(d['gated']or d.get('witness'))and key(d)not in after:missing.append(dict(wave=r['wave'],lane=r['lane'],**d))
result=dict(schemas=len(rows),sourceMatchedBaselineSchemas=compared,uniqueDispositionIds=True,tiers=dict(counts),notVisibleInDefault=notVisible,priorGateOrWitnessEffectsMissing=missing,method='Cross-version operation misses are exploratory replay changes requiring classification, not cold/warm identity failures. Each current decision ID occurs once; gate/question/advisory disposition is exclusive. Current gated/witnessed decision IDs are checked against actual cold default output. Prior gated/witnessed effects compared by source-identical code/site/operation, independent of ID or evidence changes; misses require assessment.')
(out/'survey-final-tier-audit.json').write_text(json.dumps(result,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items()if k not in ['notVisibleInDefault','priorGateOrWitnessEffectsMissing']},indent=2));print('not visible',len(notVisible),'missing prior effects',len(missing))

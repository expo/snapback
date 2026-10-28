from pathlib import Path
import json,hashlib,collections
p=Path(__file__).parent;oldp=p.parent/'integration29/release150.json';newp=p/'release150.json'
old=json.loads(oldp.read_text());new=json.loads(newp.read_text());assert new['sha256']=='e01da19c3cde5ba6c81dae725983e09a4441924fb91c800eeb37a3ea95778778'
index={(r['wave'],r['lane']):r for r in old['results']};rows=new['results'];assert len(rows)==150 and len({(r['wave'],r['lane'])for r in rows})==150 and set(index)=={(r['wave'],r['lane'])for r in rows}
changes=[];new_refusals=[];unexpected=[];moves=collections.Counter();populations=0
for r in rows:
 b=index[r['wave'],r['lane']]
 for phase in ['inspect','startForward','deploy','exact','rollback1','forward1','rollback2','forward2']:
  x,y=b.get(phase,{}),r.get(phase,{})
  assert y.get('exit')in[0,1],(r['wave'],r['lane'],phase,y)
  if(x.get('exit'),x.get('codes'))!=(y.get('exit'),y.get('codes')):changes.append(dict(wave=r['wave'],lane=r['lane'],phase=phase,before=x,after=y))
  if not x.get('exit')and y.get('exit'):new_refusals.append(changes[-1])
  if y.get('exit')and x.get('codes')!=y.get('codes'):unexpected.append(dict(wave=r['wave'],lane=r['lane'],phase=phase,beforeCodes=x.get('codes'),afterCodes=y.get('codes')))
  if phase in ['deploy','rollback1','forward1','rollback2','forward2']:moves['successful'if y['exit']==0 else'refused']+=1
 for phase in ['rollback1','rollback2']:
  q=r[phase]
  if q['exit']:continue
  assert q['hiddenV1Rows']==0 and q['missingColumns']=={} and q['shapeFieldConsistent']is True,(r['wave'],r['lane'],phase,q)
  assert q['preview']['exit']==0 and q['rowShape']==q['preview']['rowShape']
  populations+=1
result=dict(stores=150,successfulMoves=moves['successful'],expectedRefusals=moves['refused'],consistentRollbackPopulations=populations,hiddenV1Rows=0,timeouts=0,newRefusals=new_refusals,unexpectedRefusalCodes=unexpected,outcomeChanges=changes,binarySha256=new['sha256'],baselineSha256=hashlib.sha256(oldp.read_bytes()).hexdigest(),captureSha256=hashlib.sha256(newp.read_bytes()).hexdigest(),method='All150stores and every5-move outcome compared with Integration29. Every successful backward move preserves allv1rows/columns and equal preview/status shape. SourceDBs never opened; only private regularDB/WAL copies, excluding owner/token sidecars.')
(p/'release150-summary.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items()if k!='outcomeChanges'},indent=2));assert not new_refusals and not unexpected and moves['successful']>=728 and populations>=294

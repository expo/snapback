import json,collections,sys
before=json.load(open(sys.argv[1]));after=json.load(open(sys.argv[2]));out={}
known={(25,'004'),(25,'024'),(25,'030'),(25,'045'),(27,'012'),(27,'042')}
extractions={'008','012','016','020','024','028','032','036','040','044','048'}
for label,data in [('before',before),('after',after)]:
 summary={};assert len(data['results'])==150
 for w in [25,27,29]:
  rows=[r for r in data['results'] if r['wave']==w];assert len(rows)==50
  counts=collections.Counter({key:0 for key in ['successfulMoves','refusedMoves','exact','view','checkedRollbackPopulations','consistentShapeFields']});hidden=[];false=[];shape=[]
  for r in rows:
   for key in ['deploy','rollback1','forward1','rollback2','forward2']:
    if r[key]['exit']==0: counts['successfulMoves']+=1
    else:
     counts['refusedMoves']+=1
     if (w,r['lane']) not in known:false.append([r['lane'],key,r[key]['codes']])
   for key in ['rollback1','rollback2']:
    m=r[key]
    if m['exit']: continue
    assert m['hiddenV1Rows']==0,(label,w,r['lane'],key,'hidden',m['hiddenV1Rows'])
    counts['checkedRollbackPopulations']+=1
    if label=='after':
     assert m['shapeFieldConsistent'] is True,(w,r['lane'],key,'inconsistent')
     counts['consistentShapeFields']+=1
    if key=='rollback1':counts['exact' if m['exact'] else 'view']+=1
   if label=='after' and w==29 and r['lane'] in extractions:
    for k in ['rollback1','rollback2']:
     m=r[k];expected=r['lane']=='040'
     assert m['exit']==0 and m['exact']==expected and m['rowShape']['matchesTarget']==expected,(r['lane'],k)
     assert (not bool(m['missingColumns']))==expected,(r['lane'],k,'independent column census')
    shape.append({'lane':r['lane'],'exact':expected,'v1RowShape':expected,'missingV1Columns':r['rollback1']['missingColumns'],'exactCheck':r['exact']['exit']})
  assert not false,false
  summary[str(w)]={**counts,'defaultRefused':50-counts['exact']-counts['view'],'rowShapeFieldAvailable':label=='after','hiddenV1Rows':0,'falseRefusals':false,'extractions':shape}
 out[label]={'sha256':data['sha256'],'waves':summary}
print(json.dumps(out,indent=2))

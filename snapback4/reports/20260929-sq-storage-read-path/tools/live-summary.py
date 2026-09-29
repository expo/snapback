import pathlib,json,statistics,re
b=pathlib.Path('target/sq');ends=[];queues=[]
for line in (b/'live-server.log').read_text().splitlines():
 if line.startswith('SQ_END '):ends.append(json.loads(line[7:]))
 if line.startswith('SQ_QUEUE '):queues.append(json.loads(line[9:]))
result={}
for stage in ['10%','50%','full']:
 for mode in ['immediate','warm']:
  p=b/f'{stage}-live-{mode}-curve.json'
  if not p.exists():continue
  x=json.loads(p.read_text());rr={}
  for batch in x['rounds']:
   for name,probe in batch['probes'].items():
    assert len(probe['times'])==len(probe['serverTiming'])
    for i,(at,ms,header) in enumerate(zip(probe['timestamps'],probe['times'],probe['serverTiming'])):
     match=next(q for q in ends if q['start']*1000>=at and q['op']==header['op'])
     assert match['end']*1000 <= at+ms+2,(stage,mode,name,'request interval mismatch')
     queue=next(q for q in queues if q['at']>=at and q['op']=='/q/'+header['op'])
     timing={k:float(v) for k,v in re.findall(r'(\w+);dur=([\d.]+)',header['timing'])}
     rr.setdefault(name,[]).append(dict(match,clientMs=ms,queueMs=queue['us']/1000,acquireMs=timing['wait'],serverMs=timing['total'],engineMs=timing['engine'],cpuMs=timing.get('cpu'),complete=probe.get('completeness',[probe['complete']]*10)[i]))
  result[f'{stage}-{mode}']={}
  for name,rows in rr.items():
   summary={k:{'p50':statistics.median(r[k] for r in rows),'max':max(r[k] for r in rows)} for k in ['misses','hits','ms','queueMs','acquireMs','serverMs','clientMs','engineMs']}
   summary['samples']=rows;summary['allComplete']=all(r['complete'] for r in rows)
   result[f'{stage}-{mode}'][name]=summary
(b/'live-summary.json').write_text(json.dumps(result,indent=2))
for tag,probes in result.items():
 print(tag)
 for name,v in probes.items():print(name,'miss median/max',v['misses'],'acquire',v['acquireMs'],'queue',v['queueMs'])

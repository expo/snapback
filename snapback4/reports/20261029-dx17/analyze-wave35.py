import json,glob,collections,gzip,pathlib
root=pathlib.Path('/home/ccheever/sb4-loop/wave35-repro/tx/out')
a=json.load(open('/home/ccheever/sb4-loop/wave35/assignments.json'))
rows=[]
for lane in a:
 if lane['backend']!='snapback' or lane['model']!='muse':continue
 d=json.load(open(root/(lane['id']+'.json')))
 tools=[t for s in d['sessions'] for t in s['tools']]
 c=collections.Counter(t['cat'] for t in tools)
 rows.append({'lane':lane['id'],'calls':sum(s['N'] for s in d['sessions']),'tools':len(tools),'categories':dict(c),'repeatCommands':[r for s in d['sessions'] for r in s.get('repeats',[])],
  'releaseAndVerify':[{'call':t['k'],'category':t['cat'],'command':t.get('cmd'),'exit':t.get('final_exit'),'tokens':t.get('tok')}for t in tools if any(w in t['cat'] for w in ['sb:guide','sb:deploy','sb:rollback','proofs:','read-shell:logs'])]})
out=pathlib.Path(__file__).parent
with gzip.open(out/'wave35-calls.json.gz','wt')as f:json.dump(rows,f)
print(json.dumps({'museLanes':len(rows),'selected':[{k:r[k] for k in ['lane','calls','tools','categories']}for r in rows if r['lane'].startswith(('009-','011-','018-'))]},indent=2))

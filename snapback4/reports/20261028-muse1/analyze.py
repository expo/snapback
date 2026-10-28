import sys,runpy,json,collections,statistics,pathlib,os
SOURCE=os.environ.get("TX_SOURCE",os.path.expanduser("~/sb4-loop/wave34r1-repro/tx"))
RESULTS=os.environ.get("MUSE1_ANALYSIS","/tmp/muse1-analysis")
sys.path.insert(0,SOURCE)
agg=runpy.run_path(SOURCE+'/agg.py')
# Preserve the original cycle model, correcting its unreachable re-run branch.
# It used any(... for f in []), so failed-family re-runs were always "verify".
calls_text=pathlib.Path(SOURCE+'/scripts/calls.py').read_text()
assert "elif c in FAMILY: p = 'fix-after-red (re-run)'" in calls_text
calls_text=calls_text.replace("            # a run of a family with an open red closes that cycle", "            closing_red = any(fam in open_red for fam in runs_at.get(k, []))\n            # a run of a family with an open red closes that cycle")
calls_text=calls_text.replace("'fix-after-red (re-run)' if any(f in runs_at.get(k, []) for f in []) else 'verify'", "'fix-after-red' if closing_red else 'verify'")
calls={'__name__':'muse1_calls','__file__':SOURCE+'/scripts/calls.py'}
exec(compile(calls_text,calls['__file__'],'exec'),calls)
docs=runpy.run_path(SOURCE+'/scripts/docs.py')

A=json.load(open('/home/ccheever/sb4-loop/bakeoff/next37/wave34r2/assignments.json'))
rows=[]
for a in A:
 r={'id':a['id'],'n':a['n'],'model':a['model'],'frontend':a['frontend']}
 for label,root in [('before',RESULTS+'/r1'),('after',RESULTS+'/r2')]:
  d=json.load(open(f"{root}/{a['id']}.json")); x=agg['lane_agg'](d['sessions']); p,cy=calls['lane_calls'](d,'snapback'); dd=docs['lane_docs'](d)
  x.update(purpose=p,cycles=cy,docs=dd)
  feats=collections.defaultdict(lambda:collections.Counter())
  for s in d['sessions']:
   for t in s['tools']:
    c=t['cmd'] or ''; cat=t['cat']; names=[]
    if 'proof-scaffold' in c:names.append('scaffold mentions')
    if ('read-' in cat) and 'proof-scaffold' in c:names.append('scaffold reads')
    if 'verify' in c and not t.get('w'):names.append('verify mentions')
    if cat.startswith('poll:') or cat in ('sleep/poll','serve/wait'):names.append('waiting')
    if ('read-' in cat) and ('generated/' in c or 'api.ts' in c):names.append('generated reads')
    for name in names:
     for k,v in [('tools',1),('chars',t['len'] or 0),('tokens',t['tok'] or 0),('input_cost',t['cost'] or 0),('seconds',t['sec'] or 0)]:feats[name][k]+=v
  x['features']=feats;r[label]=x
 rows.append(r)
json.dump(rows,open(RESULTS+'/paired.json','w'),indent=2)
for model in ['muse','codex']:
 rs=[r for r in rows if r['model']==model];print('\nMODEL',model,len(rs))
 for key in ['N','sumC','span','tool','model']:
  print(key,*[round(statistics.mean(r[l][key] for r in rs),2) for l in ['before','after']])
 for key in ['purpose','cats','raw','features']:
  print('\n',key)
  if key=='features':
   for k in rs[-1]['after'][key]:print(k,[(l,{q:round(statistics.mean(r[l][key].get(k,{}).get(q,0) for r in rs),1) for q in ['tools','chars','tokens','input_cost','seconds']}) for l in ['before','after']])
  else:
   keys=set(k for r in rs for l in ['before','after'] for k in r[l][key]); vals=[(k,*[statistics.mean(r[l][key].get(k,0) for r in rs) for l in ['before','after']]) for k in keys]
   for k,b,a in sorted(vals,key=lambda x:-(x[2]-x[1])):print(k,round(b,1),round(a,1),round(a-b,1))
 print('worst input deltas:')
 for r in sorted(rs,key=lambda r:r['after']['sumC']-r['before']['sumC'],reverse=True):print(r['n'],r['id'],r['frontend'],r['before']['N'],r['after']['N'],r['before']['sumC'],r['after']['sumC'])
 cy=collections.defaultdict(list)
 for r in rs:
  for c in r['after']['cycles']:cy[c['cls']].append(c)
 print('cycles',[(k,len(v),sum(c['calls'] for c in v)) for k,v in sorted(cy.items(),key=lambda kv:-sum(c['calls'] for c in kv[1]))][:15])

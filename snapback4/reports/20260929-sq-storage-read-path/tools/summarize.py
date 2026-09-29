import json,pathlib,statistics,sys,csv
base=pathlib.Path(sys.argv[1] if len(sys.argv)>1 else 'target/sq')
med=statistics.median
stages=['10pct','50pct','full']
def summarize(x):
 stages=list(dict.fromkeys(b['stage'] for b in x['rounds']))
 probes=list(x['rounds'][0]['probes']);out={'points':{},'rules':{},'roundRules':[]}
 for name in probes:
  out['points'][name]={}
  for stage in stages:
   batches=[b['probes'][name] for b in x['rounds'] if b['stage']==stage]
   times=sorted(t for b in batches for t in b['times'])
   out['points'][name][stage]={'p50':med(b['p50'] for b in batches),'p95':med(b['p95'] for b in batches),'max':max(times),'n':len(times),'pooledP95':times[__import__('math').ceil(len(times)*.95)-1]}
 def rules(points,deep):
  if len(stages)!=3:return {}
  a,b,z=stages
  rs={}
  def rule(n,v,ceiling,units):rs[n]={'measured':v,'ceiling':ceiling,'margin':ceiling-v,'pass':v<=ceiling,'units':units}
  for name in ['search100','insights','trending']:
   lo,mid,hi=[points[name][s] for s in stages]
   rule(name+'FullSmall',hi/lo,3,'ratio');rule(name+'MidCurve',mid,lo+(hi-lo)*4/9,'ms')
  rule('following500',points['following500'][z]/points['following5'][z],3,'ratio')
  rule('celebrityRead',points['celebrityFollower'][z]/points['following5'][z],3,'ratio')
  if deep:rule('deepPaging',deep/points['busyHistory'][z],3,'ratio')
  return rs
 out['rules']=rules({name:{stage:out['points'][name][stage]['p95'] for stage in stages} for name in probes},x.get(stages[-1],{}).get('deepPaging',{}).get('p95'))
 for r in sorted(set(b['round'] for b in x['rounds'])):
  p={name:{b['stage']:b['probes'][name]['p95'] for b in x['rounds'] if b['round']==r} for name in probes}
  out['roundRules'].append({'round':r,'rules':rules(p,next((v['p95'] for v in x.get(stages[-1],{}).get('deepPaging',{}).get('rounds',[]) if v['round']==r),None))})
 return out
all={}
for p in sorted(base.glob('*-curve.json')):
 x=json.loads(p.read_text());all[p.stem]=summarize(x)
 print(p.stem)
 for name,r in all[p.stem]['rules'].items(): print(f"  {name:22} {r['measured']:.3f} <= {r['ceiling']:.3f}, margin {r['margin']:+.3f} {r['units']} {'PASS' if r['pass'] else 'FAIL'}")
print('celebrityWrite: not measured by read-only curves; use the separate replay receipt rule (no inferred pass).')
(base/'summary.json').write_text(json.dumps(all,indent=2))
with (base/'batches.csv').open('w') as f:
 w=csv.writer(f);w.writerow(['tag','round','stage','probe','p50','p95','max','at','load1','load5','load15','cpus','freeBytes'])
 for p in sorted(base.glob('*-curve.json')):
  for b in json.loads(p.read_text())['rounds']:
   for name,v in b['probes'].items():w.writerow([p.stem,b['round'],b['stage'],name,v['p50'],v['p95'],v['max'],b['host']['at'],*b['host']['loadavg'],b['host']['cpus'],b['host']['freeBytes']])

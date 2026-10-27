from pathlib import Path
import json,gzip,math,statistics,collections
out=Path('/home/ccheever/sb4-loop/reports/integration28');repo=Path('/home/ccheever/projects/snapback-sb4loop');rows=json.loads((out/'survey-tier-first/results.json').read_text())+json.loads((out/'survey-tier-rest/results.json').read_text());assert len(rows)==940 and len({(r['wave'],r['lane']) for r in rows})==940;rows.sort(key=lambda r:(r['wave'],r['lane']))
prior=json.load(gzip.open(repo/'snapback4/reports/sec11-latency/after-survey.json.gz','rt'));prior={(r['wave'],r['lane']):r for r in prior};sec12=json.load(gzip.open(repo/'snapback4/reports/sec12/after850.json.gz','rt'));prior.update({(r['wave'],r['lane']):r for r in sec12 if r['wave']==31})
def metric(field,key):
 xs=sorted(r[field][key]for r in rows if field in r);return dict(count=len(xs),median=statistics.median(xs),p90=xs[math.ceil(.9*len(xs))-1],max=max(xs))
def key(f):
 s=f['site'];return (s['file'],s['line'],s.get('col',1),f.get('operation'))
extras=[];gates=[];fixes=[]
for r in rows:
 old=prior.get((r['wave'],r['lane']));
 if old and old['sha256']!=r['sha256']:extras.append(dict(wave=r['wave'],lane=r['lane'],kind='source mismatch'))
 known={key(f)for m in ['fresh','afterTest']for f in (old or{}).get(m,{}).get('fixes',[])}
 for f in r.get('fresh',{}).get('fixes',[]):
  record=dict(wave=r['wave'],lane=r['lane'],**f,classification='SEC11L carried source-reviewed replay'if key(f)in known else'UNCLASSIFIED');fixes.append(record)
  if key(f)not in known:extras.append(record)
 for g in r['gates']:
  carried=old and any(g['code']==p['code']and g['site']==p['site']and(g.get('witness')or{}).get('operation')==(p.get('witness')or{}).get('operation')for p in old['gates']);record=dict(wave=r['wave'],lane=r['lane'],code=g['code'],site=g['site'],operation=(g.get('witness')or{}).get('operation'),classification='carried applicable gate'if carried else'UNCLASSIFIED');gates.append(record)
  if not carried:extras.append(record)
 for name in ['defaultCheck','defaultDeploy','fresh']:
  e=r.get(name,{}).get('exit')
  if e not in[0,1]:extras.append(dict(wave=r['wave'],lane=r['lane'],kind='tool failure',command=name,exit=e))
 if r['defaultDeploy']['exit']!=r['fresh']['exit']:extras.append(dict(wave=r['wave'],lane=r['lane'],kind='default/JSON deployment mismatch'))
result=dict(schemas=len(rows),availableSchemas=940,sourceHashesCompared=sum((r['wave'],r['lane'])in prior for r in rows),sourceHashesMatch=not any(v.get('kind')=='source mismatch'for v in extras),defaultCheckLines=metric('defaultCheck','lines'),defaultDeployLines=metric('defaultDeploy','lines'),concurrentColdCheckSeconds=metric('defaultCheck','seconds'),concurrentDeploySeconds=metric('defaultDeploy','seconds'),gates=gates,fixes=fixes,unclassified=extras,refusals=sum(bool(r.get('fresh',{}).get('exit'))for r in rows),method='Optimized test-profile immutable candidate; at most 8 survey workers, reduced to 4 during paired production latency measurement; source and authored fixture copies only. No original store opened. Current local successful-check predecessor supplied on wave31, no synthetic deployment predecessor. SEC11L/SEC10 source-bound precision baseline; all new gates/FIX remain unclassified until manually assessed.')
(out/'survey-final-summary.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items()if k not in['gates','fixes','unclassified']},indent=2));print('unclassified',len(extras))
# Reuse exact operation/material/role matching from SEC12's calibration tooling.
s=(repo/'snapback4/reports/sec12/tools/coverage.py').read_text();scope={"json":json};exec(s[s.index('rules={'):s.index('indexes=')],scope);category=scope['category'];rules=scope['rules'];assess=[];idx={(r['wave'],r['lane'][:3]):r for r in rows}
for w in [30,31]:
 for f in json.loads((Path.home()/f'sb4-loop/wave{w}/analysis/calibration.json').read_text())['findings']:
  if f.get('backend')!='snapback'or f.get('cal')!='M'or w==31 and f.get('inherited')is not None:continue
  r=idx.get((w,f['lane']))
  if r:assess.append(dict(wave=w,lane=f['lane'],finding=f['id'],**category(r,rules[w,f['lane'],f['id']])))
(out/'calibration-final-30-31.json').write_text(json.dumps(dict(assessments=assess,summary={w:dict(collections.Counter(v['category']for v in assess if v['wave']==w))for w in[30,31]}),indent=2)+'\n')

import json,gzip,math,statistics,hashlib
from pathlib import Path
out=Path('/home/ccheever/sb4-loop/reports/integration27')
rows=json.loads((out/'survey/results.json').read_text());baseline=json.load(gzip.open('/home/ccheever/sb4-loop/sec10-shipping-final-evidence/sec10-shipping-final-survey/results.json.gz','rt'));prior={(r['wave'],r['lane']):r for r in baseline}
def key(f):
 s=f['site'];return (s['file'],s['line'],s.get('col',1),f.get('operation'))
extra=[];gates=[];fixes=[]
for r in rows:
 b=prior[r['wave'],r['lane']]
 if r['sha256']!=b['sha256']:extra.append(dict(wave=r['wave'],lane=r['lane'],kind='source mismatch'))
 for g in r['gates']:
  expected=[x for x in b['gates'] if x['code']==g['code'] and x['site']==g['site'] and x.get('witness',{}).get('operation')==g.get('witness',{}).get('operation')]
  record=dict(wave=r['wave'],lane=r['lane'],code=g['code'],site=g['site'],operation=g.get('witness',{}).get('operation'),classification='SEC10 source-reviewed current applicable approval bypass' if expected else 'UNCLASSIFIED')
  gates.append(record)
  if not expected:extra.append(record)
 oldfixes={key(f)for mode in ['fresh','afterTest']for f in b[mode]['fixes']}
 for f in r['fresh']['fixes']:
  record=dict(wave=r['wave'],lane=r['lane'],**f,classification='SEC10 classified replay'if key(f)in oldfixes else 'UNCLASSIFIED');fixes.append(record)
  if key(f)not in oldfixes:extra.append(record)
 if r['fresh']['exit'] and not b['fresh']['exit']:extra.append(dict(wave=r['wave'],lane=r['lane'],kind='new fresh refusal',result=r['fresh']))
 if r['fresh']['exit'] not in [0,1] or r['defaultDeploy']['exit']!=r['fresh']['exit']:extra.append(dict(wave=r['wave'],lane=r['lane'],kind='nonsecurity failure or default/JSON disagreement'))
def summary(field,key):
 xs=sorted(r[field][key]for r in rows);return dict(median=statistics.median(xs),p90=xs[math.ceil(len(xs)*.9)-1],max=max(xs))
result=dict(schemas=len(rows),sourceHashesMatch=not any(e.get('kind')=='source mismatch'for e in extra),gates=gates,fixes=fixes,unclassified=extra,falseGates=0 if not extra else None,falseProductionRefusals=0 if not extra else None,freshRefused=sum(bool(r['fresh']['exit'])for r in rows),defaultCheckLines=summary('defaultCheck','lines'),defaultDeployLines=summary('defaultDeploy','lines'),coldCheckSeconds=summary('defaultCheck','seconds'),productionDeploySeconds=summary('defaultDeploy','seconds'),measurement='Optimized test-profile native, 8 workers, fresh source/store copies. Timings include concurrent host work; not publication-profile or isolated-core claims.',baseline='SEC10 800-schema source-reviewed precision; every additional finding remains unclassified until examined.')
(out/'survey-summary.json').write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items()if k not in ['fixes','gates']},indent=2))

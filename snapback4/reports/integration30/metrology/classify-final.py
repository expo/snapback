from pathlib import Path
import json,gzip,statistics,math,collections
out=Path(__file__).parent
repo=Path('/home/ccheever/projects/snapback-sb4loop')
rows=json.loads((out/'survey-final/results.json').read_text())
def metric(field,key):
 xs=sorted(r[field][key]for r in rows if field in r);return dict(count=len(xs),median=statistics.median(xs),p90=xs[math.ceil(.9*len(xs))-1],max=max(xs))
prior=json.loads((Path.home()/'sb4-loop/reports/integration29/survey-final/results.json').read_text())
old={(r['wave'],r['lane']):r for r in prior}
extra=[];gates=[];fixes=[];changes=[]
def key(f):
 s=f['site'];return(s['file'],s['line'],s.get('col',1),f.get('operation'))
for r in rows:
 b=old.get((r['wave'],r['lane']))
 for name,failure in [('check',r.get('checkFailure')),('fresh',r.get('fresh',{}).get('failure'))]:
  if failure and failure.get('kind')!='exit':extra.append(dict(wave=r['wave'],lane=r['lane'],phase=name,kind='non-product measurement failure',failure=failure))
 if b and b['sha256']!=r['sha256']:extra.append(dict(wave=r['wave'],lane=r['lane'],kind='source mismatch'))
 for phase in ['defaultCheck','defaultDeploy','fresh']:
  if r.get(phase,{}).get('exit')not in[0,1]:extra.append(dict(wave=r['wave'],lane=r['lane'],phase=phase,kind='tool failure',exit=r.get(phase,{}).get('exit')))
 if r['defaultDeploy']['exit']!=r['fresh']['exit']:extra.append(dict(wave=r['wave'],lane=r['lane'],kind='default/JSON deployment mismatch'))
 for g in r['gates']:
  carried=b and any(p['code']==g['code']and p['site']==g['site']and(p.get('witness')or{}).get('operation')==(g.get('witness')or{}).get('operation')for p in b['gates'])
  rec=dict(wave=r['wave'],lane=r['lane'],code=g['code'],site=g['site'],operation=(g.get('witness')or{}).get('operation'),classification='carried source-reviewed gate'if carried else'UNCLASSIFIED');gates.append(rec)
  if not carried:extra.append(rec)
 known={key(f)for phase in ['fresh','afterTest']for f in (b or{}).get(phase,{}).get('fixes',[])}
 for f in r.get('fresh',{}).get('fixes',[]):
  rec=dict(wave=r['wave'],lane=r['lane'],**f,classification='carried source-reviewed production refutation'if key(f)in known else'UNCLASSIFIED');fixes.append(rec)
  if key(f)not in known:extra.append(rec)
 if b and r['fresh']['exit']and not b['fresh']['exit']:extra.append(dict(wave=r['wave'],lane=r['lane'],kind='new production refusal'))
 if b:
  before={(d['code'],d['site'],d['id'],(d.get('witness')or{}).get('id'))for d in b['reviews']};after={(d['code'],d['site'],d['id'],(d.get('witness')or{}).get('id'))for d in r['reviews']}
  if before!=after:changes.append(dict(wave=r['wave'],lane=r['lane'],removed=sorted(before-after,key=str),added=sorted(after-before,key=str)))
result=dict(schemas=len(rows),baselineSchemas=len(old),sourceHashesCompared=sum((r['wave'],r['lane'])in old for r in rows),defaultCheckLines=metric('defaultCheck','lines'),defaultDeployLines=metric('defaultDeploy','lines'),gates=gates,fixes=fixes,unclassified=extra,freshRefusals=sum(bool(r['fresh']['exit'])for r in rows),method='At most4 workers; actual cold default check/deploy plus JSON, private source/fixture copies; shared-host timings are not latency qualification. Source-reviewed Integration29 baseline; new gates/FIX/refusals require individual assessment.')
(out/'survey-final-summary.json').write_text(json.dumps(result,indent=2)+'\n');(out/'survey-final-identity-changes.json').write_text(json.dumps(changes,indent=2)+'\n')
print(json.dumps({k:v for k,v in result.items()if k not in['gates','fixes','unclassified']},indent=2));print('unclassified',len(extra),'schemas with identity changes',len(changes))

import argparse,json,gzip,pathlib,math,statistics
p=argparse.ArgumentParser();p.add_argument('--survey',required=True);p.add_argument('--out',required=True);a=p.parse_args()
rows=json.loads(pathlib.Path(a.survey).read_text())
base=json.load(gzip.open('snapback4/reports/integration27/survey-all800.json.gz','rt'))
sec10=json.load(gzip.open(pathlib.Path.home()/'sb4-loop/sec10-shipping-final-evidence/sec10-shipping-final-survey/results.json.gz','rt'))
prior={(r['wave'],r['lane']):r for r in base};postprior={(r['wave'],r['lane']):r for r in sec10}
def fixkey(f):return(f['site']['file'],f['site']['line'],f['site'].get('col',1),f.get('operation'))
def gatekey(g):return(g['code'],g['site'],(g.get('witness')or{}).get('operation'))
extra=[];gates=[];fixes=[]
for r in rows:
 old=prior[(r['wave'],r['lane'])];post=postprior[(r['wave'],r['lane'])]
 if r['sha256']!=old['sha256']:extra.append(dict(wave=r['wave'],lane=r['lane'],kind='source mismatch'))
 for mode in ['fresh','afterTest']:
  expected=old['fresh']if mode=='fresh'else post['afterTest'];now=r[mode]
  # Integration27 superseded SEC10 fresh verdicts; full-test additions were
  # already source-reviewed by SEC10. Compare each FIX to either retained set.
  known={fixkey(f)for f in old['fresh']['fixes']}|{fixkey(f)for m in['fresh','afterTest']for f in post[m]['fixes']}
  for f in now['fixes']:
   ok=fixkey(f)in known;record=dict(wave=r['wave'],lane=r['lane'],mode=mode,**f,classification='carried source-reviewed replay'if ok else'UNCLASSIFIED');fixes.append(record)
   if not ok:extra.append(record)
  if now['exit']not in[0,1]:extra.append(dict(wave=r['wave'],lane=r['lane'],mode=mode,kind='nonsecurity exit',exit=now['exit']))
  if now['exit']and not expected['exit']:
   if not now['securityRefused']or not now['fixes']:extra.append(dict(wave=r['wave'],lane=r['lane'],mode=mode,kind='new refusal',exit=now['exit']))
 for g in r['gates']:
  ok=gatekey(g)in{gatekey(x)for x in old['gates']};record=dict(wave=r['wave'],lane=r['lane'],code=g['code'],site=g['site'],operation=(g.get('witness')or{}).get('operation'),classification='carried current applicable approval bypass'if ok else'UNCLASSIFIED');gates.append(record)
  if not ok:extra.append(record)
 if r['checkExit']not in[0,1]or r['defaultDeploy']['exit']!=r['fresh']['exit']:extra.append(dict(wave=r['wave'],lane=r['lane'],kind='watchdog or default/JSON mismatch'))
 if any('(time)'in str(r.get(k,{}).get('failure',{})) or 'runtime panic'in str(r.get(k,{}).get('failure',{})) for k in ['test','fresh','afterTest']):extra.append(dict(wave=r['wave'],lane=r['lane'],kind='internal watchdog or runtime panic',failure={k:r[k].get('failure')for k in ['test','fresh','afterTest']}))
 if r['test']['exit']not in[0,1]:extra.append(dict(wave=r['wave'],lane=r['lane'],kind='test watchdog or tool failure',exit=r['test']['exit']))
def metric(field,key,subset=rows):
 xs=sorted(r[field][key]for r in subset);return dict(median=statistics.median(xs),p90=xs[math.ceil(.9*len(xs))-1],max=max(xs))
result=dict(schemas=len(rows),sourceHashesMatch=not any(x.get('kind')=='source mismatch'for x in extra),gates=gates,fixes=fixes,unclassified=extra,falseGates=0 if not extra else None,falseProductionRefusals=0 if not extra else None,
 freshRefused=sum(bool(r['fresh']['exit'])for r in rows),postTestRefused=sum(bool(r['afterTest']['exit'])for r in rows),defaultCheckLines=metric('defaultCheck','lines'),defaultDeployLines=metric('defaultDeploy','lines'),wave30=dict(defaultCheckLines=metric('defaultCheck','lines',[r for r in rows if r['wave']==30]),defaultDeployLines=metric('defaultDeploy','lines',[r for r in rows if r['wave']==30])),
 timingUnderConcurrentSurvey=dict(coldCheckSeconds=metric('defaultCheck','seconds'),deploySeconds=metric('defaultDeploy','seconds')),method='Current production-profile binary on source/fixture copies; 40 survey workers plus 8 wave31 observers, with concurrent host work. Timing is not isolated latency qualification. Every extra result remains unclassified until read, never assumed false or true.')
pathlib.Path(a.out).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:v for k,v in result.items()if k not in['gates','fixes','unclassified']},indent=2));print('unclassified',len(extra))

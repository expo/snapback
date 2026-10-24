#!/usr/bin/env python3
"""Produce a portable, argument-free comparison for manual gate/refusal review."""
import argparse,hashlib,json,pathlib
p=argparse.ArgumentParser();p.add_argument('--measurement-root',required=True);p.add_argument('--candidate',required=True);p.add_argument('--out',required=True);a=p.parse_args();root=pathlib.Path(a.measurement_root);candidate=root/a.candidate;out=pathlib.Path(a.out);out.mkdir(parents=True,exist_ok=True)
def load(path):return json.loads(path.read_text())
def site(s):return f"{s['file']}:{s['line']}:{s.get('col',1)}" if isinstance(s,dict) else s
def fixes(r):return {(site(v['site']),v.get('operation','')) for phase in ['fresh','afterTest'] for v in r[phase]['fixes']}
def gates(r):return {(g['code'],site(g['site'])) for g in r['gates']}
base={(r['wave'],r['lane']):r for name in ['sec10-survey-baseline','sec10-survey-baseline-w15'] for r in load(root/name/'results.json')};rows=load(candidate/'results.json');assert len(rows)==len(base)==600
newg=[];newf=[];portable=[];watchdogs=[]
for r in rows:
 key=(r['wave'],r['lane']);b=base[key];assert r['sha256']==b['sha256'],key
 if r['checkExit'] in [124,137] or any(r[p]['exit'] in [124,137] for p in ['fresh','test','afterTest']):watchdogs.append(key)
 for code,where in sorted(gates(r)-gates(b)):
  descriptions=[n['message'] for n in r['notes'] if n['code']==code and site(n['site'])==where]
  newg.append(dict(wave=key[0],lane=key[1],code=code,site=where,messages=descriptions,classification='pending manual review'))
 for where,operation in sorted(fixes(r)-fixes(b)):newf.append(dict(wave=key[0],lane=key[1],site=where,operation=operation,classification='pending manual review'))
 portable.append(dict(wave=key[0],lane=key[1],sourceSha256=r['sha256'],checkExit=r['checkExit'],gates=[dict(code=c,site=s) for c,s in sorted(gates(r))],fresh=dict(exit=r['fresh']['exit'],securityRefused=r['fresh']['securityRefused']),test=dict(exit=r['test']['exit'],witnesses=r['test']['witnesses']),afterTest=dict(exit=r['afterTest']['exit'],securityRefused=r['afterTest']['securityRefused']),deploymentFixes=[dict(site=s,operation=o) for s,o in sorted(fixes(r))]))
summary=dict(baseline='packed npm 0.4.40',candidate=load(candidate/'measurement.json'),projects=len(rows),sourceHashesMatch=True,watchdogs=watchdogs,newGates=newg,newDeploymentFixes=newf,projectsWithNewGates=len({(x['wave'],x['lane']) for x in newg}),newlyRefusingFresh=sum(not base[(r['wave'],r['lane'])]['fresh']['securityRefused'] and r['fresh']['securityRefused'] for r in rows),newlyRefusingAfterTest=sum(not base[(r['wave'],r['lane'])]['afterTest']['securityRefused'] and r['afterTest']['securityRefused'] for r in rows))
(out/'survey.json').write_text(json.dumps(portable,indent=2)+'\n');(out/'comparison.json').write_text(json.dumps(summary,indent=2)+'\n');print(json.dumps(dict(projects=len(rows),newGates=len(newg),newDeploymentFixes=len(newf),watchdogs=len(watchdogs))))

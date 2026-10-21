#!/usr/bin/env python3
"""Audit completed Cargo target coverage across bounded qualification invocations."""
import json,re
from pathlib import Path
ROOT=Path(__file__).resolve().parent
packages=json.loads((ROOT/'logs/cargo-targets.json').read_text())['packages']
expected={}
for p in packages:
    targets=[]
    for t in p['targets']:
        source=Path(t['src_path']).relative_to(Path(p['manifest_path']).parent).as_posix()
        if t.get('test') and set(t['kind']) & {'test','lib','bin','rlib','cdylib'}:
            targets.append(('test:' if t['kind']==['test'] else 'unit:')+source)
        if t.get('doctest') and set(t['kind']) & {'lib','rlib','cdylib'}:
            targets.append('doc')
    expected[p['name']]=targets
results={};commands=[]
logs=['cargo-workspace-final.log','cargo-remaining-crates.log','cargo-core-device-doc.log','final-cli-output-tests.log','final-coverage-restoration-rerun.log']
for logfile in logs:
    package={"final-cli-output-tests.log":"snapback4","final-coverage-restoration-rerun.log":"snapback4-lang"}.get(logfile);active=None;completed=0
    for line in (ROOT/'logs'/logfile).read_text().splitlines():
        m=re.match(r'\s*Running unittests (.*?) \(.*?/deps/([^/]+)\)',line)
        if m:
            package=next((p for p in sorted(expected,key=len,reverse=True) if m[2].startswith(p.replace('-','_')+'-')),None)
            active=(package,'unit:'+m[1]);continue
        m=re.match(r'\s*Running (tests/.*?) \(',line)
        if m:active=(package,'test:'+m[1]);continue
        m=re.match(r'\s*Doc-tests (\S+)',line)
        if m:package=m[1].replace('_','-');active=(package,'doc');continue
        m=re.match(r'test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;',line)
        if m and active:
            results[active]={'status':m[1],'passed':int(m[2]),'failed':int(m[3]),'ignored':int(m[4]),'log':logfile}
            active=None;completed+=1
    commands.append({'log':logfile,'completedTargetSummaries':completed})
summary={};missing=[];failed=[]
for p,targets in expected.items():
    states={key:results.get((p,key)) for key in targets}
    for key,state in states.items():
        if state is None:missing.append(p+' '+key)
        elif state['status']!='ok':failed.append(p+' '+key)
    summary[p]={'expectedTargets':len(targets),'completedTargets':sum(v is not None for v in states.values()),'targets':states}
output={'format':1,'method':'Full bounded jobs plus later affected-target repairs; later named logs supersede earlier target statuses. Timeouts and original reds remain in raw logs.','commands':commands,'packages':summary,'missing':missing,'failed':failed}
(ROOT/'cargo-coverage.json').write_text(json.dumps(output,indent=2)+'\n')
print(json.dumps({'packages':{p:{k:v for k,v in s.items() if k!='targets'} for p,s in summary.items()},'missing':missing,'failed':failed},indent=2))

raise SystemExit(bool(missing or failed))

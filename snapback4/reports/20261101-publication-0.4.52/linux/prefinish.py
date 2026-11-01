from pathlib import Path
import json,subprocess,hashlib,datetime,re
r=Path('/home/ccheever/sb4-pub-0452-records');w=Path('/home/ccheever/sb4-pub-0441')
load=lambda name:json.loads((r/name).read_text())
c=subprocess.check_output(['git','-C',str(w),'rev-parse','HEAD'],text=True).strip()
assert subprocess.check_output(['git','-C',str(w),'status','--porcelain'],text=True)==''
stage=load('staged-validation.json');assert stage['status']=='passed' and stage['source']==c
expected={a['filename']:a['sha256'] for a in stage['artifacts']}
for filename,h in expected.items():assert hashlib.sha256((r/'staged-0.4.52'/filename).read_bytes()).hexdigest()==h
for host in ['linux','mac']:
 assert (r/f'smoke-staged-{host}.exit').read_text().strip()=='0'
 smoke=(r/f'smoke-staged-{host}.log').read_text().replace('\r','')
 assert len(re.findall(r'^PASS ',smoke,re.M))==10 and '\nRESULT PASS\n' in smoke and '\nFAIL ' not in smoke
 assert re.search(r'root[^\n]*sshd',smoke)
 q=load('audit-linux-final/summary.json' if host=='linux' else 'audit-mac-final-summary.json')
 assert q['status']=='passed' and q['source']==c and q['version']=='0.4.52'
 assert len(q['cases'])==2 and {case['kind'] for case in q['cases']}=={'web','expo'}
 for case in q['cases']:assert case['status']=='passed' and case['warnings']==[] and all(n==0 for n in case['vulnerabilities'].values())
 assert len(q['artifacts'])==2
 for path,h in q['artifacts'].items():assert expected[Path(path).name]==h
assert (r/'audit-linux-final.exit').read_text().strip()=='0'
mac=load('mac-prefinish-state.json')
assert mac['source']==c and mac['power']=='AC' and mac['lid']=='open' and mac['dryRun']=='passed' and mac['finalAuditExit']==0 and mac['darwinProof']=='passed'
sris={a['name']:a['integrity'] for a in stage['artifacts']}
assert {a['name']:a['integrity'] for a in mac['artifacts']}=={name:sri for name,sri in sris.items() if name!='snapback4-expo'}
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':c,'status':'passed','foregroundStagedSmokes':'both hosts10/10, root sshd ancestry','finalStockAudits':'both hosts web+Expo zero findings/warnings','artifacts':stage['artifacts'],'macState':mac}
(r/'linux-prefinish-green.json').write_text(json.dumps(result,indent=2)+'\n')
print('PREFINISH PASS: exact source/bytes, both foreground smokes, both zero audits, Darwin dry proof, AC/lid')

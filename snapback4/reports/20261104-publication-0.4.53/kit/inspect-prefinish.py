from pathlib import Path
import json,subprocess,sys,datetime,re
k=Path.home()/'sb4-pub-0453';w=Path.home()/'sb4-pub-0453-wt'
c=sys.argv[1]
head=subprocess.check_output(['git','-C',str(w),'rev-parse','HEAD'],text=True).strip()
assert head==c
status=subprocess.check_output(['git','-C',str(w),'status','--porcelain'],text=True).splitlines()
assert status==[' M snapback4/metrics/publish.jsonl'],status
assert (k/'dry-run-1.exit').read_text().strip()=='done'
assert not (k/'dry-run-1.env-invalid').exists()
assert (k/'audit-mac-final.exit').read_text().strip()=='0'
q=json.loads((w/'snapback4/metrics/publish.jsonl').read_text().splitlines()[-1])
assert q['source']==c and q['version']=='0.4.53' and q['dry'] is True
assert q['artifacts'][0]['proof']['status']=='passed'
power=subprocess.check_output(['pmset','-g','batt'],text=True)
lid=subprocess.check_output(['ioreg','-r','-k','AppleClamshellState'],text=True)
assert "Now drawing from 'AC Power'" in power
assert '"AppleClamshellState" = No' in lid
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'source':head,'status':status,'power':'AC','lid':'open','dryRun':'passed','finalAuditExit':0,'darwinProof':'passed','artifacts':[{'name':a['name'],'integrity':a['integrity']} for a in q['artifacts']]}
print(json.dumps(result,indent=2))

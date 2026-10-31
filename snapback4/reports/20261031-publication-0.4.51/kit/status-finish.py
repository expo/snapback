from pathlib import Path
import subprocess,json,datetime,re,shutil
k=Path.home()/'sb4-pub-0451';w=Path.home()/'sb4-pub-0444-wt/snapback4';r=w/'reports/20261031-publication-0.4.51'
power=subprocess.check_output(['pmset','-g','batt'],text=True)
q={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'power':'AC' if "Now drawing from 'AC Power'" in power else 'battery-or-unavailable','percent':re.search(r'(\d+)%;',power).group(1),'freeGiB':shutil.disk_usage(w).free//2**30,'steps':[]}
for step in ['publication-resume','registry-cli','expo-pack','expo-pack-verification','expo-proof-bytes','expo-publish','expo-registry-wait','registry-expo']:
 p=r/f'attempt-2-{step}.json'; log=p.with_suffix('.log')
 if p.exists():
  data=json.loads(p.read_text());q['steps'].append({key:data[key] for key in ['step','exit','seconds']})
 elif log.exists():q['steps'].append({'step':step,'status':'active','logBytes':log.stat().st_size})
p=k/'finish-2.exit';q['finishExit']=p.read_text().strip() if p.exists() else None
p=k/'finish-a2.log';q['finishSummary']=p.read_text().splitlines()[-10:] if p.exists() else []
p=r/'attempt-2-publication-resume.log'
q['registryMessages']=re.findall(r'^(?:publish: [^\n]+|npm notice Publishing to [^\n]+|npm notice Your package [^\n]+|\+ snapback4[^\n]+)$',p.read_text(errors='replace'),re.M)[-5:] if p.exists() else []
print(json.dumps(q,indent=2))

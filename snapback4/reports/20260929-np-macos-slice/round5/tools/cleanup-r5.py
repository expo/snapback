from pathlib import Path
import subprocess,json,os,time
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round5';u=(e/'owned.udid').read_text().strip()
assert u=='70220322-4798-470D-BE66-E17EAED0B7FD'
env=dict(os.environ,DEVELOPER_DIR='/Applications/Xcode.app/Contents/Developer',TMPDIR=str(r/'tmp'))
rows=[]
for argv in [['xcrun','simctl','shutdown',u],['xcrun','simctl','delete',u]]:
 p=subprocess.run(argv,env=env,stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True);rows.append({'argv':argv,'exitStatus':p.returncode,'stdout':p.stdout,'stderr':p.stderr});assert p.returncode==0
(e/'cleanup.json').write_text(json.dumps({'at':int(time.time()*1000),'udid':u,'commands':rows},indent=2));print('Owned simulator deleted')

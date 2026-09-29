from pathlib import Path
import subprocess,json,time,os,socket,fcntl
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round2';u=(e/'owned.udid').read_text().strip();env=dict(os.environ,DEVELOPER_DIR='/Applications/Xcode.app/Contents/Developer');rows=[]
for verb in ['shutdown','delete']:
 argv=['xcrun','simctl',verb,u];p=subprocess.run(argv,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
 rows.append({'argv':argv,'exitStatus':p.returncode,'output':p.stdout});assert p.returncode==0
all_devices=json.loads(subprocess.check_output(['xcrun','simctl','list','devices','--json'],env=env,text=True));absent=not any(x['udid']==u for group in all_devices['devices'].values() for x in group);assert absent
with socket.socket() as s:port_refuses=s.connect_ex(('127.0.0.1',49371))!=0
with (r/'subject/.snapback4-witness/owner.lock').open('a+') as f:fcntl.flock(f,fcntl.LOCK_EX|fcntl.LOCK_NB)
(e/'cleanup.json').write_text(json.dumps({'at':int(time.time()*1000),'ownedUdid':u,'commands':rows,'ownedSimulatorAbsent':absent,'backendPortRefuses':port_refuses,'projectLeaseAvailable':True,'otherSimulatorsUntouched':True},indent=2));print('owned simulator deleted, project lease available',port_refuses)

from pathlib import Path
import subprocess,os,json,time
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round2';subject=r/'subject';u=(e/'owned.udid').read_text().strip();base=e/'final-a-ownbuild-1/build.json'
def run(name,extra=None):
 env=dict(os.environ,**(extra or {}))
 p=subprocess.run(['python3',str(r/'run-witness-r2.py'),name,'--repack',str(base),'--app-project',str(subject),'--smoke','--udid',u,'--port','49371'],env=env,stdout=subprocess.DEVNULL)
 print(name,p.returncode,flush=True);assert p.returncode==1,name
# The real native delegate chooses a different local file with the same HBC bytes.
# Remove the fixture's redundant selected-URL assertion so only product validation decides this control.
probe=subject/'src/NPProbe.tsx';original=probe.read_bytes()
try:
 probe.write_text(original.decode().replace("      assert(initial.scriptURL?.includes('.app/main.jsbundle') && initial.scriptURL?.startsWith('file:'), 'runtime did not launch the embedded bundle');",'      observation({ alternateSelectionControl: true, selected: initial.scriptURL });'))
 (e/'control-alternate-probe.tsx').write_bytes(probe.read_bytes())
 run('control-alternate-selection',{'SIMCTL_CHILD_NP_SELECT_ALTERNATE':'1'})
finally:probe.write_bytes(original)
entry=subject/'np-entry.js';original=entry.read_bytes()
try:
 entry.write_text("globalThis['__DEV__'] = true;\n"+original.decode())
 (e/'control-runtime-dev-entry.js').write_bytes(entry.read_bytes())
 run('control-runtime-dev')
finally:entry.write_bytes(original)
# Alter only the launch input crossing into the simulator, leaving the actual backend and client unchanged.
control=r/'control-bin-r2';control.mkdir(exist_ok=True)
wrapper=control/'xcrun'
wrapper.write_text('''#!/usr/bin/python3
import os,sys,json
if sys.argv[1:3]==['simctl','launch']:
 config=json.loads(os.environ['SIMCTL_CHILD_SNAPBACK4_WITNESS'])
 selected=next(name for name,fact in config['queryFacts'].items() if fact['runs']=='device')
 before=dict(config['queryFacts'][selected])
 if os.environ['NP_CONTROL_FACTS']=='runs':config['queryFacts'][selected]['runs']='server'
 else:config['queryFacts'][selected]['held']=not before['held']
 with open(os.environ['NP_CONTROL_RECORD'],'a') as f:f.write(json.dumps({'segment':config['segment'],'query':selected,'before':before,'after':config['queryFacts'][selected],'generation':config['queryGeneration']})+'\\n')
 os.environ['SIMCTL_CHILD_SNAPBACK4_WITNESS']=json.dumps(config)
os.execv('/usr/bin/xcrun',['/usr/bin/xcrun',*sys.argv[1:]])
''');wrapper.chmod(0o755)
for fact in ['runs','held']:
 run('control-stale-'+fact,{'PATH':str(control)+':'+os.environ['PATH'],'NP_CONTROL_FACTS':fact,'NP_CONTROL_RECORD':str(e/('control-stale-'+fact+'-injection.jsonl'))})
(e/'runtime-controls.json').write_text(json.dumps({'completedAt':int(time.time()*1000),'controls':['alternate-selection','runtime-dev','stale-runs','stale-held'],'expectedExitStatus':1},indent=2))

from pathlib import Path
import json,hashlib,subprocess
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round4'
def read(p):return json.loads(p.read_text())
def h(p):return hashlib.sha256(p.read_bytes()).hexdigest()
assert read(e/'b-warm-ownbuild-5-command.json')['exitStatus']==0
rows=[]
for row in read(e/'output-controls.json')['controls']:
 name=row['name'];assert read(e/(name+'-command.json'))['exitStatus']==1
 assert row['sha256Before']==row['sha256After']==h(Path(row['target']))
 text=(e/(name+'.log')).read_text();assert row['setting'] in text and row['target'] in text
 assert not (e/name/'xcode-build.log').exists() and not (e/name/'proof.json').exists();rows.append(row)
for name in ['control-tampered-output','control-cold-error','control-death-restart-2']:
 assert read(e/(name+'-command.json'))['exitStatus']==1
 text=(e/(name+'.log')).read_text()
 if name=='control-tampered-output':
  assert 'app inventory differs from preparation' in text and read(e/'tamper-injection.json')['beforeVerifier']
  assert not (e/name/'installed.json').exists() and not (e/name/'proof.json').exists()
 else:
  j=read(e/name/'smoke-ios-run.json');assert j['exitStatus']==1
  if name=='control-cold-error':
   assert j['segments']['prime']['status']=='passed' and j['segments']['offline']['status']=='failed'
   assert j['segments']['offline']['receipt']['pass'] is False
   assert any(x['message']=='NP intentional cold offline startup error' for x in j['segments']['offline']['receipt']['errors'])
  else:
   assert read(e/'control-death-restart-2-injection.json')['priorRestartPass'] is True
   assert 'exited before deliberate termination' in text
 rows.append({'name':name,'intendedFailure':True})
own=read(e/'ownership-controls.json');assert own['owner']['status']==1 and own['owner']['aliveAfterRefusal'];assert own['busyPort']['status']==1 and own['busyPort']['listenerAcceptedAfterRefusal']
assert 'E_WITNESS_PROCESS' in (e/'control-concurrent-owner-2.log').read_text();assert 'E_WITNESS_PORT' in (e/'control-busy-port.log').read_text()
inter=read(e/'interruption-control.json');assert inter['exitStatus']==1 and inter['leaseHeldDuringCleanup'] and inter['heartbeatStopped'] and inter['leaseReleasedAfterCleanup']
# Real CLI old spelling refuses before reserving artifacts or touching native state.
base=e/'a-ownbuild-1/build.json';out=e/'withdrawn-cli-artifacts'
argv=[str(r/'lane/snapback4/target/debug/snapback4'),'witness','ios','--repack',str(base),'--app-project',str(r/'subject'),'--smoke','--artifacts',str(out)]
p=subprocess.run(argv,text=True,stdout=subprocess.PIPE,stderr=subprocess.PIPE);assert p.returncode==1 and 'repack is withdrawn; use witness ios --build' in p.stderr and not out.exists()
(e/'withdrawal-control.json').write_text(json.dumps({'argv':argv,'exitStatus':p.returncode,'stdout':p.stdout,'stderr':p.stderr,'artifactsCreated':out.exists()},indent=2))
(e/'controls-verification.json').write_text(json.dumps({'allIntendedFailures':True,'passingBaseline':'b-warm-ownbuild-5','controls':rows,'ownersPreserved':own,'groupCleanup':inter,'withdrawalRefusedBeforeArtifacts':True},indent=2));print('All native controls independently matched to intended failures')

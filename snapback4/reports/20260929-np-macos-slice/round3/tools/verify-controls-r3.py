from pathlib import Path
import json,hashlib
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round3'
def read(p):return json.loads(p.read_text())
def h(p):return hashlib.sha256(p.read_bytes()).hexdigest()
rows=[]
expected={'control-pod-link':['Pods input outside covered roots','ios/Pods/np-external.h','SharedNative/NP.h'],
 'control-output-configuration_build_dir':['custom output CONFIGURATION_BUILD_DIR','outside-products-CONFIGURATION_BUILD_DIR'],
 'control-output-symroot':['custom output SYMROOT','outside-products-SYMROOT'],
 'control-output-objroot':['custom output OBJROOT','outside-products-OBJROOT'],
 'control-scheme':['input differences in config','use witness ios --build'],
 'control-tampered-base':['immutable base bytes changed','use --build']}
for name,parts in expected.items():
 assert read(e/(name+'-command.json'))['exitStatus']==1
 text=(e/(name+'.log')).read_text();assert all(part in text for part in parts),(name,text)
 assert not (e/name/'proof.json').exists()
 rows.append({'name':name,'intendedRefusal':True,'beforeProofAndInstall':True,'requiredDiagnostic':parts})
assert read(e/'sealed-b-repack-5-command.json')['exitStatus']==0
for name in ['control-cold-error','control-death-restart-2']:
 assert read(e/(name+'-command.json'))['exitStatus']==1
 j=read(e/name/'repack-smoke-ios-run.json');assert j['exitStatus']==1
 if name=='control-cold-error':
  assert j['segments']['prime']['status']=='passed' and j['segments']['offline']['status']=='failed'
  assert j['segments']['offline']['receipt']['pass'] is False
  assert any(x['message']=='NP intentional cold offline startup error' for x in j['segments']['offline']['receipt']['errors'])
 else:
  assert read(e/'control-death-restart-2-injection.json')['priorRestartPass'] is True
  assert 'exited before deliberate termination' in (e/(name+'.log')).read_text()
 rows.append({'name':name,'intendedFailure':True,'segments':{k:v['status'] for k,v in j['segments'].items()}})
own=read(e/'ownership-controls.json');assert own['owner']['status']==1 and own['owner']['aliveAfterRefusal'];assert own['busyPort']['status']==1 and own['busyPort']['listenerAcceptedAfterRefusal']
for d in ['sealed-compiler-controls','sealed-grok-compiler-controls']:
 pairs={}
 for x in read(e/d/'results.json'):
  kind=x.get('kind',x.get('ext'));value=x['value'];stem=e/d/f'{kind}-{value}'
  assert h(stem.with_name(stem.name+'.o'))==x['objectSha256']
  if 'sourceSha256' in x:assert h(stem.with_name(stem.name+'.c'))==x['sourceSha256']
  if 'headerSha256' in x:assert h(stem.with_name(stem.name+'.input'))==x['headerSha256']
  assert x['refusal'] is None if kind=='baseline' else 'outside covered roots' in x['refusal']
  pairs.setdefault(kind,[]).append(x)
 for kind,pair in pairs.items():
  assert len(pair)==2
  assert (pair[0]['objectSha256']==pair[1]['objectSha256'])==(kind=='baseline')
  if 'iosInventory' in pair[0]:assert pair[0]['iosInventory']==pair[1]['iosInventory']
  rows.append({'nativeCompilerControl':kind,'nativeObjectPairVerified':True,'expectedRefusal':kind!='baseline'})
(e/'controls-verification.json').write_text(json.dumps({'allIntendedFailures':True,'passingBaseline':'sealed-b-repack-5','controls':rows,'ownersPreserved':own},indent=2));print('controls independently matched to intended failures and native object bytes')

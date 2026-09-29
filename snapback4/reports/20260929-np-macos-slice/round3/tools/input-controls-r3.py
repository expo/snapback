from pathlib import Path
import subprocess,json
r=Path('/Users/ccheever/sb4-np');s=r/'subject';e=r/'evidence/round3';u=(e/'owned.udid').read_text().strip();base=e/'sealed-a-ownbuild-1/build.json'
baseline=json.loads((e/'sealed-b-repack-5-command.json').read_text());assert baseline['exitStatus']==0
results={'passingUnmodifiedBaseline':str(e/'sealed-b-repack-5-command.json'),'controls':[]}
def run(name,mode='repack'):
 args=['--repack',str(base),'--app-project',str(s)] if mode=='repack' else ['--build',str(s)]
 p=subprocess.run(['python3',str(r/'run-witness-r3.py'),name,*args,'--smoke','--udid',u,'--port','49371'],stdout=subprocess.DEVNULL)
 assert p.returncode==1
 text=(e/f'{name}.log').read_text();assert not (e/name/'proof.json').exists()
 return text
outside=s/'SharedNative';outside.mkdir();header=outside/'NP.h';header.write_text('int np_external = 1;\n');link=s/'ios/Pods/np-external.h'
try:
 link.symlink_to('../../SharedNative/NP.h')
 text=run('control-pod-link')
 assert 'Pods input outside covered roots' in text and 'ios/Pods/np-external.h' in text and 'SharedNative/NP.h' in text,text
 results['controls'].append({'name':'pod-link','link':str(link),'target':str(header),'bothNamesAsserted':True,'diagnostic':text})
finally:link.unlink();header.unlink();outside.rmdir()
project=s/'ios/Clique.xcodeproj/project.pbxproj';original=project.read_bytes()
try:
 for key in ['CONFIGURATION_BUILD_DIR','SYMROOT','OBJROOT']:
  target=str(r/f'outside-products-{key}')
  assert not Path(target).exists()
  j=json.loads(subprocess.check_output(['/usr/bin/plutil','-convert','json','-o','-',str(project)]))
  for obj in j['objects'].values():
   if obj.get('isa')=='XCBuildConfiguration':obj.setdefault('buildSettings',{})[key]=target
  project.write_text(json.dumps(j))
  text=run('control-output-'+key.lower(),'build');assert key in text and target in text,text;assert not Path(target).exists()
  results['controls'].append({'name':key,'target':target,'neverCreated':True,'diagnostic':text})
  project.write_bytes(original)
finally:project.write_bytes(original)
(e/'native-input-controls.json').write_text(json.dumps(results,indent=2));print('Pods link names and three private-output controls verified')

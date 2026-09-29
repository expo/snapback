from pathlib import Path
import subprocess,json,hashlib
r=Path('/Users/ccheever/sb4-np');s=r/'subject';e=r/'evidence/round4';tools=r/'lane/snapback4/reports/20260929-np-macos-slice/round4/tools';u=(e/'owned.udid').read_text().strip()
assert json.loads((e/'b-warm-ownbuild-5-command.json').read_text())['exitStatus']==0
project=s/'ios/Clique.xcodeproj/project.pbxproj';original=project.read_bytes();results=[]
try:
 for key in ['LD_MAP_FILE_PATH','LD_DEPENDENCY_INFO_FILE','LD_LTO_OBJECT_FILE','LD_SDK_IMPORTS_FILE','CONFIGURATION_BUILD_DIR','SYMROOT','OBJROOT']:
  target=e/f'outside-cache-{key}.sentinel';target.write_text('another owner: '+key+'\n');before=hashlib.sha256(target.read_bytes()).hexdigest()
  j=json.loads(subprocess.check_output(['/usr/bin/plutil','-convert','json','-o','-',str(project)]))
  for obj in j['objects'].values():
   if obj.get('isa')=='XCBuildConfiguration':
    obj.setdefault('buildSettings',{})[key]=str(target)
    if key=='LD_MAP_FILE_PATH':obj['buildSettings']['LD_GENERATE_MAP_FILE']='YES'
  project.write_text(json.dumps(j));name='control-output-'+key.lower()
  code=subprocess.run(['python3',str(tools/'run-witness-r4.py'),name,'--build',str(s),'--smoke','--udid',u,'--port','49371'],stdout=subprocess.DEVNULL).returncode
  text=(e/f'{name}.log').read_text();assert code==1 and 'custom output '+key in text and str(target) in text,text
  assert not (e/name/'xcode-build.log').exists() and not (e/name/'proof.json').exists()
  after=hashlib.sha256(target.read_bytes()).hexdigest();assert before==after
  results.append({'name':name,'setting':key,'target':str(target),'sha256Before':before,'sha256After':after,'neverCompiledOrInstalled':True,'diagnostic':text});project.write_bytes(original)
finally:project.write_bytes(original)
(e/'output-controls.json').write_text(json.dumps({'passingBaseline':'b-warm-ownbuild-5','controls':results},indent=2));print('Seven private-output controls passed',flush=True)

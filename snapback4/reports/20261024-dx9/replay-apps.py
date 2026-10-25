"""Replay final lane commands on private copies; never retain command output or credentials."""
import json,os,shutil,subprocess,time,hashlib,re,sys
from pathlib import Path
root=Path(__file__).resolve().parents[3]; product=root/'snapback4'
source=Path.home()/'sb4-loop/wave26/apps'; scratch=Path('/tmp/dx9-replay/apps'); scratch.mkdir(parents=True,exist_ok=True)
selected=sys.argv[1:] or ['010','020','024','048']
report=product/'reports/20261024-dx9/app-replays.json'
results=[r for r in json.loads(report.read_text()) if r['lane'] not in selected] if report.exists() else []
env={**os.environ,'npm_config_cache':'/tmp/dx9-npm-cache','CI':'1','EXPO_NO_TELEMETRY':'1','EXPO_OFFLINE':'1'}
env.pop('SNAPBACK4_BIN',None)
def run(args,cwd,seconds=180):
 start=time.monotonic(); p=subprocess.run(['timeout',str(seconds)+'s',*map(str,args)],cwd=cwd,env=env,capture_output=True,timeout=seconds+10)
 return {'exit':p.returncode,'seconds':round(time.monotonic()-start,2),'codes':sorted(set(re.findall(r'\b(?:E_[A-Z][A-Z0-9_]+|ERR_[A-Z_]+|EACCES|ENOENT|NOT_FOUND)\b',(p.stdout+p.stderr).decode(errors='replace')))),'outputSha256':hashlib.sha256(p.stdout+p.stderr).hexdigest()}
def pack(path):
 p=subprocess.run(['timeout','120s','npm','pack','--ignore-scripts','--json','--pack-destination',str(scratch)],cwd=path,env=env,capture_output=True,check=True)
 return scratch/json.loads(p.stdout)[0]['filename']
try:
 client=pack(product/'packages/snapback4'); expo=pack(product/'packages/snapback4-expo'); platform='snapback4-'+os.uname().sysname.lower()+'-x64'
 native=scratch/'native';native.mkdir();shutil.copyfile(product/'packages'/platform/'package.json',native/'package.json');shutil.copyfile(product/'target/debug/snapback4',native/'snapback4');(native/'snapback4').chmod(0o755);binary=pack(native)
 for lane in selected:
  if lane=='048':env.update(PORT_LO='4400',PORT_HI='4420')
  original=next(source.glob(lane+'-snapback-*')); app=scratch/lane
  shutil.copytree(original,app,ignore=shutil.ignore_patterns('node_modules','dist','.snapback4','.expo','artifacts','.git','.env*','*credentials*','*sessions*','*users.json','*.sqlite*','*.log','*.ndjson','*.gz'),symlinks=True)
  for path in app.rglob('*'):
   if path.is_symlink():path.unlink()
  manifest=json.loads((app/'package.json').read_text());manifest.setdefault('dependencies',{})['snapback4']='file:'+str(client);manifest.setdefault('optionalDependencies',{})[platform]='file:'+str(binary)
  if 'snapback4-expo' in manifest['dependencies']:manifest['dependencies']['snapback4-expo']='file:'+str(expo)
  # Apply the starter toolchain repair explicitly; preserve the application's code.
  if 'vite' in manifest.get('devDependencies',{}):manifest['devDependencies']['vite']='8.3.5'
  (app/'package.json').write_text(json.dumps(manifest));(app/'package-lock.json').unlink(missing_ok=True)
  commands=[(['npm','install','--no-audit','--no-fund'],240),([app/'node_modules/.bin/snapback4','check'],40)]
  scripts=manifest.get('scripts',{})
  if 'typecheck' in scripts:commands.append((['npm','run','typecheck'],120))
  if lane in ['010','020']:commands.extend([(['npm','run','acceptance'],180),(['npm','run','frontend:proof'],240)])
  else:commands.append((['npm','run','build:web' if lane=='024' else 'build'],240))
  row={'lane':lane,'adjustments':['local packed SDK/platform; Vite 8.3.5 where declared',*(['PORT_LO=4400 PORT_HI=4420 required by the app-owned Vite config'] if lane=='048' else [])],'commands':[]}
  for args,limit in commands:
   outcome=run(args,app,limit);row['commands'].append({'command':'snapback4 check' if str(args[0]).endswith('/snapback4') else ' '.join(map(str,args)),**outcome})
   if outcome['exit'] and args[0]=='npm' and args[1]=='install':break
  results.append(row);shutil.rmtree(app)
finally:
 (product/'reports/20261024-dx9/app-replays.json').write_text(json.dumps(results,indent=2)+'\n');shutil.rmtree(scratch,ignore_errors=True)
print(json.dumps(results))

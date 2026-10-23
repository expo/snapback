from pathlib import Path
import time,subprocess,shutil,hashlib,json,os
b=Path('/tmp/integ23');root=Path('/home/ccheever/projects/snapback-sb4loop');sb=root/'snapback4';f=b/'frozen-production39-r12'
for _ in range(2880):
 if (b/'qualified39-r14/day2-proof.json').exists():break
 time.sleep(5)
else:raise SystemExit('production qualification binary did not appear')
assert not f.exists();f.mkdir();previous=b/'frozen-final39-r9'
shutil.copytree(previous/'node_modules',f/'node_modules',symlinks=True,ignore=shutil.ignore_patterns('snapback4','snapback4-linux-x64'))
shutil.copytree(previous/'snapback4',f/'snapback4',symlinks=True,ignore=shutil.ignore_patterns('node_modules'))
(f/'snapback4/node_modules').mkdir()
for p in (previous/'snapback4/node_modules').iterdir():
 if p.name!='snapback4-linux-x64':(f/'snapback4/node_modules'/p.name).symlink_to(p.resolve(),target_is_directory=p.is_dir())
(f/'node_modules/snapback4').symlink_to(f/'snapback4',target_is_directory=True)
shutil.copy2(sb/'target/x86_64-unknown-linux-musl/production/snapback4',f/'snapback4-bin')
platform=f/'node_modules/snapback4-linux-x64';platform.mkdir();shutil.copy2(sb/'packages/snapback4-linux-x64/package.json',platform/'package.json');shutil.copy2(f/'snapback4-bin',platform/'snapback4');(f/'snapback4/node_modules/snapback4-linux-x64').symlink_to(platform,target_is_directory=True)
assert subprocess.check_output(['timeout','10s',str(f/'snapback4-bin'),'--version'],text=True).strip()=='snapback4 0.4.39'
(f/'source.json').write_text(json.dumps({'source':subprocess.check_output(['timeout','20s','git','rev-parse','HEAD'],cwd=root,text=True).strip(),'binarySha256':hashlib.sha256((f/'snapback4-bin').read_bytes()).hexdigest(),'artifact':'qualified production musl build; frozen after installed day2 proof'},indent=2)+'\n')
env=dict(os.environ,SNAPBACK4_BIN=str(f/'snapback4-bin'),REPLAY_TAG='fixed-production-r12',ROLL_REPLAY_OUT=str(b/'roll-replay-production-r20'))
commands=[('w25-production-r12.log',['python3',str(b/'w25-replay.py')]),('roll-replay-production-r20.log',['python3',str(b/'roll-replay-compat-r15.py'),*[str(n).zfill(3) for n in range(1,51)]]),('survey-production-r9.log',['python3',str(b/'survey-both-outputs.py'),'--binary',str(f/'snapback4-bin'),'--out',str(b/'survey-production-r9'),'--waves','15,16,18,19,20,21,22,23']),('survey-gates-production-r9.log',['python3',str(b/'survey-gates.py'),'--binary',str(f/'snapback4-bin'),'--survey',str(b/'survey-production-r9/results.json'),'--out',str(b/'survey-gates-production-r9.json')])]
for name,args in commands:
 with (b/name).open('w') as log:r=subprocess.run(['timeout','5400s',*args],cwd=sb,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=5430)
 assert r.returncode==0,(name,r.returncode)
(b/'production-artifact-replay-r12.status').write_text('0\n')

from pathlib import Path
import time,json,subprocess,os,shutil,hashlib
base=Path('/tmp/integ23');root=Path('/home/ccheever/projects/snapback-sb4loop');sb=root/'snapback4';f=base/'frozen-final39-r11';previous=base/'frozen-final39-r9'
for _ in range(2880):
 if (base/'prepared-r15-ready.json').exists():break
 time.sleep(5)
else:raise SystemExit('fresh client preparation did not finish')
assert not subprocess.check_output(['timeout','20s','git','status','--porcelain'],cwd=root,text=True).strip()
assert not f.exists();f.mkdir()
shutil.copytree(previous/'node_modules',f/'node_modules',symlinks=True,ignore=shutil.ignore_patterns('snapback4','snapback4-linux-x64'))
shutil.copytree(previous/'snapback4',f/'snapback4',symlinks=True,ignore=shutil.ignore_patterns('node_modules','dist'))
shutil.copytree(sb/'packages/snapback4/dist',f/'snapback4/dist',symlinks=True)
(f/'snapback4/node_modules').mkdir()
for p in (previous/'snapback4/node_modules').iterdir():
 if p.name!='snapback4-linux-x64':(f/'snapback4/node_modules'/p.name).symlink_to(p.resolve(),target_is_directory=p.is_dir())
(f/'node_modules/snapback4').symlink_to(f/'snapback4',target_is_directory=True)
shutil.copy2(sb/'target/debug/snapback4',f/'snapback4-bin')
platform=f/'node_modules/snapback4-linux-x64';platform.mkdir();shutil.copy2(sb/'packages/snapback4-linux-x64/package.json',platform/'package.json');shutil.copy2(f/'snapback4-bin',platform/'snapback4');(f/'snapback4/node_modules/snapback4-linux-x64').symlink_to(platform,target_is_directory=True)
assert subprocess.check_output(['timeout','10s',str(f/'snapback4-bin'),'--version'],text=True).strip()=='snapback4 0.4.39'
source=subprocess.check_output(['timeout','20s','git','rev-parse','HEAD'],cwd=root,text=True).strip();meta={'source':source,'binarySha256':hashlib.sha256((f/'snapback4-bin').read_bytes()).hexdigest(),'dist':{str(p.relative_to(f/'snapback4/dist')):hashlib.sha256(p.read_bytes()).hexdigest()for p in sorted((f/'snapback4/dist').rglob('*'))if p.is_file()}}
(f/'source.json').write_text(json.dumps(meta,indent=2)+'\n');(base/'client-r14').mkdir()
env=dict(os.environ,PATH='/home/ccheever/.bun-1.4.2/bin:'+os.environ['PATH'],CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0',CARGO_BUILD_JOBS='12',RUST_TEST_THREADS='8',CI='1',EXPO_NO_TELEMETRY='1',SNAPBACK4_BIN=str(f/'snapback4-bin'),SNAPBACK4_CLIENT_DIST=str(f/'snapback4/dist'),CHROME='/home/ccheever/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome')
with(base/'client-pool-r14.log').open('w')as log:r=subprocess.run(['timeout','14400s','node',str(base/'final-client-pool-r14.mjs')],cwd=sb,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=14430)
(base/'client-pool-r14.status').write_text(str(r.returncode)+'\n');assert r.returncode==0,r.returncode

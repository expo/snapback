from pathlib import Path
import subprocess,time,os,json
b=Path('/home/ccheever/sb4-loop/integ24');sb=Path('/home/ccheever/projects/snapback-sb4loop/snapback4')
while not(b/'prepare-wave26-final40.exit').exists():time.sleep(3)
assert(b/'prepare-wave26-final40.exit').read_text().strip()=='0'
while not(b/'client-wave26-final40-binding-before.json').exists():time.sleep(3)
env=dict(os.environ,PATH='/home/ccheever/.bun-1.4.2/bin:/home/ccheever/sb4-loop/integ24/tools/brotli-root/usr/bin:'+os.environ['PATH'],CARGO_INCREMENTAL='0',CARGO_PROFILE_DEV_DEBUG='0',CARGO_PROFILE_TEST_DEBUG='0',CARGO_BUILD_JOBS='8',RUST_TEST_THREADS='8',NPM_CONFIG_CACHE=str(b/'npm-cache-wave26-main'))
env.pop('SNAPBACK4_BIN',None)
args=['timeout','15000s','node','scripts/qualify-linux.mjs','--consumer-only','--client',str(b/'pack-wave26-final40/snapback4-0.4.40.tgz'),'--expo',str(b/'pack-wave26-final40/snapback4-expo-0.4.40.tgz'),'--out',str(b/'qualified-wave26-final40')]
with(b/'qualify-wave26-final40.log').open('w')as log:r=subprocess.run(args,cwd=sb,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=15020)
(b/'qualify-wave26-final40.exit').write_text(str(r.returncode)+'\n');assert r.returncode==0,r.returncode

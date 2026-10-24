import pathlib,subprocess,os,json,sys,time
base=pathlib.Path.home()/'sb4-loop/integ24';which=sys.argv[1];binary=base/'bin/difftest-base39'if which=='base'else pathlib.Path('/home/ccheever/projects/snapback-sb4loop/snapback4/target/release/snapback4-difftest')
results=[];env=dict(os.environ,SNAPBACK4_LEAN_ORACLE='/home/ccheever/projects/snapback-sb4loop/snapback4/lean/.lake/build/bin/quarry-oracle',SNAPBACK4_REQUIRE_LEAN='1')
for verb,count in [('run',20000),('run-devices',1000),('run-lean',20000)]:
 out=base/f'diff-wave26-final40-{which}-{verb}';args=['timeout','1800s',str(binary),verb,'--seed','0','--cases',str(count),'--workers','12','--out',str(out)]
 with(base/f'diff-wave26-final40-{which}-{verb}.log').open('w')as log:r=subprocess.run(args,stdout=log,stderr=subprocess.STDOUT,env=env,timeout=1810)
 results.append(dict(argv=args,exit=r.returncode));(base/f'diff-wave26-final40-{which}-commands.json').write_text(json.dumps(results,indent=2)+'\n');print(which,verb,r.returncode,flush=True)

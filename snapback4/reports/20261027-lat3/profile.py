"""One paired production-native phase profile per requested command category."""
import sys
sys.dont_write_bytecode=True
from replay import copy_source,install,ROOT,HERE,SCRATCH
import pathlib,shutil,subprocess,os,time,json,signal
out=SCRATCH/'phase-profiles';out.mkdir(exist_ok=True)
for wave,lane,scripts in [(32,'002',['acceptance','frontend:proof','probe:serve/client:calls']),
                         (34,'028',['acceptance','frontend:proof','probe:serve/client:calls']),
                         (33,'025',['day2:proof'])]:
 src=next(pathlib.Path(f'/home/ccheever/sb4-loop/wave{wave}/apps').glob(f'{lane}-snapback-*'))
 case=out/f'w{wave}-{lane}';case.mkdir(exist_ok=True)
 before=case/'before';after=case/'after';copy_source(src,before);install(before);shutil.copytree(before,after,symlinks=True)
 for name in ['dist','bin']:shutil.copytree(ROOT/'snapback4/packages/snapback4'/name,after/'node_modules/snapback4'/name,dirs_exist_ok=True)
 for script in scripts:
  key=script.replace(':','-').replace('/','-')
  for variant,cwd in [('before',before),('after',after)]:
   env={**os.environ,'NODE_OPTIONS':'--import='+str(HERE/'trace.mjs'),
    'LAT3_TRACE':str(case/f'{key}-{variant}.node.jsonl'),'SNAPBACK4_LATENCY_TRACE':str(case/f'{key}-{variant}.native.jsonl'),
    'SNAPBACK4_BIN':str(cwd/'node_modules/snapback4-linux-x64/snapback4'),
    'CHROME':str(pathlib.Path.home()/'.cache/ms-playwright/chromium-1193/chrome-linux/chrome'),
    'PORT_LO':'49000','PORT_HI':'49999','SNAPBACK4_PROBE_HOLD':'1','npm_config_cache':str(SCRATCH/'npm-cache')}
   args=['node',str(HERE/'probe.mjs')] if script=='probe:serve/client:calls' else ['npm','run',script]
   start=time.monotonic()
   with (case/f'{key}-{variant}.log').open('w') as f:
    child=subprocess.Popen(args,cwd=cwd,env=env,stdout=f,stderr=subprocess.STDOUT,start_new_session=True)
    try:code=child.wait(timeout=600)
    except BaseException:
     os.killpg(child.pid,signal.SIGTERM)
     try:child.wait(timeout=10)
     except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);child.wait()
     raise
   record={'wave':wave,'lane':lane,'script':script,'variant':variant,'code':code,'seconds':time.monotonic()-start}
   if script=='probe:serve/client:calls' and (cwd/'lat3-probe.json').exists():record.update(json.loads((cwd/'lat3-probe.json').read_text()))
   with (out/'results.jsonl').open('a') as f:f.write(json.dumps(record)+'\n')
   print(json.dumps(record),flush=True)

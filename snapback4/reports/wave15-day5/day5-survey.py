import os,sys,subprocess,pathlib,shutil,json,concurrent.futures
phase,binary=sys.argv[1:]
repo=pathlib.Path('/home/ccheever/projects/sb4-w15-day5')
apps=pathlib.Path('/home/ccheever/sb4-loop/wave15/apps')
out=pathlib.Path(os.environ.get('DAY5_SURVEY_OUT',str(repo/'snapback4/reports/wave15-day5')));out.mkdir(parents=True,exist_ok=True)
def run(lane):
 d=pathlib.Path('/tmp/day5-survey')/phase/lane.name
 d.parent.mkdir(parents=True,exist_ok=True)
 shutil.copytree(lane,d,ignore=shutil.ignore_patterns('node_modules','target','dist','logs','deploy','deployment','.git','.expo','.checkpoint','.agent.ndjson','ios','android','build'),dirs_exist_ok=True)
 # Read-only binary/client dependencies support compiler companion checks only;
 # upgrade has a distinct copy and never follows evidence-lane dependencies.
 env={**os.environ,'SNAPBACK4_BIN':binary,'SNAPBACK4_UPGRADE_HELPER':str(repo/'snapback4/packages/snapback4/bin/upgrade.js'),'PATH':'/home/ccheever/.bun-1.4.2/bin:'+os.environ['PATH']}
 results={}
 for name,args in [('check',['check']),('adapt',['init','--adapt']),('upgrade',['upgrade','--to','0.4.31'])]:
  # Avoid public registry fallback retries while 0.4.31 is not published.
  env.update(npm_config_fetch_retries='0',npm_config_fetch_timeout='15000')
  if name=='upgrade':
   env['npm_config_registry']='http://127.0.0.1:'+pathlib.Path('/tmp/day5-registry-port').read_text();
   if phase=='before': env['SNAPBACK4_UPGRADE_HELPER']='/tmp/day5-before-package/package/bin/upgrade.js'
   for lock in ['package-lock.json','npm-shrinkwrap.json','bun.lock']:
    path=d/lock
    if path.exists(): path.write_text(path.read_text().replace('http://127.0.0.1:4873',env['npm_config_registry']))
  r=subprocess.run(['timeout','360',binary,*args],cwd=d,env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
  results[name]={'code':r.returncode,'output':r.stdout}
 shutil.rmtree(d)
 return lane.name,results
lanes=[p for p in sorted(apps.glob('[0-9][0-9][0-9]-*')) if int(p.name[:3])%2==0]
with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
 results=dict(pool.map(run,lanes))
(out/(phase+'.json')).write_text(json.dumps(results,indent=2)+'\n')
print(phase,len(results),{cmd:{str(code):sum(v[cmd]['code']==code for v in results.values()) for code in sorted(set(v[cmd]['code'] for v in results.values()))} for cmd in ['check','adapt','upgrade']})

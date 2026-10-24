from pathlib import Path
import time,subprocess,os,concurrent.futures,json
b=Path.home()/'sb4-loop/integ24'
while not(b/'client-wave26-final40-binding-before.json').exists():time.sleep(3)
binary='/home/ccheever/projects/snapback-sb4loop/snapback4/target/integ24-wave26-final40-bin/snapback4'
env=dict(os.environ,SURVEY_WORKERS='24',SURVEY_CORPUS=str(b/'corpus-wave26'))
commands=[('survey',['python3',str(b/'harness/survey-wave26-controlled.py'),'after-final40',binary]),('replay',['python3',str(b/'harness/replay-wave26-final40.py')]),('exact',['python3',str(b/'harness/exact-wave26-final40.py')])]
def run(row):
 key,args=row
 with(b/('wave26-final40-'+key+'.log')).open('w')as log:r=subprocess.run(['timeout','10800s',*args],stdout=log,stderr=subprocess.STDOUT,env=env,timeout=10820)
 (b/('wave26-final40-'+key+'.exit')).write_text(str(r.returncode)+'\n');print(key,r.returncode,flush=True)
with concurrent.futures.ThreadPoolExecutor(max_workers=3)as pool:list(pool.map(run,commands))

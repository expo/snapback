from pathlib import Path
import subprocess,json,os,time,threading,concurrent.futures
p=Path(__file__).parent;repo=Path('/home/ccheever/projects/snapback-sb4loop');env={**os.environ,'CARGO_INCREMENTAL':'0','CARGO_PROFILE_DEV_DEBUG':'0','CARGO_PROFILE_TEST_DEBUG':'0','CARGO_BUILD_JOBS':'16','RUST_MIN_STACK':'33554432'};records=[];lock=threading.Lock();head=subprocess.check_output(['timeout','20s','git','rev-parse','HEAD'],cwd=repo,text=True).strip()
def run(name,args,cwd,limit):
 start=time.time();print('START',name,flush=True)
 with(p/(name+'.log')).open('w')as log:r=subprocess.run(['timeout','--kill-after=30s',str(limit)+'s',*args],cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT)
 with lock:
  records.append(dict(name=name,source=head,exit=r.returncode,seconds=time.time()-start,command=args));(p/'post-report-results.json').write_text(json.dumps(records,indent=2)+'\n')
 print('END',name,r.returncode,flush=True);return r.returncode
def docs_and_wasm():
 a=run('report-metadata-affected',['node',str(p/'report-metadata-affected.mjs')],repo,10800);b=run('report-metadata-wasm',['bash','scripts/measure-wasm.sh','--no-record'],repo/'snapback4',1800);return a or b
with concurrent.futures.ThreadPoolExecutor(max_workers=2)as pool:
 futures=[pool.submit(docs_and_wasm),pool.submit(run,'report-metadata-inventories',['node','scripts/check-inventories.mjs'],repo,900)];codes=[f.result()for f in futures]
assert not any(codes),records
rows=[]
for line in(p/'report-metadata-wasm.log').read_text().splitlines():
 try:j=json.loads(line)
 except ValueError:continue
 if'wasm'in j:rows.append(j)
assert len(rows)==1 and rows[0]['wasm']['gzip']+500==rows[0]['budget']and rows[0]['over']==0,rows
assert subprocess.check_output(['timeout','20s','git','rev-parse','HEAD'],cwd=repo,text=True).strip()==head
assert not subprocess.check_output(['timeout','20s','git','status','--porcelain'],cwd=repo,text=True).strip()
(p/'post-report-verdict.json').write_text(json.dumps(dict(ok=True,source=head,results=records,wasm=rows[0],metadataReceipt=json.loads((p/'report-metadata/result.json').read_text())['receiptPath'],nativeInputObjectsExact=True),indent=2)+'\n');print('POST-REPORT CHECKS ALL PASS',flush=True)

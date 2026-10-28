"""Run only after shared validator proves the complete1020-schema census."""
import pathlib,json,hashlib,concurrent.futures,tempfile,shutil,subprocess,time,os,uuid
from identity_validation import *
r=BASE;survey=r/'identity';census=validate_census(survey)
binary=pathlib.Path(census['provenance']['binaries']['baseline']['path']);assert sha(binary)==CONTROL
out=r/'control-self-replays';out.mkdir(exist_ok=False);run_id=uuid.uuid4().hex
provenance=dict(role='unchanged-control-self-reproduction',runId=run_id,binarySha256=CONTROL,workers=4,censusProvenance=census['provenance'],censusBindingSha256=census['bindingSha256'],chosen=census['chosen'],toolSha256=sha(pathlib.Path(__file__)),validatorSha256=sha(r/'identity_validation.py'),extractionToolSha256=sha(REPO/'snapback4/reports/lat1/measure.py'),method='Two unchanged-control executions on independent fresh source/fixture copies for one actually differing command per schema. Full original matrix retained. Shared validator must prove all1020/12240 captures before launch; completion binds the exact census, choices, run, input and capture hashes.')
atomic_json(out/'provenance.json',provenance)
def run(choice):
 wave,lane=choice['wave'],choice['lane'];args=COMMANDS[choice['mode']];rows=[]
 for ordinal,label in enumerate(['first','second'],1):
  with tempfile.TemporaryDirectory(prefix='sb4-lat1-control-self-')as tmp:
   root=pathlib.Path(tmp);(root/'snapback').mkdir();app=pathlib.Path.home()/'sb4-loop'/f'wave{wave}'/'apps'/lane;texts=[];fixtures=[];prior=[]
   for q in sorted((app/'snapback').glob('*.q')):
    dest=root/'snapback'/q.name;shutil.copy2(q,dest);texts.append((q.name,dest.read_text()))
   for q in sorted((app/'fixtures').rglob('*.jsonl')):
    dest=root/'fixtures'/q.relative_to(app/'fixtures');dest.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(q,dest);fixtures.append((q.relative_to(app/'fixtures').as_posix(),sha(dest)))
   if wave==31:
    prior=[(q.name,q.read_text())for q in sorted((pathlib.Path.home()/'sb4-loop/wave31/v1-clients'/lane/'snapback').glob('*.q'))];assert prior;(root/'.snapback4').mkdir();(root/'.snapback4/security-write-baseline.json').write_text(json.dumps(prior))
   sh,fh=digest(dict(current=texts,predecessor=prior)),digest(fixtures);assert [sh,fh]==census['inputHashes'][f'{wave}/{lane}']
   env={k:v for k,v in os.environ.items()if k!='SNAPBACK4_LATENCY_TRACE'};command=[str(binary),*args,'--json']
   for temperature in (['cold','warm']if choice['temperature']=='warm'else['cold']):
    started=time.monotonic();result=subprocess.run(['timeout','--kill-after=5s','900s',*command],cwd=root,capture_output=True,text=True,env=env);assert result.returncode in [0,1],(wave,lane,result.returncode)
    if temperature==choice['temperature']:
     row=dict(wave=wave,lane=lane,label=label,ordinal=ordinal,runId=run_id,role='unchanged-control-self-reproduction',binarySha256=CONTROL,workingCopy=str(root),command=command,mode=choice['mode'],temperature=temperature,seconds=time.monotonic()-started,exit=result.returncode,sourceSha256=sh,fixtureSha256=fh,security=envelope(json.loads(result.stdout),choice['mode'],result.returncode),stdout=result.stdout,stderr=result.stderr);validate_row(row);rows.append(row)
 item=dict(wave=wave,lane=lane,runId=run_id,binarySha256=CONTROL,rows=rows);validate_replay_item(item,choice,census,run_id);atomic_json(out/f'w{wave}-{lane}.json',item);return item
results=[]
with concurrent.futures.ThreadPoolExecutor(max_workers=4)as pool:
 for value in pool.map(run,census['chosen']):results.append(value);print('completed',len(results),value['wave'],value['lane'],flush=True)
assert validate_census(survey)['bindingSha256']==census['bindingSha256']and sha(binary)==CONTROL
captures={p.name:sha(p)for p in sorted(out.glob('w*.json'))};assert len(captures)==len(census['chosen'])
atomic_json(out/'complete.json',dict(schemas=len(results),complete=True,runId=run_id,binarySha256=CONTROL,censusBindingSha256=census['bindingSha256'],chosen=census['chosen'],capturesSha256=captures))
validate_replays(out,census)

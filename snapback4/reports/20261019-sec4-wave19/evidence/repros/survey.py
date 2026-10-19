import pathlib,tempfile,subprocess,os,signal,json,gzip,hashlib,sys,time
from concurrent.futures import ThreadPoolExecutor,as_completed
root=pathlib.Path(__file__).resolve().parent;binary=pathlib.Path(sys.argv[1]).resolve();label=sys.argv[2];lanes=sys.argv[3:]
def run(n):
 lane=pathlib.Path.home()/f'sb4-loop/wave19-repro/sec/{n}'
 with tempfile.TemporaryDirectory(prefix='sec4-wave19-') as d:
  p=pathlib.Path(d);(p/'snapback').mkdir();(p/'tmp').mkdir();(p/'fixtures').mkdir()
  for f in (lane/'src/snapback').glob('*.q'):
   (p/'snapback'/f.name).write_text('\n'.join(l for l in f.read_text().splitlines() if not l.lstrip().startswith('invariant '))+'\n')
  (p/'snapback/security.q').write_text((lane/'security.q').read_text());(p/'package.json').write_text('{"private":true}')
  result={'lane':n,'sourceSha256':{f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in (p/'snapback').glob('*.q')}}
  for verb,flags in [('check-before',['--json']),('test',[]),('check-after',['--json'])]:
   start=time.monotonic();child=subprocess.Popen([str(binary),verb.split('-')[0],*flags],cwd=p,env=dict(os.environ,TMPDIR=str(p/'tmp')),stdout=subprocess.PIPE,stderr=subprocess.PIPE,text=True,start_new_session=True)
   try:stdout,stderr=child.communicate(timeout=600);code=child.returncode
   except subprocess.TimeoutExpired:
    os.killpg(child.pid,signal.SIGTERM)
    try:stdout,stderr=child.communicate(timeout=5)
    except subprocess.TimeoutExpired:os.killpg(child.pid,signal.SIGKILL);stdout,stderr=child.communicate()
    code='timeout'
   with gzip.open(root/f'{label}-{n}-{verb}.txt.gz','wt') as f:f.write(stdout+'\nSTDERR\n'+stderr)
   record={'exit':code,'seconds':round(time.monotonic()-start,3)}
   if verb=='test':
    record['witnesses']=[json.loads(l.split(': ',1)[1]) for l in stdout.splitlines() if l.startswith('security violation: ')];record['summary']=[l for l in stdout.splitlines() if l.startswith(('security histories:','security tests:'))]
   else:
    try:record['security']=json.loads(stdout)['security']
    except (ValueError,KeyError):record['parse']='unavailable'
   result[verb]=record
  return result
results=[]
with ThreadPoolExecutor(max_workers=2) as pool:
 for task in as_completed([pool.submit(run,n) for n in lanes]):
  row=task.result();results.append(row);(root/f'{label}.json').write_text(json.dumps(results,indent=2)+'\n');print(row['lane'],[(v,row[v]['exit'],row[v]['seconds']) for v in ['check-before','test','check-after']],row['test']['summary'],flush=True)

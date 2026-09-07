import os,pathlib,subprocess,json,time,sys,urllib.request,urllib.error,hashlib,select
R=pathlib.Path('/home/ccheever/clique-tooling/adhoc-admission-dedup-r1-20260907')
label=sys.argv[1];binary=pathlib.Path(sys.argv[2]);root=R/(label+'-project');root.mkdir();(root/'snapback').mkdir()
(root/'snapback/schema.q').write_text('table items:\n  n: int\n  read <- deny\n  insert <- deny\n  update <- deny\n  delete <- deny\n')
(root/'snapback/admin.q').write_text('query clock():\n  return now\n')
trace=R/'receipts'/(label+'-admission-events.jsonl');trace.touch()
env=os.environ.copy();env.update(SNAPBACK2_COMPILER=str(R/'source/snapback2/packages/snapback2/dist/compiler.mjs'),S2_PRIVATE_ADMISSION_TRACE=str(trace))
cmd=[str(binary),'dev','--project',str(root),'--foreground']
start=time.monotonic();events=[]
err=(R/'receipts'/(label+'-owner.stderr')).open('xb')
p=subprocess.Popen(cmd,env=env,stdin=subprocess.DEVNULL,stdout=subprocess.PIPE,stderr=err,text=True)
stat=pathlib.Path(f'/proc/{p.pid}/stat').read_text();record=dict(argv=cmd,pid=p.pid,stat=stat,binarySha256=hashlib.sha256(binary.read_bytes()).hexdigest(),compilerSha256=hashlib.sha256(pathlib.Path(env['SNAPBACK2_COMPILER']).read_bytes()).hexdigest(),startedEpoch=time.time())
(R/'receipts'/(label+'-owner.launch.json')).write_text(json.dumps(record,indent=2))
try:
 assert select.select([p.stdout],[],[],5)[0], 'owner startup exceeded existing 5s readiness bound'
 line=p.stdout.readline();assert line.startswith('SNAPBACK_URL='),line
 info=json.loads((root/'.snapback/owner.json').read_text());url=info['url'];secret=info['secret']
 def request(path,body):
  req=urllib.request.Request(url+path,json.dumps(body).encode(),{'X-Snapback-Control':secret,'Content-Type':'application/json'})
  try:
   with urllib.request.urlopen(req,timeout=30) as resp:return resp.status,json.load(resp)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 def run(name,body,status,expected_counts):
  before=trace.read_text().splitlines();s,response=request('/control/run',body);after=trace.read_text().splitlines();delta=[json.loads(x) for x in after[len(before):]]
  compiler=[x for x in delta if any(n.startswith('__adhoc.') for n in x['programs'])]
  live=[x for x in delta if any(n.startswith('adhoc:') for n in x['programs'])]
  event=dict(name=name,body=body,status=s,response=response,certifications=len(delta),compilerCertifications=len(compiler),liveCertifications=len(live),events=delta)
  events.append(event)
  (R/'receipts'/(label+'-diagnostic.json')).write_text(json.dumps(events,indent=2))
  assert s==status,(name,s,response)
  expected=expected_counts[0 if label=='before' else 1]
  assert len(delta)==expected,(name,len(delta),expected)
  if len(live)==2:assert live[0]['projectHash']==live[1]['projectHash'] and live[0]['thread']==live[1]['thread']
  print(json.dumps({k:v for k,v in event.items() if k not in ['body','response','events']}),flush=True)
 q='query inspect():\n  return now\n'
 m='mutation change():\n  return now\n'
 job='job repair:\n  chunk p in items first 10 by byId:\n    update items[p.id] { n: 9 }\n'
 run('query',{'source':q},200,(3,2))
 run('mutation',{'source':m},200,(3,2))
 run('plan',{'source':job,'mode':'plan'},200,(2,2))
 run('enqueue',{'source':job},200,(3,2))
 run('query-rehearsal',{'source':q,'mode':'dry-run'},200,(3,3))
 run('mutation-rehearsal',{'source':m,'mode':'dry-run'},200,(3,3))
 run('job-rehearsal',{'source':job,'mode':'dry-run'},200,(3,3))
 run('kind-refusal',{'source':q,'mode':'plan'},400,(1,1))
 run('seat-refusal',{'source':q,'as':'alice'},400,(1,1))
 run('argument-refusal',{'source':'mutation change(n: int):\n  return n\n','args':{'n':'bad'}},400,(1,1))
 run('compiler-refusal',{'source':'not quarry'},400,(0,0))
 run('transaction-rejection',{'source':'mutation refuse():\n  require false else STOP\n  return true\n'},200,(3,2))
 request('/control/stop',{})
 p.wait(timeout=5);assert p.returncode==0
 print('diagnostic complete',flush=True)
finally:
 if p.poll() is None:
  # Only this recorded owner; preserve failure and avoid orphaning its worker.
  p.terminate()
  try:p.wait(timeout=5)
  except subprocess.TimeoutExpired:p.kill();p.wait(timeout=5)
 err.close()
 (R/'receipts'/(label+'-owner.terminal.json')).write_text(json.dumps(dict(pid=p.pid,exit=p.returncode,elapsedSeconds=time.monotonic()-start,events=len(events),stillPresent=pathlib.Path(f'/proc/{p.pid}').exists()),indent=2))

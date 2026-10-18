import subprocess,pathlib,json,urllib.request,urllib.error,os,select,time,signal,sys
base=pathlib.Path('/tmp/sb4-stage-repro');lane=next(base.glob(sys.argv[1]+'-*'))
# Only this recorded directly spawned npm wrapper receives a shutdown signal.
log=open('/tmp/stage-repro-'+sys.argv[1]+'.stderr.log','w')
p=subprocess.Popen(['npm','run','probe:serve'],cwd=lane,stdout=subprocess.PIPE,stderr=log,text=True,bufsize=1,start_new_session=True)
try:
 end=time.monotonic()+360;line=None
 while time.monotonic()<end:
  if p.poll() is not None:raise RuntimeError('probe died '+str(p.returncode))
  r,_,_=select.select([p.stdout],[],[],1)
  if not r:continue
  candidate=p.stdout.readline()
  if candidate.startswith('{'):
   result=json.loads(candidate)
   if 'backendUrl' in result:line=result;break
 if line is None:raise RuntimeError('probe readiness timeout')
 def request(path,body=None,token=None,persona=None):
  hdr={}
  if token:hdr['Authorization']='Bearer '+token
  if persona:hdr['x-snapback-persona']=persona
  if body is not None:hdr['content-type']='application/json'
  r=urllib.request.Request(line['backendUrl']+path,data=None if body is None else json.dumps(body).encode(),headers=hdr)
  try:
   with urllib.request.urlopen(r,timeout=15) as response:return response.status,json.load(response)
  except urllib.error.HTTPError as e:return e.code,json.load(e)
 status,cfg=request('/auth/config');assert status==200 and cfg['development'] is False and cfg['devDoors'] is False and cfg['environment']=='staging',cfg
 checked={}
 for role,users in line['sessions'].items():
  assert len(users)>=2
  for u in users:
   status,signed=request('/auth/login',{'email':u['email'],'password':u['password']});assert status==200 and signed['session']['principal']==u['principal']
   status,cat=request('/',token=signed['session']['token']);assert status==200 and cat['ops']
  checked[role]=len(users)
 assert request('/dev/status')[0]==403
 assert request('/seed',[])[0]==403
 assert request('/q/myRole',{'args':{}},persona='alice')[0]==401
 with urllib.request.urlopen(line['frontendUrl'],timeout=15) as response:assert response.status==200
 evidence={'lane':lane.name,'status':'passed','backend':'serve','development':cfg['development'],'environment':cfg['environment'],'devDoors':cfg['devDoors'],'passwordLogins':checked,'unauthenticatedSeed':403,'unauthenticatedStatus':403,'persona':401,'frontend':200,'aliveAtEnd':p.poll() is None,'credentials':'kept in memory; omitted from evidence'}
 pathlib.Path('/tmp/stage-repro-'+sys.argv[1]+'.json').write_text(json.dumps(evidence,indent=2)+'\n');print(json.dumps(evidence))
finally:
 if p.poll() is None:os.killpg(p.pid,signal.SIGTERM)
 try:p.wait(timeout=20)
 except subprocess.TimeoutExpired:
  # Group belongs to the wrapper recorded at launch, including proof children.
  os.killpg(p.pid,signal.SIGKILL);p.wait(timeout=5)
 log.close()

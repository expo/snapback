#!/usr/bin/env python3
"""Repeat SQLite with thread-tagged traces to exclude concurrent maintenance."""
import hashlib,json,os,pathlib,shutil,subprocess,tempfile,time,urllib.request
HERE=pathlib.Path(__file__).resolve().parent
BIN=HERE.parents[1]/'target/debug/snapback4'
WORK=pathlib.Path(tempfile.mkdtemp(prefix='rta-sqlite-',dir='/tmp'))
ENV={k:v for k,v in os.environ.items() if k not in ['SNAPBACK4_STORE_URL','SNAPBACK4_WORKER_STATE_DIR','RT_A_TRACE']}
children=[];phases=[];pids=[];traces={}
def disk():assert shutil.disk_usage('/').free>=30*1024**3,'STOP: disk below 30 GiB'
def cli(app,args):
    disk();r=subprocess.run([str(BIN),*map(str,args)],cwd=app,env=ENV,text=True,capture_output=True,timeout=60)
    assert r.returncode==0,(args,r.stdout,r.stderr)
def start(app,label):
    disk()
    with (WORK/(label+'.out')).open('w') as out,(WORK/(label+'.err')).open('w') as err:
        child=subprocess.Popen([str(BIN),'serve',str(app/'deployment'),'--port','0'],cwd=app,env={**ENV,'RT_A_TRACE':'1'},stdout=out,stderr=err)
    children.append(child);pids.append(dict(label=label,pid=child.pid))
    until=time.monotonic()+30
    while time.monotonic()<until:
        text=(WORK/(label+'.err')).read_text()
        assert child.poll() is None,(label,text[-1000:])
        if 'SNAPBACK4_READY' in text:return child,(WORK/(label+'.out')).read_text().splitlines()[0]
        time.sleep(.05)
    raise RuntimeError('readiness timeout')
def stop(child):
    if child.poll() is None:child.terminate()
    child.wait(timeout=15)
    assert not pathlib.Path('/proc',str(child.pid)).exists()
def http(base,path,args=None,token=None):
    headers={'Content-Type':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    with urllib.request.urlopen(urllib.request.Request(base+path,method='POST',headers=headers,data=json.dumps(args or {}).encode()),timeout=30) as r:
        body=json.load(r)
        assert r.status==200 and 'denied' not in body and body.get('state')!='failed',(path,body)
        return body
def phase(label,server,base,path,args,token):
    begin=time.time_ns();body=http(base,path,args,token);end=time.time_ns()
    if path=='/q/W1':assert body['complete'] and body['data']['id']=='m0024',body
    if path=='/q/W2':assert body['complete'] and [row['at'] for row in body['data']]==list(range(24,4,-1)),body
    # Replies contain principal ids, but no credentials. Keep only result shape.
    phases.append(dict(label=label,server=server,backend='sqlite',start_ns=begin,end_ns=end,
                       result=dict(state=body.get('state'),complete=body.get('complete'),rows=len(body['data']) if isinstance(body.get('data'),list) else None)))
    print(label,'ok',flush=True);time.sleep(.025)
try:
    print('work',WORK,flush=True)
    for shape,file in [('tiny','tiny.q'),('reads','admitted-s1.q')]:
        app=WORK/shape;(app/'snapback').mkdir(parents=True)
        (app/'snapback/schema.q').write_text((HERE/file).read_text())
        cli(app,['deploy',app/'deployment'])
        label=shape;child,base=start(app,label)
        guest=http(base,'/auth/guest');token=guest.get('token') or guest['session']['token']
        if shape=='tiny':
            http(base,'/m/make',{'args':{}},token);args={'args':{'counter':'c0000'}}
            phase('increment-first',label,base,'/m/increment',args,token)
            for i in range(3):phase('increment-warm-'+str(i),label,base,'/m/increment',args,token)
            phase('q-cold-prepare',label,base,'/q/peek',args,token)
            for i in range(3):phase('q-warm-'+str(i),label,base,'/q/peek',args,token)
            guest2=http(base,'/auth/guest');token2=guest2.get('token') or guest2['session']['token']
            for i in range(2):phase('q-new-session-'+str(i),label,base,'/q/constant',{'args':{}},token2)
        else:
            http(base,'/m/setup',{'args':{}},token)
            for i in range(25):http(base,'/m/seedMessage',{'args':{'key':f'm{i:04}','at':i}},token)
            for op,args in [('W1',{'message':'m0024'}),('W2',{'room':'r0001'})]:
                phase(op+'-cold-prepare',label,base,'/q/'+op,{'args':args},token)
                for i in range(3):phase(op+'-warm-'+str(i),label,base,'/q/'+op,{'args':args},token)
            for i in range(4):phase('one-rule-'+str(i),label,base,'/m/checked',{'args':{'counter':'c0000','room':'r0001'}},token)
        stop(child)
        label=shape+'-restart';child,base=start(app,label)
        op,args=('peek',{'counter':'c0000'}) if shape=='tiny' else ('W1',{'message':'m0024'})
        phase('q-cold-process',label,base,'/q/'+op,{'args':args},token)
        phase('q-warm-process',label,base,'/q/'+op,{'args':args},token)
        stop(child)
finally:
    for child in children:stop(child)
    for path in WORK.glob('*.err'):
        traces[path.stem]=[json.loads(line[5:]) for line in path.read_text().splitlines() if line.startswith('RT_A ')]
    alive=[p for p in pids if pathlib.Path('/proc',str(p['pid'])).exists()]
    (HERE/'sqlite-raw.json').write_text(json.dumps(dict(work=str(WORK),phases=phases,traces=traces,pids=pids,alive=alive,binary_sha256=hashlib.sha256(BIN.read_bytes()).hexdigest()),indent=2)+'\n')
    print('cleanup',dict(alive=alive),flush=True)
    assert not alive

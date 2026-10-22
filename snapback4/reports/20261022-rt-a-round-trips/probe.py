#!/usr/bin/env python3
"""RT-A local public-serve probe. Apply instrumentation.patch before building.

No Bind values, startup fields, result rows, or authentication bytes are recorded.
The socket relay forwards original chunks; parsing only observes their framing.
"""
import collections, hashlib, json, os, pathlib, select, shutil, signal, socket
import struct, subprocess, tempfile, threading, time, urllib.request, urllib.error, urllib.parse

HERE = pathlib.Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BIN = ROOT / 'target/debug/snapback4'
WORK = pathlib.Path(tempfile.mkdtemp(prefix='rta-', dir='/tmp'))
PG = pathlib.Path.home() / 'tools/pg16'
ENV = {**os.environ, 'PATH': str(PG/'usr/lib/postgresql/16/bin')+':'+os.environ['PATH'],
       'LD_LIBRARY_PATH': str(PG/'usr/lib/x86_64-linux-gnu'), 'TMPDIR':'/tmp'}
for key in ['SNAPBACK4_STORE_URL','SNAPBACK4_WORKER_STATE_DIR','RT_A_TRACE']:
    ENV.pop(key, None)
events, phases, pids, errors = [], [], [], []
lock = threading.Lock()
stop_relay = threading.Event()
threads, sockets, children = [], [], []
cluster_started = False
PORT = 55489

def disk():
    free = shutil.disk_usage('/').free
    assert free >= 30*1024**3, f'STOP: disk free {free}'
    return free

def emit(**event):
    with lock:
        events.append({'ns':time.time_ns(), **event})

class Parser:
    def __init__(self, conn, direction):
        self.conn, self.direction, self.buffer = conn, direction, b''
        self.startup = direction == 'frontend'
    def feed(self, data):
        self.buffer += data
        while True:
            if self.startup:
                if len(self.buffer)<4: return
                n = struct.unpack('!I', self.buffer[:4])[0]
                if len(self.buffer)<n: return
                payload, self.buffer = self.buffer[4:n], self.buffer[n:]
                code = struct.unpack('!I',payload[:4])[0]
                emit(conn=self.conn, direction=self.direction, type='Startup', code=code)
                # NoTls client sends protocol 3 directly, not an SSL request.
                assert code == 196608, code
                self.startup = False
                continue
            if len(self.buffer)<5: return
            typ, n = chr(self.buffer[0]), struct.unpack('!I',self.buffer[1:5])[0]
            assert 4<=n<128*1024*1024, (typ,n)
            if len(self.buffer)<n+1: return
            payload, self.buffer = self.buffer[5:n+1], self.buffer[n+1:]
            event = dict(conn=self.conn, direction=self.direction,type=typ, bytes=n+1)
            if self.direction=='frontend':
                if typ=='P':
                    name, sql, _ = payload.split(b'\0',2)
                    event.update(name=name.decode(), sql=sql.decode())
                elif typ=='B':
                    portal, name, _ = payload.split(b'\0',2)
                    event.update(portal=portal.decode(),name=name.decode())
                elif typ in ['E','D','C']:
                    event['name']=payload.split(b'\0')[0].decode(errors='replace')
                elif typ=='Q': event['sql']=payload.rstrip(b'\0').decode()
            elif typ=='C': event['tag']=payload.rstrip(b'\0').decode()
            elif typ=='Z': event['status']=payload.decode()
            elif typ=='K': event['pid']=struct.unpack('!I',payload[:4])[0]
            elif typ=='E': event['error']=True
            emit(**event)

def relay(conn, client):
    server = socket.socket(socket.AF_UNIX)
    server.connect(str(WORK/'socket'/f'.s.PGSQL.{PORT}'))
    with lock: sockets.extend([client,server])
    parsers={client:Parser(conn,'frontend'),server:Parser(conn,'backend')}
    try:
        while not stop_relay.is_set():
            readable,_,_ = select.select([client,server],[],[],.1)
            for source in readable:
                data=source.recv(1024*1024)
                if not data:return
                parsers[source].feed(data)
                (server if source is client else client).sendall(data)
    except (OSError,ValueError) as error:
        if not stop_relay.is_set(): errors.append(repr(error))
    except BaseException as error: errors.append(repr(error))
    finally:
        client.close();server.close()

def accept(listener):
    n=0
    while not stop_relay.is_set():
        try:client,_=listener.accept()
        except socket.timeout:continue
        except OSError:return
        n+=1
        thread=threading.Thread(target=relay,args=(n,client));threads.append(thread);thread.start()

def run(args, **kwargs):
    disk()
    result=subprocess.run([str(x) for x in args],env=kwargs.pop('env',ENV),text=True,capture_output=True,timeout=60,**kwargs)
    return result

def cli(app,args,url=None,ok=True):
    env={**ENV}
    if url:env['SNAPBACK4_STORE_URL']=url
    result=run([BIN,*args],cwd=app,env=env)
    assert (result.returncode==0)==ok,(args,result.stdout,result.stderr)
    return result

def start(app,dep,url,label):
    env={**ENV,'RT_A_TRACE':'1'}
    if url:env['SNAPBACK4_STORE_URL']=url
    stdout=(WORK/(label+'.out')).open('w');stderr=(WORK/(label+'.err')).open('w')
    child=subprocess.Popen([str(BIN),'serve',str(dep),'--worker-state-dir',str(dep/'worker'), '--port','0'],cwd=app,env=env,stdout=stdout,stderr=stderr)
    children.append(child);pids.append({'label':label,'pid':child.pid})
    stdout.close();stderr.close()
    until=time.monotonic()+30
    while time.monotonic()<until:
        text=(WORK/(label+'.err')).read_text()
        assert child.poll() is None,(label,text[-3000:])
        if 'SNAPBACK4_READY' in text:
            base=(WORK/(label+'.out')).read_text().splitlines()[0]
            return child,base
        time.sleep(.05)
    raise RuntimeError('server readiness timeout')

def stop(child):
    if child.poll() is None:child.terminate()
    child.wait(timeout=15)
    assert not pathlib.Path('/proc',str(child.pid)).exists()

def http(base,path,args=None,token=None):
    headers={'Content-Type':'application/json'}
    if token:headers['Authorization']='Bearer '+token
    request=urllib.request.Request(base+path,method='POST',headers=headers,data=json.dumps(args or {}).encode())
    try:response=urllib.request.urlopen(request,timeout=30)
    except urllib.error.HTTPError as error:response=error
    with response:
        body=json.load(response)
        assert response.status==200,(path,response.status,body)
        assert 'denied' not in body and body.get('state')!='failed',(path,body)
        return body

def phase(label,backend,server,base,path,args,token):
    start_ns=time.time_ns()
    body=http(base,path,args,token)
    end_ns=time.time_ns()
    phases.append(dict(label=label,backend=backend,server=server,start_ns=start_ns,end_ns=end_ns,
                       result=body))
    print(backend,label,'ok',round((end_ns-start_ns)/1e6,2),'ms',flush=True)
    time.sleep(.025)
    return body

def suite(shape,source):
    for backend in ['postgres','sqlite']:
        disk()
        label=shape+'-'+backend
        app=WORK/label; (app/'snapback').mkdir(parents=True)
        (app/'snapback/schema.q').write_text(source)
        dep=app/'deployment'
        url=None if backend=='sqlite' else f'postgres://rta@/postgres?host={urllib.parse.quote(str(WORK/"proxy"),safe="")}&port={PORT}&schema={shape}&ha=none'
        cli(app,['check'])
        cli(app,['deploy',dep],url)
        child,base=start(app,dep,url,label)
        guest=http(base,'/auth/guest');token=guest['token'] if 'token' in guest else guest['session']['token']
        if shape=='tiny':
            http(base,'/m/make',{'args':{}},token)
            args={'args':{'counter':'c0000'}}
            phase('increment-first',backend,label,base,'/m/increment',args,token)
            for _ in range(3):http(base,'/m/increment',args,token)
            for i in range(3):phase('increment-warm-'+str(i),backend,label,base,'/m/increment',args,token)
            phase('q-cold-prepare',backend,label,base,'/q/peek',args,token)
            for i in range(3):phase('q-warm-'+str(i),backend,label,base,'/q/peek',args,token)
            guest2=http(base,'/auth/guest');token2=guest2.get('token') or guest2['session']['token']
            for i in range(2):phase('q-new-session-'+str(i),backend,label,base,'/q/constant',{'args':{}},token2)
            # Idle captures include the independent per-process ownership renewal.
            start_ns=time.time_ns();time.sleep(1.3)
            phases.append(dict(label='idle-renewal',backend=backend,server=label,start_ns=start_ns,end_ns=time.time_ns(),result=None))
        else:
            http(base,'/m/setup',{'args':{}},token)
            for i in range(25):http(base,'/m/seedMessage',{'args':{'key':f'm{i:04}','at':i}},token)
            for op,args in [('W1',{'message':'m0024'}),('W2',{'room':'r0001'})]:
                phase(op+'-cold-prepare',backend,label,base,'/q/'+op,{'args':args},token)
                for i in range(3):phase(op+'-warm-'+str(i),backend,label,base,'/q/'+op,{'args':args},token)
            for i in range(4):phase('one-rule-'+str(i),backend,label,base,'/m/checked',{'args':{'counter':'c0000','room':'r0001'}},token)
        stop(child)
        # First request in a fresh process: reader creation and cold plan caches.
        time.sleep(3.2)
        restart=label+'-restart';child,base=start(app,dep,url,restart)
        op,args=('peek',{'counter':'c0000'}) if shape=='tiny' else ('W1',{'message':'m0024'})
        phase('q-cold-process',backend,restart,base,'/q/'+op,{'args':args},token)
        phase('q-warm-process',backend,restart,base,'/q/'+op,{'args':args},token)
        stop(child)

try:
    disk()
    print('work',WORK,flush=True)
    for name in ['socket','proxy']:(WORK/name).mkdir()
    result=run(['initdb','-D',WORK/'data','-U','rta','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--no-locale','-L',PG/'usr/share/postgresql/16'])
    assert result.returncode==0,result.stderr
    result=run(['pg_ctl','-D',WORK/'data','-l',WORK/'postgres.log','-o',f'-k {WORK}/socket -c listen_addresses= -p {PORT} -c log_statement=all -c log_parameter_max_length=0','-w','start'])
    assert result.returncode==0,result.stderr
    cluster_started=True
    pids.append({'label':'postmaster','pid':int((WORK/'data/postmaster.pid').read_text().splitlines()[0])})
    listener=socket.socket(socket.AF_UNIX);listener.bind(str(WORK/'proxy'/f'.s.PGSQL.{PORT}'));listener.listen();listener.settimeout(.1)
    accept_thread=threading.Thread(target=accept,args=(listener,));accept_thread.start()
    # Reproduce the exact unchanged S1 admission refusal first.
    app=WORK/'full';(app/'snapback').mkdir(parents=True)
    original=(ROOT/'experiments/scale-controls/snapback-app/snapback/schema.q').read_text()
    (app/'snapback/schema.q').write_text(original)
    url=f'postgres://rta@/postgres?host={urllib.parse.quote(str(WORK/"proxy"),safe="")}&port={PORT}&schema=full&ha=none'
    refusal=cli(app,['deploy',app/'deployment'],url,False)
    (HERE/'full-deploy.stderr').write_text(refusal.stderr)
    assert 'maintained-columns' in refusal.stderr,refusal.stderr
    tiny=(ROOT/'experiments/scale-controls/results-20261022-snapback-postgres/counter-probe.q').read_text()+'''\nquery peek(counter: counters):
  return counters[counter] ! else NOT_FOUND
query constant():
  return 1
'''
    admitted='use identity\n'+original.replace('  sent: count messages by .sender\n','').replace('  total: count messages by .room\n','')
    begin=admitted.index('query W3():');end=admitted.index('mutation increment',begin)
    admitted=admitted[:begin]+admitted[end:]+'''
mutation setup():
  insert users {id: 'u0001', principal: viewer}
  insert rooms {id: 'r0001'}
  insert memberships {id: 'g0001', room: 'r0001', principal: viewer}
  return insert counters {id: 'c0000', room: 'r0001', owner: viewer}
mutation seedMessage(key: id, at: time):
  return insert messages {id: key, room: 'r0001', sender: 'u0001', at, body: 'probe'}
mutation checked(counter: counters, room: rooms):
  require exists memberships[room, viewer] else NOT_ALLOWED
  c = counters[counter] ! else NOT_FOUND
  return update counters[c.id] {n: c.n + 1}
'''
    (HERE/'tiny.q').write_text(tiny)

    for table in ['users','rooms','memberships','counters']:
        admitted=admitted.replace('table '+table+':\n','table '+table+':\n  insert <- allow\n')
    (HERE/'admitted-s1.q').write_text(admitted)
    if os.environ.get('RT_A_READS_ONLY') != '1': suite('tiny',tiny)
    if os.environ.get('RT_A_TINY_ONLY') != '1': suite('reads',admitted)
finally:
    for child in children:
        try:stop(child)
        except Exception as error:errors.append(repr(error))
    stop_relay.set()
    if 'listener' in globals():listener.close();accept_thread.join(timeout=3)
    for sock in sockets:
        try:sock.shutdown(socket.SHUT_RDWR)
        except OSError:pass
        sock.close()
    for thread in threads:thread.join(timeout=3)
    if cluster_started:
        result=run(['pg_ctl','-D',WORK/'data','-m','fast','-w','stop'])
        assert result.returncode==0,result.stderr
        confirm=run(['pg_ctl','-D',WORK/'data','status'])
        assert confirm.returncode==3,confirm.stdout
    # Only instrument records, not arbitrary server logs or bearer credentials.
    traces={}
    for path in WORK.glob('*.err'):
        traces[path.stem]=[json.loads(line[5:]) for line in path.read_text().splitlines() if line.startswith('RT_A ')]
    # Remove session principal values from returned JSON; retain useful row results.
    def scrub(value):
        if isinstance(value,dict):return {k: ('<principal>' if k in ['owner','principal','viewer','sender'] else scrub(v)) for k,v in value.items()}
        if isinstance(value,list):return [scrub(v) for v in value]
        return value
    alive=[p for p in pids if pathlib.Path('/proc',str(p['pid'])).exists()]
    (HERE/'raw.json').write_text(json.dumps(dict(work=str(WORK),source=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),binary_sha256=hashlib.sha256(BIN.read_bytes()).hexdigest(),events=events,phases=scrub(phases),traces=traces,pids=pids,alive=alive,errors=errors,free_bytes=disk()),indent=2)+'\n')
    print('cleanup',dict(alive=alive,errors=errors,work=str(WORK)),flush=True)
    assert not alive and not errors,(alive,errors)

#!/usr/bin/env python3
"""Public deploy/serve witness; owns a private socket cluster and recorded children."""
# @ref LLP 3000.009.001.000#3.4 — public CLI, persisted releases and real lease custody.
import json, os, pathlib, shutil, signal, subprocess, tempfile, time, urllib.request, urllib.error, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
BIN = ROOT / 'target/debug/snapback4'
WORK = pathlib.Path(tempfile.mkdtemp(prefix='s10d3-serve-', dir='/tmp'))
DATA = WORK / 'data'
children = []
cluster_started = False

def disk():
    assert shutil.disk_usage('/').free >= 30 * 1024**3, 'disk below 30 GiB; stop'

def run(args, **kwargs):
    disk()
    return subprocess.run([str(x) for x in args], text=True, capture_output=True, timeout=45, **kwargs)

def cli(args, success=True, env=None):
    result = run([BIN, *args], cwd=WORK / 'app', env=env)
    if success:
        assert result.returncode == 0, (args[0], result.stdout, result.stderr)
    else:
        assert result.returncode != 0, (args[0], result.stdout, result.stderr)
    return result

def start(label, url, ready=True):
    out, err = WORK / (label+'.out'), WORK / (label+'.err')
    with out.open('w') as stdout, err.open('w') as stderr:
        child = subprocess.Popen([str(BIN), 'serve', str(WORK/'deployment'), '--store-url', url,
            '--worker-state-dir', str(WORK/'worker-state'), '--port', '0'], cwd=WORK/'app', stdout=stdout, stderr=stderr, start_new_session=True)
    children.append(child)
    with (WORK/'pids.jsonl').open('a') as record: record.write(json.dumps({'name':label, 'pid':child.pid})+'\n')
    until = time.monotonic()+20
    while time.monotonic() < until:
        if child.poll() is not None:
            assert not ready, (label, err.read_text())
            return child, err.read_text()
        if 'SNAPBACK4_READY' in err.read_text():
            assert ready, 'unexpected ownership acquisition'
            return child, out.read_text().splitlines()[0]
        time.sleep(.05)
    raise AssertionError((label, 'readiness timeout', err.read_text()))

def stop(child, sig=signal.SIGTERM):
    if child.poll() is None: child.send_signal(sig)
    child.wait(timeout=15)

def http(base, method, path, payload=None, token=None, expected=200):
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    request=urllib.request.Request(base+path, method=method, headers=headers, data=None if payload is None else json.dumps(payload).encode())
    try: response=urllib.request.urlopen(request, timeout=15)
    except urllib.error.HTTPError as error: response=error
    with response:
        body=json.loads(response.read())
        assert response.status==expected, (path,response.status,body)
        return body

source='''use identity
table notes:
  n: int
  public
  insert <- allow
  update <- allow
  sync public
mutation put(key: id, n: int):
  upsert notes[key] {n}
  return n
query peek(key: id):
  return notes[key]
'''
try:
    disk()
    (WORK/'app/snapback').mkdir(parents=True)
    (WORK/'app/snapback/schema.q').write_text(source)
    share=['-L',os.environ['SNAPBACK4_PG_SHARE']] if os.environ.get('SNAPBACK4_PG_SHARE') else []
    result=run(['initdb','-D',DATA,'-U','s10d3','--auth-local=trust','--auth-host=reject','--encoding=UTF8','--no-locale',*share])
    assert result.returncode==0,result.stderr
    result=run(['pg_ctl','-D',DATA,'-l',WORK/'postgres.log','-o',f'-k {WORK} -c listen_addresses= -p 55483','-w','start'])
    assert result.returncode==0,result.stderr
    cluster_started=True
    print('cluster pid', (DATA/'postmaster.pid').read_text().splitlines()[0], 'directory', WORK, flush=True)
    # URL credentials never appear in immutable records. Local trust still parses a secret.
    url=f'postgres://s10d3:private-password@/postgres?host={urllib.parse.quote(str(WORK),safe="")}&port=55483&schema=serving&ha=none'
    connection=f'host={WORK} port=55483 user=s10d3 dbname=postgres'
    role=run(['psql',connection,'-v','ON_ERROR_STOP=1','-c',"CREATE ROLE s10d3_app LOGIN; GRANT CREATE ON DATABASE postgres TO s10d3_app;"])
    assert role.returncode==0,role.stderr
    url=url.replace('s10d3:private-password','s10d3_app:private-password')
    for invalid,code in [
        ('postgres://app@/postgres?ha=none','E_STORE_CONFIG'),
        ('postgres://app@/postgres?schema=app&ha=async','E_STORE_UNSUPPORTED'),
        ('postgres://app:private-password@127.0.0.1/postgres?schema=app&ha=none','E_STORE_UNSUPPORTED'),
    ]:
        refused=cli(['doctor','--store-url',invalid],False)
        assert code in refused.stderr and 'private-password' not in refused.stderr,refused.stderr
    cli(['check'])
    print('check: admitted app compiled',flush=True)
    deploy=cli(['deploy',str(WORK/'deployment'),'--store-url',url])
    print(deploy.stdout.strip(),flush=True)
    # CLI wins over malformed environment; conflicting local selector fails by name.
    env={**os.environ,'SNAPBACK4_STORE_URL':'invalid ambient secret'}
    result=cli(['doctor','--store-url',url,'--json'],env=env)
    assert json.loads(result.stdout)['backend']=='postgres'
    explanation=cli(['why','E_STORE_CONFIG'],env={**os.environ,'SNAPBACK4_STORE_URL':url})
    assert 'Use one store selector' in explanation.stdout,explanation.stdout
    result=cli(['deploy',str(WORK/'deployment'),'--store','elsewhere','--store-url',url],False)
    assert 'E_STORE_CONFIG' in result.stderr
    result=cli(['sql','SELECT 1','--store-url',url],False)
    assert 'E_STORE_UNSUPPORTED' in result.stderr
    assert 'private-password' not in ''.join(p.read_text() for p in (WORK/'deployment').rglob('*') if p.is_file())
    unchanged=cli(['deploy',str(WORK/'deployment'),'--store-url',url])
    assert 'unchanged' in unchanged.stdout,unchanged.stderr
    first,base=start('first',url)
    claims=http(base,'POST','/effects/claim',{},expected=503)
    assert claims['denied']['code']=='E_STORE_UNSUPPORTED',claims
    session=http(base,'POST','/auth/guest',{})['session']
    token=session['token']
    probe=http(base,'GET','/probe',token=token)
    identity=probe['store_id']
    payload={'id':'first','args':{'key':'n1','n':7},'store_id':identity}
    sent=http(base,'POST','/m/put',payload,token)
    assert sent['state']=='sent' and sent['seq']==1 and sent['preserved'] is None,sent
    replay=http(base,'POST','/m/put',payload,token)
    assert replay['replayed'] is True and replay['seq']==1,replay
    reused=http(base,'POST','/m/put',{**payload,'args':{'key':'n1','n':8}},token)
    assert reused['why']['code']=='E_ID_REUSED',reused
    page=http(base,'POST','/q/peek',{'args':{'key':'n1'}},token)
    assert page['data']['n']==7,page
    changes=http(base,'GET','/changes?after=0&wait=0',token=token)
    assert changes['preserved'] is None,changes
    doctor=json.loads(cli(['doctor','--release',str(WORK/'deployment'),'--store-url',url,'--json']).stdout)
    assert doctor['store']['token']>0 and not doctor['store']['expired'],doctor
    print('HTTP: guest/session, query, identified mutation, receipt replay, changes preserved=null; doctor positive owner/lease',flush=True)
    other,message=start('contender',url,False)
    assert 'E_STORE_OWNERSHIP' in message,message
    print('second serve: E_STORE_OWNERSHIP before readiness',flush=True)
    stop(first)
    time.sleep(3.2)
    restarted,base=start('restart',url)
    page=http(base,'POST','/q/peek',{'args':{'key':'n1'}},token)
    assert page['data']['n']==7 and page['store_id']==identity,page
    replay=http(base,'POST','/m/put',payload,token)
    assert replay['replayed'] is True and replay['seq']==1,replay
    assert http(base,'GET','/schema',token=token)['generation']==sent['generation']
    print('restart: data, session, store id, generation and receipt persisted',flush=True)
    stop(restarted,signal.SIGKILL)
    until=time.monotonic()+10
    standby=None
    attempt=0
    while time.monotonic()<until:
        attempt+=1
        # Deterministic readiness expectation comes from the database clock.
        expiry=run(['psql',connection,'-Atc','SELECT lease_until<clock_timestamp() FROM serving._owner'])
        assert expiry.returncode==0,expiry.stderr
        if expiry.stdout.strip()=='t':
            standby,base=start('standby',url)
            break
        time.sleep(.1)
    assert standby is not None,'lease never expired'
    page=http(base,'POST','/q/peek',{'args':{'key':'n1'}},token)
    assert page['data']['n']==7,page
    print('SIGKILL: recorded owner reaped; standby acquired after database-clock lease expiry',flush=True)
    http(base,'POST','/auth/logout',{},token)
    http(base,'POST','/q/peek',{'args':{'key':'n1'}},token,expected=401)
    # Loss witness: change the token under FOR UPDATE; old process must exit.
    result=run(['psql',connection,'-v','ON_ERROR_STOP=1','-c',"BEGIN; SELECT token FROM serving._owner FOR UPDATE; UPDATE serving._owner SET token=token+1,lease_until='-infinity'; COMMIT;"])
    assert result.returncode==0,result.stderr
    standby.wait(timeout=10)
    assert standby.returncode!=0
    assert 'lease renewal lost' in (WORK/'standby.err').read_text()
    print('logout: old session refused; ownership loss: process exits and listener closes',flush=True)
    # Reopen deploy under a fresh positive token and activate same-schema program bytes.
    (WORK/'app/snapback/schema.q').write_text(source.replace('  return n\n','  return n + 1\n'))
    next_release=cli(['deploy',str(WORK/'deployment'),'--store-url',url,'--json'])
    selected=json.loads(next_release.stdout)
    assert selected['release']==2 and selected['generation']==2,selected
    final,base=start('second-release',url)
    http(base,'POST','/q/peek',{'args':{'key':'n1'}},token,expected=401)
    fresh=http(base,'POST','/auth/guest',{})['session']['token']
    page=http(base,'POST','/q/peek',{'args':{'key':'n1'}},fresh)
    assert page['data']['n']==7,page
    sent=http(base,'POST','/m/put',{'id':'second','args':{'key':'n2','n':8}},fresh)
    assert sent['state']=='sent' and sent['result']==9 and sent['generation']==2,sent
    stop(final)
    print('reopened deploy: release 2/generation 2, changed program and original data persist; serving role is non-superuser',flush=True)

    (WORK/'app/snapback/schema.q').write_text(source+'job unsupported():\n  for row in notes:\n    update notes[row.id] {n: 1}\n')
    badurl=url.replace('schema=serving','schema=outside_profile')
    result=cli(['deploy',str(WORK/'bad-deployment'),'--store-url',badurl],False)
    assert 'E_STORE_UNSUPPORTED' in result.stderr,result.stderr
    exists=run(['psql',connection,'-Atc',"SELECT to_regnamespace('outside_profile') IS NULL"])
    assert exists.stdout.strip()=='t',exists
    print('out-of-profile deploy: E_STORE_UNSUPPORTED; no schema/activation published',flush=True)
    print('PASS public Postgres serving milestone; artifacts',WORK,flush=True)
finally:
    for child in children:
        if child.poll() is None: stop(child,signal.SIGKILL)
    if cluster_started:
        result=subprocess.run(['pg_ctl','-D',str(DATA),'-m','fast','-w','stop'],capture_output=True,text=True,timeout=45)
        status=subprocess.run(['pg_ctl','-D',str(DATA),'status'],capture_output=True,text=True,timeout=10)
        assert result.returncode==0 and status.returncode==3 and not (DATA/'postmaster.pid').exists(), 'cluster stop not confirmed'
        print('owned cluster stopped and confirmed: status=3, no postmaster.pid; retained',WORK,flush=True)

#!/usr/bin/env python3
"""Public deploy/serve witness; owns a private socket cluster and recorded children."""
# @ref LLP 3000.009.001.000#3.4 — public CLI, persisted releases and real lease custody.
import json, os, pathlib, shutil, signal, socket, subprocess, tempfile, time, urllib.request, urllib.error, urllib.parse

ROOT = pathlib.Path(__file__).resolve().parents[1]
TARGET = pathlib.Path(os.environ.get('CARGO_TARGET_DIR', 'target'))
if not TARGET.is_absolute(): TARGET = ROOT / TARGET
BIN = TARGET / 'debug/snapback4'
ENV = {k:v for k,v in os.environ.items() if k not in ('SNAPBACK4_STORE_URL', 'SNAPBACK4_WORKER_STATE_DIR')}
WORK = pathlib.Path(tempfile.mkdtemp(prefix='s10d3-serve-', dir='/tmp'))
DATA = WORK / 'data'
children = []
cluster_started = False

def disk():
    assert shutil.disk_usage('/').free >= 30 * 1024**3, 'disk below 30 GiB; stop'

def run(args, **kwargs):
    disk()
    return subprocess.run([str(x) for x in args], text=True, capture_output=True, timeout=45, **kwargs)

def cli(args, success=True, env=None, url=None):
    environment = dict(ENV if env is None else env)
    if url is not None: environment['SNAPBACK4_STORE_URL'] = url
    result = run([BIN, *args], cwd=WORK / 'app', env=environment)
    if success:
        assert result.returncode == 0, (args[0], result.stdout, result.stderr)
    else:
        assert result.returncode != 0, (args[0], result.stdout, result.stderr)
    return result

def start(label, url, ready=True):
    out, err = WORK / (label+'.out'), WORK / (label+'.err')
    with out.open('w') as stdout, err.open('w') as stderr:
        child = subprocess.Popen([str(BIN), 'serve', str(WORK/'deployment'),
            '--worker-state-dir', str(WORK/'worker-state'), '--port', '0'], cwd=WORK/'app',
            env={**ENV, 'SNAPBACK4_STORE_URL':url}, stdout=stdout, stderr=stderr, start_new_session=True)
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
    print('server stopped and confirmed: pid', child.pid, 'status', child.returncode, flush=True)

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
    print('public witness binary', BIN.resolve(strict=True), flush=True)
    # Prove refusal precedes even the TCP handshake, independently of Postgres.
    with socket.socket() as listener:
        listener.bind(('127.0.0.1', 0))
        listener.listen()
        tcp_port = listener.getsockname()[1]
        for target in [f'host=%2Ftmp%2Fsocket&hostaddr=127.0.0.1&port={tcp_port}',
                       f'host=127.0.0.1&port={tcp_port}',
                       f'host=%2Ftmp%2Fsocket&host=127.0.0.1&port={tcp_port}']:
            result = cli(['doctor'], False, url=f'postgres://app:private-password@/postgres?{target}&schema=my_app&ha=none')
            assert 'connection-tls' in result.stderr and 'private-password' not in result.stderr,result.stderr
        listener.settimeout(.2)
        try:
            connection_attempt, _ = listener.accept()
        except socket.timeout:
            pass
        else:
            connection_attempt.close()
            raise AssertionError('socket-only refusals attempted a TCP connection')
    print('transport: hostaddr override, TCP host and mixed hosts refused before any TCP connect', flush=True)
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
    for verb in ['deploy', 'serve']:
        help_text = cli([verb, '--help']).stdout
        assert 'SQLite' in help_text and 'Postgres' in help_text and 'E_STORE_UNSUPPORTED' in help_text, help_text
    for arguments in [['deploy',str(WORK/'deployment'),'--check'],
                      ['serve',str(WORK/'deployment'),'--worker','worker.mjs']]:
        refused=cli(arguments,False,url=url)
        assert 'E_STORE_UNSUPPORTED' in refused.stderr,refused.stderr
    print('check: admitted app compiled; help distinguishes backends and unsupported flags refuse',flush=True)
    # Reproduce the failed binding write after bootstrap, then recover that id.
    obstruction = WORK/'deployment/store-binding.json'
    obstruction.mkdir(parents=True)
    failed=cli(['deploy',str(WORK/'deployment')],False,url=url)
    bootstrap=run(['psql',connection,'-Atc',"SELECT store_id FROM serving._owner WHERE token=0 AND NOT EXISTS (SELECT 1 FROM serving._meta WHERE key='release')"])
    assert bootstrap.returncode==0 and len(bootstrap.stdout.strip())==32,(failed.stderr,bootstrap)
    pending = WORK/'deployment/store-pending.json'
    intent = pending.read_bytes()
    assert json.loads(intent)['store_id'] == bootstrap.stdout.strip()
    assert 'private-password' not in intent.decode()
    obstruction.rmdir()
    def sql(statement):
        result = run(['psql', connection, '-v', 'ON_ERROR_STOP=1', '-Atc', statement])
        assert result.returncode == 0, result.stderr
        return result.stdout.strip()
    def recovery_refuses(message):
        refused = cli(['deploy', str(WORK/'deployment')], False, url=url)
        assert 'E_STORE_CONFIG' in refused.stderr and message in refused.stderr, refused.stderr
        assert 'retry' in refused.stderr and 'private-password' not in refused.stderr, refused.stderr
        assert not obstruction.exists(), 'published binding before validation'
        assert pending.read_bytes() == intent, 'changed pending intent on refusal'
        assert sql('SELECT token FROM serving._owner') == '0', 'consumed token before validation'
    # No identity intent means no right to adopt even a complete initial store.
    saved_intent = pending.with_suffix('.saved')
    pending.rename(saved_intent)
    try:
        refused = cli(['deploy', str(WORK/'deployment')], False, url=url)
        assert 'pending bootstrap intent is missing' in refused.stderr, refused.stderr
        assert not obstruction.exists() and sql('SELECT token FROM serving._owner') == '0'
    finally:
        saved_intent.rename(pending)
    socket_alias = WORK/'socket-alias'
    socket_alias.symlink_to(WORK, target_is_directory=True)
    try:
        alias_url = url.replace(urllib.parse.quote(str(WORK), safe=''), urllib.parse.quote(str(socket_alias), safe=''))
        refused = cli(['deploy', str(WORK/'deployment')], False, url=alias_url)
        assert 'namespace/socket target differs' in refused.stderr and 'retry' in refused.stderr, refused.stderr
        assert pending.read_bytes() == intent and not obstruction.exists()
        assert sql('SELECT token FROM serving._owner') == '0'
    finally:
        socket_alias.unlink()
    # Independently bootstrap another store, then replace the original behind
    # exactly the same URL/socket/namespace, as in Sol's reproduction.
    second = WORK/'second-deployment'
    (second/'store-binding.json').mkdir(parents=True)
    cli(['deploy', str(second)], False, url=url.replace('schema=serving', 'schema=replacement'))
    assert sql('SELECT store_id FROM replacement._owner') != bootstrap.stdout.strip()
    sql('ALTER SCHEMA serving RENAME TO original; ALTER SCHEMA replacement RENAME TO serving')
    try:
        recovery_refuses('store id differs')
    finally:
        sql('ALTER SCHEMA serving RENAME TO replacement; ALTER SCHEMA original RENAME TO serving')
    # Grok's probe-only schema even has the correct identity and exact owner
    # shape. Full open must refuse before publishing or claiming anything.
    sql('ALTER SCHEMA serving RENAME TO original; CREATE SCHEMA serving AUTHORIZATION s10d3_app; '
        + '; '.join(f'CREATE TABLE serving.{table} (LIKE original.{table} INCLUDING ALL); '
                    f'INSERT INTO serving.{table} SELECT * FROM original.{table}; '
                    f'ALTER TABLE serving.{table} OWNER TO s10d3_app'
                    for table in ['_owner', '_backend', '_meta']))
    try:
        recovery_refuses('missing _head')
    finally:
        sql('DROP SCHEMA serving CASCADE; ALTER SCHEMA original RENAME TO serving')
    for table in ['_backend', '_meta', '_head', '_generations', 'r', '_sessions', '_release_events']:
        sql(f'ALTER TABLE serving.{table} RENAME TO removed_table')
        try:
            recovery_refuses('missing '+table)
            assert sql("SELECT to_regclass('serving."+table+"') IS NULL") == 't', 'repaired missing table'
        finally:
            sql(f'ALTER TABLE serving.removed_table RENAME TO {table}')
    sql('ALTER TABLE serving._owner RENAME TO removed_owner')
    try:
        refused = cli(['deploy', str(WORK/'deployment')], False, url=url)
        assert 'E_STORE_CONFIG' in refused.stderr and 'missing _owner' in refused.stderr, refused.stderr
        assert pending.read_bytes() == intent and not obstruction.exists()
        assert sql('SELECT token FROM serving.removed_owner') == '0'
    finally:
        sql('ALTER TABLE serving.removed_owner RENAME TO _owner')
    for marker in ['schema_hash', 'activation_hash', 'generation', 'live_sum_candidates', 'time_audience_publications_v1']:
        value = sql(f"DELETE FROM serving._meta WHERE key='{marker}' RETURNING value")
        # psql prints its command tag after the returned value.
        value = value.splitlines()[0]
        try:
            recovery_refuses('marker '+marker)
            assert sql(f"SELECT count(*) FROM serving._meta WHERE key='{marker}'") == '0'
        finally:
            sql(f"INSERT INTO serving._meta VALUES ('{marker}','{value}')")
    sql("UPDATE serving._generations SET programs='{}'")
    try:
        recovery_refuses('generation history differs')
    finally:
        sql('UPDATE serving._generations SET programs=(SELECT programs FROM serving._backend)')
    sql('ALTER TABLE serving._owner ADD COLUMN extra int')
    try:
        recovery_refuses('unexpected column set')
    finally:
        sql('ALTER TABLE serving._owner DROP COLUMN extra')
    print('bootstrap: missing intent, same-target store swap, probe-only schema, missing tables/markers, generation mismatch and owner shape refuse; token=0, intent unchanged, no binding', flush=True)
    deploy=cli(['deploy',str(WORK/'deployment')],url=url)
    binding=json.loads((WORK/'deployment/store-binding.json').read_text())
    assert binding['store_id']==bootstrap.stdout.strip(),binding
    assert not pending.exists() and obstruction.read_bytes() == intent, 'intent did not become binding atomically'
    assert json.loads(binding['binding'])['targets']==[{'transport':'unix','socket':str(WORK/'.s.PGSQL.55483')}],binding
    print('binding failure: retry adopted the same unselected bootstrap and recorded its effective socket',flush=True)
    print(deploy.stdout.strip(),flush=True)
    # A stale intent beside an existing binding cannot authorize recreating a
    # missing selected store. Keep the original schema out of the target briefly.
    selected_token = sql('SELECT token FROM serving._owner')
    selected_binding = obstruction.read_bytes()
    pending.write_bytes(intent)
    sql('ALTER SCHEMA serving RENAME TO selected_original')
    try:
        refused = cli(['deploy', str(WORK/'deployment')], False, url=url)
        assert 'bound store is missing' in refused.stderr and 'E_STORE_CONFIG' in refused.stderr, refused.stderr
        assert sql("SELECT to_regnamespace('serving') IS NULL") == 't', 'recreated a bound store'
        assert sql('SELECT token FROM selected_original._owner') == selected_token
        assert obstruction.read_bytes() == selected_binding and pending.read_bytes() == intent
    finally:
        sql('ALTER SCHEMA selected_original RENAME TO serving')
        pending.unlink()
    # CLI wins over malformed environment; conflicting local selector fails by name.
    env={**ENV,'SNAPBACK4_STORE_URL':'invalid ambient secret'}
    result=cli(['doctor','--store-url',url.replace(':private-password',''),'--json'],env=env)
    assert json.loads(result.stdout)['backend']=='postgres'
    assert 'private-password' not in result.stdout+result.stderr
    explanation=cli(['why','E_STORE_CONFIG'],env={**os.environ,'SNAPBACK4_STORE_URL':url})
    assert 'Use one store selector' in explanation.stdout,explanation.stdout
    result=cli(['deploy',str(WORK/'deployment'),'--store','elsewhere','--store-url',url],False)
    assert 'E_STORE_CONFIG' in result.stderr
    result=cli(['sql','SELECT 1','--store-url',url],False)
    assert 'E_STORE_UNSUPPORTED' in result.stderr
    assert 'private-password' not in ''.join(p.read_text() for p in (WORK/'deployment').rglob('*') if p.is_file())
    unchanged=cli(['deploy',str(WORK/'deployment')],url=url)
    assert 'unchanged' in unchanged.stdout,unchanged.stderr
    saved_binding = obstruction.with_suffix('.saved')
    obstruction.rename(saved_binding)
    try:
        refused=cli(['deploy',str(WORK/'deployment')],False,url=url)
        assert 'deployment store binding is missing' in refused.stderr,refused.stderr
    finally:
        saved_binding.rename(obstruction)
    missing=cli(['serve',str(WORK/'deployment'),'--port','0'],False,url=url)
    assert 'E_WORKER_STATE' in missing.stderr and 'SNAPBACK4_READY' not in missing.stderr,missing.stderr
    released=run(['psql',connection,'-Atc',"SELECT lease_until='-infinity'::timestamptz FROM serving._owner"])
    assert released.returncode==0 and released.stdout.strip()=='t',released
    # Failure in serve_start after configuration validation also releases.
    with socket.socket() as busy:
        busy.bind(('127.0.0.1',0))
        busy.listen()
        refused=cli(['serve',str(WORK/'deployment'),'--worker-state-dir',str(WORK/'worker-state'),
                     '--port',str(busy.getsockname()[1])],False,url=url)
        assert 'SNAPBACK4_READY' not in refused.stderr and 'E_ADDRINUSE' in refused.stderr,refused.stderr
    released=run(['psql',connection,'-Atc',"SELECT lease_until='-infinity'::timestamptz FROM serving._owner"])
    assert released.returncode==0 and released.stdout.strip()=='t',released
    first,base=start('first',url)
    if pathlib.Path('/proc').exists():
        assert b'private-password' not in pathlib.Path(f'/proc/{first.pid}/cmdline').read_bytes()
    print('failed startup: lease explicitly released; immediate corrected serve succeeded',flush=True)
    claims=http(base,'POST','/effects/claim',{},expected=503)
    assert claims['denied']['code']=='E_STORE_UNSUPPORTED',claims
    session=http(base,'POST','/auth/guest',{})['session']
    token=session['token']
    probe=http(base,'GET','/probe',token=token)
    identity=probe['store_id']
    failure=run(['psql',connection,'-v','ON_ERROR_STOP=1','-c',"CREATE FUNCTION serving.fail_write() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'private-password from server'; END $$; CREATE TRIGGER fail_write BEFORE INSERT OR UPDATE ON serving.r FOR EACH ROW EXECUTE FUNCTION serving.fail_write();"])
    assert failure.returncode==0,failure.stderr
    try:
        denied=http(base,'POST','/m/put',{'id':'redaction','args':{'key':'n0','n':0},'store_id':identity},token,expected=503)
        assert denied['why']['code']=='E_STORE' and 'private-password' not in json.dumps(denied),denied
    finally:
        restored=run(['psql',connection,'-v','ON_ERROR_STOP=1','-c','DROP TRIGGER fail_write ON serving.r; DROP FUNCTION serving.fail_write();'])
        assert restored.returncode==0,restored.stderr
    print('HTTP: server exception detail redacted; store failure code retained',flush=True)
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
    doctor_result=cli(['doctor','--release',str(WORK/'deployment'),'--json'],url=url)
    assert 'private-password' not in doctor_result.stdout+doctor_result.stderr
    doctor=json.loads(doctor_result.stdout)
    assert doctor['store']['token']>0 and not doctor['store']['expired'],doctor
    print('HTTP: guest/session, query, identified mutation, receipt replay, changes preserved=null; doctor positive owner/lease',flush=True)
    other,message=start('contender',url,False)
    assert 'E_STORE_OWNERSHIP' in message,message
    assert http(base,'POST','/q/peek',{'args':{'key':'n1'}},token)['data']['n']==7
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
    next_release=cli(['deploy',str(WORK/'deployment'),'--json'],url=url)
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

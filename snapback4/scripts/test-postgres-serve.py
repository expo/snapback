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
    assert shutil.disk_usage(pathlib.Path.home()).free >= 40 * 1024**3, 'disk below 40 GiB; stop'

def record_pid(label, pid):
    with (WORK/'pids.jsonl').open('a') as record:
        record.write(json.dumps({'name':label,'pid':pid})+'\n')

def run(args, cleanup=False, timeout=45, **kwargs):
    if not cleanup: disk()
    args = [str(x) for x in args]
    child = subprocess.Popen(args, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE, **kwargs)
    record_pid(pathlib.Path(args[0]).name, child.pid)
    try:
        stdout, stderr = child.communicate(timeout=timeout)
    except BaseException:
        child.kill()
        child.wait()
        raise
    return subprocess.CompletedProcess(args,child.returncode,stdout,stderr)

def cli(args, success=True, env=None, url=None):
    environment = dict(ENV if env is None else env)
    if url is not None: environment['SNAPBACK4_STORE_URL'] = url
    result = run([BIN, *args], cwd=WORK / 'app', env=environment)
    if success:
        assert result.returncode == 0, (args[0], result.stdout, result.stderr)
    else:
        assert result.returncode != 0, (args[0], result.stdout, result.stderr)
    return result

def start(label, url, ready=True, deployment=None):
    out, err = WORK / (label+'.out'), WORK / (label+'.err')
    environment = dict(ENV)
    if url is not None: environment['SNAPBACK4_STORE_URL'] = url
    with out.open('w') as stdout, err.open('w') as stderr:
        child = subprocess.Popen([str(BIN), 'serve', str(deployment or WORK/'deployment'),
            '--worker-state-dir', str(WORK/'worker-state'), '--port', '0'], cwd=WORK/'app',
            env=environment, stdout=stdout, stderr=stderr, start_new_session=True)
    children.append(child)
    record_pid(label, child.pid)
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

def http(base, method, path, payload=None, token=None, expected=200, device=None):
    headers={'Content-Type':'application/json'}
    if token: headers['Authorization']='Bearer '+token
    if device: headers['x-snapback-device']=json.dumps(device)
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

def change_evidence_witness(pg_url):
    """Public configured serve, then compare the store-independent wire bytes.

    /sync uses local.ts::syncRound's body and engine handshake, including
    pending ids, generation and store identity. No internal engine seeding.
    """
    evidence_source = source.replace('  update <- allow', '  update <- allow\n  delete <- allow') + '''mutation remove(key: id):
  delete notes[key]
'''
    transcripts = {}
    for backend, target in [('postgres', pg_url), ('sqlite', None)]:
        deployment = WORK/('p1ce-'+backend)
        (WORK/'app/snapback/schema.q').write_text(evidence_source)
        cli(['deploy',str(deployment)],url=target)
        child, base = start('p1ce-'+backend+'-r1', target, deployment=deployment)
        guest = http(base,'POST','/auth/guest',{})['session']
        token = guest['token']
        records = []
        def capture(label, value):
            # Incarnation and wall clock are intentionally store-specific.
            independent = {k:v for k,v in value.items() if k not in ('store_id','now')}
            records.append((label,json.dumps(independent,sort_keys=True,separators=(',',':'))))
            return value
        def schema_state():
            state = http(base,'GET','/schema',token=token)
            compatibility = state['device_compatibility']
            return state, {'format':1,'version':compatibility['server_version'],'capabilities':compatibility['capabilities']}
        state, device = schema_state()
        def mutate(name, identity, args):
            return http(base,'POST','/m/'+name,{'id':identity,'args':args,'store_id':state['store_id']},token)
        def changes(since):
            return http(base,'GET',f'/changes?since={since}&wait=0',token=token)
        def sync(since, pending):
            return http(base,'POST','/sync',{'generation':state['generation'],'from':since,'limit':10000,
                'after':None,'stream':True,'pending':pending,'store_id':state['store_id']},token,device=device)
        seeded = capture('r1 identified',mutate('put','p1ce-first',{'key':'note','n':1}))
        assert seeded['state']=='sent' and seeded['seq']==1, seeded
        kept = capture('r1 changes',changes(0)); assert kept['preserved']==['notes'],kept
        streamed = capture('r1 sync',sync(0,['p1ce-first']))
        assert streamed['preserved']==['notes'] and streamed['acknowledged']=={'p1ce-first':1},streamed
        stop(child)
        if backend=='postgres':
            # Serve leaves its lease to expire after shutdown. Observe the
            # database-clock expiry before the next configured deploy claims it.
            deadline=time.monotonic()+10
            while True:
                doctor=json.loads(cli(['doctor','--release',str(deployment),'--json'],url=target).stdout)
                if doctor['store']['expired']: break
                assert time.monotonic()<deadline,doctor
                time.sleep(.1)
        (WORK/'app/snapback/schema.q').write_text(evidence_source.replace('  return n\n','  return n + 1\n'))
        cli(['deploy',str(deployment)],url=target)
        child, base = start('p1ce-'+backend+'-r2',target,deployment=deployment)
        state, device = schema_state()
        assert state['generation']==2,state
        updated = capture('r2 identified',mutate('put','p1ce-second',{'key':'note','n':2}))
        assert updated['state']=='sent' and updated['seq']==2,updated
        kept = capture('across release changes',changes(0)); assert kept['preserved']==['notes'],kept
        streamed = capture('across release sync',sync(1,['p1ce-first','p1ce-second']))
        assert streamed['preserved']==['notes'] and streamed['acknowledged']['p1ce-second']==2,streamed
        removed = capture('revoking identified',mutate('remove','p1ce-third',{'key':'note'}))
        assert removed['state']=='sent' and removed['seq']==3,removed
        revoked = capture('revoked changes',changes(2)); assert revoked['preserved']==[],revoked
        streamed = capture('revoked sync',sync(2,['p1ce-third']))
        assert streamed['preserved']==[] and streamed['acknowledged']=={'p1ce-third':3},streamed
        for i in range(1001):
            sent = mutate('put','p1ce-fill-'+str(i),{'key':'note','n':i})
            assert sent['state']=='sent' and sent['seq']==i+4,sent
        if backend=='postgres':
            result=run(['psql',connection,'-Atc','SELECT min(seq),max(seq),count(*) FROM p1ce._change_evidence'])
            assert result.returncode==0 and result.stdout.strip()=='5|1004|1000',result
        else:
            import sqlite3
            with sqlite3.connect(deployment/'store.sqlite') as db:
                assert db.execute('SELECT min(seq),max(seq),count(*) FROM _change_evidence').fetchone()==(5,1004,1000)
        unknown = capture('pruned changes',changes(0)); assert unknown['preserved'] is None,unknown
        streamed = capture('pruned sync',sync(0,[])); assert streamed['preserved'] is None,streamed
        stop(child)
        transcripts[backend]=records
        (WORK/('p1ce-'+backend+'-wire.json')).write_text(json.dumps(records,indent=2)+'\n')
        print('P1-CE',backend,'PASS: release, preserved/revoked changes and SDK sync, 1000 retained / pruned unknown',flush=True)
    assert transcripts['postgres']==transcripts['sqlite'], 'P1-CE store-independent wire bytes differ; inspect transcripts'
    (WORK/'app/snapback/schema.q').write_text(source)
    print('P1-CE PASS: both stores match byte-for-byte after removing only store_id and now; artifacts',WORK,flush=True)
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
    locale_args=['--locale='+os.environ['SNAPBACK4_PG_LOCALE']] if os.environ.get('SNAPBACK4_PG_LOCALE') else ['--no-locale']
    print('public witness cluster locale', os.environ.get('SNAPBACK4_PG_LOCALE','C'), flush=True)
    result=run(['initdb','-D',DATA,'-U','s10d3','--auth-local=trust','--auth-host=reject','--encoding=UTF8',*locale_args,*share])
    assert result.returncode==0,result.stderr
    result=run(['pg_ctl','-D',DATA,'-l',WORK/'postgres.log','-o',f'-k {WORK} -c listen_addresses= -p 55483','-w','start'])
    assert result.returncode==0,result.stderr
    cluster_started=True
    record_pid('private-postgres',int((DATA/'postmaster.pid').read_text().splitlines()[0]))
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
    change_evidence_witness(url.replace('schema=serving','schema=p1ce'))
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
    def recovery_snapshot():
        # Snapshot catalog tuples (including xmin and dropped columns), plus
        # durable row-write counters. Reads may change scan statistics only.
        return sql("""SELECT jsonb_build_object(
            'relations', (SELECT jsonb_agg(jsonb_build_array(c.xmin::text,to_jsonb(c)) ORDER BY c.oid) FROM pg_class c WHERE c.relnamespace='serving'::regnamespace),
            'columns', (SELECT jsonb_agg(jsonb_build_array(a.xmin::text,to_jsonb(a)) ORDER BY a.attrelid,a.attnum) FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid WHERE c.relnamespace='serving'::regnamespace),
            'defaults', (SELECT jsonb_agg(jsonb_build_array(d.xmin::text,to_jsonb(d)) ORDER BY d.oid) FROM pg_attrdef d JOIN pg_class c ON c.oid=d.adrelid WHERE c.relnamespace='serving'::regnamespace),
            'constraints', (SELECT jsonb_agg(jsonb_build_array(k.xmin::text,to_jsonb(k)) ORDER BY k.oid) FROM pg_constraint k WHERE k.connamespace='serving'::regnamespace),
            'writes', (SELECT jsonb_agg(jsonb_build_array(relid,n_tup_ins,n_tup_upd,n_tup_del) ORDER BY relid) FROM pg_stat_user_tables WHERE schemaname='serving'))::text""")
    # Additive columns must be refused, never repaired by normal open. Cover
    # independent core, request, outbox and identity installation paths.
    for table, column, definition in [
        ('_requests', 'cancelled', 'boolean NOT NULL DEFAULT FALSE'),
        ('_outbox', 'contract', 'text'),
        ('_backend', 'through_shortened', "text NOT NULL DEFAULT '{}'"),
        ('_session_mint_bindings', 'scope', "text NOT NULL DEFAULT 'full'"),
    ]:
        sql(f'ALTER TABLE serving.{table} DROP COLUMN {column}')
        try:
            before = recovery_snapshot()
            recovery_refuses('missing column '+column)
            assert recovery_snapshot() == before, 'recovery changed catalog or durable write counters'
            assert sql(f"SELECT count(*) FROM pg_attribute WHERE attrelid='serving.{table}'::regclass AND attname='{column}' AND NOT attisdropped") == '0'
        finally:
            sql(f'ALTER TABLE serving.{table} ADD COLUMN {column} {definition}')
    for change, restore, message in [
        ('ALTER TABLE serving._requests ALTER COLUMN cancelled DROP DEFAULT',
         'ALTER TABLE serving._requests ALTER COLUMN cancelled SET DEFAULT FALSE', 'incompatible column cancelled'),
        ('ALTER TABLE serving._requests ALTER COLUMN attempts TYPE integer',
         'ALTER TABLE serving._requests ALTER COLUMN attempts TYPE bigint', 'incompatible column attempts'),
        ('ALTER TABLE serving._head DROP CONSTRAINT _head_seq_check',
         'ALTER TABLE serving._head ADD CONSTRAINT _head_seq_check CHECK (seq>=0)', 'incompatible constraints'),
        ('DROP INDEX serving._requests_due',
         'CREATE INDEX _requests_due ON serving._requests(state,name,at,id)', 'incompatible indexes'),
    ]:
        sql(change)
        try:
            before = recovery_snapshot()
            recovery_refuses(message)
            assert recovery_snapshot() == before, 'recovery changed catalog or durable write counters'
        finally:
            sql(restore)
    print('bootstrap: missing additive columns, changed type/default/constraint/index refuse read-only; catalog and pg_stat_user_tables writes unchanged, token=0, no binding', flush=True)
    print('bootstrap: missing intent, same-target store swap, probe-only schema, missing tables/markers, generation mismatch and owner shape refuse; token=0, intent unchanged, no binding', flush=True)
    # Unknown JSON fields are accepted as input but cannot enter a binding.
    extra_intent = {**json.loads(intent), 'password': 'private-password', 'extra': {'password': 'private-password'}}
    pending.write_text(json.dumps(extra_intent))
    deploy=cli(['deploy',str(WORK/'deployment')],url=url)
    binding=json.loads((WORK/'deployment/store-binding.json').read_text())
    assert binding['store_id']==bootstrap.stdout.strip(),binding
    assert not pending.exists(), 'validated intent was not retired'
    assert set(binding) == {'store_id', 'binding'} and 'private-password' not in obstruction.read_text(), 'unknown intent fields entered binding'
    assert binding == json.loads(intent), 'validated typed identity changed during publication'
    print('recovery binding: unknown password and nested fields dropped', flush=True)
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
    assert sent['state']=='sent' and sent['seq']==1 and sent['preserved']==['notes'],sent
    replay=http(base,'POST','/m/put',payload,token)
    assert replay['replayed'] is True and replay['seq']==1,replay
    reused=http(base,'POST','/m/put',{**payload,'args':{'key':'n1','n':8}},token)
    assert reused['why']['code']=='E_ID_REUSED',reused
    page=http(base,'POST','/q/peek',{'args':{'key':'n1'}},token)
    assert page['data']['n']==7,page
    changes=http(base,'GET','/changes?after=0&wait=0',token=token)
    assert changes['preserved']==['notes'],changes
    doctor_result=cli(['doctor','--release',str(WORK/'deployment'),'--json'],url=url)
    assert 'private-password' not in doctor_result.stdout+doctor_result.stderr
    doctor=json.loads(doctor_result.stdout)
    assert doctor['store']['token']>0 and not doctor['store']['expired'],doctor
    assert doctor['certifiedChanges'] is True,doctor
    print('HTTP: guest/session, query, identified mutation, receipt replay, changes preserved=[notes]; doctor positive owner/lease',flush=True)
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
    # P1-MC: the unchanged S1 Quarry app, public deploy/serve, a native operator
    # fixture seeded through the owned Engine, and SQL used only for recounts.
    scale_source = (ROOT/'experiments/scale-controls/snapback-app/snapback/schema.q').read_bytes()
    (WORK/'app/snapback/schema.q').write_bytes(scale_source)
    scale_deployment = WORK/'scale-deployment'
    scale_url = url.replace('schema=serving', 'schema=p1mc_scale')
    deployed = cli(['deploy', str(scale_deployment), '--store-url', scale_url, '--json'])
    assert json.loads(deployed.stdout)['generation'] == 1, deployed.stdout
    binding = json.loads((scale_deployment/'store-binding.json').read_text())
    fixture = WORK/'p1mc-seed.json'
    fixture.write_text(json.dumps({'connection':connection, 'namespace':'p1mc_scale',
        'store_id':binding['store_id'], 'session_path':str(WORK/'scale-session.json')}))
    # test-postgres.sh already compiles the CLI unit-test binary. Invoke that
    # exact helper without taking Cargo's build lock while a server witness runs.
    seed_test = None
    for candidate in sorted((TARGET/'debug/deps').glob('snapback4-*'), key=lambda p:p.stat().st_mtime, reverse=True):
        if candidate.is_file() and candidate.suffix == '' and os.access(candidate,os.X_OK):
            listing = run([candidate,'--list'])
            if 'p1mc_seed_public_scale_fixture: test' in listing.stdout:
                seed_test = candidate
                break
    assert seed_test is not None, 'compile the CLI Postgres tests first (scripts/test-postgres.sh)'
    seeded = run([seed_test,'p1mc_seed_public_scale_fixture','--ignored','--nocapture'],
        cwd=ROOT,env={**ENV,'SNAPBACK4_P1MC_SEED':str(fixture)})
    assert seeded.returncode == 0, (seeded.stdout,seeded.stderr)
    scale_token = json.loads((WORK/'scale-session.json').read_text())['token']
    scale,base = start('p1mc-scale',scale_url,deployment=scale_deployment)
    page = http(base,'POST','/q/W3',{'args':{}},scale_token)
    assert sorted(row['total'] for row in page['data']) == [12,12],page
    message = http(base,'POST','/q/W1',{'args':{'message':'m000'}},scale_token)
    assert message['data']['body'] == 'small fixture payload',message
    posted = http(base,'POST','/m/post',{'id':'p1mc-post','args':{'room':'r0','body':'public post'}},scale_token)
    assert posted['state']=='sent',posted
    page = http(base,'POST','/q/W3',{'args':{}},scale_token)
    assert sorted(row['total'] for row in page['data']) == [12,13],page
    raw = sql("SELECT data FROM p1mc_scale.r ORDER BY t,id")
    images = [json.loads(line)['Row'] for line in raw.splitlines()]
    messages = [row for row in images if 'body' in row]
    for row in images:
        if 'total' in row:
            assert row['total']['Int'] == sum(m['room']['Id']==row['id']['Id'] for m in messages),row
        if 'sent' in row:
            assert row['sent']['Int'] == sum(m['sender']['Id']==row['id']['Id'] for m in messages),row
    assert len(messages)==25
    stop(scale)
    print('P1-MC PASS: unchanged S1 Quarry deploy --store-url and public serve; 24 seeded + one public post; every room/user total equals recount',flush=True)
    print('PASS public Postgres serving milestone; artifacts',WORK,flush=True)
finally:
    for child in children:
        if child.poll() is None: stop(child,signal.SIGKILL)
    if cluster_started:
        result=run(['pg_ctl','-D',str(DATA),'-m','fast','-t','180','-w','stop'],cleanup=True,timeout=190)
        status=run(['pg_ctl','-D',str(DATA),'status'],cleanup=True,timeout=10)
        assert result.returncode==0 and status.returncode==3 and not (DATA/'postmaster.pid').exists(), 'cluster stop not confirmed'
        print('owned cluster stopped and confirmed: status=3, no postmaster.pid; retained',WORK,flush=True)

#!/usr/bin/env python3
"""M1 setup, trace extraction, SQL generation, matrix runner, and aggregates.
Raw evidence stays in the caller's private directory. Requires the lane's PG16.
Use: m1-reads.py PRIVATE_DIR trace|prepare|run|summarize
"""
import datetime, hashlib, json, os, pathlib, re, shutil, subprocess, sys, time
P=pathlib.Path(sys.argv[1]).resolve()
ROOT=pathlib.Path(__file__).resolve().parents[1]
BIN=ROOT/'target/release/m1'
PGBIN=pathlib.Path.home()/'tools/pg16/usr/lib/postgresql/16/bin'
ENV=dict(os.environ,LD_LIBRARY_PATH=str(pathlib.Path.home()/'tools/pg16/usr/lib/x86_64-linux-gnu'))
# env.sh is written by the private cluster launcher, never by arbitrary input.
for k,v in re.findall(r"export (\w+)='([^']*)'",(P/'env.sh').read_text()): ENV[k]=v
ENV['M1_TCP_URL']='host=127.0.0.1 port=56541 user=sb4_eval dbname=postgres'
def guard(): assert shutil.disk_usage('/home').free>=25*1024**3,'M1 disk stop'
def sql(s):
    guard()
    return subprocess.check_output([str(PGBIN/'psql'),'-XAt','-v','ON_ERROR_STOP=1',ENV['PG_UNIX_URL'],'-c','SET search_path=sb4_eval_m1,pg_catalog; '+s],env=ENV,text=True).removeprefix('SET\n').strip()
def write(name,v): (P/name).write_text(json.dumps(v,indent=2)+'\n')
def owned():
    pid=int((P/'postmaster.pid.record').read_text()); lines=subprocess.check_output(['ps','-eo','pid,ppid,args'],text=True).splitlines()
    rec=[r.strip() for r in lines[1:] if r.split()[1]==str(pid)]
    with (P/'pids.jsonl').open('a') as f:f.write(json.dumps({'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'postmaster':pid,'children':rec})+'\n')
def spawn(args,log):
    guard();owned()
    with (P/(log+'.stdout')).open('w') as out,(P/(log+'.stderr')).open('w') as err:
        proc=subprocess.Popen([str(x) for x in args],env=ENV,stdout=out,stderr=err)
        with (P/'pids.jsonl').open('a') as f:f.write(json.dumps({'at':time.time(),'command_pid':proc.pid,'command':[str(x) for x in args]})+'\n')
        assert proc.wait()==0,log
    owned()
def trace():
    # ALTER SYSTEM must be outside a transaction block / multi-command query.
    subprocess.check_call([str(PGBIN/'psql'),'-XAt',ENV['PG_UNIX_URL'],'-c',"ALTER SYSTEM SET log_statement='all'"],env=ENV,stdout=subprocess.DEVNULL)
    sql('SELECT pg_reload_conf()');time.sleep(.2)
    spawn([BIN,'trace',P],'trace')
    subprocess.check_call([str(PGBIN/'psql'),'-XAt',ENV['PG_UNIX_URL'],'-c',"ALTER SYSTEM SET log_statement='none'"],env=ENV,stdout=subprocess.DEVNULL)
    sql('SELECT pg_reload_conf()')
    log=(P/'server.log').read_text(); log=log[log.rindex("statement: SELECT 'M1_TRACE_BEGIN'"):]
    steps={}
    for shape in ['W1','W2','W3']:
        part=log.split(f"statement: SELECT 'M1_{shape}_BEGIN'",1)[1].split(f"statement: SELECT 'M1_{shape}_END'",1)[0]
        records=re.split(r'(?m)^.*?\[(\d+)\] LOG:  (?:execute [^:]+: |statement: )',part)
        seq=[]
        for i in range(1,len(records),2):
            txt=records[i+1]; text=txt.split('\n')[0]
            # Multiline SQL continues until the next timestamped log entry.
            text=re.split(r'(?m)^\d{4}-\d\d-\d\d ',txt,1)[0].strip()
            params=[]
            detail=re.search(r'DETAIL:  parameters: (.*)',txt)
            if detail:
                pairs=re.findall(r"\$(\d+) = (NULL|'(?:[^']|'')*')(?=, \$|$)",detail.group(1))
                params=[None if v=='NULL' else v[1:-1].replace("''", "'") for _,v in pairs]
            if text.startswith(('SET search_path','SET statement_timeout','SET lock_timeout')):continue
            seq.append({'sql':text,'params':params,'pid':int(records[i])})
        assert seq,shape
        steps[shape]=seq
    write('trace.json',steps)
    print({k:len(v) for k,v in steps.items()})
def lit(s):return 'NULL' if s is None else "'"+s.replace("'","''")+"'"
def render(q):
    return re.sub(r'\$(\d+)',lambda m:lit(q['params'][int(m[1])-1]),q['sql'])
def key(s):return "(decode('06','hex')||convert_to("+s+",'UTF8')||decode('0000','hex'))"
def prepare():
    schema=json.loads((P/'schema.json').read_text())
    write('indexes.json',{t:d['indexes'] for t,d in schema['tables'].items()})
    trace=json.loads((P/'trace.json').read_text())
    # Extract the exact current authority SQL, including read-scope arms if installed.
    authority=next(q['sql'] for q in trace['W1'] if q['sql'].startswith('WITH sessions AS'))
    digest=next(q['params'][0] for q in trace['W1'] if q['sql']==authority)
    # Index names come from the real adapter trace, not guessed compiler labels.
    scans=[q for q in trace['W2'] if q['sql'].startswith('SELECT r.data, i.k')]
    member_ix=next(q['params'][1] for q in scans if q['params'][0]=='memberships')
    msg_ix=next(q['params'][1] for q in scans if q['params'][0]=='messages')
    member_view_ix=next(q['params'][1] for q in trace['W3'] if q['sql'].startswith('SELECT r.data, i.k') and q['params'][0]=='memberships')
    # r/i are the engine-created physical tables. Typed shadows copy their images.
    ddl='''
DROP TABLE IF EXISTS typed_counters,typed_messages,typed_memberships,typed_users,typed_rooms;
CREATE TABLE typed_users (id text COLLATE "C" PRIMARY KEY, principal text COLLATE "C" NOT NULL UNIQUE, sent bigint NOT NULL);
CREATE TABLE typed_rooms (id text COLLATE "C" PRIMARY KEY, total bigint NOT NULL);
CREATE TABLE typed_memberships (id text COLLATE "C" PRIMARY KEY, room text COLLATE "C" NOT NULL REFERENCES typed_rooms, principal text COLLATE "C" NOT NULL, last_read bigint NOT NULL, UNIQUE(room,principal));
CREATE INDEX ON typed_memberships(principal,room,id);
CREATE TABLE typed_messages (id text COLLATE "C" PRIMARY KEY, room text COLLATE "C" NOT NULL REFERENCES typed_rooms, sender text COLLATE "C" NOT NULL REFERENCES typed_users, at bigint NOT NULL, body text NOT NULL);
CREATE INDEX ON typed_messages(room,at,id);
CREATE INDEX ON typed_messages(sender);
CREATE TABLE typed_counters (id text COLLATE "C" PRIMARY KEY, owner text COLLATE "C", room text COLLATE "C" NOT NULL REFERENCES typed_rooms, n bigint NOT NULL);
CREATE INDEX ON typed_counters(owner,room,id);
'''
    for t in ['users','rooms','memberships','messages','counters']:
        ddl+=f'ALTER TABLE typed_{t} SET (autovacuum_enabled=false);\n'
    paths={'users':[('principal','Id'),('sent','Int')],'rooms':[('total','Int')],'memberships':[('room','Id'),('principal','Id'),('last_read','Int')],'messages':[('room','Id'),('sender','Id'),('at','Int'),('body','String')],'counters':[('owner','Id'),('room','Id'),('n','Int')]}
    for t,fields in paths.items():
        expr=["id"]+[f"(data::jsonb #>> '{{Row,{f},{tag}}}')"+('::bigint' if tag=='Int' else '') for f,tag in fields]
        ddl+=f"INSERT INTO typed_{t} SELECT {','.join(expr)} FROM r WHERE t='{t}';\n"
    (P/'typed.sql').write_text(ddl)
    start=time.monotonic();sql(ddl);copy_s=time.monotonic()-start
    # Include every metadata key touched by today's sequence, even absent clocks.
    keys=sorted({q['params'][0] for seq in trace.values() for q in seq if q['sql'].startswith('SELECT value FROM _meta WHERE')})
    extra=''.join(f",(SELECT value FROM _meta WHERE key={lit(k)}) AS meta_{i}" for i,k in enumerate(keys))
    clauses={};cells=[]
    for shape in ['W1','W2','W3']:
        target='m0000130049' if shape=='W1' else 'r0000'
        # One request's facts, independent of authorization/arithmetic in Rust.
        auth=f'WITH authority(principal,family,kind,token_digest,expires_at,scope,cap_expires_at,principal_generation,current_principal_generation,worker_family,worker_revision,family_revision,store_generation,store_id,backend_generation,schema_hash,activation_hash,device_generation,head) AS MATERIALIZED ({authority})'
        if shape in ['W1','W2']:
            room="(SELECT data::jsonb #>> '{Row,room,Id}' FROM msg)" if shape=='W1' else '$2::text'
            lo=key(room)+'||'+key('a.principal')
            mem=f"SELECT r.data,i.k FROM authority a CROSS JOIN i JOIN r ON r.t=i.t AND r.id=i.id WHERE i.t='memberships' AND i.ix={lit(member_ix)} AND i.k>=({lo}) AND i.k<({lo}||decode('ff','hex')) ORDER BY i.k LIMIT 1"
            msg="SELECT data,NULL::bytea AS k FROM r WHERE t='messages' AND id=$2" if shape=='W1' else f"SELECT r.data,i.k FROM i JOIN r ON r.t=i.t AND r.id=i.id WHERE i.t='messages' AND i.ix={lit(msg_ix)} AND i.k>={key('$2::text')} AND i.k<({key('$2::text')}||decode('ff','hex')) ORDER BY i.k DESC LIMIT 20"
            generic=f"{auth}, msg AS MATERIALIZED ({msg}), mem AS MATERIALIZED ({mem}) SELECT a.*{extra}, ARRAY(SELECT data FROM msg) AS messages, ARRAY(SELECT data FROM mem) AS memberships, ARRAY[]::text[] AS rooms FROM authority a"
            tm="SELECT * FROM typed_messages WHERE id=$2" if shape=='W1' else "SELECT * FROM typed_messages WHERE room=$2 ORDER BY at DESC,id DESC LIMIT 20"
            tr="(SELECT room FROM msg)" if shape=='W1' else '$2::text'
            typed_prefix=f"{auth}, msg AS MATERIALIZED ({tm}), mem AS MATERIALIZED (SELECT m.* FROM authority a JOIN typed_memberships m ON m.principal=a.principal WHERE m.room={tr})"
        else:
            pref=key('a.principal')
            mem=f"SELECT r.data,i.k FROM authority a CROSS JOIN i JOIN r ON r.t=i.t AND r.id=i.id WHERE i.t='memberships' AND i.ix={lit(member_view_ix)} AND i.k>={pref} AND i.k<({pref}||decode('ff','hex')) ORDER BY i.k LIMIT 32"
            rooms="SELECT r.id,r.data FROM mem m LEFT JOIN r ON r.t='rooms' AND r.id=(m.data::jsonb #>> '{Row,room,Id}') WHERE (m.data::jsonb #>> '{Row,room,Id}')!='r1024' ORDER BY m.k LIMIT 32"
            generic=f"{auth}, mem AS MATERIALIZED ({mem}), rooms AS MATERIALIZED ({rooms}) SELECT a.*{extra}, ARRAY[]::text[] AS messages, ARRAY(SELECT data FROM mem) AS memberships, ARRAY(SELECT data FROM rooms) AS rooms FROM authority a"
            typed_prefix=f"{auth}, mem AS MATERIALIZED (SELECT m.* FROM authority a JOIN typed_memberships m ON m.principal=a.principal ORDER BY m.room,m.id LIMIT 32), rooms AS MATERIALIZED (SELECT r.id,r.total FROM mem m LEFT JOIN typed_rooms r ON r.id=m.room WHERE m.room!='r1024' ORDER BY m.room,m.id LIMIT 32)"
        # Native record arrays collect each typed relation once; per-column
        # arrays pay repeated CTE scans and are retained only as a diagnostic.
        prefix=typed_prefix
        tm="ARRAY(SELECT m::typed_messages FROM msg m)" if shape!='W3' else 'ARRAY[]::typed_messages[]'
        tr="ARRAY(SELECT r::typed_rooms FROM rooms r)" if shape=='W3' else 'ARRAY[]::typed_rooms[]'
        typed=f'{prefix} SELECT a.*{extra}, {tm} AS messages, ARRAY(SELECT m::typed_memberships FROM mem m) AS memberships, {tr} AS rooms FROM authority a'
        parameters=[digest,target] if shape!='W3' else [digest]
        for variant,statement in [('generic_composed',generic),('typed_composed',typed)]:
            q={'sql':statement,'params':parameters};cells.append({'shape':shape,'variant':variant,'steps':[q]});clauses[shape+'_'+variant]=q
        cells.append({'shape':shape,'variant':'today_sequence','steps':[{k:q[k] for k in ['sql','params']} for q in trace[shape]]})
    write('queries.json',clauses);write('cells.json',cells)
    validation=validate(clauses)
    write('validation.json',validation)
    write('fixture.json',{'copy_and_ddl_s':copy_s,'metadata_keys':keys,'indexes':{'membership':member_ix,'messages':msg_ix,'viewer_membership':member_view_ix},'counts':json.loads(sql("SELECT json_object_agg(t,n) FROM (SELECT t,count(*) n FROM r GROUP BY t) s")),'relation_bytes':json.loads(sql("SELECT json_object_agg(relname,pg_total_relation_size(oid)) FROM pg_class WHERE relnamespace='sb4_eval_m1'::regnamespace AND relkind='r'"))})
    print('prepared and validated',validation)
def row(q):return json.loads(sql('SELECT row_to_json(q) FROM ('+render(q)+') q'))
def projected(g):
    out={}
    for kind in ['messages','memberships','rooms']:out[kind]=[json.loads(v)['Row'] if v else None for v in g[kind]]
    return out
def typed_rows(t):
    fields={'messages':{'id':'Id','room':'Id','sender':'Id','at':'Int','body':'String'},'memberships':{'id':'Id','room':'Id','principal':'Id','last_read':'Int'},'rooms':{'id':'Id','total':'Int'}}
    return {kind:[None if r is None or r['id'] is None else {f:{tag:r[f]} for f,tag in fields[kind].items()} for r in t[kind]] for kind in fields}
def validate(queries):
    checks=[]
    for shape in ['W1','W2','W3']:
        g=row(queries[shape+'_generic_composed']);t=row(queries[shape+'_typed_composed'])
        assert projected(g)==typed_rows(t),shape
        # Same complete authority and metadata prefix, byte-equivalent values.
        for k,v in g.items():
            if k not in ['messages','memberships','rooms']:assert t[k]==v,(shape,k)
        facts=projected(g);oracle=json.loads((P/(shape+'-oracle.json')).read_text())
        if shape=='W1':assert oracle['Row']==facts['messages'][0]
        if shape=='W2':assert oracle['Array']==[{'Row':v} for v in facts['messages']]
        if shape=='W3':
            expected=[]
            by_id={r['id']['Id']:r for r in facts['rooms']}
            for m in facts['memberships']:
                rid=m['room']['Id']
                if rid=='r1024':continue
                total=by_id[rid]['total']['Int'];expected.append({'room':{'Id':rid},'total':{'Int':total},'unread':{'Int':max(0,total-m['last_read']['Int'])}})
            assert [next(iter(v.values())) for v in oracle['Array']]==expected
        checks.append({'shape':shape,'facts_equal':True,'engine_result_equal':True,'messages':len(facts['messages']),'memberships':len(facts['memberships']),'rooms':len(facts['rooms'])})
    # Negative lookup, no authority, and nonmember facts remain distinguishable.
    for shape,target in [('W1','missing'),('W2','r0500')]:
        for v in ['generic_composed','typed_composed']:
            q=dict(queries[shape+'_'+v]);q['params']=[q['params'][0],target];r=row(q)
            facts=projected(r) if v=='generic_composed' else typed_rows(r)
            assert not facts['memberships']
            if shape=='W1':assert not facts['messages']
    for shape in ['W1','W2','W3']:
        for v in ['generic_composed','typed_composed']:
            q=dict(queries[shape+'_'+v]);q['params']=['absent-token',*q['params'][1:]];assert row(q)['principal'] is None
    return {'positive':checks,'negative':['missing message','nonmember room','absent account token'],'authority':'same raw authority prefix; no SQL authorization','W2_order':'exact ordered page equals engine result'}
def run():
    cells=json.loads((P/'cells.json').read_text())
    # Actual newly loaded relations: no optimizer-statistics/catalog reset.
    # Re-running this matrix requires a freshly created/seeded fixture.
    for state in ['fresh','analyzed']:
        if state=='fresh':
            assert sql("SELECT count(*) FROM pg_statistic WHERE starelid IN (SELECT oid FROM pg_class WHERE relnamespace='sb4_eval_m1'::regnamespace AND relname IN ('r','i','typed_users','typed_rooms','typed_memberships','typed_messages','typed_counters'))")=='0', 'fresh fixture required'
        else:sql('ANALYZE')
        write(state+'-statistics.json',json.loads(sql("SELECT json_agg(s) FROM (SELECT relname,reltuples,relpages,(SELECT count(*) FROM pg_statistic WHERE starelid=c.oid) stats_columns FROM pg_class c WHERE relnamespace='sb4_eval_m1'::regnamespace AND relkind='r' ORDER BY relname) s")))
        for mode in ['auto','force_generic_plan']:
            cfg={'plan_state':state,'plan_cache_mode':mode,'iterations':300,'explains':60,'cells':cells}
            name=state+'-'+mode;write(name+'-config.json',cfg)
            write(name+'-start.json',{'utc':datetime.datetime.now(datetime.timezone.utc).isoformat(),'loadavg':pathlib.Path('/proc/loadavg').read_text(),'free_gib':shutil.disk_usage('/home').free/1024**3})
            spawn([BIN,'measure',P/(name+'-config.json'),P/(name+'.json')],name)
            print('completed',name,flush=True)
    sql('ALTER TABLE r RESET (autovacuum_enabled); ALTER TABLE i RESET (autovacuum_enabled)')
    owned()
def summarize():
    import statistics
    rows=[]
    for state in ['fresh','analyzed']:
        for mode in ['auto','force_generic_plan']:
            raw=json.loads((P/(state+'-'+mode+'.json')).read_text())
            for c in raw['cells']:
                r={k:c[k] for k in ['shape','variant','statements']};r.update(state=state,mode=mode)
                for metric in ['server_execution_us','server_execution_timing_off_us','server_planning_us','wall_us']:
                    means=[v[metric]['mean'] for v in c['runs']];r[metric]={'median_run_mean':statistics.median(means),'min_run_mean':min(means),'max_run_mean':max(means),'worst_p99':max(v[metric]['p99'] for v in c['runs'])}
                r['plain_pg_stat_statements_server_us']=[v['plain_pg_stat_statements_server_us'] for v in c['runs']];r['payload_bytes']=c['runs'][0]['payload_bytes'];r['data_row_wire_bytes']=c['runs'][0]['data_row_wire_bytes']
                r['loadavg']=[{k:v[k] for k in ['loadavg_before','loadavg_after']} for v in c['runs']]
                r['first_wall_us']=[v['first_wall_us'] for v in c['runs']]
                rows.append(r)
    write('summary.json',{'cells':rows,'fixture':json.loads((P/'fixture.json').read_text()),'validation':json.loads((P/'validation.json').read_text())})
    for r in rows:print(r['state'],r['mode'],r['shape'],r['variant'],*(round(r[k]['median_run_mean'],2) for k in ['server_execution_us','wall_us']),r['payload_bytes'])
if __name__=='__main__':globals()[sys.argv[2]]()

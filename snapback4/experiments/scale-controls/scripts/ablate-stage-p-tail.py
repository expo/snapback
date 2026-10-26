#!/usr/bin/env python3
# @ref LLP 3000.009.001.000.000.002#3.11 — synthetic rollback-only marginal tail costs, not S1.
"""Tail ablation, isolated database in the owned Stage P PG16 cluster.
Synthetic million-row cardinality control; each attempt rolls back. Not S1.
"""
import argparse,json,os,pathlib,subprocess as sp,time,random,sys,re
repo=pathlib.Path(__file__).resolve().parents[4]
p=argparse.ArgumentParser(description=__doc__)
p.add_argument('--socket',required=True,type=pathlib.Path)
p.add_argument('--port',type=int,default=55473)
p.add_argument('--database',default='stp_micro')
p.add_argument('--out',required=True,type=pathlib.Path)
p.add_argument('--repeats',type=int,default=8)
p.add_argument('--batches',type=int,default=1000)
p.add_argument('--resume',action='store_true')
a=p.parse_args()
if a.port==55440:p.error('port 55440 is outside this experiment')
if not a.socket.is_absolute() or not a.socket.is_dir():p.error('socket must name a private local socket directory')
if not re.fullmatch(r'[a-z][a-z0-9_]{0,62}',a.database):p.error('database must be a simple lowercase identifier')
if repo in a.out.resolve().parents:p.error('raw output must be outside Git')
if min(a.repeats,a.batches)<1:p.error('repeats and batches must be positive')
out=a.out.resolve();out.mkdir(parents=True)
pg=pathlib.Path.home()/'tools/pg16/usr/lib/postgresql/16/bin'
env=dict(os.environ,PGHOST=str(a.socket),PGPORT=str(a.port),PGUSER=os.environ.get('PGUSER','sb4_eval'),PGDATABASE='postgres',LD_LIBRARY_PATH=str(pathlib.Path.home()/'tools/pg16/usr/lib/x86_64-linux-gnu'))
def sql(q,name):
 with (out/(name+'.log')).open('w') as f:
  p=sp.Popen([str(pg/'psql'),'-XqAt','-v','ON_ERROR_STOP=1'],env=env,stdin=sp.PIPE,stdout=f,stderr=sp.STDOUT,text=True)
  with (out/'pids.jsonl').open('a') as l:l.write(json.dumps(dict(pid=p.pid,name=name))+'\n')
  p.communicate(q);code=p.returncode
 if code:raise RuntimeError(f'{name}: {code}')
 return (out/(name+'.log')).read_text().strip()
def literal(v,ty):
 if v is None:return 'NULL::pg_catalog.'+ty
 if isinstance(v,bool):return 'true' if v else 'false'
 if isinstance(v,int):return str(v)
 return "'"+v.replace("'","''")+"'::pg_catalog."+ty
if not a.resume:sql('CREATE DATABASE '+a.database,'create-db')
env['PGDATABASE']=a.database
if not a.resume:sql("""CREATE EXTENSION pg_stat_statements;CREATE SCHEMA bench;SET search_path=bench,pg_catalog;
CREATE TABLE r(t text,id text,data text,PRIMARY KEY(t,id));
CREATE TABLE _head(singleton bool PRIMARY KEY,seq bigint,revision bigint,attempt text COLLATE "C");INSERT INTO _head VALUES(true,5000,5000,'0:0');
CREATE TABLE _commits(seq bigint PRIMARY KEY,at bigint,program text,principal text,kind text,touched text,writes bigint);
CREATE TABLE _change_evidence(seq bigint PRIMARY KEY,footprint text);INSERT INTO _change_evidence SELECT s,'{}' FROM generate_series(4001,5000)s;
CREATE TABLE _log(partition text,seq bigint,ord bigint,t text,kind text,id text,data text,PRIMARY KEY(partition,seq,ord));
CREATE TABLE _outbox(id text PRIMARY KEY,seq bigint,effect text,payload text,state text,attempts int,at bigint,next_at bigint,work_spec text,deadline bigint,contract text,release text);
CREATE TABLE _effect_presence(principal text,id text,deadline bigint,PRIMARY KEY(principal,id));
CREATE TABLE _ops(principal text,id text,seq bigint,outcome text,name text,args_digest text,at bigint,PRIMARY KEY(principal,id));
CREATE TABLE _meta(key text PRIMARY KEY,value text);
INSERT INTO r SELECT 'messages','m'||s,'{}' FROM generate_series(1,1000000)s;
INSERT INTO r SELECT 'counters','c'||s,'{}' FROM generate_series(0,31)s;ANALYZE;
""",'fixture')
payload=dict(images=[dict(t='counters',id='c'+str(i),data='{"Row":{"id":{"Id":"c'+str(i)+'"},"n":{"Int":1}}}') for i in range(11)],commits=[dict(seq=5001+i,at=1000,program='increment',principal='bench:'+str(i),kind='mutation',touched='["counters"]',writes=1,footprint='{"tables":["counters"]}') for i in range(11)],log=[],effects=[],presence=[],receipts=[])
source=sp.check_output(['git','show','5fc6e6449b:snapback4/crates/snapback4-core/src/engine/postgres/group_tail.rs'],cwd=repo,text=True)
body=source.split('r#"),\nimages AS (',1)[1].split('"#, $publication)',1)[0]
generic='WITH head AS (UPDATE _head SET seq=$3,revision=$4,attempt=$5 WHERE singleton AND seq=$2 AND revision=$6 AND attempt=$7 RETURNING seq),\nimages AS ('+body
variants={}
variants['json-all-prune']=(generic,['text','int8','int8','int8','text','int8','text'],[literal(json.dumps(payload,separators=(',',':')),'text'),'5000','5011','5011',"'0:1'",'5000',"'0:0'"])
def typed(sparse,prune,compact=False):
 types=['int8','int8','int8','text','int8','text'];values=['5000','5011','5011',"'0:1'",'5000',"'0:0'"]
 def columns(rows,fields):
  args=[]
  for key,ty in fields:
   if compact:
    types.append('text');args.append(f'${len(types)}::pg_catalog.text::pg_catalog.{ty}[]')
    def element(v):
     if v is None:return 'NULL'
     v=str(v).lower() if isinstance(v,bool) else str(v)
     return '"'+v.replace('\\','\\\\').replace('"','\\"')+'"'
    values.append(literal('{'+','.join(element(r[key]) for r in rows)+'}','text'))
   else:
    types.append(ty+'[]');args.append(f'${len(types)}::pg_catalog.{ty}[]');values.append('ARRAY['+','.join(literal(r[key],ty) for r in rows)+']::pg_catalog.'+ty+'[]')
  return ','.join(args)
 ctes=["input AS (SELECT $1::int8 AS first,$2::int8 AS last,$3::int8 AS revision,$4::text AS attempt,$5::int8 AS previous_revision,$6::text AS previous_attempt)","head AS (UPDATE _head SET seq=input.last,revision=input.revision,attempt=input.attempt FROM input WHERE singleton AND seq=input.first AND _head.revision=input.previous_revision AND _head.attempt=input.previous_attempt RETURNING _head.seq,_head.revision)"]
 args=columns(payload['images'],[('t','text'),('id','text'),('data','text')]);ctes.append(f'images AS (UPDATE r SET data=w.data FROM unnest({args}) AS w(t,id,data) CROSS JOIN head WHERE r.t=w.t AND r.id=w.id RETURNING r.id)')
 args=columns(payload['commits'],[(k,'int8' if k in ['seq','at','writes'] else 'text') for k in ['seq','at','program','principal','kind','touched','writes','footprint']]);ctes.extend([f'commits_input AS MATERIALIZED (SELECT * FROM unnest({args}) AS c(seq,at,program,principal,kind,touched,writes,footprint))','committed AS (INSERT INTO _commits(seq,at,program,principal,kind,touched,writes) SELECT c.seq,c.at,c.program,c.principal,c.kind,c.touched,c.writes FROM commits_input c CROSS JOIN head RETURNING seq)','evidence AS (INSERT INTO _change_evidence(seq,footprint) SELECT c.seq,c.footprint FROM commits_input c JOIN committed USING(seq) RETURNING seq)'])
 if prune:ctes.append('pruned AS (DELETE FROM _change_evidence WHERE seq>$1-1000 AND seq<=$2-1000 AND EXISTS(SELECT 1 FROM committed))')
 if not sparse:
  args=columns([],[(k,'int8' if k in ['seq','ord'] else 'text') for k in ['seq','partition','ord','t','kind','id','data']]);ctes.append(f'logged AS (INSERT INTO _log(partition,seq,ord,t,kind,id,data) SELECT l.partition,l.seq,l.ord,l.t,l.kind,l.id,l.data FROM unnest({args}) AS l(seq,partition,ord,t,kind,id,data) JOIN committed USING(seq) RETURNING seq)')
  args=columns([],[(k,'int8' if k in ['seq','at','next_at','deadline'] else 'bool' if k=='explicit_release' else 'text') for k in ['seq','at','id','effect','payload','next_at','work','deadline','contract','explicit_release','release']]);ctes.append(f"effects AS (INSERT INTO _outbox(id,seq,effect,payload,state,attempts,at,next_at,work_spec,deadline,contract,release) SELECT e.id,e.seq,e.effect,e.payload,'queued',0,e.at,e.next_at,e.work,e.deadline,e.contract,CASE WHEN e.explicit_release THEN e.release ELSE (SELECT value FROM _meta WHERE key='release') END FROM unnest({args}) AS e(seq,at,id,effect,payload,next_at,work,deadline,contract,explicit_release,release) JOIN committed USING(seq) RETURNING id)")
  args=columns([], [('principal','text'),('id','text'),('deadline','int8')]);ctes.append(f'presence AS (INSERT INTO _effect_presence(principal,id,deadline) SELECT p.principal,p.id,p.deadline FROM unnest({args}) AS p(principal,id,deadline) JOIN effects USING(id) RETURNING id)')
  args=columns([],[(k,'int8' if k in ['seq','at'] else 'text') for k in ['seq','principal','id','outcome','name','args_digest','at']]);ctes.append(f'receipts AS (INSERT INTO _ops(principal,id,seq,outcome,name,args_digest,at) SELECT r.principal,r.id,r.seq,r.outcome,r.name,r.args_digest,r.at FROM unnest({args}) AS r(seq,principal,id,outcome,name,args_digest,at) CROSS JOIN head RETURNING id)')
 counts=['(SELECT count(*) FROM '+k+')' for k in ['head','committed','evidence']]+(['0::int8']*4 if sparse else ['(SELECT count(*) FROM '+k+')' for k in ['logged','effects','presence','receipts']])+['(SELECT count(*) FROM images)']
 return 'WITH '+','.join(ctes)+' SELECT '+','.join(counts),types,values
variants['arrays-all-prune']=typed(False,True);variants['arrays-sparse-prune']=typed(True,True);variants['arrays-sparse-no-prune']=typed(True,False);variants['compact-arrays-sparse-no-prune']=typed(True,False,True)
results=[]
for repeat in range(a.repeats):
 order=list(variants);random.Random(19+repeat).shuffle(order)
 for name in order:
  query,types,values=variants[name];execute='EXECUTE stp_tail('+','.join(values)+');'
  script="SET search_path=bench,pg_catalog;SET plan_cache_mode=force_generic_plan;VACUUM ANALYZE;PREPARE stp_tail("+','.join('pg_catalog.'+t for t in types)+") AS "+query+";\nSELECT public.pg_stat_statements_reset();SELECT 'CPU_START '||pg_read_file('/proc/self/stat',0,4096);BEGIN;SAVEPOINT attempt;\n"+('\n'.join(execute+'ROLLBACK TO SAVEPOINT attempt;' for _ in range(a.batches)))+"\nROLLBACK;SELECT 'CPU_END '||pg_read_file('/proc/self/stat',0,4096);\n"+"SELECT json_build_object('calls',calls,'exec_ms',total_exec_time,'plan_ms',total_plan_time)::text FROM public.pg_stat_statements WHERE dbid=(SELECT oid FROM pg_database WHERE datname=current_database()) AND query LIKE '%INSERT INTO _commits%' AND query NOT LIKE 'SELECT%' AND calls>0;"
  s=sql(script,f'{repeat}-{name}');counts=s.splitlines().count('1|11|11|0|0|0|0|11');assert counts==a.batches,(name,counts)
  rows=[json.loads(v) for v in s.splitlines() if v.startswith('{')];assert len(rows)==1,rows
  cpu=[line.split(' ',1)[1].rsplit(')',1)[1].split() for line in s.splitlines() if line.startswith(('CPU_START ','CPU_END '))];assert len(cpu)==2,cpu
  cpu_ms=((int(cpu[1][11])+int(cpu[1][12]))-(int(cpu[0][11])+int(cpu[0][12])))*1000/os.sysconf('SC_CLK_TCK')
  v=rows[0];v.update(backend_cpu_ms_per_batch=cpu_ms/a.batches,repeat=repeat,variant=name,ms_per_batch=(v['exec_ms']+v['plan_ms'])/v['calls'],count_checks=counts);results.append(v);print(json.dumps(v),flush=True)
(out/'results.json').write_text(json.dumps(dict(rows=1000000,batch_size=11,attempts=a.batches,synthetic=True,forced_generic_plan=True,results=results),indent=2)+'\n')
(out/'cleanup.json').write_text(json.dumps(dict(living=[]))+'\n')

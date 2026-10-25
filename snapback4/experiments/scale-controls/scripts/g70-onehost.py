#!/usr/bin/env python3
"""G7.0 private one-host campaign. Reuses S1 lifecycle, links and pinning.

Raw output must be outside Git. No product source/configuration mutation.
"""
import argparse
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import random
import shutil
import signal
import subprocess as sp
import sys
import threading
import time

HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('onehost',HERE/'s1-onehost.py')
oh=importlib.util.module_from_spec(spec);spec.loader.exec_module(oh)
import run


def write(path,value):
    path.write_text(json.dumps(value,indent=2)+'\n')


def disk():
    free=shutil.disk_usage('/home').free
    if free<25*1024**3:raise RuntimeError('/home below 25 GiB')
    return free


class Sampler:
    def __init__(self,r,output):
        self.r=r;self.output=output;self.stop=threading.Event();self.samples=[]
    def sample(self):
        table=oh.processes();master=self.r.master[0].pid
        row=dict(time=time.monotonic(),loadavg=Path('/proc/loadavg').read_text().strip(),free_bytes=disk(),processes={},threads={})
        roots={p.pid for p in self.r.started if p.poll() is None}
        roots.add(os.getpid())
        owned=set(roots)
        while True:
            extra={pid for pid,s in table.items() if s['ppid'] in owned}-owned
            if not extra:break
            owned|=extra
        for pid,s in table.items():
            if pid in owned:
                role='PG' if pid==master or s['ppid']==master else 'app'
                row['processes'][str(pid)]={**s,'role':role}
                try:
                    for task in Path(f'/proc/{pid}/task').iterdir():
                        f=(task/'stat').read_text().rsplit(')',1)[1].split()
                        row['threads'][task.name]=dict(pid=pid,ticks=int(f[11])+int(f[12]),cpus=sorted(os.sched_getaffinity(int(task.name))),role=role)
                except (OSError,ProcessLookupError):pass
        return row
    def start(self):
        def loop():
            while not self.stop.wait(.1):self.samples.append(self.sample())
        self.samples.append(self.sample());self.thread=threading.Thread(target=loop,daemon=True);self.thread.start()
    def close(self):
        self.stop.set();self.thread.join();self.samples.append(self.sample());write(self.output,self.samples)
        ticks={'PG':0,'app':0,'client':0};hz=os.sysconf('SC_CLK_TCK')
        for a,b in zip(self.samples,self.samples[1:]):
            for tid,s in b['threads'].items():
                old=a['threads'].get(tid)
                if not old or old['pid']!=s['pid']:continue
                role='PG' if s['role']=='PG' else ('client' if s['cpus']==[5,11] else 'app')
                ticks[role]+=max(0,s['ticks']-old['ticks'])
        duration=self.samples[-1]['time']-self.samples[0]['time']
        return {k:v/hz/duration for k,v in ticks.items()}


def cmd(r,command,out,env=None,cpus=oh.APP_CORES,timeout=1800):
    with (out.with_suffix('.stdout')).open('x') as stdout,(out.with_suffix('.stderr')).open('x') as stderr:
        p=sp.Popen(['taskset','-c',cpus,*map(str,command)],env=env or r.env,stdout=stdout,stderr=stderr)
        try:
            p.wait(timeout=timeout)
            if p.returncode:raise RuntimeError(f'{out.name} exited {p.returncode}')
        finally:
            if p.poll() is None:p.terminate();p.wait(timeout=10)
    return p


def harness_trial(r,args,directory,arm,n,connections,depth,rep,warm=None,seconds=None,log_one=False,rate=0):
    directory.mkdir(parents=True,exist_ok=True)
    stem=directory/f'r{rep}'
    cmd(r,[args.binary,'reset'],directory/f'reset-r{rep}')
    r.host_check(str(stem))
    sampler=Sampler(r,stem.with_suffix('.cpu.json'));sampler.start()
    trial_env=dict(r.env,G70_TRACE=str(stem.with_suffix('.batches.jsonl')))
    if log_one:trial_env['G70_LOG_ONE']='1'
    try:cmd(r,[args.binary,'run','--arm',arm,'--n',n,'--connections',connections,'--depth',depth,'--warmup',warm if warm is not None else args.warmup,'--seconds',seconds if seconds is not None else args.seconds,'--rate',rate],stem,env=trial_env,cpus=oh.LOAD_CORES,timeout=120)
    finally:cpu=sampler.close()
    result=json.loads(stem.with_suffix('.stdout').read_text().splitlines()[-1]);result.update(cpu=cpu,repeat=rep,link=r.g70_link)
    write(stem.with_suffix('.json'),result)
    print(f'{r.g70_link} {arm}/d{depth}/n{n}/c{connections} r{rep}: {result["writes_per_s"]:.0f}/s mean={result["latency_ms"]["mean"]:.2f}ms sync/b={result["syncs_per_batch"]:.3f}',flush=True)
    return result


def verify_crash(r,n):
    sql="""SELECT jsonb_build_object('head',(SELECT seq-1000000 FROM sb4_eval_g70._head),
    'revision',(SELECT revision-1000000 FROM sb4_eval_g70._head),'commits',(SELECT count(*) FROM sb4_eval_g70._commits WHERE seq>1000000),
    'max',(SELECT coalesce(max(seq),1000000)-1000000 FROM sb4_eval_g70._commits),
    'logs',(SELECT count(*) FROM sb4_eval_g70._log),
    'counter_sum',(SELECT sum((data::jsonb->'Row'->'n'->>'Int')::bigint) FROM sb4_eval_g70.r WHERE t='counters'),
    'bad_counters',(SELECT count(*) FROM sb4_eval_g70.r r WHERE t='counters' AND (data::jsonb->'Row'->'n'->>'Int')::bigint<>(SELECT count(*) FROM sb4_eval_g70._commits c WHERE c.seq>1000000 AND c.principal='bench:'||(substring(r.id,2)::int)::text)),
    'partial_batches',(SELECT count(*) FROM (SELECT (seq-1000001)/%d FROM sb4_eval_g70._commits WHERE seq>1000000 GROUP BY 1 HAVING count(*)<>%d) b))"""%(n,n)
    return json.loads(r.sqlpg(sql,'g70'))


def crash_trial(r,args,index,depth,n,connections,rng):
    disk();directory=r.out/'crash'/f'{index:03}-d{depth}-n{n}-c{connections}';directory.mkdir(parents=True)
    cmd(r,[args.binary,'reset'],directory/'reset')
    ack=directory/'acks.jsonl';env=dict(r.env,G70_ACK=str(ack))
    stdout=(directory/'client.stdout').open('x');stderr=(directory/'client.stderr').open('x')
    p=sp.Popen(['taskset','-c',oh.LOAD_CORES,str(args.binary),'run','--arm','E','--n',str(n),'--connections',str(connections),'--depth',str(depth),'--warmup','0','--seconds','60'],env=env,stdout=stdout,stderr=stderr)
    deadline=time.monotonic()+15
    while not (directory/'client.stdout').stat().st_size:
        if p.poll() is not None or time.monotonic()>deadline:raise RuntimeError('crash client readiness failed')
        time.sleep(.005)
    delay=rng.uniform(.002,.250);time.sleep(delay)
    # Record each current PG child before intentional postmaster SIGKILL.
    master=r.master[0];snapshot=oh.processes()
    children=[s for s in snapshot.values() if s['ppid']==master.pid]
    for child in children:oh.append(r.out/'all-pids.jsonl',dict(**child,kind='crash-child',time=time.time()))
    old_identity=oh.identity(master.pid);assert old_identity
    master.kill();master.wait(timeout=5)
    # The postmaster death pipe makes its backends abort; never restart while
    # an old recorded backend can still commit.
    deadline=time.monotonic()+15
    while any(oh.live(s) for s in children):
        if time.monotonic()>deadline:raise RuntimeError('old crash backends did not end')
        time.sleep(.05)
    try:p.wait(timeout=2)
    except sp.TimeoutExpired:p.terminate();p.wait(timeout=5)
    stdout.close();stderr.close()
    ack_rows=[json.loads(l) for l in ack.read_text().splitlines()] if ack.exists() else []
    # Stale socket/pid files are owned by the killed cluster. PostgreSQL does
    # its ordinary stale-postmaster recovery; no durability setting changes.
    r.master=r.spawn(['taskset','-c',oh.PG_CORES,oh.PGBIN/'postgres','-D',r.runtime/'pg'],directory,'restart-postgres')
    r.record(r.master[0],'postgres-master-restart')
    deadline=time.monotonic()+60
    while True:
        q=sp.run([str(oh.PGBIN/'psql'),'-XqAt','-d','g70','-c','SELECT 1'],env=r.env,capture_output=True,text=True)
        if q.returncode==0:break
        if r.master[0].poll() is not None or time.monotonic()>deadline:raise RuntimeError('crash recovery failed')
        time.sleep(.05)
    recovered=verify_crash(r,n);ack_hi=max((s['hi'] for s in ack_rows),default=0)
    assert recovered['head']==recovered['revision']==recovered['commits']==recovered['max']==recovered['counter_sum'],recovered
    assert recovered['logs']==0
    assert not recovered['bad_counters'] and not recovered['partial_batches'] and ack_hi<=recovered['head']
    value=dict(index=index,depth=depth,n=n,connections=connections,link=r.g70_link,delay_s=delay,ack_batches=len(ack_rows),ack_hi=ack_hi,recovered=recovered,old_postmaster=old_identity,old_children_ended=True,acknowledged_lost=0,prefix_ok=True)
    write(directory/'result.json',value);print(f'crash {index}: d{depth} n{n} ack_hi={ack_hi} recovered={recovered["head"]} prefix=OK',flush=True)
    return value


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('--out',required=True);p.add_argument('--binary',required=True)
    p.add_argument('--harness',default=str(Path.home()/'projects/sb4-s1sk/snapback4/target/s1-wd/release/sb4-scale-controls'))
    p.add_argument('--warmup',type=float,default=1);p.add_argument('--seconds',type=float,default=4);p.add_argument('--repeats',type=int,default=3)
    p.add_argument('--fixture-cache',type=Path);p.add_argument('--smoke',action='store_true');p.add_argument('--crashes',type=int,default=36)
    args=p.parse_args();args.binary=Path(args.binary).resolve()
    a=argparse.Namespace(system='supabase',out=args.out,harness=args.harness,snapback_bin='',seed_bin='',warmup_ms=10000,duration_ms=20000,repeats=3,extra_read_rates=[],max_rate=3200,rates=[3200],rows=1000000,load_cores=oh.LOAD_CORES,target='supabase')
    r=oh.make_runner(oh.configure(a))(a);all_results=[];crashes=[]
    def interrupt(sig,frame):raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,interrupt)
    try:
        r.start()
        source=[Path(__file__),Path(__file__).parents[2]/'postgres-commit-path/src/bin/g70.rs',Path(__file__).parents[2]/'postgres-commit-path/src/g70_fixture.rs',Path(__file__).parents[3]/'crates/snapback4-core/src/engine/postgres/group_tail.rs',Path(__file__).parents[3]/'crates/snapback4-core/src/engine/postgres/batch.rs']
        write(r.out/'g70-provenance.json',dict(binary_sha256=hashlib.sha256(args.binary.read_bytes()).hexdigest(),source_sha256={str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in source},command=sys.argv))
        r.sqlpg('CREATE DATABASE g70');r.sqlpg('CREATE EXTENSION pg_stat_statements','g70')
        r.env.update(G70_DIRECT=f'host={r.upstream} port={oh.PGPORT} user=sb4scale dbname=g70',G70_LINK=f'host={r.socket} port={oh.PGPORT} user=sb4scale dbname=g70')
        r.db='g70';r.env['SCALE_DATABASE']='g70'
        fixture_source=Path(__file__).parents[2]/'postgres-commit-path/src/g70_fixture.rs'
        cache=args.fixture_cache or Path.home()/'sb4scale'/('g70-fixture-'+hashlib.sha256(fixture_source.read_bytes()).hexdigest()[:12]+'.dump')
        if cache.exists():
            cmd(r,[oh.PGBIN/'pg_restore','-d','g70','--no-owner',cache],r.out/'g70-restore')
            r.sqlpg('VACUUM ANALYZE','g70')
        else:
            cmd(r,[args.binary,'setup'],r.out/'g70-setup')
            cmd(r,[oh.PGBIN/'pg_dump','-Fc','-d','g70','-f',cache],r.out/'g70-fixture-cache')
        cmd(r,[args.binary,'history'],r.out/'g70-history')
        write(r.out/'fixture-cache.json',dict(path=str(cache),sha256=hashlib.sha256(cache.read_bytes()).hexdigest()))
        pre=r.out/'preflight';pre.mkdir();r.g70_link='A';r.ping(500,pre/'rtt-before.json')
        for rate in [1000,8000]:harness_trial(r,args,pre/f'openloop-{rate}','E',16,2,2,0,.2,1,rate=rate)
        r.ping(500,pre/'rtt-after.json')
        configurations=[('serial',1,c) for c in (1,2,3)]+[('S',2,c) for c in (1,2,3)]+[('E',d,c) for d in (1,2) for c in (1,2,3)]+[('C',c,c) for c in (2,3,4)]
        if args.smoke:configurations=[('serial',1,1),('S',2,2),('E',1,1),('E',2,2),('C',3,3)]
        for link,delay in [('A',500),('B',1000)]:
            r.g70_link=link;linkdir=r.out/link;linkdir.mkdir();r.ping(delay,linkdir/'rtt-before.json')
            for arm,depth,connections in configurations:
                for n in ([16] if args.smoke else [8,16,32]):
                    for rep in range(1 if args.smoke else args.repeats):
                        all_results.append(harness_trial(r,args,linkdir/f'{arm}-d{depth}-n{n}-c{connections}',arm,n,connections,depth,rep))
            r.ping(delay,linkdir/'rtt-after.json')
        # Repeat the strongest measured configuration of each arm/link with
        # 10s/20s windows; no replacement of short-trial failures.
        if not args.smoke:
            for link,delay in [('A',500),('B',1000)]:
                r.g70_link=link;d=r.out/f'long-{link}';d.mkdir();r.ping(delay,d/'rtt-before.json')
                for arm,required_depth in [('serial',None),('S',None),('E',1),('E',2),('C',None)]:
                    candidates=[x for x in all_results if x['link']==link and x['arm']==arm and (required_depth is None or x['depth']==required_depth)]
                    keys={(x['n'],x['connections'],x['depth']) for x in candidates}
                    key=max(keys,key=lambda k:sum(x['writes_per_s'] for x in candidates if (x['n'],x['connections'],x['depth'])==k)/args.repeats)
                    n,c,depth=key
                    for rep in range(3):harness_trial(r,args,d/f'{arm}-d{depth}-n{n}-c{c}',arm,n,c,depth,rep,10,20,rate=4525 if link=='A' else 2262)
                r.ping(delay,d/'rtt-after.json')
            # The actual online-only W4 tail logs zero rows. Separately retain
            # one-log-row-per-write sensitivity at each N, using the best
            # primary connection configuration for that N.
            for link,delay in [('A',500),('B',1000)]:
                r.g70_link=link;d=r.out/f'logged-{link}';d.mkdir();r.ping(delay,d/'rtt-before.json')
                for arm in ['serial','S','E','C']:
                    for n in [8,16,32]:
                        candidates=[x for x in all_results if x['link']==link and x['arm']==arm and x['n']==n]
                        keys={(x['connections'],x['depth']) for x in candidates}
                        c,depth=max(keys,key=lambda k:sum(x['writes_per_s'] for x in candidates if (x['connections'],x['depth'])==k)/args.repeats)
                        for rep in range(3):harness_trial(r,args,d/f'{arm}-d{depth}-n{n}-c{c}',arm,n,c,depth,rep,log_one=True)
                r.ping(delay,d/'rtt-after.json')
        # Random, pre-seeded crash timings span both links, all batch sizes,
        # depths and one/two/three connections. The client is never SIGKILLed.
        rng=random.Random(0x670)
        for index in range(2 if args.smoke else args.crashes):
            link='A' if index%2==0 else 'B';delay=500 if link=='A' else 1000
            r.g70_link=link;d=r.out/f'crash-link-{index}';d.mkdir();r.ping(delay,d/'rtt-before.json')
            crashes.append(crash_trial(r,args,index,1+(index//2)%2,[8,16,32][(index//4)%3],1+(index//12)%3,rng))
        write(r.out/'crash-settings.json',r.sqlpg("SELECT jsonb_object_agg(name,setting) FROM pg_settings WHERE name IN ('fsync','synchronous_commit','full_page_writes','wal_sync_method')",'g70'));
        write(r.out/'harness-aggregate.json',all_results);write(r.out/'crash-aggregate.json',crashes)
        # Reuse the complete unchanged HTTP runner for the control comparison.
        r.db=None;r.sqlpg('DROP DATABASE g70','postgres');r.fixture(1000000)
        for link,delay in [('A',500),('B',1000)]:
            d=r.out/f'supabase-{link}';d.mkdir();r.ping(delay,d/'rtt-before.json');r.start_service(32,delay,d);r.before_trials(d,'W4',32,'disjoint',1000000)
            for rate in ([3200] if link=='A' else [1600,3200]):
                for rep in range(3):r.trial(d,'W4',32,'disjoint',1000000,rate,rep)
            r.stop_service();r.ping(delay,d/'rtt-after.json')
    finally:
        r.close()
        # Runtime tokens/configuration are private and never included in archive.
        private=str(r.runtime);shutil.rmtree(r.runtime)
        write(r.out/'private-cleanup.json',dict(path=private,removed=not Path(private).exists()))
    print('G70 COMPLETE; owned services stopped',flush=True)


if __name__=='__main__':main()

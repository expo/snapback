#!/usr/bin/env python3
"""C0′ on the unchanged private S1 PG16 lifecycle, delayed link, and CPU pins.
The sweep uses G7.0's 1s/4s screening windows, at the target open-loop rate;
strongest configurations get three unchanged S1 10s/20s confirmations.
"""
import argparse,base64,hashlib,importlib.util,json,os,random,shutil,signal,subprocess as sp,sys,time
from pathlib import Path
HERE=Path(__file__).resolve().parent
spec=importlib.util.spec_from_file_location('g70',HERE/'g70-onehost.py');g=importlib.util.module_from_spec(spec);spec.loader.exec_module(g)
oh=g.oh

def write(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
def trial(r,a,d,arm,n,k,h,rep,warm,seconds):
    d.mkdir(parents=True,exist_ok=True);stem=d/f'r{rep}'
    g.cmd(r,[a.binary,'reset'],d/f'reset-r{rep}')
    r.host_check(str(stem));sampler=g.Sampler(r,stem.with_suffix('.cpu.json'));sampler.start()
    env=dict(r.env,C0_TRACE=str(stem.with_suffix('.batches.jsonl')))
    try:g.cmd(r,[a.binary,'run','--arm',arm,'--n',n,'--k',k,'--hold-ms',h,'--rate',4525 if r.g70_link=='A' else 2262,'--samples',a.samples/f'{"E" if arm=="OC" else "S"}-{r.g70_link}.json','--seed',0xC000+rep,'--warmup',warm,'--seconds',seconds,*(['--prefix-hammer'] if a.smoke else [])],stem,env=env,cpus=oh.LOAD_CORES,timeout=120)
    finally:cpu=sampler.close()
    v=json.loads(stem.with_suffix('.stdout').read_text().splitlines()[-1]);v.update(cpu=cpu,link=r.g70_link,repeat=rep,phase='confirmation' if warm==10 and seconds==20 else 'sweep');write(stem.with_suffix('.json'),v)
    print(f'{v["phase"]} {r.g70_link} {arm} N{n} K{k} h{h} r{rep}: {v["writes_per_s"]:.0f}/s mean={v["client_ms"]["mean"]:.2f} intended-p99={v["intended_ms"]["p99"]:.2f} errors={v["error_fraction"]:.3%} pass={v["slo_pass"]}',flush=True)
    return v

def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--out',type=Path,required=True);p.add_argument('--binary',type=Path,required=True);p.add_argument('--samples',type=Path,required=True)
    p.add_argument('--harness',default=str(Path.home()/'sb4scale/g70-final-20261025/binaries/sb4-scale-controls'))
    p.add_argument('--smoke',action='store_true');p.add_argument('--fixture-cache',type=Path);a=p.parse_args();a.binary=a.binary.resolve()
    # User's lane-specific 25 GiB stop overrides the older common runner's 30.
    def disk(out):oh.append(out/'disk.jsonl',dict(time=time.time(),free_bytes=g.disk()))
    oh.disk=disk
    ns=argparse.Namespace(system='supabase',out=str(a.out),harness=a.harness,snapback_bin='',seed_bin='',warmup_ms=10000,duration_ms=20000,repeats=3,extra_read_rates=[],max_rate=4525,rates=[4525],rows=1000000)
    r=oh.make_runner(oh.configure(ns))(ns);results=[]
    def interrupt(sig,frame):raise KeyboardInterrupt
    signal.signal(signal.SIGTERM,interrupt)
    try:
        r.start();r.sqlpg('CREATE DATABASE g70');r.sqlpg('CREATE EXTENSION pg_stat_statements','g70');r.db='g70';r.env['SCALE_DATABASE']='g70'
        r.env.update(G70_DIRECT=f'host={r.upstream} port={oh.PGPORT} user=sb4scale dbname=g70',G70_LINK=f'host={r.socket} port={oh.PGPORT} user=sb4scale dbname=g70')
        cache=a.fixture_cache or Path.home()/'sb4scale/c0-fixture-20261026.dump'
        if cache.exists():g.cmd(r,[oh.PGBIN/'pg_restore','-d','g70','--no-owner',cache],r.out/'fixture-restore')
        else:
            g.cmd(r,[a.binary,'fixture'],r.out/'fixture-setup')
            g.cmd(r,[oh.PGBIN/'pg_dump','-Fc','-d','g70','-f',cache],r.out/'fixture-dump')
        g.cmd(r,[a.binary,'history'],r.out/'history');g.cmd(r,[a.binary,'setup'],r.out/'c0-setup')
        g.cmd(r,[a.binary,'witness'],r.out/'witness',env=dict(r.env,C0_BACKENDS=str(r.out/'witness-backends.jsonl')))
        sources=[Path(__file__),*sorted((HERE.parents[1]/'postgres-commit-path/src/c0').glob('*')),HERE.parents[1]/'postgres-commit-path/src/bin/c0.rs']
        write(r.out/'provenance.json',dict(base=sp.check_output(['git','rev-parse','HEAD'],text=True).strip(),binary_sha256=hashlib.sha256(a.binary.read_bytes()).hexdigest(),source_sha256={str(f):hashlib.sha256(f.read_bytes()).hexdigest() for f in sources},samples=json.loads((a.samples/'receipt.json').read_text()),fixture_sha256=hashlib.sha256(cache.read_bytes()).hexdigest(),command=sys.argv))
        configurations=[(arm,n,k,h) for arm in ['O1','C','OC'] for n in [4,8,16,32] for k in ([1,2] if arm=='O1' else [1,2,3,4]) for h in [0,0.3,0.6,1.0]]
        if a.smoke:configurations=[(arm,16,2,0.6) for arm in ['O1','C','OC']]
        # Frozen traversal covers every requested N/K/h, with effective N
        # allowed to vary under the cohort rule. No failing trial is replaced.
        for link,delay in [('A',500),('B',1000)]:
            r.g70_link=link;d=r.out/link;d.mkdir();r.ping(delay,d/'rtt-before.json')
            for arm,n,k,h in configurations:
                for rep in range(1 if a.smoke else 3):results.append(trial(r,a,d/f'{arm}-n{n}-k{k}-h{h}',arm,n,k,h,rep,.2 if a.smoke else 1,1 if a.smoke else 4))
            r.ping(delay,d/'rtt-after.json')
        if not a.smoke:
            for link,delay in [('A',500),('B',1000)]:
                r.g70_link=link;d=r.out/f'long-{link}';d.mkdir();r.ping(delay,d/'rtt-before.json')
                for arm in ['O1','C','OC']:
                    groups={}
                    for x in results:
                        if x['link']==link and x['arm']==arm and x['phase']=='sweep':groups.setdefault((x['n'],x['k'],x['hold_ms']),[]).append(x)
                    # Prefer a full SLO pass, then highest delivered rate,
                    # then lowest mean service residence. Tie-break is frozen.
                    config=max(groups,key=lambda cfg:(all(x['slo_pass'] for x in groups[cfg]),sum(x['writes_per_s'] for x in groups[cfg]),-sum(x['client_ms']['mean'] for x in groups[cfg])))
                    n,k,h=config
                    for rep in range(3):results.append(trial(r,a,d/f'{arm}-n{n}-k{k}-h{h}',arm,n,k,h,rep,10,20))
                r.ping(delay,d/'rtt-after.json')
        write(r.out/'aggregate.json',results)
    finally:
        # Seal known private values for an outside-Git exact-value scan.
        vault=[]
        for f in [Path.home()/'sb4bench/pw',Path.home()/'sb4scale/pw',r.runtime/'jwt-secret',r.runtime/'tokens.json']:
            if f.exists():
                data=f.read_bytes().strip()
                if f.name=='tokens.json':vault.extend(json.loads(data))
                elif data:vault.append(data.decode())
        path=r.out.parent/(r.out.name+'-vault.json');fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,0o600)
        with os.fdopen(fd,'w') as f:json.dump([base64.b64encode(x.encode()).decode() for x in vault],f)
        r.close();private=str(r.runtime);shutil.rmtree(r.runtime);write(r.out/'private-cleanup.json',dict(path=private,removed=True))
    print('C0 COMPLETE; owned services stopped',flush=True)
if __name__=='__main__':main()

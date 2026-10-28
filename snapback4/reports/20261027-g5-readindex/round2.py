#!/usr/bin/env python3
"""G5R2 fixed, interleaved cohorts using s1-onehost's native lifecycle.
Raw/private state stays outside Git. Never contacts another host or copies tokens.
"""
import argparse, importlib.util, json, os, shutil, signal, subprocess as sp, sys, threading, time
from pathlib import Path
from types import SimpleNamespace

ROOT=Path(__file__).resolve().parents[3]
SCRIPTS=ROOT/'snapback4/experiments/scale-controls/scripts'
sys.path.insert(0,str(SCRIPTS))
spec=importlib.util.spec_from_file_location('s1_onehost',SCRIPTS/'s1-onehost.py')
s1=importlib.util.module_from_spec(spec);spec.loader.exec_module(s1)

def free(out,kind,minimum=60):
    n=shutil.disk_usage('/home').free
    s1.append(out/'disk-g5r2.jsonl',dict(time=time.time(),kind=kind,free_bytes=n))
    if n<minimum*1000**3:raise RuntimeError(f'/home below {minimum} GB: {n}')
    return n

def pg_cpu(pid):
    # Surviving children plus reaped-child CPU. Retry if reaping races the census;
    # unrelated disappearing /proc entries do not invalidate our private family.
    def stat(pid):
        f=Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()
        return dict(pid=pid,ppid=int(f[1]),birth=int(f[19]),ticks=int(f[11])+int(f[12]),reaped=int(f[13])+int(f[14]))
    for _ in range(5):
        a=stat(pid);children=[]
        for p in Path('/proc').glob('[0-9]*'):
            try:
                v=stat(int(p.name))
                if v['ppid']==pid:children.append(v)
            except (OSError,ValueError,IndexError):pass
        b=stat(pid)
        if a['birth']==b['birth'] and a['reaped']==b['reaped']:
            return dict(cpu_s=(b['ticks']+b['reaped']+sum(c['ticks'] for c in children))/os.sysconf('SC_CLK_TCK'),birth=b['birth'],pids=[pid]+[c['pid'] for c in children],time=time.monotonic())
    return None

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--out',type=Path,required=True)
    ap.add_argument('--result',type=Path,required=True)
    ap.add_argument('--warmup-ms',type=int,default=10000)
    ap.add_argument('--duration-ms',type=int,default=20000)
    ap.add_argument('--pilot',action='store_true')
    ap.add_argument('--sanity-default',action='store_true',help='W2/A 8000/s default (unset) versus explicit off, two repetitions; local sanity only')
    ap.add_argument('--fixture-rows',type=int,default=1000000)
    ap.add_argument('--trace',action='store_true')
    ap.add_argument('--clock-diagnostics-from',type=Path,help='reuse only a stopped, custody-checked private campaign fixture for six 1000/s trace-only windows')
    args=ap.parse_args();os.umask(0o077)
    target=ROOT/'target/release'
    a=SimpleNamespace(system='snapback',store='postgres',out=str(args.out),pg_bin='/home/ccheever/tools/pg16/usr/lib/postgresql/16/bin',pg_port=55772 if args.sanity_default else 55743,
        pg_share='/home/ccheever/tools/pg16/usr/share/postgresql/16',pg_cores='0-2,6-8',app_cores='3-4,9-10',load_cores='5,11',
        harness=str(target/'sb4-scale-controls'),snapback_bin=str(target/'snapback4'),seed_bin=str(target/'sb4-postgres-scale-seed'),
        rows=args.fixture_rows,warmup_ms=args.warmup_ms,duration_ms=args.duration_ms,repeats=3,extra_read_rates=[],target='snapback',max_rate=16000,rates=[])
    s1.disk=lambda out:free(out,'S1-boundary')
    base=s1.configure(a);one=s1.make_runner(base)
    class Campaign(one):
        def start(self):
            if not args.clock_diagnostics_from:return super().start()
            import round2_reuse
            return round2_reuse.start(self,args.clock_diagnostics_from,s1)
        def fixture(self,rows):
            if not args.clock_diagnostics_from:return super().fixture(rows)
            import round2_reuse
            return round2_reuse.fixture(self,rows,s1)
        def spawn(self,command,directory,kind,cwd=None):
            command=list(map(str,command))
            if 'load' in command:
                command+=['--cpu-pids',','.join(map(str,self.app_pids())),'--cpu-tree-root',str(self.master[0].pid)]
            return super().spawn(command,directory,kind,cwd)
        def snapshot(self):
            v=super().snapshot();v['pg_cpu']=pg_cpu(self.master[0].pid)
            v['connections']=int(self.sqlpg("SELECT count(*) FROM pg_stat_activity WHERE application_name LIKE 'sb:%'"))
            return v
        def close(self):
            # Same recorded-Popen shutdown custody as S1; preserve our stopped
            # million-row fixture rather than deleting it after a campaign.
            self.stop_service()
            for p,out,err in reversed(self.children):
                if self.master and p is self.master[0]:continue
                if p.poll() is None:p.terminate()
                try:p.wait(timeout=30)
                except sp.TimeoutExpired:p.kill();p.wait(timeout=10)
                out.close();err.close()
            if self.master:
                p,out,err=self.master
                if p.poll() is None:p.send_signal(signal.SIGINT)
                p.wait(timeout=60);out.close();err.close()
            for p in self.started:
                if p.poll() is None:
                    p.terminate()
                    try:p.wait(timeout=15)
                    except sp.TimeoutExpired:p.kill();p.wait(timeout=10)
            self.observe_stop.set();self.observer.join(timeout=5)
            records=[json.loads(line) for line in (self.out/'all-pids.jsonl').read_text().splitlines()]
            alive=[r for r in records if r['pid']!=os.getpid() and s1.live(r)]
            absent=not (self.runtime/'pg/postmaster.pid').exists()
            s1.write(self.out/'cleanup.json',dict(still_running=alive,pidfile_absent=absent,private_root=str(self.runtime),home_free_bytes=shutil.disk_usage('/home').free))
            sp.Popen=self.original_popen
            assert not alive and absent,'owned cleanup incomplete; retain state'
    r=Campaign(a)
    if args.clock_diagnostics_from:
        assert not args.pilot and args.fixture_rows==1000000
        import round2_reuse
        round2_reuse.adopt(r,args.clock_diagnostics_from,s1)
    for k in list(r.env):
        if k.startswith('SNAPBACK4_'):r.env.pop(k)
    r.env['LD_LIBRARY_PATH']='/home/ccheever/tools/pg16/usr/lib/x86_64-linux-gnu'
    os.environ['LD_LIBRARY_PATH']=r.env['LD_LIBRARY_PATH'] # S1 initdb inherits the controller environment
    # ping-unix requires a password file even with local trust; use a new
    # non-secret placeholder rather than reading a shared cluster credential.
    dummy=r.runtime/'unused-private-password';dummy.write_text('unused-local-trust')
    r.env['SCALE_PASSWORD_FILE']=str(dummy)
    stopped=threading.Event()
    def disk_monitor():
        while not stopped.wait(1):
            try:free(r.out,'continuous')
            except Exception:
                os.kill(os.getpid(),signal.SIGTERM);return
    watcher=threading.Thread(target=disk_monitor,daemon=True);watcher.start()
    signal.signal(signal.SIGTERM,lambda *_:(_ for _ in ()).throw(KeyboardInterrupt()))
    runs=[];report=dict(fixture_rows=a.rows,pilot=args.pilot,raw_out=str(r.out),method='local sanity: W2/A 8000/s default (unset) versus off, two repetitions; 32768-message fixture' if args.sanity_default else 's1-onehost.py lifecycle/fixture/quiet gate/affinity/SLO; fixed interleaved G5, RI, G6; 3 repetitions',warmup_ms=a.warmup_ms,duration_ms=a.duration_ms,runs=runs)
    def save():args.result.write_text(json.dumps(report,indent=2)+'\n')
    try:
        r.start()
        ownership=json.loads((r.out/'ownership.json').read_text())
        report['provenance']={k:ownership[k] for k in ['source_commit','binary_sha256','target_binary_sha256','pg_cores','app_cores','load_cores']}
        r.fixture(a.rows)
        report['seed']=json.loads((r.out/'seed-equality.json').read_text());save()
        cohorts=[(w,link,rate,rep) for rep in range(3) for w in ['W1','W2','W3'] for link in ['A','B'] for rate in ([8000,9514,11313,16000] if w=='W3' else [8000,9514,11313])]
        cohorts += [('W4','A',rate,rep) for rep in range(3) for rate in [800,2262]]
        cohorts += [('W2','B',11313,-1),('W3','B',16000,-1)]
        if args.sanity_default:cohorts=[('W2','A',8000,rep) for rep in range(2)]
        if args.pilot:cohorts=[('W3','B',100,0),('W4','A',100,0)]
        if args.clock_diagnostics_from:cohorts=[('W2','B',1000,-2),('W3','B',1000,-2)]
        for index,(w,link,rate,rep) in enumerate(cohorts):
            order=['default','g5'] if args.sanity_default else ['g5','ri','g6'];order=order[index%len(order):]+order[:index%len(order)]
            for arm in order:
                a.warmup_ms=2000 if rep==-1 else args.warmup_ms
                a.duration_ms=4000 if rep==-1 else args.duration_ms
                label=f'{w}-{link}-{rate}-r{rep}-{arm}'
                r.host_check(label);free(r.out,'cohort-'+label)
                d=r.out/label;d.mkdir()
                for k in ['SNAPBACK4_G5_READ_INDEX','SNAPBACK4_READ_GRANT_CLOCK_BOUNDS','SNAPBACK4_READ_TRACE','SNAPBACK4_READ_TRACE_ALL']:r.env.pop(k,None)
                if arm=='g5':r.env['SNAPBACK4_G5_READ_INDEX']='0'
                if arm=='ri':r.env['SNAPBACK4_G5_READ_INDEX']='1'
                if arm=='g6':r.env['SNAPBACK4_READ_GRANT_CLOCK_BOUNDS']='1000,250'
                if args.trace or rep<0:
                    r.env['SNAPBACK4_READ_TRACE']=str(d/'trace.jsonl');r.env['SNAPBACK4_READ_TRACE_ALL']='1'
                delay=500 if link=='A' else 1000 # proxy splits this RTT into two equal directional delays
                r.ping(delay,d/'rtt-before.json');r.start_service(32,delay,d)
                r.before_trials(d,w,128 if w!='W4' else 32,'disjoint',a.rows)
                r.host_check(label+'-ready');free(r.out,'measure-'+label)
                # The excluded W3/W4 pilot does not use the generator's message
                # address range, but the harness still validates its 32768 minimum.
                result=r.trial(d,w,128 if w!='W4' else 32,'disjoint',max(a.rows,32768),rate,rep)
                before=json.loads((d/f'rate-{rate}-r{rep}.before.json').read_text());after=json.loads((d/f'rate-{rate}-r{rep}.after.json').read_text())
                ack=result['total_success_including_warmup']
                calls=lambda v:sum(s['calls'] for s in v['statements'])
                cpu_a=before['pg_cpu'];cpu_b=after['pg_cpu']
                cpu=(cpu_b['cpu_s']-cpu_a['cpu_s'])*1e6/ack if ack and cpu_a and cpu_b and cpu_a['birth']==cpu_b['birth'] else None
                c=result['cpu_window'];valid=c['before']['valid'] and c['after']['valid']
                measured_cpu=(c['after']['tree']['cpu_s']-c['before']['tree']['cpu_s'])*1e6/result['success'] if valid and result['success'] else None
                assert max(before['connections'],after['connections'])<=32
                row=dict(diagnostic=rep<0,workload=w,link=link,rate=rate,repeat=rep,arm=arm,p50_ms=result['latency']['p50_ms'],p99_ms=result['latency']['p99_ms'],errors=result['error_count'],scheduled=result['scheduled'],success=result['success'],slo_pass=result['slo_pass'],achieved_per_s=result['achieved_per_s'],pg_cpu_us_per_cohort_ack=cpu,pg_cpu_us_per_measured_ack=measured_cpu,sql_per_cohort_ack=(calls(after)-calls(before))/ack if ack else None,cohort_acks=ack,connections=[before['connections'],after['connections']],dispatch_p99_ms=result['dispatch_lag']['p99_ms'],service_p99_ms=result['http_service']['p99_ms'])
                if w=='W4':row['counter_check']=result['counter_check']
                runs.append(row);save();print(json.dumps(row),flush=True)
                r.stop_service()
                # SIGTERM may leave a fenced lease/read grant until expiry.
                # Wait outside timing; never overwrite another owner or grant.
                end=time.monotonic()+30
                while r.sqlpg("SELECT lease_until<=clock_timestamp() FROM bench._owner WHERE singleton").strip()!='t':
                    if time.monotonic()>end:raise RuntimeError('owned prior lease did not expire')
                    time.sleep(.05)
                if r.sqlpg("SELECT to_regclass('bench._read_grant') IS NOT NULL").strip()=='t':
                    while r.sqlpg("SELECT count(*) FROM bench._read_grant WHERE valid_until>=clock_timestamp()").strip()!='0':
                        if time.monotonic()>end:raise RuntimeError('owned prior read grant did not expire')
                        time.sleep(.05)
        report['final_seed']=r.verify_seed(a.rows)
    except BaseException as e:
        report['stopped_reason']=type(e).__name__+': '+str(e);raise
    finally:
        stopped.set();watcher.join(timeout=3)
        r.close();report['cleanup']=json.loads((r.out/'cleanup.json').read_text());save()

if __name__=='__main__':main()

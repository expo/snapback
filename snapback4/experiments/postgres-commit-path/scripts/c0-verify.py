#!/usr/bin/env python3
"""Audit all retained C0 ledgers and process identities, without fixed trial counts."""
import argparse,collections as co,hashlib,json,math,os
from pathlib import Path

def read(p):return json.loads(p.read_text())
def identity(pid):
    try:
        f=Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split()
        return dict(pid=pid,start_ticks=int(f[19]),state=f[0])
    except (OSError,ValueError,IndexError):return None

def main():
    p=argparse.ArgumentParser();p.add_argument('--roots',type=Path,nargs='+',required=True);p.add_argument('--primary',type=Path,required=True);p.add_argument('--build',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    total=completed=failed=requests=batches=arrivals=0;affinity=co.Counter();disk=[];percell=co.Counter();records=[];cleanup=[]
    for root in a.roots:
        superseded=root.name=='c0-20261026' or root.name.startswith('c0-smoke-');controller=read(root/'custody.json')['pid'] if (root/'custody.json').exists() else None
        for path in root.rglob('r[0-9].json'):
            v=read(path)
            if not isinstance(v,dict) or 'arm' not in v:continue
            total+=1
            if v.get('execution_failed'):failed+=1;assert not v['slo_pass'];continue
            if 'counter_check' not in v:continue
            counter=v['counter_check'];assert counter['ok'] and counter['sum']==counter['commits']==counter['assigned'],path
            bs=[json.loads(s) for s in path.with_suffix('.batches.jsonl').read_text().splitlines()]
            assert len(bs)==v['total_batches'] and sum(b['n'] for b in bs)==counter['assigned'],path
            assert [b['batch'] for b in bs]==list(range(1,len(bs)+1)),path
            assert all(0<b['n']<=v['n'] and len(b['ids'])==len(set(b['ids']))==b['n'] for b in bs),path
            rs=[json.loads(s) for s in path.with_suffix('.batches.jsonl.requests.jsonl').read_text().splitlines()]
            actual=[r for r in rs if 'id' in r];assert len(actual)==counter['assigned'],path
            assert co.Counter(r['id'] for r in actual)==co.Counter(u for b in bs for u in b['ids']),path
            assert len(rs)==math.ceil(v['rate']*(v['warmup_s']+v['seconds'])),path
            selected=[r for r in rs if v['warmup_s']*1000<=r.get('at_ms',r.get('expired_at_ms'))<(v['warmup_s']+v['seconds'])*1000]
            assert len(selected)==v['scheduled'],path
            exp=sum('expired_at_ms' in r for r in selected)
            late=sum(r['end_ms']-r['at_ms' if superseded else 'admitted_ms']>1000 for r in selected if 'id' in r)
            assert exp==v['expired'] and late==v['late'] and exp+late==v['error_count'],path
            assert all(r['at_ms']<=r['admitted_ms']<=r['queued_ms']<=r['end_ms'] for r in actual),path
            expected_success=sum('id' in r for r in selected)-late
            assert expected_success==v['success'] and abs(v['writes_per_s']-expected_success/v['seconds'])<1e-6,path
            if v['slo_pass']:assert v['intended_ms']['p99']<=100 and v['error_fraction']<=.001 and v['writes_per_s']>=v['rate']*.999,path
            completed+=1;requests+=len(actual);batches+=len(bs);arrivals+=len(selected);percell[(v['arm'],v['link'],v['phase'])]+=1
            for s in read(path.with_suffix('.cpu.json')):
                disk.append(s['free_bytes'])
                for t in s['threads'].values():
                    if t['pid']==controller:continue
                    cpus=tuple(t['cpus']);role=t['role'];affinity[(role,cpus)]+=1
                    if role=='PG':assert cpus==(0,1,2,6,7,8),path
                    else:assert cpus in [(3,4,9,10),(5,11)],path
        if (root/'custody.json').exists():
            if (root/'resume-cleanup.json').exists():
                c=read(root/'resume-cleanup.json');assert not c['left'] and c['runtime_removed'];clean_shutdown=False
            else:
                c=read(root/'cleanup.json');assert not c['still_running'] and not c['errors'] and c['cluster_stopped'] and c['socket_absent'] and c['pidfile_absent'],root
                assert read(root/'private-cleanup.json')['removed'];clean_shutdown=True
            assert not Path(read(root/'custody.json')['private_root']).exists()
            rr=[json.loads(s) for s in (root/'all-pids.jsonl').read_text().splitlines()];records+=rr;cleanup.append(dict(run=root.name,pid_records=len(rr),stopped=True,clean_shutdown_observed=clean_shutdown))
    for path in [a.build/'pids.jsonl',a.primary.with_suffix('.launch.jsonl')]:
        records += [json.loads(s) for s in path.read_text().splitlines()]
    left=[]
    for r in records:
        now=identity(r['pid'])
        if now and now['start_ticks']==r.get('start_ticks'):left.append(now)
    assert not left,left
    # A target/runtime scan also catches a descendant missed between observer
    # ticks. Never signal a process discovered only by this scan.
    runtimes=[read(root/'custody.json')['private_root'].encode() for root in a.roots if (root/'custody.json').exists()]
    target=str(Path.home()/'sb4scale/c0-target')
    target_left=[]
    for proc in Path('/proc').iterdir():
        if not proc.name.isdigit() or int(proc.name)==os.getpid():continue
        try:
            executable=os.readlink(proc/'exe');command=(proc/'cmdline').read_bytes();environment=(proc/'environ').read_bytes().split(b'\0')
            if executable.startswith(target+'/') or ('CARGO_TARGET_DIR='+target).encode() in environment or any(runtime in command for runtime in runtimes):
                target_left.append(identity(int(proc.name)))
        except (OSError,ProcessLookupError):pass
    assert not target_left,target_left
    provenance=read(a.primary/'provenance.json')
    for path,want in provenance['source_sha256'].items():
        assert hashlib.sha256((a.primary/'source'/Path(path).name).read_bytes()).hexdigest()==want,path
        assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==want,path
    assert hashlib.sha256((a.primary/'c0-binary').read_bytes()).hexdigest()==provenance['binary_sha256']
    starts=[json.loads(s) for s in (a.primary/'host-checks.jsonl').read_text().splitlines()];last={r['label']:r for r in starts};assert all(not x['unrelated_over_one_core'] for x in last.values())
    assert min(disk)>=25*1024**3
    searches=read(a.primary/'searches.json')
    screens=[x for x in searches if x['phase']=='screen'];assert len(screens)==108
    for x in searches:
        if x.get('abandoned'):assert x['upper']<.7*x['best_at_screen']
        elif x['phase'] in ['screen','refine','confirmed-capacity']:assert 0<x['capacity']<x['upper'] and x['upper']/x['capacity']<=1.05
    result=dict(retained_trial_jsons=total,completed_trials=completed,recorded_execution_failures=failed,measured_arrivals=arrivals,whole_cohort_writes=requests,batches=batches,counters_and_request_ledgers_equal=True,per_cell=[dict(arm=k[0],link=k[1],phase=k[2],trials=v) for k,v in sorted(percell.items())],affinity=[dict(role=r,cpus=list(c),thread_observations=n) for (r,c),n in sorted(affinity.items())],disk=dict(minimum_free_bytes=min(disk),guard_bytes=25*1024**3),host_start=dict(clean_boundaries=len(last),busy_wait_observations=sum(bool(r['unrelated_over_one_core']) for r in starts)),rtt=[dict(path=str(p.relative_to(a.primary)),**read(p)) for p in a.primary.rglob('rtt-*.json')],process_custody=dict(records=len(records),distinct_identities=len({(r['pid'],r.get('start_ticks')) for r in records}),left=[],target_scan_left=target_left,cleanup=cleanup),source_and_binary_frozen=True,screen_configurations=len(screens),superseded_trials=205,product_changes=False)
    a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result[k] for k in ['completed_trials','recorded_execution_failures','measured_arrivals','batches']}))
if __name__=='__main__':main()

#!/usr/bin/env python3
"""Verify C0′ numeric ledgers, frozen source, affinity and stopped PID custody.
This writes aggregate evidence only. Raw request ledgers remain outside Git.
"""
import argparse,collections as co,hashlib,importlib.util,json,os,subprocess as sp
from pathlib import Path

def read(p):return json.loads(p.read_text())
def identity(pid):
    try:
        f=Path(f'/proc/{pid}/stat').read_text().rsplit(')',1)[1].split();return dict(pid=pid,start_ticks=int(f[19]),state=f[0])
    except (OSError,ValueError,IndexError):return None

def main():
    p=argparse.ArgumentParser();p.add_argument('--raw',type=Path,required=True);p.add_argument('--smoke',type=Path,required=True);p.add_argument('--attempts',type=Path,nargs='*',default=[]);p.add_argument('--build',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args()
    trials=[p for glob in ['[AB]/*/r[0-2].json','long-[AB]/*/r[0-2].json'] for p in a.raw.glob(glob)];assert len(trials)==978,len(trials)
    requests=batches=arrivals=0;affinity=co.Counter();disk=[];percell=co.Counter()
    for p in trials:
        v=read(p);counter=v['counter_check'];assert counter['ok'] and counter['sum']==counter['commits']==counter['assigned']
        bs=[json.loads(s) for s in p.with_suffix('.batches.jsonl').read_text().splitlines()];assert len(bs)==v['total_batches'] and sum(b['n'] for b in bs)==counter['assigned']
        assert [b['batch'] for b in bs]==list(range(1,len(bs)+1))
        assert all(0<b['n']<=v['n'] and len(b['ids'])==len(set(b['ids']))==b['n'] for b in bs)
        rs=[json.loads(s) for s in p.with_suffix('.batches.jsonl.requests.jsonl').read_text().splitlines()];actual=[r for r in rs if 'id' in r];assert len(actual)==counter['assigned']
        assert co.Counter(r['id'] for r in actual)==co.Counter(u for b in bs for u in b['ids'])
        assert len(rs)==round(v['rate']*(v['warmup_s']+v['seconds']))
        selected=[r for r in rs if v['warmup_s']*1000<=r.get('at_ms',r.get('expired_at_ms'))<(v['warmup_s']+v['seconds'])*1000]
        assert len(selected)==v['scheduled']
        exp=sum('expired_at_ms' in r for r in selected);late=sum(r['end_ms']-r['at_ms']>1000 for r in selected if 'id' in r)
        assert exp==v['expired'] and late==v['late'] and exp+late==v['error_count']
        assert all(r['at_ms']<=r['admitted_ms']<=r['queued_ms']<=r['end_ms'] for r in actual)
        requests+=len(actual);batches+=len(bs);arrivals+=len(selected);percell[(v['arm'],v['link'],v['phase'])]+=1
        controller=read(a.raw/'custody.json')['pid']
        for s in read(p.with_suffix('.cpu.json')):
            disk.append(s['free_bytes'])
            for t in s['threads'].values():
                if t['pid']==controller:continue
                cpus=tuple(t['cpus']);role=t['role'];affinity[(role,cpus)]+=1
                if role=='PG':assert cpus==(0,1,2,6,7,8)
                else:assert cpus in [(3,4,9,10),(5,11)]
    assert min(disk)>=25*1024**3
    cleanup=[];records=[]
    for root in [*a.attempts,a.smoke,a.raw]:
        c=read(root/'cleanup.json');assert not c['still_running'] and not c['errors'] and c['cluster_stopped'] and c['socket_absent'] and c['pidfile_absent'],root
        assert read(root/'private-cleanup.json')['removed']
        rr=[json.loads(s) for s in (root/'all-pids.jsonl').read_text().splitlines()];records+=rr;cleanup.append(dict(root=str(root),pid_records=len(rr),stopped=True))
    records += [json.loads(s) for s in (a.build/'pids.jsonl').read_text().splitlines()]
    left=[]
    for r in records:
        now=identity(r['pid'])
        if now and now['start_ticks']==r.get('start_ticks'):left.append(now)
    assert not left,left
    provenance=read(a.raw/'provenance.json')
    for path,want in provenance['source_sha256'].items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==want,path
    binary=Path(provenance['command'][provenance['command'].index('--binary')+1]);assert hashlib.sha256(binary.read_bytes()).hexdigest()==provenance['binary_sha256']
    starts=[json.loads(s) for s in (a.raw/'host-checks.jsonl').read_text().splitlines()];last={r['label']:r for r in starts};assert len(last)==978 and all(not x['unrelated_over_one_core'] for x in last.values())
    prefix=[read(p)['prefix_hammer'] for p in a.smoke.glob('[AB]/*/r0.json')];assert len(prefix)==6 and all(x['violations']==0 for x in prefix)
    witnesses=read(a.smoke/'witness.stdout');assert witnesses['tripwire'] and witnesses['void_after_recorded_backend_kill'] and witnesses['committed_key_beats_void']
    rtts=[read(p) for p in a.raw.rglob('rtt-*.json')];assert len(rtts)==8
    result=dict(trials=len(trials),measured_arrivals=arrivals,whole_cohort_successful_writes=requests,batches=batches,counters_and_request_ledgers_equal=True,per_cell=[dict(arm=k[0],link=k[1],phase=k[2],trials=v) for k,v in sorted(percell.items())],affinity=[dict(role=r,cpus=list(c),thread_observations=n) for (r,c),n in sorted(affinity.items())],disk=dict(minimum_free_bytes=min(disk),guard_bytes=25*1024**3),host_start=dict(clean_boundaries=len(last),busy_wait_observations=sum(bool(r['unrelated_over_one_core']) for r in starts)),rtt=[dict(path=str(p.relative_to(a.raw)),**read(p)) for p in a.raw.rglob('rtt-*.json')],prefix_hammer=dict(statements=sum(x['reader_ms']['n'] for x in prefix),violations=0,stale_restarts=sum(x['stale_restarts'] for x in prefix),reader_mean_ms=[x['reader_ms']['mean'] for x in prefix]),witnesses=witnesses,process_custody=dict(records=len(records),distinct_identities=len({(r['pid'],r.get('start_ticks')) for r in records}),left=[],cleanup=cleanup),provenance=provenance,product_changes=False)
    a.out.parent.mkdir(parents=True,exist_ok=True);a.out.write_text(json.dumps(result,indent=2)+'\n');print(json.dumps({k:result[k] for k in ['trials','measured_arrivals','whole_cohort_successful_writes','batches']}))
if __name__=='__main__':main()

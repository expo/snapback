#!/usr/bin/env python3
"""Audit stopped G7.0 runs, scan known secrets, archive raw evidence outside Git."""
import argparse
import base64
import gzip
import hashlib
import json
import os
from pathlib import Path
import re
import shutil
import subprocess as sp
import sys
import tarfile


def read(p):return json.loads(p.read_text())
def write(p,v):p.write_text(json.dumps(v,indent=2)+'\n')
def live(r):
    try:
        f=Path(f'/proc/{r["pid"]}/stat').read_text().rsplit(')',1)[1].split()
        return f[0]!='Z' and int(f[19])==r.get('start_ticks')
    except (OSError,IndexError,ValueError):return False


def scan(trees,vault):
    values={base64.b64decode(v) for v in read(vault)};values.discard(b'')
    jwt=re.compile(rb'(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}(?![A-Za-z0-9_-])')
    native=re.compile(rb'(?<![A-Za-z0-9_-])[A-Za-z0-9_-]{43}(?![A-Za-z0-9_-])')
    jwts={v for v in values if jwt.fullmatch(v)};tokens={v for v in values if native.fullmatch(v)};other=values-jwts-tokens
    pem=re.compile(rb'-----BEGIN (?:RSA )?PRIVATE KEY-----[\r\n]+[A-Za-z0-9+/=\r\n]{64,}-----END (?:RSA )?PRIVATE KEY-----')
    hits=[];files=0
    for tree in trees:
        for p in tree.rglob('*'):
            if not p.is_file() or p.is_symlink():continue
            b=p.read_bytes();files+=1
            if p.suffix=='.gz':b=gzip.decompress(b)
            if any(v in b for v in other) or jwts.intersection(jwt.findall(b)) or tokens.intersection(native.findall(b)) or pem.search(b):hits.append(str(p.relative_to(tree)))
    return dict(files_scanned=files,known_values=len(values),matches=hits,values_withheld=True,scope='both benchmark passwords and all retained campaign JWT secrets/tokens; complete PEM payloads; all raw evidence and committed summaries')


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('--raw',type=Path,required=True);p.add_argument('--protocol',type=Path,required=True);p.add_argument('--out',type=Path,required=True);p.add_argument('--vault',type=Path,required=True);p.add_argument('--archive',type=Path,required=True);p.add_argument('--attempts',type=Path,nargs='*',default=[]);p.add_argument('--scan-only',action='store_true');a=p.parse_args()
    roots=[*a.attempts,a.raw,a.protocol];records=[];clean=[]
    for root in roots:
        c=read(root/'cleanup.json');assert not c['still_running'] and not c['errors'] and c['cluster_stopped'] and c['socket_absent'] and c['pidfile_absent'],root
        assert read(root/'private-cleanup.json')['removed']
        rs=[json.loads(l) for l in (root/'all-pids.jsonl').read_text().splitlines()];records.extend(rs)
        clean.append(dict(run=root.name,events=len(rs),cluster_stopped=True,private_removed=True))
    assert not any(live(r) for r in records),'owned process remains'
    # Fixed-rate control summaries describe the actual retained repetitions;
    # they do not invent a rate search or replace a failed repetition.
    for link,rates in [('A',[3200]),('B',[1600,3200])]:
        directory=a.raw/f'supabase-{link}'
        passed=[rate for rate in rates if all(read(directory/f'rate-{rate}-r{i}.json')['slo_pass'] for i in range(3))]
        failed=[rate for rate in rates if rate not in passed]
        write(directory/'cell.json',dict(workload='W4',writers=32,rows=1000000,keys='disjoint',fixed_rates=True))
        write(directory/'summary.json',dict(rates=rates,repeats=3,highest_passing_offered_per_s=max(passed,default=None),lowest_failing_offered_per_s=min(failed,default=None),bracketed=bool(passed and failed)))
    audit_script=Path(__file__).resolve().parents[2]/'scale-controls/scripts/audit.py'
    audit=sp.run([sys.executable,str(audit_script),str(a.raw)],capture_output=True,text=True,check=True)
    (a.raw/'control-audit.stdout').write_text(audit.stdout)
    control_audit=read(a.raw/'audit.json');assert control_audit['trials']==9
    batch_trials=0;batch_records=0;physical_writes=0
    for path in [*a.raw.glob('[AB]/*/r[0-9].json'),*a.raw.glob('long-[AB]/*/r[0-9].json'),*a.raw.glob('logged-[AB]/*/r[0-9].json'),*a.raw.glob('preflight/*/r[0-9].json')]:
        t=read(path);trace=path.with_suffix('.batches.jsonl');count=0;writes=0;ids=set()
        with trace.open() as f:
            for line in f:
                b=json.loads(line);count+=1;writes+=b['n'];ids.add(b['k'])
                assert len(b['latency_ms'])==b['n'] and len(b['phases_ms'])==7 and min(b['phases_ms'])>=0
        assert count==t['total_batches'] and len(ids)==count and min(ids)==1 and max(ids)==count
        assert writes==t['counter_check']['acknowledged']==t['counter_check']['sum']==t['counter_check']['commits']
        assert t['counter_check']['logs']==(writes if t['log_one'] else 0)
        assert t['deadlocks']==0
        batch_trials+=1;batch_records+=count;physical_writes+=writes
    assert batch_trials==374
    batch_audit=dict(trials=batch_trials,batches=batch_records,physical_confirmed_writes=physical_writes,all_counter_commit_equal=True,all_log_counts_equal=True,deadlocks=0)
    write(a.raw/'batch-arithmetic-audit.json',batch_audit)
    affinity=CounterLike();disk=[];samples=0;controller=read(a.raw/'custody.json')['pid']
    for path in a.raw.glob('*-[AB]/*/*.cpu.json'):
        for s in read(path):
            samples+=1;disk.append(s['free_bytes'])
            for t in s['threads'].values():
                if t['pid']==controller:continue
                cpus=tuple(t['cpus']);role=t['role'];affinity.add(role,cpus)
                if role=='PG':assert cpus==(0,1,2,6,7,8)
                else:assert cpus in [(3,4,9,10),(5,11)]
    for path in a.raw.glob('[AB]/*/*.cpu.json'):
        for s in read(path):
            samples+=1;disk.append(s['free_bytes'])
            for t in s['threads'].values():
                if t['pid']==controller:continue
                cpus=tuple(t['cpus']);role=t['role'];affinity.add(role,cpus)
                if role=='PG':assert cpus==(0,1,2,6,7,8)
                else:assert cpus in [(3,4,9,10),(5,11)]
    host=[json.loads(l) for l in (a.raw/'host-checks.jsonl').read_text().splitlines()];last={r['label']:r for r in host}
    assert all(not r['unrelated_over_one_core'] for r in last.values())
    rtts=[read(p) for p in a.raw.rglob('rtt-*.json')]
    protocol=read(a.protocol/'request/protocol.json')
    assert protocol['http_status']==200 and not protocol['bind_values_logged']
    statements=protocol['statements']
    assert any('COMMIT' in q for q in statements) and any('increment' in q for q in statements),statements
    provenance=read(a.raw/'g70-provenance.json')
    for path,digest in provenance['source_sha256'].items():assert hashlib.sha256(Path(path).read_bytes()).hexdigest()==digest,path
    command=provenance['command'];binary=Path(command[command.index('--binary')+1])
    assert hashlib.sha256(binary.read_bytes()).hexdigest()==provenance['binary_sha256']
    verification=dict(control_audit=control_audit,batch_arithmetic_audit=batch_audit,process_audit=dict(events=len(records),distinct_identities=len({(r['pid'],r.get('start_ticks')) for r in records}),live_owned=[],cleanup=clean),affinity=dict(samples=samples,observed=affinity.rows()),disk=dict(minimum_free_bytes=min(disk),minimum_free_GiB=min(disk)/1024**3,guard_GiB=25,passed=min(disk)>25*1024**3),host_start_gate=dict(released_boundaries=len(last),busy_wait_observations=sum(bool(r['unrelated_over_one_core']) for r in host),all_released_clean=True),rtt=dict(captures=len(rtts),p50_ms_min=min(x['p50_ms'] for x in rtts),p50_ms_max=max(x['p50_ms'] for x in rtts),p99_ms_max=max(x['p99_ms'] for x in rtts)),protocol=dict(http_requests=1,http_status=200,bind_values_logged=False,statements=statements),provenance=read(a.raw/'g70-provenance.json'),product_base='80d1597cf974d56b23048447be499c75f0aba669',product_edits=False,no_fetch_push_stash=True,repository_checks='See repository-checks.json')
    a.out.mkdir(parents=True,exist_ok=True);write(a.out/'verification.json',verification)
    receipt=scan([*roots,a.out],a.vault);write(a.out/'secret-audit.json',receipt);assert not receipt['matches'],receipt['matches']
    if a.scan_only:return
    a.archive.parent.mkdir(parents=True,exist_ok=True)
    assert not a.archive.exists(),'archive must be new'
    with tarfile.open(a.archive,'w:gz',compresslevel=6) as tar:
        for root in roots:tar.add(root,arcname=root.name)
    write(a.out/'archive.json',dict(path=str(a.archive),sha256=hashlib.sha256(a.archive.read_bytes()).hexdigest(),bytes=a.archive.stat().st_size,roots=[r.name for r in roots],raw_data_in_git=False))
    print(json.dumps(dict(archive_sha256=read(a.out/'archive.json')['sha256'],pids_left=[],secret_matches=0)))


class CounterLike:
    def __init__(self):self.counts={}
    def add(self,role,cpus):self.counts[(role,cpus)]=self.counts.get((role,cpus),0)+1
    def rows(self):return [dict(role=r,cpus=list(c),thread_observations=n) for (r,c),n in sorted(self.counts.items())]


if __name__=='__main__':main()

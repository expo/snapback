#!/usr/bin/env python3
"""Audit stopped one-host campaigns, retain raw data outside Git, make summaries.

Known-secret scanning follows finish-postgres-2.py. Values never enter output.
"""
import argparse
import gzip
import hashlib
import json
from pathlib import Path
import re
import shutil
import subprocess as sp
import sys
import tarfile
import time
from statistics import median

HERE=Path(__file__).resolve().parent.parent


def read(p):return json.loads(p.read_text())
def write(p,v):p.write_text(json.dumps(v,indent=2)+'\n')


def secret_scan(root,out,private_roots):
    values=set()
    for path in (Path.home()/'sb4scale/pw',Path.home()/'sb4bench/pw'):
        if path.exists():values.add(path.read_bytes().strip())
    for tree in private_roots:
        for p in tree.rglob('*'):
            if not p.is_file() or 'pg' in p.relative_to(tree).parts:continue
            if p.name in ('tokens.json','jwt-secret','issuer-private.pem','barrier-token') or p.suffix in ('.secret','.admin'):
                b=p.read_bytes().strip();values.add(b)
                if p.name=='tokens.json':values.update(x.encode() for x in json.loads(b))
    values.discard(b'');hits=[];files=0
    # Do not scan private cluster files as public evidence or expose matches.
    for tree in (root,out):
        for p in tree.rglob('*'):
            if not p.is_file() or p.is_symlink():continue
            b=p.read_bytes();files+=1
            if p.suffix=='.gz':b=gzip.decompress(b)
            if any(v in b for v in values):hits.append(str(p.relative_to(tree)))
            if re.search(rb'-----BEGIN (?:RSA )?PRIVATE KEY-----',b):hits.append(str(p.relative_to(tree))+': private-key marker')
    receipt=dict(files_scanned=files,known_private_values=len(values),matches=hits,scope='all raw campaign evidence and committed summaries; both benchmark passwords, issuer keys, JWTs, admin/instance/service credentials; values withheld')
    write(out/'secret-audit.json',receipt)
    if hits:raise RuntimeError('known private material found; see paths-only scan receipt')


def main():
    p=argparse.ArgumentParser(description=__doc__)
    p.add_argument('root',type=Path);p.add_argument('out',type=Path)
    p.add_argument('--archive',type=Path,required=True)
    a=p.parse_args();root=a.root.resolve();out=a.out.resolve();out.mkdir(exist_ok=True)
    private=[];process_rows=[]
    for receipt in root.glob('*/custody.json'):
        segment=receipt.parent
        clean=read(segment/'cleanup.json');assert not clean['still_running'] and clean['cluster_stopped']
        private.append(Path(read(receipt)['private_root']))
        for line in (segment/'all-pids.jsonl').read_text().splitlines():
            r=json.loads(line)
            try:
                f=Path(f'/proc/{r["pid"]}/stat').read_text().rsplit(')',1)[1].split()
                alive=f[0]!='Z' and int(f[19])==r.get('start_ticks')
            except (OSError,IndexError,ValueError):alive=False
            process_rows.append(dict(pid=r['pid'],start_ticks=r.get('start_ticks'),alive=alive))
    assert not any(r['alive'] for r in process_rows),'recorded owned process remains'
    write(out/'process-audit.json',dict(events=len(process_rows),distinct_pids=len({r['pid'] for r in process_rows}),live_owned=[]))
    segments=[]
    for system in ('rawpg','supabase','convex'):
        segment=root/('matrix-'+system)
        if not (segment/'cleanup.json').exists():continue
        # Preserve the unchanged independent auditor and lossless archive checks.
        if not (segment/'audit.json').exists():
            sp.run([sys.executable,str(HERE/'scripts/archive.py'),str(segment)],check=True)
            sp.run([sys.executable,str(HERE/'scripts/audit.py'),str(segment)],check=True)
        if not (segment/'ledger.json').exists():sp.run([sys.executable,str(HERE/'scripts/report.py'),str(segment)],check=True)
        segments.append((system,segment))
    rows=[];curves=[];rtts=[];load=[];affinity=[];disqualified=[];audits={};provenance={};seeds={};smokes={}
    for system,segment in segments:
        audits[system]=read(segment/'audit.json');provenance[system]=read(segment/'ownership.json')
        seeds[system]=read(segment/'seed-equality.json')
        for item in read(segment/'ledger.json'):
            item['system']=system;rows.append(item)
        for item in read(segment/'curves.json'):
            item['system']=system;curves.append(item)
        for line in (segment/'host-checks.jsonl').read_text().splitlines():
            item=json.loads(line);assert not item['unrelated_over_one_core'];load.append(dict(system=system,**item))
        generators=[json.loads(s) for s in (segment/'generator-affinity.jsonl').read_text().splitlines()]
        assert generators
        for g in generators:assert all(t['cpus']==[5,11] for t in g['tasks'])
        for d in sorted(segment.glob('*/summary.json')):
            cell=read(d.parent/'cell.json')
            for edge in ('before','after'):rtts.append(dict(system=system,cell=cell,edge=edge,**read(d.parent/f'rtt-{edge}.json')))
            witness=read(d.parent/'affinity.json')
            masks={role:sorted({tuple(r['cpus']) for r in witness if r['role']==role}) for role in {r['role'] for r in witness}}
            affinity.append(dict(system=system,cell=cell,thread_observations=len(witness),actual_masks=masks,generator_witnesses=len(generators)))
            s=read(d)
            for rate in s['rates']:
                for repeat in range(s['repeats']):
                    trial=read(d.parent/f'rate-{rate}-r{repeat}.json')
                    if not trial['slo_pass']:
                        reasons=[]
                        if trial['latency']['p99_ms']>trial['slo_ms']:reasons.append('p99')
                        if trial['error_count']/trial['scheduled']>.001:reasons.append('errors')
                        if not trial.get('counter_check',dict(ok=True))['ok']:reasons.append('counter')
                        disqualified.append(dict(system=system,cell=d.parent.name,rate=rate,repeat=repeat,reasons=reasons))
        smoke=root/('smoke-'+system)
        summaries=list(smoke.glob('*/summary.json'))
        if summaries:smokes[system]=[read(s) for s in summaries]
    assert len(rows)==36,'full 36-cell result required'
    write(root/'disqualified-trials.json',disqualified)
    write(out/'audit.json',audits);write(out/'provenance.json',provenance);write(out/'seed-equality.json',seeds);write(out/'smoke.json',smokes)
    write(out/'ledger.json',rows);write(out/'curves.json',curves);write(out/'rtt-load.json',dict(rtt=rtts,load=load));write(out/'affinity.json',affinity)
    write(out/'disqualified-summary.json',dict(trials=len(disqualified),by_system={s:sum(x['system']==s for x in disqualified) for s in audits},by_reason={reason:sum(reason in x['reasons'] for x in disqualified) for reason in ('p99','errors','counter')},full_trial_list='raw archive: disqualified-trials.json'))
    text=['| Workload | Link | Raw PG token | Supabase advocate | Convex advocate |','|---|---|---:|---:|---:|']
    for w,k in [('W1','disjoint'),('W2','disjoint'),('W3','disjoint'),('W4','disjoint'),('W5','same'),('W5','hot1')]:
        for link,delay in [('A',500),('B',1000)]:
            values=[]
            for system in ('rawpg','supabase','convex'):
                row=next(r for r in rows if r['system']==system and r['cell']['workload']==w and r['cell']['keys']==k and r['cell']['delay_us']==delay)
                rate=row['summary']['highest_passing_offered_per_s'];values.append(f'{rate:,}' if rate is not None else 'no pass')
            text.append('| '+' | '.join([w+(' '+k if w=='W5' else ''),link,*values])+' |')
    (out/'table.md').write_text('\n'.join(text)+'\n')
    ledger=['| System | Cell | Link | Offered/s | p50 / p99 / p99.9 ms | Worst p99 |','|---|---|---|---:|---:|---:|']
    for r in rows:
        c=r['cell'];rate=r['summary']['highest_passing_offered_per_s'];label=c['workload']+(' '+c['keys'] if c['workload']=='W5' else '')
        values=(' / '.join(f'{r[k]:.3f}' for k in ('p50_ms','p99_ms','p999_ms')) if rate else '—')
        ledger.append('| '+' | '.join([r['system'],label,'A' if c['delay_us']==500 else 'B',str(rate or 'no pass'),values,f'{r["p99_worst_ms"]:.3f}' if rate else '—'])+' |')
    (out/'ledger.md').write_text('\n'.join(ledger)+'\n')
    free=[json.loads(s)['free_bytes'] for segment in root.glob('*/disk.jsonl') for s in segment.read_text().splitlines()]
    write(out/'disk.json',dict(minimum_free_bytes=min(free),final_free_bytes=shutil.disk_usage('/home').free))
    secret_scan(root,out,private)
    # Scan precedes deletion; every private root was created by this runner and
    # all recorded descendants have already exited. Never touch shared passwords.
    for tree in private:
        assert tree.parent==Path('/tmp') and tree.name.startswith('s1c-')
        if tree.exists():shutil.rmtree(tree)
    write(out/'private-cleanup.json',dict(removed_roots=len(private),clusters_stopped=True,live_owned=[]))
    a.archive.parent.mkdir(parents=True,exist_ok=True)
    assert not a.archive.exists()
    with tarfile.open(a.archive,'w:gz',compresslevel=6) as t:t.add(root,arcname=root.name)
    digest=hashlib.file_digest(a.archive.open('rb'),'sha256').hexdigest()
    with tarfile.open(a.archive) as t:assert any(m.name.endswith('/matrix-convex/audit.json') for m in t.getmembers())
    write(out/'archive.json',dict(path=str(a.archive),sha256=digest,bytes=a.archive.stat().st_size))
    print(json.dumps(dict(cells=len(rows),archive_sha256=digest,live_owned=[])))


if __name__=='__main__':main()

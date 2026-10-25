#!/usr/bin/env python3
"""Recompute the G7 draft's K/H estimates from retained S1 numeric clocks.

Read-only input; bounded aggregates only. This does not run a product binary.
"""
import argparse
from collections import defaultdict
import hashlib
import json
from pathlib import Path
import struct


def stats(xs):
    if not xs:return None
    v=sorted(xs)
    return dict(n=len(v),mean=sum(v)/len(v),p50=v[len(v)//2],p99=v[min(len(v)-1,len(v)*99//100)])


def records(path):
    paths=path.glob('*.bin') if path.is_dir() else [path]
    for p in paths:
        yield from struct.iter_unpack('<8Q',p.read_bytes())


def main():
    p=argparse.ArgumentParser(description=__doc__);p.add_argument('diagnosis',type=Path);p.add_argument('output',type=Path);a=p.parse_args()
    result=[]
    for link,delay in [('A',500),('B',1000)]:
        d=a.diagnosis/f'light/g6-w4-{link.lower()}'/f'w4-n1000000-d{delay}-c32-disjoint'
        batches=[json.loads(l) for l in (d/'batches.jsonl').read_text().splitlines()]
        requests=[json.loads(l) for l in (d/'requests.jsonl').read_text().splitlines()]
        for rate in [800,1131]:
            clients=[c for c in records(d/f'rate-{rate}-r0.client-trace') if c[7]>=200 and c[6]==1]
            lo=min(c[2] for c in clients);hi=max(c[2] for c in clients)+1e9/rate
            bs=[b for b in batches if b['start']>=lo and b['end']<hi]
            bins=[]
            for n in [None,8,16,32]:
                sample=[b for b in bs if n is None or b['N']==n]
                if not sample:continue
                fields=defaultdict(list)
                for b in sample:
                    flights=sum(b['flight_ns'].values());parallel=b['phases'].get('parallel',0)
                    fields['cycle_ms'].append(b['wall_ns']/1e6)
                    fields['opener_flight_ms'].append(b['flight_ns'].get('fence_or_other',0)/1e6)
                    fields['K_residual_wall_ms'].append((b['wall_ns']-flights-parallel)/1e6)
                    fields['K_outside_named_phases_ms'].append((b['wall_ns']-sum(b['phases'].values())-b['flight_ns'].get('fence_or_other',0))/1e6)
                    fields['parallel_ms'].append(parallel/1e6)
                    fields['apply_tail_ms'].append((b['phases'].get('apply',0)+b['phases'].get('tail',0))/1e6)
                    for phase in ['facts','levels','tail','publication','COMMIT']:
                        fields[phase+'_ms'].append(b['phases'].get(phase,0)/1e6)
                bins.append(dict(N=n or 'all',**{k:stats(v) for k,v in fields.items()}))
            byid={c[1]:c for c in clients};fields=defaultdict(list);joined=0
            for t in requests:
                c=byid.get(t['id'])
                if c is None or not c[3]-1_000_000<=t['accepted']<=c[4]+1_000_000:continue
                # Successful, physically ordered timestamps only; the separately
                # counted client errors remain in the source cohort.
                if c[7]!=200 or not t['write_end'] or t['write_end']>c[4]:continue
                joined+=1
                external=(t['accepted']-c[3]+c[4]-t['write_end'])/1e6
                fields['H_external_ms'].append(external)
                fields['intake_ms'].append((t['dispatched']-t['accepted'])/1e6)
                fields['admission_ms'].append((t['started']-t['dispatched'])/1e6)
                fields['encode_ms'].append((t['encode_end']-t['encode_start'])/1e6)
                fields['H_external_intake_admission_encode_ms'].append(external+(t['dispatched']-t['accepted']+t['started']-t['dispatched']+t['encode_end']-t['encode_start'])/1e6)
                mark=t.get('mutation_commit',0)
                if mark:
                    fields['publish_mark_to_client_ms'].append((c[4]-mark)/1e6)
            result.append(dict(link=link,offered_per_s=rate,scope='retained lightweight native S1 trace, not a new trial',source_window=dict(lo=lo,hi=hi),batch_bins=bins,joined_successful_http=joined,client_measured=len(clients),client_errors=sum(c[7]!=200 for c in clients),http={k:stats(v) for k,v in fields.items()},source_sha256={f.name:hashlib.sha256(f.read_bytes()).hexdigest() for f in [d/'batches.jsonl',d/'requests.jsonl',d/f'rate-{rate}-r0.json']}))
    a.output.write_text(json.dumps(dict(definitions=dict(K_outside_named_phases_ms='batch wall minus all named phase wall and opener/fence flight wall; additive complement for the phase ledger',K_residual_wall_ms='batch wall minus all timed writer database flight wall and parallel interpretation wall; residual wall, not measured CPU; no assumed RTT subtraction',H_external_ms='send to server accept plus server write-end to client end; excludes generator dispatch backlog and all server residence',H_external_intake_admission_encode_ms='external H plus separately timed server intake, admission and JSON encode; omits other uninstrumented glue'),source_archive_sha256='5d66635f4471b8c4e0d7145ce5cb8b90259e4879e989d136c2cd6114003c2259',rows=result),indent=2)+'\n')


if __name__=='__main__':main()

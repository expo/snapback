#!/usr/bin/env python3
"""Export joint, numeric batch/request resampling input from the S1 probe.
Raw samples MUST be written outside Git. Event IDs follow the archived probe.
"""
import argparse, bisect, collections as co, hashlib, json, struct
from pathlib import Path

def records(p):
    b=p.read_bytes();assert len(b)%64==0
    return list(struct.iter_unpack('<8Q',b))

def extract(root,out):
    out.mkdir(parents=True,exist_ok=False);receipt={}
    for arm in ('S','E'):
      for link,delay,rate in [('A',500,3200),('B',1000,2262)]:
        d=root/'matrix'/('probe-'+arm.lower())/f'w4-n1000000-d{delay}-c32-disjoint'
        events=sorted(r for p in (d/'trace').glob('*.bin') for r in records(p))
        times=[r[0] for r in events]
        all_reqs=[json.loads(x) for x in (d/'requests.jsonl').read_text().splitlines()]
        samples=[]
        for rep in range(3):
          cc=[r for p in (d/f'rate-{rate}-r{rep}.client-trace').glob('*.bin') for r in records(p)]
          # Diagnostic request IDs restart in each generator process. Join
          # inside the trial's clock interval, exactly as S1's source analysis.
          lo=min(r[0] for r in cc)-1_000_000;hi=max(r[0] for r in cc)+1_000_000
          reqs={r['id']:r for r in all_reqs if lo<=r['accepted']<=hi}
          rqev=co.defaultdict(dict);be=co.defaultdict(lambda:co.defaultdict(list))
          for r in events[bisect.bisect_left(times,lo):bisect.bisect_right(times,hi)]:
            if r[2]<2**63:rqev[r[2]][r[3]]=r
            else:be[r[2]][r[3]].append(r)
          members=co.defaultdict(list)
          for cl in cc:
            if cl[7]!=200 or cl[6]!=1:continue
            rr=reqs.get(cl[1]);q=rqev.get(cl[1],{})
            if rr is None or not all(k in q for k in (4,8,11)):continue
            bid=q[11][4];b=be.get(bid,{})
            if not all(k in b for k in (9,10,13,18,20)) or not b[20][0][4]:continue
            done=b[20][0][0];queued=q[11][0]-q[11][5];poll=max(b[88][0][5]-done,0) if 88 in b else 0
            pre=max(queued-cl[3],0);post=max(cl[4]-rr['write_end']+rr['write_end']-q[8][0],0)
            intent=q.get(61,(0,)*8)[7];callback=q.get(73,(0,)*8)[7]
            cpu=max(rr['cpu_ns_end']-rr['cpu_ns_start'],0)+max(rr['writer_cpu_ns']-intent-callback,0)
            members[bid].append([pre/1e6,post/1e6,max(q[8][0]-done,0)/1e6,cpu/1e6,poll/1e6,callback/1e6])
          for bid,mm in members.items():
            b=be[bid];n=b[10][0][4]
            # Staging is an inclusive committer-thread CPU clock. Do not add
            # nested classification/merge/intent clocks to it. The measured
            # parallel wall is replayed as critical CPU, explicitly a stand-in.
            samples.append(dict(n=n,prep_ms=sum(e[7] for e in b[13])/1e6,
                parallel_ms=sum(e[6] for e in b.get(35,[]))/1e6,
                fill_ms=b[10][0][6]/1e6,
                post_cpu_ms=(sum(e[7] for e in b.get(69,[]))+sum(e[7] for e in b.get(85,[]))+sum(e[7] for e in b.get(87,[])))/1e6,
                members=mm,rep=rep))
        assert samples and all(x['members'] for x in samples)
        path=out/f'{arm}-{link}.json';path.write_text(json.dumps(samples,separators=(',',':'))+'\n')
        receipt[f'{arm}-{link}']=dict(batches=len(samples),requests=sum(len(x['members']) for x in samples),sha256=hashlib.sha256(path.read_bytes()).hexdigest(),
            mean_source_n=sum(x['n'] for x in samples)/len(samples),mean_prep_ms=sum(x['prep_ms']+x['parallel_ms'] for x in samples)/len(samples))
    (out/'receipt.json').write_text(json.dumps(receipt,indent=2)+'\n')
    print(json.dumps(receipt,indent=2))
if __name__=='__main__':
    p=argparse.ArgumentParser();p.add_argument('--source',type=Path,required=True);p.add_argument('--out',type=Path,required=True);a=p.parse_args();extract(a.source,a.out)

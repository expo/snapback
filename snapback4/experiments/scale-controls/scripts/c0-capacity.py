#!/usr/bin/env python3
"""Bounded C0 capacity search. Raw search decisions and failed trials stay outside Git."""
import itertools,json,math
from pathlib import Path

def write(p,x):p.write_text(json.dumps(x,indent=2)+'\n')

def run(r,a,trial):
    raw=json.loads(a.calibration.read_text())
    references={('A',2262):(2177,14.99),('A',3200):(2223,14.39),('B',1600):(1600,13.90),('B',2262):(1889,16.94)}
    calibration=[]
    for x in raw:
        rate,mean=references[x['link'],int(x['rate'])]
        calibration.append(dict(link=x['link'],offered=x['rate'],reference_rate=rate,reference_mean=mean,actual_rate=x['writes_per_s'],actual_mean=x['client_ms']['mean'],rate_delta=x['writes_per_s']/rate-1,mean_delta=x['client_ms']['mean']/mean-1))
    assert len(calibration)==4 and all(abs(x['rate_delta'])<=.15 and abs(x['mean_delta'])<=.15 for x in calibration),'calibration rejected; screen forbidden'
    write(r.out/'calibration.json',calibration)
    results=[];summaries=[]
    for link,delay in [('A',500),('B',1000)]:
        r.g70_link=link;directory=r.out/link;directory.mkdir();r.ping(delay,directory/'rtt-before.json')
        for arm in ['O1','C','OC']:
            best=0;screen=[]
            configs=list(itertools.product([8,16,32],[1,2,4],[0,.6]))
            configs.sort(key=lambda c:(c!=(32,2,.6),c!=(32,4,.6),c!=(16,2,.6),-c[0],-c[1],-c[2]))
            def search(cfg,phase,repetitions=1,best_bound=0):
                n,k,h=cfg;d=directory/phase/f'{arm}-n{n}-k{k}-h{h}';d.mkdir(parents=True,exist_ok=True);tested={}
                def evaluate(rate):
                    rate=int(round(rate))
                    if rate not in tested:
                        rows=[trial(r,a,d/f'rate{rate}',arm,n,k,h,rep,1,4,rate,phase) for rep in range(repetitions)]
                        tested[rate]=rows;results.extend(rows)
                        assert not any(x.get('execution_failed') for x in rows),'retained harness failure; stop to diagnose'
                    return all(x['slo_pass'] for x in tested[rate])
                lo=0;hi=None
                for rate in [1600,2262,3200,4525]:
                    if evaluate(rate):lo=rate
                    else:hi=rate;break
                if hi is None:
                    hi=6400
                    while evaluate(hi):
                        lo=hi;hi=int(round(hi*math.sqrt(2)))
                        assert hi<=25600,'capacity outside registered extension'
                abandoned=hi < .7*best_bound
                if not abandoned:
                    while lo==0:
                        nxt=int(round(hi/math.sqrt(2)))
                        if evaluate(nxt):lo=nxt
                        else:hi=nxt
                        if hi < .7*best_bound:abandoned=True;break
                        assert hi>=100,'no stable rate >=100/s'
                if not abandoned:
                    while hi/lo>1.05:
                        mid=int(round(math.sqrt(lo*hi)))
                        if evaluate(mid):lo=mid
                        else:hi=mid
                value=dict(arm=arm,link=link,n=n,k=k,hold_ms=h,phase=phase,capacity=lo if not abandoned else None,upper=hi,abandoned=abandoned,best_at_screen=best_bound,rates=sorted(tested),repetitions=repetitions)
                write(d/'search.json',value);summaries.append(value);write(r.out/'searches.json',summaries)
                print(f'CAPACITY {phase} {link}/{arm} N{n} K{k} h{h}: [{lo},{hi})'+(' ABANDONED <0.7*best' if abandoned else ''),flush=True)
                return value
            for cfg in configs:
                value=search(cfg,'screen',best_bound=best);screen.append(value)
                if value['capacity'] is not None:best=max(best,value['capacity'])
            candidates=sorted((x for x in screen if not x['abandoned']),key=lambda x:(-x['capacity'],x['upper'],x['n'],x['k'],x['hold_ms']))[:2]
            # Include the literal requested calibration configuration per arm.
            selected=[(x['n'],x['k'],x['hold_ms']) for x in candidates]
            selected.append((11,1,0))
            for cfg in dict.fromkeys(selected):
                value=search(cfg,'refine',repetitions=3)
                n,k,h=cfg;d=directory/'confirmation'/f'{arm}-n{n}-k{k}-h{h}';d.mkdir(parents=True,exist_ok=True)
                fixed=[3200,3805,4525] if link=='A' else [2262,3200]
                # Confirm the search bracket and every fixed rung with complete
                # S1 windows. Back off/refine the bracket on long-window failures.
                confirmed={}
                def full(rate):
                    rate=int(rate)
                    if rate not in confirmed:
                        rows=[trial(r,a,d/f'rate{rate}',arm,n,k,h,rep,10,20,rate,'confirmation') for rep in range(3)]
                        results.extend(rows);confirmed[rate]=all(x['slo_pass'] for x in rows)
                    return confirmed[rate]
                for rate in fixed:full(rate)
                lo=value['capacity'];full(lo)
                passing=[rate for rate,ok in confirmed.items() if ok]
                while not passing:
                    lo=int(round(lo/1.05));assert lo>=100
                    full(lo);passing=[rate for rate,ok in confirmed.items() if ok]
                lo=max(passing)
                failing=[rate for rate,ok in confirmed.items() if not ok and rate>lo]
                hi=min(failing) if failing else int(round(lo*1.05))
                while full(hi):
                    lo=hi;hi=int(round(hi*1.05));assert hi<=25600
                while hi/lo>1.05:
                    mid=int(round(math.sqrt(hi*lo)))
                    if full(mid):lo=mid
                    else:hi=mid
                value=dict(arm=arm,link=link,n=n,k=k,hold_ms=h,phase='confirmed-capacity',capacity=lo,upper=hi,repetitions=3,fixed=fixed)
                summaries.append(value);write(d/'search.json',value);write(r.out/'searches.json',summaries)
        r.ping(delay,directory/'rtt-after.json')
    write(r.out/'aggregate.json',results)
    return results

"""Summarize every retained ABBA attempt, including failures and ambient load."""
import collections, json, statistics
from round1 import OUT, write
from measure import ARCHIVE

def rows(pattern):
    return [json.loads(p.read_text()) for p in sorted(OUT.glob(pattern)) if not p.name.endswith('-cleanup.json')]

def distribution(values):
    values = sorted(values)
    if not values: return None
    def percentile(p):
        i = (len(values)-1)*p; lo = int(i); hi = min(lo+1,len(values)-1)
        return values[lo]+(values[hi]-values[lo])*(i-lo)
    return dict(n=len(values), min=values[0], p10=percentile(.1), median=statistics.median(values),
                mean=statistics.mean(values), p90=percentile(.9), max=values[-1], values=values)

def ambient(row):
    evidence = next(e for e in row['evidence'] if e['path'].endswith('-host.jsonl'))
    samples = [json.loads(line) for line in (ARCHIVE/evidence['sha256']).read_text().splitlines()]
    if 'endedAt' in row:
        samples=[s for s in samples if row['startedAt']<=s['at']<=row['endedAt']]
    pps, rust = [], set()
    for sample in samples:
        for line in sample['processes'].splitlines()[1:]:
            fields = line.split(maxsplit=3)
            if len(fields) != 4: continue
            if fields[3].endswith('/PerfPowerServices'): pps.append(float(fields[2]))
            if fields[3].endswith(('/cargo','/rustc')): rust.add(line)
    return dict(samples=len(samples), load1=distribution([s['load'][0] for s in samples]),
                perfPowerServicesCPU=distribution(pps), rustCompilerProcesses=sorted(rust))

exports = rows('r1-export-*.json'); groups = collections.defaultdict(list)
for row in exports: groups[(row['starter'],row['kind'],row['arm'])].append(row)
summary = dict(exports=[], interference=[], blockSlowdowns=[], ambient={})
for (starter,kind,arm), cohort in groups.items():
    summary['exports'].append(dict(starter=starter, kind=kind, arm=arm,
        criticalSeconds=distribution([r['criticalSeconds'] for r in cohort]),
        totalSeconds=distribution([r['totalSeconds'] for r in cohort]),
        afterReturnSeconds=distribution([r['afterReturnSeconds'] for r in cohort]),
        failed=[r['label'] for r in cohort if r['status'] or r['waitStatus'] not in [0,None] or len(r['segments'])!=3 or any(s!='passed' for s in r['segments'].values())],
        hashMismatches=[r['label'] for r in cohort if not r['exportHash'] or r['exportHash']!=r['loadedHash']],
        cacheHits=[r.get('cache',{}).get('hit') if r.get('cache') else None for r in cohort]))
interference = rows('r1-interference-*.json')
for block in sorted(set(r['block'] for r in interference)):
    cohort = sorted([r for r in interference if r['block']==block],key=lambda r:r['index'])
    if len(cohort) != 4: continue
    first, second, third, last = cohort
    midpoint = lambda r:(r['startedAt']+r['endedAt'])/2
    for sample in [second,third]:
        fraction = (midpoint(sample)-midpoint(first))/(midpoint(last)-midpoint(first))
        expected = first['seconds']+(last['seconds']-first['seconds'])*fraction
        summary['interference'].append(dict(label=sample['label'], condition=sample.get('condition','warm-proof'), seconds=sample['seconds'],
            controlSeconds=expected, slowdownPercent=(sample['seconds']/expected-1)*100,
            # Wall-clock receipt timestamps and monotonic workload time can
            # differ by a few ppm; physical overlap cannot exceed the workload.
            overlapFraction=min(1.0,sample['overlapFraction']), status=sample['status'], proofStatus=sample['waitStatus']))
    summary['blockSlowdowns'].append(dict(block=block, condition=first.get('condition','warm-proof'), slowdownPercent=((second['seconds']+third['seconds'])/(first['seconds']+last['seconds'])-1)*100))
summary['slowdownDistributionPercent'] = distribution([r['slowdownPercent'] for r in summary['interference']])
summary['foregroundSeconds'] = {arm:distribution([r['seconds'] for r in interference if r['arm']==arm]) for arm in 'AB'}
summary['slowdownByConditionPercent'] = {condition:distribution([r['slowdownPercent'] for r in summary['interference'] if r['condition']==condition]) for condition in ['warm-proof','cold-build']}
for row in exports+interference:
    data=ambient(row)
    # Full samples remain in the archive; avoid repeating large sorted vectors.
    for key in ['load1','perfPowerServicesCPU']:
        if data[key]: del data[key]['values']
    summary['ambient'][row['label']]=data
placement=OUT/'placement.json'
if placement.exists():
    counts={arm:collections.Counter() for arm in 'AB'}
    for row in json.loads(placement.read_text()):
        for thread in row['result']['threads']:
            counts[row['arm']].update({int(k):v for k,v in thread['samples'].items()})
    summary['placement']={arm:dict(cpuCounts=dict(count), lowerTierFraction=sum(v for k,v in count.items() if k<12)/sum(count.values())) for arm,count in counts.items()}
write(OUT/'summary.json',summary)
print(json.dumps({k:v for k,v in summary.items() if k!='ambient'},indent=2))

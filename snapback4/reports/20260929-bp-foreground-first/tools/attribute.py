"""Derive CPU, runnable-population and request timing attribution from raw data."""
import collections, json, math, pathlib, statistics, sys

base = pathlib.Path(sys.argv[1])
def percentile(values, fraction=.95):
    values = sorted(values)
    return values[max(0, math.ceil(len(values)*fraction)-1)] if values else None
def describe(values):
    values = list(values)
    return {'n':len(values),'median':statistics.median(values) if values else None,
            'p95':percentile(values),'max':max(values) if values else None}
host = [json.loads(line) for line in (base/'host.jsonl').read_text().splitlines()]
records = collections.defaultdict(list)
for line in (base/'server.log').open():
    prefix, _, value = line.partition(' ')
    if prefix in ['BP_REQUEST','BP_BACKGROUND','SQ_QUEUE','SQ_BEGIN','SQ_END']:
        records[prefix].append(json.loads(value))
out = {'method': 'No batches discarded. CPU is consumed thread time; engine wall includes I/O and descheduling. schedstat delay disabled on this host.', 'windows':{}}
for stage in ['10%','50%','full']:
    for kind in ['immediate','warm']:
        data=json.loads((base/f'{stage}-live-{kind}-curve.json').read_text())
        probes=[p for batch in data['rounds'] for p in batch['probes'].values()]
        start=min(t for p in probes for t in p['timestamps'])/1000
        end=max(t+duration for p in probes for t,duration in zip(p['timestamps'],p['times']))/1000
        queues=[r['us']/1000 for r in records['SQ_QUEUE'] if start<=r['at']/1000<=end]
        headers=collections.defaultdict(list)
        paired=[]
        for batch in data['rounds']:
            for name,p in batch['probes'].items():
                assert len(p['serverTiming'])==len(p['times']), (stage,kind,name)
                for t,wall,header in zip(p['timestamps'],p['times'],p['serverTiming']):
                    parts=dict((x.strip().split(';dur=')[0],float(x.strip().split(';dur=')[1])) for x in header['timing'].split(','))
                    for key,value in parts.items(): headers[key].append(value)
                    paired.append({'probe':name,'round':batch['round'],'at':t,'clientMs':wall,**parts})
        h=[r for r in host if start<=r['at']<=end]
        rq=[r for r in h if 'hostRunnableOnSet' in r]
        allq=[r for r in host if 'queues' in r and r['at']<=end]
        bg=[r for r in records['BP_BACKGROUND'] if start<=r['at']<=end]
        out['windows'][stage+'-'+kind]={'start':start,'end':end,'queueMs':describe(queues),
            'headers':{k:describe(v) for k,v in headers.items()},'paired':paired,
            'hostRunnableOnSet':describe(r['hostRunnableOnSet'] for r in rq),
            'sampledProcessRunnable':describe(r['sampledRunnable'] for r in h),
            'lastQueueSample':{k:allq[-1][k] for k in ['at','queues','lastCommit']} if allq else None,
            'backgroundSampleCount':len(bg)}
req=records['BP_REQUEST']
out['requestThreads']={'requests':len(req),'uniqueTids':len({r['tid'] for r in req}),
    'cpuSeconds':sum(r['cpuNs'] for r in req)/1e9,
    'byOperation':{}}
for r in req:
    row=out['requestThreads']['byOperation'].setdefault(r['op'],{'n':0,'cpuSeconds':0})
    row['n']+=1;row['cpuSeconds']+=r['cpuNs']/1e9
last_by_tid={r['tid']:r for r in records['BP_BACKGROUND']}
out['backgroundThreads']=last_by_tid
out['backgroundCpuSeconds']=sum(v[1] for r in last_by_tid.values() for v in r['kinds'].values())/1e9
out['affinities']=sorted({t['allowed'] for r in host for t in r['threads']})
out['threadNames']=dict(collections.Counter(t['name'] for r in host for t in r['threads']))
q=[r for r in host if 'queues' in r]
out['backlog']={'max':max(r['queues'].get('followingWork',0) for r in q),
                'maxParked':max(r['parkedFollowing'] for r in q)}
full_end=out['windows']['full-warm']['end']
after=[r for r in q if r['at']>=full_end]
empty=next((r for r in after if not any(r['queues'].values())),None)
if empty:
    out['backlog']['firstEmptyAfterFullProbesSeconds']=empty['at']-full_end
    before=[r for r in after if r['at']<empty['at']]
    out['backlog']['lastNonemptyAfterFullProbesSeconds']=before[-1]['at']-full_end if before else None
out['hostRunnableOnSet']=describe(r['hostRunnableOnSet'] for r in q)
out['kernelGlobalRunnable']=describe(int(line.split()[1]) for r in q
    for line in r['procStat'].splitlines() if line.startswith('procs_running '))
out['sampledProcessRunnable']=describe(r['sampledRunnable'] for r in host)
out['observerSampleSeconds']=describe(r['sampleSeconds'] for r in host)
cpu=[]
for a,b in zip(q,q[1:]):
    def counters(r):
        return {v[0]:list(map(int,v[1:])) for line in r['procStat'].splitlines()
                if (v:=line.split())[0] in [f'cpu{i}' for i in range(10)]}
    aa,bb=counters(a),counters(b)
    total=busy=0
    for key in aa:
        delta=[y-x for x,y in zip(aa[key][:8],bb[key][:8])]
        total+=sum(delta);busy+=sum(delta)-delta[3]-delta[4]
    if total:cpu.append({'at':b['at'],'busyPercentOfTen':100*busy/total})
out['selectedCpuBusyPercent']=describe(r['busyPercentOfTen'] for r in cpu)
out['selectedCpuSamples']=cpu
receipt=json.loads((base/'live/evidence/replay/result.json').read_text())
out['phaseCpuSetBusyPercent']={
    name:describe(r['busyPercentOfTen'] for r in cpu if start<=r['at']<=end)
    for name,start,end in [('replay',receipt['start'],receipt['end']),
                           ('drain',receipt['end'],host[-1]['at'])]}
for window in out['windows'].values():
    window['cpuSetBusyPercent']=describe(r['busyPercentOfTen'] for r in cpu
                                        if window['start']<=r['at']<=window['end'])
receipts=[json.loads(line) for line in (base/'live/evidence/replay/receipts.jsonl').open()]
out['probeDelays']={}
for stage in ['10%','50%','full']:
    first=out['windows'][stage+'-immediate']['start']
    last=max(r['settledAt'] for r in receipts if r['settledAt']<=first)
    out['probeDelays'][stage]={'lastActionSettledAt':last,'firstProbeAt':first,
                             'delayMs':round((first-last)*1000,3)}
process=base/'process-host.jsonl'
if process.exists():
    p=[json.loads(line) for line in process.read_text().splitlines()]
    last=p[-1]; seconds=(last['utime']+last['stime'])/__import__('os').sysconf('SC_CLK_TCK')
    out['serverCpuSecondsLastSample']={'at':last['at'],'seconds':seconds,
        'unattributedSecondsApprox':seconds-out['requestThreads']['cpuSeconds']-out['backgroundCpuSeconds']}
(base/'attribution.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps({k:v for k,v in out.items() if k not in ['windows','selectedCpuSamples','threadNames','requestThreads']},indent=2))

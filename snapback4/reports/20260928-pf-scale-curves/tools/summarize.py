"""Summarize the frozen percentile rule without selecting successful rounds."""
import csv, gzip, json, math, os, pathlib, statistics
base = pathlib.Path(os.environ.get('PF_ROOT', 'target/pf'))
out = pathlib.Path(__file__).resolve().parent.parent
stages = ['10pct', '50pct', 'full']
summary = {}
rows = []
tags = ['before', 'after'] + [t for t in ['control-before', 'control-after'] if (base / f'{t}-curve.json').exists()]
for tag in tags:
    raw = json.loads((base / f'{tag}-curve.json').read_text())
    summary[tag] = {'points': {}, 'rules': {}, 'load': {}}
    for stage in stages:
        batches = [r for r in raw['rounds'] if r['stage'] == stage]
        summary[tag]['load'][stage] = [min(r['host']['loadavg'][0] for r in batches), max(r['host']['loadavg'][0] for r in batches)]
        for op in ['search100', 'insights']:
            values = [r['probes'][op] for r in batches]
            times = sorted(t for v in values for t in v['times'])
            summary[tag]['points'][f'{stage}/{op}'] = {
                'p50': statistics.median(v['p50'] for v in values),
                'p95': statistics.median(v['p95'] for v in values),
                'max': max(times), 'pooledP95': times[math.ceil(len(times)*.95)-1],
                'meter': values[0]['meter'],
            }
            for r in batches:
                v = r['probes'][op]
                rows.append({'tag': tag, 'round': r['round'], 'stage': stage, 'op': op,
                    'p50_ms': v['p50'], 'p95_ms': v['p95'], 'max_ms': v['max'],
                    'load1': r['host']['loadavg'][0], 'load5': r['host']['loadavg'][1],
                    'load15': r['host']['loadavg'][2], 'utc': r['host']['at']})
    for op in ['search100', 'insights']:
        small, mid, full = [summary[tag]['points'][f'{s}/{op}']['p95'] for s in stages]
        ceiling = small + (full-small)*4/9
        rounds = []
        for n in range(9):
            a, b, z = [next(r for r in raw['rounds'] if r['round'] == n and r['stage'] == s)['probes'][op]['p95'] for s in stages]
            limit = a + (z-a)*4/9
            rounds.append({'round': n, 'small': a, 'mid': b, 'full': z, 'ceiling': limit, 'margin': limit-b,
                'midPass': b <= limit, 'ratio': z/a, 'ratioPass': z <= 3*a})
        summary[tag]['rules'][op] = {'ceiling': ceiling, 'mid': mid, 'margin': ceiling-mid,
            'midPass': mid <= ceiling, 'ratio': full/small, 'ratioMargin': 3-full/small,
            'ratioPass': full <= 3*small, 'passingRounds': sum(r['midPass'] for r in rounds), 'rounds': rounds}
    with gzip.GzipFile(filename=str(out/'evidence'/f'{tag}-curve.json.gz'),mode='wb',mtime=0) as f:
        f.write((base/f'{tag}-curve.json').read_bytes())
(out/'evidence/summary.json').write_text(json.dumps(summary,indent=2)+'\n')
with open(out/'evidence/batches.csv','w') as f:
    writer=csv.DictWriter(f,fieldnames=list(rows[0]),lineterminator='\n'); writer.writeheader();writer.writerows(rows)

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
plt.rcParams.update({'font.size':10, 'axes.spines.top':False,'axes.spines.right':False})
fig, axes = plt.subplots(1,2,figsize=(11,4.6),layout='constrained')
for ax,op,title in zip(axes,['search100','insights'],['Global message search','Insights']):
    for tag,color,offset in [('before','#2563eb',-1.2),('after','#c45b00',1.2)]:
        raw=json.loads((base/f'{tag}-curve.json').read_text())
        points=[summary[tag]['points'][f'{s}/{op}']['p95'] for s in stages]
        ax.plot([10,50,100],points,'o-',color=color,label=f'{tag}: median batch p95')
        ax.plot([10,100],[points[0],points[2]],':',color=color,alpha=.8)
        ax.scatter([50],[summary[tag]['rules'][op]['ceiling']],marker='_',s=180,color=color)
        for x,s in zip([10,50,100],stages):
            vals=[r['probes'][op]['p95'] for r in raw['rounds'] if r['stage']==s]
            ax.scatter([x+offset]*len(vals),vals,s=13,color=color,alpha=.22)
    ax.set(title=title,xlabel='Replay checkpoint (%)',ylabel='Client latency (ms)',xticks=[10,50,100],ylim=(0,None))
    ax.grid(axis='y',alpha=.2);ax.legend(fontsize=8,loc='upper left')
fig.suptitle('Before/after empty-preflight optimization: 9 rounds × 10 reads\nDots: batch p95 (= max of 10); dotted lines: frozen interpolation ceilings',fontsize=12)
fig.savefig(out/'curves.png',dpi=180)
fig.savefig(out/'curves.svg')
svg = out/'curves.svg'
svg.write_text('\n'.join(line.rstrip() for line in svg.read_text().splitlines())+'\n')
print(json.dumps({tag:summary[tag]['rules'] for tag in summary},indent=2))

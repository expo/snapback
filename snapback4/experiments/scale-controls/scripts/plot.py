#!/usr/bin/env python3
"""Standalone SVGs from report.py output; no database access or measurements."""
import json
from pathlib import Path
import sys
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt

root=Path(sys.argv[1])
curves=json.loads((root/'curves.json').read_text())
ledger=json.loads((root/'ledger.json').read_text())
target=('Convex/PG (self-hosted)' if any(r['cell'].get('target')=='convex' for r in ledger) else 'Supabase (PostgREST only)' if any(r['cell'].get('target')=='supabase' for r in ledger) else 'Raw PG')
colors={0:'#145da0',200:'#00876c',500:'#dc6b1c',1000:'#9b3e88'}
labels={0:'natural',200:'+0.2 ms',500:'+0.5 ms',1000:'+1.0 ms'}
plt.rcParams.update({'font.size':10,'svg.fonttype':'none','axes.spines.top':False,'axes.spines.right':False})
sizes=sorted({c['cell']['rows'] for c in curves if c['cell']['workload'] in ('W1','W2','W3')}) or [1000000]
fig,axes=plt.subplots(len(sizes),3,figsize=(15,4*len(sizes)),sharey=True,squeeze=False)
for row,rows in enumerate(sizes):
    for col,w in enumerate(['W1','W2','W3']):
        ax=axes[row,col]
        for delay in colors:
            matches=[v for v in curves if v['cell']['workload']==w and v['cell']['rows']==rows and v['cell']['delay_us']==delay]
            if not matches: continue
            c=matches[0]
            rates=c['rates']; x=[v['offered_per_s'] for v in rates]; y=[v['p99_ms'] for v in rates]
            ax.plot(x,y,color=colors[delay],label=labels[delay],linewidth=1.4)
            for p in rates:
                ax.scatter(p['offered_per_s'],p['p99_ms'],marker='o' if p['all_pass'] else 'x',s=24,color=colors[delay])
        ax.axhline(50,color='#333333',linestyle='--',linewidth=.8)
        ax.set(xscale='log',yscale='log',xlabel='offered operations/s',title=f'{w}, {rows:,} messages')
        if col==0: ax.set_ylabel('p99 latency (ms), median of 3')
        ax.grid(alpha=.2)
axes[0,0].legend(fontsize=9)
fig.suptitle(f'{target} read curves — circles: all 3 runs pass; crosses: at least one fails\n0.5 s warm-up + 2 s measurement; shared hosts; dashed line: 50 ms SLO',fontsize=12)
fig.tight_layout(rect=(0,0,1,.91))
fig.savefig(root/'read-curves.svg',metadata={'Date':None})
plt.close(fig)
fig,axes=plt.subplots(1,3,figsize=(15,4.8))
for ax,(w,key,title) in zip(axes,[('W4','disjoint','W4: disjoint counters'),('W5','same','W5: one shared counter'),('W5','hot1','W5: 1% shared counter')]):
    for delay in colors:
        rows=sorted([r for r in ledger if r['cell']['workload']==w and r['cell']['keys']==key and r['cell']['delay_us']==delay and 'achieved_median' in r],key=lambda r:r['cell']['writers'])
        if not rows: continue
        ax.plot([r['cell']['writers'] for r in rows],[r['achieved_median'] for r in rows],marker='o',color=colors[delay],label=labels[delay])
    ax.set(xscale='log',yscale='log',xlabel='configured writer workers',ylabel='highest passing offered/cohort acks/s',title=title)
    ax.set_xticks([1,4,16,64,256],[1,4,16,64,256])
    ax.grid(alpha=.2)
axes[0].legend(fontsize=9)
fig.suptitle(f'{target} write brackets — every repetition meets p99 ≤ 100 ms and errors ≤ 0.1%\nCoarse tested brackets on shared hosts; not interpolated production capacity',fontsize=12)
fig.tight_layout(rect=(0,0,1,.87))
fig.savefig(root/'write-brackets.svg',metadata={'Date':None})
plt.close(fig)
# Keep generated SVG XML free of generator trailing whitespace.
for path in root.glob('*.svg'):
    path.write_text('\n'.join(line.rstrip() for line in path.read_text().splitlines())+'\n')
(root/'plot-version.txt').write_text('matplotlib '+matplotlib.__version__+'\n')
print('wrote read-curves.svg and write-brackets.svg')

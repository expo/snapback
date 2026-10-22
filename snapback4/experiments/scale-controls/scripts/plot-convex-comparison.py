#!/usr/bin/env python3
"""Fixed-budget S1 columns from derived ledgers; no measurement work."""
import json,sys
from pathlib import Path
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
root=Path(sys.argv[1]);rows=json.loads((root/'headlines.json').read_text())
plt.rcParams.update({'font.size':10,'svg.fonttype':'none','axes.spines.top':False,'axes.spines.right':False})
def window_label():
    for path in sorted(root.glob('*/rate-*.json')):
        try: o=json.loads(path.read_text())['options']
        except (OSError,KeyError,json.JSONDecodeError): continue
        return f"{o['warmup_ms']/1000:g} s warm-up + {o['duration_ms']/1000:g} s measurement"
    return 'recorded warm-up and measurement'
window=window_label()
fig,axes=plt.subplots(2,3,figsize=(14,8))
systems=[('raw_pg','Raw PG','#56616b'),('supabase_advocate','Supabase advocate','#16866a'),('convex_pg','Convex/PG','#a04b9b')]
for ax,(w,k,title) in zip(axes.flat,[('W1','disjoint','W1: visible message'),('W2','disjoint','W2: newest 20'),('W3','disjoint','W3: 32-room inbox'),('W4','disjoint','W4: disjoint counters'),('W5','same','W5: shared counter'),('W5','hot1','W5: 1% shared mix')]):
    selected={r['cell']['delay_us']:r for r in rows if r['cell']['workload']==w and r['cell']['keys']==k}
    for j,(name,label,color) in enumerate(systems):
        for i,delay in enumerate([0,500]):
            r=selected.get(delay,{}).get(name)
            value=r['summary']['highest_passing_offered_per_s'] if r else None
            y=i+(j-1)*.22
            if value:
                ax.barh(y,value,height=.19,color=color,label=label if i==0 else None)
                ax.text(value*1.05,y,f'{value:,}',va='center',fontsize=8)
            else:ax.text(1,y,'no pass' if r else 'unmeasured',va='center',fontsize=8,color=color)
    ax.set_yticks([0,1],['natural','+0.5 ms']);ax.invert_yaxis()
    ax.set(xscale='log',xlim=(.7,60000),xlabel='highest tested passing offered ops/s',title=title)
    ax.grid(axis='x',alpha=.18)
axes[0,0].legend(fontsize=8)
fig.suptitle(f'S1: fixed budget, 1m messages — three repetitions, {window}\nReads: 128 clients / cap 32; writes: C=32. Shared hosts; Convex caches retained across repetitions.',fontsize=12)
fig.tight_layout(rect=(0,0,1,.91));fig.savefig(root/'matched-budget.svg',metadata={'Date':None});plt.close(fig)
p=root/'matched-budget.svg';p.write_text('\n'.join(s.rstrip() for s in p.read_text().splitlines())+'\n')

# Show the latency rejected by the SLO alongside the low passing brackets.
curves=json.loads((root/'curves.json').read_text())
panels=[('W4','disjoint','W4: disjoint counters'),('W5','same','W5: shared counter'),('W5','hot1','W5: nominal 1% shared mix')]
if any(x['cell']['keys']=='sharded' and x['cell'].get('writers')==32 for x in curves):
    panels.append(('W5','sharded','W5: sharded counter (labelled)'))
fig,axes=plt.subplots(1,len(panels),figsize=(4.6*len(panels),4.8))
if len(panels)==1: axes=[axes]
for ax,(w,k,title) in zip(axes,panels):
    for delay,color,label in [(0,'#145da0','natural'),(500,'#dc6b1c','+0.5 ms')]:
        match=next(x for x in curves if x['cell']['workload']==w and x['cell']['keys']==k and x['cell']['rows']==1000000 and x['cell']['writers']==32 and x['cell']['delay_us']==delay)
        rates=match['rates']
        ax.plot([x['offered_per_s'] for x in rates],[x['p99_ms'] for x in rates],color=color,label=label)
        for x in rates:ax.scatter(x['offered_per_s'],x['p99_ms'],color=color,marker='o' if x['all_pass'] else 'x',s=28)
    ax.axhline(100,color='#333333',linestyle='--',linewidth=.8)
    ax.set(xscale='log',yscale='log',xlabel='offered operations/s',ylabel='intended-arrival p99 ms, median of 3',title=title)
    ax.grid(alpha=.2)
axes[0].legend(fontsize=9)
fig.suptitle(f'Convex/PG writes: 1m messages, C=32; {window}\nCircle: all repetitions pass; cross: at least one fails. Sharded is a labelled row, not the headline counter.',fontsize=12)
fig.tight_layout(rect=(0,0,1,.86));fig.savefig(root/'write-latency.svg',metadata={'Date':None});plt.close(fig)
p=root/'write-latency.svg';p.write_text('\n'.join(s.rstrip() for s in p.read_text().splitlines())+'\n')

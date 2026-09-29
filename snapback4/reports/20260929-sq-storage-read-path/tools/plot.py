import pathlib,json,statistics
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
b=pathlib.Path('target/sq');out=pathlib.Path(__file__).resolve().parent.parent
live=[json.loads((b/f'{stage}-live-warm-curve.json').read_text()) for stage in ['10%','50%','full']]
restart=json.loads((b/'restarted-curve.json').read_text())
names=list(live[0]['rounds'][0]['probes']);fig,axes=plt.subplots(2,4,figsize=(15,7),constrained_layout=True)
for name,ax in zip(names,axes.flat):
 for label,color,data in [('Live, after burst','#b34f19',[x['rounds'] for x in live]),('Drained, restarted','#146b8a',[[r for r in restart['rounds'] if r['stage']==s] for s in ['replayed-10pct','replayed-50pct','replayed-full']])]:
  points=[]
  for scale,rows in zip([10,50,100],data):
   values=[r['probes'][name]['p95'] for r in rows];points.append(statistics.median(values));ax.scatter([scale]*len(values),values,color=color,alpha=.3,s=16)
  ax.plot([10,50,100],points,'o-',color=color,label=label)
  if name in ['search100','insights','trending']:ax.plot([10,100],[points[0],points[2]],color=color,ls=':',alpha=.6)
 ax.set(title=name,xlabel='checkpoint (%)',ylabel='batch p95 (ms)',xticks=[10,50,100]);ax.grid(alpha=.2)
axes.flat[-1].axis('off');axes.flat[-1].legend(*axes.flat[0].get_legend_handles_labels(),loc='center');axes.flat[-1].text(.05,.12,'Nine batches; three warmups.\nRestart checkpoint order rotates.\nEach p95 is max of ten. Dots: every batch.\nDotted lines: unchanged midpoint ceiling.\nLinux evidence; no macOS fix claim.',transform=axes.flat[-1].transAxes,fontsize=10)
fig.suptitle('Live delivery invalidates caches; the several-fold macOS curve did not reproduce')
fig.savefig(out/'curves.png',dpi=170)

from pathlib import Path
import json,statistics,datetime,os
out=Path('/Users/ccheever/sb4-np/lane-nx/snapback4/reports/20261001-nx-export-proves-native/round5b')
rows=sorted([json.loads(p.read_text()) for p in out.glob('*sample*.json')],key=lambda r:r['startedAt'])
summary=[]
median=lambda a:statistics.median(a) if a else None
for starter in ['plain','social']:
 for rev in ['r4','r5']:
  allrows=[r for r in rows if r['starter']==starter and r['revision']==rev]
  for scope,rr in [('initial',[r for r in allrows if r.get('cohort','initial')=='initial']),('quiet-control',[r for r in allrows if r.get('cohort')=='quiet-control']),('quiet-control-valid',[r for r in allrows if r.get('cohort')=='quiet-control' and not r['contended']])]:
   summary.append(dict(starter=starter,revision=rev,scope=scope,n=len(rr),medianMs=median([r['durationMs'] for r in rr]),nativeMedianMs=median([r['nativeDurationMs'] for r in rr]),outsideMedianMs=median([r['outsideMs'] for r in rr]),rangeMs=[min([r['durationMs'] for r in rr],default=0),max([r['durationMs'] for r in rr],default=0)],nativePreparationMedianMs=median([r['nativeTimestamps']['startedAt']-r['nativeTimestamps']['invokedAt'] for r in rr]),nativeLifecycleMedianMs=median([r['nativeTimestamps']['endedAt']-r['nativeTimestamps']['startedAt'] for r in rr]),beforeNativeMedianMs=median([r['nativeTimestamps']['invokedAt']-r['startedAt'] for r in rr]),afterNativeMedianMs=median([r['endedAt']-r['nativeTimestamps']['endedAt'] for r in rr]),nativeEndToPublicationMedianMs=median([r['publicationVerifiedAt']-r['nativeTimestamps']['endedAt'] for r in rr]),segmentsMedianMs={s:median([r['segments'][s]['durationMs'] for r in rr]) for s in ['prime','offline','restart']},distinctBundles=len({r['exportHash'] for r in rr}),load1Range=[min([r['hostBefore']['load'][0] for r in rr],default=0),max([r['hostBefore']['load'][0] for r in rr],default=0)]))
for r in rows:
 assert r['cache']['hit'] and r['status']==0 and r['exitStatus']==0
 assert len(r['segments'])==3 and all(s['status']=='passed' for s in r['segments'].values())
 assert r['exportHash']==r['loadedHash'] and r['proofHash']==r['publicationProofHash'] and r['proofHash']
 assert r['nativeTimestamps']['endedAt']-r['nativeTimestamps']['invokedAt']==r['nativeDurationMs']
 assert r['nativeTimestamps']['endedAt']<=r['publicationVerifiedAt']<=r['endedAt']
for stat in summary:
    rr=[r for r in rows if r['revision']==stat['revision'] and r['starter']==stat['starter'] and (r.get('cohort','initial')=='initial' if stat['scope']=='initial' else r.get('cohort')=='quiet-control' and (stat['scope']!='quiet-control-valid' or not r['contended']))]
    ordered=sorted(rr,key=lambda r:r['durationMs'])
    middle=ordered[(len(ordered)-1)//2:len(ordered)//2+1] if ordered else []
    stat['totalMedianSamples']=[r['label'] for r in middle]
    stat['nativeAtTotalMedianMs']=statistics.mean(r['nativeDurationMs'] for r in middle) if middle else None
    stat['outsideAtTotalMedianMs']=statistics.mean(r['outsideMs'] for r in middle) if middle else None
    stat['contendedCount']=sum(r['contended'] for r in rr)
(out/'timings.json').write_text(json.dumps({'count':len(rows),'quietDefinition':'load1 <= 6 immediately before and immediately after; all contended samples retained separately','summaries':summary,'sequence':[r['revision']+'-'+r['starter']+'-'+r['label'] for r in rows]},indent=2)+'\n')
text=['| # | Revision / starter / sample | Pre-load 1 / 5 / 15 | Post-load1 | Total s | Native s | Outside s | Status |','| ---: | --- | --- | ---: | ---: | ---: | ---: | --- |']
for i,r in enumerate(rows):
 name=r['revision']+'-'+r['starter']+'-'+r['label'];loads=' / '.join(f'{x:.2f}' for x in r['hostBefore']['load'])
 text.append(f"| {i+1} | [{name}](round5b/{name}.json) | {loads} | {r['hostAfter']['load'][0]:.2f} | {r['durationMs']/1000:.3f} | {r['nativeDurationMs']/1000:.3f} | {r['outsideMs']/1000:.3f} | {'contended' if r['contended'] else 'quiet'} |")
Path('/Users/ccheever/sb4-np/nx-r5b/table.md').write_text('\n'.join(text)+'\n')
for s in summary:
 if s['scope']=='quiet-control-valid':print(s['revision'],s['starter'],'quiet n=',s['n'],'median s=',s['medianMs']/1000 if s['medianMs'] else None)
print('all',len(rows),'contended',sum(r['contended'] for r in rows))

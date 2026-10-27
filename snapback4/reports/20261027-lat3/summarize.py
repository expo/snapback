"""Summarize completed paired commands; failures never become speed wins."""
import argparse,collections,json,math,pathlib,statistics
ap=argparse.ArgumentParser();ap.add_argument('--out',required=True);a=ap.parse_args()
rows=[]
for p in sorted(pathlib.Path('/tmp/lat3').glob('corpus-[0-9].jsonl')):
 rows.extend(json.loads(line) for line in p.read_text().splitlines())
def stats(values):
 if not values:return None
 values=sorted(values)
 return {'n':len(values),'median':statistics.median(values),'p90':values[math.ceil(.9*len(values))-1],'max':max(values)}
tables={}
for scope,waves in [('all',[30,31,32,33,34]),('day-one',[32,34]),('day-two',[33])]:
 selected=[x for x in rows if x.get('wave') in waves]
 table={}
 for script in ['acceptance','frontend:proof','day2:proof','probe:serve/client:calls']:
  pairs=[x for x in selected if x.get('script')==script and x['before']['code']==0 and x['after']['code']==0]
  metrics=['seconds'] if script!='probe:serve/client:calls' else ['seconds','readySeconds','callsSeconds']
  for metric in metrics:
   complete=[p for p in pairs if metric in p['before'] and metric in p['after']]
   table[script+'/'+metric]={v:stats([x[v][metric] for x in complete]) for v in ['before','after']}
 tables[scope]=table
summary={'completedPairs':sum('script'in x for x in rows),'lanes':len({(x['wave'],x['lane']) for x in rows}),
 'setupErrors':[x for x in rows if 'setupError'in x],
 'exitDifferences':[{k:x[k] for k in ['wave','lane','script','before','after']} for x in rows if not x.get('sameExit',True)],
 'nonzeroPairs':[{'wave':x['wave'],'lane':x['lane'],'script':x['script'],'beforeCode':x['before']['code'],'afterCode':x['after']['code']} for x in rows if 'script'in x and (x['before']['code']!=0 or x['after']['code']!=0)],
 'messageDifferenceCount':sum(not x.get('sameMessages',True) for x in rows),'tables':tables}
pathlib.Path(a.out).write_text(json.dumps(summary,indent=2)+'\n')
print(json.dumps({k:summary[k] for k in ['completedPairs','lanes','setupErrors','messageDifferenceCount']}))

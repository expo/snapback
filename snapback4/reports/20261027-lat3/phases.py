"""Numerical phase summaries only; traced argv and app logs remain private."""
import argparse, collections, json, pathlib
ap=argparse.ArgumentParser();ap.add_argument('--out',type=pathlib.Path,required=True);a=ap.parse_args()
root=pathlib.Path('/tmp/lat3/phase-profiles');results=[]
for line in (root/'results.jsonl').read_text().splitlines():
 r=json.loads(line);case=root/f"w{r['wave']}-{r['lane']}";key=r['script'].replace(':','-').replace('/','-')+'-'+r['variant']
 events=[json.loads(s) for s in (case/(key+'.node.jsonl')).read_text().splitlines()]
 native=[json.loads(s) for s in (case/(key+'.native.jsonl')).read_text().splitlines()]
 phases=collections.defaultdict(float);by_pid=collections.defaultdict(lambda:collections.defaultdict(float))
 for e in native:
  phases[e['phase']]+=e['seconds'];by_pid[e['pid']][e['phase']]+=e['seconds']
 nodes=[e for e in events if e['event']=='node'];roles=collections.Counter()
 for e in nodes:
  name=pathlib.Path(e['argv'][1]).name if len(e['argv'])>1 else 'unknown'
  roles[name if name in ['npm','npm-cli.js','proof-command.js','proof-keeper.js','snapback4.js'] else 'app-or-tool']+=1
 wanted={'acceptance':'acceptance.mjs','frontend:proof':'frontend-proof.mjs','day2:proof':'day2-proof.mjs','probe:serve/client:calls':'probe.mjs'}[r['script']]
 main=next((e for e in nodes if len(e['argv'])>1 and pathlib.Path(e['argv'][1]).name==wanted),None)
 pairings=[('browser.launch','browser.launched'),('browser.context','context.close'),('browser.close','browser.closed')]
 durations={}
 for start,end in pairings:
  opened={};values=[]
  for e in events:
   if e['event']==start:opened[e['pid']]=e['at']
   if e['event']==end and e['pid']in opened:values.append((e['at']-opened.pop(e['pid']))/1000)
  durations[start+'Seconds']=values
 spawns=[e for e in events if e['event']=='spawn'];closes={e.get('child'):e for e in events if e['event']=='close'}
 deploys=[]
 for e in spawns:
  if pathlib.Path(e['command']).name!='snapback4' or e.get('args',[None])[0]!='deploy' or e.get('child')not in closes:continue
  p=by_pid[e['child']];total=closes[e['child']]['ms']/1000;bind=p.get('deploy.bind',0);security=p.get('deploy.security',0)
  deploys.append({'seconds':total,'bindSeconds':bind,'securitySeconds':security,'unattributedSeconds':total-bind-security})
 fetches=[e for e in events if e['event']=='fetch'];requests=collections.defaultdict(lambda:{'n':0,'summedSeconds':0})
 for e in fetches:
  group='auth' if '/auth/'in e['path'] else 'health' if 'health'in e['path'] else 'other'
  requests[group]['n']+=1;requests[group]['summedSeconds']+=e['ms']/1000
 first_spawn=next((e for e in spawns if main and e['pid']==main['pid']),None)
 activity=[e['at'] for e in events if main and e['pid']==main['pid'] and e['event']not in ['beforeExit','exit','node']]
 exit_at=max((e['at'] for e in events if main and e['pid']==main['pid'] and e['event']=='exit'),default=0)
 result={k:r[k] for k in ['wave','lane','script','variant','code','seconds']}
 result.update(nativePhaseSeconds=dict(phases),nodeProcessesByRole=dict(roles),nativeDeploys=deploys,
  nodeHttpRequests=dict(requests),**durations,
  npmAndNodeToAppSeconds=(main['at']-r['startedAt'])/1000 if main else None,
  appImportToFirstSpawnSeconds=(first_spawn['at']-main['at'])/1000 if first_spawn else None,
  unobservedNodeTailSeconds=(exit_at-max(activity))/1000 if activity and exit_at else None,
  storeOpenOrCreateSeconds=None)
 for k in ['readySeconds','callsSeconds','readyPreflightSeconds']:
  if k in r:result[k]=r[k]
 results.append(result)
a.out.write_text(json.dumps({'qualification':False,'notes':[
 'Selected diagnostic traces are separate from uninstrumented paired corpus timings.',
 'Node preload occurs before application imports but after early Node loader work.',
 'HTTP request sums may overlap; browser context intervals include setup and assertions.',
 'Store open/create, native bootstrap, deployment materialization and output are not separately timed; they remain in nativeDeploys.unattributedSeconds.',
 'Unobserved Node tail is measured after the last traced app event; attribution to uncleared timers also requires inspecting app source.',
 ],'results':results},indent=2)+'\n')
print(f'Wrote {len(results)} phase profiles')

import importlib.util,json,re,glob,os
from pathlib import Path
path='/home/ccheever/sb4-loop/wave34-repro/tx/parse.py'
import types
mod=types.ModuleType('wave34_full_commands')
parser=Path(path).read_text()
assert parser.count("'cmd': red(cmdtxt)[:300]")==1 and parser.count("'cmd': red(c['cmd'] or c['name'])[:300]")==1
parser=parser.replace("'cmd': red(cmdtxt)[:300]","'cmd': red(cmdtxt)").replace("'cmd': red(c['cmd'] or c['name'])[:300]","'cmd': red(c['cmd'] or c['name'])")
os.environ['OUT']='/tmp/ver1-evidence/parser-output'
exec(compile(parser,path,'exec'),mod.__dict__)
classifier={'__name__':'ver1_calls'}
code=Path('/home/ccheever/sb4-loop/wave34-repro/tx/scripts/calls.py').read_text().replace('from agg import macro','')
exec(compile(code,'calls.py','exec'),classifier)
records=[]
for launch in sorted(Path('/tmp/ver1-evidence').glob('*-launch.json')):
 d=json.loads(launch.read_text());a=d['a'];stem=launch.name.removesuffix('-launch.json');result=launch.with_name(stem+'-result.json')
 if not result.exists():continue
 result=json.loads(result.read_text());native=None
 if a['model']=='codex':
  for p in glob.glob('/home/ccheever/.codex/sessions/2026/10/*/*.jsonl'):
   try:
    with open(p) as f:meta=json.loads(f.readline())
    if meta.get('payload',{}).get('cwd')==d['dir']:native=p
   except:pass
  if not native:raise Exception('missing native session '+stem)
  session=mod.parse_codex(native);nativePaths=[native]
 else:
  ids=[]
  for line in open('/tmp/ver1-evidence/'+stem+'.ndjson'):
   try:event=json.loads(line)
   except:continue
   sid=event.get('stream',{}).get('id')
   if event.get('stream',{}).get('kind')=='session' and sid not in ids:ids.append(sid)
  nativeFiles=[file for sid in ids for file in glob.glob('/home/ccheever/.local/share/muse/sessions/2026/10/*/'+sid+'/session.jsonl')]
  if not nativeFiles:raise Exception('missing Muse native session '+stem)
  parts=[mod.parse_muse(file) for file in nativeFiles]
  native=nativeFiles[-1];nativePaths=nativeFiles
  session={'calls':[],'tools':[],'t0':min((p['t0']or 0)for p in parts),'t1':max((p['t1']or 0)for p in parts)}
  for part in parts:
   offset=len(session['calls']);session['tools'] += [dict(t,k=t['k']+offset)for t in part['tools']];session['calls']+=part['calls']

 # The wave parser's nested verify regex misses the short spelling itself.
 # Correct that exact entry-point classification before both arms' attribution.
 for tool in session['tools']:
  if not tool.get('w') and not tool['cat'].startswith(('read-','poll:')) and re.search(r'npm\s+run\s+(?:--silent\s+)?verify\b',mod.strip_heredoc(tool.get('cmd',''))):tool['cat']='proofs:verify'
 attributed=mod.attribute(session);session['N']=len(session['calls'])
 purpose,cycles=classifier['lane_calls']({'sessions':[session]},'snapback')
 tools=session['tools'];installPolls=[];serveWaits=[]
 for tool in tools:
  cmd=mod.strip_heredoc(tool.get('cmd',''))
  if tool['cat'].startswith('poll:'):
   origin=tools[tool['origin']] if tool.get('origin') is not None else tool
   if origin['cat'] in ('npm-install','sb:init') or 'scripts/install.mjs' in origin.get('cmd',''):installPolls.append({'call':tool['k'],'category':origin['cat']})
  if tool['cat']=='proofs:probe-serve' and not re.search(r'(?<![&<>])&(?![&>])',cmd):
   end=tool.get('bg_end') or tool.get('t1');start=tool.get('bg_start') or tool.get('t0')
   serveWaits.append({'call':tool['k'],'ms':round(end-start) if start and end else None,'exit':tool.get('final_exit',tool.get('exit'))})
 calls=session['calls'];cached=sum(c.get('cached')or 0 for c in calls)
 row={'phase':stem.rsplit('-',1)[0],'lane':a['id'],'model':a['model'],'frontend':a['frontend'],'calls':attributed['N'],'input':attributed['sumC'],'cachedInput':cached,'output':sum(c['out']for c in calls),'wallMs':result['wallMs'],'exit':result['status'],'report':result['report'],'initialPackageInstalled':d['initialPackageInstalled'],'purpose':dict(purpose),'verifyCalls':purpose['verify'],'verifyEntryRuns':sum(t['cat']=='proofs:verify' for t in tools),'installToolPolls':installPolls,'installStatusCalls':sum(bool(re.search(r'install\.mjs\s+--status',mod.strip_heredoc(t.get('cmd','')))) for t in tools if not t.get('w')),'installJoinCalls':sum(bool(re.search(r'install\.mjs\s+--wait',mod.strip_heredoc(t.get('cmd','')))) for t in tools if not t.get('w')),'foregroundProbeWaits':serveWaits,'nativeSessionFile':Path(native).name,'perCall':[dict(index=i+1,input=c['in'],cachedInput=c.get('cached')or 0,output=c['out'],toolCategories=[t['cat']for t in tools if t['k']==i+1])for i,c in enumerate(calls)]}
 records.append(row)
print(json.dumps(records,indent=2));Path('/tmp/ver1-evidence/model-replays.json').write_text(json.dumps(records,indent=2)+'\n')

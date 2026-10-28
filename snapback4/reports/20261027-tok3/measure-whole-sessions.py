import importlib.util,json,re,glob,os
from pathlib import Path
path='/home/ccheever/sb4-loop/wave34-repro/tx/parse.py'
spec=importlib.util.spec_from_file_location('wave34',path);mod=importlib.util.module_from_spec(spec);spec.loader.exec_module(mod)
records=[]
for launch in sorted(Path('/tmp/tok3-evidence').glob('*-launch.json')):
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
  session=mod.parse_codex(native)
 else:
  ids=[]
  for line in open('/tmp/tok3-evidence/'+stem+'.ndjson'):
   try:event=json.loads(line)
   except:continue
   sid=event.get('stream',{}).get('id')
   if event.get('stream',{}).get('kind')=='session' and sid not in ids:ids.append(sid)
  nativeFiles=[file for sid in ids for file in glob.glob('/home/ccheever/.local/share/muse/sessions/2026/10/*/'+sid+'/session.jsonl')]
  if not nativeFiles:raise Exception('missing Muse native session '+stem)
  parts=[mod.parse_muse(file) for file in nativeFiles]
  native=nativeFiles[-1]
  session={'calls':[],'tools':[],'t0':min((p['t0']or 0)for p in parts),'t1':max((p['t1']or 0)for p in parts)}
  for part in parts:
   offset=len(session['calls']);session['tools'] += [dict(t,k=t['k']+offset)for t in part['tools']];session['calls']+=part['calls']
 attributed=mod.attribute(session)
 tools=session['tools']; first=None
 for t in tools:
  c=t.get('cmd','')
  if (t.get('w') or mod.has_write(c)) and re.search(r'schema\.q',c):first=t['k'];break
 reads={'guide':0,'guideAfterSchema':0,'declarations':0,'readme':0,'serverReference':0,'clientReference':0}
 commands=[]
 for t in tools:
  cmd=mod.strip_heredoc(t.get('cmd',''))
  n=len(re.findall(r'(?:snapback4|/snapback4)\s+guide\b',cmd))
  reads['guide']+=n
  if first is not None and t['k']>=first:reads['guideAfterSchema']+=n
  if t['cat']=='sb:pkg-source' and '.d.ts' in cmd:reads['declarations']+=1
  for key,file in [('readme','README.md'),('serverReference','SERVER.md'),('clientReference','CLIENT-AND-OPERATIONS.md')]:
   if 'node_modules/snapback4/' in cmd and file in cmd:reads[key]+=1
  if n:commands.append({'call':t['k'],'command':mod.red(cmd[:500])})
 calls=session['calls'];cached=sum(c.get('cached')or 0 for c in calls)
 row={'phase':stem.rsplit('-',1)[0],'lane':a['id'],'model':a['model'],'frontend':a['frontend'],'calls':attributed['N'],'input':attributed['sumC'],'cachedInput':cached,'uncachedInput':attributed['sumC']-cached,'output':sum(c['out']for c in calls),'wallMs':result['wallMs'],'exit':result['status'],'report':result['report'],'initialPackageInstalled':d['initialPackageInstalled'],'firstSchemaCall':first,'reads':reads,'guideCommands':commands,'nativeSessionFile':Path(native).name,'perCall':[dict(index=i+1,input=c['in'],cachedInput=c.get('cached')or 0,output=c['out'],toolCategories=[t['cat']for t in tools if t['k']==i+1],diagnostics=sorted(set(code for t in tools if t['k']==i+1 for code in t.get('pcodes',[]))))for i,c in enumerate(calls)]}
 records.append(row)
print(json.dumps(records,indent=2));Path('/tmp/tok3-evidence/model-replays.json').write_text(json.dumps(records,indent=2)+'\n')

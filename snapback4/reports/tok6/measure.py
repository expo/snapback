"""Native whole-session accounting. Frozen harness prices, per-request thresholds.
Reuses the analysis parser's tool/read classification; never emits tool bodies.
"""
import glob,json,os,re,types,hashlib
from pathlib import Path
root=Path(__file__).resolve().parents[2]; evidence=root/'target/tok6/evidence'
os.environ['OUT']=str(evidence/'parser-unused');parser_path=Path.home()/'sb4-loop/wave34-repro/tx/parse.py'
source=parser_path.read_text();source=source.replace("'cmd': red(cmdtxt)[:300]","'cmd': red(cmdtxt)").replace("'cmd': red(c['cmd'] or c['name'])[:300]","'cmd': red(c['cmd'] or c['name'])")
mod=types.ModuleType('native_parser');exec(compile(source,str(parser_path),'exec'),mod.__dict__)
prices_path=Path.home()/'sb4-loop/bakeoff/prices.json';price_bytes=prices_path.read_bytes();prices=json.loads(price_bytes)
records=[]
for launch in sorted(evidence.glob('*-launch.json')):
 d=json.loads(launch.read_text());a=d['a'];stem=launch.name.removesuffix('-launch.json');result=launch.with_name(stem+'-result.json')
 if not result.exists():continue
 result=json.loads(result.read_text());log=launch.with_name(stem+'.ndjson');events=[]
 for line in log.open():
  try:events.append(json.loads(line))
  except:pass
 terminal=None
 if a['model']=='codex':
  matches=[]
  for path in glob.glob(str(Path.home()/'.codex/sessions/*/*/*/*.jsonl')):
   try:
    with open(path) as f:meta=json.loads(f.readline())
    if meta.get('payload',{}).get('cwd')==d['dir']:matches.append(path)
   except:pass
  assert len(matches)==1,(stem,matches)
  native_paths=matches;session=mod.parse_codex(matches[0]);model='gpt-6.1-sol'
  completions=[e for e in events if e.get('type')=='turn.completed'];terminal=completions[-1].get('usage') if completions else None
 else:
  ids=[]
  for event in events:
   stream=event.get('stream',{})
   if stream.get('kind')=='session' and stream.get('id') not in ids:ids.append(stream['id'])
  native_paths=[p for sid in ids for p in glob.glob(str(Path.home()/f'.local/share/muse/sessions/*/*/*/{sid}/session.jsonl'))]
  assert native_paths,(stem,ids)
  parts=[mod.parse_muse(p) for p in native_paths];session={'calls':[],'tools':[]}
  for part in parts:
   offset=len(session['calls']);session['tools'] += [dict(t,k=t['k']+offset)for t in part['tools']];session['calls']+=part['calls']
  model='muse-spark-1.3-contributor'
 calls=session['calls'];cached=sum(c.get('cached')or 0 for c in calls);input_total=sum(c['in'] for c in calls);output=sum(c['out'] for c in calls)
 if terminal:
  assert (input_total,cached,output)==(terminal['input_tokens'],terminal['cached_input_tokens'],terminal['output_tokens']),(stem,'native/terminal mismatch',(input_total,cached,output),terminal)
 costs={'uncached':0,'cached':0,'output':0};long_requests=0;per_call=[]
 for i,c in enumerate(calls):
  rate=prices['models'][model];long=rate.get('longContext')
  if long and c['in']>long['inputTokensGreaterThan']:rate=long;long_requests+=1
  parts={k:n*rate[r]/1000000 for k,n,r in [('uncached',c['in']-(c.get('cached')or 0),'input'),('cached',c.get('cached')or 0,'cachedInput'),('output',c['out'],'output')]}
  for k,v in parts.items():costs[k]+=v
  per_call.append({'index':i+1,'input':c['in'],'cached':c.get('cached')or 0,'output':c['out'],'reasoningSubset':c.get('reason'),'usd':parts})
 tools=session['tools'];reads={'referenceFile':0,'serverReferenceFile':0,'fullReferenceCats':0,'referenceGuide':0,'wiringLookups':0,'wiringCalls':0,'generatedApiReads':0,'guideTotal':0};wiring_calls=set();commands=[]
 for t in tools:
  cmd=mod.strip_heredoc(t.get('cmd',''))
  guides=re.findall(r'(?:snapback4|/snapback4)\s+guide\b',cmd);reads['guideTotal']+=len(guides)
  wiring=re.findall(r'(?:snapback4|/snapback4)\s+guide\s+api\s+[\'"]?(?:client|react|auth|generated)\b',cmd)
  reads['wiringLookups']+=len(wiring)
  if wiring:wiring_calls.add(t['k'])
  reference=len(re.findall(r'(?:snapback4|/snapback4)\s+guide\s+package-reference\b',cmd));reads['referenceGuide']+=reference
  read_command=not t.get('w') and not mod.has_write(cmd) and not t['cat'].startswith('poll:') and (t['cat'].startswith(('read-file:','read-shell:','sb:pkg-source','sb:docs-files')) or re.search(r'\b(?:cat|sed\s+-n|head|tail|rg|grep)\s',cmd))
  if read_command and re.search(r'(?:snapback/)?generated/api\.ts',cmd):reads['generatedApiReads']+=1
  is_reference=bool(re.search(r'(?:SERVER|CLIENT-AND-OPERATIONS|FOLLOWING-ADOPTION|OFFLINE-UPLOADS|CHANGELOG)\.md',cmd) or re.search(r'node_modules/snapback4/reference/(?:\*|[^\s]+\.md)',cmd))
  if is_reference:
   reads['referenceFile']+=1
   if 'SERVER.md' in cmd:reads['serverReferenceFile']+=1
   if re.search(r'\bcat\s',cmd):reads['fullReferenceCats']+=1
  if wiring or reference or is_reference:commands.append({'call':t['k'],'kind':'wiring' if wiring else 'reference-guide' if reference else 'reference-file','count':len(wiring)or reference or 1})
 reads['wiringCalls']=len(wiring_calls)
 records.append({'phase':stem.rsplit('-',1)[0].split('-r')[0],'runLabel':stem.rsplit('-',1)[0],'idea':a['n'],'lane':a['id'],'model':a['model'],'modelId':model,'frontend':a['frontend'],'calls':len(calls),'input':input_total,'cachedInput':cached,'uncachedInput':input_total-cached,'output':output,'usdParts':costs,'usd':sum(costs.values()),'longContextRequests':long_requests,'terminalReconciled':bool(terminal),'wallMs':result['wallMs'],'exit':result['status'],'report':result['report'],'initialPackageInstalled':d['initialPackageInstalled'],'nativeSessions':[Path(p).name if a['model']=='codex' else Path(p).parent.name for p in native_paths],'reads':reads,'readCalls':commands,'perCall':per_call})
result={'schema':'tok6-whole-session-v1','pricesVersion':prices['version'],'pricesSha256':hashlib.sha256(price_bytes).hexdigest(),'parserSha256':hashlib.sha256(parser_path.read_bytes()).hexdigest(),'rows':records}
(evidence/'measurements.json').write_text(json.dumps(result,indent=2)+'\n')
for r in records:print(r['phase'],r['idea'],r['model'],r['calls'],round(r['usd'],6),r['reads'])

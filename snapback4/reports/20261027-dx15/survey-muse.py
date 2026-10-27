"""Read original builder transcripts; persist aggregate counts only, never payloads."""
import json,pathlib,collections,re
root=pathlib.Path('/home/ccheever/sb4-loop/wave31')
assign=json.loads((root/'assignments.json').read_text()); assign=assign if isinstance(assign,list) else assign.get('lanes',list(assign.values()))
rows=[]
for app in sorted((root/'apps').iterdir()):
 p=app/'.agent.ndjson'
 if not p.exists():continue
 usages=[];tools=[]; types=collections.Counter()
 for line in p.open():
  try:j=json.loads(line)
  except:continue
  types[j.get('payload_type')]+=1
  if j.get('payload_type')=='run.usage':usages.append(j['payload'])
  if j.get('payload_type')=='tool.result':
   try: v=json.loads(j['payload'].get('text',''))
   except:continue
   if isinstance(v,dict) and isinstance(v.get('command'),str):tools.append(v)
 models=[m for u in usages for m in u.get('models',[]) if 'muse' in m.get('model','')]
 if not models:continue
 guide=collections.Counter();bytes_total=0;guidebytes=0;inspect=0;serve=0;refusal=0
 for tool in tools:
  cmd=tool['command'];out=tool.get('output','');n=len(out.encode());bytes_total+=n
  cards=re.findall(r'(?:snapback4|\.bin/snapback4)\s+guide\s+([\w-]+)',cmd)
  for card in cards:guide[card]+=1
  if cards:guidebytes+=n
  if re.search(r'\bdata\b.*--(?:json|release|limit)',cmd):inspect+=1
  if re.search(r'(?:serve-check|check-(?:prod-)?serve|probe:serve|prod:serve)',cmd):serve+=1
  if any(x in out for x in ['E_PRODUCTION_ROSTER','E_AUTH','E_SERVE_','ok":false']):refusal+=1
 rows.append(dict(lane=app.name,turns=sum(m['calls'] for m in models),inputTokens=sum(m['input_tokens'] for m in models),guideCalls=sum(guide.values()),repeatGuideCalls=sum(max(0,n-1) for n in guide.values()),guideCards=dict(guide),toolOutputBytes=bytes_total,guideOutputBytes=guidebytes,inspectionCalls=inspect,serveDriverCalls=serve,refusalOutputs=refusal))
summary={b:{k:sum(r[k] for r in rows if f'-{b}-' in r['lane']) for k in ['turns','inputTokens','guideCalls','repeatGuideCalls','toolOutputBytes','guideOutputBytes','inspectionCalls','serveDriverCalls','refusalOutputs']} for b in ['snapback','convex']}
out={'method':'Original .agent.ndjson; last/summed run.usage model calls/input tokens; tool.result JSON command/output only, no raw contents retained. Counts are command heuristics, not causal model-time attribution.', 'summary':summary,'lanes':rows}
pathlib.Path(__file__).with_name('muse-survey.json').write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(summary,indent=2))

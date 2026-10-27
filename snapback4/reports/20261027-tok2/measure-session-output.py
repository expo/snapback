import json,re,sys,collections,glob
from pathlib import Path
import tiktoken
enc=tiktoken.get_encoding('o200k_base'); rows=[]; seen=set()
verbs='deploy rollback releases data serve dev test check init new guide why sql token doctor witness types seed clock reset stop prune upgrade'.split()
pat=re.compile(r'(?<![\w-])(?:npx\s+)?(?:\S*/)?snapback4(?:\s+|["\']\s*,\s*["\'])('+ '|'.join(verbs) +r')\b')
def add(w,l,model,c,t,ex=None):
 matches=list(pat.finditer(c or ''))
 indirect=re.findall(r'(?:npm\s+run\s+(?:--silent\s+)?|node\s+(?:\S*/)?)(day2[:-]proof|prod[:-](?:serve|rollback|forward)|probe[:-](?:serve|check)|frontend[:-]proof|acceptance)(?:\.mjs)?',c or '')
 if not matches and not indirect:return
 commands=sorted(set(m[1]+(' --check' if m[1] in ['deploy','rollback'] and re.search(r'--check\b',c[m.end():].split('\n')[0]) else '') for m in matches))
 commands+=sorted(set('runner:'+x for x in indirect))
 outcome='running/unknown' if ex is None else 'success' if ex==0 else 'refusal' if re.search(r'REFUSED|E_[A-Z_]+|gates? pending',t) else 'error'
 rows.append(dict(wave=w,lane=l,model=model,commands=commands,mixed=len(matches)>1,bytes=len(t.encode()),tokens=len(enc.encode(t,disallowed_special=())),outcome=outcome))
for w in [32,33,34]:
 for p in sorted((Path.home()/f'sb4-loop/wave{w}/apps').glob('*snapback*/.agent.ndjson')):
  muse=[]
  for line in p.open(errors='replace'):
   try:o=json.loads(line)
   except:continue
   it=o.get('item',{})
   if o.get('type')=='item.completed' and it.get('type')=='command_execution':add(w,p.parent.name,'codex',it.get('command',''),it.get('aggregated_output',''),it.get('exit_code'))
   stream=o.get('stream',{})
   if stream.get('kind')=='session' and stream.get('id') not in muse:muse.append(stream.get('id'))
  for sid in muse:
   for f in glob.glob(str(Path.home()/f'.local/share/muse/sessions/*/*/*/{sid}/session.jsonl')):
    if f in seen:continue
    seen.add(f);pending={}
    for line in open(f):
     try:o=json.loads(line)
     except:continue
     for ch in o.get('children') or [o]:
      try:r=json.loads(ch['record_json']) if ch.get('record_json') else ch
      except:continue
      if r.get('payload_type')!='runtime.session':continue
      ev=r.get('payload',{}).get('event') or {};k=ev.get('kind')
      if k=='assistant_tool_calls_committed':
       for tc in ev.get('tool_calls',[]):
        try:a=json.loads(tc.get('args') or '{}')
        except:a={}
        if tc.get('name') in ['bash','bash_input']:pending[tc['call_id']]=a.get('command','') if tc.get('name')=='bash' else '__poll__'
      if k=='tool_result_batch_committed':
       for rr in ev.get('results',[]):
        c=pending.pop(rr.get('call_id') or rr.get('tool_call_id'),None); t=rr.get('text') or ''
        if c is None:continue
        if c=='__poll__':
         m=re.search(r'"command":\s*"((?:[^"\\]|\\.)*)"',t)
         try:c=json.loads('"'+m[1]+'"') if m else ''
         except:c=''
        ex=re.search(r'"exit_code"\s*:\s*(-?\d+)',t)
        add(w,p.parent.name,'muse',c,t,int(ex[1]) if ex else None)
agg={}
for r in rows:
 key=f"{r['wave']} / {r['model']} / {' + '.join(r['commands'])} / {r['outcome']}";a=agg.setdefault(key,dict(calls=0,bytes=0,tokens=0,mixed=0))
 for k in ['bytes','tokens']:a[k]+=r[k]
 a['calls']+=1;a['mixed']+=r['mixed']
out=Path(sys.argv[1]);out.mkdir(parents=True,exist_ok=True)
(out/'session-output.json').write_text(json.dumps(dict(method='o200k_base; Codex completed command aggregate (poll bytes counted once); Muse tool-visible bash results; mixed shell outputs attributed as whole mixed records, not per-process output; unresolved polls/indirect npm scripts excluded, no raw commands or account values retained',records=rows,totals=agg),indent=2)+'\n')
print(json.dumps(dict(records=len(rows),bytes=sum(r['bytes'] for r in rows),tokens=sum(r['tokens'] for r in rows),museSessions=len(seen))))

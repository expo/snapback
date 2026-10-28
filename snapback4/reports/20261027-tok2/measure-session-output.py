import json,re,sys,collections,glob
from pathlib import Path
import tiktoken
enc=tiktoken.get_encoding('o200k_base'); rows=[]; seen=set(); lane_scripts={}
verbs='deploy rollback releases data serve dev test check init new guide why sql token doctor witness types seed clock reset stop prune upgrade'.split()
pat=re.compile(r'(?<![\w-])(?:npx\s+)?(?:\S*/)?snapback4(?:\s+|["\']\s*,\s*["\'])('+ '|'.join(verbs) +r')\b')
def add(w,l,model,c,t,ex=None):
 matches=list(pat.finditer(c or ''))
 indirect=re.findall(r'(?:npm\s+run\s+(?:--silent\s+)?|node\s+(?:\S*/)?)(day2[:-]proof|prod[:-](?:serve|rollback|forward)|probe[:-](?:serve|check)|frontend[:-]proof|acceptance)(?:\.mjs)?',c or '')
 scripted=[]
 for name in re.findall(r'(?:npm|bun)\s+(?:run\s+)?(?:--silent\s+)?([\w:-]+)',c or ''):
  if 'snapback4' in lane_scripts.get((w,l),{}).get(name,''):scripted.append(name)
 indirect+=scripted
 if not matches and not indirect:return
 commands=sorted(set(m[1]+(' --check' if m[1] in ['deploy','rollback'] and re.search(r'--check\b',c[m.end():].split('\n')[0]) else '') for m in matches))
 commands+=sorted(set('runner:'+x for x in indirect))
 outcome='running/unknown' if ex is None else 'success' if ex==0 else 'refusal' if re.search(r'REFUSED|E_[A-Z_]+|gates? pending',t) else 'error'
 rows.append(dict(wave=w,lane=l,model=model,commands=commands,mixed=len(matches)>1 or bool(indirect) or bool(re.search(r'[;\n]|&&|\|\||\$\(',c or '')),bytes=len(t.encode()),tokens=len(enc.encode(t,disallowed_special=())),outcome=outcome))
def codex_cmds(inp):
    """Commands inside an exec JS block."""
    out = []
    for m in re.finditer(r'tools\.(exec_command|write_stdin|view_image|apply_patch)\(\s*\{(.*?)\}\s*\)', inp, re.S):
        kind, body = m.group(1), m.group(2)
        if kind == 'exec_command':
            mm = re.search(r'cmd\s*:\s*("((?:[^"\\]|\\.)*)"|`((?:[^`\\]|\\.)*)`|\'((?:[^\'\\]|\\.)*)\')', body, re.S)
            s = None
            if mm:
                s = mm.group(2) if mm.group(2) is not None else (mm.group(3) if mm.group(3) is not None else mm.group(4))
                try: s = json.loads('"' + s + '"') if mm.group(2) is not None else s
                except Exception: pass
            out.append(('exec', s or body))
        elif kind == 'write_stdin':
            sid = re.search(r'session_id\s*:\s*(\d+)', body)
            chars = re.search(r'chars\s*:\s*"((?:[^"\\]|\\.)*)"', body)
            out.append(('poll', (sid.group(1) if sid else None, chars.group(1) if chars else '')))
        else:
            out.append((kind, body[:200]))
    if not out:
        out.append(('js', inp))
    return out
def parse_codex(path,w,lane):
 pending={};sessions={};cells={}
 for line in open(path,errors='replace'):
  try:e=json.loads(line)
  except:continue
  if e.get('type')!='response_item':continue
  p=e.get('payload') or {};ty=p.get('type')
  if ty in ['custom_tool_call','function_call']:
   name=p.get('name','').split('.')[-1];raw=p.get('input','') or p.get('arguments','')
   try:a=json.loads(raw)
   except:a={}
   if name=='exec_command':cmds=[('exec',a.get('cmd',''))]
   elif name=='write_stdin':cmds=[('poll',(str(a.get('session_id')),''))]
   elif name=='wait':cmds=cells.get(a.get('cell_id'),[])
   else:cmds=codex_cmds(raw)
   pending[p.get('call_id')]=cmds
  elif ty in ['custom_tool_call_output','function_call_output']:
   cmds=pending.pop(p.get('call_id'),[]);out=p.get('output')
   blocks=[x.get('text','') for x in out if x.get('type') in ['text','input_text','output_text']] if isinstance(out,list) else [str(out or '')]
   units=[]
   for text in blocks:
    try:j=json.loads(text)
    except:continue
    if isinstance(j,dict) and ('output'in j or 'exit_code'in j):units.append((text,j))
   inner=[x for x in cmds if x[0]in ['exec','poll']]
   text='\n'.join(blocks)
   match=re.search(r'cell ID ([\w-]+)',text)
   if match:cells[match[1]]=cmds
   if len(units)==len(inner) and inner:
    pairs=list(zip(inner,units))
   else:
    ex=re.search(r'(?:"exit_code"\s*:\s*|Process exited with code )(-?\d+)',text)
    sid=re.search(r'(?:Process running with session ID |"session_id"\s*:\s*)(\d+)',text)
    pairs=[(('exec','\n'.join(c if k=='exec' else sessions.get(str(c[0]),'') for k,c in inner)),(text,{'exit_code':int(ex[1]) if ex else None,'session_id':sid[1] if sid else None}))] if inner else []
   for ((kind,value),(text,j))in pairs:
    command=value if kind=='exec' else sessions.get(str(value[0]),'')
    if j.get('session_id')is not None:sessions[str(j['session_id'])]=command
    add(w,lane,'codex',command,text,j.get('exit_code'))

for w in [32,33,34]:
 for p in sorted((Path.home()/f'sb4-loop/wave{w}/apps').glob('*snapback*/.agent.ndjson')):
  try:lane_scripts[(w,p.parent.name)]=json.loads((p.parent/'package.json').read_text()).get('scripts',{})
  except:lane_scripts[(w,p.parent.name)]={}
  muse=[];codex=[];threads=[]
  for line in p.open(errors='replace'):
   try:o=json.loads(line)
   except:continue
   it=o.get('item',{})
   if o.get('type')=='item.completed' and it.get('type')=='command_execution':codex.append(it)
   if o.get('type')=='thread.started':threads.append(o['thread_id'])
   stream=o.get('stream',{})
   if stream.get('kind')=='session' and stream.get('id') not in muse:muse.append(stream.get('id'))
  paths=list((p.parent/'.harness/sessions').glob('codex-*.jsonl'))
  if not paths:
   for thread in threads:paths.extend(Path.home().glob(f'.codex/sessions/*/*/*/rollout-*-{thread}.jsonl'))
  if paths:
   for path in dict.fromkeys(paths):parse_codex(path,w,p.parent.name)
  else:
   for it in codex:add(w,p.parent.name,'codex-aggregate-fallback',it.get('command',''),it.get('aggregated_output',''),it.get('exit_code'))
  for sid in muse:
   archived=list((p.parent/'.harness/sessions').glob(f'*{sid}*jsonl'))
   for f in archived or glob.glob(str(Path.home()/f'.local/share/muse/sessions/*/*/*/{sid}/session.jsonl')):
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
(out/'session-output.json').write_text(json.dumps(dict(method='o200k_base on actual tool-visible result text. Codex archived/local tool results paired with calls and process/cell polls; aggregate fallback explicitly labeled. Muse archived/local bash and bash_input results. Mixed shell, named indirect proof runners and lane-package scripts that mention Snapback counted as composite records, not isolated process measurements. Script inference uses the final package manifest, not a claim of historical manifest identity. No raw commands or account values retained. Unresolved/dynamically assembled commands cannot be attributed.',records=rows,totals=agg),indent=2)+'\n')
print(json.dumps(dict(records=len(rows),bytes=sum(r['bytes'] for r in rows),tokens=sum(r['tokens'] for r in rows),museSessions=len(seen))))

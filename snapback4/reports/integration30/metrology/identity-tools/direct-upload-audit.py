"""Separate exception audit; never changes strict comparison inputs/results.
Only explicitly reviewed source fields qualify; every other leaf must be exact.
Ordinary copied-ID presentation requires a separate audit, not this procedure.
"""
import pathlib,json,sys,re,collections,hashlib
root=pathlib.Path(sys.argv[1]);origins=json.loads(pathlib.Path(sys.argv[2]).read_text());missing=object()
def canonical(v):return json.dumps(v,sort_keys=True,separators=(',',':'),ensure_ascii=False,allow_nan=False)
def diff(a,b,p=()):
 if type(a)!=type(b):return [(p,a,b)]
 if isinstance(a,dict):return [d for k in sorted(a.keys()|b.keys())for d in diff(a.get(k,missing),b.get(k,missing),p+(k,))]
 if isinstance(a,list):return [d for i in range(max(len(a),len(b)))for d in diff(a[i]if i<len(a)else missing,b[i]if i<len(b)else missing,p+(i,))]
 return []if canonical(a)==canonical(b)else[(p,a,b)]
def get(v,p):
 for k in p:v=v[k]
 return v
def leaves(v,p=()):
 if isinstance(v,dict):
  for k,value in v.items():yield from leaves(value,p+(k,))
 elif isinstance(v,list):
  for i,value in enumerate(v):yield from leaves(value,p+(i,))
 else:yield p,v
def scope(p):
 for prefix in [('report','invariants'),('security','report','invariants')]:
  n=len(prefix)
  if p[:n]==prefix and len(p)>n+1 and isinstance(p[n],int)and p[n+1]=='counterexample':return p[:n+2]
 for prefix in [('reviews',),('security','securityReviews')]:
  n=len(prefix)
  if p[:n]==prefix and len(p)>n+1 and isinstance(p[n],int)and p[n+1]=='witness':return p[:n+2]
 return None
def audit(a,b,fields):
 ds=diff(a,b);maps=collections.defaultdict(dict);reverse=collections.defaultdict(dict);problems=[]
 for p,x,y in ds:
  s=scope(p)
  if not(s and len(p)>=4 and p[-3:]==('Map','id','Id')and p[-4]in fields and type(x)is str and type(y)is str):problems.append(list(p));continue
  left=get(a,p[:-2]);right=get(b,p[:-2])
  if not({'id','bytes','type'}<=left.keys()and {'id','bytes','type'}<=right.keys()):problems.append(list(p));continue
  if canonical({k:v for k,v in left.items()if k!='id'})!=canonical({k:v for k,v in right.items()if k!='id'}):problems.append(list(p));continue
  if x in maps[s]and maps[s][x]!=y:problems.append(list(p));continue
  if y in reverse[s]and reverse[s][y]!=x:problems.append(list(p));continue
  maps[s][x]=y;reverse[s][y]=x
 # Include unchanged occurrences: neither alias loss nor identity collapse is permitted.
 for s,mapping in maps.items():
  for p,x in leaves(get(a,s)):
   try:y=get(get(b,s),p)
   except(KeyError,IndexError,TypeError):continue
   if type(x)is str and type(y)is str and x==y and(x in mapping or y in reverse[s]):problems.append(list(s+p))
 return dict(accepted=bool(ds)and not problems,differences=len(ds),graphs=len(maps),idPairs=sum(map(len,maps.values())),unexplained=problems)
results=[];exact=0;schemas=0
for file in sorted(root.glob('w*.json')):
 item=json.loads(file.read_text());schemas+=1;key=f"{item['wave']}/{item['lane']}";pairs=collections.defaultdict(dict)
 for row in item['rows']:pairs[(row['mode'],row['temperature'])][row['label']]=row
 for(mode,temp),pair in pairs.items():
  a,b=pair['baseline']['security'],pair['candidate']['security']
  if canonical(a)==canonical(b):exact+=1;continue
  origin=origins.get(key)
  if origin:
   source=pathlib.Path.home()/'sb4-loop'/f"wave{item['wave']}"/'apps'/item['lane']/'snapback';texts=[(q.name,q.read_text())for q in sorted(source.glob('*.q'))];prior=[]
   if item['wave']==31:prior=[(q.name,q.read_text())for q in sorted((pathlib.Path.home()/'sb4-loop/wave31/v1-clients'/item['lane']/'snapback').glob('*.q'))]
   assert hashlib.sha256(canonical(dict(current=texts,predecessor=prior)).encode()).hexdigest()==pair['baseline']['sourceSha256']==pair['candidate']['sourceSha256']
   text='\n'.join(t for n,t in texts)
   for field in origin['assetFields']:assert re.search(r'\b'+re.escape(field)+r'\s*:\s*(?:image|file|video)\b',text),field
   result=audit(a,b,set(origin['assetFields']))
  else:result=dict(accepted=False,unexplained=['source origin not yet reviewed'])
  results.append(dict(wave=item['wave'],lane=item['lane'],mode=mode,temperature=temp,origin=origin,**result))
report=dict(method='Literal comparison retained. Only reviewed typed asset metadata ID leaves, identical remaining metadata, and a bijection within each full counterexample/witness graph. All other leaves exact; unchanged ID occurrences checked. This audit does not cover ordinary copied-ID presentation.',schemas=schemas,exactCommands=exact,exceptionCommands=sum(r['accepted']for r in results),pendingCommands=sum(not r['accepted']for r in results),rows=results)
(root/'direct-upload-audit.json').write_text(json.dumps(report,indent=2)+'\n');print(json.dumps({k:v for k,v in report.items()if k!='rows'},indent=2))

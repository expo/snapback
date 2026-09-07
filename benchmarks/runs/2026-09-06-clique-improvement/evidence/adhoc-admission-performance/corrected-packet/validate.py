"""Nonsecret assertions shared by preparation's fake validation and the proposed run."""
import collections,hashlib,json,math,sqlite3

def encoded(x): return json.dumps(x,ensure_ascii=False,sort_keys=True,separators=(',',':')).encode()
def digest(x): return hashlib.sha256(encoded(x)).hexdigest()
def sha(p):
 h=hashlib.sha256()
 with p.open('rb') as f:
  for b in iter(lambda:f.read(1048576),b''):h.update(b)
 return h.hexdigest()
def untag(v):
 if v=='Null':return None
 if isinstance(v,dict) and len(v)==1:
  k,x=next(iter(v.items()))
  if k in ('Id','Int','String','Bool'):return x
  if k in ('Row','Map'):return {a:untag(b) for a,b in x.items()}
  if k in ('Array','List'):return [untag(y) for y in x]
 return v

def assert_response(value,q,source,seq,last_at,wall_start,wall_end):
 assert set(value)=={'state','seq','data','principal','sourceHash'}, 'receipt fields changed'
 assert value['state']=='committed' and value['principal']=='system', 'receipt state/seat'
 assert value['seq']==seq and value['sourceHash']==digest(source), 'sequence/source identity'
 row=value['data']; at=row['at']
 assert isinstance(at,int) and not isinstance(at,bool) and at>last_at, 'native arrival order'
 assert wall_start<=at<=wall_end, 'owner wall clock outside request interval'
 expected=dict(q['args'],at=at,photo=None,clip=None,oncePhoto=None,expiresAt=None)
 assert row==expected, 'returned row does not match supplied arguments'
 return row

def connect(p,immutable=False):
 c=sqlite3.connect('file:'+str(p)+'?mode=ro'+('&immutable=1' if immutable else ''),uri=True,timeout=30)
 c.execute('PRAGMA query_only=ON');return c

def state(p):
 c=connect(p)
 try:
  counts=dict(c.execute('SELECT table_name,COUNT(*) FROM rows GROUP BY table_name'))
  meta=dict(c.execute("SELECT key,value FROM _meta WHERE key IN ('generation','program_generation','schema_hash','id_high_water')"))
  return dict(counts=counts,meta=meta,seq=c.execute('SELECT MAX(seq) FROM _commits').fetchone()[0],pending={n:c.execute('SELECT COUNT(*) FROM "'+n+'"').fetchone()[0] for n in ['_jobs','_timers','_outbox']})
 finally:c.close()

def table_hash(c,t,exclude=()):
 h=hashlib.sha256();exclude=set(exclude)
 for id,data in c.execute('SELECT row_id,data FROM rows WHERE table_name=? ORDER BY row_id',[t]):
  if id not in exclude:h.update(json.dumps([id,data],separators=(',',':')).encode()+b'\n')
 return h.hexdigest()

def assert_start(db,workload,cfg):
 # Called only before owner startup, after the permitted namespace change.
 s=state(db)
 assert s['counts']==workload['sourceCounts'] and s['seq']==workload['sequence']
 assert all(v==0 for v in s['pending'].values())
 assert s['meta']['generation']==s['meta']['schema_hash']==cfg['generation']
 assert s['meta']['program_generation']==cfg['programGeneration']
 c=connect(db)
 try:
  assert {t:table_hash(c,t) for t in workload['tableHashes']}==workload['tableHashes'], 'original starting rows changed'
  for q in workload['requests']:
   assert c.execute("SELECT COUNT(*) FROM rows WHERE table_name='messages' AND row_id=?",[q['args']['id']]).fetchone()[0]==0
 finally:c.close()
 return s

def assert_final(db,original,workload,returned,source):
 c=connect(db);o=connect(original,True)
 try:
  assert len(returned)==23
  for q,row in zip(workload['requests'],returned):
   got=c.execute("SELECT data FROM rows WHERE table_name='messages' AND row_id=?",[q['args']['id']]).fetchone()
   assert got and untag(json.loads(got[0]))==row, 'persisted message mismatch'
  ids=[q['args']['id'] for q in workload['requests']]
  assert table_hash(c,'messages',ids)==workload['tableHashes']['messages'], 'original messages changed'
  delta=collections.Counter(q['args']['conversationId'] for q in workload['requests'])
  for old in workload['maintainedBefore']:
   got=untag(json.loads(c.execute("SELECT data FROM rows WHERE table_name='messageCounts' AND row_id=?",[old['id']]).fetchone()[0]))
   expected=dict(old,value=old['value']+delta[old['conversationId']]);assert got==expected, 'maintained count mismatch'
  changed=[x['id'] for x in workload['maintainedBefore']]
  assert table_hash(c,'messageCounts',changed)==table_hash(o,'messageCounts',changed)
  for t,h in workload['tableHashes'].items():
   if t not in ('messages','messageCounts'):assert table_hash(c,t)==h, 'unchanged table modified'
  commits=c.execute('SELECT seq,at,program,principal,kind,by,emits,writes FROM _commits WHERE seq>? ORDER BY seq',[workload['sequence']]).fetchall()
  assert len(commits)==23
  for i,(commit,row) in enumerate(zip(commits,returned),1):
   assert json.loads(commit[7])=={'messages':1,'messageCounts':1}, 'commit write counts'
   assert commit[:7]==(workload['sequence']+i,row['at'],'adhoc:'+digest(source),'system','operator','native-search-scale',0), 'commit ledger mismatch'
  s=state(db);expected=dict(workload['sourceCounts'],messages=workload['finalMessageCount'])
  assert s['counts']==expected and s['seq']==workload['finalSequence'] and all(v==0 for v in s['pending'].values())
  return s
 finally:c.close();o.close()

def stats(samples):
 assert len(samples)==20
 ordered=sorted(samples)
 return dict(n=20,median_ms=(ordered[9]+ordered[10])/2,p95_ms=ordered[math.ceil(.95*20)-1],p95_definition='nearest rank ceil(.95*n), twentieth-sample set retained without selection')

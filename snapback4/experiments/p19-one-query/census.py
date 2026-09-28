"""Read only an owned, stopped server copy. Count the viewer-key alternative."""
import collections,json,sqlite3
from pathlib import Path
p=Path(__file__).resolve().parent
c=sqlite3.connect('file:'+str(p/'.work/main/app/.snapback4/store.sqlite')+'?mode=ro',uri=True)
def rows(name):
 t=c.execute('select num from _catalog where name=?',(name,)).fetchone()[0]
 for (raw,) in c.execute('select data from r where t=?',(t,)):
  yield {k:next(iter(v.values())) if isinstance(v,dict) else None for k,v in json.loads(raw)['Row'].items()}, len(raw.encode())
profiles={r['handle']:r['principal'] for r,_ in rows('profiles')}
viewer=profiles['u0500']
result={}; seed=[]
for source,owner in [('likes','principal'),('reposts','actor')]:
 data=[(r,n) for r,n in rows(source) if r[owner] not in ['dev:p19owner','dev:p19reader']]
 mine=[r for r,n in data if r[owner]==viewer]
 keys=[{'id':r['id'],'owner':r[owner],'post':r['post']} for r in mine]
 counts=collections.Counter(r[owner] for r,n in data)
 result[source]={'global_rows':len(data),'global_stored_json_bytes':sum(n for r,n in data),'u0500_rows':len(mine),'u0500_key_json_bytes':sum(len(json.dumps(k,separators=(',',':')).encode()) for k in keys),'max_owner_rows':max(counts.values()),'owners':len(counts),'u0500_keys':keys}
 seed += [{'table':'likeKeys' if source=='likes' else 'repostKeys','row':k} for k in keys]
(p/'results/census.json').write_text(json.dumps(result,indent=2)+'\n')
(p/'.work/own-keys-seed.json').write_text(json.dumps(seed))
print(json.dumps({k:{f:v for f,v in x.items() if f!='u0500_keys'} for k,x in result.items()},indent=2))

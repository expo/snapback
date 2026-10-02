# Run read-only on the operator's existing store; no auth tables are read.
import sqlite3,json,os,datetime
base=os.path.expanduser('~/sb4-np/ct-mac/')
db=sqlite3.connect('file:'+base+'store/replay-instance/.snapback4/store.sqlite?mode=ro',uri=True);db.row_factory=sqlite3.Row
post='0000000000KB7QTRX1ARRWSC0X';reader='user:01M3X36WV1Z2SMC8RANTS4Q2E0'
rows=db.execute("select l.seq,c.at,c.program,l.t,l.kind,l.id,l.data from _log l join _commits c using(seq) where l.t in ('followingFeed','posts') and l.data like ? order by l.seq",('%'+post+'%',)).fetchall()
rows=[dict(r) for r in rows if r['t']=='posts' or reader in r['data']]
for row in rows: row['data']=json.loads(row['data']);row['iso']=datetime.datetime.fromtimestamp(row['at']/1000,datetime.timezone.utc).isoformat()
work=db.execute("select json_extract(data,'$.Row.status.String') state,count(*) n from r where t=(select num from _catalog where name='followingWork') group by state").fetchall()
lastWrite=dict(db.execute("select seq,at,program from _commits where kind='mutation' order by seq desc limit 1").fetchone() or {})
print(json.dumps({'capturedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'event':post,'reader':reader,'commits':rows,'currentWork':[dict(r) for r in work],'lastMutation':lastWrite},indent=2))

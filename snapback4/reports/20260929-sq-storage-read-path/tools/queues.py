"""Read pending work only on our copy, after immediate probes."""
import sqlite3,json,pathlib,sys,time
p=pathlib.Path(sys.argv[1]);c=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True)
tables=c.execute("SELECT name,num FROM _catalog WHERE name LIKE '$recount:%' AND name NOT LIKE '%.%' OR name='followingWork'").fetchall()
out={'at':time.time(),'walBytes':pathlib.Path(str(p)+'-wal').stat().st_size if pathlib.Path(str(p)+'-wal').exists() else 0,'queues':{}}
for name,n in tables:
 sql="SELECT count(*) FROM r WHERE t=?" + (" AND json_extract(data,'$.Row.status.String')='pending'" if name=='followingWork' else '')
 out['queues'][name]=c.execute(sql,[n]).fetchone()[0]
out['lastCommit']=c.execute('SELECT seq,program,kind,at FROM _commits ORDER BY seq DESC LIMIT 1').fetchone()
out['queues']['jobs']=c.execute("SELECT count(*) FROM _jobs WHERE state NOT IN ('done','parked')").fetchone()[0]
print(json.dumps(out))

import sqlite3,pathlib,sys,time,json
p=pathlib.Path(sys.argv[1]);pid=int(sys.argv[2]);out=pathlib.Path(sys.argv[3])
c=sqlite3.connect(p.as_uri()+'?mode=ro',uri=True)
with out.open('w') as f:
 last=None
 while pathlib.Path(f'/proc/{pid}').exists():
  v=c.execute('PRAGMA data_version').fetchone()[0];wal=pathlib.Path(str(p)+'-wal').stat()
  if (v,wal.st_mtime_ns)!=last:
   f.write(json.dumps({'at':time.time(),'dataVersion':v,'walMtimeNs':wal.st_mtime_ns,'walBytes':wal.st_size})+'\n');f.flush();last=v,wal.st_mtime_ns
  time.sleep(.01)

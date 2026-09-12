import sqlite3,json,os,time,sys
path=sys.argv[1];out=sys.argv[2]
db=sqlite3.connect('file:'+os.path.abspath(path)+'?mode=ro',uri=True)
report={'epoch':time.time(),'path':path,'scope':'messaging projection + starter social, with recorded diagnostic mutations; no full-social-scale claim','inspection':'read-only SQLite; no explicit checkpoint, vacuum or compaction','files':{p:os.path.getsize(p) for p in [path,path+'-wal',path+'-shm'] if os.path.exists(p)},'schema':[],'physical':[]}
for typ,name,tbl,sql in db.execute("select type,name,tbl_name,sql from sqlite_master where type in ('table','index') order by name"):
 item={'type':typ,'name':name,'table':tbl,'sql':sql}
 if typ=='table':item['rows']=db.execute('select count(*) from "'+name.replace('"','""')+'"').fetchone()[0]
 report['schema'].append(item)
try:report['physical']=[dict(zip(['name','pages','bytes','payloadBytes','unusedBytes'],r)) for r in db.execute('select name,count(*),sum(pgsize),sum(payload),sum(unused) from dbstat group by name')]
except Exception as e:report['dbstatError']=str(e)
report['applicationRows']=[{'table':t,'rows':n,'serializedJsonBytes':b} for t,n,b in db.execute('select table_name,count(*),sum(length(cast(data as blob))) from rows group by table_name')]
report['pageSize']=db.execute('pragma page_size').fetchone()[0];report['pageCount']=db.execute('pragma page_count').fetchone()[0];report['freelistCount']=db.execute('pragma freelist_count').fetchone()[0]
json.dump(report,open(out,'w'),indent=2);db.close()

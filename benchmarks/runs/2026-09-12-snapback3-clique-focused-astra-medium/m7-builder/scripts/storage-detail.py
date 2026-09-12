import sqlite3,json,time,os
p='artifacts/scale-app/.snapback3/store.sqlite';db=sqlite3.connect('file:'+os.path.abspath(p)+'?mode=ro',uri=True)
r={'epoch':time.time(),'mode':'read-only','logicalAppRows':[],'logicalAppIndexes':[],'commits':[]}
for table,n,size in db.execute('select table_name,count(*),sum(length(cast(data as blob))) from rows group by table_name'):r['logicalAppRows'].append({'table':table,'rows':n,'serializedDataBytes':size})
for table,index,n,size in db.execute("select table_name,index_name,count(*),sum(length(cast(table_name as blob))+length(cast(index_name as blob))+length(cast(row_id as blob))+coalesce(length(cast(c0 as blob)),0)+coalesce(length(cast(c1 as blob)),0)+coalesce(length(cast(c2 as blob)),0)+coalesce(length(cast(c3 as blob)),0)+coalesce(length(cast(c4 as blob)),0)+coalesce(length(cast(c5 as blob)),0)+coalesce(length(cast(c6 as blob)),0)+coalesce(length(cast(c7 as blob)),0)) from index_entries group by table_name,index_name"):
 r['logicalAppIndexes'].append({'table':table,'index':index,'entries':n,'logicalTextBytesExcludingSQLiteFraming':size})
for kind,program,n,size in db.execute('select kind,program,count(*),sum(length(cast(writes as blob))) from _commits group by kind,program'):r['commits'].append({'kind':kind,'program':program,'rows':n,'writesBytes':size})
reactions={rid:json.loads(data) for rid,data in db.execute("select row_id,data from rows where table_name='reactions'")}
expected=[json.loads(x) for x in open('artifacts/fixture/projected.jsonl') if json.loads(x)['verb']=='react']
mismatches=[]
for e in expected:
 a=e['args']; row=reactions.get(a[2],{}).get('Row',{}); plain={k:next(iter(v.values())) for k,v in row.items()}
 if plain.get('messageId')!=a[0] or plain.get('userId')!='dev:'+e['actor'] or plain.get('emoji')!=a[1]:mismatches.append(a[2])
r['commitColumnBytes']=[dict(zip(['kind','rows','touchedBytes','writesBytes','scopeTouchesBytes'],row)) for row in db.execute('select kind,count(*),sum(length(cast(touched as blob))),sum(length(cast(writes as blob))),sum(length(cast(scope_touches as blob))) from _commits group by kind')]
r['principalKinds']=dict(db.execute('select kind,count(*) from _principals group by kind'))
r['reactionVerification']={'fieldMismatches':mismatches,'status':'pass' if not mismatches and len(reactions)==2000 else 'fail','expected':len(expected),'actual':len(reactions),'idMismatch':sorted(set(reactions)^set(e['args'][2] for e in expected)),'example':next(iter(reactions.values()))}
json.dump(r,open('evidence/storage-detail.json','w'),indent=2);db.close()

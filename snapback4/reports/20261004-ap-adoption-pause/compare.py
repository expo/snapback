import sqlite3,hashlib,json,pathlib,sys
assert len(sys.argv)==4, 'compare.py BEFORE.sqlite AFTER.sqlite OUTPUT.json'
connections=[sqlite3.connect('file:'+str(pathlib.Path(path).resolve())+'?mode=ro',uri=True) for path in sys.argv[1:3]]
def digest(c,sql,args=()):
 h=hashlib.sha256();n=0
 for row in c.execute(sql,args):h.update(repr(row).encode());h.update(b'\n');n+=1
 return {'rows':n,'sha256':h.hexdigest()}
def compare(sql,args=()):
 a,b=[digest(c,sql,args) for c in connections]
 assert a==b,(sql,args,a,b)
 return a
out={'method':'SHA256 of repr(tuple) UTF-8 plus LF, SQLite ordered values; all compared pairs equal','tables':{},'indexes':{},'captures':{},'complete':{}}
for table in ('r','i','_catalog','_log','_commits'):
 n=len(connections[0].execute('pragma table_info('+table+')').fetchall())
 out['complete'][table]=compare('select * from '+table+' order by '+','.join(map(str,range(1,n+1))))
cat=dict(connections[0].execute('select name,num from _catalog'))
for name,num in cat.items():
 if '.' not in name:out['tables'][name]=compare('select id,data from r where t=? order by id',(num,))
 else:out['indexes'][name]=compare('select k,id from i where ti=? order by k',(num,))
for name,path in [('likes','postId.authorId'),('posts','parentId.authorId'),('reposts','postId.authorId')]:
 # A JSON path parameter preserves literal dots in a capture's field name.
 out['captures'][name+'.'+path]=compare('select id,json_extract(data,?) from r where t=? order by id',('$.Row."'+path+'"',cat[name]))
pathlib.Path(sys.argv[3]).write_text(json.dumps(out,indent=2)+'\n')
print(json.dumps(out['complete'],indent=2))

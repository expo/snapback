from pathlib import Path
import subprocess,os,tarfile,json,hashlib
base=Path('/Users/ccheever/projects/snapback-integ24/integration24-tools/private-pg16');base.mkdir(parents=True,exist_ok=True)
logs=base/'logs';logs.mkdir(exist_ok=True);commands=[]
env=dict(os.environ,PATH='/opt/homebrew/opt/coreutils/libexec/gnubin:/opt/homebrew/bin:/usr/bin:/bin:'+os.environ['PATH'])
def run(key,args,cwd=base,budget=900):
 with(logs/(key+'.log')).open('w') as log:r=subprocess.run(['timeout',str(budget)+'s',*map(str,args)],cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT,timeout=budget+20)
 commands.append({'key':key,'argv':list(map(str,args)),'exit':r.returncode});(logs/'commands.json').write_text(json.dumps(commands,indent=2)+'\n');print(key,r.returncode,flush=True);assert r.returncode==0
archive=base/'postgresql-16.15.tar.bz2'
run('download',['curl','--fail','--location','--max-time','300','--retry','2','https://ftp.postgresql.org/pub/source/v16.15/postgresql-16.15.tar.bz2','--output',archive],budget=660)
(logs/'archive-sha256.txt').write_text(hashlib.sha256(archive.read_bytes()).hexdigest()+'  '+archive.name+'\n')
run('extract',['tar','-xjf',archive,'-C',base],budget=120)
source=base/'postgresql-16.15'
run('configure',['./configure','--prefix='+str(base/'install'),'--without-icu','--without-readline','--without-zlib'],source,300)
run('make',['make','-j4'],source,1800)
run('install',['make','install'],source,300)
run('version',[base/'install/bin/postgres','--version'],base,30)
(logs/'complete.json').write_text(json.dumps({'prefix':str(base/'install'),'commands':commands},indent=2)+'\n')

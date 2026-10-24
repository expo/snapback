from pathlib import Path
import subprocess,json,shlex
b=Path('/home/ccheever/sb4-loop/integ24');root=Path('/home/ccheever/projects/snapback-sb4loop');host='ccheever@macstudio-charlie-apt101-a';remote='/Users/ccheever/projects/snapback-integ24';out=remote+'/integration24-tools/pipe';commands=[]
source=json.loads((b/'post-main-source.json').read_text())['source']
assert subprocess.check_output(['timeout','15s','git','rev-parse','HEAD'],cwd=root,text=True).strip()==source
assert subprocess.check_output(['timeout','15s','git','status','--porcelain'],cwd=root,text=True)==''
def run(args,budget=300):
 r=subprocess.run(['timeout',str(budget)+'s',*args],cwd=root,timeout=budget+20);commands.append({'argv':args,'exit':r.returncode});(b/'macstudio-post-main-dispatch-commands.json').write_text(json.dumps(commands,indent=2)+'\n');assert r.returncode==0,args
bundle=b/'source-post-main.bundle'
run(['git','bundle','create',str(bundle),'HEAD','^4f8e498d2e61932925dd2fbf61b43048a12ea25c'])
run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15',host,'/opt/homebrew/bin/gtimeout 20 mkdir -p '+out])
run(['scp',str(bundle),host+':'+out+'/source.bundle'])
run(['scp',str(b/'harness/qualify-post-main-pg.py'),host+':'+out+'/run.py'])
pg=remote+'/integration24-tools/private-pg16/install'
args=['/opt/homebrew/bin/gtimeout','14000','python3',out+'/run.py','--root',remote,'--out',out+'/evidence','--pg-bin',pg+'/bin','--pg-share',pg+'/share/postgresql','--target',remote+'/snapback4/target','--source',source,'--port','55445']
code='cd '+shlex.quote(remote)+' && /opt/homebrew/bin/gtimeout 120 git fetch '+shlex.quote(out+'/source.bundle')+' HEAD && /opt/homebrew/bin/gtimeout 120 git checkout --detach FETCH_HEAD && '+shlex.join(args)+' && /opt/homebrew/bin/gtimeout 120 tar -czf '+shlex.quote(out+'/evidence.tar.gz')+' -C '+shlex.quote(out)+' evidence'
run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15',host,code],14500)
run(['scp',host+':'+out+'/evidence.tar.gz',str(b/'macstudio-post-main.tar.gz')])
(b/'macstudio-post-main.exit').write_text('0\n')

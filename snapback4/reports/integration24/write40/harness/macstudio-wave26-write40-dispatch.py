from pathlib import Path
import subprocess,json,time
b=Path('/home/ccheever/sb4-loop/integ24');root=Path('/home/ccheever/projects/snapback-sb4loop');host='ccheever@macstudio-charlie-apt101-a';remote='/Users/ccheever/projects/snapback-integ24';directory=remote+'/integration24-tools/write40';commands=[]
def run(args,budget=300):
 r=subprocess.run(['timeout',str(budget)+'s',*args],cwd=root,timeout=budget+20);commands.append({'argv':args,'exit':r.returncode});(b/'macstudio-wave26-write40-dispatch-commands.json').write_text(json.dumps(commands,indent=2)+'\n');assert r.returncode==0,args
assert (b/'macstudio-post-main.exit').read_text().strip()=='0'
bundle=b/'source-wave26-write40.bundle'
run(['git','bundle','create',str(bundle),'HEAD','^6c638549fd297187a4c9e6804b7748f631a9bcc5'])
run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15',host,'/opt/homebrew/bin/gtimeout 20 mkdir -p '+directory])
run(['scp',str(bundle),host+':'+directory+'/source.bundle'])
run(['scp',str(b/'harness/macstudio-wave26-write40.py'),host+':'+directory+'/run.py'])
code='cd '+remote+' && /opt/homebrew/bin/gtimeout 120 git fetch '+directory+'/source.bundle HEAD && /opt/homebrew/bin/gtimeout 120 git checkout --detach FETCH_HEAD && /opt/homebrew/bin/gtimeout 20000 python3 '+directory+'/run.py && /opt/homebrew/bin/gtimeout 20 git status --porcelain > '+directory+'/source-status.txt && /opt/homebrew/bin/gtimeout 180 tar -czf '+directory+'/evidence.tar.gz -C '+remote+' integration24-tools/write40 --exclude=evidence.tar.gz --exclude=source.bundle'
# The archive excludes its own output and the transport-only git bundle.
code=code.replace('tar -czf '+directory+'/evidence.tar.gz -C '+remote+' integration24-tools/write40 --exclude=evidence.tar.gz --exclude=source.bundle','tar --exclude=evidence.tar.gz --exclude=source.bundle -czf '+directory+'/evidence.tar.gz -C '+remote+' integration24-tools/write40')
run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=15',host,code],21000)
run(['scp',host+':'+directory+'/evidence.tar.gz',str(b/'macstudio-wave26-write40.tar.gz')],300)
(b/'macstudio-wave26-write40.exit').write_text('0\n')

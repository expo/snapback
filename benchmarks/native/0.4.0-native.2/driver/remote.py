#!/usr/bin/env python3
"""Only a diagnosed SSH transport failure is unmeasured; preserve remote exits."""
import argparse,json,re,shlex,subprocess,sys,time
from pathlib import Path

def unavailable(result):
    return result.returncode==255 and bool(re.search(r'(?im)^ssh: (?:connect to host .+ port \d+: (?:Connection refused|Connection timed out|Operation timed out|No route to host|Network is unreachable)|Could not resolve hostname .+: .+)$',result.stderr))

def main():
    p=argparse.ArgumentParser();p.add_argument('--host',required=True);p.add_argument('--port',type=int,default=22);p.add_argument('--out',required=True);p.add_argument('command',nargs='+');a=p.parse_args()
    started=time.monotonic()
    r=subprocess.run(['ssh','-o','BatchMode=yes','-o','ConnectTimeout=5','-p',str(a.port),a.host,shlex.join(a.command)],capture_output=True,text=True)
    if unavailable(r):
        result={'pass':None,'reason':'unavailable-host:ssh','requiredForGreen':False,'wallSeconds':round(time.monotonic()-started,3),'operatorSteps':1}
        Path(a.out).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result));return 0
    sys.stdout.write(r.stdout);sys.stderr.write(r.stderr);return r.returncode

if __name__=='__main__':sys.exit(main())

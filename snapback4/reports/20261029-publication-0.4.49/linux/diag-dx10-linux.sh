#!/bin/bash
# Linux comparison for the Darwin dx10 test 8 red: run dx10-process-accounts alone in the wfix worktree (node 24.13.1) while
# sampling the process table every 200 ms; record the runner's descendant tree changes.
export PATH=$HOME/.local/bin:$HOME/.cargo/bin:/usr/local/bin:/usr/bin:/bin
O=~/sb4-pub-0449-kit/isolated/diag-dx10-linux; rm -rf $O; mkdir -p $O; cd ~/sb4-pub-0449-kit/wfix/snapback4
env -u SNAPBACK4_BIN timeout 600 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/dx10-process-accounts.test.mjs > $O/run.log 2>&1 < /dev/null &
R=$!
while kill -0 $R 2>/dev/null; do echo "== $(date +%s.%N)"; ps -eo pid=,ppid=,pgid=,stat=,args= | cut -c1-200; sleep 0.2; done > $O/ps-all.log 2>&1
python3 - $O $R <<'PY'
import sys,collections
O,R=sys.argv[1],int(sys.argv[2])
samples=[];cur=None
for line in open(f'{O}/ps-all.log',errors='replace'):
    if line.startswith('== '): cur=(float(line[3:]),{}); samples.append(cur); continue
    f=line.split(None,4)
    if len(f)<5 or not f[0].isdigit(): continue
    cur[1][int(f[0])]=(int(f[1]),int(f[2]),f[3],f[4].strip()[:110])
out=open(f'{O}/tree.txt','w'); prev=None
for t,procs in samples:
    kids=collections.defaultdict(list)
    for p,(pp,pg,st,c) in procs.items(): kids[pp].append(p)
    res=[];stack=[(R,0)]
    while stack:
        p,d=stack.pop()
        if p in procs: res.append((d,p)+procs[p])
        for k in sorted(kids.get(p,[]),reverse=True): stack.append((k,d+1))
    key=[(d,p,pp,pg,st[:1],c) for d,p,pp,pg,st,c in res]
    if key!=prev: out.write(f'== {t:.2f}\n'+''.join(f"{'  '*d}{p} ppid={pp} pgid={pg} {st} {c}\n" for d,p,pp,pg,st,c in res)); prev=key
out.close(); print('samples',len(samples))
PY
grep -E "^not ok|^-- client files:" $O/run.log | cut -c1-160; echo diag-done

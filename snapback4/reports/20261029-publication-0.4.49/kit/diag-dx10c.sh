#!/bin/bash
# Read-only Darwin diagnosis of dx10-process-accounts test 8 (run detached with stdin </dev/null like the suite): sample the
# process table cheaply (comm, no argv reads) every 200 ms while the file runs; post-process the runner's descendant tree.
O=$HOME/sb4-pub-0449/isolated/diag-dx10c; rm -rf $O; mkdir -p $O
export PATH=/Users/ccheever/sb4-03-lanes/codesign-relay:/Users/ccheever/.elan/bin:/Users/ccheever/.volta/tools/image/node/24.18.0/bin:/Users/ccheever/.bun/bin:/Users/ccheever/.cargo/bin:/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin
ulimit -n 65536
cd $HOME/sb4-pub-0444-wt/snapback4
env -u SNAPBACK4_BIN -u SNAPBACK4_RUST_TEST_PROCESSES SNAPBACK4_TEST_SERIAL_CLIENT_FILES=1 SNAPBACK4_REQUIRE_LEAN=1 CARGO_INCREMENTAL=0 SNAPBACK4_FENCE_PUBLISHED=/Users/ccheever/sb4-03-lanes/published-0.2.33 timeout 600 node scripts/run-client-tests.mjs 1 files packages/snapback4/test/dx10-process-accounts.test.mjs > $O/run.log 2>&1 < /dev/null &
R=$!; echo "runner $R" > $O/runner.txt
while kill -0 $R 2>/dev/null; do echo "== $(perl -MTime::HiRes=time -e 'printf "%.2f", time')"; ps -axo pid=,ppid=,pgid=,stat=,comm=; sleep 0.2; done > $O/ps-all.log 2>&1
python3 - $O $R <<'PY'
import sys,re,collections
O,R=sys.argv[1],int(sys.argv[2])
samples=[];cur=None
for line in open(f'{O}/ps-all.log',errors='replace'):
    if line.startswith('== '): cur=(float(line[3:]),{}); samples.append(cur); continue
    f=line.split(None,4)
    if len(f)<5 or not f[0].isdigit(): continue
    cur[1][int(f[0])]=(int(f[1]),int(f[2]),f[3],f[4].strip())
print('samples',len(samples))
out=open(f'{O}/tree.txt','w')
prev=None
for t,procs in samples:
    def desc(root):
        kids=collections.defaultdict(list)
        for p,(pp,pg,st,c) in procs.items(): kids[pp].append(p)
        res=[];stack=[(root,0)]
        while stack:
            p,d=stack.pop(); 
            if p in procs: res.append((d,p)+procs[p])
            for k in sorted(kids.get(p,[]),reverse=True): stack.append((k,d+1))
        return res
    tree=desc(R)
    key=[(d,p,pp,pg,st[:1],c) for d,p,pp,pg,st,c in tree]
    if key!=prev:
        out.write(f'== {t:.2f}\n'+''.join(f"{'  '*d}{p} ppid={pp} pgid={pg} {st} {c}\n" for d,p,pp,pg,st,c in tree)); prev=key
out.close(); print('tree changes written')
PY
grep -E "^not ok|^-- client files:" $O/run.log | cut -c1-160
git -C $HOME/sb4-pub-0444-wt status --porcelain | head -3; echo diag-done > $O/done

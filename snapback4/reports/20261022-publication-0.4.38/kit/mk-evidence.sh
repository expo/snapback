#!/bin/bash
# Build the evidence-only dry-run mode (no Linux receipt; suite + Darwin-only staging; never publishes) and its watched gate.
set -e
K=$HOME/sb4-pub-0438
grep -q 'dry-run-evidence)' $K/publish.sh || python3 - $K/publish.sh <<'PY'
import sys,re
p=sys.argv[1]; s=open(p).read()
line=[l for l in s.splitlines() if l.startswith(' dry-run)')][0]
ev=line.replace(' dry-run)',' dry-run-evidence)').replace('step publication-dry-run ','step publication-dry-run-evidence ')
ev=re.sub(r' --linux-receipt \S+ --linux-tarball \S+','',ev)
s=s.replace(line+'\n',line+'\n'+ev+'\n'); open(p,'w').write(s)
PY
sed -e 's/publish\.sh dry-run /publish.sh dry-run-evidence /; s/dry-run-\$ATT/dry-run-evidence-$ATT/g; s/dryrun-a\$ATT/dryrun-evidence-a$ATT/g; s#L=\$K/gate.log#L=$K/gate-evidence.log#; s/0.4.38 Mac dry-run gate/0.4.38 Mac EVIDENCE-ONLY dry-run gate (no Linux receipt)/' $K/gate-dryrun.sh > $K/gate-evidence.sh
chmod +x $K/gate-evidence.sh
grep -n 'dry-run' $K/publish.sh | cut -c1-120
grep -nE 'publish.sh|exit|env-invalid|gate-evidence|dryrun' $K/gate-evidence.sh | cut -c1-140
grep -c -- '--linux-receipt' $K/publish.sh
cd $HOME/projects/snapback-pub-0428 && git rev-parse HEAD && git status --porcelain
ls snapback4/target/publication/
uptime; pmset -g batt | head -1; ioreg -r -k AppleClamshellState | grep '"AppleClamshellState"'

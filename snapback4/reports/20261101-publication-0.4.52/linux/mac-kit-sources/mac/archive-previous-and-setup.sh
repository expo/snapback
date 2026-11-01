#!/bin/bash
set -euo pipefail
export PATH=$HOME/.volta/tools/image/node/24.18.0/bin:$HOME/.bun/bin:$HOME/.cargo/bin:/opt/homebrew/bin:/usr/bin:/bin:/usr/sbin:/sbin
C=${1:?}; W=$HOME/sb4-pub-0444-wt; K=$HOME/sb4-pub-0452
[ -z "$(git -C "$W" status --porcelain)" ]
python3 - "$W" "$K" <<'PY'
import pathlib,sys,shutil
w,k=map(pathlib.Path,sys.argv[1:]);a=k/'previous-0451-records'
for stage in (w/'snapback4/target/publication').glob('*0.4.51*'):
 for p in stage.rglob('*'):
  if p.is_file() and p.suffix in ['.json','.log']:
   q=a/'stage'/stage.name/p.relative_to(stage);q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q)
 shutil.rmtree(stage)
PY
PUB52_SETUP_ONLY=1 bash "$K/setup-pub51.sh" "$C"

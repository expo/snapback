#!/usr/bin/env python3
"""Record a builder's phase transition request; operator timestamps it too."""
import json, os, sys, time
from pathlib import Path

phase = sys.argv[1]
if phase not in ['m2', 'm3', 'm4', 'm5', 'm6', 'm8', 'replay-start', 'replay-end']:
    raise SystemExit('expected m2/m3/m4/m5/m6/m8/replay-start/replay-end')
path = Path(os.environ['CLIQUE_BOUNDARIES'])
with path.open('a') as f:
    f.write(json.dumps({'phase': phase, 'at': time.time()}) + '\n')
    f.flush(); os.fsync(f.fileno())
print('phase request retained:', phase)

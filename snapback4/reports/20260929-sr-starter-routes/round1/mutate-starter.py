#!/usr/bin/env python3
"""Mutate only a temporary scaffold; leave the tested CLI and repository intact.
Run with SR_MUTATION={stale,association,public,fallback} and SNAPBACK4_BIN=this file.
"""
import os
from pathlib import Path
import subprocess
import sys

root = Path(__file__).resolve().parents[3]
args = sys.argv[1:]
binary = str(root / 'target/debug/snapback4')
if not args or args[0] != 'new':
    os.execv(binary, [binary, *args])
run = subprocess.run([binary, *args])
if run.returncode:
    sys.exit(run.returncode)
dir = Path(args[1])
mode = os.environ['SR_MUTATION']
if mode == 'stale':
    path = dir / 'src/Conversation.tsx'
    old, new = '!member.data && member.fresh && !member.revalidating', '!member.data && !member.revalidating'
elif mode == 'association':
    path = dir / 'src/Direct.tsx'
    old, new = 'journal.propose(id, other);', '/* mutation: proposal is not durably recorded */'
elif mode == 'public':
    path = dir / 'snapback/schema.q'
    old = 'read <- .owner = viewer\n  insert <- created conversations[.conversation] and (.owner = viewer or .peer = viewer)\n  sync to .owner'
    # A legal public audience must also widen its read rule; otherwise check
    # refuses E_SYNC before any acquisition assertion can execute.
    new = old.replace('read <- .owner = viewer', 'read <- true').replace('sync to .owner', 'sync public')
elif mode == 'fallback':
    path = dir / 'app/conversation/[id].tsx'
    old = '"data" in pair && !pair.revalidating && pair.data && !pair.data.pending ? pair.data.conversation : null'
    new = 'null /* mutation: no replicated-key recovery */'
else:
    raise ValueError(mode)
text = path.read_text()
assert text.count(old) == 1, (mode, path)
path.write_text(text.replace(old, new))

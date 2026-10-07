#!/usr/bin/env python3
"""Inspect only runners whose cwd is this worktree's Snapback 4 directory."""
from pathlib import Path
import re
root=Path(__file__).resolve().parents[3]
for p in Path('/proc').iterdir():
 if not p.name.isdecimal(): continue
 try:
  if (p/'cwd').resolve()!=root: continue
  cmd=(p/'cmdline').read_bytes()
  if not any(cmd.startswith(c) for c in [b'node\x00scripts/run-rust-tests.mjs\x00',b'node\x00scripts/run-client-tests.mjs\x00']): continue
  log=(p/'fd/1').resolve()
  if not log.is_file(): continue
  s=log.read_text(errors='replace')
  print('RUNNER',p.name,' '.join(cmd.decode().split('\0')[:4]),'LOG',log)
  print('native targets',len(re.findall(r'^-- rust target:',s,re.M)), 'client passed',len(re.findall(r'^-- client file ok:',s,re.M)))
  print('\n'.join(x for x in s.splitlines() if '-- FAIL' in x or '-- client file FAIL' in x or x.startswith('not ok'))[-4000:])
  if 'run-client-tests' in cmd.decode():
   starts=re.findall(r'^-- client file start: ([^;]+);',s,re.M)
   ends=set(re.findall(r'^-- client file (?:ok|FAIL): (.*?) \(',s,re.M))
   print('pending',[x for x in starts if x not in ends][-12:])
  print('tail','\n'.join(s.splitlines()[-3:]))
 except (OSError,ValueError): pass

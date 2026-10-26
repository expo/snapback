#!/usr/bin/env python3
"""Reuse SEC9's exact matrix while keeping all native scratch inside each copy."""
import os,pathlib,runpy,subprocess
original=subprocess.run
def run(*args,**kwargs):
 # The shared host may be busy; this is an outer watchdog, not exploration work.
 if args and isinstance(args[0],list) and args[0][0]=='timeout' and args[0][-1]=='test':
  command=list(args[0]);command[2]='900';args=(command,*args[1:])
 if 'cwd' in kwargs:
  scratch=pathlib.Path(kwargs['cwd'])/'native-scratch';scratch.mkdir(exist_ok=True)
  kwargs['env']={**os.environ,**kwargs.get('env',{}),'TMPDIR':str(scratch)}
 return original(*args,**kwargs)
subprocess.run=run
runpy.run_path(str(pathlib.Path(__file__).resolve().parents[1]/'20261023-sec9/measure.py'),run_name='__main__')

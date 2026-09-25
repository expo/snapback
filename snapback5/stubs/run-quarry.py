#!/usr/bin/env python3
"""Bind every representative lowering using this checkout's unchanged CLI."""
from pathlib import Path
import json, os, shlex, subprocess, sys
ROOT=Path(__file__).resolve().parents[2]
BASE=ROOT/'snapback5/stubs/lowered'
OUT=ROOT/'snapback5/reports'
env=dict(os.environ, CARGO_TARGET_DIR=str(ROOT/'snapback5/stubs/.build'))
results=json.loads((OUT/'20260925-quarry-results.json').read_text()) if (OUT/'20260925-quarry-results.json').exists() else []
for project in sorted(p for p in BASE.iterdir() if p.is_dir()):
    schema=project/'snapback/schema.q'
    if not schema.exists() or (sys.argv[1:] and project.name not in sys.argv[1:]):continue
    # check locates a project from cwd; this version has no single-file mode.
    args=['cargo','run','--locked','--manifest-path',str(ROOT/'snapback4/Cargo.toml'),'-p','snapback4','--','check',str(schema)]
    proc=subprocess.run(args,cwd=project,env=env,stdout=subprocess.PIPE,stderr=subprocess.STDOUT,text=True)
    log=f'$ cd {shlex.quote(str(project))}\n$ CARGO_TARGET_DIR={shlex.quote(env["CARGO_TARGET_DIR"])} '+shlex.join(args)+'\n'+proc.stdout+f'\n[exit {proc.returncode}]\n'
    previous=list(OUT.glob(f'20260925-quarry-{project.name}-attempt-*.log'))
    (OUT/f'20260925-quarry-{project.name}-attempt-{len(previous)+1:02}.log').write_text(log)
    results=[r for r in results if r['project'] != project.name]
    results.append(dict(project=project.name,exit=proc.returncode,output=proc.stdout,command=log.splitlines()[:2]))
    print(project.name,proc.returncode)
    if proc.returncode:print(proc.stdout[-6500:])
(OUT/'20260925-quarry-results.json').write_text(json.dumps(results,indent=2)+'\n')

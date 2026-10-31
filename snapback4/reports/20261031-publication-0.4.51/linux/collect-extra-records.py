#!/usr/bin/env python3
"""Collect explicit PUB051 text evidence, never caches, SDK clones or credentials."""
import gzip, pathlib, shutil, sys
src,dest=map(pathlib.Path,sys.argv[1:])
out=dest/'opening-and-release-evidence';out.mkdir(parents=True,exist_ok=True)
patterns=('records-*','pub-debug-lsof.*','pub-debug-open-files.txt','PUBLICATION-RESULT.md','registry-*.sha256','registry-download-*.log','smoke-registry-*.log','smoke-registry-*.exit','verify-registry.exit','finish-*','prefinish*','linux-prefinish-green.json','mac-prefinish-state.json','smoke-staged-*.log','smoke-staged-*.exit','staged-*.sha256','staged-validation.json','mac-dry-*.json','mac-dry-*.jsonl','prepared-*.sha256','pull-client.log','linux-qualification-validation.json','start-linux-*.log','mac-pre-*','power-hold-*','mac-native-*','mac-final-source-*','native-handoff-*','controller-state.json','publication-source-*','audit-publication-source-*','finalize-source*','final-mac-*','qualify-after-native*','qualified-source.sha','qualified-source.bundle.sha256','WORKSTREAM-REPORT*.md','registry-*.json','selector-*','opening-*','social-fixture-three','social-fixture-three-draft-*','audit-opening-*','audit-release-*','audit-mac-*','audit-linux-*','release-*','fresh-release-*','preflight-*-versions.json','inventory-root*','STOP-REPORT.md','archive-initial-release-draft','20261031-social-quote-jump-async-browser-polling.issue-draft.md','final-registry-status.json','superseded-product-hypothesis.json')
allowed={'.md','.txt','.json','.jsonl','.log','.exit','.out','.diff','.sha256','.gz','.bundle','.sh','.py','.mjs','.q'}
blocked={'node_modules','npm-cache','.npm','.npmrc','.harness-env.json','target','dist','src','test','templates','inputs','client','project','projects','sdk','package'}
files=set()
for pattern in patterns:
 for p in src.glob(pattern):
  if p.is_file(): files.add(p)
  elif p.is_dir():
   for q in p.rglob('*'):
    parts=q.relative_to(p).parts
    if not q.is_symlink() and q.is_file() and not any(x in blocked or x.startswith('.env') for x in parts):files.add(q)
for p in sorted(files):
 rel=p.relative_to(src)
 if p.is_symlink() or p.name in blocked or p.name.startswith('.env') or p.suffix not in allowed:continue
 q=out/rel;q.parent.mkdir(parents=True,exist_ok=True)
 if p.suffix=='.log' and p.stat().st_size>200_000:
  with p.open('rb') as f,gzip.open(str(q)+'.gz','wb',compresslevel=9) as g:shutil.copyfileobj(f,g)
 else:shutil.copy2(p,q)
# Diagnostic projects are intentionally omitted; preserve their concise evidence files only.
diag=src/'diagnosis'
if diag.exists():
 for p in diag.rglob('*'):
  if p.is_symlink() or not p.is_file():continue
  rel=p.relative_to(diag)
  if len(rel.parts)>3 or any(x in blocked or x.startswith('.env') for x in rel.parts):continue
  if p.suffix not in {'.md','.json','.log','.exit','.out','.diff','.sha256','.source','.mjs','.q'}:continue
  if p.stat().st_size>5_000_000:continue
  q=out/'diagnosis'/rel;q.parent.mkdir(parents=True,exist_ok=True);shutil.copy2(p,q)
# Fail if an excluded path could have slipped into any assembled report.
for p in dest.rglob('*'):
 assert not p.is_symlink(),f'unexpected symlink: {p}'
 assert p.name not in {'.npmrc','.harness-env.json','node_modules','npm-cache','.npm'} and not p.name.startswith('.env'),f'excluded path: {p}'
print(f'PUB051 extra evidence: {len(files)} candidates; artifacts collected in {out}')

#!/usr/bin/env python3
"""Summarize completed lane-local evidence; archive only after byte verification."""
import gzip, hashlib, json, math, os, pathlib, re, shutil, statistics, tarfile
report=pathlib.Path(__file__).resolve().parent
repo=report.parents[3]
out=report/'evidence'
def digest(data):return hashlib.sha256(data).hexdigest()
def counts(text):return {k:int(n) for k,n in re.findall(r'^# (tests|pass|fail|cancelled|skipped) (\d+)$',text,re.M)}
def percentile(values,n):return sorted(values)[max(0,math.ceil(len(values)*n)-1)]
def cohort(name):
 base=out/name;results=[json.loads(line) for line in (base/'results.jsonl').read_text().splitlines()]
 logs={p.name:counts(p.read_text()) for p in sorted(base.glob('run-*.log'))}
 drains=[]
 for p in base.rglob('test-drain.jsonl'):
  for line in p.read_text().splitlines():
   row=json.loads(line)
   if row['step']=='test-drain-end' and not row['detail']['allowParked']:drains.append(row['detail']['elapsedMs'])
 return dict(host=json.loads((base/'host.json').read_text()),runs=results,counts=logs,
             retainedDrainSamples=dict(n=len(drains),median=statistics.median(drains),p95=percentile(drains,.95),max=max(drains)) if drains else None)
result=dict(baseCommit='aca7883e26eb3372253eec0db1f7d8f88593ba07',host=os.uname().nodename,
            binarySha256=(out/'binary.sha256').read_text().strip(),finalBinarySha256=(out/'final-binary.sha256').read_text().strip(),
            formatOnly=json.loads((out/'format-only.json').read_text()),
            cohorts={n:cohort(n) for n in ['wakeup-load','export-background','affected-load','affected-load-continuation']},
            commands=[json.loads(line) for line in (out/'checks.jsonl').read_text().splitlines()],
            controls={n:json.loads((out/n/'result.json').read_text()) for n in ['unfixed-controls','stall-controls']},
            finalDiagnostics=counts((out/'diagnostics-final.log').read_text()),finalWakeup=counts((out/'wakeup-final.log').read_text()),
            fixedReplay=counts((out/'fixed-controls.log').read_text()),references=(out/'ref-check.log').read_text().splitlines()[-1],
            inventory='failed: unrelated root inventories/guide and missing generated demo preconditions; see inventories.log.gz')
sources=['snapback4/crates/snapback4/src/verbs/witness/retention.rs','snapback4/crates/snapback4/src/verbs/witness/recovery.rs','snapback4/crates/snapback4/src/verbs/witness/retention_trace.rs',
         'snapback4/packages/snapback4/test/export-background.test.mjs','snapback4/packages/snapback4/test/export-maintenance-wakeup.test.mjs',
         'snapback4/packages/snapback4/test/maintenance-evidence.test.mjs','snapback4/packages/snapback4/test/helpers/maintenance-evidence.py',
         'snapback4/packages/snapback4/test/helpers/maintenance-evidence.mjs','snapback4/packages/snapback4/test/helpers/maintenance_processes.py']
result['sourceSha256']={n:digest((repo/n).read_bytes()) for n in sources}
# Keep summaries of both forced states and the real parked failure easy to inspect.
states={}
for name in ['unfixed-controls','stall-controls','affected-load']:
 for snap in (out/name).rglob('*-failure-drain-timeout'):
  files=snap/'files'
  metadata=json.loads((snap/'snapshot.json').read_text());metadata['inventoryEntries']=len(metadata.pop('files'))
  states[str(snap.relative_to(out))]=dict(snapshot=metadata,
    processes=json.loads((snap/'processes.json').read_text()),
    queue={p.name:json.loads(p.read_text()) for p in files.glob('maintenance-*.json') if p.name in ['maintenance-request.json','maintenance-claimed.json','maintenance-parked.json','maintenance-next.json','maintenance-active.json','maintenance-result.json','maintenance-wakeup.json']},
    drains=[json.loads(line) for line in (snap/'test-drain.jsonl').read_text().splitlines()])
(out/'failure-states.json').write_text(json.dumps(states,indent=2)+'\n')
result['archives']={}
for directory in sorted(p for p in out.iterdir() if p.is_dir()):
 originals={str(p.relative_to(directory)):dict(sha256=digest(p.read_bytes()),bytes=p.stat().st_size,mode=oct(p.stat().st_mode&0o777)) for p in directory.rglob('*') if p.is_file()}
 archive=out/(directory.name+'.tar.gz')
 with tarfile.open(archive,'w:gz') as tar:tar.add(directory,arcname=directory.name)
 with tarfile.open(archive,'r:gz') as tar:
  for member in tar.getmembers():
   if member.isfile():
    key=str(pathlib.PurePosixPath(member.name).relative_to(directory.name));assert digest(tar.extractfile(member).read())==originals[key]['sha256']
    assert oct(member.mode)==originals[key]['mode']
 manifest=out/(directory.name+'.manifest.json.gz');manifest.write_bytes(gzip.compress(json.dumps(originals,indent=2).encode(),mtime=0))
 result['archives'][archive.name]=dict(sha256=digest(archive.read_bytes()),bytes=archive.stat().st_size,files=len(originals),manifest=manifest.name,manifestSha256=digest(manifest.read_bytes()))
 shutil.rmtree(directory)
for log in sorted(out.glob('*.log')):
 raw=log.read_bytes();compressed=log.with_suffix('.log.gz');compressed.write_bytes(gzip.compress(raw,mtime=0))
 assert gzip.decompress(compressed.read_bytes())==raw
 result['archives'][compressed.name]=dict(sha256=digest(compressed.read_bytes()),bytes=compressed.stat().st_size,rawSha256=digest(raw),rawBytes=len(raw))
 log.unlink()
(out/'results.json').write_text(json.dumps(result,indent=2)+'\n')
for p in out.rglob('*'):p.chmod(0o700 if p.is_dir() else 0o600)
print(json.dumps({n:dict(invocations=len(c['runs']),exitFailures=sum(r['code']!=0 for r in c['runs']),totals={k:sum(x.get(k,0) for x in c['counts'].values()) for k in ['tests','pass','fail','cancelled','skipped']},drains=c['retainedDrainSamples']) for n,c in result['cohorts'].items()},indent=2))

#!/usr/bin/env python3
"""Ten fresh installed-document-only intent builders; never writes source lanes."""
import concurrent.futures, datetime, hashlib, json, os, pathlib, shutil, subprocess, tempfile, time
ROOT=pathlib.Path(__file__).resolve().parent
PACKED=ROOT/'packed'
LANES=os.environ.get('SEC5_BUILDER_LANES','001,006,014,025,030,033,036,042,048,050').split(',')
COMMAND=['codex','exec','-m','gpt-6.1-sol','-c','model_reasoning_effort="high"','-c','project_doc_max_bytes=0','--skip-git-repo-check','--dangerously-bypass-approvals-and-sandbox','--json','-']

def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def run():
  results=[];report=ROOT/os.environ.get('SEC5_BUILDER_REPORT','builders');report.mkdir(exist_ok=True)
  with tempfile.TemporaryDirectory(prefix='sb4-sec5-builders-') as scratch_name:
    scratch=pathlib.Path(scratch_name); installed=scratch/'installed';installed.mkdir()
    (installed/'package.json').write_text('{"private":true,"type":"module"}\n')
    install=subprocess.run(['timeout','300s','npm','install','--ignore-scripts','--omit=optional','--no-audit','--no-fund',str(PACKED/'snapback4-0.4.35.tgz'),str(PACKED/'snapback4-linux-x64-0.4.35.tgz')],cwd=installed,capture_output=True,text=True)
    (report/'install.log').write_text(install.stdout+install.stderr)
    if install.returncode: raise RuntimeError('packed installation failed')
    cli=installed/'node_modules/snapback4/bin/snapback4.js'
    def lane_run(number):
      lane=next(pathlib.Path('/home/ccheever/sb4-loop/wave20/apps').glob(number+'-snapback-*'))
      project=scratch/lane.name;project.mkdir();(project/'snapback').mkdir()
      destination=report/lane.name;destination.mkdir(exist_ok=True)
      original=destination/'original';original.mkdir(exist_ok=True)
      for source in sorted((lane/'snapback').rglob('*.q')):
        if 'generated' in source.parts: continue
        rel=source.relative_to(lane/'snapback')
        for base in [project/'snapback',original]:
          (base/rel).parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,base/rel)
      brief=(lane/'BRIEF.md').read_text();spec=brief.split('## The app\n',1)[1].split('\n## The stack',1)[0]
      (project/'SPEC.md').write_text(spec);(destination/'SPEC.md').write_text(spec)
      (project/'package.json').write_text('{"private":true,"type":"module"}\n')
      os.symlink(installed/'node_modules',project/'node_modules',target_is_directory=True)
      prompt=f'''You are a fresh application builder reviewing security intent for an existing app. Work autonomously in {project} only. Read SPEC.md and the authored snapback/*.q files. Learn the product ONLY from the installed package README at {installed}/node_modules/snapback4/README.md and its installed CLI guides. Begin with installed guide start and guide security --full. Do not read any source repository, other builder lanes, ancestor project instructions, bakeoff analysis, probes, or security findings.

Complete the installed documentation's recommended security-intent review loop. Answer the generated per-role/per-column questionnaire from SPEC.md. Author independent invariants for the privacy and authority requirements that the specification actually states. Existing assertions may be kept, replaced or supplemented. Assess every role and sensitive/derived column, including within-role access and lifecycle restrictions, without assuming that the existing rules are correct.

For this measurement you may ONLY add/remove/replace single-line `invariant ` declarations in authored .q files: all other existing lines must remain byte-for-byte unchanged. Do not repair rules or operations. Put your reasoning and any recommended fixes in REVIEW.md; do not weaken confirmed specification intent to make checks pass. Run the installed CLI check --json, test --fixture-only, and audit --json. Save complete command output to check.json, test.txt and audit.json; nonzero results are meaningful evidence. Every shell command needs timeout. Do not start persistent servers yourself; test manages its own isolated hosts. Keep scratch within this directory and clean it up.

Invoke the installed CLI as: node {cli} <verb>. A command must run in {project}; timeout 30s is sufficient for guide, 60s for check/audit, 180s for test. Never modify files under the shared installed package. Finish with a brief summary of the independent intent you wrote and what the commands found. There is no human to ask.
'''
      (destination/'prompt.txt').write_text(prompt)
      started=time.time();env=dict(os.environ);env.pop('SNAPBACK4_BIN',None);env.pop('PORT_LO',None);env.pop('PORT_HI',None)
      proc=subprocess.run(['timeout','--kill-after=5s','480s',*COMMAND],cwd=project,input=prompt,capture_output=True,text=True,env=env)
      (destination/'transcript.jsonl').write_text(proc.stdout);(destination/'stderr.txt').write_text(proc.stderr)
      final=destination/'final';final.mkdir(exist_ok=True)
      for source in sorted((project/'snapback').rglob('*.q')):
        if 'generated' in source.parts: continue
        rel=source.relative_to(project/'snapback');(final/rel).parent.mkdir(parents=True,exist_ok=True);shutil.copyfile(source,final/rel)
      for name in ['REVIEW.md','check.json','test.txt','audit.json']:
        if (project/name).exists():shutil.copyfile(project/name,destination/name)
      generated=project/'snapback/generated'
      for name in ['security-invariants.q.draft','security-test.json']:
        if (generated/name).exists():shutil.copyfile(generated/name,destination/name)
      unchanged=True;before=[];after=[]
      for source in sorted(original.rglob('*.q')):
        a=source.read_text().splitlines(True);b=(final/source.relative_to(original)).read_text().splitlines(True)
        before.extend(line.strip() for line in a if line.startswith('invariant '));after.extend(line.strip() for line in b if line.startswith('invariant '))
        unchanged &= [line for line in a if not line.startswith('invariant ')] == [line for line in b if not line.startswith('invariant ')]
      result={'lane':lane.name,'source':str(lane),'command':COMMAND,'exitCode':proc.returncode,'seconds':round(time.time()-started,2),'onlyInvariantLinesChanged':unchanged,'originalInvariants':before,'finalInvariants':after,'sourceSha256':{str(p.relative_to(original)):digest(p) for p in original.rglob('*.q')}}
      (destination/'provenance.json').write_text(json.dumps(result,indent=2)+'\n')
      return result
    with concurrent.futures.ThreadPoolExecutor(max_workers=int(os.environ.get('SEC5_BUILDER_WORKERS','2'))) as executor:
      futures={executor.submit(lane_run,n):n for n in LANES}
      for future in concurrent.futures.as_completed(futures):
        try:result=future.result()
        except Exception as error:result={'lane':futures[future],'error':str(error)}
        results.append(result);print(json.dumps({k:v for k,v in result.items() if k not in ['originalInvariants','finalInvariants','sourceSha256']}),flush=True)
        (report/'results.json').write_text(json.dumps(results,indent=2)+'\n')
  return results
if __name__=='__main__':run()

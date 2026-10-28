from pathlib import Path
import subprocess,json,os,time,hashlib,shutil
p=Path(__file__).parent;repo=Path('/home/ccheever/projects/snapback-sb4loop');records=[];env={**os.environ,'CARGO_INCREMENTAL':'0','CARGO_PROFILE_DEV_DEBUG':'0','CARGO_PROFILE_TEST_DEBUG':'0','CARGO_BUILD_JOBS':'16','RUST_MIN_STACK':'33554432'}
def cmd(args,cwd=repo,seconds=120):return subprocess.check_output(['timeout','--kill-after=10s',str(seconds)+'s',*args],cwd=cwd,env=env,text=True)
def run(name,args,cwd=repo,seconds=1800):
 start=time.time();print('START',name,flush=True)
 with(p/(name+'.log')).open('w')as log:r=subprocess.run(['timeout','--kill-after=30s',str(seconds)+'s',*args],cwd=cwd,env=env,stdout=log,stderr=subprocess.STDOUT)
 records.append(dict(name=name,exit=r.returncode,seconds=time.time()-start,command=args,source=cmd(['git','rev-parse','HEAD']).strip()));(p/'guide-repair-results.json').write_text(json.dumps(records,indent=2)+'\n');print('END',name,r.returncode,flush=True);assert r.returncode==0,(name,r.returncode)
receipt=p/'incoming-affected/result.json';deadline=time.monotonic()+3600
while not receipt.exists():
 assert time.monotonic()<deadline,'incoming receipt wait expired'
 time.sleep(5)
r=json.loads(receipt.read_text())['receipt'];assert r['complete']and r['unchanged'];bad={x['id']for x in r['results']if x['status']!=0};assert bad=={'rust:snapback4-lang','client-tests'},bad
assert cmd(['git','rev-parse','HEAD']).strip()=='dc4177b57f9d281e89c5d3a1e33770256118c209';assert not cmd(['git','status','--porcelain']).strip()
assert json.loads((p/'incoming-clients-corrected-result.json').read_text())['exit']==0
f=repo/'snapback4/crates/snapback4-lang/src/guide/release-json.md';binding=json.loads((p/'release-guide-closure-input.json').read_text());assert hashlib.sha256(f.read_bytes()).hexdigest()==binding['beforeSha256'];f.write_bytes((p/'release-guide-after.md').read_bytes())
j=repo/'snapback4/JOURNAL.md';j.write_text(j.read_text()+"\n\n### 2026-10-28 — Integration 30 incoming-main guide closure\n\nThe incoming Postgres read-index reference introduced a checkout-only LLP citation and private Rust filenames into the published release card. The existing complete guide target correctly refused both. State the same supported-writer session/principal/family/clock contract, serialized head fence and same-commit unified revision in operator prose, including administrative writes without a public sequence. This also keeps the contract visible through the guide renderer instead of dropping the paragraph as implementation references. No authority, assertion or budget changes. Retain the original failed target; rerun the full guide target and prove the actual fixed packed guide against the prior packed counterexample. All other runtime, SDK and consumer inputs remain unchanged from the complete incoming-main consumer chain.\n")
cmd(['git','add','snapback4/crates/snapback4-lang/src/guide/release-json.md','snapback4/JOURNAL.md']);print(cmd(['git','-c','gc.auto=0','-c','user.name=Charlie Cheever','-c','user.email=ccheever@firewoodagent.com','commit','-m','snapback4: make the Postgres read-index guide self-contained']),flush=True)
source=cmd(['git','rev-parse','HEAD']).strip();(p/'guide-repair-source.json').write_text(json.dumps(dict(source=source,onlyChangedPaths=cmd(['git','diff','--name-only','dc4177b57f',source]).splitlines(),guideSha256=hashlib.sha256(f.read_bytes()).hexdigest(),method='Only release guide prose and its journal record change. All runtime/SDK/proof/lifecycle/security/engine code remains exact dc4177; full R4 chain reused only for unchanged semantic inputs, with fresh affected packed guide closure on final bytes.'),indent=2)+'\n')
run('guide-repair-target',['cargo','test','--locked','-j','16','-p','snapback4-lang','--test','guide'],repo/'snapback4')
run('guide-repair-docs-budget',['node','scripts/docs-budget.mjs'],repo/'snapback4',900)
run('guide-repair-native-build',['bash','scripts/build-linux-musl.sh'],repo/'snapback4',3600)
native=p/'snapback4-0.4.46-final';shutil.copy2(repo/'snapback4/target/x86_64-unknown-linux-musl/production/snapback4',native)
(p/'shipping-binary-final.json').write_text(json.dumps(dict(source=source,binary=str(native),sha256=hashlib.sha256(native.read_bytes()).hexdigest(),profile='production',target='x86_64-unknown-linux-musl',elf='passed: static, no interpreter/shared dependencies',fullConsumerR4Source='dc4177b57f9d281e89c5d3a1e33770256118c209',fullConsumerR4BinarySha256='811295a71cd7929c93027fb31965ead2ccd2cc6ad154ed9f5333a88ef6ba4955',delta='Only self-contained guide prose; all executable behavior code and SDK inputs unchanged. Final packed guide delta qualified independently.'),indent=2)+'\n')
run('packed-guide-closure',['python3',str(p/'packed-guide-closure.py')],repo,1200)
shutil.copy2(p/'reading-replay.json',p/'reading-replay-main.json');shutil.copy2(p/'reading-summary-final.json',p/'reading-summary-main.json');s=(p/'reading-final.mjs').read_text();assert "join(out,'snapback4-0.4.46-main')"in s;(p/'reading-shipping.mjs').write_text(s.replace("join(out,'snapback4-0.4.46-main')","join(out,'snapback4-0.4.46-final')"));run('reading-shipping',['node',str(p/'reading-shipping.mjs')],repo,900)
print('GUIDE REPAIR, FOCUSED PACKED COUNTEREXAMPLE, SHIPPING READING ALL PASS',flush=True)

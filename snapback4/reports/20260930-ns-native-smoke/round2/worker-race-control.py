from pathlib import Path
import subprocess,json,os
root=Path.cwd(); r=root/'snapback4/reports/20260930-ns-native-smoke/round2'
source=(root/'snapback4/packages/snapback4/test/supervised-workers.test.mjs').read_text()
worker=(root/'snapback4/packages/snapback4/dist/worker.js').as_uri()
source=source.replace('"../dist/worker.js"',json.dumps(worker))
original='child.stderr.on("data", bytes => { stderr += bytes; });'
assert source.count(original)==1
hold='''child.stderr.on("data", bytes => {
    const text = String(bytes);
    const held = text.match(/\\[worker:push\\] authenticated:push(?:\\r?\\n|$)/)?.[0];
    if (!held) { stderr += text; return; }
    stderr += text.replace(held, "");
    console.error("NS_CONTROL: hold only the push authentication log delivery for 250ms; leave startup files unchanged");
    setTimeout(() => { stderr += held; }, 250);
  });'''
path=r/'worker-race-control.test.mjs'; path.write_text(source.replace(original,hold))
results=[]
for label,binary in [('round1',root.parent/'ns-r1-binary'),('round2',root/'snapback4/target/debug/snapback4')]:
 with (r/('worker-race-'+label+'.log')).open('w') as log:
  result=subprocess.run(['node','--test','--test-name-pattern=^dev declares two workers',str(path)],env=dict(os.environ,SNAPBACK4_BIN=str(binary)),stdout=log,stderr=subprocess.STDOUT)
 text=(r/('worker-race-'+label+'.log')).read_text()
 assert result.returncode!=0 and 'NS_CONTROL' in text and 'authenticated:push' in text and 'ERR_ASSERTION' in text
 results.append({'revision':label,'exit':result.returncode,'heldLogDeliveryMs':250,'startupFilesUnchanged':True})
(r/'worker-race-control.json').write_text(json.dumps(results,indent=2)+'\n');print(json.dumps(results,indent=2))

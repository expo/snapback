from pathlib import Path
import json, os, subprocess
root=Path.cwd();out=root/'target/rx/r1/residency-controls';out.mkdir(exist_ok=True)
records=[]
for trial in range(10):
 for label,binary in [('rx',root/'target/debug/snapback4'),('published-0.4.13',root/'target/rx/published/snapback4-linux-x64/package/snapback4')]:
  env={**os.environ,'SNAPBACK4_BIN':str(binary)}
  result=subprocess.run(['node','--test','--test-name-pattern=^server-class watches run locally','packages/snapback4/test/residency.test.mjs'],env=env,text=True,stdout=subprocess.PIPE,stderr=subprocess.STDOUT)
  log=out/f'{label}-{trial}.log';log.write_text(result.stdout)
  record={'engine':label,'trial':trial,'exit':result.returncode,'log':log.name};records.append(record)
  (out/'results.json').write_text(json.dumps(records,indent=2)+'\n')
  print(json.dumps(record),flush=True)

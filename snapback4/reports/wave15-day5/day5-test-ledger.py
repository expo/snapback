from pathlib import Path
import re,json

def parse(path):
 text=Path(path).read_text(errors='replace');key=None;out={}
 for line in text.splitlines():
  m=re.search(r'Running (.+?) \(target/',line)
  if m:key=m[1]
  elif 'Doc-tests ' in line:key=line.strip()
  m=re.search(r'test result: (\w+)\. (\d+) passed; (\d+) failed; (\d+) ignored; (\d+) measured; (\d+) filtered out',line)
  if m and key:out[key]={'result':m[1],'passed':int(m[2]),'failed':int(m[3]),'ignored':int(m[4]),'filtered':int(m[6])}
 return out
cli=parse('/tmp/day5-cli-final-full.log');fix=parse('/tmp/day5-r3-rust.log');cli.update(fix);cli.update(parse('/tmp/day5-r4-rust.log'));cli.update(parse('/tmp/day5-r5-native-cli.log'))
print('CLI combined target coverage',len(cli),'passed',sum(x['passed'] for x in cli.values()),'reds',[(k,v) for k,v in cli.items() if v['failed']])
for name,path in [('core','snapback4/reports/wave15-day5/full-cargo/snapback4-core.log'),('lang','/tmp/day5-r3-lang.log'),('device','/tmp/day5-full-device-rerun.log'),('sim','/tmp/day5-full-sim.log')]:
 d=parse(path);
 if name=='lang':d.update(parse('/tmp/day5-r4-guide-final.log'))
 print(name,'targets',len(d),'passed',sum(x['passed'] for x in d.values()),'reds',[(k,v) for k,v in d.items() if v['failed']])
Path('/tmp/day5-test-target-ledger.json').write_text(json.dumps({'CLI_full_with_corrected_targets':cli,'core':parse('snapback4/reports/wave15-day5/full-cargo/snapback4-core.log'),'lang':{**parse('/tmp/day5-r3-lang.log'),**parse('/tmp/day5-r4-guide-final.log')},'device':parse('/tmp/day5-full-device-rerun.log'),'sim':parse('/tmp/day5-full-sim.log')},indent=2)+'\n')

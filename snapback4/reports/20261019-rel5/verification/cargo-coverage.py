from pathlib import Path
import re,json
home=Path('/home/ccheever')
records={}
def parse(file,initial=None,ignore_lang=False):
 s=(home/file).read_text();current=initial
 markers=list(re.finditer(r'^     Running (.+?) \(target/[^\n]+\)$',s,re.M))
 for n,m in enumerate(markers):
  label=m[1];exe=m[0].split('/')[-1].split('-')[0]
  if label.startswith('unittests'):
   match=re.search(r'deps/(snapback4(?:_core|_device|_lang|_sim)?)-',m[0])
   if match:current=match[1].replace('_','-')
   target=match[1] if match else current
  else:target=Path(label).stem
  end=markers[n+1].start() if n+1<len(markers) else len(s)
  verdicts=re.findall(r'^test result: (ok|FAILED)\. (\d+) passed; (\d+) failed; (\d+) ignored;.*$',s[m.end():end],re.M)
  if current and verdicts and not(ignore_lang and current=='snapback4-lang'):
   v=verdicts[-1];records[(current,target)]={'status':v[0],'passed':int(v[1]),'failed':int(v[2]),'ignored':int(v[3]),'log':file}
parse('sb4-rel5-cargo-full.log','snapback4',True)
parse('sb4-rel5-lang-sim-full.log','snapback4-lang')
for file,pkg in [('sb4-rel5-check-target-final.log','snapback4'),('sb4-rel5-cli-unit-final.log','snapback4'),('sb4-rel5-lane-source-final.log','snapback4-core'),('sb4-rel5-readauth-final.log','snapback4-device'),('sb4-rel5-guide-corpus-final3.log','snapback4-lang'),('sb4-rel5-evolution8.log','snapback4-lang'),('sb4-rel5-corpus-tail-final.log','snapback4-lang'),('sb4-rel5-diagnostic-final.log','snapback4-lang')]:parse(file,pkg)
meta=json.loads((home/'sb4-rel5-cargo-metadata.json').read_text());summary={}
for p in meta['packages']:
 if p['name'] not in ['snapback4','snapback4-core','snapback4-device','snapback4-lang','snapback4-sim']:continue
 expected={t['name'] for t in p['targets'] if t['test']}
 found={k[1]:v for k,v in records.items() if k[0]==p['name']}
 summary[p['name']]={'expectedTargets':len(expected),'completedTargets':len(expected&found.keys()),'missingTargets':sorted(expected-found.keys()),'failedTargets':[k for k,v in found.items() if v['status']!='ok'],'passedTests':sum(v['passed'] for v in found.values()),'ignoredTests':sum(v['ignored'] for v in found.values())}
print(json.dumps(summary,indent=2))
(home/'sb4-rel5-cargo-coverage.json').write_text(json.dumps({'packages':summary,'targets':[{'package':k[0],'target':k[1],**v} for k,v in sorted(records.items())]},indent=2)+'\n')

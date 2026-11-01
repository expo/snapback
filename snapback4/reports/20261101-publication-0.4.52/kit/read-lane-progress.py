from pathlib import Path
import json,subprocess,shutil,re
k=Path.home()/'sb4-pub-0452';w=Path.home()/'sb4-pub-0444-wt/snapback4';r=w/'reports/20261101-publication-0.4.52'
q={'freeGiB':shutil.disk_usage(w).free//2**30,'power':subprocess.check_output(['pmset','-g','batt'],text=True).splitlines()[0]}
for n in ['lean-1','warm-1','dry-run-1','finish-1']:
 p=k/(n+'.exit');q[n]=p.read_text().strip() if p.exists() else 'pending'
q['invalid']=(k/'dry-run-1.env-invalid').read_text().strip() if (k/'dry-run-1.env-invalid').exists() else None
p=k/'isolated/pre/pre.log';t=p.read_text() if p.exists() else '';q['prePassed']=len(re.findall(r'^-- client file ok:',t,re.M));q['preFailed']=re.findall(r'^-- client file FAIL: ([^\n]+)',t,re.M);q['preComplete']=(k/'isolated/pre/pre.exit').exists() and (k/'isolated/pre/pre.exit').read_text().strip()=='0' and bool(re.search(r'^-- client files: 49/49; failed 0;',t,re.M))
p=r/'attempt-1-publication-dry-run.log';t=p.read_text() if p.exists() else '';q['dryPassedFiles']=len(re.findall(r'^-- client file ok:',t,re.M));q['dryFailed']=re.findall(r'^-- client file FAIL: ([^\n]+)',t,re.M);q['dryFailedSteps']=re.findall(r'^-- FAIL.*$',t,re.M);q['dryPhase']=(re.findall(r'^== (.*)$',t,re.M) or ['pending'])[-1]
print(json.dumps(q))

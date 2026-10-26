#!/usr/bin/env python3
import os
"""Measure S6's documented typed-column repair, not an original-source closure."""
import argparse,hashlib,json,pathlib,re,shutil,subprocess,tempfile
p=argparse.ArgumentParser();p.add_argument('--binary',required=True);p.add_argument('--out',required=True);a=p.parse_args()
source=next((pathlib.Path.home()/'sb4-loop/wave26/apps').glob('024-snapback-*/snapback/schema.q')).read_text()
fixed,count=re.subn(r'(photo(?:Table|Slate|Stair): )text <=500',r'\1image <=5000000',source)
assert count==6,count
fixed += '\ninvariant moves always .photoTable != null and .photoSlate != null and .photoStair != null\n'
with tempfile.TemporaryDirectory(prefix='sb4-sec10-text-repair-') as tmp:
 root=pathlib.Path(tmp);(root/'snapback').mkdir();(root/'native-scratch').mkdir();(root/'snapback/schema.q').write_text(fixed)
 binary=root/'snapback4';shutil.copy2(pathlib.Path(a.binary).resolve(),binary)
 r=subprocess.run(['timeout','120',str(binary),'check','--json'],cwd=root,env={**os.environ,'TMPDIR':str(root/'native-scratch')},capture_output=True,text=True);d=json.loads(r.stdout)
 gates=[dict(code=g['code'],site=g['site']) for g in d['securityReviews'] if g['gated'] and not g['acknowledged']]
 deploy=subprocess.run(['timeout','180',str(binary),'deploy',str(root/'deployment'),'--json'],cwd=root,env={**os.environ,'TMPDIR':str(root/'native-scratch')},capture_output=True,text=True)
 result=dict(binarySha256=hashlib.sha256(binary.read_bytes()).hexdigest(),originalSourceSha256=hashlib.sha256(source.encode()).hexdigest(),sourceSha256=hashlib.sha256(fixed.encode()).hexdigest(),typeReplacements=count,presenceIntentLines=1,checkExit=r.returncode,gates=gates,deployExit=deploy.returncode,securityRefused='E_SECURITY_REVIEW' in deploy.stdout+deploy.stderr,qualification='typed-column repair plus one explicit presence intent; original text remains advisory')
 assert any(g['code']=='N_OPTIONAL_UPLOAD_CREATE' for g in gates),gates
 assert result['securityRefused']
 pathlib.Path(a.out).write_text(json.dumps(result,indent=2)+'\n');print(json.dumps(result))

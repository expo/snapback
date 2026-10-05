"""Show the regressions fail when either round-3 implementation is restored."""
import ast,json,subprocess,sys,unittest
from pathlib import Path
from unittest.mock import patch
root=Path.cwd()/'benchmarks/native/0.4.0-native.1'
sys.path[:0]=[str(root/'driver'),str(root/'tests')]
import evidence,run,test_round4

def prior(file,name,namespace,method=False):
    text=subprocess.check_output(['git','show','ea8dc853ab:benchmarks/native/0.4.0-native.1/driver/'+file],text=True)
    body=ast.parse(text).body
    if method:body=next(n for n in body if isinstance(n,ast.ClassDef) and n.name=='Driver').body
    node=next(n for n in body if isinstance(n,ast.FunctionDef) and n.name==name)
    scope=dict(namespace);exec(compile(ast.Module(body=[node],type_ignores=[]),'round3-'+file,'exec'),scope)
    return scope[name]

results=[]
for name,target,attribute,value,test in [
 ('restore-round3-polling',run.Driver,'m6',prior('run.py','m6',run.__dict__,True),test_round4.StickyDisclosure('test_transient_pixels_fail_and_keep_first_capture')),
 ('restore-round3-pixel-scan',test_round4,'viewonce_pixels',prior('evidence.py','viewonce_pixels',evidence.__dict__),test_round4.ScaledPixels('test_bounded_scales_mats_and_tonal_changes'))]:
    with patch.object(target,attribute,value):result=unittest.TextTestRunner(verbosity=2).run(unittest.TestSuite([test]))
    results.append({'mutation':name,'caught':not result.wasSuccessful(),'failures':len(result.failures),'errors':len(result.errors)})
print(json.dumps(results,indent=2))
sys.exit(0 if all(r['caught'] and r['failures'] and not r['errors'] for r in results) else 1)

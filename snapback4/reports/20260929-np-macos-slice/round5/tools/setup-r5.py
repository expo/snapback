from pathlib import Path
import json,os,subprocess,time
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round5';env=os.environ.copy();env['DEVELOPER_DIR']='/Applications/Xcode.app/Contents/Developer';env['TMPDIR']=str(r/'tmp')
a=['xcrun','simctl','create','np-mac-round5','com.apple.CoreSimulator.SimDeviceType.iPhone-18-Pro','com.apple.CoreSimulator.SimRuntime.iOS-27-0'];t=time.monotonic();u=subprocess.check_output(a,env=env,text=True).strip();(e/'owned.udid').write_text(u+'\n')
with (e/'simulator-boot.log').open('x') as log:
 for args in [['xcrun','simctl','boot',u],['xcrun','simctl','bootstatus',u,'-b']]:subprocess.run(args,env=env,stdout=log,stderr=subprocess.STDOUT,check=True)
(e/'simulator-setup.json').write_text(json.dumps({'udid':u,'create':a,'durationMs':round((time.monotonic()-t)*1000)},indent=2));print(u)

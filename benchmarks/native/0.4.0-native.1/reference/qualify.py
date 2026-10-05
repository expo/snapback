#!/usr/bin/env python3
"""Run a named driver control in scratch. Never invokes a model or a score."""
import argparse,json,os,subprocess,time,uuid,hashlib
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('control');p.add_argument('--segment',default='m6',choices=['m6','m8']);a=p.parse_args()
root=Path(__file__).resolve().parent.parent
assert str(root).startswith(('/tmp/ni-','/private/tmp/ni-')), 'scratch required'
run=root/'runs'/(a.control+'-'+a.segment+'-'+time.strftime('%H%M%S'))
run.mkdir(parents=True)
node=subprocess.check_output(['node','-p','process.execPath'],text=True).strip()
app=root/'DerivedData/Build/Products/Release-iphonesimulator/NIReference.app'
xctestrun=next((root/'DerivedData/Build/Products').glob('*.xctestrun'))
runner=next((root/'DerivedData/Build/Products/Release-iphonesimulator/CliqueDriver-Runner.app/PlugIns').glob('*.xctest'))/'CliqueDriver'
env=os.environ.copy();env['NI_FAULT']=a.control
env['CLIQUE_ALICE_EMAIL']='alice@example.com';env['CLIQUE_BOB_EMAIL']='bob@example.com'
env['CLIQUE_ALICE_PASSWORD']=uuid.uuid4().hex[:12];env['CLIQUE_BOB_PASSWORD']=uuid.uuid4().hex[:12]
env['CLIQUE_PLAYWRIGHT_PACKAGE']=str(root/'app/package.json')
c={'app':str(app),'bundleId':'dev.clique.ni.reference','udid':'3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B',
 'origin':'http://127.0.0.1:49491','webOrigin':'http://127.0.0.1:49491','backendCwd':str(root),
 'backendArgv':[node,str(root/'reference/server.mjs'),str(run/'store'),'49491'],'dataDirectory':str(run/'store'),
 'seedArgv':[node,str(root/'reference/adapter.mjs'),'seed'],'oracleArgv':[node,str(root/'reference/adapter.mjs'),'oracle'],
 'ordinaryImage':str(root/'reference/ordinary.png'),'viewOnceImage':str(root/'reference/once.png'),
 'videoCheckArgv':[str(root/'video-check')],'driverBinarySha256':hashlib.sha256(runner.read_bytes()).hexdigest(),
 'runnerCwd':str(root),'runnerArgv':['xcodebuild','test-without-building','-xctestrun',str(xctestrun),'-derivedDataPath',str(root/'DerivedData'),'-resultBundlePath',str(run/'test.xcresult'),'-destination','platform=iOS Simulator,id=3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B','-parallel-testing-enabled','NO','-maximum-concurrent-test-simulator-destinations','1','-only-testing:CliqueDriver/NativeDriver/testCommands'],
 'instrument':json.loads((root/'identity.json').read_text()) if (root/'identity.json').exists() else {'status':'development-candidate'}}
if a.control=='undecodable-video':c['videoCheckArgv']=[str(root/'venv/bin/python'),str(root/'reference/invalid-video.py')]
(run/'config.json').write_text(json.dumps(c,indent=2)+'\n')
start=time.monotonic()
subprocess.run(['xcrun','simctl','uninstall',c['udid'],c['bundleId']],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
driver=root/('reference/replay-restart.py' if a.control=='stale-restart-capture' else 'driver/run.py')
proc=subprocess.run([str(root/'venv/bin/python'),str(driver),'--config',str(run/'config.json'),'--segment',a.segment,'--out',str(run/'evidence')],env=env)
cleanup=subprocess.run(['xcrun','simctl','uninstall',c['udid'],c['bundleId']],capture_output=True)
(run/'operator.json').write_text(json.dumps({'control':a.control,'segment':a.segment,'wallSeconds':round(time.monotonic()-start,3),'exitCode':proc.returncode,'operatorSteps':['invoke named qualification command','review retained result'],'cleanupUninstallExit':cleanup.returncode},indent=2)+'\n')
print(str(run),flush=True)

#!/usr/bin/env python3
"""Run one reference control from durable prepared app and runner products."""
import argparse
import hashlib
import json
import os
import subprocess
import time
import uuid
from pathlib import Path

SOURCE=Path(__file__).resolve().parent.parent
UDID='3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B'

def sha(path):return hashlib.sha256(Path(path).read_bytes()).hexdigest()

parser=argparse.ArgumentParser()
parser.add_argument('control');parser.add_argument('--segment',default='m6',choices=['m6','m8'])
parser.add_argument('--work',required=True,type=Path);parser.add_argument('--runner',required=True,type=Path)
parser.add_argument('--runs',type=Path);a=parser.parse_args()
work=a.work.resolve();runs=(a.runs or work/'runs').resolve();runner_config=json.loads(a.runner.resolve().read_text())
if any(str(path).startswith(('/tmp/','/private/tmp/','/var/tmp/','/private/var/tmp/')) for path in [work,runs]):
    raise SystemExit('durable work and runs paths required')
run=runs/(a.control+'-'+a.segment+'-'+time.strftime('%Y%m%d-%H%M%S'));run.mkdir(parents=True)
node=subprocess.check_output(['node','-p','process.execPath'],text=True).strip()
app=work/'DerivedData/Build/Products/Release-iphonesimulator/NIReference.app'
xctestrun=Path(runner_config['xctestrun']).resolve();runner=Path(runner_config['binary']).resolve()
if not app.is_dir() or not xctestrun.is_file() or not runner.is_file():raise SystemExit('prepared app or durable runner missing')
env=os.environ.copy();env['NI_FAULT']=a.control
developer_dir=env.get('DEVELOPER_DIR')
if not developer_dir:raise SystemExit('DEVELOPER_DIR must pin the qualified Xcode')
xcodebuild=subprocess.check_output(['/usr/bin/xcrun','--find','xcodebuild'],env=env,text=True).strip()
simctl=subprocess.check_output(['/usr/bin/xcrun','--find','simctl'],env=env,text=True).strip()
env['CLIQUE_ALICE_EMAIL']='alice@example.com';env['CLIQUE_BOB_EMAIL']='bob@example.com'
env['CLIQUE_ALICE_PASSWORD']=uuid.uuid4().hex[:12];env['CLIQUE_BOB_PASSWORD']=uuid.uuid4().hex[:12]
env['CLIQUE_PLAYWRIGHT_PACKAGE']=str(work/'app/package.json')
store=run/'store';store.mkdir()
c={'app':str(app),'bundleId':'dev.clique.ni.reference','udid':UDID,
 'origin':'http://127.0.0.1:49491','webOrigin':'http://127.0.0.1:49491','backendCwd':str(SOURCE),
 'backendArgv':[node,str(SOURCE/'reference/server.mjs'),str(store),'49491'],'dataDirectory':str(store),
 'seedArgv':[node,str(SOURCE/'reference/adapter.mjs'),'seed'],'oracleArgv':[node,str(SOURCE/'reference/adapter.mjs'),'oracle'],
 'ordinaryImage':str(SOURCE/'reference/ordinary.png'),'viewOnceImage':str(SOURCE/'reference/once.png'),
 'videoCheckArgv':[str(work/'video-check')],'driverBinarySha256':sha(runner),
 'developerDir':developer_dir,'runnerCwd':str(work),'runnerArgv':[xcodebuild,'test-without-building','-xctestrun',str(xctestrun),'-resultBundlePath',str(run/'test.xcresult'),'-destination','platform=iOS Simulator,id='+UDID,'-parallel-testing-enabled','NO','-maximum-concurrent-test-simulator-destinations','1','-only-testing:CliqueDriver/NativeDriver/testCommands'],
 'instrument':json.loads((SOURCE/'QUALIFIED.json').read_text())['instrument']}
if a.control=='undecodable-video':c['videoCheckArgv']=[str(work/'venv/bin/python'),str(SOURCE/'reference/invalid-video.py')]
(run/'config.json').write_text(json.dumps(c,indent=2)+'\n')
start=time.monotonic()
subprocess.run([simctl,'uninstall',UDID,c['bundleId']],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL,env=env)
passive=a.control in {'journal-failure','journal-overflow','recycling','stalled-writer'}
driver=SOURCE/('reference/passive-controls.py' if passive else ('reference/replay-restart.py' if a.control=='stale-restart-capture' else 'driver/run.py'))
extra=['--control',a.control] if passive else []
with (run/'driver.log').open('xb') as log:
    proc=subprocess.run([str(work/'venv/bin/python'),str(driver),'--config',str(run/'config.json'),'--segment',a.segment,'--out',str(run/'evidence'),*extra],env=env,stdout=log,stderr=subprocess.STDOUT)
cleanup=subprocess.run([simctl,'uninstall',UDID,c['bundleId']],capture_output=True,env=env)
(run/'operator.json').write_text(json.dumps({'control':a.control,'segment':a.segment,'source':str(SOURCE),'work':str(work),
 'runner':str(a.runner.resolve()),'wallSeconds':round(time.monotonic()-start,3),'exitCode':proc.returncode,
 'operatorSteps':['invoke named qualification command','review retained result'],'cleanupUninstallExit':cleanup.returncode},indent=2)+'\n')
print(str(run),flush=True)
raise SystemExit(proc.returncode)

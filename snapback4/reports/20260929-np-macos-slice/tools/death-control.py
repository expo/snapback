import pathlib,subprocess,time,json,os,re,signal,hashlib
r=pathlib.Path('/Users/ccheever/sb4-np');u=(r/'evidence/qualified.udid').read_text().strip();started=time.time();name='control-death-prime'; log=r/'evidence'/name/'repack-smoke-ios-launch.log'; env=os.environ.copy();env['DEVELOPER_DIR']='/Applications/Xcode.app/Contents/Developer'
p=subprocess.Popen(['python3',str(r/'run-witness.py'),name,'--repack',str(r/'evidence/a-ownbuild-1/build.json'),'--app-project',str(r/'subject'),'--smoke','--udid',u,'--port','49371'],stdout=subprocess.DEVNULL)
container=None;killed=False
while p.poll() is None:
 if log.exists() and not container:
  container=pathlib.Path(subprocess.check_output(['xcrun','simctl','get_app_container',u,'app.clique.astra','data'],env=env,text=True).strip())/'Documents/.snapback4-witness'
 if container and container.exists() and not killed:
  for folder in container.iterdir():
   if not folder.is_dir() or not folder.name.split('-')[0].isdigit() or int(folder.name.split('-')[0])<int(started*1000):continue
   receipt=folder/'receipts.jsonl'
   if not receipt.exists():continue
   rows=[]
   for line in receipt.read_text().splitlines():
    try:rows.append(json.loads(line))
    except:pass
   if any(row.get('witness',{}).get('step')=='primed' for row in rows):
    pid=int(re.findall(r'app\.clique\.astra: (\d+)',log.read_text())[-1]); listing=subprocess.check_output(['xcrun','simctl','spawn',u,'launchctl','list'],env=env,text=True)
    assert any(line.startswith(str(pid)+'\t') and 'UIKitApplication:app.clique.astra[' in line for line in listing.splitlines())
    os.kill(pid,signal.SIGKILL);killed=True
    (r/'evidence/control-death-prime-injection.json').write_text(json.dumps({'pid':pid,'signal':'SIGKILL','at':int(time.time()*1000),'priorReceiptSha256':hashlib.sha256(receipt.read_bytes()).hexdigest(),'priorPrimePass':any(row.get('smoke',{}).get('pass') is True for row in rows)},indent=2))
 time.sleep(.005)
print({'exitStatus':p.returncode,'killed':killed})

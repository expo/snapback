from pathlib import Path
import subprocess, os, fcntl, socket, json, time
r=Path('/Users/ccheever/sb4-np'); e=r/'evidence/round3'; u=(e/'owned.udid').read_text().strip()
env=dict(os.environ, DEVELOPER_DIR='/Applications/Xcode.app/Contents/Developer')
home=Path(subprocess.check_output(['xcrun','simctl','getenv',u,'HOME'],env=env,text=True).strip())
def run(name):
 return subprocess.run(['python3',str(r/'run-witness-r3.py'),name,'--repack',str(e/'sealed-a-ownbuild-1/build.json'),'--app-project',str(r/'subject'),'--smoke','--udid',u,'--port','49371'],stdout=subprocess.DEVNULL).returncode
result={}
with (home/'.snapback4-witness-owner.lock').open('a+') as lock:
 fcntl.flock(lock,fcntl.LOCK_EX|fcntl.LOCK_NB)
 status=run('control-concurrent-owner-2')
 result['owner']={'pid':os.getpid(),'status':status,'heldLock':str(lock.name),'aliveAfterRefusal':True,'at':int(time.time()*1000)}
 assert status==1
with socket.socket() as listener:
 listener.setsockopt(socket.SOL_SOCKET,socket.SO_REUSEADDR,1)
 listener.bind(('127.0.0.1',49371));listener.listen()
 status=run('control-busy-port')
 with socket.create_connection(('127.0.0.1',49371),timeout=2): accepted,peer=listener.accept();accepted.close()
 result['busyPort']={'pid':os.getpid(),'status':status,'listenerAcceptedAfterRefusal':True,'at':int(time.time()*1000)}
 assert status==1
(e/'ownership-controls.json').write_text(json.dumps(result,indent=2))
print(result)

"""Start only owned servers against the already PRIVATE SQ copies."""
import os,pathlib,subprocess,socket,time,sys,signal
root=pathlib.Path.cwd();base=(root/os.environ.get('SQ_ROOT','target/sq')).resolve()
tag,binary=sys.argv[1:3];binary=str(pathlib.Path(binary).resolve())
stages=__import__('json').loads(os.environ.get('SQ_STAGES','[["10pct",49562],["50pct",49563],["full",49560]]'))
children=[]
try:
 for stage,port in stages:
  command=[binary,'dev','--port',str(port),'--replay','--no-watch']
  if os.environ.get('SQ_STRACE')=='1':command=['strace','-s','0','-f','-C','-ttt','-T','-yy','-e','trace=pread64,read,fcntl,fsync,fdatasync,clock_nanosleep,futex','-o',str(base/f'{tag}-{stage}.strace')]+command
  with (base/f'{tag}-{stage}.log').open('wb') as f:p=subprocess.Popen(command,cwd=base/stage,stdout=f,stderr=f,start_new_session=True)
  children.append(p)
  for _ in range(300):
   if p.poll() is not None:raise RuntimeError(f'{stage} exited {p.returncode}')
   try:
    with socket.create_connection(('127.0.0.1',port),.1):break
   except OSError:time.sleep(.1)
  else:raise RuntimeError(f'{stage} startup timed out')
 subprocess.run(['node',str(pathlib.Path(__file__).with_name('curve.mjs')),tag],env=dict(os.environ,SQ_ROOT=str(base)),check=True)
finally:
 for p in children:
  if p.poll() is None:os.killpg(p.pid,signal.SIGTERM)
 for p in children:p.wait(timeout=30)

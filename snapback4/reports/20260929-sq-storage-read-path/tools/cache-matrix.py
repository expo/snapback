import os,subprocess,pathlib
base=pathlib.Path('target/sq').resolve();tool=pathlib.Path(__file__).with_name('run-curves.py')
for name,kib,mmap in [('small',64,0),('default',2000,0),('16m',16384,0),('256m',262144,0),('mmap',2000,8589934592),('both',262144,8589934592)]:
 env=dict(os.environ,SQ_CACHE_KIB=str(kib),SQ_MMAP_BYTES=str(mmap),SQ_DIAGNOSTIC='1',SQ_SKIP_DEEP='1')
 subprocess.run(['python3',str(tool),'cache-'+name,str(base/'snapback4-diagnostic')],env=env,check=True)
 # Separate syscall runs: tracing changes wall time and cannot qualify latency.
 env.update(SQ_STRACE='1',SQ_ROUNDS='1')
 subprocess.run(['python3',str(tool),'trace-'+name,str(base/'snapback4-diagnostic')],env=env,check=True)

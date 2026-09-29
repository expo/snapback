"""Controlled syscall comparison while the SAME retained delivery backlog drains."""
import pathlib,shutil,os,subprocess
base=pathlib.Path('target/sq').resolve();tool=pathlib.Path(__file__).with_name('run-curves.py')
for name,kib,mmap in [('default',2000,0),('16m',16384,0),('mmap',2000,8589934592)]:
 stage='queued-'+name;src=base/'replayed-50pct';dst=base/stage
 if dst.exists():raise RuntimeError('preserve prior evidence; use a fresh destination')
 (dst/'.snapback4').mkdir(parents=True)
 shutil.copytree(src/'snapback',dst/'snapback')
 shutil.copyfile(src/'state.private.json',dst/'state.private.json')
 shutil.copyfile(src/'.snapback4/store.sqlite',dst/'.snapback4/store.sqlite')
 env=dict(os.environ,SQ_CACHE_KIB=str(kib),SQ_MMAP_BYTES=str(mmap),SQ_DIAGNOSTIC='1',SQ_SKIP_DEEP='1',SQ_ROUNDS='1',SQ_STRACE='1',SQ_STAGES=__import__('json').dumps([[stage,49564]]))
 subprocess.run(['python3',str(tool),'trace-'+stage,str(base/'snapback4-diagnostic')],env=env,check=True)

"""Assemble the one-file, build-free supervisor harness from the same protocol."""
import pathlib
p=pathlib.Path(__file__).resolve().parent
runner=(p/'run-curves.py').read_text()
curve=(p/'curve.mjs').read_text()
summary=(p/'summarize.py').read_text()
header='''#!/usr/bin/env bash
# Run from the repository root with Node 24, Python 3 and the built local SDK.
# Usage: macos-curve.sh BEFORE_BINARY AFTER_BINARY PRIVATE_STORE_ROOT [OUTPUT_DIR]
# STORE_ROOT: PF layout (10pct, 50pct, full, replay/scripts, original-state.private.json).
# Input stores must be quiescent; they are copied and never opened for writing.
# Builds nothing. Reports every frozen read rule; write ratios require replay receipts.
set -euo pipefail
if [ "$#" -lt 3 ] || [ "$#" -gt 4 ]; then echo "usage: $0 BEFORE AFTER STORE_ROOT [OUTPUT_DIR]" >&2; exit 2; fi
python3 - "$@" <<'SQ_PY'
'''
body='''import pathlib,sys,tempfile,shutil,os,subprocess,json,hashlib,socket
root=pathlib.Path.cwd()
before,after,source=map(lambda x:pathlib.Path(x).resolve(),sys.argv[1:4])
if not (root/'snapback4/packages/snapback4/dist/node-fetch.js').exists():raise SystemExit('Run from the repo root with its SDK already built; this script builds nothing.')
out=pathlib.Path(sys.argv[4]).resolve() if len(sys.argv)>4 else pathlib.Path(tempfile.mkdtemp(prefix='sq-macos-'))
if len(sys.argv)>4:out.mkdir(mode=0o700,parents=True,exist_ok=False)
os.chmod(out,0o700)
for n,b in [('before',before),('after',after)]:
 if not b.is_file():raise SystemExit(f'missing {n} binary: {b}')
(out/'binaries.json').write_text(json.dumps({n:{'path':str(b),'sha256':hashlib.sha256(b.read_bytes()).hexdigest()} for n,b in [('before',before),('after',after)]},indent=2))
(out/'curve.mjs').write_text(CURVE)
(out/'run-curves.py').write_text(RUNNER)
(out/'summarize.py').write_text(SUMMARY)
for name,binary in [('before',before),('after',after)]:
 base=out/name;base.mkdir(mode=0o700)
 for stage in ['10pct','50pct','full']:
  (base/stage).mkdir()
  shutil.copytree(source/stage/'snapback',base/stage/'snapback')
  shutil.copytree(source/stage/'.snapback4',base/stage/'.snapback4')
  if stage!='full':shutil.copyfile(source/stage/'state.private.json',base/stage/'state.private.json')
 shutil.copyfile(source/'original-state.private.json',base/'original-state.private.json')
 (base/'replay/scripts').mkdir(parents=True)
 shutil.copyfile(source/'replay/scripts/api-client.mjs',base/'replay/scripts/api-client.mjs')
 shutil.copytree(source/'replay/snapback',base/'replay/snapback')
 (base/'replay/node_modules').mkdir()
 (base/'replay/node_modules/snapback4').symlink_to(root/'snapback4/packages/snapback4',target_is_directory=True)
 env={k:v for k,v in os.environ.items() if not k.startswith('SQ_')}
 env['SQ_ROOT']=str(base)
 sockets=[];stages=[]
 for stage in ['10pct','50pct','full']:
  listener=socket.socket();listener.bind(('127.0.0.1',0));sockets.append(listener)
  stages.append([stage,listener.getsockname()[1]])
 for listener in sockets:listener.close()
 env['SQ_STAGES']=json.dumps(stages)
 subprocess.run([sys.executable,str(out/'run-curves.py'),name,str(binary)],cwd=root,env=env,check=True)
 shutil.copyfile(base/(name+'-curve.json'),out/(name+'-curve.json'))
subprocess.run([sys.executable,str(out/'summarize.py'),str(out)],check=True)
print('All batches and rule margins:',out)
'''
(p/'macos-curve.sh').write_text(header + "CURVE = r'''\n" + curve + "\n'''\nRUNNER = r'''\n" + runner + "\n'''\nSUMMARY = r'''\n" + summary + "\n'''\n" + body + "\nSQ_PY\n")
(p/'macos-curve.sh').chmod(0o755)

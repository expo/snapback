from pathlib import Path
import subprocess,json
r=Path('/Users/ccheever/sb4-np');e=r/'evidence/round5';tools=r/'lane/snapback4/reports/20260929-np-macos-slice/round5/tools'
assert len(json.loads((e/'timings.json').read_text())['runs'])==6
for name in ['rn-skip-control','output-controls','tamper-control','cold-error-control','death-control','owner-controls','interruption-control']:
 with (e/(name+'-coordinator.log')).open('x') as log:
  code=subprocess.run(['python3',str(tools/(name+'-r5.py'))],stdout=log,stderr=subprocess.STDOUT).returncode
 print(name,code,flush=True)
 assert code==0,name

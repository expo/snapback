import pathlib,subprocess
r=pathlib.Path('/Users/ccheever/sb4-np'); p=r/'subject/src/NPProbe.tsx'; original=p.read_bytes()
try:
 assert b"export const marker = 'NP B';" in original
 p.write_bytes(original.replace(b"export const marker = 'NP B';", b"export const marker = 'NP B';\nif (launch?.segment === 'offline') setTimeout(() => { throw Error('NP intentional cold offline startup error'); }, 50);"))
 result=subprocess.run(['python3',str(r/'lane/snapback4/reports/20260929-np-macos-slice/round4/tools/run-witness-r4.py'),'control-cold-error','--build',str(r/'subject'),'--smoke','--udid',(r/'evidence/round4/owned.udid').read_text().strip(),'--port','49371'],stdout=subprocess.DEVNULL)
 assert result.returncode == 1
finally:p.write_bytes(original)

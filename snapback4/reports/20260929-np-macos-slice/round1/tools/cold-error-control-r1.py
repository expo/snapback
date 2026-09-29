import pathlib,subprocess
r=pathlib.Path('/Users/ccheever/sb4-np'); p=r/'subject/src/NPProbe.tsx'; original=p.read_bytes()
try:
 assert b"export const marker = 'NP B';" in original
 p.write_bytes(original.replace(b"export const marker = 'NP B';", b"export const marker = 'NP B';\nif (launch?.segment === 'offline') setTimeout(() => { throw Error('NP intentional cold offline startup error'); }, 50);"))
 subprocess.run(['python3',str(r/'run-witness-r1.py'),'control-cold-error','--repack',str(r/'evidence/round1/a-ownbuild-1/build.json'),'--app-project',str(r/'subject'),'--smoke','--udid',(r/'evidence/round1/owned.udid').read_text().strip(),'--port','49371'],stdout=subprocess.DEVNULL)
finally:p.write_bytes(original)

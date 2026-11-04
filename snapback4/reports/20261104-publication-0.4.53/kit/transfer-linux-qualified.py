from pathlib import Path
from datetime import datetime, timezone
import hashlib
import json
import os
import subprocess

kit = Path.home() / 'sb4-pub-0453'
root = Path.home() / 'sb4-pub-0453-wt/snapback4'
source = '9da2c76fdf32b20f985c85fe6d33b507c09edd25'
host = 'ccheever@100.65.137.99'
remote_root = '/home/ccheever/sb4-intent/0453'
names = ['receipt.json', 'snapback4-linux-x64-0.4.53.tgz']
stage = kit / 'linux-handoff-attempt2'
assert not stage.exists(), 'preserve previous transfer evidence'
assert (kit / 'audit-mac-pre-dry-after-linux-recovery.exit').read_text().strip() == '0'
remote_check = r'''
from pathlib import Path
import hashlib,json
b=Path.home()/'sb4-intent/0453';q=b/'linux-qualification-0.4.53'
for n in ['run-2.exit','linux-2.exit']:
 assert (b/'records'/n).read_text().strip()=='0',n
r=json.loads((q/'receipt.json').read_text())
assert r['source']=='9da2c76fdf32b20f985c85fe6d33b507c09edd25'
assert (b/'record-snapshot/qualification/receipt.json').read_bytes()==(q/'receipt.json').read_bytes()
files=[]
for n in ['receipt.json','snapback4-linux-x64-0.4.53.tgz']:
 p=q/n;files.append({'name':n,'bytes':p.stat().st_size,'sha256':hashlib.sha256(p.read_bytes()).hexdigest()})
print(json.dumps({'source':r['source'],'files':files}))
'''
result = subprocess.run(['ssh', '-o', 'BatchMode=yes', '-o', 'ConnectTimeout=15', host, 'python3 -'], input=remote_check, text=True, capture_output=True, check=True)
manifest = json.loads(result.stdout)
assert [row['name'] for row in manifest['files']] == names
stage.mkdir()
for row in manifest['files']:
    target = stage / row['name']
    subprocess.run(['scp', '-q', f"{host}:{remote_root}/linux-qualification-0.4.53/{row['name']}", str(target)], check=True)
    assert target.stat().st_size == row['bytes']
    assert hashlib.sha256(target.read_bytes()).hexdigest() == row['sha256']
node_check = r'''
import {join} from 'node:path';
import {loadPrepared} from './scripts/prepare-client.mjs';
import {json,platforms,run,validateLinux} from './scripts/publication-artifacts.mjs';
const [directory,expected] = process.argv.slice(2);
const source = run('git',['rev-parse','HEAD']).trim();
if(source!==expected || run('git',['status','--porcelain']).trim()) throw new Error('frozen source changed or tree dirty');
const prepared = loadPrepared('target/publication/client-0.4.53','0.4.53',platforms);
if(prepared.source!==source) throw new Error('prepared source differs');
validateLinux(json(join(directory,'receipt.json')),join(directory,'snapback4-linux-x64-0.4.53.tgz'),{...prepared.client,expoIntegrity:prepared.expo.integrity},source);
console.log('LINUX TRANSFER VALIDATED: exact frozen source, client/Expo/platform integrity, complete official qualification');
'''
with (kit / 'linux-transfer-validation.log').open('x') as log:
    subprocess.run([str(Path.home()/'.volta/tools/image/node/24.18.0/bin/node'), '--input-type=module', '-', str(stage), source], input=node_check, text=True, cwd=root, stdout=log, stderr=subprocess.STDOUT, check=True)
incoming = root / 'target/incoming/linux-0.4.53'
incoming.mkdir(parents=True, exist_ok=True)
assert all(not (incoming / name).exists() for name in names), 'preserve prior handoff'
# The receipt appears last, after both complete files have passed validation.
os.replace(stage / names[1], incoming / names[1])
os.replace(stage / names[0], incoming / names[0])
manifest.update(at=datetime.now(timezone.utc).isoformat(), incoming=str(incoming), validated=True)
with (kit / 'linux-transfer-verified.json').open('x') as output:
    json.dump(manifest, output, indent=2)
    output.write('\n')
print('LINUX HANDOFF READY: validated complete files exposed atomically; original remote artifacts unchanged')

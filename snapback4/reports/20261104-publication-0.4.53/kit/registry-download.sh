#!/bin/bash
# Fresh registry tarballs for the required post-publication foreground smoke.
set -eu
S=${1:?staged directory}; D=${2:?new registry directory}; R=${3:?records directory}
test ! -e "$D"
mkdir -p "$D"
export NPM_CONFIG_CACHE="$D/npm-cache" npm_config_cache="$D/npm-cache"
npm pack snapback4@0.4.53 snapback4-darwin-arm64@0.4.53 snapback4-linux-x64@0.4.53 snapback4-expo@0.4.53 --prefer-online --ignore-scripts --json --pack-destination "$D" > "$R/registry-smoke-pack.json" 2> "$R/registry-smoke-pack.log"
python3 - "$S" "$D" "$R" <<'PY'
import pathlib,json,hashlib,sys,datetime
s,d,r=map(pathlib.Path,sys.argv[1:])
rows=json.loads((r/'registry-smoke-pack.json').read_text())
names={'snapback4','snapback4-darwin-arm64','snapback4-linux-x64','snapback4-expo'}
assert len(rows)==4 and {q['name'] for q in rows}==names
result={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'status':'passed','artifacts':[]}
for q in rows:
 assert q['version']=='0.4.53'
 filename=q['filename'];assert pathlib.Path(filename).name==filename
 digest=lambda p:hashlib.sha256(p.read_bytes()).hexdigest()
 h=digest(d/filename);assert h==digest(s/filename),f'registry bytes differ: {filename}'
 result['artifacts'].append({'name':q['name'],'filename':filename,'sha256':h})
(r/'registry-smoke-byte-validation.json').write_text(json.dumps(result,indent=2)+'\n')
(r/'registry-smoke.sha256').write_text(''.join(f"{q['sha256']}  {q['filename']}\n" for q in sorted(result['artifacts'],key=lambda q:q['filename'])))
print('REGISTRY DOWNLOAD PASS: all4 exact qualified/staged SHA256')
PY

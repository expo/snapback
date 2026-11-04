#!/usr/bin/env python3
"""PUB053: fresh registry metadata/pack, SHA256/SRI and local staged byte checks."""
import base64, datetime, hashlib, json, os, pathlib, socket, subprocess, sys

expected_path, out_path, host = sys.argv[1:]
expected = json.loads(pathlib.Path(expected_path).read_text())
out = pathlib.Path(out_path)
out.mkdir(parents=True, exist_ok=False)
env = dict(os.environ, NPM_CONFIG_CACHE=str(out/'npm-cache'), npm_config_cache=str(out/'npm-cache'))
result = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
          'host': socket.gethostname(), 'source': expected['source'], 'artifacts': []}
for a in expected['artifacts']:
    name = a['name']
    def npm(*args):
        command = ['npm', *args]
        p = subprocess.run(command, env=env, capture_output=True, text=True)
        (out/(name+'-'+args[0]+'.stderr')).write_text(p.stderr)
        p.check_returncode()
        return json.loads(p.stdout)
    meta = npm('view', name, 'version', 'dist-tags', '--prefer-online', '--json')
    (out/(name+'-view.json')).write_text(json.dumps(meta, indent=2)+'\n')
    assert meta['version'] == '0.4.53' and meta['dist-tags']['latest'] == '0.4.53', meta
    packed = npm('pack', name+'@0.4.53', '--prefer-online', '--ignore-scripts', '--json', '--pack-destination', str(out))
    (out/(name+'-pack.json')).write_text(json.dumps(packed, indent=2)+'\n')
    assert len(packed) == 1
    p = packed[0]
    assert p['name'] == name and p['version'] == '0.4.53' and p['filename'] == a['filename']
    data = (out/p['filename']).read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    sri = 'sha512-'+base64.b64encode(hashlib.sha512(data).digest()).decode()
    assert sha == a['sha256'] and sri == a['integrity'] and len(data) == a['bytes'], name
    local = a.get(host+'StagedPath')
    if local:
        assert data == pathlib.Path(local).read_bytes(), local
    result['artifacts'].append(dict(name=name, filename=p['filename'], version=meta['version'],
        latest=meta['dist-tags']['latest'], sha256=sha, bytes=len(data), integrity=sri,
        qualifiedSha256Matches=True, localStagedPath=local, localStagedBytesMatch=True if local else None))
    print(f"{name} view={meta['version']} latest={meta['dist-tags']['latest']} sha256={sha} EQUAL", flush=True)
result['status'] = 'passed'
(out/'registry-verified.json').write_text(json.dumps(result, indent=2)+'\n')
print('verify ok=1 (4/4 metadata, SHA256 and SRI; local staged bytes checked where present)')

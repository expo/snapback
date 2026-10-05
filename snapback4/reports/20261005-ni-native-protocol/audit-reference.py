#!/usr/bin/env python3
"""Read-only custody audit of the NI reference build on the dedicated mini."""
import hashlib
import json
from pathlib import Path
import plistlib
import subprocess

root = Path('/tmp/ni-native-20261005').resolve()
sha = lambda p: hashlib.sha256(p.read_bytes()).hexdigest()
pairs = [('reference/App.tsx', 'app/App.tsx'), ('reference/scene-plugin.cjs', 'app/scene-plugin.cjs')]
for prefix, target in [('helper', 'app/modules/clique-native-observer'), ('ui', 'app/ui')]:
    manifest = json.loads((root / 'instrument.manifest.json').read_text())
    for name in manifest['files']:
        if name.startswith(prefix + '/'):
            pairs.append((name, target + name[len(prefix):]))
copies = [{'source': a, 'buildInput': b, 'sourceSha256': sha(root / a),
           'buildInputSha256': sha(root / b), 'same': sha(root / a) == sha(root / b)} for a, b in pairs]
assert all(p['same'] for p in copies)
packages = {}
for name in ['expo', 'expo-sqlite', 'react', 'react-native', 'react-native-web', 'playwright']:
    package = root / 'app/node_modules' / name / 'package.json'
    packages[name] = {'version': json.loads(package.read_text())['version'], 'packageSha256': sha(package)}
device_id = '3D325BD4-FD16-4A94-AA74-9F5CF1F8E48B'
devices = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', 'available', '--json']))['devices']
device = [{'runtime': runtime, **d} for runtime, ds in devices.items() for d in ds if d['udid'] == device_id]
app = root / 'DerivedData/Build/Products/Release-iphonesimulator/NIReference.app'
info = plistlib.loads((app / 'Info.plist').read_bytes())
result = {'sourceCopies': copies, 'packages': packages, 'simulator': device,
          'xcode': subprocess.check_output(['xcodebuild', '-version'], text=True).strip(),
          'node': subprocess.check_output(['node', '--version'], text=True).strip(),
          'python': subprocess.check_output([str(root / 'venv/bin/python'), '--version'], text=True).strip(),
          'pythonPackages': subprocess.check_output([str(root / 'venv/bin/pip'), 'freeze'], text=True).splitlines(),
          'build': {'bundleId': info['CFBundleIdentifier'], 'nativeSha256': sha(app / info['CFBundleExecutable']),
                    'hermesSha256': sha(app / 'main.jsbundle'), 'infoPlistSha256': sha(app / 'Info.plist')},
          'copiedDependencyLockSha256': sha(root / 'app/node_modules/.package-lock.json'),
          'podfileLockSha256': sha(root / 'app/ios/Podfile.lock'),
          'identity': json.loads((root / 'identity.json').read_text())}
(root / 'source-audit.json').write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'sameSourceCopies': len(copies), 'build': result['build'], 'packages': packages}))

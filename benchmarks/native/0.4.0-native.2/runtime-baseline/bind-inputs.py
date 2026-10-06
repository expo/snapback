#!/usr/bin/env python3
"""Bind current disclosed sources to the exact durable app inputs before build."""
import argparse, hashlib, json
from pathlib import Path

def sha(path): return hashlib.sha256(Path(path).read_bytes()).hexdigest()

def files(root):
    return {str(path.relative_to(root)): sha(path) for path in sorted(root.rglob('*'))
            if path.is_file() and '__pycache__' not in path.parts and 'node_modules' not in path.parts}

parser = argparse.ArgumentParser()
parser.add_argument('--source', required=True, type=Path)
parser.add_argument('--app', required=True, type=Path)
parser.add_argument('--out', required=True, type=Path)
args = parser.parse_args()
source = args.source.resolve(); app = args.app.resolve()
copies = {
    'runtime-baseline/App.tsx': 'App.tsx',
    'runtime-baseline/scene-plugin.cjs': 'scene-plugin.cjs',
    'runtime-baseline/simulator.entitlements': 'simulator.entitlements',
}
source_files = {name: sha(source / name) for name in [
    *copies,
    'runtime-baseline/prepare.sh',
    'runtime-baseline/configure-signing.rb',
]}
for root in [source / 'helper', source / 'ui']:
    for name, digest in files(root).items(): source_files[str(root.relative_to(source) / name)] = digest
for source_name, app_name in copies.items():
    if sha(source / source_name) != sha(app / app_name): raise RuntimeError('runtime-copy-drift:' + source_name)
for part, destination in [('helper', app / 'modules/clique-native-observer'), ('ui', app / 'ui')]:
    expected = files(source / part); actual = files(destination)
    if expected != actual: raise RuntimeError('runtime-copy-drift:' + part)
app_names = ['App.tsx', 'scene-plugin.cjs', 'simulator.entitlements', 'package.json', 'app.json', 'index.js',
             'ios/RuntimeBaseline.xcodeproj/project.pbxproj', 'ios/RuntimeBaseline/RuntimeBaseline.entitlements',
             'ios/Podfile', 'ios/Podfile.lock']
app_files = {name: sha(app / name) for name in app_names}
lines = ''.join(f'{digest}  {name}\n' for name, digest in sorted(source_files.items()))
result = {'schemaVersion': 'clique-native-runtime-inputs.v1', 'sourceFiles': source_files,
          'sourceInventorySha256': hashlib.sha256(lines.encode()).hexdigest(), 'appFiles': app_files}
args.out.write_text(json.dumps(result, indent=2) + '\n')
print(json.dumps({'sourceInventorySha256': result['sourceInventorySha256'], 'files': len(source_files)}))

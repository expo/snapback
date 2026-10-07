#!/usr/bin/env python3
"""Read-only machine/package evidence; no model or build invocation."""
import sys
from common import *

host_check()
def output(argv):
    p = subprocess.run(argv, capture_output=True, text=True, timeout=90)
    return {'argv': argv, 'exitCode': p.returncode, 'stdout': p.stdout.strip(), 'stderr': p.stderr.strip()}

tools = {name: output(cmd) for name, cmd in {
 'macOS': ['sw_vers'], 'hardware': ['sysctl', '-n', 'hw.model'],
 'xcode': ['xcodebuild', '-version'], 'sdks': ['xcodebuild', '-showsdks'],
 'swift': ['xcrun', 'swift', '--version'], 'clang': ['xcrun', 'clang', '--version'],
 'node': ['node', '--version'], 'nodePath': ['node', '-p', 'process.execPath'],
 'npm': ['npm', '--version'], 'python': [sys.executable, '--version'],
 'ruby': ['ruby', '--version'], 'cocoapods': ['pod', '--version'],
 'codex': [str(Path.home() / '.volta/bin/codex'), '--version'],
 'git': ['git', '--version'],
 'pythonDependencies': [str(ROOT / 'runtime/venv/bin/python'), '-m', 'pip', 'freeze'],
 'nodeDependencies': ['npm', '--prefix', str(ROOT / 'runtime/node'), 'ls', '--json'],
}.items()}
devices = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', 'available', '--json']))['devices']
selected = [{'runtime': r, **d} for r, ds in devices.items() for d in ds if d['udid'] == UDID]
if len(selected) != 1: raise RuntimeError('dedicated-simulator-unavailable')
packages = {}
for name, version in [('snapback4', '0.4.13'), ('snapback4-expo', '0.4.13'), ('snapback4-darwin-arm64', '0.4.13'),
                      ('convex', '1.45.0'), ('expo', '57.0.22'), ('react-native', '0.86.3'),
                      ('expo-secure-store', '57.0.4'), ('playwright', '1.62.1'), ('ws', '8.18.3')]:
    p = output(['npm', 'view', name + '@' + version, 'version', 'dist.integrity', 'dist.tarball', '--json'])
    if p['exitCode']: raise RuntimeError('package-pin-unavailable:' + name)
    packages[name] = json.loads(p['stdout'])
put(ROOT / 'metadata/toolchain.json', {'at': time.time(), 'host': socket.gethostname(),
                                    'developerDir': os.environ.get('DEVELOPER_DIR'), 'tools': tools, 'simulator': selected[0]})
put(ROOT / 'metadata/packages.json', packages)
print('recorded toolchain and exact public package metadata')

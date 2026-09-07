#!/usr/bin/env python3
"""Prepared 0.0.17 dependency-only derivative of verify-registry-expo-04.py.

No execution is authorized by this file. Missing bindings/Root approval refuse
before consumer creation or any subprocess. See prompt.md and workload.json.
"""
from pathlib import Path, PurePosixPath
import base64
import hashlib
import json
import os
import signal
import stat
import subprocess
import sys
import tarfile
import time

ROOT = Path(__file__).resolve().parent
SOURCE = 'a606383b6e5ad7cf79555bbc4b810d6cf6ea0e92'
VERSION = '0.0.17'
PACKAGES = ('snapback2-darwin-arm64', 'snapback2')
PLATFORMS = {'snapback2-darwin-arm64', 'snapback2-linux-x64'}
PRIVATE = Path('/Users/ccheever/clique-improvement/revisions/cli-016-release-qualification/tools/node-24.18.0')
NODE = str(PRIVATE / 'bin/node')
NPM = str(PRIVATE / 'lib/node_modules/npm/bin/npm-cli.js')
FLAGS = ['--no-audit', '--no-fund', '--fetch-retries=0', '--fetch-timeout=15000']
INSTALL = [NODE, NPM, 'install', *FLAGS, '--save-exact', 'snapback2@0.0.17', 'react@19.1.1']
CI = [NODE, NPM, 'ci', *FLAGS]
METADATA_KEYS = ('name', 'version', 'exports', 'dependencies', 'optionalDependencies',
                 'peerDependencies', 'peerDependenciesMeta', 'bin', 'os', 'cpu')


def require(ok, message):
    if not ok:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def digest(path):
    return sha(Path(path).read_bytes())


def write_json(path, value):
    with Path(path).open('x') as out:
        out.write(json.dumps(value, indent=2, sort_keys=True) + '\n')


def bound_file(record):
    require(isinstance(record, dict) and record.get('path') and record.get('sha256'),
            'UNBOUND file input')
    path = Path(record['path'])
    require(path.is_absolute() and path.is_file() and not path.is_symlink(), str(path))
    require(digest(path) == record['sha256'], 'input hash mismatch: ' + str(path))
    return path


def entry(path, root):
    s = path.lstat()
    value = {'path': str(path.relative_to(root)), 'mode': stat.S_IMODE(s.st_mode)}
    if stat.S_ISLNK(s.st_mode):
        value.update(kind='symlink', target=os.readlink(path))
    elif stat.S_ISDIR(s.st_mode):
        value.update(kind='directory')
    else:
        require(stat.S_ISREG(s.st_mode), 'unsupported file kind: ' + str(path))
        value.update(kind='file', bytes=s.st_size, sha256=digest(path))
    return value


def tree(root):
    return [entry(p, root) for p in sorted(root.rglob('*'))]


def identity(pid):
    return subprocess.run(['/bin/ps', '-p', str(pid), '-o', 'pid=,lstart=,comm='],
                          capture_output=True, text=True, timeout=2, check=False).stdout.strip()


def kill_owned_group(record):
    current = identity(record['pid'])
    require(current and current == record['processIdentity'], 'process identity unavailable/changed')
    require(os.getpgid(record['pid']) == record['pid'], 'process group changed')
    os.killpg(record['pid'], signal.SIGKILL)


def preflight():
    # Root approval binds the complete prepared input set AND the future binding file.
    require((ROOT / 'bindings.json').is_file() and (ROOT / 'root-approval.json').is_file(),
            'UNBOUND: future artifact/tool bindings and Root approval are required')
    b = json.loads((ROOT / 'bindings.json').read_text())
    a = json.loads((ROOT / 'root-approval.json').read_text())
    require(b.get('ready') is True and a.get('approved') is True, 'UNBOUND or not Root approved')
    require(a.get('reviewedQualificationAndExactPublicPair') is True and
            a.get('reviewedActualVersionReceipt') is True, 'Root evidence review remains unbound')
    require(b['source'] == a['source'] == SOURCE and b['version'] == VERSION, 'source/version')
    require(a['bindingsSha256'] == digest(ROOT / 'bindings.json'), 'approval binding changed')
    require(a['preparationManifestSha256'] == digest(ROOT / 'preparation-manifest.json'), 'packet changed')
    manifest = json.loads((ROOT / 'preparation-manifest.json').read_text())
    for item in manifest['files']:
        require(digest(ROOT / item['path']) == item['sha256'], 'prepared input changed: ' + item['path'])
    w = json.loads((ROOT / 'workload.json').read_text())
    require(w['installArgv'] == INSTALL and w['ciArgv'] == CI, 'npm argv changed')
    require(w['childSeconds'] == 30 and w['outerSeconds'] == 90, 'bounds changed')
    require(sys.platform == 'darwin' and os.uname().machine == 'arm64', 'Office Darwin arm64 required')
    python = bound_file(b['pythonExecutable'])
    require(Path(sys.executable).resolve() == python.resolve(), 'Python executable identity')
    require(b['qualifiedAndPublicPairMatched'] is True, 'qualification/public pair not accepted')
    evidence = {key: str(bound_file(b[key])) for key in
                ('qualificationReceipt', 'publicPairReceipt', 'sourceReceipt')}
    source = json.loads(bound_file(b['sourceShimManifest']).read_text())
    require(source['name'] == 'snapback2' and source['version'] == VERSION, 'source shim identity')

    tools = b['privateTools']
    require(tools['root'] == str(PRIVATE) and tools['copiedAndVerified'] is True, 'UNBOUND private tools')
    require(tools['actualVersions'] == {'node': '24.18.0', 'npm': '11.16.0'}, 'actual versions unbound')
    # Actual version interpretation belongs to Root's bound staging receipt; no version launch here.
    bound_file(tools['actualVersionReceipt'])
    donor = json.loads((ROOT / 'tool-donor-manifest.json').read_text())
    donor_root = Path(donor['root'])
    require(PRIVATE.resolve() == PRIVATE and donor_root.resolve() != PRIVATE, 'private tool root')
    require(stat.S_IMODE(PRIVATE.stat().st_mode) == donor['rootMode'], 'private root mode')
    require(tree(PRIVATE) == donor['entries'], 'private distribution bytes/modes/targets/file set')
    require(tree(donor_root) == donor['entries'], 'donor changed since preparation')
    for relative in ['.', *[x['path'] for x in donor['entries']]]:
        left, right = (PRIVATE / relative).lstat(), (donor_root / relative).lstat()
        require((left.st_dev, left.st_ino) != (right.st_dev, right.st_ino), 'shared tool inode: ' + relative)
    evidence['toolCustody'] = {'donorManifestSha256': digest(ROOT / 'tool-donor-manifest.json'),
                              'privateCompleteTreeEqual': True, 'independentInodes': True,
                              'node': {'path': NODE, 'sha256': digest(NODE)},
                              'npmCli': {'path': NPM, 'sha256': digest(NPM)},
                              'distributionLeaves': len(donor['entries'])}

    require(set(b['artifacts']) == set(PACKAGES), 'exact Darwin/shim artifact pair required')
    packed, packed_modes = {}, {}
    for name in PACKAGES:
        record = b['artifacts'][name]
        path = bound_file(record)
        data = path.read_bytes()
        require(len(data) == record['bytes'] and record['integrity'] ==
                'sha512-' + base64.b64encode(hashlib.sha512(data).digest()).decode(), 'artifact SRI/bytes')
        packed[name], packed_modes[name] = {}, {}
        with tarfile.open(path) as tar:
            for member in tar:
                if member.isdir():
                    continue
                require(member.isfile(), 'unexpected non-regular package member: ' + member.name)
                relative = member.name.removeprefix('package/')
                require(member.name.startswith('package/') and not relative.startswith('/') and
                        '..' not in PurePosixPath(relative).parts and relative not in packed[name],
                        'invalid/duplicate packed path')
                packed[name][relative] = tar.extractfile(member).read()
                packed_modes[name][relative] = member.mode
        meta = json.loads(packed[name]['package.json'])
        require(meta['name'] == name and meta['version'] == VERSION, 'packed identity')
    shim = json.loads(packed['snapback2']['package.json'])
    for key in ('exports', 'dependencies', 'peerDependencies', 'peerDependenciesMeta'):
        require((key in shim, shim.get(key)) == (key in source, source.get(key)), 'source metadata: ' + key)
    expected_optional = {k: v for k, v in source.get('optionalDependencies', {}).items() if k not in PLATFORMS}
    expected_optional['snapback2-darwin-arm64'] = VERSION
    require(shim.get('optionalDependencies') == expected_optional, 'selected/preserved optional metadata')
    platform = json.loads(packed['snapback2-darwin-arm64']['package.json'])
    require(platform['os'] == ['darwin'] and platform['cpu'] == ['arm64'], 'platform os/cpu')
    require(set(b['executableInputs']) == {'snapback2', 'snapback2-media'}, 'UNBOUND executable inputs')
    for name, record in b['executableInputs'].items():
        path = bound_file(record)
        relative = 'bin/' + name
        require(path.read_bytes() == packed['snapback2-darwin-arm64'][relative], 'qualified executable bytes')
        require(stat.S_IMODE(path.stat().st_mode) == record['mode'] and record['mode'] & 0o111,
                'qualified executable mode')
        require(packed_modes['snapback2-darwin-arm64'][relative] & 0o111, 'packed executable mode')
    return b, w, packed, packed_modes, evidence


def environment(w, state):
    return {k: v.replace('<PRIVATE_NPM11_STATE>', str(state)) for k, v in w['environment'].items()}


def execute(out, label, args, cwd, env, checks):
    start = time.monotonic()
    record = {'name': label, 'argv': args, 'cwd': str(cwd), 'timeoutSeconds': 30,
              'attempt': 1, 'startedEpoch': time.time(), 'automaticRetry': False}
    log = out / 'receipts' / (label + '.log')
    running = out / 'receipts' / (label + '.running.json')
    with log.open('xb') as stream:
        child = subprocess.Popen(args, cwd=cwd, env=env, stdout=stream,
                                 stderr=subprocess.STDOUT, start_new_session=True)
        record.update(pid=child.pid, processIdentity=identity(child.pid), processGroup=child.pid)
        write_json(running, record)
        try:
            code = child.wait(timeout=max(0, 30 - (time.monotonic() - start)))
        except subprocess.TimeoutExpired:
            # The semantic deadline already failed, regardless of a later actual exit.
            code = 124
            record['timedOut'] = True
            try:
                if child.poll() is None:
                    kill_owned_group(record)
            except Exception as exc:
                record['cleanupFailure'] = {'type': type(exc).__name__, 'message': str(exc)}
            try:
                # Observe only our Popen child; a refused identity is never signaled.
                child.wait(timeout=2)
            except subprocess.TimeoutExpired:
                record['cleanupUnknown'] = True
    record.update(exitCode=code, actualReturnCode=child.returncode,
                  elapsedSeconds=time.monotonic() - start, endedEpoch=time.time(), logSha256=digest(log))
    record['actualProcessWaitCompleted'] = child.returncode is not None
    record['logComplete'] = record['actualProcessWaitCompleted']
    write_json(out / 'receipts' / (label + '.json'), record)
    if record['actualProcessWaitCompleted']:
        running.unlink()
    checks.append(record)
    require(code == 0, label + ' failed; retain first failure and stop')


def installed(directory, b, packed):
    lock = json.loads((directory / 'package-lock.json').read_text())
    require(lock['packages']['']['dependencies'] == {'snapback2': VERSION, 'react': '19.1.1'}, 'root dependencies')
    result = {'packages': {}, 'lockSha256': digest(directory / 'package-lock.json')}
    for name in PACKAGES:
        locked = lock['packages']['node_modules/' + name]
        require(locked['version'] == VERSION and locked['integrity'] == b['artifacts'][name]['integrity'], 'locked identity/SRI')
        require(locked['resolved'].startswith('https://registry.npmjs.org/'), 'public registry resolved URL')
        root = directory / 'node_modules' / name
        files = {str(p.relative_to(root)): {'bytes': p.stat().st_size, 'sha256': digest(p),
                                          'mode': stat.S_IMODE(p.stat().st_mode)}
                 for p in sorted(root.rglob('*')) if p.is_file()}
        require(set(files) == set(packed[name]), 'installed regular-file set: ' + name)
        for relative, data in packed[name].items():
            require((root / relative).read_bytes() == data, 'installed packed bytes: ' + name + '/' + relative)
        if name == 'snapback2-darwin-arm64':
            require(all(files['bin/' + executable]['mode'] & 0o111 for executable in
                        ('snapback2', 'snapback2-media')), 'installed executable modes')
        meta = json.loads((root / 'package.json').read_text())
        require(meta['name'] == name and meta['version'] == VERSION, 'installed manifest identity')
        result['packages'][name] = {'manifest': {k: meta[k] for k in METADATA_KEYS if k in meta},
                                    'lockEntry': locked, 'files': files, 'regularFileCount': len(files)}
    react = json.loads((directory / 'node_modules/react/package.json').read_text())
    require(react['name'] == 'react' and react['version'] == '19.1.1', 'installed React pin')
    require(lock['packages']['node_modules/react']['version'] == '19.1.1', 'locked React pin')
    require('node_modules/snapback2-linux-x64' not in lock['packages'], 'unexpected Linux lock entry')
    result.update(react={'name': react['name'], 'version': react['version']},
                  totalRegularFileCount=sum(result['packages'][n]['regularFileCount'] for n in PACKAGES))
    return result


def main():
    require(sys.argv[1:] == ['--execute-root-approved'], 'explicit approved execution argument required')
    b, w, packed, modes, evidence = preflight()
    out = ROOT / 'execution'
    require((out / 'owner.json').is_file(), 'outer runner must create exclusive owned output')
    report = {'source': SOURCE, 'version': VERSION, 'ok': False, 'startedEpoch': time.time(),
              'scope': 'default public dependency install and exact-lock fresh ci only',
              'checks': [], 'artifacts': b['artifacts'], 'boundEvidence': evidence,
              'actualVersionsFromRootBoundReceipt': b['privateTools'], 'prior015RegularFileCount': 156}
    producer, consumer = out / 'producer', out / 'consumer'
    try:
        write_json(out / 'packed-files.json', {name: {p: {'bytes': len(data), 'sha256': sha(data), 'mode': modes[name][p]}
                   for p, data in packed[name].items()} for name in PACKAGES})
        producer.mkdir()
        write_json(producer / 'package.json', {'name': 'snapback2-0-0-17-default-install-witness', 'private': True, 'type': 'module'})
        env = environment(w, out / 'npm-state')
        execute(out, 'default-install', INSTALL, producer, env, report['checks'])
        first = installed(producer, b, packed)
        write_json(out / 'producer-installed-files.json', first)
        originals = {name: (producer / name).read_bytes() for name in ('package.json', 'package-lock.json')}
        write_json(out / 'generated-input-custody.json', {name: {'bytes': len(data), 'sha256': sha(data)}
                                                       for name, data in originals.items()})
        consumer.mkdir()
        for name, data in originals.items():
            with (consumer / name).open('xb') as stream:
                stream.write(data)
            require((consumer / name).read_bytes() == data, 'exact generated input copy')
        require(not (consumer / 'node_modules').exists(), 'fresh ci consumer occupied')
        execute(out, 'fresh-ci', CI, consumer, env, report['checks'])
        second = installed(consumer, b, packed)
        write_json(out / 'consumer-installed-files.json', second)
        require(first == second, 'producer/ci installed custody differs')
        for name, data in originals.items():
            require((producer / name).read_bytes() == data and (consumer / name).read_bytes() == data,
                    'generated package/lock changed')
        require(installed(producer, b, packed) == first, 'producer changed during ci')
        for record in b['artifacts'].values():
            bound_file(record)
        report.update(ok=True, exactPackageAndLockUnchanged=True, installedPairEqual=True,
                      totalRegularFileCount=first['totalRegularFileCount'], tarballsUnchanged=True)
    except BaseException as exc:
        report['failure'] = {'type': type(exc).__name__, 'message': str(exc)}
        raise
    finally:
        report['endedEpoch'] = time.time()
        write_json(out / 'report.json', report)
    print(json.dumps(report, sort_keys=True))


if __name__ == '__main__':
    main()

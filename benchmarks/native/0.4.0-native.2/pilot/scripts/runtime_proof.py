#!/usr/bin/env python3
"""Import and independently requalify the executed runtime baseline."""
import argparse, json, plistlib, shutil, struct, sys, uuid
from common import *

RUNTIME_NATIVE = NATIVE if (NATIVE / 'runtime-baseline/binding.py').is_file() else Path(__file__).resolve().parents[2]
sys.path.insert(0, str(RUNTIME_NATIVE / 'runtime-baseline'))
sys.path.insert(0, str(RUNTIME_NATIVE / 'driver'))
from binding import compiled_inputs, expected_proof_inputs, inventory_digest
from video import decoded_video

REQUIRED_CHECKS = {
    'first-os-launch', 'secure-store-reset-through-ui', 'secure-store-write-read',
    'first-process-terminated', 'secure-store-restored-after-relaunch',
    'helper-observed-both-processes', 'launch-through-restore-video-decodes',
    'terminal-process-absent',
}
REQUIRED_EVIDENCE = {
    'runtime-launch-through-restore.mp4', 'native-observations.jsonl',
    'signed-entitlements.plist', 'runtime-inputs.json', 'cleanup.json',
    'xctest.log', 'codesign.stdout', 'codesign.stderr',
    'secure-write-read.json', 'secure-restored.json', 'terminal-process-state.json',
    'runtime-flush-1-request.json', 'runtime-flush-1-ack.json',
    'runtime-flush-2-request.json', 'runtime-flush-2-ack.json',
    'built-app/Info.plist', 'built-app/RuntimeBaseline', 'built-app/main.jsbundle',
}

def tree_nodes(tree):
    yield tree
    for child in tree.get('children', []): yield from tree_nodes(child)

def exact_evidence(proof_root):
    result = {}
    for path in sorted(proof_root.rglob('*')):
        if path.is_symlink(): raise RuntimeError('runtime-proof-evidence-symlink:' + str(path))
        if path.is_file() and path.name != 'runtime-proof.json' and 'runtime.xcresult' not in path.parts:
            result[str(path.relative_to(proof_root))] = sha(path)
    return result

def macho_entitlements(binary):
    raw = binary.read_bytes()
    if len(raw) < 32 or struct.unpack_from('<I', raw)[0] != 0xfeedfacf:
        raise RuntimeError('runtime-proof-native-not-thin-mach-o')
    commands = struct.unpack_from('<I', raw, 16)[0]; cursor = 32
    for _ in range(commands):
        command, size = struct.unpack_from('<II', raw, cursor)
        if size < 8 or cursor + size > len(raw): raise RuntimeError('runtime-proof-mach-o-command')
        if command == 0x19:
            segment = raw[cursor + 8:cursor + 24].split(b'\0', 1)[0].decode()
            section = cursor + 72
            for _ in range(struct.unpack_from('<I', raw, cursor + 64)[0]):
                name = raw[section:section + 16].split(b'\0', 1)[0].decode()
                owner = raw[section + 16:section + 32].split(b'\0', 1)[0].decode()
                length = struct.unpack_from('<Q', raw, section + 40)[0]
                offset = struct.unpack_from('<I', raw, section + 48)[0]
                if segment == owner == '__TEXT' and name == '__entitlements':
                    value = raw[offset:offset + length].rstrip(b'\0')
                    start = value.find(b'<?xml'); end = value.find(b'</plist>', start)
                    if start < 0 or end < 0: raise RuntimeError('runtime-proof-entitlements-plist')
                    return plistlib.loads(value[start:end + len(b'</plist>')])
                section += 80
        cursor += size
    raise RuntimeError('runtime-proof-entitlements-section')

def validate_helper(path, proof):
    try: events = [json.loads(line) for line in path.read_text().splitlines()]
    except (UnicodeDecodeError, json.JSONDecodeError): raise RuntimeError('runtime-proof-helper-invalid') from None
    if len(events) < 2: raise RuntimeError('runtime-proof-helper-event-count')
    expected_build = {'bundleId': proof['bundleId'], 'nativeSha256': proof['nativeSha256'],
                      'hermesSha256': proof['hermesSha256']}
    rows = []
    for event in events:
        if set(event) != {'protocol', 'runId', 'processNonce', 'sequence', 'elapsedMs', 'kind', 'payload'}:
            raise RuntimeError('runtime-proof-helper-fields')
        try: nonce = str(uuid.UUID(event['processNonce']))
        except (KeyError, ValueError): raise RuntimeError('runtime-proof-helper-nonce') from None
        payload = event.get('payload')
        principal = payload.get('principal') if isinstance(payload, dict) else None
        shared_payload = {'origin': 'runtime-baseline://local', 'authenticationRestored': True,
                          'build': expected_build, 'development': False}
        if (event.get('protocol') != 'clique-native/1' or event.get('runId') != proof['runId'] or
            nonce != event['processNonce'] or
            not isinstance(event.get('elapsedMs'), (int, float)) or event['elapsedMs'] < 0 or
            event.get('kind') != 'ready' or not isinstance(payload, dict) or
            {key: payload.get(key) for key in shared_payload} != shared_payload or set(payload) != {*shared_payload, 'principal'}):
            raise RuntimeError('runtime-proof-helper-semantics')
        rows.append((nonce, event.get('sequence'), principal))
    if len(rows) == 2:
        first, second = rows
        valid_shape = (first[0] != second[0] and first[1:] == (1, proof['principal']) and
                       second[1:] == (1, proof['principal']))
        current_nonces = {first[0], second[0]}
    elif len(rows) == 3:
        stale, current, second = rows
        try:
            prior = stale[2][len('runtime.'):-len('@example.com')]
            canonical_prior = (stale[2] == 'runtime.' + str(uuid.UUID(prior)) + '@example.com')
        except (TypeError, ValueError): canonical_prior = False
        valid_shape = (canonical_prior and stale[2] != proof['principal'] and
            stale[0] == current[0] and current[0] != second[0] and
            stale[1] == 1 and current[1:] == (2, proof['principal']) and
            second[1:] == (1, proof['principal']))
        current_nonces = {current[0], second[0]}
    else:
        valid_shape = False; current_nonces = set()
    if (not valid_shape or len(current_nonces) != 2 or
        sorted(current_nonces) != sorted(proof.get('readyProcessNonces', []))):
        raise RuntimeError('runtime-proof-helper-processes')
    return [first[0],second[0]] if len(rows)==2 else [current[0],second[0]]

def validate_flushes(proof_root,proof,process_nonces):
    raw=(proof_root/'native-observations.jsonl').read_bytes();prior_count=prior_bytes=-1;challenges=[]
    for serial,process_nonce in enumerate(process_nonces,1):
        request=read(proof_root/f'runtime-flush-{serial}-request.json')
        ack=read(proof_root/f'runtime-flush-{serial}-ack.json')
        if set(request)!={'protocol','runId','nonce'} or request.get('protocol')!='clique-native-flush/1' or request.get('runId')!=proof['runId']:
            raise RuntimeError('runtime-proof-flush-request')
        try:challenge=str(uuid.UUID(request['nonce']))
        except (KeyError,ValueError,TypeError):raise RuntimeError('runtime-proof-flush-nonce') from None
        if challenge!=request['nonce'] or challenge in challenges:raise RuntimeError('runtime-proof-flush-nonce')
        challenges.append(challenge)
        expected={**request,'processNonce':process_nonce,'eventCount':ack.get('eventCount'),'byteCount':ack.get('byteCount')}
        if ack!=expected:raise RuntimeError('runtime-proof-flush-process')
        count=ack['eventCount'];byte_count=ack['byteCount']
        if (not isinstance(count,int) or isinstance(count,bool) or count<0 or
            not isinstance(byte_count,int) or isinstance(byte_count,bool) or byte_count<0 or
            count<=prior_count or byte_count<=prior_bytes):
            raise RuntimeError('runtime-proof-flush-counts')
        prefix=raw[:byte_count]
        if len(prefix)!=byte_count or (prefix and not prefix.endswith(b'\n')) or len(prefix.splitlines())!=count:
            raise RuntimeError('runtime-proof-flush-stream')
        try:last=json.loads(prefix.splitlines()[-1])
        except (IndexError,json.JSONDecodeError):raise RuntimeError('runtime-proof-flush-stream') from None
        if last.get('processNonce')!=process_nonce:raise RuntimeError('runtime-proof-flush-process')
        prior_count=count;prior_bytes=byte_count
    if prior_count!=len(raw.splitlines()) or prior_bytes!=len(raw):raise RuntimeError('runtime-proof-terminal-flush-incomplete')

def validate_tree(path, identifier, principal):
    try: tree = read(path)
    except (UnicodeDecodeError, json.JSONDecodeError): raise RuntimeError('runtime-proof-ui-tree-invalid:' + identifier) from None
    matches = [node for node in tree_nodes(tree) if node.get('id') == identifier and node.get('value') == principal]
    if len(matches) != 1: raise RuntimeError('runtime-proof-ui-witness:' + identifier)

def validate_terminal(path):
    value = read(path); before = value.get('before', {}); after = value.get('after', {})
    ps = ['/bin/ps', '-wwaxo', 'pid=,comm=,args=']
    terminate = ['/usr/bin/xcrun', 'simctl', 'terminate', UDID, 'dev.clique.native.runtimebaseline']
    if (before.get('command') != ps or after.get('command') != ps or
        before.get('exitCode') != 0 or after.get('exitCode') != 0 or
        not before.get('processIds') or any(not isinstance(pid, int) or pid <= 0 for pid in before['processIds']) or
        after.get('processIds') != [] or before.get('expectedExecutable') != after.get('expectedExecutable') or
        UDID not in str(before.get('expectedExecutable')) or
        not str(before.get('expectedExecutable')).endswith('/RuntimeBaseline.app/RuntimeBaseline') or
        value.get('termination', {}).get('command') != terminate or
        not isinstance(value.get('termination', {}).get('at'), (int, float))):
        raise RuntimeError('runtime-proof-terminal-state')

def qualified_anchor(proof, proof_sha):
    anchor = read(NATIVE / 'QUALIFIED.json').get('runtimeBaseline', {})
    expected = {'proofSha256': proof_sha, 'inputInventorySha256': proof['inputInventorySha256'],
                'nativeSha256': proof['nativeSha256'], 'hermesSha256': proof['hermesSha256']}
    if anchor.get('schemaVersion') != 'clique-native-runtime-anchor.v1' or any(anchor.get(k) != v for k, v in expected.items()):
        raise RuntimeError('runtime-proof-qualified-anchor')

def verify_runtime_proof(binding=None):
    binding = binding or read(ROOT / 'metadata/runtime-baseline.json')
    if binding.get('evidenceRoot') != 'preparation/runtime-baseline':
        raise RuntimeError('runtime-proof-root-not-canonical')
    proof_root = (ROOT / binding['evidenceRoot']).resolve()
    if not proof_root.is_relative_to(ROOT.resolve()): raise RuntimeError('runtime-proof-root-escape')
    proof_path = proof_root / 'runtime-proof.json'
    proof_sha = sha(proof_path) if proof_path.is_file() else None
    if proof_sha != binding.get('proofSha256'): raise RuntimeError('runtime-proof-binding-drift')
    proof = read(proof_path)
    if (proof.get('schemaVersion') != 'clique-native-runtime-proof.v1' or proof.get('pass') is not True or
        proof.get('instrument') != '0.4.0-native.2' or proof.get('udid') != UDID or
        proof.get('bundleId') != 'dev.clique.native.runtimebaseline' or
        proof.get('expo') != '57.0.22' or proof.get('reactNative') != '0.86.3' or
        proof.get('expoSecureStore') != '57.0.4' or proof.get('xcode') != 'Xcode 27.0\nBuild version 27A266a' or
        not str(proof.get('iosSdk', '')).startswith('27.') or set(proof.get('checks', [])) != REQUIRED_CHECKS):
        raise RuntimeError('runtime-proof-not-qualified')
    try: canonical_run = str(uuid.UUID(proof['runId']))
    except (KeyError, ValueError): raise RuntimeError('runtime-proof-run-id') from None
    if canonical_run != proof['runId'] or proof.get('principal') != 'runtime.' + canonical_run + '@example.com':
        raise RuntimeError('runtime-proof-principal')

    expected_inputs = expected_proof_inputs()
    if proof.get('inputFiles') != expected_inputs or proof.get('inputInventorySha256') != inventory_digest(expected_inputs):
        raise RuntimeError('runtime-proof-input-inventory-drift')
    build = proof.get('buildInputs', {}); compiled = compiled_inputs()
    if (build.get('schemaVersion') != 'clique-native-runtime-compiled-inputs.v1' or
        build.get('compiledSourceFiles') != compiled or
        build.get('compiledSourceInventorySha256') != inventory_digest(compiled)):
        raise RuntimeError('runtime-proof-compiled-input-binding')

    actual_evidence = exact_evidence(proof_root)
    if proof.get('evidenceFiles') != actual_evidence or not REQUIRED_EVIDENCE <= set(actual_evidence):
        raise RuntimeError('runtime-proof-evidence-incomplete-or-drifted')
    receipt = read(proof_root / 'runtime-inputs.json')
    if (build.get('originalReceiptSha256') != actual_evidence['runtime-inputs.json'] or
        receipt.get('schemaVersion') != 'clique-native-runtime-inputs.v1' or
        build.get('appFiles') != receipt.get('appFiles') or
        any(receipt.get('sourceFiles', {}).get(name) != digest for name, digest in compiled.items())):
        raise RuntimeError('runtime-proof-build-receipt')

    cleanup = read(proof_root / 'cleanup.json')
    if cleanup != {'runnerExit': 0, 'recorderExit': 0, 'appAbsent': True} or proof.get('cleanup') != cleanup:
        raise RuntimeError('runtime-proof-cleanup')
    process_nonces=validate_helper(proof_root / 'native-observations.jsonl', proof)
    validate_flushes(proof_root,proof,process_nonces)
    validate_tree(proof_root / 'secure-write-read.json', 'runtime-secure-write-read', proof['principal'])
    validate_tree(proof_root / 'secure-restored.json', 'runtime-secure-restored', proof['principal'])
    validate_terminal(proof_root / 'terminal-process-state.json')

    retained_app = proof_root / 'built-app'; info = plistlib.loads((retained_app / 'Info.plist').read_bytes())
    executable = retained_app / info.get('CFBundleExecutable', '')
    if (info.get('CFBundleIdentifier') != proof['bundleId'] or sha(executable) != proof['nativeSha256'] or
        sha(retained_app / 'main.jsbundle') != proof['hermesSha256']):
        raise RuntimeError('runtime-proof-app-identity')
    signed = proof.get('signedEntitlements', {}); effective = signed.get('effective', {})
    retained_entitlements = plistlib.loads((proof_root / 'signed-entitlements.plist').read_bytes())
    embedded_entitlements = macho_entitlements(executable)
    if (signed.get('carrier') != 'xcode-simulator-mach-o' or effective != retained_entitlements or
        effective != embedded_entitlements or
        not str(effective.get('application-identifier', '')).endswith('.dev.clique.native.runtimebaseline') or
        not any(str(group).endswith('.dev.clique.native.runtimebaseline')
                for group in effective.get('keychain-access-groups', []))):
        raise RuntimeError('runtime-proof-entitlements-not-qualified')
    test_env = proof.get('xcodeTestEnvironment', {})
    if (test_env.get('developerDir') != '/Applications/Xcode.app/Contents/Developer' or
        not str(test_env.get('path', '')).startswith('/Applications/Xcode.app/Contents/Developer/usr/bin:')):
        raise RuntimeError('runtime-proof-xcode-test-environment')
    decoded = decoded_video(proof_root / 'runtime-launch-through-restore.mp4')
    if decoded != proof.get('video') or decoded.get('codec') != 'h264' or decoded.get('decodedEndpoints') is not True:
        raise RuntimeError('runtime-proof-video-not-qualified')

    runner = runner_config()
    if sha(runner['binary']) != proof.get('runnerBinarySha256') or sha(runner['xctestrun']) != proof.get('xctestrunSha256'):
        raise RuntimeError('runtime-proof-runner-drift')
    qualified_anchor(proof, proof_sha)
    return {'valid': True, 'proofSha256': proof_sha, 'inputInventorySha256': proof['inputInventorySha256'],
            'runId': proof['runId'], 'nativeSha256': proof['nativeSha256'],
            'hermesSha256': proof['hermesSha256'], 'checks': proof['checks'],
            'evidenceFiles': len(actual_evidence), 'evidenceRoot': binding['evidenceRoot']}

def import_proof(source):
    target = ROOT / 'preparation/runtime-baseline'
    if target.exists(): raise RuntimeError('runtime-proof-already-imported')
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copytree(source.resolve(), target)
    proof = read(target / 'runtime-proof.json')
    binding = {'schemaVersion': 'clique-native-pilot-runtime-binding.v1',
        'evidenceRoot': str(target.relative_to(ROOT)), 'proofSha256': sha(target / 'runtime-proof.json'),
        'inputInventorySha256': proof.get('inputInventorySha256'), 'importedAt': time.time()}
    result = verify_runtime_proof(binding)
    put(ROOT / 'metadata/runtime-baseline.json', binding)
    return result

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); parser.add_argument('--proof', type=Path)
    args = parser.parse_args()
    print(json.dumps(import_proof(args.proof) if args.proof else verify_runtime_proof()))

#!/usr/bin/env python3
"""Custody, Release build and two independent native segments. No scores."""
import argparse, plistlib, re, shutil, sys, tempfile, uuid
from urllib.parse import urlparse
from common import *
from verify import verify
from audit import audit, SourceAuditRefused
from processes import ProcessOwner
from reclassification import verify_record
from operator_inputs import clean_environment, execution_environment
import source_ruling
import derived_data

class SemanticHandoffRefused(RuntimeError):
    """Only an observed descriptor/schema refusal may reject the handoff."""

def classify_failure(summary, error, stage):
    summary.update(reason=str(error), failureStage=stage)
    if isinstance(error, SemanticHandoffRefused):
        summary.update(outcome='handoff-refused-by-semantic-validator',
            failureAttribution='builder fixture descriptor rejected before compilation or device work')
    elif isinstance(error, SourceAuditRefused):
        summary.update(outcome=source_ruling.OUTCOME,
            failureAttribution='source-audit pilot finding; not a void or setup failure')
    elif isinstance(error, (HarnessDefect, OSError, subprocess.SubprocessError)) or stage == 'builder-handoff-semantic':
        summary.update(outcome='harness-defect', failureStage='operator-setup',
            failureAttribution='harness cleanup or infrastructure; no builder refusal',
            interruptedStage=stage, outcomeClass='operator-setup')
    elif stage in ('builder-handoff', 'builder-prepare', 'builder-build'):
        summary.update(outcome='unclassified-failure',
            failureAttribution='authoring-or-infrastructure; explicit triage required; no rerun')
    elif stage == 'driver':
        classes = [r.get('outcomeClass') for r in summary['segments'].values()]
        summary['outcome'] = 'instrument-failure' if 'instrument' in classes else 'unclassified-failure'
    summary['setupRerunEligible'] = (summary.get('outcome') == 'setup-failure'
        and stage == 'operator-setup' and not summary['observedProductFailure'])

def wait_builder(b):
    logs = ROOT / 'logs' / b
    if not (logs / 'launch.json').exists(): raise RuntimeError('builder-not-launched')
    while not (logs / 'end.json').exists():
        pid = read(logs / 'launch.json')['pid']
        # kill(0) is only a probe: EPERM does not imply the supervisor died.
        from processes import process_table
        signal_owned(os.kill, pid, 0)
        row = process_table().get(pid)
        if row is None or row['state'].startswith('Z'):
            ProcessOwner.resume(logs).cleanup()
            raise RuntimeError('builder-supervisor-died-without-end; owned processes cleaned; preserve and inspect logs')
        time.sleep(2)
    result = read(logs / 'end.json')
    if result['outcome'] != 'builder-ended':
        if result['reason'] != 'invalid-replay-boundary':
            raise RuntimeError('builder-not-measurable:' + result['reason'])
        # Preserve historical logs too; admission rechecks cleanup read-only.
        if b == 'convex':
            from round5 import verify_record as verify_convex
            return {**result, 'measurementAdmission': verify_convex(ROOT)}
        return {**result, 'measurementAdmission': verify_record(ROOT)}
    ProcessOwner.resume(logs).cleanup()  # Recheck custody before the port probe or clone.
    if not result.get('cleanup', {}).get('complete'): raise RuntimeError('builder-cleanup-unconfirmed')
    if not result.get('derivedDataCleanup', {}).get('complete'): raise RuntimeError('derived-data-cleanup-unconfirmed')
    if result['outcome'] != 'builder-ended': raise RuntimeError('builder-not-measurable:' + result['reason'])
    return result

def expand(value, mapping):
    if isinstance(value, list): return [expand(x, mapping) for x in value]
    if isinstance(value, dict): return {k: expand(v, mapping) for k, v in value.items()}
    if not isinstance(value, str): return value
    for key, v in mapping.items(): value = value.replace('@' + key + '@', str(v))
    return value

def relocate_work_links(work, source, receipt):
    """Keep absolute links internal to the copied lane internal to the work copy."""
    changes = []
    for p in work.rglob('*'):
        if not p.is_symlink() or p.name == 'instrument': continue
        target = p.resolve()
        if target.is_relative_to(source.resolve()):
            copied = work / target.relative_to(source.resolve())
            replacement = os.path.relpath(copied, p.parent)
            changes.append({'path': str(p.relative_to(work)), 'before': os.readlink(p), 'after': replacement})
            p.unlink(); p.symlink_to(replacement)
        if not p.resolve().is_relative_to(work.resolve()):
            raise RuntimeError('external-work-copy-symlink:' + str(p.relative_to(work)))
    put(receipt, {'source': str(source), 'work': str(work), 'links': changes,
                  'scope': 'internal link relocation only; original lane and custody unchanged'})

def app_hash(app, bundle):
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    if info['CFBundleIdentifier'] != bundle: raise RuntimeError('wrong-app-bundle')
    if (app / 'main.jsbundle').read_bytes()[:8] != bytes.fromhex('c61fbc03c103191f'):
        raise RuntimeError('Release-Hermes-required')
    return {'bundleId': bundle, 'nativeSha256': sha(app / info['CFBundleExecutable']), 'hermesSha256': sha(app / 'main.jsbundle')}

def check_repair(previous, repair):
    old = read(previous / 'summary.json')
    statuses = [read(p) for p in previous.glob('*/evidence/status.json')]
    if (old.get('observedProductFailure') or any(s.get('pass') is False for s in statuses)
        or any(s.get('pass') is False or s.get('driverStatus', {}).get('pass') is False
               for s in old['segments'].values()) or old['outcome'] == 'product-failure'):
        raise RuntimeError('product-retry-forbidden')
    if old['outcome'] != 'setup-failure' or old.get('setupRerunEligible') is not True:
        raise RuntimeError('explicit-setup-attribution-required')
    if any(s.get('pass') is not None for s in old['segments'].values()):
        raise RuntimeError('completed-segment-retry-forbidden')
    value = read(repair)
    if (set(value) != {'reason', 'scope'} or not isinstance(value['reason'], str) or not value['reason'].strip()
        or value['scope'] != 'operator-setup-only'):
        raise RuntimeError('setup-repair-cannot-replace-builder-commands')
    return value

def setup_repair_previous(b, previous, repair):
    eligible = previous
    if b == 'snapback4' and (ROOT / 'metadata/revision-8.json').exists():
        from cleanup_recovery import verify_record as verify_cleanup_refusal
        verify_cleanup_refusal(ROOT)
        eligible = [p for p in previous if p.name != 'attempt-01']
    if b == 'convex' and (ROOT / 'metadata/revision-7.json').exists():
        from round6 import verify_record as verify_wrapper_refusal
        verify_wrapper_refusal(ROOT)
        eligible = [p for p in previous if p.name != 'attempt-01']
    if repair is None or len(eligible) != 1:
        raise RuntimeError('refuse-overwrite; only one documented setup rerun permitted')
    check_repair(eligible[0], repair)
    return eligible[0]


def observe_driver(seg, summary, segment, code):
    row = summary['segments'].setdefault(segment, {'pass': None})
    row['driverExit'] = code
    path = seg / 'evidence/status.json'
    if path.exists():
        row['driverStatus'] = read(path)
        manifest = seg / 'evidence' / (segment + '-ios-run.json')
        failure = read(manifest).get('failure') if manifest.exists() else None
        row['outcomeClass'] = (failure or {}).get('outcomeClass', row['driverStatus'].get('outcomeClass'))
        if row['driverStatus'].get('pass') is False: summary['observedProductFailure'] = True
    put(seg / 'driver-observed.json', row)

def driver_verdict(code, status, validation):
    if code not in (0, 1) or code != (1 if status.get('pass') is False else 0):
        raise RuntimeError('unexpected-driver-exit:' + str(code))
    if not validation['valid'] or status.get('pass') is None:
        raise RuntimeError('native-setup-or-instrument-failure:' + str(validation.get('reason')))
    if validation['pass'] != status['pass']: raise RuntimeError('independent-verdict-disagreement')
    return validation['pass']

def build_wrapper(args, work, derived):
    if args[0] not in ('bash', '/bin/bash'): return False
    if args[2:] not in ([str(derived)], [str(derived), UDID]):
        raise RuntimeError('build-wrapper-requires-derived-and-optional-dedicated-udid')
    script = (work / args[1]).resolve()
    if not script.is_relative_to(work.resolve()) or not script.is_file():
        raise RuntimeError('build-wrapper-outside-custody')
    # @ref LLP 0201.000#9 — reject a known unsigned Release recipe at
    # admission, before authored wrapper code can execute.
    if b'CODE_SIGNING_ALLOWED=NO' in script.read_bytes():
        raise RuntimeError('Release-simulator-signing-required')
    return True

def check_release_target(args, app, derived, wrapper=False):
    if derived.exists() or derived.is_symlink(): raise RuntimeError('derived-data-must-be-absent-before-build')
    if not app.resolve().is_relative_to(derived.resolve()): raise RuntimeError('app-outside-fresh-derived-data')
    if not wrapper and (args.count('-derivedDataPath') != 1 or args[args.index('-derivedDataPath') + 1] != str(derived)):
        raise RuntimeError('build-must-use-attempt-derived-data')

def handoff_mapping(b, work, scratch):
    return {'APP': work, 'DERIVED': scratch / 'DerivedData',
        'ORIGIN': 'http://127.0.0.1:' + str(PORTS[b][0]),
        'WEB_ORIGIN': 'http://127.0.0.1:' + str(PORTS[b][0] + 2),
        'CONVEX_OWNER': ROOT / 'scripts/convex-owned.py', 'PYTHON': sys.executable,
        'UDID': UDID, 'BUNDLE_ID': 'dev.clique.pilot.' + b}


def direct_build(args):
    def option(key):
        if args.count(key) != 1 or args.index(key) + 1 == len(args):
            raise RuntimeError('build-option-required-once:' + key)
        return args[args.index(key) + 1]
    if args[0] != 'xcodebuild' or option('-configuration') != 'Release':
        raise RuntimeError('explicit-Release-xcodebuild-required')
    if option('-destination') not in ('platform=iOS Simulator,id=' + UDID,
                                      'generic/platform=iOS Simulator'):
        raise RuntimeError('Release-build-only-simulator-destination')
    if '-sdk' in args and not option('-sdk').startswith('iphonesimulator'):
        raise RuntimeError('simulator-sdk-required')
    if any(value == 'CODE_SIGNING_ALLOWED=NO' for value in args):
        raise RuntimeError('Release-simulator-signing-required')
    actions = {'build', 'clean', 'analyze', 'archive', 'install', 'installsrc',
               'installhdrs', 'test', 'test-without-building', 'build-for-testing'}
    if [x for x in args if x in actions] != ['build']:
        raise RuntimeError('build-action-only-required')


def confined_argv(raw, mapping, work):
    """Validate declared paths, never execute or interpret authored shell code.

    Source audits still trace paths/origins computed inside scripts and build
    phases. URL and destination slashes are values, not filesystem paths.
    """
    if not isinstance(raw, list) or not raw or not all(isinstance(x, str) and x for x in raw):
        raise RuntimeError('nonempty-string-argv-required')
    for i, value in enumerate(raw):
        tokens = re.findall(r'@([A-Z_]+)@', value)
        if any(t not in mapping for t in tokens): raise RuntimeError('unknown-token:' + value)
        resolved = expand(value, mapping)
        if re.search(r'@[A-Z_]+@', resolved): raise RuntimeError('unresolved-token:' + value)
        if '://' in resolved or resolved.startswith(('platform=', 'generic/platform=')): continue
        # A flag/setting may carry a path after '='; ordinary flags are scalars.
        item = resolved.split('=', 1)[1] if '=' in resolved else resolved
        original = value.split('=', 1)[1] if '=' in value else value
        if '/' not in item and not item.startswith(('.', '~')): continue
        if i == 0 and resolved in ('/bin/bash', '/usr/bin/env'): continue
        path = Path(item)
        path = (path if path.is_absolute() else work / path).resolve()
        allowed = work.resolve()
        for token in tokens:
            root = Path(str(mapping[token]))
            if root.is_absolute() and original.startswith('@' + token + '@'):
                allowed = root.resolve()
                break
        if item.startswith('~') or not path.is_relative_to(allowed):
            raise RuntimeError('argv-path-outside-custody-or-token:' + value)
        if Path(original).is_absolute() and not tokens:
            raise RuntimeError('absolute-path-requires-token:' + value)
    args = expand(raw, mapping)
    # Check ordinary script entrypoints without prescribing a seed/oracle tool.
    if args[0] in ('bash', '/bin/bash', 'node', 'python', 'python3') and len(args) > 1 and not args[1].startswith('-'):
        entry = (work / args[1]).resolve()
        if not entry.is_relative_to(work.resolve()) or not entry.is_file():
            raise RuntimeError('argv-script-missing-or-outside-custody:' + raw[1])
    return args


def static_admission(b, work, scratch, attempt, require_fresh=True):
    """All handoff admission checks that need no model, backend, build or device.

    Collect every independent refusal rather than masking later gates behind
    the first. Existing diagnostic DerivedData is reported, never reused.
    """
    checks = []
    def check(name, fn):
        try:
            value = fn()
            checks.append({'gate': name, 'admitted': True})
            return value
        except (KeyError, IndexError, TypeError, ValueError, OSError, RuntimeError) as error:
            checks.append({'gate': name, 'admitted': False, 'reason': str(error)})
    handoff = check('handoff-json', lambda: read(work / 'native-operator.json'))
    if not isinstance(handoff, dict):
        return {'valid': False, 'checks': checks, 'refusals': [x for x in checks if not x['admitted']]}
    mapping = handoff_mapping(b, work, scratch)
    def bundle():
        if handoff['bundleId'] != mapping['BUNDLE_ID']:
            raise RuntimeError('pilot-bundle-id-required:' + mapping['BUNDLE_ID'])
    check('bundle-id', bundle)
    def work_links():
        for path in work.rglob('*'):
            if path.is_symlink() and path.name != 'instrument' and not path.resolve().is_relative_to(work.resolve()):
                raise RuntimeError('external-work-copy-symlink:' + str(path.relative_to(work)))
    check('work-copy-symlinks', work_links)
    for segment in ('m6', 'm8'):
        fields = {**mapping, 'STORE': scratch / (segment + '-store'), 'SEGMENT': segment,
                  'BACKEND_EVIDENCE': attempt / segment / 'backend-images.jsonl'}
        for key in ('prepareArgv', 'buildArgv', 'backendArgv', 'webArgv', 'seedArgv', 'oracleArgv'):
            check(segment + ':' + key, lambda key=key: confined_argv(handoff[key], fields, work))
        check(segment + ':backend-binding', lambda: bind_backend(b, expand(handoff['backendArgv'], fields),
            fields['STORE'], fields['ORIGIN'], fields['BACKEND_EVIDENCE']))
    build = expand(handoff, mapping)
    def target():
        raw = handoff['app']
        confined_argv(['app', raw], mapping, work)
        app = (work / build['app']).resolve()
        if app.suffix != '.app': raise RuntimeError('app-bundle-path-required')
        # Freshness is also checked immediately before executing the build.
        if not app.is_relative_to((scratch / 'DerivedData').resolve()):
            raise RuntimeError('app-outside-fresh-derived-data')
    check('app-path', target)
    if require_fresh:
        def fresh():
            if (scratch / 'DerivedData').exists() or (scratch / 'DerivedData').is_symlink():
                raise RuntimeError('derived-data-must-be-absent-before-build')
        check('fresh-derived-data', fresh)
    def build_check():
        args = build['buildArgv']
        if not build_wrapper(args, work, scratch / 'DerivedData'):
            direct_build(args)
            if args.count('-derivedDataPath') != 1 or args[args.index('-derivedDataPath') + 1] != str(scratch / 'DerivedData'):
                raise RuntimeError('build-must-use-attempt-derived-data')
    check('build-wrapper-or-direct-target', build_check)
    for key in ('ordinaryImage', 'viewOnceImage'):
        def fixture(key=key):
            confined_argv(['fixture', handoff[key]], mapping, work)
            path = (work / build[key]).resolve()
            if not path.is_relative_to(work.resolve()) or not path.is_file() or path.stat().st_size == 0:
                raise RuntimeError('fixture-image-missing-or-outside-custody:' + key)
        check(key, fixture)
    refusals = [x for x in checks if not x['admitted']]
    return {'valid': not refusals, 'backend': b, 'work': str(work), 'scratch': str(scratch),
        'checks': checks, 'refusals': refusals, 'existingDerivedData': (scratch / 'DerivedData').exists(),
        'freshnessRequired': require_fresh, 'sourceAuditRequired': True,
        'deferred': ['gating source audit and prepared-source audit', 'prepared project and dependency inputs',
            'built simulator arm64 Release identity', 'dedicated simulator installation and driver evidence']}


def simulator_product(app, derived):
    if not app.resolve().is_relative_to(derived.resolve()):
        raise RuntimeError('app-outside-fresh-derived-data')
    if app.parent.name != 'Release-iphonesimulator': raise RuntimeError('Release-simulator-product-required')
    info = plistlib.loads((app / 'Info.plist').read_bytes())
    if info.get('DTPlatformName') != 'iphonesimulator' or 'iPhoneSimulator' not in info.get('CFBundleSupportedPlatforms', []):
        raise RuntimeError('simulator-platform-required')
    binary = (app / info['CFBundleExecutable']).resolve()
    if not binary.is_relative_to(app.resolve()): raise RuntimeError('app-executable-outside-bundle')
    archs = subprocess.check_output(['xcrun', 'lipo', '-archs', str(binary)], text=True).split()
    if 'arm64' not in archs: raise RuntimeError('simulator-arm64-required')
    version = subprocess.check_output(['xcrun', 'vtool', '-arch', 'arm64', '-show-build', str(binary)], text=True)
    if not re.search(r'platform\s+IOSSIMULATOR\b', version): raise RuntimeError('arm64-simulator-mach-o-required')
    return {'platform': 'iphonesimulator', 'archs': archs, 'configuration': 'Release',
            'arm64BuildVersion': version, 'derivedData': str(derived),
            'installation': 'qualified driver installs and verifies identity on dedicated UDID before seeding'}


def bind_backend(backend, argv, store=None, origin=None, evidence=None):
    if backend != 'convex': return None
    pinned = ROOT / 'inputs/convex/convex-local-backend'
    expected = read(ROOT / 'metadata/convex-preflight.json')['backendSha256']
    exact = [sys.executable, str(ROOT / 'scripts/convex-owned.py'), str(store), str(origin), str(evidence)]
    if argv != exact or pinned.is_symlink() or sha(pinned) != expected:
        raise RuntimeError('convex-backend-must-use-owned-preflight-launcher')
    return {'binary': str(pinned), 'sha256': expected, 'argv': argv,
            'bothStarts': 'qualified driver invokes this exact argv; wrapper records kernel process image'}

def verify_backend_evidence(path, binding, require_restart=True):
    events = [json.loads(line) for line in path.read_text().splitlines()]
    starts = [e for e in events if e['kind'] == 'backend-image']
    if len(starts) not in ([2] if require_restart else [1, 2]) or any(e['binary'] != binding['binary'] or e['sha256'] != binding['sha256'] for e in starts):
        raise RuntimeError('convex-two-start-image-binding-required')
    return starts

def validate_handoff_descriptor(backend, handoff, work, scratch, attempt, env, native_command):
    """Execute the actual seed in a disposable owned store before compilation/device work."""
    target = attempt / 'semantic-handoff'; target.mkdir()
    store = scratch / 'semantic-handoff-store'; store.mkdir()
    run_id = str(uuid.uuid4())
    mapping = {**handoff_mapping(backend, work, scratch), 'STORE': store, 'SEGMENT': 'handoff',
        'BACKEND_EVIDENCE': target / 'backend-images.jsonl'}
    expanded = expand(handoff, mapping)
    backend_argv = expanded['backendArgv']; seed_argv = expanded['seedArgv']
    binding = bind_backend(backend, backend_argv, store, mapping['ORIGIN'], mapping['BACKEND_EVIDENCE'])
    process = None; cleanup = []
    with (target / 'backend.log').open('xb') as log:
        try:
            process = subprocess.Popen(native_command(backend_argv), cwd=work, env=env,
                stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT, start_new_session=True)
            put(target / 'backend-start.json', {'at': time.time(), 'pid': process.pid, 'argv': backend_argv})
            endpoint = urlparse(mapping['ORIGIN']); deadline = time.monotonic() + 30
            while True:
                if process.poll() is not None: raise RuntimeError('semantic-handoff-backend-exited')
                with socket.socket() as probe:
                    probe.settimeout(.2)
                    if probe.connect_ex((endpoint.hostname, endpoint.port)) == 0: break
                if time.monotonic() >= deadline: raise RuntimeError('semantic-handoff-backend-unavailable')
                time.sleep(.1)
            payload = {'protocol': 'clique-native/1', 'runId': run_id,
                'origin': mapping['ORIGIN'], 'bundleId': mapping['BUNDLE_ID']}
            seeded = subprocess.run(native_command(seed_argv), cwd=work, env=env,
                input=json.dumps(payload), capture_output=True, text=True, timeout=300)
            put(target / 'seed.stdout', seeded.stdout); put(target / 'seed.stderr', seeded.stderr)
            put(target / 'seed-exit.json', {'exitCode': seeded.returncode, 'argv': seed_argv})
            if seeded.returncode: raise RuntimeError('semantic-handoff-seed-exit:' + str(seeded.returncode))
            try: descriptor = json.loads(seeded.stdout)
            except json.JSONDecodeError: raise SemanticHandoffRefused('semantic-handoff-seed-output') from None
            put(target / 'native-fixture.json', descriptor)
            import jsonschema
            schema_path = NATIVE / 'schemas/fixture.schema.json'
            validator = jsonschema.Draft202012Validator(read(schema_path), format_checker=jsonschema.FormatChecker())
            errors = sorted(validator.iter_errors(descriptor), key=lambda error: list(error.path))
            put(target / 'schema-validation.json', {'valid': not errors, 'schemaSha256': sha(schema_path),
                'errors': [error.message for error in errors]})
            if errors: raise SemanticHandoffRefused('semantic-handoff-schema-refused:' + errors[0].message)
            checked = subprocess.run(['node', str(NATIVE / 'helper/fixture.mjs'), 'validate',
                '--run-id', run_id, str(target / 'native-fixture.json')], capture_output=True, text=True, timeout=30)
            put(target / 'validator.stdout', checked.stdout); put(target / 'validator.stderr', checked.stderr)
            put(target / 'validator-exit.json', {'exitCode': checked.returncode,
                'validatorSha256': sha(NATIVE / 'helper/fixture.mjs'), 'runId': run_id})
            if checked.returncode:
                try: refusal = json.loads(checked.stderr)
                except json.JSONDecodeError: refusal = {}
                if checked.returncode == 2 and refusal.get('valid') is False and refusal.get('code') in (
                        'fixture-run-id-current', 'fixture-queued-bodies-current-run'):
                    raise SemanticHandoffRefused('semantic-handoff-refused:' + checked.stderr.strip())
                raise HarnessDefect('semantic-handoff-validator-unavailable:' + checked.stderr.strip())
            result = json.loads(checked.stdout)
            if result != {'valid': True, 'runId': run_id,
                           'queuedBodies': [run_id + ':first', run_id + ':second']}:
                raise RuntimeError('semantic-handoff-validator-output')
            if binding: verify_backend_evidence(target / 'backend-images.jsonl', binding, require_restart=False)
            put(target / 'result.json', {'pass': True, 'runId': run_id,
                'descriptorSha256': sha(target / 'native-fixture.json'),
                'beforeCompilation': True, 'beforeDeviceWork': True})
        finally:
            cleanup_call(cleanup, 'semantic-backend', lambda: stop(process))
            put(target / 'cleanup.json', {'complete': not cleanup, 'errors': cleanup})
    # Preserve the established semantic success and gate cleanup separately.
    return {**result, 'cleanupErrors': cleanup}

def diagnostic_audit(work, attempt, env):
    try:
        return audit(work, attempt, name='prepared-source-audit', gating=False, env=env)
    except Exception as error:
        # Diagnostic only: even auditor infrastructure failure remains recorded
        # without turning this into an admissible run or preventing compilation.
        put(attempt / 'prepared-source-audit-error.json', {'label': source_ruling.LABEL,
            'gating': False, 'error': str(error), 'passClaimed': False})

def execute(b, repair=None, diagnostic=False, resume_wrapper_refusal=False, resume_cleanup_refusal=False):
    if resume_cleanup_refusal and (b != 'snapback4' or repair or diagnostic or resume_wrapper_refusal):
        raise RuntimeError('cleanup-refusal-resume-is-snapback4-only')
    if resume_wrapper_refusal and (b != 'convex' or repair or diagnostic):
        raise RuntimeError('wrapper-refusal-resume-is-convex-only')
    if diagnostic and (b != 'snapback4' or repair): raise RuntimeError('diagnostic-is-not-a-repair')
    host_check(); verify()
    end = None if diagnostic else wait_builder(b)
    if not diagnostic: verify(ready=True)
    lease = lock('authoring-or-operator.lock')
    parent = ROOT / 'results' / b; parent.mkdir(exist_ok=True)
    previous = [] if diagnostic else sorted(parent.glob('attempt-*'))
    if resume_cleanup_refusal:
        from cleanup_recovery import verify_record as verify_cleanup_refusal
        cleanup_receipt = verify_cleanup_refusal(ROOT)
        if [p.name for p in previous] != ['attempt-01']:
            raise RuntimeError('cleanup-refusal-resume-already-consumed')
    elif resume_wrapper_refusal:
        from round6 import verify_record as verify_wrapper_refusal
        wrapper_receipt = verify_wrapper_refusal(ROOT)
        if [p.name for p in previous] != ['attempt-01']:
            raise RuntimeError('wrapper-refusal-resume-already-consumed')
    elif previous:
        setup_repair_previous(b, previous, repair)
    elif repair: raise RuntimeError('repair-without-prior-attempt')
    attempt = ROOT / source_ruling.DIAGNOSTIC if diagnostic else parent / ('attempt-%02d' % (len(previous) + 1))
    attempt.mkdir()
    started = time.time(); summary = {'backend': b, 'startedAt': started, 'segments': {}, 'scoredUse': False,
        'O4': None, 'overall': None, 'M7': 'not-run', 'M8WebConvergence': 'separate-web-evidence-only',
        'outcome': 'setup-failure', 'observedProductFailure': False, 'setupRerunEligible': False, 'review': 'pending-independent-source-and-frame-review'}
    if diagnostic:
        summary.update(label=source_ruling.LABEL, diagnostic=True, admissible=False, passClaimed=False,
            nativeOutcome=source_ruling.OUTCOME, productRetry=False, setupRerun=False, **{'pass': None})
        put(attempt / 'DIAGNOSTIC.md', source_ruling.LABEL + '\n\nApplies to EVERY artifact in this directory and the retained scratch tree.\n'
            'Raw driver/validator verdicts are diagnostic observations only. No pilot pass can be claimed.\n')
    if resume_wrapper_refusal: summary['wrapperRefusalAdmission'] = wrapper_receipt
    if resume_cleanup_refusal: summary['cleanupRefusalAdmission'] = cleanup_receipt
    if end and 'measurementAdmission' in end: summary['measurementAdmission'] = end['measurementAdmission']
    put(attempt / 'start.json', {'at': started, 'builder': end, 'pid': os.getpid()})
    work = None; browser_server = None; stage = 'operator-setup'
    profile = None; xcode_setting = None; cleanup = []
    def native_command(argv):
        return ['/usr/bin/sandbox-exec', '-f', str(profile), *argv] if profile else argv
    try:
        free_ports(b)
        snapshot = ROOT / 'attempts' / (b + '-builder-completed')
        if diagnostic:
            ruling = source_ruling.verify_retained(ROOT)
            work = Path(ruling['work']); scratch = work.parent
            # Round-7 repair: Expo Swift macro expansion requires the normal
            # operator build environment. The retained custody hashes below
            # still detect any change to builder/source evidence.
            profile = None
            # Same proven SwiftPM accommodation as the builder's serial lease.
            # The auditor keeps its own read-only sandbox, outside this profile.
            xcode_setting = {'before': derived_data.manifest_setting()}
            put(attempt / 'xcode-setting.json', {**xcode_setting, 'label': source_ruling.LABEL})
            derived_data.set_manifest_setting(True)
            put(attempt / 'custody-reuse.json', {'label': source_ruling.LABEL, 'work': str(work),
                'rulingSha256': sha(ROOT / source_ruling.RULING), 'originalAuditUnchanged': True,
                'operatorBuildEnvironment': 'normal; no outer diagnostic sandbox'})
            put(scratch / 'DIAGNOSTIC.md', source_ruling.LABEL + '\nAll preparation/build/store/app artifacts below are diagnostic only.\n')
        elif not previous:
            clone(ROOT / 'lanes' / b, snapshot, attempt / 'custody')
        else:
            if inventory(snapshot) != read(previous[0] / 'custody.clone.json'): raise RuntimeError('custody-changed')
        if not diagnostic:
            scratch = Path(tempfile.mkdtemp(prefix='clique-native-pilot-' + b + '-', dir='/tmp'))
            work = scratch / 'app'
            clone(snapshot, work, attempt / 'work-copy')
            # APFS preserves absolute links verbatim. Relocate internal links only.
            relocate_work_links(work, ROOT / 'lanes' / b, attempt / 'work-link-relocations.json')
        put(attempt / 'scratch.json', {'path': str(scratch), 'retained': True,
            **({'label': source_ruling.LABEL} if diagnostic else {})})
        stage = 'builder-handoff'
        handoff = read(work / 'native-operator.json')
        if repair: put(attempt / 'repair.json', check_repair(previous[-1], repair))
        admission_report = static_admission(b, work, scratch, attempt)
        put(attempt / 'static-admission.json', admission_report)
        if not admission_report['valid']:
            raise RuntimeError('static-admission-refused:' + json.dumps(admission_report['refusals']))
        mapping = handoff_mapping(b, work, scratch)
        expected_bundle = mapping['BUNDLE_ID']; origin = mapping['ORIGIN']; web_origin = mapping['WEB_ORIGIN']
        build = expand(handoff, mapping)
        args = build['buildArgv']
        wrapper = build_wrapper(args, work, scratch / 'DerivedData')
        env = execution_environment(b)
        if not diagnostic: audit(work, attempt, env=env)
        stage = 'builder-prepare'
        run(native_command(build['prepareArgv']), work, attempt / 'prepare.log', env)
        # Both dependency tree and every source/config file are bound before build.
        put(attempt / 'prepared-inputs.json', inventory(work))
        stage = 'builder-build'
        app = Path(build['app']); app = app if app.is_absolute() else work / app
        derived = scratch / 'DerivedData'
        check_release_target(args, app, derived, wrapper)
        if diagnostic: diagnostic_audit(work, attempt, env)
        else: audit(work, attempt, name='prepared-source-audit', env=env)
        stage = 'builder-handoff-semantic'
        semantic = validate_handoff_descriptor(b, handoff, work, scratch, attempt, env, native_command)
        summary['semanticHandoff'] = semantic
        require_cleanup((semantic or {}).get('cleanupErrors', []))
        if derived.exists() or derived.is_symlink():
            raise RuntimeError('semantic-handoff-must-precede-compilation')
        stage = 'builder-build'
        run(native_command(args), work, attempt / 'release-build.log', env)
        app = Path(build['app']); app = app if app.is_absolute() else work / app
        identity = app_hash(app, expected_bundle)
        identity.update(simulator_product(app, derived))
        put(attempt / 'release-identity.json', identity)
        stage = 'operator-setup'
        runner = runner_config(); python = str(ROOT / 'runtime/venv/bin/python')
        run(['xcrun', 'swiftc', str(NATIVE / 'driver/video.swift'), '-o', str(scratch / 'video-check')],
            work, attempt / 'video-decoder-build.log', env, timeout=90)
        with (attempt / 'web-server.log').open('xb') as f:
            browser_server = subprocess.Popen(native_command(build['webArgv']), cwd=work, env=env, stdin=subprocess.DEVNULL,
                stdout=f, stderr=subprocess.STDOUT, start_new_session=True)
        put(attempt / 'web-server.json', {'pid': browser_server.pid, 'argv': build['webArgv'], 'at': time.time()})
        devices = json.loads(subprocess.check_output(['xcrun', 'simctl', 'list', 'devices', 'available', '--json']))['devices']
        selected = [d for ds in devices.values() for d in ds if d['udid'] == UDID]
        if len(selected) != 1: raise RuntimeError('dedicated-simulator-unavailable')
        if selected[0]['state'] != 'Booted':
            run(['xcrun', 'simctl', 'boot', UDID], work, attempt / 'simulator-boot.log', env)
            run(['xcrun', 'simctl', 'bootstatus', UDID, '-b'], work, attempt / 'simulator-ready.log', env)
        for segment in ['m6', 'm8']:
            seg = attempt / segment; seg.mkdir(); store = scratch / (segment + '-store'); store.mkdir()
            if diagnostic: put(seg / 'DIAGNOSTIC.md', source_ruling.LABEL + '\nApplies to all raw evidence and validation below.\n')
            cfg = expand(build, {'STORE': store, 'SEGMENT': segment, 'BACKEND_EVIDENCE': seg / 'backend-images.jsonl'})
            config = {key: cfg[key] for key in ['backendArgv', 'seedArgv', 'oracleArgv']}
            config.update(app=str(app), bundleId=expected_bundle, udid=UDID, origin=origin, webOrigin=web_origin,
              backendCwd=str(work), dataDirectory=str(store),
              ordinaryImage=str(work / cfg['ordinaryImage']), viewOnceImage=str(work / cfg['viewOnceImage']),
              videoCheckArgv=[str(scratch / 'video-check')], driverBinarySha256=sha(runner['binary']),
              developerDir='/Applications/Xcode.app/Contents/Developer',
              runnerCwd=str(work), runnerArgv=['xcodebuild', 'test-without-building', '-xctestrun', runner['xctestrun'],
                '-resultBundlePath', str(seg / 'test.xcresult'), '-destination', 'platform=iOS Simulator,id=' + UDID,
                '-parallel-testing-enabled', 'NO', '-maximum-concurrent-test-simulator-destinations', '1',
                '-only-testing:CliqueDriver/NativeDriver/testCommands'],
              instrument=read(NATIVE / 'QUALIFIED.json')['instrument'])
            binding = bind_backend(b, config['backendArgv'], store, origin, seg / 'backend-images.jsonl')
            if binding: put(seg / 'backend-binding.json', binding)
            put(seg / 'operator.json', config)
            existing = subprocess.run(['xcrun', 'simctl', 'get_app_container', UDID, expected_bundle, 'app'], capture_output=True)
            if existing.returncode == 0: raise RuntimeError('refuse-replacing-existing-app:' + expected_bundle)
            code = None; stage = 'driver'
            try:
                try:
                    with (seg / 'driver.log').open('xb') as f:
                        code = subprocess.run(native_command([python, str(ROOT / 'scripts/driver-entry.py'), '--config', str(seg / 'operator.json'),
                            '--segment', segment, '--out', str(seg / 'evidence')]), cwd=work, env=env, stdout=f, stderr=subprocess.STDOUT,
                            timeout=1800).returncode
                finally:
                    observe_driver(seg, summary, segment, code)
                checked = subprocess.run([python, str(NATIVE / 'driver/validate.py'), str(seg / 'evidence'), '--segment', segment],
                    cwd=work, env=env, capture_output=True, text=True, timeout=300)
                put(seg / 'independent-validation.stdout', checked.stdout); put(seg / 'independent-validation.stderr', checked.stderr)
                validation = json.loads(checked.stdout)
                put(seg / 'independent-validation.json', {'exitCode': checked.returncode, **validation})
                status = summary['segments'][segment].get('driverStatus', {})
                summary['segments'][segment].update(validation=validation, evidence=str(seg / 'evidence'))
                if checked.returncode: raise RuntimeError('independent-validator-exit:' + str(checked.returncode))
                verdict = driver_verdict(code, status, validation)
                if diagnostic:
                    summary['segments'][segment].update(passClaimed=False, admissible=False,
                        label=source_ruling.LABEL, diagnosticDriverVerdict=verdict)
                else: summary['segments'][segment]['pass'] = verdict
                if binding: verify_backend_evidence(seg / 'backend-images.jsonl', binding, require_restart=verdict is True)
                if binding and bind_backend(b, config['backendArgv'], store, origin, seg / 'backend-images.jsonl') != binding:
                    raise RuntimeError('convex-backend-changed')
            except Exception as error:
                if not diagnostic: raise
                summary['segments'][segment].update(error=str(error), passClaimed=False,
                    admissible=False, label=source_ruling.LABEL)
            finally:
                def cleanup_install():
                    # It was absent before our driver. Retain its data and verify identity
                    # before removing only this installation between separate segments.
                    installed = subprocess.run(['xcrun', 'simctl', 'get_app_container', UDID, expected_bundle, 'app'], capture_output=True, text=True)
                    if installed.returncode == 0:
                        binary_identity = {key: identity[key] for key in ('bundleId', 'nativeSha256', 'hermesSha256')}
                        if app_hash(Path(installed.stdout.strip()), expected_bundle) != binary_identity:
                            raise RuntimeError('installed-app-changed; retained for inspection')
                        data = subprocess.check_output(['xcrun', 'simctl', 'get_app_container', UDID, expected_bundle, 'data'], text=True).strip()
                        run(['/bin/cp', '-cRp', data, str(scratch / (segment + '-app-data'))], work, seg / 'retain-app-data.log', env)
                        run(['xcrun', 'simctl', 'uninstall', UDID, expected_bundle], work, seg / 'cleanup-install.log', env)
                cleanup_call(cleanup, segment + '-installation', cleanup_install)
            require_cleanup(cleanup)
        binary_identity = {key: identity[key] for key in ('bundleId', 'nativeSha256', 'hermesSha256')}
        if app_hash(app, expected_bundle) != binary_identity: raise RuntimeError('built-app-changed')
        summary['outcome'] = ('diagnostic-completed' if diagnostic else
            'product-failure' if any(x['pass'] is False for x in summary['segments'].values()) else 'measured-review-pending')
    except BaseException as e:
        classify_failure(summary, e, stage)
        if diagnostic:
            summary['outcome'] = 'diagnostic-incomplete'; summary['setupRerunEligible'] = False
    finally:
        cleanup_call(cleanup, 'browser-server', lambda: stop(browser_server))
        if xcode_setting is not None:
            def restore_setting():
                derived_data.set_manifest_setting(xcode_setting['before'])
                put(attempt / 'xcode-setting-restored.json', {**xcode_setting, 'restored': True, 'label': source_ruling.LABEL})
            cleanup_call(cleanup, 'xcode-setting', restore_setting)
        summary['cleanupErrors'] = cleanup
        summary['cleanupComplete'] = not cleanup
        summary.update(endedAt=time.time(), operatorWallSeconds=time.time() - started,
                       operatorAttentionSeconds=None, attentionReason='not-observed-by-unattended-harness',
                       retainedScratch=str(work.parent) if work else None)
        put(attempt / 'summary.json', summary)
        put(attempt / 'REVIEW-REQUIRED.md', (source_ruling.LABEL + '\nDiagnostic review cannot admit this run.\n\n' if diagnostic else
            'Independent review remains required before any pilot acceptance.\n\n') +
            'Inspect the actual ordinary/view-once prime/cold frames and full videos; cite timestamps.\n'
            'Audit passive helper call sites and raw read-only Bob oracle against documented API.\n'
            'Inspect nested child receipts/media and recycled offscreen row identity in Release trees.\n'
            'Assess material wiring differences and repeat affected qualified negative controls with retained attempts.\n'
            'Record source hashes, reviewer, findings, actual attention time; never compute O4/overall scores.\n')
        if diagnostic:
            try: source_ruling.verify_retained(ROOT, check_work=False)
            finally: source_ruling.label_artifacts(attempt, work.parent if work else None)
        lease.close()
    print(json.dumps(summary)); return 0 if not cleanup and summary['outcome'] in ('product-failure', 'measured-review-pending', 'diagnostic-completed') else 2

if __name__ == '__main__':
    p = argparse.ArgumentParser(); p.add_argument('backend', choices=BACKENDS); p.add_argument('--repair', type=Path)
    p.add_argument('--diagnostic-audit-refused', action='store_true')
    p.add_argument('--resume-wrapper-refusal', action='store_true')
    p.add_argument('--resume-cleanup-refusal', action='store_true')
    p.add_argument('--static-work', type=Path, help='Read-only admission; no model/build/backend/simulator')
    p.add_argument('--static-scratch', type=Path, help='Projected fresh attempt directory for static admission')
    a = p.parse_args()
    if a.static_work:
        work = a.static_work.resolve(); scratch = a.static_scratch.resolve() if a.static_scratch else work.parent
        report = static_admission(a.backend, work, scratch, ROOT / 'preparation/static-projection' / a.backend)
        print(json.dumps(report, indent=2)); sys.exit(0 if report['valid'] else 2)
    sys.exit(execute(a.backend, a.repair, a.diagnostic_audit_refused, a.resume_wrapper_refusal, a.resume_cleanup_refusal))

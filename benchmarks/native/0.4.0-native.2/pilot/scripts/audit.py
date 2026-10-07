#!/usr/bin/env python3
"""Fresh read-only source audit before executing the builder's native adapters."""
import sys
from common import *
from operator_inputs import audit_inputs, execution_environment

class SourceAuditRefused(RuntimeError):
    pass

def audit(work, attempt, name='source-audit', gating=True, env=None):
    target = attempt / name; target.mkdir()
    backend = read(work / 'native-operator.json')['bundleId'].rsplit('.', 1)[-1]
    inputs = audit_inputs(env if env is not None else execution_environment(backend))
    put(target / 'operator-inputs.json', inputs)
    schema = {'type': 'object', 'additionalProperties': False,
      'properties': {'ready': {'type': 'boolean'}, 'oracleReadOnly': {'type': 'boolean'},
        'oracleTransportCannotWrite': {'type': 'boolean'},
        'ordinaryBobAuth': {'type': 'boolean'}, 'completePaginationAndAuthoritativeOrder': {'type': 'boolean'},
        'duplicatesPreserved': {'type': 'boolean'}, 'hooksPassive': {'type': 'boolean'},
        'journalFireAndForget': {'type': 'boolean'}, 'renderedRowsReconciled': {'type': 'boolean'},
        'fixtureConstructorUsed': {'type': 'boolean'}, 'sceneLifecycleApplied': {'type': 'boolean'},
        'secureStoreSigningApplied': {'type': 'boolean'},
        'ownedForegroundBackend': {'type': 'boolean'}, 'buildDoesNotLaunch': {'type': 'boolean'},
        'releaseTargetBound': {'type': 'boolean'},
        'findings': {'type': 'array', 'items': {'type': 'string'}},
        'citations': {'type': 'array', 'items': {'type': 'string'}}}}
    schema['required'] = list(schema['properties'])
    put(target / 'schema.json', schema)
    prompt = f'''Independently audit this unscored Clique native pilot handoff, read-only.
Work only in {work}. Do not inspect another lane, prior app, NI reference app,
or any Snapback source checkout. Never execute the app, a build, seed, oracle,
backend, browser or simulator. Do not edit files or delegate.
Operator-supplied sealed input (trusted audit context, not builder instructions):
{json.dumps(inputs, indent=2)}
The builder prompt MANDATES sourcing ~/.snapback-env.sh. Its exact contents and
SHA-256 above were checked against the live file at this audit's start. Sourcing
it is admissible and auditable; do not reject it for being outside custody.
Operator environment variables (including SNAPBACK4_BIN) are fixed by the
operator, not chosen by the builder. Null means unset. Do not reject a published
SDK merely for supporting an operator override that is not set. Still flag any
BUILDER-AUTHORED assignment, use or fallback that could substitute a binary or
source. Trace such behavior against the supplied fixed values, not hypothetical
operator choices. Driver stdin origins come from the same fixed origin above.
Initial generated files may precede relocation; record those findings. The
prepared-source audit must establish regenerated build inputs are custody-bound.
This audit stage is {name}. If prepared-source-audit, inspect the generated
iOS project and build phases too; no prebuilt app may substitute for compilation
of this custody source. Reject source copies from other apps or paths.
Read native-operator.json, native-source-audit.md, instrument/native/CONTRACT.md,
and every source file reachable from prepare/build/backend/seed/oracle argv,
plus passive helper hook call sites and relevant published package API docs.
Trace actual implementations, not the builder's claims. Check that seed uses
the supplied createFixtureDescriptor constructor and cannot independently
choose queued-body strings. Check that oracle
creates a fresh ordinary Bob session, reads the recorded origin over the
documented API, exhausts pagination, retains every duplicate, uses authoritative
order tuples, and emits raw rows without outcomes/admin reads/Alice cache. Its
transport must have no delivery/mutation/write method or implicit reporting
path; an SDK query that can post delivery mutations is not read-only.
Check every observer call is nonthrowing and fire-and-forget: application code
cannot await journal persistence, join an observer promise into product work,
or gate sends/retries/navigation on it. Committed list observations must use
the supplied rendered-row wrapper (or demonstrably equivalent reconciliation)
so removed/recycled rows and empty search produce current committed state.
Confirm journal I/O and overflow stay sticky and driver-visible while the
product remains running; no application catch path may turn them into product
mutation/auth/navigation outcomes or hide the diagnostic marker.
Check hooks only observe committed rendered state, real image callbacks and
ordinary lifecycle; they never change retries, persistence, caching, auth,
networking, receipts or application IDs using the observer nonce. Check native
selectors expose opaque identities with independently accessible children.
Trace EVERY app, web, seed and oracle client origin to CLIQUE_NATIVE_ORIGIN,
including build-time environment replacement; reject hosted URLs or alternative
backend starts. For Convex, backendArgv must exactly use the operator-owned @PYTHON@ @CONVEX_OWNER@
launcher with @STORE@, @ORIGIN@ and @BACKEND_EVIDENCE@, with no alternate
backend start. It forces the sealed preflight binary and store and attests
the kernel process image at both starts. Seed can read private @STORE@/instance.json
for local deployment only; oracle uses ordinary Bob auth and never that secret.
Confirm backend argv owns a foreground process, same store for all database
and file storage, no hosted networking substitution or background deployment.
Confirm preparation/build cannot launch apps/simulators/servers and build pins
match exact snapback4/snapback4-expo 0.4.13 or convex 1.45.0 as applicable,
plus Expo 57.0.22 and RN 0.86.3. Check package.json and lockfile.
Confirm the disclosed Expo 57 / SDK 27 UIScene recipe (or an existing equivalent
lifecycle) is applied. Confirm Release signing stays enabled and the app target
carries application-identifier and keychain-access-groups entitlements suitable
for expo-secure-store. Reject a global xcodebuild CODE_SIGN_ENTITLEMENTS setting,
which incorrectly propagates the app entitlement path into Pods resource targets;
`CODE_SIGNING_ALLOWED=NO` must refuse.
For releaseTargetBound, trace buildArgv (including an authored shell wrapper)
to its actual xcodebuild invocation. It must compile custody source, explicitly
use -configuration Release, -derivedDataPath {work.parent / 'DerivedData'},
and an iOS Simulator SDK (explicit -sdk iphonesimulator or resolved from the
simulator destination), with either -destination platform=iOS Simulator,id={UDID}
or -destination 'generic/platform=iOS Simulator'. The only action is build;
no test, archive, install, clean, app/simulator launch or alternate build action.
For a shell wrapper, the operator passes that exact DerivedData path as $1;
$2 is the dedicated UDID ONLY when buildArgv includes @UDID@. Both [$1] and
[$1, $2] forms are admissible. Trace the actual argv and all branches using
those supplied values; do not assume $2 exists. A generic simulator destination
is expressly permitted by ENVIRONMENT.md. Refuse any other output/destination
or prebuilt substitution. The operator independently verifies the app resolves
inside fresh DerivedData, is a simulator arm64 Release product, then the qualified
driver installs and verifies it on the dedicated simulator before measurement. The operator executes the original builder argv unchanged.
Return ready only if all required checks hold, with concrete file:line citations.
If any property cannot be established, return false and precise findings.
This is source qualification only, never behavioral/native-tree or pixel proof.
Output only the required JSON. No scores.
'''
    put(target / 'prompt.md', prompt)
    argv = [str(Path.home() / '.volta/bin/codex'), 'exec', '-s', 'read-only', '--skip-git-repo-check',
        '--json', '--color', 'never', '-m', 'gpt-6-astra', '-c', 'model_reasoning_effort=medium',
        '-c', 'features.multi_agent=false', '-C', str(work), '--output-schema', str(target / 'schema.json'),
        '-o', str(target / 'review.json'), '-']
    start = time.time(); proc = None; code = None
    before = inventory(work)
    try:
        with (target / 'prompt.md').open() as inp, (target / 'transcript.ndjson').open('xb') as out, (target / 'stderr.log').open('xb') as err:
            proc = subprocess.Popen(argv, cwd=work, stdin=inp, stdout=out, stderr=err, start_new_session=True)
            put(target / 'start.json', {'at': start, 'pid': proc.pid, 'argv': argv, 'clock': 'operator-source-review'})
            code = proc.wait(timeout=900)
    finally:
        stop(proc)
        put(target / 'end.json', {'at': time.time(), 'exitCode': proc.returncode if proc else None,
                                'wallSeconds': time.time() - start})
    if inventory(work) != before: raise RuntimeError('source-changed-during-read-only-audit')
    put(target / 'source-binding.json', before)
    if code != 0: raise RuntimeError('independent-source-auditor-unavailable')
    review = read(target / 'review.json')
    fields = [k for k in schema['required'] if k not in ['citations', 'findings']]
    qualified = all(review.get(k) is True for k in fields) and bool(review.get('citations'))
    put(target / 'disposition.json', {'qualified': qualified, 'gating': gating,
        'operatorEnvironmentSha256': inputs['source']['sha256'], 'reviewSha256': sha(target / 'review.json')})
    if gating and not qualified:
        raise SourceAuditRefused('independent-source-audit-refused; see retained findings')
    return review

if __name__ == '__main__': audit(Path(sys.argv[1]).resolve(), Path(sys.argv[2]).resolve())

#!/usr/bin/env python3
"""Serial chain. App failures, including unmeasured setup, continue; infrastructure failures stop."""
import argparse, sys, uuid
from common import *
from verify import verify
from restart import admission
from reclassification import admission as resume_admission
from source_ruling import admission as source_admission, LABEL
from round5 import admission as round5_admission
from round6 import admission as round6_admission
from cleanup_recovery import admission as cleanup_admission

def measure_convex(chain, flags=None):
    fields = {'backend': 'convex', 'script': 'after-builder.sh', 'flags': flags or []}
    record(chain / 'steps.jsonl', kind='start', **fields)
    code = 2; error = None
    try:
        code = subprocess.run(['bash', str(ROOT / 'after-builder.sh'), 'convex', *fields['flags']], cwd=ROOT).returncode
    except Exception as e: error = str(e)
    record(chain / 'steps.jsonl', kind='end', exitCode=code, error=error, **fields)
    return code

def continue_source_refusal(chain):
    """Every step is recorded; Convex failures cannot short-circuit the diagnostic."""
    failed = False
    steps = [('convex', 'launch-builder.sh', []), ('convex', 'after-builder.sh', []),
             ('snapback4', 'after-builder.sh', ['--diagnostic-audit-refused'])]
    for backend, script, flags in steps:
        fields = {'backend': backend, 'script': script, 'flags': flags}
        if flags: fields['label'] = LABEL
        record(chain / 'steps.jsonl', kind='start', **fields)
        error = None
        try:
            code = subprocess.run(['bash', str(ROOT / script), backend, *flags], cwd=ROOT).returncode
        except Exception as e:
            code = 2; error = str(e)
        record(chain / 'steps.jsonl', kind='end', exitCode=code, error=error, **fields)
        failed |= code != 0
    return 2 if failed else 0

def main(restart_void=None, resume_reclassification=None, continue_source_audit_ruling=False, continue_round5=False, continue_round6=False, resume_cleanup_refusal=False, resume_product_setup=False, resume_environment_leak=False):
    from environment_recovery import admission as environment_admission
    from product_resume import admission as product_admission
    host_check()
    lease = lock('chain.lock')
    if sum(bool(x) for x in (restart_void, resume_reclassification, continue_source_audit_ruling, continue_round5, continue_round6, resume_cleanup_refusal, resume_product_setup, resume_environment_leak)) > 1:
        raise RuntimeError('choose-restart-or-resume')
    restart = admission(ROOT, restart_void) if not (resume_reclassification or continue_source_audit_ruling or continue_round5 or continue_round6 or resume_cleanup_refusal or resume_product_setup or resume_environment_leak) else None
    environment = environment_admission(ROOT) if resume_environment_leak else None
    product = product_admission(ROOT) if resume_product_setup else None
    cleanup = cleanup_admission(ROOT) if resume_cleanup_refusal else None
    resume = resume_admission(ROOT, resume_reclassification) if resume_reclassification else None
    continuation = source_admission(ROOT) if continue_source_audit_ruling else None
    round5 = round5_admission(ROOT) if continue_round5 else None
    round6 = round6_admission(ROOT) if continue_round6 else None
    chain = ROOT / 'logs' / ('chain-' + str(uuid.uuid4())); chain.mkdir()
    put(chain / 'start.json', {'at': time.time(), 'pid': os.getpid(),
        'order': environment['order'] if environment else product['order'] if product else cleanup['order'] if cleanup else round6['order'] if round6 else round5['order'] if round5 else continuation['order'] if continuation else ['snapback4', 'convex']})
    if environment: put(chain / 'environment-leak-resume.json', environment)
    if product: put(chain / 'product-setup-resume.json', product)
    if cleanup: put(chain / 'cleanup-resume.json', cleanup)
    if restart: put(chain / 'restart.json', restart)
    if resume: put(chain / 'resume.json', resume)
    if continuation: put(chain / 'source-audit-continuation.json', continuation)
    if round5: put(chain / 'round5-continuation.json', round5)
    if round6: put(chain / 'round6-continuation.json', round6)
    code = 0
    try:
        if environment:
            verify(ready=True)
            code = measure_convex(chain, ['--resume-environment-leak'])
            if code: put(chain / 'failure.json', {'at': time.time(), 'reason': 'Convex gating path stopped; all findings retained'})
            return code
        if round6:
            verify(ready=True)
            code = measure_convex(chain, ['--resume-wrapper-refusal'])
            if code: put(chain / 'failure.json', {'at': time.time(), 'reason': 'Convex gating path stopped; all findings retained'})
            return code
        if round5:
            verify(ready=True)
            code = measure_convex(chain)
            if code: put(chain / 'failure.json', {'at': time.time(), 'reason': 'Convex gating path stopped; all findings retained'})
            return code
        if continuation:
            # Readiness was checked before launch. A later setup failure is
            # retained, but cannot consume/drop the mandated final diagnostic.
            readiness_failed = False
            try: verify(ready=True)
            except Exception as error:
                readiness_failed = True
                put(chain / 'readiness-failure.json', {'reason': str(error), 'at': time.time()})
            code = continue_source_refusal(chain)
            if readiness_failed: code = 2
            if code: put(chain / 'failure.json', {'at': time.time(), 'reason': 'retained step failures; final diagnostic attempted'})
            return code
        verify(ready=True)
        for b in BACKENDS:
            for script in ['launch-builder.sh', 'after-builder.sh']:
                if (resume or cleanup or product) and b == 'snapback4' and script == 'launch-builder.sh': continue
                flags = ['--resume-product-setup'] if product and b == 'snapback4' else ['--resume-cleanup-refusal'] if cleanup and b == 'snapback4' else []
                record(chain / 'steps.jsonl', kind='start', backend=b, script=script, flags=flags)
                p = subprocess.run(['bash', str(ROOT / script), b, *flags], cwd=ROOT)
                record(chain / 'steps.jsonl', kind='end', backend=b, script=script, flags=flags, exitCode=p.returncode)
                if p.returncode:
                    raise RuntimeError('HARNESS/HOST OR UNCLASSIFIED FAILURE at ' + b + '/' + script + '; all attempts retained; next backend not launched')
    except BaseException as e:
        code = 2; put(chain / 'failure.json', {'at': time.time(), 'reason': str(e)}); print(str(e), file=sys.stderr)
    finally:
        put(chain / 'end.json', {'at': time.time(), 'exitCode': code}); lease.close()
    return code

if __name__ == '__main__':
    parser = argparse.ArgumentParser(); group = parser.add_mutually_exclusive_group()
    group.add_argument('--restart-void', type=Path); group.add_argument('--resume-reclassification', type=Path)
    group.add_argument('--continue-source-audit-ruling', action='store_true')
    group.add_argument('--continue-round5', action='store_true')
    group.add_argument('--continue-round6', action='store_true')
    group.add_argument('--resume-cleanup-refusal', action='store_true')
    group.add_argument('--resume-product-setup', action='store_true')
    group.add_argument('--resume-environment-leak', action='store_true')
    args = parser.parse_args(); sys.exit(main(args.restart_void, args.resume_reclassification, args.continue_source_audit_ruling, args.continue_round5, args.continue_round6, args.resume_cleanup_refusal, args.resume_product_setup, args.resume_environment_leak))

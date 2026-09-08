"""Metadata-only launcher for the exact reviewed one-shot activation."""
import json, os, selectors, subprocess, sys, time
from pathlib import Path
BASE = Path('/Users/ccheever/clique-improvement/revisions/cli-018-publication-preparation-r1')
HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(BASE))
from control import safe_event
assert json.loads((HERE / 'stage-result.json').read_text())['stagePassed']
os.umask(0o077)
argv = ['/usr/bin/python3', '-B', str(BASE / 'office.py'), '--activate-reviewed-production-018', '2fa6edaf3f1edbf89f1b69564425c0c0eaf208e790a805cfee1ba9dfbc611e59']
start = time.time()
clock = time.monotonic()
# Exclusive receipt precedes activation; no replay path.
with open(HERE / 'activation-intent.json', 'x') as f:
    json.dump({'argv': argv, 'startedEpoch': start, 'driverPid': os.getpid(), 'attempts': 1,
               'environmentCapture': 'none', 'publisherSeconds': 1800, 'consumerSeconds': 30,
               'fetchMilliseconds': 15000, 'fetchRetries': 0, 'sshEnvelopeSeconds': 2100}, f, indent=2)
child = subprocess.Popen(argv, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE, stderr=subprocess.PIPE,
                         close_fds=True, start_new_session=True)
with open(HERE / 'activation-running.json', 'x') as f:
    json.dump({'pid': child.pid, 'driverPid': os.getpid(), 'startedEpoch': start, 'argv': argv}, f, indent=2)
print(json.dumps({'activationPid': child.pid, 'driverPid': os.getpid(), 'phase': 'activation-started', 'epoch': start}), flush=True)
sel = selectors.DefaultSelector()
for stream, tag in [(child.stdout, 'metadata'), (child.stderr, 'stderr')]:
    os.set_blocking(stream.fileno(), False)
    sel.register(stream, selectors.EVENT_READ, tag)
buf = bytearray()
unclassified = False
stderr_present = False
count = 0
with open(HERE / 'activation-events.jsonl', 'x') as out:
    while sel.get_map():
        for key, _ in sel.select(1):
            data = os.read(key.fd, 65536)
            if not data:
                sel.unregister(key.fileobj)
                continue
            if key.data == 'stderr':
                stderr_present = True
                continue  # Never persist, hash, or print arbitrary stderr.
            buf.extend(data)
            while b'\n' in buf:
                line, _, rest = buf.partition(b'\n')
                buf[:] = rest
                try:
                    event = safe_event(json.loads(line))
                except BaseException:
                    unclassified = True
                    continue
                out.write(json.dumps(event, separators=(',', ':')) + '\n')
                out.flush()
                count += 1
                if event['phase'] != 'cleanup' or event['status'] != 'observed':
                    print(json.dumps(event, separators=(',', ':')), flush=True)
            if len(buf) > 65536:
                unclassified = True
                buf.clear()
    out.flush()
    os.fsync(out.fileno())
sel.close()
code = child.wait()
child.stdout.close()
child.stderr.close()
result = {'pid': child.pid, 'driverPid': os.getpid(), 'startedEpoch': start, 'endedEpoch': time.time(),
          'elapsedSeconds': time.monotonic() - clock, 'exitCode': code, 'metadataEvents': count,
          'unclassifiedOutputPresent': unclassified or bool(buf), 'stderrPresent': stderr_present,
          'rawOutputPersisted': False, 'localActivationReaped': True, 'automaticRetry': False,
          'remoteOutcomeSource': 'explicit reviewed helper metadata only; no inference from local exit'}
with open(HERE / 'activation-result.json', 'x') as f:
    json.dump(result, f, indent=2)
print(json.dumps(result), flush=True)
sys.exit(code if code else (1 if unclassified or buf or stderr_present else 0))

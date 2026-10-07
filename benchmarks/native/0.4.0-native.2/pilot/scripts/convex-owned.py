#!/usr/bin/env python3
"""Operator-owned foreground Convex; fixed binary, local ports and segment store.

The driver remains unchanged. This wrapper keeps secrets off its recorded argv,
records the live child image on BOTH starts, and shares the driver's process group.
"""
import ctypes, secrets, sys
from urllib.parse import urlparse
from common import *

def image_path(pid):
    lib = ctypes.CDLL('/usr/lib/libproc.dylib'); buf = ctypes.create_string_buffer(4096)
    count = lib.proc_pidpath(pid, buf, len(buf))
    if count <= 0: raise RuntimeError('convex-process-image-unavailable')
    return Path(buf.value.decode()).resolve()

def launch(store, origin, evidence):
    host_check()
    store = Path(store).resolve(); evidence = Path(evidence).resolve()
    parsed = urlparse(origin)
    if parsed.scheme != 'http' or parsed.hostname != '127.0.0.1' or parsed.port != PORTS['convex'][0]:
        raise RuntimeError('convex-origin-must-be-assigned-loopback')
    binary = ROOT / 'inputs/convex/convex-local-backend'
    expected = read(ROOT / 'metadata/convex-preflight.json')['backendSha256']
    if binary.is_symlink() or sha(binary) != expected: raise RuntimeError('convex-binary-drift')
    private = store / 'instance.json'
    if not private.exists():
        fd = os.open(private, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as f:
            json.dump({'name': 'clique-p2a-native', 'secret': secrets.token_hex(32)}, f)
    instance = read(private)
    argv = [str(binary), '--interface', '127.0.0.1', '--port', str(parsed.port),
            '--site-proxy-port', str(parsed.port + 1), '--instance-name', instance['name'],
            '--instance-secret', instance['secret'], '--local-storage', str(store / 'files'),
            '--disable-beacon', str(store / 'data.sqlite3')]
    proc = None
    def interrupted(signum, frame): raise KeyboardInterrupt('owned-backend-stop')
    signal.signal(signal.SIGTERM, interrupted); signal.signal(signal.SIGINT, interrupted)
    try:
        proc = subprocess.Popen(argv, cwd=store, stdin=subprocess.DEVNULL)
        # Popen's exec handshake completes before it returns; inspect kernel image.
        actual = image_path(proc.pid)
        if actual != binary.resolve() or sha(actual) != expected: raise RuntimeError('convex-live-image-mismatch')
        record(evidence, kind='backend-image', pid=proc.pid, pgid=os.getpgid(proc.pid),
               binary=str(actual), sha256=expected, store=str(store), origin=origin,
               sqlite=str(store / 'data.sqlite3'), localStorage=str(store / 'files'))
        return proc.wait()
    except KeyboardInterrupt: return 0
    finally:
        if proc is not None:
            if proc.poll() is None:
                proc.terminate()
                try: proc.wait(timeout=10)
                except subprocess.TimeoutExpired: proc.kill(); proc.wait(timeout=5)
            record(evidence, kind='backend-exit', pid=proc.pid, exitCode=proc.returncode)

if __name__ == '__main__': sys.exit(launch(*sys.argv[1:]))

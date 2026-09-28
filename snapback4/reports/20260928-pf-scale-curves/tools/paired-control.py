"""Adjacent baseline/fixed repeats on the existing COPIES, after other work drains."""
import gzip, json, os, pathlib, socket, subprocess, time
root = pathlib.Path.cwd()
base = root / os.environ.get('PF_ROOT', 'target/pf')
script = pathlib.Path(__file__).resolve().parent / 'curve.mjs'
out = script.parent.parent / 'evidence'
for version in ['before', 'after']:
    children = []
    tag = 'control-' + version
    binary = base / ('snapback4-' + version)
    try:
        for stage, port in [('10pct', 49462), ('50pct', 49463), ('full', 49460)]:
            with (base / f'{tag}-{stage}.log').open('wb') as log:
                child = subprocess.Popen([str(binary), 'dev', '--port', str(port), '--replay', '--no-watch'],
                    cwd=base/stage, stdin=subprocess.DEVNULL, stdout=log, stderr=subprocess.STDOUT)
            children.append(child)
            for _ in range(100):
                if child.poll() is not None:
                    raise RuntimeError(f'{stage} failed; see {tag}-{stage}.log')
                try:
                    with socket.create_connection(('127.0.0.1', port), .1):
                        break
                except OSError:
                    time.sleep(.1)
            else:
                raise RuntimeError(f'{stage} did not listen')
        env = dict(os.environ, PF_ROOT=str(base), PF_BIN=str(binary))
        subprocess.run(['node', str(script), tag], env=env, check=True)
        with gzip.GzipFile(filename=str(out / f'{tag}-curve.json.gz'), mode='wb', mtime=0) as f:
            f.write((base / f'{tag}-curve.json').read_bytes())
    finally:
        # These are this process's own children, never a port/name-based kill.
        for child in children:
            if child.poll() is None:
                child.terminate()
        for child in children:
            child.wait(timeout=10)

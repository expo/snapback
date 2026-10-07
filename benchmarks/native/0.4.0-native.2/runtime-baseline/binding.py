"""Authoritative source sets for the compiled runtime app and its proof."""
import hashlib
from pathlib import Path

HERE = Path(__file__).resolve().parent
NATIVE = HERE.parent

def sha(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as source:
        for block in iter(lambda: source.read(1024 * 1024), b''):
            digest.update(block)
    return digest.hexdigest()

def files(root):
    root = Path(root)
    return {str(path.relative_to(NATIVE)): sha(path) for path in sorted(root.rglob('*'))
            if path.is_file() and '__pycache__' not in path.parts and 'node_modules' not in path.parts}

def compiled_inputs():
    names = [
        'runtime-baseline/App.tsx',
        'runtime-baseline/scene-plugin.cjs',
        'runtime-baseline/simulator.entitlements',
        'runtime-baseline/prepare.sh',
        'runtime-baseline/configure-signing.rb',
    ]
    result = {name: sha(NATIVE / name) for name in names}
    for root in [NATIVE / 'helper', NATIVE / 'ui']:
        result.update(files(root))
    return result

def expected_proof_inputs():
    result = compiled_inputs()
    for path in [HERE / 'prove.py', HERE / 'bind-inputs.py', HERE / 'binding.py']:
        result[str(path.relative_to(NATIVE))] = sha(path)
    result.update(files(NATIVE / 'driver'))
    return dict(sorted(result.items()))

def inventory_digest(values):
    lines = ''.join(f'{digest}  {name}\n' for name, digest in sorted(values.items()))
    return hashlib.sha256(lines.encode()).hexdigest()

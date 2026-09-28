"""Run one-at-a-time source mutations, always restoring the original bytes.
Run from snapback4/. No product edit survives this script.
"""
import pathlib, subprocess, os
root = pathlib.Path.cwd()
out = root / 'reports/20260928-fu-fresh-replay-uploads/round1'

def run(name, command, env=None):
    with (out / (name + '.log')).open('w') as log:
        result = subprocess.run(command, cwd=root, stdout=log, stderr=subprocess.STDOUT, env={**os.environ, **(env or {})})
        log.write(f'\nEXIT={result.returncode}\n')
    return result.returncode

def mutation(path, before, after, body):
    path = root / path
    original = path.read_bytes()
    text = original.decode()
    assert text.count(before) == 1, before
    try:
        path.write_text(text.replace(before, after))
        body()
    finally:
        path.write_bytes(original)

def worker():
    assert run('worker-pools-before', ['cargo', 'test', '-p', 'snapback4', '--bin', 'snapback4', 'serve::tests::overload_tests']) != 0
path = root / 'crates/snapback4/src/serve.rs'
text = path.read_text(); start = text.index('    let Some(permit) = admission.acquire(class) else {'); end = text.index('    if let Err(error) = std::thread::Builder', start)
mutation('crates/snapback4/src/serve.rs', text[start:end], '    let Some(permit) = admission.acquire(class) else { request.abort(); return; };\n', worker)

def counter():
    assert run('counters-mutant', ['cargo', 'test', '--manifest-path', 'vendor/tiny_http/Cargo.toml', '--lib', 'limits::tests']) != 0
mutation('vendor/tiny_http/src/limits.rs', '        self.record(tls, written);', '        if false { self.record(tls, written); }', counter)

def retryable():
    assert run('retryable-mutant-build', ['cargo', 'build', '-p', 'snapback4']) == 0
    assert run('retryable-mutant', ['node', '--test', '--test-name-pattern=fresh replay host', 'packages/snapback4/test/upload-retry.test.mjs']) != 0
mutation('vendor/tiny_http/src/limits.rs', '"retryable":true', '"retryable":false', retryable)
assert run('debug-final-build', ['cargo', 'build', '-p', 'snapback4']) == 0
assert run('retryable-control', ['node', '--test', '--test-name-pattern=fresh replay host', 'packages/snapback4/test/upload-retry.test.mjs']) == 0
print('All three mutations failed as expected; source restored; positive upload control passed.')

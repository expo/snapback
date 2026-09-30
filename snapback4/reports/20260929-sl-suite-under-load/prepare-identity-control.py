"""Prepare the original early-refusal control and the preloaded-input candidate.

This writes only ignored target/sl-load files. It does not change test sources.
The controller applies a candidate only between completed suite runs.
"""
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
base = '38abb89b8e0b206644b9e2619c6f2d159a981d23'
path = 'crates/snapback4/tests/run_admission/identity.rs'
original = subprocess.check_output(['git', 'show', f'{base}:snapback4/{path}'], cwd=root, text=True)
old = '''    let mut child = Command::new(BIN).args(["device", p.store().to_str().unwrap(), backend.to_str().unwrap()])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    child.stdin.take().unwrap().write_all(b"{\\"op\\":\\"clear_rows\\"}\\n").unwrap();
    let out = child.wait_with_output().unwrap();'''
assert original.count(old) == 1
candidate = '''    // @ref LLP 3000#publication-suite-under-contention — queue input before a child can refuse startup.
    // Ownership refusal may close stdin before this parent runs again. Make
    // clear_rows available from launch, preserving the attempted destructive
    // command while testing the refusal and unchanged store below.
    let request = p.0.join("clear-rows.jsonl");
    fs::write(&request, b"{\\"op\\":\\"clear_rows\\"}\\n").unwrap();
    let out = Command::new(BIN).args(["device", p.store().to_str().unwrap(), backend.to_str().unwrap()])
        .stdin(fs::File::open(request).unwrap()).output().unwrap();'''
control = '''    let mut child = Command::new(BIN).args(["device", p.store().to_str().unwrap(), backend.to_str().unwrap()])
        .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped()).spawn().unwrap();
    // Diagnostic control: force the observed child-before-parent ordering.
    wait(|| child.try_wait().unwrap().is_some());
    let sent = child.stdin.take().unwrap().write_all(b"{\\"op\\":\\"clear_rows\\"}\\n");
    let out = child.wait_with_output().unwrap();
    eprintln!("CONTROL early child exit: status={:?}; stderr={}", out.status.code(), String::from_utf8_lossy(&out.stderr));
    sent.unwrap();'''
manifest = {'path': path, 'before_sha256': hashlib.sha256(original.encode()).hexdigest()}
(root / 'target/sl-load').mkdir(parents=True, exist_ok=True)
for name, body in [('control', original.replace(old, control)),
                   ('candidate', original.replace(old, candidate).replace('io::{BufRead, BufReader, Write}', 'io::{BufRead, BufReader}'))]:
    output = root / f'target/sl-load/identity-{name}.rs'
    output.write_text(body)
    manifest[name] = str(output.relative_to(root))
    manifest[name + '_sha256'] = hashlib.sha256(output.read_bytes()).hexdigest()
(root / 'target/sl-load/identity-candidate.json').write_text(json.dumps(manifest, indent=2) + '\n')
print(json.dumps(manifest))

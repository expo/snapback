#!/usr/bin/env python3
"""Compile the exact before/after evidence modules with a minimal host.

Response producer only: parse, request scope, record construction, watermark,
bounded try_send. A drain thread replaces file/stderr I/O, which the HTTP burst
measures separately. No production source instrumentation or copied algorithm.
Run from snapback4: python3 reports/.../response-cost.py
"""
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

root = Path.cwd().resolve()
report = Path(__file__).resolve().parent
base = '4fd338de59407ab6b7cc7009e27001c877cacfe9'
probe = r'''
pub(crate) fn measure() {
    let count = 55210;
    let (sender, receiver) = mpsc::sync_channel::<Value>(LIMIT);
    let drain = std::thread::spawn(move || receiver.into_iter().count());
    let path = std::env::temp_dir().join(format!("dx-watermark-{}", std::process::id()));
    let mut recent = Recent::default();
    recent.watermark = Some(Arc::new(watermark::Watermark::create(&path).unwrap()));
    recent.sender = Some(sender);
    let shared = crate::serve::Shared { personas: true, refusals: recent };
    let bodies: [&[u8]; 3] = [br#"{"data":[],"complete":true,"fresh":true}"#,
        br#"{"data":null,"complete":true,"fresh":true}"#,
        br#"{"data":{"outer":{"row":null}},"complete":true,"fresh":true}"#];
    let mut durations = Vec::new();
    let mut created = 0;
    for _ in 0..7 {
        let start = std::time::Instant::now();
        for i in 0..count {
            let _scope = response::begin(&shared, "/q/empty");
            let record = std::hint::black_box(response::response(bodies[i % 3]));
            created += usize::from(record.is_some());
            drop(record);
        }
        durations.push(start.elapsed().as_nanos() as u64);
    }
    let latest = shared.refusals.watermark.as_ref().unwrap().load();
    let dropped = shared.refusals.dropped.load(Ordering::Relaxed);
    drop(shared);
    let accepted = drain.join().unwrap();
    std::fs::remove_file(path).unwrap();
    println!("{}", json!({"requests_per_round":count,"round_ns":durations,
        "records_created":created,"accepted":accepted,"dropped":dropped,"watermark":latest}));
}
'''
writer_probe = r'''
pub(crate) fn measure_writer() {
    let count = 55210;
    let directory = std::env::temp_dir().join(format!("dx-writer-cost-{}", std::process::id()));
    fs::create_dir_all(&directory).unwrap();
    let identity = json!({"storeId":"store", "instance":"instance", "pid":std::process::id(),
        "address":"127.0.0.1:4400", "startedAt":1790657000000_i64});
    let record = json!({"operation":"messaging.typingIn", "code":"EMPTY_READ", "requestId":1,
        "generation":1, "clause":"cause not instrumented", "at":1790657000000_i64, "responseSequence":1});
    let mut buffer = Vec::with_capacity(1024);
    let start = std::time::Instant::now();
    for _ in 0..count {
        buffer.clear(); old_line(&record, &identity, &mut buffer);
        std::hint::black_box(&buffer);
    }
    let format_ns = start.elapsed().as_nanos();
    let line_bytes = buffer.len();
    let mut file = File::create(directory.join("console")).unwrap();
    let start = std::time::Instant::now();
    for _ in 0..count { old_line(&record, &identity, &mut file); }
    let console_ns = start.elapsed().as_nanos();
    let mut records = VecDeque::new();
    let start = std::time::Instant::now();
    for n in 0..count {
        let mut record = record.clone();
        record["requestId"] = json!(n+1); record["responseSequence"] = json!(n+1);
        records.push_back(record);
        if records.len() > LIMIT { records.pop_front(); }
        save(&directory.join("records.json"), &identity, &records, 0).unwrap();
    }
    let store_ns = start.elapsed().as_nanos();
    println!("{}", json!({"count":count,"console_format_ns":format_ns,
        "console_format_and_file_io_ns":console_ns,"console_bytes":line_bytes*count,
        "store_ring_clone_serialize_replace_ns":store_ns,
        "final_store_bytes":fs::metadata(directory.join("records.json")).unwrap().len()}));
    fs::remove_dir_all(directory).unwrap();
}
'''
results = {}
with tempfile.TemporaryDirectory(prefix='sb4-dx-response-cost-') as tmp:
    project = Path(tmp)
    # Match the workspace's ordinary dev profile and pinned dependency graph.
    (project / 'Cargo.toml').write_text(f'''[package]
name = "dx-response-cost"
version = "0.0.0"
edition = "2024"
[workspace]
[dependencies]
serde_json = "1"
libc = "0.2"
snapback4-core = {{ path = {json.dumps(str(root / 'crates/snapback4-core'))} }}
''')
    shutil.copy(root / 'Cargo.lock', project / 'Cargo.lock')
    (project / 'src').mkdir()
    for variant in ['before', 'after']:
        directory = project / variant
        directory.mkdir()
        hashes = {}
        for filename in ['dev_refusals.rs', 'dev_refusal_response.rs', 'dev_refusal_watermark.rs', 'dev_refusal_console.rs']:
            if variant == 'before' and filename == 'dev_refusal_console.rs':
                continue
            relative = 'snapback4/crates/snapback4/src/' + filename
            data = subprocess.check_output(['git', 'show', f'{base}:{relative}'], cwd=root) if variant == 'before' else (root.parent / relative).read_bytes()
            hashes[filename] = hashlib.sha256(data).hexdigest()
            (directory / filename).write_bytes(data)
        with (directory / 'dev_refusals.rs').open('a') as out:
            out.write(probe)
            if variant == 'before':
                old = (directory / 'dev_refusals.rs').read_text()
                start = old.index('                let r = &record;')
                end = old.index('\n            }', start)
                body = old[start:end].replace('std::io::stderr().lock()', 'sink')
                out.write('\nfn old_line(record: &Value, identity: &Value, sink: &mut impl Write) {\n' + body + '\n}\n')
                out.write(writer_probe)
        (project / 'src/main.rs').write_text(f'''#![allow(dead_code)]
mod serve {{
    pub struct Shared {{ pub personas: bool, pub refusals: dev_refusals::Recent }}
    #[path = {json.dumps(str(directory / 'dev_refusals.rs'))}]
    pub mod dev_refusals;
}}
fn main() {{ serve::dev_refusals::measure(); {"serve::dev_refusals::measure_writer();" if variant == "before" else ""} }}
''')
        env = dict(os.environ, CARGO_TARGET_DIR=str(root / 'target'))
        with (report / f'response-cost-{variant}-build.log').open('w') as log:
            subprocess.run(['cargo', 'build', '--offline', '--manifest-path', str(project / 'Cargo.toml')], env=env, stdout=log, stderr=subprocess.STDOUT, check=True)
        samples = subprocess.check_output([root / 'target/debug/dx-response-cost']).decode().splitlines()
        results[variant] = json.loads(samples[0])
        if len(samples) > 1: results[variant]['writer'] = json.loads(samples[1])
        results[variant]['source_sha256'] = hashes
(report / 'response-cost.json').write_text(json.dumps(results, indent=2) + '\n')
print(json.dumps(results))

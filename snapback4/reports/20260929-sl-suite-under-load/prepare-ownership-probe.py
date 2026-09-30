"""Preserve direct ownership exclusion while SQLite is still blocked."""
import hashlib
import json
from pathlib import Path

root = Path(__file__).resolve().parents[2]
source = root / 'crates/snapback4/tests/run_admission.rs'
text = source.read_text()
probe = '''    // @ref LLP 3000.019#3.4 — the sidecar flock grants ownership; the address hint does not.
    let sidecar = fs::File::open(snapback4_core::private_fs::owner_path(&database)).unwrap();
    let held = sidecar.try_lock();
    assert!(matches!(held, Err(fs::TryLockError::WouldBlock)), "ownership must already exclude another writer while SQLite is blocked: {held:?}");
    drop(sidecar);
'''
assert text.count(probe) <= 1
before = text.replace(probe, '')
needle = '''        fs::metadata(&lock).is_ok_and(|metadata| metadata.len() == 0)
    });
    conn.execute_batch("ROLLBACK").unwrap();'''
assert before.count(needle) == 1
candidate = before.replace(needle, needle.replace('    conn.execute_batch', probe + '    conn.execute_batch'))
record = {'source': str(source.relative_to(root)), 'files': {}}
for name, content in [('before', before), ('candidate', candidate)]:
    path = root / f'target/sl-load/ownership-probe-{name}.rs'
    path.write_text(content)
    record['files'][name] = {'path': str(path.relative_to(root)), 'sha256': hashlib.sha256(content.encode()).hexdigest()}
Path(__file__).with_name('ownership-probe-source.json').write_text(json.dumps(record, indent=2) + '\n')
print('Prepared direct pre-SQLite sidecar assertion; running suite source unchanged.')

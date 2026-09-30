"""Prepare the observed stderr-order control without editing suite source."""
import hashlib
import json
from pathlib import Path
import subprocess

root = Path(__file__).resolve().parents[2]
relative = "crates/snapback4/tests/check.rs"
base = "38abb89b8e0b206644b9e2619c6f2d159a981d23"
original = subprocess.check_output(["git", "show", f"{base}:snapback4/{relative}"], cwd=root).decode()
old = '    let reason: String = serde_json::from_str(text.split_once("reason=").unwrap().1.trim()).unwrap();'
assert original.count(old) == 1
new = '''    // @ref LLP 3000#publication-suite-under-contention — diagnostic order is not an exit-record boundary.
    // The bounded host writer can drain after the direct lifecycle write.
    let exits: Vec<_> = text.lines().filter(|line| line.starts_with("SNAPBACK4_EXIT ")).collect();
    assert_eq!(exits.len(), 1, "{text}");
    let encoded = exits[0].strip_prefix("SNAPBACK4_EXIT verb=dev generation=0 status=1 reason=").unwrap();
    let reason: String = serde_json::from_str(encoded).unwrap();'''
candidate = original.replace(old, new)


def inject(source):
    begin = source.index("fn changed_default_refuses(unique: bool)")
    end = source.index("\n#[test]", begin)
    body = source[begin:end]
    before = '    let text = String::from_utf8(dev.stderr).unwrap();'
    assert body.count(before) == 1
    after = '''    let mut text = String::from_utf8(dev.stderr).unwrap();
    // Diagnostic-only control: the observed legal line arrives after EXIT.
    text.push_str("snapback4 host: HTTP connections=128; uploads=2; file descriptors (this process): soft=1048576 hard=1048576\\n");
    println!("SL_EXIT_RECORD_CONTROL stderr={text:?}");'''
    return source[:begin] + body.replace(before, after) + source[end:]


destination = root / "target/sl-load"
versions = {"original": original, "before": inject(original), "after": inject(candidate), "candidate": candidate}
record = {"base": base, "source": relative, "files": {}}
for name, source in versions.items():
    path = destination / f"exit-record-{name}.rs"
    path.write_text(source)
    record["files"][name] = {"path": str(path.relative_to(root)), "sha256": hashlib.sha256(source.encode()).hexdigest()}
Path(__file__).with_name("exit-record-control-source.json").write_text(json.dumps(record, indent=2) + "\n")
print("Prepared original and corrected stderr-order controls; suite source unchanged.")

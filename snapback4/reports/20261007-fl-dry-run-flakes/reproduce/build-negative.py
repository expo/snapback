import pathlib, subprocess, os
p=pathlib.Path('crates/snapback4/src/verbs/witness/process_group.rs');original=p.read_text()
changed=original.replace('unsafe { libc::kill(0, libc::SIGKILL); }', 'if !Path::new("fl-disable-native-drain").exists() || Path::new("stop-compression").exists() { unsafe { libc::kill(0, libc::SIGKILL); } }').replace('unsafe { libc::kill(-(group as i32), libc::SIGKILL); }', 'if !Path::new("fl-disable-native-drain").exists() || Path::new("stop-compression").exists() { unsafe { libc::kill(-(group as i32), libc::SIGKILL); } }')
assert changed!=original
try:
    p.write_text(changed)
    with open('reports/20261007-fl-dry-run-flakes/evidence/custody-negative-build.log','w') as log:
        r=subprocess.run(['cargo','build','-p','snapback4'],env={**os.environ,'LIBSQLITE3_FLAGS':'-USQLITE_ENABLE_MEMORY_MANAGEMENT','CARGO_BUILD_JOBS':'6','CARGO_TARGET_DIR':str(pathlib.Path('target/fl-negative').resolve())},stdout=log,stderr=subprocess.STDOUT)
finally:p.write_text(original)
raise SystemExit(r.returncode)

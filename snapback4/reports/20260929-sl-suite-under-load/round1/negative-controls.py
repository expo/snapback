"""Retained SL controls. Run from snapback4 under the round-0 affinity guard.

Uses scratch sources only. The witness probe compiles the actual production
Owned/simctl/tick source and the actual fixture watchdog, without pretending
Linux can execute the Darwin CLI choreography. No production source is edited.
"""
import hashlib
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time

ROOT = Path(__file__).resolve().parents[3]
REPORT = Path(__file__).resolve().parent
records = []


def run(name, command, expected, timeout=210):
    start = time.monotonic()
    with (REPORT / f"{name}.log").open("w") as log:
        result = subprocess.run(command, cwd=ROOT, stdout=log, stderr=subprocess.STDOUT, timeout=timeout)
    record = dict(name=name, command=list(map(str, command)), exit=result.returncode,
                  elapsed_seconds=time.monotonic() - start)
    records.append(record)
    assert result.returncode == expected, record
    print(json.dumps(record), flush=True)
    return (REPORT / f"{name}.log").read_text()


def typing():
    test = ROOT / "packages/snapback4/test/typing-expiry.test.mjs"
    source = test.read_text()
    needle = '        return code.replace(needle, '
    assert source.count(needle) == 1
    # Repeatedly wake at 100 ms, preserving the callback's deadline check.
    mutation = '''        assert.equal(code.split("}, delay);").length, 2);
        code = code.replace("}, delay);", "}, 100);");
'''
    scratch = test.with_name(".sl-polling-control.mjs")
    try:
        scratch.write_text(source.replace(needle, mutation + needle))
        log = run("typing-polling-negative", ["node", "--test", "--test-reporter=tap", str(scratch)], 1, 300)
        assert log.count("expiry timers must not wake to poll before the row deadline") == 2, log
        assert "# fail 2" in log and "# cancelled 0" in log and "# skipped 0" in log
    finally:
        scratch.unlink(missing_ok=True)


def witness():
    source_path = ROOT / "crates/snapback4/src/verbs/witness.rs"
    source = source_path.read_text()
    tick = source[source.index("static INTERRUPTED:"):source.index("\nstruct Options")]
    owned = source[source.index("struct Owned(Child);"):source.index("\nfn output(")]
    deadline = '        if Instant::now() >= end { return Err(error("E_WITNESS_TIMEOUT", format!("xcrun simctl {} timed out", args.join(" ")))); }'
    assert owned.count(deadline) == 1
    helper = ROOT / "crates/snapback4/tests/fixtures/witness-watchdog.rs"
    records.append(dict(production_sha256=hashlib.sha256(source.encode()).hexdigest(),
                        watchdog_sha256=hashlib.sha256(helper.read_bytes()).hexdigest()))
    libc = max((ROOT / "target/debug/deps").glob("liblibc-*.rlib"), key=lambda p: p.stat().st_mtime)
    with tempfile.TemporaryDirectory(prefix="sl-witness-", dir=ROOT / "target") as temporary:
        folder = Path(temporary)
        for label, body in [("correct", owned), ("no-deadline", owned.replace(deadline, ""))]:
            case = folder / label
            case.mkdir()
            fake = (ROOT / "crates/snapback4/tests/fixtures/witness-simctl.py").read_text()
            fake = fake.replace("mode = os.environ['WITNESS_TEST_MODE']", "(root / 'pids.json').write_text(json.dumps(dict(simctl=os.getpid(), driver=os.getppid())))\nmode = os.environ['WITNESS_TEST_MODE']")
            (case / "xcrun").write_text(fake)
            (case / "xcrun").chmod(0o755)
            probe = '''#![allow(dead_code)]
use std::{io::Read, process::{Child, Command, ExitStatus, Stdio},
    sync::atomic::{AtomicBool, Ordering}, thread::sleep, time::{Duration, Instant}};
type Result<T> = std::result::Result<T, String>;
fn error(code: &str, detail: impl std::fmt::Display) -> String { format!("{code}: {detail}") }
#[path = "WATCHDOG"] mod watchdog;
TICK
OWNED
fn main() {
    if std::env::args().nth(1).as_deref() == Some("child") {
        unsafe { libc::signal(libc::SIGTERM, interrupt as *const () as libc::sighandler_t); }
        let result = simctl(&["list", "devices", "booted", "--json"], Duration::from_secs(120));
        let error = result.unwrap_err();
        eprintln!("{error}");
        assert!(error.contains("E_WITNESS_TIMEOUT: xcrun simctl list devices booted --json timed out"));
    } else {
        let directory = std::env::args().nth(1).unwrap();
        let mut command = Command::new(std::env::current_exe().unwrap());
        command.arg("child").env("WITNESS_TEST_DIR", &directory).env("WITNESS_TEST_MODE", "timeout-prepare")
            .env("PATH", format!("{}:{}", directory, std::env::var("PATH").unwrap()));
        let output = watchdog::Guarded::spawn(&mut command, std::path::Path::new(&directory), watchdog::PREPARATION_GUARD).finish();
        eprintln!("{}", String::from_utf8_lossy(&output.stderr));
        assert!(output.status.success());
    }
}
'''.replace("WATCHDOG", str(helper)).replace("TICK", tick).replace("OWNED", body)
            (case / "probe.rs").write_text(probe)
            subprocess.run(["rustc", "--edition=2024", str(case / "probe.rs"), "--extern", f"libc={libc}",
                            "-L", f"dependency={ROOT / 'target/debug/deps'}", "-o", str(case / "probe")], check=True)
            log = run(f"witness-{label}", [str(case / "probe"), str(case)], 0 if label == "correct" else 101)
            assert ("E_WITNESS_TIMEOUT" if label == "correct" else "WITNESS_FIXTURE_WATCHDOG") in log
            pids = json.loads((case / "pids.json").read_text())
            for role, pid in pids.items():
                try:
                    os.kill(pid, 0)
                except ProcessLookupError:
                    continue
                raise AssertionError(f"{role} {pid} was not reaped")
            records[-1]["reaped"] = pids
            print(f"{label}: driver and simctl reaped: {pids}", flush=True)


try:
    if sys.argv[1:] == ["typing"]:
        typing()
    elif sys.argv[1:] == ["witness"]:
        witness()
    else:
        raise SystemExit("use negative-controls.py typing|witness")
finally:
    (REPORT / f"negative-{sys.argv[-1]}.json").write_text(json.dumps(records, indent=2) + "\n")

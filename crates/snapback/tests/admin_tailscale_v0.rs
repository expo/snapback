//! Fake-tailscaled lifecycle proofs for LLP 0017 reachability ownership.

#![cfg(unix)]

use qrcode::QrCode;
use qrcode::render::unicode;
use serde_json::Value;
use std::io::{BufRead as _, BufReader, Read as _};
use std::os::unix::fs::PermissionsExt as _;
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

const DNS_NAME: &str = "node.tailnet.test";

fn snapback() -> Command {
    Command::new(env!("CARGO_BIN_EXE_snapback"))
}

struct Server {
    child: Child,
    ready_file: std::path::PathBuf,
}

impl Drop for Server {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

fn start_server(directory: &std::path::Path) -> Server {
    let ready_file = directory.join("ready.json");
    let mut child = snapback()
        .args([
            "start",
            "--port",
            "0",
            "--memory",
            "--ready-file",
            ready_file.to_str().unwrap(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Ok(bytes) = std::fs::read(&ready_file)
            && let Ok(value) = serde_json::from_slice::<Value>(&bytes)
            && value["ready"] == true
        {
            return Server { child, ready_file };
        }
        if let Some(status) = child.try_wait().unwrap() {
            let mut stderr = String::new();
            child
                .stderr
                .take()
                .unwrap()
                .read_to_string(&mut stderr)
                .unwrap();
            panic!("server exited before readiness: {status}\n{stderr}");
        }
        assert!(Instant::now() < deadline, "server readiness timeout");
        std::thread::sleep(Duration::from_millis(25));
    }
}

struct FakeTailscale {
    bin_dir: std::path::PathBuf,
    state: std::path::PathBuf,
    log: std::path::PathBuf,
    receipts: std::path::PathBuf,
}

impl FakeTailscale {
    fn install(directory: &std::path::Path) -> Self {
        let bin_dir = directory.join("fake-bin");
        std::fs::create_dir(&bin_dir).unwrap();
        let executable = bin_dir.join("tailscale");
        let state = directory.join("tailscale-state.json");
        let log = directory.join("tailscale.log");
        let receipts = directory.join("receipts");
        std::fs::write(&state, b"{}\n").unwrap();
        std::fs::write(&log, b"").unwrap();
        std::fs::write(
            &executable,
            format!(
                r#"#!/bin/sh
set -eu
: "${{SNAPBACK_FAKE_TS_STATE:?}}" "${{SNAPBACK_FAKE_TS_LOG:?}}"
printf '%s\n' "$*" >> "$SNAPBACK_FAKE_TS_LOG"
if [ "$1" = "status" ]; then
  printf '%s\n' '{{"BackendState":"Running","Self":{{"DNSName":"{DNS_NAME}."}}}}'
  exit 0
fi
if [ "$1" = "serve" ] && [ "$2" = "status" ]; then
  cat "$SNAPBACK_FAKE_TS_STATE"
  exit 0
fi
last=''
for argument in "$@"; do last="$argument"; done
if [ "$1" = "serve" ] && [ "$last" = "off" ]; then
  printf '%s\n' '{{}}' > "$SNAPBACK_FAKE_TS_STATE"
  exit 0
fi
if [ "$1" = "serve" ]; then
  printf '{{"TCP":{{"443":{{"HTTPS":true}}}},"Web":{{"{DNS_NAME}:443":{{"Handlers":{{"/_snapback":{{"Proxy":"%s"}}}}}}}}}}\n' "$last" > "$SNAPBACK_FAKE_TS_STATE"
  exit 0
fi
exit 64
"#
            ),
        )
        .unwrap();
        std::fs::set_permissions(&executable, std::fs::Permissions::from_mode(0o755)).unwrap();
        Self {
            bin_dir,
            state,
            log,
            receipts,
        }
    }

    fn apply(&self, command: &mut Command) {
        let inherited = std::env::var("PATH").unwrap_or_default();
        command
            .env("PATH", format!("{}:{inherited}", self.bin_dir.display()))
            .env("SNAPBACK_FAKE_TS_STATE", &self.state)
            .env("SNAPBACK_FAKE_TS_LOG", &self.log)
            .env("SNAPBACK_ADMIN_TAILSCALE_RECEIPT_DIR", &self.receipts);
    }

    fn log(&self) -> String {
        std::fs::read_to_string(&self.log).unwrap()
    }

    fn state(&self) -> Value {
        serde_json::from_slice(&std::fs::read(&self.state).unwrap()).unwrap()
    }

    fn reset_state(&self) {
        std::fs::write(&self.state, b"{}\n").unwrap();
    }
}

struct LinkProcess {
    child: Child,
    lines: mpsc::Receiver<String>,
    reader: Option<JoinHandle<()>>,
}

impl LinkProcess {
    fn line(&mut self) -> String {
        match self.lines.recv_timeout(Duration::from_secs(40)) {
            Ok(line) => line,
            Err(error) => {
                let status = self.child.wait().expect("wait for failed tailscale link");
                if let Some(reader) = self.reader.take() {
                    reader.join().expect("join failed tailscale link reader");
                }
                let mut stderr = String::new();
                self.child
                    .stderr
                    .take()
                    .expect("failed tailscale link stderr")
                    .read_to_string(&mut stderr)
                    .expect("read failed tailscale link stderr");
                panic!(
                    "tailscale link emitted no URL ({error:?}); status={status}; stderr={stderr}"
                );
            }
        }
    }

    fn signal(&mut self, signal: libc::c_int) {
        // SAFETY: this test owns the live child PID.
        assert_eq!(
            unsafe { libc::kill(self.child.id() as libc::pid_t, signal) },
            0
        );
    }

    fn wait(&mut self, timeout: Duration) -> ExitStatus {
        let deadline = Instant::now() + timeout;
        loop {
            if let Some(status) = self.child.try_wait().unwrap() {
                if let Some(reader) = self.reader.take() {
                    reader.join().unwrap();
                }
                return status;
            }
            assert!(Instant::now() < deadline, "tailscale link did not stop");
            std::thread::sleep(Duration::from_millis(25));
        }
    }
}

impl Drop for LinkProcess {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
        if let Some(reader) = self.reader.take() {
            let _ = reader.join();
        }
    }
}

fn start_link(ready_file: &std::path::Path, fake: &FakeTailscale) -> (LinkProcess, String) {
    let mut command = snapback();
    command.args([
        "admin",
        "link",
        "--tailscale",
        "--ready-file",
        ready_file.to_str().unwrap(),
    ]);
    fake.apply(&mut command);
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let stdout = child.stdout.take().unwrap();
    let (sender, lines) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if sender.send(line.unwrap()).is_err() {
                break;
            }
        }
    });
    let mut process = LinkProcess {
        child,
        lines,
        reader: Some(reader),
    };
    let link = process.line();
    (process, link)
}

fn count_lines(value: &str, predicate: impl Fn(&str) -> bool) -> usize {
    value.lines().filter(|line| predicate(line)).count()
}

fn remove_receipt_payloads(directory: &std::path::Path) {
    if let Ok(entries) = std::fs::read_dir(directory) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) == Some("json")
                || path
                    .file_name()
                    .and_then(|value| value.to_str())
                    .is_some_and(|value| value.contains(".owner-"))
            {
                let _ = std::fs::remove_file(path);
            }
        }
    }
}

#[test]
fn tailscale_receipts_are_reference_counted_compare_deleted_and_stale_swept() {
    let temp = tempfile::tempdir().unwrap();
    let server = start_server(temp.path());
    let fake = FakeTailscale::install(temp.path());

    let (mut first, first_link) = start_link(&server.ready_file, &fake);
    assert!(first_link.starts_with(&format!("https://{DNS_NAME}/_snapback/admin/#claim=")));
    assert_eq!(
        count_lines(&fake.log(), |line| line.contains("serve --bg")),
        1
    );
    assert!(
        fake.state()["Web"][format!("{DNS_NAME}:443")]["Handlers"]["/_snapback"]["Proxy"]
            .as_str()
            .unwrap()
            .starts_with("http://127.0.0.1:")
    );

    let directory_mode = std::fs::metadata(&fake.receipts)
        .unwrap()
        .permissions()
        .mode()
        & 0o777;
    assert_eq!(directory_mode, 0o700);
    let live_files = std::fs::read_dir(&fake.receipts)
        .unwrap()
        .map(|entry| entry.unwrap().path())
        .collect::<Vec<_>>();
    assert!(
        live_files
            .iter()
            .any(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
    );
    for path in &live_files {
        assert_eq!(
            std::fs::metadata(path).unwrap().permissions().mode() & 0o777,
            0o600,
            "{}",
            path.display()
        );
    }

    let (mut second, second_link) = start_link(&server.ready_file, &fake);
    assert!(second_link.starts_with(&format!("https://{DNS_NAME}/_snapback/admin/#claim=")));
    assert_eq!(
        count_lines(&fake.log(), |line| line.contains("serve --bg")),
        1
    );

    first.signal(libc::SIGTERM);
    assert!(first.wait(Duration::from_secs(6)).success());
    assert!(
        fake.state().get("Web").is_some(),
        "first-out removed a shared mapping"
    );
    assert_eq!(count_lines(&fake.log(), |line| line.ends_with(" off")), 0);

    second.signal(libc::SIGTERM);
    assert!(second.wait(Duration::from_secs(6)).success());
    assert_eq!(fake.state(), serde_json::json!({}));
    assert_eq!(count_lines(&fake.log(), |line| line.ends_with(" off")), 1);

    let (mut mutated, _) = start_link(&server.ready_file, &fake);
    let operator_mutation = serde_json::json!({
        "TCP": {"443": {"HTTPS": true}},
        "Web": {format!("{DNS_NAME}:443"): {"Handlers": {
            "/_snapback": {"Proxy": "http://127.0.0.1:65530"}
        }}}
    });
    std::fs::write(&fake.state, serde_json::to_vec(&operator_mutation).unwrap()).unwrap();
    let off_before_mutated_exit = count_lines(&fake.log(), |line| line.ends_with(" off"));
    mutated.signal(libc::SIGTERM);
    assert!(mutated.wait(Duration::from_secs(6)).success());
    assert_eq!(
        fake.state(),
        operator_mutation,
        "external mutation was overwritten"
    );
    assert_eq!(
        count_lines(&fake.log(), |line| line.ends_with(" off")),
        off_before_mutated_exit,
        "compare-and-delete touched a changed mapping"
    );

    remove_receipt_payloads(&fake.receipts);
    let log_before_conflict = fake.log();
    let mut conflict = snapback();
    conflict.args([
        "admin",
        "link",
        "--tailscale",
        "--ready-file",
        server.ready_file.to_str().unwrap(),
    ]);
    fake.apply(&mut conflict);
    let conflict = conflict.output().unwrap();
    assert!(!conflict.status.success());
    assert!(
        String::from_utf8_lossy(&conflict.stderr)
            .contains("SNAPBACK_ADMIN_TAILSCALE_MAPPING_CONFLICT")
    );
    assert_eq!(fake.state(), operator_mutation);
    let log_after_conflict = fake.log();
    let conflict_delta = log_after_conflict
        .strip_prefix(&log_before_conflict)
        .unwrap();
    assert!(
        !conflict_delta
            .lines()
            .any(|line| line.ends_with(" off") || line.contains("serve --bg"))
    );

    fake.reset_state();
    let (mut crashed, _) = start_link(&server.ready_file, &fake);
    crashed.signal(libc::SIGKILL);
    assert!(!crashed.wait(Duration::from_secs(2)).success());
    assert!(
        fake.state().get("Web").is_some(),
        "SIGKILL should leave daemon state for the next sweep"
    );
    let off_before_sweep = count_lines(&fake.log(), |line| line.ends_with(" off"));
    let creates_before_sweep = count_lines(&fake.log(), |line| line.contains("serve --bg"));
    let (mut swept, _) = start_link(&server.ready_file, &fake);
    assert_eq!(
        count_lines(&fake.log(), |line| line.ends_with(" off")),
        off_before_sweep + 1
    );
    assert_eq!(
        count_lines(&fake.log(), |line| line.contains("serve --bg")),
        creates_before_sweep + 1
    );
    swept.signal(libc::SIGTERM);
    assert!(swept.wait(Duration::from_secs(6)).success());
    assert_eq!(fake.state(), serde_json::json!({}));
}

#[test]
fn tailscale_refusals_and_origin_selector_conflicts_are_stable() {
    for arguments in [
        vec!["admin", "link", "--tailscale", "--no-wait"],
        vec![
            "admin",
            "link",
            "--tailscale",
            "--url-base=https://example.test",
        ],
        vec![
            "admin",
            "link",
            "--lan=192.0.2.10",
            "--url-base=https://example.test",
        ],
    ] {
        let output = snapback().args(arguments).output().unwrap();
        assert!(!output.status.success());
        let stderr = String::from_utf8_lossy(&output.stderr);
        assert!(
            stderr.contains("SNAPBACK_ADMIN_LINK_ATTACHED_REQUIRED")
                || stderr.contains("SNAPBACK_ADMIN_LINK_ORIGIN_CONFLICT"),
            "{stderr}"
        );
    }

    let temp = tempfile::tempdir().unwrap();
    let server = start_server(temp.path());
    let qr = snapback()
        .args([
            "admin",
            "link",
            "--no-wait",
            "--qr",
            "--ready-file",
            server.ready_file.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        qr.status.success(),
        "{}",
        String::from_utf8_lossy(&qr.stderr)
    );
    let stdout = String::from_utf8(qr.stdout).unwrap();
    let (selected_url, rendered) = stdout.split_once('\n').unwrap();
    let expected = QrCode::new(selected_url.as_bytes())
        .unwrap()
        .render::<unicode::Dense1x2>()
        .quiet_zone(true)
        .build();
    assert_eq!(rendered, format!("{expected}\n"));
    assert!(String::from_utf8_lossy(&qr.stderr).contains("SNAPBACK_ADMIN_QR_LOOPBACK_ONLY"));

    let empty_path = temp.path().join("empty-path");
    std::fs::create_dir(&empty_path).unwrap();
    let output = snapback()
        .args([
            "admin",
            "link",
            "--tailscale",
            "--ready-file",
            server.ready_file.to_str().unwrap(),
        ])
        .env("PATH", &empty_path)
        .env(
            "SNAPBACK_ADMIN_TAILSCALE_RECEIPT_DIR",
            temp.path().join("absent-receipts"),
        )
        .output()
        .unwrap();
    assert!(!output.status.success());
    assert!(
        String::from_utf8_lossy(&output.stderr).contains("SNAPBACK_ADMIN_TAILSCALE_UNAVAILABLE")
    );
}

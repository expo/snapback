#![cfg(feature = "hermes")]

mod common;
#[path = "effects_cases/epoch.rs"]
mod epoch;
#[path = "effects_cases/witness.rs"]
mod witness;

use serde_json::{Value, json};
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

// @ref LLP 1021#acceptance — this proves the exact post-provider/pre-settlement
// crash, sent_unknown honesty, explicit requeue, provider idempotency, and one then.
#[test]
fn owner_runs_effect_then_delivery_and_honest_restart_requeue() {
    let provider = Provider::start();
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    prepare_effect_fixture(&root, &provider.origin());
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);

    let check = Command::new(binary)
        .args(["check", "--project"])
        .arg(&root)
        .env("SNAPBACK2_COMPILER", &compiler)
        .output()
        .unwrap();
    assert!(
        check.status.success(),
        "{} {}",
        String::from_utf8_lossy(&check.stdout),
        String::from_utf8_lossy(&check.stderr)
    );

    let pause = root.join(".post-provider-pause");
    let mut first_owner = ChildGuard::spawn_post_provider_pause(
        binary,
        &compiler,
        &root,
        &pause,
    );
    let (port, secret) = first_owner.ready(&root);
    assert_eq!(
        status(port, &secret)["effects"]["engine"],
        "ibex2 + vanilla hermes"
    );
    let committed_at = Instant::now();
    let mutation = request(
        port,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", "alice")],
        json!({
            "op": "messages.send",
            "args": {
                "conversationId": "conversation-1",
                "recipientId": "profile-bob",
                "body": "hello from the owner runner"
            }
        }),
    );
    assert_eq!(mutation.body["state"], "committed", "{}", mutation.body);
    let seq = mutation.body["seq"].as_u64().unwrap();
    wait_for(Duration::from_secs(8), || {
        (status(port, &secret)["effects"]["running"] == 1).then_some(())
    });
    wait_for(Duration::from_secs(8), || {
        (provider.hits() == 1).then_some(())
    });
    assert!(
        committed_at.elapsed() < Duration::from_millis(750),
        "effect delivery used the one-second poll instead of the commit wake: {:?}",
        committed_at.elapsed()
    );
    let running_trace = trace(port, &secret, seq);
    let outbox_id = running_trace["outbox"]["rows"][0]["id"]
        .as_str()
        .unwrap()
        .to_owned();
    assert_eq!(running_trace["outbox"]["rows"][0]["state"], "running");
    provider.assert_headers(0, &outbox_id);

    provider.release_first();
    wait_for(Duration::from_secs(8), || {
        fs::read_to_string(pause.join("reached"))
            .ok()
            .filter(|reached| reached == &outbox_id)
    });
    assert_eq!(
        trace(port, &secret, seq)["outbox"]["rows"][0]["state"],
        "running",
        "the pause must be after provider completion but before settlement"
    );
    first_owner.kill();

    let mut second_owner = ChildGuard::spawn(binary, &compiler, &root);
    let (port, secret) = second_owner.ready(&root);
    wait_for(Duration::from_secs(5), || {
        (status(port, &secret)["effects"]["sentUnknown"] == 1).then_some(())
    });
    thread::sleep(Duration::from_millis(1_200));
    assert_eq!(
        provider.hits(),
        1,
        "sent_unknown must not run automatically"
    );
    assert_eq!(
        trace(port, &secret, seq)["outbox"]["rows"][0]["state"],
        "sent_unknown"
    );

    let mut notifications = Sse::open(
        port,
        "/api/subscribe?op=notifications.list&args=%7B%7D",
        "alice",
    );
    let seeded = notifications.event();
    assert_eq!(seeded["state"], "complete", "{seeded}");
    assert_eq!(seeded["data"].as_array().unwrap().len(), 1);
    assert_eq!(seeded["data"][0]["outboxId"], "seed-outbox");
    let requeued = request(
        port,
        "POST",
        &format!("/control/outbox/{outbox_id}/requeue"),
        &[("X-Snapback-Control", &secret)],
        json!({}),
    );
    assert_eq!(requeued.status, 200, "{}", requeued.body);
    assert_eq!(requeued.body["state"], "queued");

    let delivery = notifications.event();
    assert_eq!(delivery["state"], "complete", "{delivery}");
    assert_eq!(delivery["data"].as_array().unwrap().len(), 2);
    let delivered = delivery["data"]
        .as_array()
        .unwrap()
        .iter()
        .find(|row| row["outboxId"] == outbox_id)
        .expect("the effect delivery row must be present beside seed data");
    assert_eq!(delivered["providerId"], "provider-idempotent");
    assert_eq!(provider.hits(), 2);
    provider.assert_headers(1, &outbox_id);
    let final_status = wait_for(Duration::from_secs(5), || {
        let status = status(port, &secret);
        (status["effects"]["sent"] == 1).then_some(status)
    });
    assert_eq!(final_status["effects"]["thenPending"], 0);
    assert_eq!(final_status["effects"]["sentUnknown"], 0);
    let final_trace = trace(port, &secret, seq);
    assert_eq!(final_trace["outbox"]["rows"][0]["id"], outbox_id);
    assert_eq!(final_trace["outbox"]["rows"][0]["state"], "sent");
    // @ref LLP 1021#4-test-counts-witnesses — acceptance 3: one committed `then`, with its seq, after the restart-requeue path.
    let then = &final_trace["outbox"]["rows"][0]["then"];
    assert_eq!(then["op"], "notifications.recordNotified", "{final_trace}");
    assert_eq!(then["state"], "committed");
    assert!(
        then["seq"].as_u64().is_some_and(|then| then > seq),
        "{then}"
    );
    let sent_rows = request(
        port,
        "GET",
        "/control/outbox?state=sent",
        &[("X-Snapback-Control", &secret)],
        json!({}),
    );
    assert_eq!(
        sent_rows.body["rows"].as_array().unwrap().len(),
        1,
        "{}",
        sent_rows.body
    );
    assert_eq!(sent_rows.body["rows"][0]["then"], *then);

    let stopped = request(
        port,
        "POST",
        "/control/stop",
        &[("X-Snapback-Control", &secret)],
        json!({ "cause": "effects integration complete" }),
    );
    assert_eq!(stopped.status, 200, "{}", stopped.body);
    second_owner.wait();
    fs::remove_dir_all(root).unwrap();
}

/// Acceptance 5's spinning half (LLP 1021 §5): with `while (true) {}` running
/// in the effect, the engine's deadline is what ends the job — observed while
/// the owner is alive, as the outbox row's transition from `running` to
/// `queued` with `E_EFFECT_TIMEOUT` as its error and its retry scheduled —
/// and then, with the retried attempt spinning, `dev --stop` returns and the
/// owner process is observed to exit within the budget plus one second. The
/// CLI's own two-second `E_OWNER_STOP_TIMEOUT` is not the observation. This
/// takes two default budgets, by design.
///
/// The attempt that is spinning at the stop is ended by the same deadline.
/// Owner teardown keeps the writer alive until the runner joins, so the retry
/// settlement and transition log must both be durable before the process exits.
#[test]
fn dev_stop_observes_owner_process_exit_while_a_spinning_effect_runs() {
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    fs::write(root.join("snapback/delivery.ts"), SPINNING_DELIVERY).unwrap();
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    let mut owner = ChildGuard::spawn(binary, &compiler, &root);
    let (port, secret) = owner.ready(&root);
    let sent = request(
        port,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", "alice")],
        json!({
            "op": "messages.send",
            "args": {
                "conversationId": "conversation-1",
                "recipientId": "profile-bob",
                "body": "stop while the effect spins"
            }
        }),
    );
    assert_eq!(sent.body["state"], "committed", "{}", sent.body);
    let seq = sent.body["seq"].as_u64().unwrap();
    let row = |port: u16, secret: &str| trace(port, secret, seq)["outbox"]["rows"][0].clone();
    wait_for(Duration::from_secs(8), || {
        (status(port, &secret)["effects"]["running"] == 1).then_some(())
    });
    let outbox_id = row(port, &secret)["id"].as_str().unwrap().to_owned();

    // The first attempt runs to the deadline: the row is requeued with the
    // timeout as its error and its retry a second out.
    let claimed_at = Instant::now();
    let requeued = wait_for(
        snapback2_effects::DEFAULT_BUDGET + Duration::from_secs(5),
        || {
            let row = row(port, &secret);
            (row["state"] == "queued").then_some(row)
        },
    );
    assert!(
        claimed_at.elapsed() >= snapback2_effects::DEFAULT_BUDGET - Duration::from_secs(1),
        "the row was requeued before the budget: {:?}",
        claimed_at.elapsed()
    );
    assert_eq!(requeued["attempts"], 1, "{requeued}");
    assert_eq!(
        requeued["lastError"],
        format!(
            "E_EFFECT_TIMEOUT: budget {} ms",
            snapback2_effects::DEFAULT_BUDGET.as_millis()
        ),
        "{requeued}"
    );
    // The second attempt is claimed at the backoff instant and spins again.
    wait_for(Duration::from_secs(8), || {
        let row = row(port, &secret);
        (row["state"] == "running" && row["attempts"] == 2).then_some(())
    });

    let started = Instant::now();
    let stopping = Command::new(binary)
        .args(["dev", "--stop", "--json", "--project"])
        .arg(&root)
        .env("SNAPBACK2_COMPILER", &compiler)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let exit = wait_for(
        snapback2_effects::DEFAULT_BUDGET + Duration::from_secs(1),
        || owner.child.try_wait().unwrap(),
    );
    let elapsed = started.elapsed();
    assert!(exit.success(), "owner exit: {exit}");
    let stopped = stopping.wait_with_output().unwrap();
    let cli = format!(
        "{}{}",
        String::from_utf8_lossy(&stopped.stdout),
        String::from_utf8_lossy(&stopped.stderr)
    );
    assert!(
        stopped.status.success() || cli.contains("E_OWNER_STOP_TIMEOUT"),
        "{cli}"
    );
    let after = outbox_row(&root, &outbox_id);
    let timeout = format!(
        "E_EFFECT_TIMEOUT: budget {} ms",
        snapback2_effects::DEFAULT_BUDGET.as_millis()
    );
    assert_eq!(after.0, "queued", "{after:?}");
    assert_eq!(after.1.as_deref(), Some(timeout.as_str()), "{after:?}");
    assert!(after.2.is_some(), "the retry backoff must be durable: {after:?}");
    let transition = fs::read_to_string(root.join(".snapback/log.jsonl"))
        .unwrap()
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .find(|line| {
            line["outbox"]["id"] == outbox_id
                && line["outbox"]["from"] == "running"
                && line["outbox"]["to"] == "queued"
                && line["outbox"]["attempt"] == 2
        })
        .expect("the stopped attempt's retry transition must be logged");
    assert_eq!(transition["outbox"]["error"], timeout, "{transition}");
    eprintln!(
        "dev --stop returned {}; owner exit after {elapsed:?}; durable row {after:?}",
        stopped.status
    );
    fs::remove_dir_all(root).unwrap();
}

/// The fixture's effect with its body replaced by a loop that never ends.
const SPINNING_DELIVERY: &str = r#"import { effect } from "snapback2";
import { recordNotified } from "./notifications";

export const notify = effect({
  grants: ["https://api.example.com"],
  run: async (payload: { to: string; body: string }) => {
    let spins = 0;
    while (spins >= 0) { spins += 1; }
    return { providerId: payload.to + ":" + spins };
  },
  then: recordNotified,
});
"#;

/// The outbox row's state, last error, and retry time after the owner exits.
fn outbox_row(root: &Path, outbox_id: &str) -> (String, Option<String>, Option<i64>) {
    let store = rusqlite::Connection::open_with_flags(
        root.join(".snapback/store.sqlite"),
        rusqlite::OpenFlags::SQLITE_OPEN_READ_ONLY,
    )
    .unwrap();
    store
        .query_row(
            "SELECT state, last_error, next_at FROM _outbox WHERE id = ?1",
            [outbox_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .unwrap()
}

fn prepare_effect_fixture(root: &Path, origin: &str) {
    let delivery = root.join("snapback/delivery.ts");
    let source = fs::read_to_string(&delivery)
        .unwrap()
        .replace("https://api.example.com", origin);
    fs::write(&delivery, source).unwrap();
    let notifications = root.join("snapback/notifications.q");
    let mut source = fs::read_to_string(&notifications).unwrap();
    source.push_str("\nquery list():\n  return notifications[] first 50 by byOutbox\n");
    fs::write(notifications, source).unwrap();
    let schema = root.join("snapback/schema.q");
    // Match only the read rule line: an intervening comment must not silently
    // turn this rewrite into a no-op (it did once; the test then failed far away).
    let source = fs::read_to_string(&schema)
        .unwrap()
        .replace("read <- deny", "public 'test observes effect completion'");
    assert!(
        source.contains("test observes effect completion"),
        "prepare_effect_fixture: the schema rewrite matched nothing"
    );
    fs::write(schema, source).unwrap();
}

struct Provider {
    port: u16,
    headers: Arc<Mutex<Vec<String>>>,
    first_release: Arc<(Mutex<bool>, Condvar)>,
}

impl Provider {
    fn start() -> Self {
        let listener = TcpListener::bind(("127.0.0.1", 0)).unwrap();
        let port = listener.local_addr().unwrap().port();
        let headers = Arc::new(Mutex::new(Vec::new()));
        let first_release = Arc::new((Mutex::new(false), Condvar::new()));
        let thread_headers = headers.clone();
        let thread_release = first_release.clone();
        thread::spawn(move || {
            for stream in listener.incoming().take(2) {
                let Ok(mut stream) = stream else { return };
                let mut raw = Vec::new();
                let mut buffer = [0_u8; 4096];
                loop {
                    match stream.read(&mut buffer) {
                        Ok(0) | Err(_) => break,
                        Ok(read) => {
                            raw.extend_from_slice(&buffer[..read]);
                            if raw.windows(4).any(|window| window == b"\r\n\r\n") {
                                break;
                            }
                        }
                    }
                }
                let end = raw
                    .windows(4)
                    .position(|window| window == b"\r\n\r\n")
                    .unwrap();
                let hit = {
                    let mut headers = thread_headers.lock().unwrap();
                    headers.push(String::from_utf8(raw[..end].to_vec()).unwrap());
                    headers.len()
                };
                if hit == 1 {
                    let (released, wake) = &*thread_release;
                    let mut released = released.lock().unwrap();
                    while !*released {
                        released = wake.wait(released).unwrap();
                    }
                }
                // Both deliveries use the same idempotency key, so this stand-in
                // returns the same provider result across the crash/retry pair.
                let body = r#"{"id":"provider-idempotent"}"#;
                let response = format!(
                    "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                );
                let _ = stream.write_all(response.as_bytes());
                let _ = stream.flush();
            }
        });
        Self {
            port,
            headers,
            first_release,
        }
    }

    fn origin(&self) -> String {
        format!("http://127.0.0.1:{}", self.port)
    }

    fn hits(&self) -> usize {
        self.headers.lock().unwrap().len()
    }

    fn assert_headers(&self, index: usize, outbox_id: &str) {
        let headers = self.headers.lock().unwrap();
        let block = &headers[index];
        println!("owner provider request {}:\n{block}", index + 1);
        assert!(block.starts_with("POST /send HTTP/1.1\r\n"), "{block}");
        assert!(
            !block
                .to_ascii_lowercase()
                .contains("application/x-www-form-urlencoded"),
            "{block}"
        );
        for (name, expected) in [
            ("content-type", "application/json"),
            ("idempotency-key", outbox_id),
        ] {
            let values: Vec<_> = block
                .lines()
                .skip(1)
                .filter_map(|line| {
                    let (key, value) = line.split_once(':')?;
                    key.eq_ignore_ascii_case(name).then(|| value.trim())
                })
                .collect();
            assert_eq!(values, vec![expected], "{block}");
        }
    }

    fn release_first(&self) {
        let (released, wake) = &*self.first_release;
        *released.lock().unwrap() = true;
        wake.notify_all();
    }
}

struct Response {
    status: u16,
    body: Value,
}

fn request(port: u16, method: &str, path: &str, headers: &[(&str, &str)], body: Value) -> Response {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(8)))
        .unwrap();
    let bytes = if method == "GET" {
        Vec::new()
    } else {
        serde_json::to_vec(&body).unwrap()
    };
    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n",
        bytes.len()
    )
    .unwrap();
    for (name, value) in headers {
        write!(stream, "{name}: {value}\r\n").unwrap();
    }
    stream.write_all(b"\r\n").unwrap();
    stream.write_all(&bytes).unwrap();
    stream.flush().unwrap();
    stream.shutdown(Shutdown::Write).unwrap();
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes).unwrap();
    let split = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .unwrap();
    let status = String::from_utf8_lossy(&bytes[..split])
        .lines()
        .next()
        .unwrap()
        .split_whitespace()
        .nth(1)
        .unwrap()
        .parse()
        .unwrap();
    Response {
        status,
        body: serde_json::from_slice(&bytes[split + 4..]).unwrap(),
    }
}

fn status(port: u16, secret: &str) -> Value {
    let response = request(
        port,
        "GET",
        "/control/status",
        &[("X-Snapback-Control", secret)],
        json!({}),
    );
    assert_eq!(response.status, 200, "{}", response.body);
    response.body
}

fn trace(port: u16, secret: &str, seq: u64) -> Value {
    let response = request(
        port,
        "GET",
        &format!("/control/trace?seq={seq}"),
        &[("X-Snapback-Control", secret)],
        json!({}),
    );
    assert_eq!(response.status, 200, "{}", response.body);
    response.body
}

struct Sse {
    reader: BufReader<TcpStream>,
}

impl Sse {
    fn open(port: u16, path: &str, persona: &str) -> Self {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(8)))
            .unwrap();
        write!(
            stream,
            "GET {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nX-Snapback-As: {persona}\r\nConnection: close\r\n\r\n"
        )
        .unwrap();
        stream.flush().unwrap();
        let mut reader = BufReader::new(stream);
        let mut line = String::new();
        reader.read_line(&mut line).unwrap();
        assert!(line.contains("200"), "{line}");
        loop {
            line.clear();
            reader.read_line(&mut line).unwrap();
            if line == "\r\n" {
                break;
            }
        }
        Self { reader }
    }

    fn event(&mut self) -> Value {
        loop {
            let mut size = String::new();
            self.reader.read_line(&mut size).unwrap();
            let size = usize::from_str_radix(size.trim(), 16).unwrap();
            let mut bytes = vec![0; size];
            self.reader.read_exact(&mut bytes).unwrap();
            let mut ending = [0; 2];
            self.reader.read_exact(&mut ending).unwrap();
            let text = String::from_utf8(bytes).unwrap();
            if let Some(data) = text.lines().find_map(|line| line.strip_prefix("data: ")) {
                return serde_json::from_str(data).unwrap();
            }
        }
    }
}

struct ChildGuard {
    child: Child,
    stdout: BufReader<std::process::ChildStdout>,
}

impl ChildGuard {
    fn spawn(binary: &str, compiler: &Path, root: &Path) -> Self {
        Self::spawn_flags(binary, compiler, root, &[])
    }

    fn spawn_test(binary: &str, compiler: &Path, root: &Path) -> Self {
        Self::spawn_flags(binary, compiler, root, &["--owner-child", "--test-owner"])
    }

    fn spawn_post_provider_pause(
        binary: &str,
        compiler: &Path,
        root: &Path,
        pause: &Path,
    ) -> Self {
        Self::spawn_command(binary, compiler, root, &["--owner-child"], Some(pause))
    }

    fn spawn_flags(binary: &str, compiler: &Path, root: &Path, flags: &[&str]) -> Self {
        Self::spawn_command(binary, compiler, root, flags, None)
    }

    fn spawn_command(
        binary: &str,
        compiler: &Path,
        root: &Path,
        flags: &[&str],
        post_provider_pause: Option<&Path>,
    ) -> Self {
        let mut command = Command::new(binary);
        command
            .args(["dev", "--project"])
            .arg(root)
            .arg("--foreground")
            .args(flags)
            .env("SNAPBACK2_COMPILER", compiler)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if let Some(path) = post_provider_pause {
            command.env("SNAPBACK2_TEST_POST_PROVIDER_PAUSE", path);
        }
        let mut child = command.spawn().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Self { child, stdout }
    }

    fn ready(&mut self, root: &Path) -> (u16, String) {
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        let port = line
            .trim()
            .strip_prefix("SNAPBACK_URL=http://127.0.0.1:")
            .expect("owner ready line")
            .parse()
            .unwrap();
        let owner: Value =
            serde_json::from_slice(&fs::read(root.join(".snapback/owner.json")).unwrap()).unwrap();
        (port, owner["secret"].as_str().unwrap().to_owned())
    }

    fn kill(&mut self) {
        self.child.kill().unwrap();
        self.child.wait().unwrap();
    }

    fn wait(&mut self) {
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(5) {
            if let Some(status) = self.child.try_wait().unwrap() {
                assert!(status.success(), "owner exited {status}");
                return;
            }
            thread::sleep(Duration::from_millis(25));
        }
        panic!("owner did not stop");
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

fn wait_for<T>(timeout: Duration, mut check: impl FnMut() -> Option<T>) -> T {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if let Some(value) = check() {
            return value;
        }
        thread::sleep(Duration::from_millis(50));
    }
    panic!("condition did not become true in {timeout:?}");
}

fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/compiler/fixtures/quarry-chat")
}

fn compiler(root: &Path) -> PathBuf {
    common::isolated_compiler(&root.join(".test-package"))
}

fn temp_root() -> PathBuf {
    static NEXT_ROOT: AtomicU64 = AtomicU64::new(0);
    let path = std::env::temp_dir().join(format!(
        "snapback2-effects-test-{}-{}-{}",
        std::process::id(),
        NEXT_ROOT.fetch_add(1, Ordering::Relaxed),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    fs::create_dir_all(&path).unwrap();
    path
}

fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap().flatten() {
        let destination = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &destination);
        } else {
            fs::copy(entry.path(), destination).unwrap();
        }
    }
}

#[test]
fn dev_stop_observes_owner_process_exit_while_a_well_behaved_effect_runs() {
    let provider = Provider::start();
    let root = temp_root();
    copy_tree(&fixture().join("snapback"), &root.join("snapback"));
    prepare_effect_fixture(&root, &provider.origin());
    let binary = env!("CARGO_BIN_EXE_snapback2");
    let compiler = compiler(&root);
    let mut owner = ChildGuard::spawn(binary, &compiler, &root);
    let (port, secret) = owner.ready(&root);
    let sent = request(
        port,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", "alice")],
        json!({"op":"messages.send", "args":{"conversationId":"conversation-1", "recipientId":"profile-bob", "body":"stop during provider"}}),
    );
    assert_eq!(sent.body["state"], "committed", "{}", sent.body);
    wait_for(Duration::from_secs(5), || {
        (provider.hits() == 1).then_some(())
    });
    assert_eq!(status(port, &secret)["effects"]["running"], 1);
    let release = provider.first_release.clone();
    let provider_finish = thread::spawn(move || {
        thread::sleep(Duration::from_millis(400));
        let (released, wake) = &*release;
        *released.lock().unwrap() = true;
        wake.notify_all();
    });
    let started = Instant::now();
    let stopping = Command::new(binary)
        .args(["dev", "--stop", "--json", "--project"])
        .arg(&root)
        .env("SNAPBACK2_COMPILER", &compiler)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .unwrap();
    let exit = wait_for(
        snapback2_effects::DEFAULT_BUDGET + Duration::from_secs(1),
        || owner.child.try_wait().unwrap(),
    );
    assert!(exit.success(), "owner exit: {exit}");
    let stopped = stopping.wait_with_output().unwrap();
    assert!(
        stopped.status.success(),
        "{} {}",
        String::from_utf8_lossy(&stopped.stdout),
        String::from_utf8_lossy(&stopped.stderr)
    );
    assert!(started.elapsed() <= snapback2_effects::DEFAULT_BUDGET + Duration::from_secs(1));
    provider_finish.join().unwrap();
    fs::remove_dir_all(root).unwrap();
}

#![cfg(feature = "hermes")]

mod common;

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

// @ref LLP 1003#4-in-the-owner — this proves the commit wake, durable runner,
// subscription fanout, sent_unknown honesty, and explicit requeue.
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

    let mut first_owner = ChildGuard::spawn(binary, &compiler, &root);
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

    first_owner.kill();
    provider.release_first();

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
    assert_eq!(delivered["providerId"], "provider-2");
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
                let body = format!(r#"{{"id":"provider-{hit}"}}"#);
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
        let mut child = Command::new(binary)
            .args(["dev", "--project"])
            .arg(root)
            .arg("--foreground")
            .env("SNAPBACK2_COMPILER", compiler)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .unwrap();
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
    eprintln!(
        "dev --stop owner process exited after {:?}",
        started.elapsed()
    );
    provider_finish.join().unwrap();
    fs::remove_dir_all(root).unwrap();
}

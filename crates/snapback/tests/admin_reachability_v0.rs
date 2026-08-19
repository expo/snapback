//! Black-box reachability and hostile-framing proofs for LLP 0017.

#![cfg(unix)]

use serde_json::{Value, json};
use std::io::{BufRead as _, BufReader, Read as _, Write as _};
use std::net::{IpAddr, SocketAddr, TcpStream};
use std::process::{Child, Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::thread::JoinHandle;
use std::time::{Duration, Instant};

fn snapback() -> Command {
    Command::new(env!("CARGO_BIN_EXE_snapback"))
}

struct Server {
    child: Child,
    ready_file: std::path::PathBuf,
    server_url: String,
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
        .expect("start reachability server");
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        if let Ok(bytes) = std::fs::read(&ready_file)
            && let Ok(value) = serde_json::from_slice::<Value>(&bytes)
            && value["ready"] == true
        {
            return Server {
                child,
                ready_file,
                server_url: value["serverUrl"].as_str().unwrap().to_owned(),
            };
        }
        if let Some(status) = child.try_wait().unwrap() {
            let mut stderr = String::new();
            child
                .stderr
                .take()
                .unwrap()
                .read_to_string(&mut stderr)
                .unwrap();
            panic!("reachability server exited before ready: {status}\n{stderr}");
        }
        assert!(
            Instant::now() < deadline,
            "reachability server readiness timeout"
        );
        std::thread::sleep(Duration::from_millis(25));
    }
}

struct LinkProcess {
    child: Child,
    lines: mpsc::Receiver<String>,
    reader: Option<JoinHandle<()>>,
}

impl LinkProcess {
    fn next_line(&self) -> String {
        self.lines
            .recv_timeout(Duration::from_secs(10))
            .expect("admin link output line")
    }

    fn signal(&mut self, signal: libc::c_int) {
        // SAFETY: the PID is the live child owned by this test.
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
            assert!(Instant::now() < deadline, "admin link process did not stop");
            std::thread::sleep(Duration::from_millis(25));
        }
    }

    fn stderr(&mut self) -> String {
        let mut value = String::new();
        self.child
            .stderr
            .take()
            .unwrap()
            .read_to_string(&mut value)
            .unwrap();
        value
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

fn start_lan_link(ready_file: &std::path::Path, address: IpAddr) -> (LinkProcess, String) {
    let mut child = snapback()
        .args([
            "admin",
            "link",
            &format!("--lan={address}"),
            "--ready-file",
            ready_file.to_str().unwrap(),
        ])
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("start attached LAN link");
    let stdout = child.stdout.take().unwrap();
    let (sender, lines) = mpsc::channel();
    let reader = std::thread::spawn(move || {
        for line in BufReader::new(stdout).lines() {
            if sender.send(line.unwrap()).is_err() {
                break;
            }
        }
    });
    let process = LinkProcess {
        child,
        lines,
        reader: Some(reader),
    };
    let link = process.next_line();
    (process, link)
}

fn split_link(link: &str) -> (String, String) {
    let (page, claim) = link.split_once("#claim=").expect("claim fragment");
    assert!(page.ends_with("/_snapback/admin/"));
    (
        page.trim_end_matches("/_snapback/admin/").to_owned(),
        claim.to_owned(),
    )
}

fn relay_address(origin: &str) -> SocketAddr {
    let uri: snapback_server::test_support::axum::http::Uri = origin.parse().unwrap();
    let authority = uri.authority().unwrap();
    SocketAddr::new(
        authority.host().parse().unwrap(),
        authority.port_u16().unwrap(),
    )
}

fn raw_request(origin: &str, request: &str) -> String {
    let mut stream = TcpStream::connect_timeout(&relay_address(origin), Duration::from_secs(2))
        .expect("connect real non-loopback relay");
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    stream.write_all(request.as_bytes()).unwrap();
    let mut response = Vec::new();
    match stream.read_to_end(&mut response) {
        Ok(_) => {}
        Err(error)
            if matches!(
                error.kind(),
                std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
            ) => {}
        Err(error) => panic!("read relay response: {error}"),
    }
    String::from_utf8_lossy(&response).into_owned()
}

fn post_json(origin: &str, path: &str, body: Value, headers: &[(&str, &str)]) -> (u16, Value) {
    let mut request = ureq::post(&format!("{origin}{path}"));
    for (name, value) in headers {
        request = request.set(name, value);
    }
    let response = match request.send_json(body) {
        Ok(response) => response,
        Err(ureq::Error::Status(_, response)) => response,
        Err(error) => panic!("relay request failed: {error}"),
    };
    let status = response.status();
    let body = response.into_json().unwrap_or(Value::Null);
    (status, body)
}

fn cors_origin(server_url: &str, origin: &str) -> Option<String> {
    let response = ureq::request("OPTIONS", &format!("{server_url}/_snapback/api/app/reset"))
        .set("origin", origin)
        .set("access-control-request-method", "POST")
        .call()
        .unwrap();
    response
        .header("access-control-allow-origin")
        .map(ToOwned::to_owned)
}

fn direct_reset(server_url: &str, credential: &str) -> u16 {
    match ureq::post(&format!("{server_url}/_snapback/api/app/reset"))
        .set("x-snapback-console-credential", credential)
        .send_json(json!({}))
    {
        Ok(response) => response.status(),
        Err(ureq::Error::Status(status, _)) => status,
        Err(error) => panic!("direct reset request failed: {error}"),
    }
}

fn wait_until(timeout: Duration, mut condition: impl FnMut() -> bool) {
    let deadline = Instant::now() + timeout;
    while !condition() {
        assert!(Instant::now() < deadline, "condition did not become true");
        std::thread::sleep(Duration::from_millis(25));
    }
}

fn listener_closed(origin: &str) -> bool {
    TcpStream::connect_timeout(&relay_address(origin), Duration::from_millis(100)).is_err()
}

#[test]
fn real_lan_relay_is_path_scoped_parser_strict_and_lease_bounded() {
    let candidates = snapback::admin_link::lan_candidates().expect("enumerate LAN interfaces");
    let Some(candidate) = candidates
        .iter()
        .find(|candidate| matches!(candidate.address, IpAddr::V4(_)))
        .or_else(|| candidates.first())
    else {
        eprintln!(
            "SNAPBACK_TEST_LAN_INTERFACE_UNAVAILABLE: host has no up non-loopback non-virtual interface"
        );
        return;
    };
    let temp = tempfile::tempdir().unwrap();
    let mut server = start_server(temp.path());

    let (mut first, first_link) = start_lan_link(&server.ready_file, candidate.address);
    let (first_origin, first_claim) = split_link(&first_link);
    let authority = relay_address(&first_origin).to_string();
    assert_eq!(
        cors_origin(&server.server_url, &first_origin).as_deref(),
        Some(first_origin.as_str())
    );

    let identity = raw_request(
        &first_origin,
        &format!(
            "GET /_snapback/admin/reachability/identity HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\n\r\n"
        ),
    );
    assert!(identity.starts_with("HTTP/1.1 200"), "{identity}");
    let preflight = raw_request(
        &first_origin,
        &format!(
            "OPTIONS /_snapback/api/app/reset HTTP/1.1\r\nHost: {authority}\r\nOrigin: {first_origin}\r\nAccess-Control-Request-Method: POST\r\nConnection: close\r\n\r\n"
        ),
    );
    assert!(preflight.starts_with("HTTP/1.1 204"), "{preflight}");
    assert!(
        preflight
            .to_ascii_lowercase()
            .contains(&format!("access-control-allow-origin: {first_origin}")),
        "registered Origin did not survive the relay: {preflight}"
    );
    let hostile_preflight = raw_request(
        &first_origin,
        &format!(
            "OPTIONS /_snapback/api/app/reset HTTP/1.1\r\nHost: {authority}\r\nOrigin: http://attacker.invalid\r\nAccess-Control-Request-Method: POST\r\nConnection: close\r\n\r\n"
        ),
    );
    assert!(hostile_preflight.starts_with("HTTP/1.1 204"));
    assert!(
        !hostile_preflight
            .to_ascii_lowercase()
            .contains("access-control-allow-origin")
    );

    for (label, request, expected) in [
        (
            "absolute form",
            format!(
                "GET {first_origin}/_snapback/admin/ HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\n\r\n"
            ),
            "SNAPBACK_ADMIN_RELAY_TARGET_FORM_REFUSED",
        ),
        (
            "CONNECT",
            format!("CONNECT {authority} HTTP/1.1\r\nHost: {authority}\r\n\r\n"),
            "SNAPBACK_ADMIN_RELAY_CONNECT_REFUSED",
        ),
        (
            "encoded traversal",
            format!(
                "GET /_snapback/admin/%2e%2e/api HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\n\r\n"
            ),
            "SNAPBACK_ADMIN_RELAY_PATH_REFUSED",
        ),
        (
            "forwarding spoof",
            format!(
                "GET /_snapback/admin/ HTTP/1.1\r\nHost: {authority}\r\nX-Forwarded-Host: 127.0.0.1\r\nConnection: close\r\n\r\n"
            ),
            "SNAPBACK_ADMIN_RELAY_FORWARDING_HEADER_REFUSED",
        ),
        (
            "Host laundering",
            "GET /_snapback/admin/ HTTP/1.1\r\nHost: 127.0.0.1:1\r\nConnection: close\r\n\r\n"
                .to_string(),
            "SNAPBACK_ADMIN_RELAY_HOST_REFUSED",
        ),
        (
            "master route",
            format!(
                "POST /_snapback/api/console/credential HTTP/1.1\r\nHost: {authority}\r\nOrigin: {first_origin}\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            ),
            "SNAPBACK_ADMIN_RELAY_MASTER_ROUTE_REFUSED",
        ),
        (
            "master carrier",
            format!(
                "GET /_snapback/api/health HTTP/1.1\r\nHost: {authority}\r\nX-Snapback-Admin-Token: planted-master\r\nConnection: close\r\n\r\n"
            ),
            "SNAPBACK_ADMIN_RELAY_MASTER_CREDENTIAL_REFUSED",
        ),
        (
            "unpublished app plane",
            format!("GET / HTTP/1.1\r\nHost: {authority}\r\nConnection: close\r\n\r\n"),
            "SNAPBACK_ADMIN_RELAY_ROUTE_REFUSED",
        ),
        (
            "out-of-namespace upgrade",
            format!(
                "GET /live/planted/stream HTTP/1.1\r\nHost: {authority}\r\nOrigin: {first_origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"
            ),
            "SNAPBACK_ADMIN_RELAY_ROUTE_REFUSED",
        ),
        (
            "hostile-origin upgrade",
            format!(
                "GET /_snapback/admin/ HTTP/1.1\r\nHost: {authority}\r\nOrigin: http://attacker.invalid\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"
            ),
            "SNAPBACK_ADMIN_RELAY_ORIGIN_REFUSED",
        ),
        (
            "policy-checked upgrade",
            format!(
                "GET /_snapback/admin/ HTTP/1.1\r\nHost: {authority}\r\nOrigin: {first_origin}\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n"
            ),
            "SNAPBACK_ADMIN_RELAY_WEBSOCKET_UNAVAILABLE",
        ),
    ] {
        let response = raw_request(&first_origin, &request);
        assert!(response.contains(expected), "{label}: {response}");
    }

    let wrong_origin_body = serde_json::to_string(&json!({ "claimCode": first_claim })).unwrap();
    let wrong_origin = raw_request(
        &first_origin,
        &format!(
            "POST /_snapback/api/console/claim/exchange HTTP/1.1\r\nHost: {authority}\r\nOrigin: http://attacker.invalid\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{wrong_origin_body}",
            wrong_origin_body.len()
        ),
    );
    assert!(wrong_origin.contains("SNAPBACK_ADMIN_RELAY_ORIGIN_REFUSED"));

    for ambiguous in [
        format!(
            "POST /_snapback/api/console/claim/exchange HTTP/1.1\r\nHost: {authority}\r\nContent-Length: 2\r\nTransfer-Encoding: chunked\r\n\r\n{{}}"
        ),
        format!(
            "POST /_snapback/api/console/claim/exchange HTTP/1.1\r\nHost: {authority}\r\nContent-Length: 2\r\nContent-Length: 3\r\n\r\n{{}}"
        ),
    ] {
        let response = raw_request(&first_origin, &ambiguous);
        assert!(
            response.starts_with("HTTP/1.1 400")
                || response.contains("SNAPBACK_ADMIN_RELAY_FRAMING_REFUSED"),
            "ambiguous framing was not refused: {response}"
        );
    }

    let pipeline_body = serde_json::to_string(&json!({ "claimCode": first_claim })).unwrap();
    let pipelined = raw_request(
        &first_origin,
        &format!(
            "GET /_snapback/admin/ HTTP/1.1\r\nHost: {authority}\r\nConnection: keep-alive\r\n\r\nPOST /_snapback/api/console/claim/exchange HTTP/1.1\r\nHost: {authority}\r\nOrigin: {first_origin}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{pipeline_body}",
            pipeline_body.len()
        ),
    );
    assert_eq!(
        pipelined.match_indices("HTTP/1.1").count(),
        1,
        "a pipelined follow-on reached the relay: {pipelined}"
    );

    let (exchange_status, exchanged) = post_json(
        &first_origin,
        "/_snapback/api/console/claim/exchange",
        json!({ "claimCode": first_claim }),
        &[("origin", &first_origin)],
    );
    assert_eq!(exchange_status, 200, "{exchanged}");
    assert_eq!(exchanged["provenance"], "operatorClaim");
    assert!(
        exchanged["reachability"]["sessionId"]
            .as_str()
            .unwrap()
            .starts_with("sbrs_")
    );
    let first_credential = exchanged["credential"].as_str().unwrap().to_owned();
    let first_observation = first.next_line();
    let first_observation = if first_observation.starts_with("relay-observed peer ") {
        first_observation
    } else {
        first.next_line()
    };
    assert!(
        first_observation.starts_with("relay-observed peer "),
        "LAN peer context was not labeled separately: {first_observation}"
    );
    let (write_status, _) = post_json(
        &first_origin,
        "/_snapback/api/app/reset",
        json!({}),
        &[
            ("origin", &first_origin),
            ("x-snapback-console-credential", &first_credential),
        ],
    );
    assert_eq!(
        write_status, 200,
        "credential-authenticated API is forwarded"
    );

    let (missing_credential, _) = post_json(
        &first_origin,
        "/_snapback/api/app/reset",
        json!({}),
        &[("origin", &first_origin)],
    );
    assert_eq!(missing_credential, 403);

    let (mut second, second_link) = start_lan_link(&server.ready_file, candidate.address);
    let (second_origin, second_claim) = split_link(&second_link);
    let (second_exchange, second_body) = post_json(
        &second_origin,
        "/_snapback/api/console/claim/exchange",
        json!({ "claimCode": second_claim }),
        &[("origin", &second_origin)],
    );
    assert_eq!(second_exchange, 200, "{second_body}");
    let second_credential = second_body["credential"].as_str().unwrap().to_owned();

    let revoked = snapback()
        .args([
            "admin",
            "link",
            "--revoke",
            &first_claim,
            "--ready-file",
            server.ready_file.to_str().unwrap(),
        ])
        .output()
        .unwrap();
    assert!(
        revoked.status.success(),
        "{}",
        String::from_utf8_lossy(&revoked.stderr)
    );
    assert!(first.wait(Duration::from_secs(6)).success());
    wait_until(Duration::from_secs(2), || listener_closed(&first_origin));
    assert!(
        !listener_closed(&second_origin),
        "one claim closed another relay"
    );
    assert_eq!(direct_reset(&server.server_url, &first_credential), 401);
    let first_warning = first.stderr();
    for required in [
        "plain HTTP",
        "On-link attackers",
        "single-use claim exchange",
        "ten-minute idle expiry",
        "ninety-minute absolute cap",
        "redemption record",
        "master revocation",
        "--tailscale",
    ] {
        assert!(
            first_warning.contains(required),
            "warning omitted {required}: {first_warning}"
        );
    }

    second.signal(libc::SIGTERM);
    assert!(second.wait(Duration::from_secs(6)).success());
    wait_until(Duration::from_secs(2), || listener_closed(&second_origin));
    assert_eq!(
        direct_reset(&server.server_url, &second_credential),
        401,
        "early front termination revokes its bound credential"
    );
    wait_until(Duration::from_secs(4), || {
        cors_origin(&server.server_url, &first_origin).is_none()
            && cors_origin(&server.server_url, &second_origin).is_none()
    });

    let (mut killed, killed_link) = start_lan_link(&server.ready_file, candidate.address);
    let (killed_origin, _) = split_link(&killed_link);
    assert_eq!(
        cors_origin(&server.server_url, &killed_origin).as_deref(),
        Some(killed_origin.as_str())
    );
    killed.signal(libc::SIGKILL);
    assert!(!killed.wait(Duration::from_secs(2)).success());
    wait_until(Duration::from_secs(1), || listener_closed(&killed_origin));
    wait_until(Duration::from_secs(5), || {
        cors_origin(&server.server_url, &killed_origin).is_none()
    });

    let (mut observer_lost, lost_link) = start_lan_link(&server.ready_file, candidate.address);
    let (lost_origin, lost_claim) = split_link(&lost_link);
    let (lost_exchange, lost_body) = post_json(
        &lost_origin,
        "/_snapback/api/console/claim/exchange",
        json!({ "claimCode": lost_claim }),
        &[("origin", &lost_origin)],
    );
    assert_eq!(lost_exchange, 200, "{lost_body}");
    server.child.kill().unwrap();
    let _ = server.child.wait();
    assert!(
        !observer_lost.wait(Duration::from_secs(6)).success(),
        "observation loss must be terminal"
    );
    wait_until(Duration::from_secs(1), || listener_closed(&lost_origin));

    let second_server_dir = temp.path().join("unredeemed-restart");
    std::fs::create_dir(&second_server_dir).unwrap();
    let mut second_server = start_server(&second_server_dir);
    let (mut unredeemed_restart, restart_link) =
        start_lan_link(&second_server.ready_file, candidate.address);
    let (restart_origin, _) = split_link(&restart_link);
    second_server.child.kill().unwrap();
    let _ = second_server.child.wait();
    assert!(
        !unredeemed_restart.wait(Duration::from_secs(6)).success(),
        "an unredeemed server restart must be terminal"
    );
    wait_until(Duration::from_secs(1), || listener_closed(&restart_origin));
}

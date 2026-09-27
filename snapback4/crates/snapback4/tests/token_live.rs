//! CLI minting on the actual dev/serve owner, including the public-listener boundary.
#![cfg(unix)]
use std::{fs, io::{BufRead, BufReader, Read, Write}, net::{SocketAddr, TcpStream, UdpSocket},
    os::unix::fs::{PermissionsExt, symlink}, path::PathBuf, process::{Child, Command, Output, Stdio},
    sync::{atomic::{AtomicUsize, Ordering}, mpsc}, time::Duration};
use serde_json::{Value, json};
use sha2::{Digest, Sha256};

const BIN: &str = env!("CARGO_BIN_EXE_snapback4");
const HEADER: &str = "x-snapback-store-secret";
#[path = "token_live/protocol.rs"]
mod protocol;
const DAY: i64 = 86_400_000;

struct Project { root: PathBuf, release: bool }
impl Project {
    fn new(release: bool) -> Self {
        static NEXT: AtomicUsize = AtomicUsize::new(0);
        let root = std::env::temp_dir().join(format!("snapback4-token-{}-{}", std::process::id(), NEXT.fetch_add(1, Ordering::Relaxed)));
        fs::create_dir_all(root.join("snapback")).unwrap();
        fs::write(root.join("snapback/schema.q"), "use identity\nquery who():\n  return viewer\n").unwrap();
        let p = Self { root: root.canonicalize().unwrap(), release };
        if release { success(p.run(&["deploy", "release"])); }
        p
    }
    fn store(&self) -> PathBuf { self.root.join(if self.release { "release/store.sqlite" } else { ".snapback4/store.sqlite" }) }
    fn proof(&self) -> PathBuf { PathBuf::from(format!("{}-token", self.store().display())) }
    fn secret(&self) -> String { fs::read_to_string(self.proof()).unwrap() }
    fn run(&self, args: &[&str]) -> Output { Command::new(BIN).current_dir(&self.root).args(args).output().unwrap() }
    fn mint(&self, name: &str, days: &str) -> Output {
        let mut args = vec!["token", "--service", name, "--days", days, "--json"];
        if self.release { args.extend(["--release", "release"]); }
        self.run(&args)
    }
    fn sessions(&self) -> i64 {
        rusqlite::Connection::open(self.store()).unwrap().query_row("SELECT count(*) FROM _sessions", [], |r| r.get(0)).unwrap()
    }
    fn assert_session(&self, token: &str, name: &str, days: i64) {
        let conn = rusqlite::Connection::open(self.store()).unwrap();
        let digest = format!("{:x}", Sha256::digest(token.as_bytes()));
        let (principal, kind, created, expiry, family): (String, String, i64, i64, String) = conn.query_row(
            "SELECT principal, kind, created_at, expires_at, family FROM _sessions WHERE token_digest=?1", [&digest],
            |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?, r.get(3)?, r.get(4)?))).unwrap();
        assert_eq!(principal, format!("service:{name}")); assert_eq!(kind, "service");
        assert_eq!(expiry - created, days * DAY); assert_eq!(family, digest);
        assert!((created - snapback4_core::now_ms()).abs() < 30_000, "wall-clock expiry, even with dev's clock offset");
    }
}
impl Drop for Project { fn drop(&mut self) { let _ = fs::remove_dir_all(&self.root); } }

struct Host { child: Child, address: SocketAddr }
impl Host {
    fn start(p: &Project, bind: &str) -> Self {
        Self::with_flags(p, bind, &[])
    }
    fn with_flags(p: &Project, bind: &str, flags: &[&str]) -> Self {
        let mut args = if p.release { vec!["serve", "release"] } else { vec!["dev", "--no-watch", "--clock-offset", "+25h"] };
        args.extend(["--port", "0", "--bind", bind, "--i-understand-cleartext"]);
        args.extend_from_slice(flags);
        let mut child = Command::new(BIN).current_dir(&p.root).args(args).stdout(Stdio::piped())
            .stderr(fs::File::create(p.root.join("server.log")).unwrap()).spawn().unwrap();
        let stdout = child.stdout.take().unwrap();
        let (send, receive) = mpsc::channel();
        std::thread::spawn(move || {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new(); reader.read_line(&mut line).unwrap(); send.send(line).ok();
            io_drain(reader);
        });
        let line = receive.recv_timeout(Duration::from_secs(30));
        if !matches!(&line, Ok(line) if line.starts_with("http://")) {
            let _ = child.kill(); let _ = child.wait();
            panic!("no readiness URL: {line:?}; {}", fs::read_to_string(p.root.join("server.log")).unwrap());
        }
        let published: SocketAddr = line.unwrap().trim().strip_prefix("http://").unwrap().parse().unwrap();
        let address = SocketAddr::new(if published.ip().is_unspecified() {
            if published.is_ipv4() { "127.0.0.1".parse().unwrap() } else { "::1".parse().unwrap() }
        } else { published.ip() }, published.port());
        Self { child, address }
    }
    fn who(&self, token: &str) {
        let (status, reply) = request(self.address, self.address, "/q/who", &format!("Authorization: Bearer {token}\r\n"), "{}");
        assert_eq!(status, 200); assert_eq!(reply["data"], "service:ranker");
    }
}
fn io_drain(mut reader: impl Read) { let _ = std::io::copy(&mut reader, &mut std::io::sink()); }
impl Drop for Host { fn drop(&mut self) { let _ = self.child.kill(); let _ = self.child.wait(); } }
fn success(out: Output) -> String {
    assert!(out.status.success(), "{}", String::from_utf8_lossy(&out.stderr));
    String::from_utf8(out.stdout).unwrap()
}
fn token(out: Output) -> String {
    let stderr = String::from_utf8_lossy(&out.stderr).into_owned();
    let output = success(out);
    assert_eq!(output.len(), 44); assert_eq!(&output[43..], "\n");
    let token = output.trim_end().to_owned();
    assert!(!stderr.contains(&token)); assert!(stderr.contains("printed once") && stderr.contains("store.sqlite"));
    token
}
fn request(address: SocketAddr, host: SocketAddr, path: &str, headers: &str, body: &str) -> (u16, Value) {
    let mut socket = TcpStream::connect_timeout(&address, Duration::from_secs(3)).unwrap();
    socket.set_read_timeout(Some(Duration::from_secs(10))).unwrap();
    write!(socket, "POST {path} HTTP/1.0\r\nHost: {host}\r\nConnection: close\r\nContent-Length: {}\r\n{headers}\r\n{body}", body.len()).unwrap();
    let mut reply = String::new(); socket.read_to_string(&mut reply).unwrap();
    let (head, body) = reply.split_once("\r\n\r\n").unwrap();
    (head.split_whitespace().nth(1).unwrap().parse().unwrap(), serde_json::from_str(body).unwrap())
}

fn mint_paths(release: bool) {
    let p = Project::new(release);
    let host = Host::start(&p, "127.0.0.1");
    assert_eq!(fs::metadata(p.proof()).unwrap().permissions().mode() & 0o777, 0o600);
    assert_eq!(fs::metadata(p.store().parent().unwrap()).unwrap().permissions().mode() & 0o777, 0o700);
    let first_secret = p.secret();
    let first = token(p.mint("ranker", "2")); p.assert_session(&first, "ranker", 2); host.who(&first);
    let mut args = vec!["token", "--service", "ranker"];
    if release { args.extend(["--release", "release"]); }
    let default = token(p.run(&args)); p.assert_session(&default, "ranker", 365);
    let logs = fs::read_to_string(p.root.join("server.log")).unwrap();
    assert!(!logs.contains(&first_secret) && !logs.contains(&first) && !logs.contains(&default));
    // The exact same validation, default and clamping apply live and offline.
    for (days, expected) in [("0", 1), ("4000", 3650), ("nonnumeric", 365)] {
        let minted = token(p.mint("ranker", days)); p.assert_session(&minted, "ranker", expected);
    }
    let refused = p.mint("invalid/name", "2");
    assert_eq!(refused.status.code(), Some(1)); assert!(refused.stdout.is_empty());
    assert!(String::from_utf8_lossy(&refused.stderr).contains("1–64"));
    drop(host);
    for (days, expected) in [("0", 1), ("4000", 3650), ("nonnumeric", 365)] {
        let minted = token(p.mint("ranker", days)); p.assert_session(&minted, "ranker", expected);
    }
    let refused = p.mint("invalid/name", "2"); assert_eq!(refused.status.code(), Some(1)); assert!(refused.stdout.is_empty());
    let offline = token(p.mint("ranker", "2")); p.assert_session(&offline, "ranker", 2);
    let host = Host::start(&p, "127.0.0.1");
    assert_ne!(p.secret(), first_secret); host.who(&first); host.who(&offline);
    let before = p.sessions();
    let body = protocol::body(&p);
    let (client, challenge) = protocol::challenge(host.address, &body);
    let headers = protocol::headers(&first_secret, &client, challenge["server_nonce"].as_str().unwrap(), &body);
    let (status, reply) = request(host.address, host.address, "/dev/token", &headers, &body.to_string());
    assert_eq!(status, 403); assert_eq!(reply["denied"]["code"], "E_AUTH"); assert_eq!(p.sessions(), before);
}

#[test] fn dev_live_and_offline_share_validation_expiry_and_durable_sessions() { mint_paths(false); }
#[test] fn serve_live_and_offline_share_validation_expiry_and_durable_sessions() { mint_paths(true); }

#[test]
fn public_listeners_refuse_remote_peers_and_missing_wrong_duplicate_or_browser_proofs() {
    let socket = UdpSocket::bind("0.0.0.0:0").unwrap();
    socket.connect("192.0.2.1:9").unwrap(); // Determines our interface without sending a packet.
    let remote_ip = socket.local_addr().unwrap().ip(); assert!(!remote_ip.is_loopback());
    for release in [false, true] {
        let p = Project::new(release); let host = Host::start(&p, "0.0.0.0");
        let before = p.sessions(); let body = protocol::body(&p); let json = body.to_string();
        let remote = SocketAddr::new(remote_ip, host.address.port());
        let (client, challenge) = protocol::challenge(host.address, &body);
        let server = challenge["server_nonce"].as_str().unwrap();
        let proof = protocol::headers(&p.secret(), &client, server, &body);
        let hello = format!("{}: {client}\r\n", protocol::CLIENT);
        let (_, uniform) = request(host.address, host.address, "/dev/token", "", &json);
        for headers in [hello.clone(), proof.clone()] {
            for (address, extra) in [
                (remote, "X-Forwarded-For: 127.0.0.1\r\nForwarded: for=127.0.0.1\r\n".into()),
                (host.address, "Origin: http://localhost\r\n".into()),
                (host.address, "Origin: null\r\n".into()),
                (host.address, "Host: 127.0.0.1\r\n".into()),
                (host.address, format!("{}: {client}\r\n", protocol::CLIENT)),
                (host.address, format!("{HEADER}: {}\r\n", p.secret())),
            ] {
                let (status, reply) = request(address, host.address, "/dev/token", &format!("{headers}{extra}"), &json);
                assert_eq!(status, 403); assert_eq!(reply, uniform);
            }
            let (status, reply) = request(host.address, remote, "/dev/token", &headers, &json);
            assert_eq!(status, 403); assert_eq!(reply, uniform);
        }
        for headers in [String::new(), format!("{proof}{}: {server}\r\n", protocol::SERVER),
            format!("{proof}{}: {}\r\n", protocol::PROOF, "0".repeat(64)),
            format!("{hello}{}: {}\r\n", protocol::PROOF, "0".repeat(64)),
            "x-snapback-persona: alice\r\nAuthorization: Bearer arbitrary\r\n".into()] {
            let (status, reply) = request(host.address, host.address, "/dev/token", &headers, &json);
            assert_eq!(status, 403); assert_eq!(reply, uniform);
        }
        for body in ["not json".into(), json!({"service":"ranker", "days":2, "extra":true}).to_string(), " ".repeat(4097)] {
            let (status, reply) = request(host.address, host.address, "/dev/token", &hello, &body);
            assert_eq!(status, 403); assert_eq!(reply, uniform);
        }
        let wrong = protocol::headers(&"0".repeat(64), &client, server, &body);
        let (status, reply) = request(host.address, host.address, "/dev/token", &wrong, &json);
        assert_eq!(status, 403); assert_eq!(reply, uniform);
        let (status, _) = request(host.address, host.address, "/dev/token", &proof, &json);
        assert_eq!(status, 403, "wrong proof consumed the challenge");
        assert_eq!(p.sessions(), before, "refusals never mint");
        host.who(&token(p.mint("ranker", "2"))); // Wildcard discovery dials loopback.
    }
}

#[test]
fn unreachable_old_and_wrong_store_listeners_refuse_without_offline_writes() {
    let p = Project::new(false); let _host = Host::start(&p, "127.0.0.1");
    let other = Project::new(false); let other_host = Host::start(&other, "127.0.0.1");
    let record = p.store().parent().unwrap().join("serve.lock");
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let unavailable = listener.local_addr().unwrap(); drop(listener);
    for address in [unavailable, other_host.address, "192.0.2.1:4400".parse().unwrap()] {
        fs::write(&record, format!("{}\nhttp://{address}\n", address.port())).unwrap();
        let out = p.mint("ranker", "2");
        assert_eq!(out.status.code(), Some(2)); assert!(out.stdout.is_empty());
        let error = String::from_utf8(out.stderr).unwrap();
        assert!(error.contains("E_STORE_BUSY") && error.contains(&address.to_string()) && error.contains("rerun") && error.contains("offline"), "{error}");
    }
    fs::write(&record, format!("{}\nhttp://{}\n", other_host.address.port(), other_host.address)).unwrap();
    fs::remove_file(p.proof()).unwrap(); // An older owner has an address, but no local-mint proof.
    let old = p.mint("ranker", "2"); assert!(!old.status.success()); assert!(old.stdout.is_empty());
    assert!(String::from_utf8_lossy(&old.stderr).contains("no mint request sent"));
    assert_eq!(p.sessions(), 0); assert_eq!(other.sessions(), 0);
}

#[test]
fn private_proof_rejects_links_public_modes_and_unreadable_files() {
    let p = Project::new(false); let host = Host::start(&p, "127.0.0.1");
    let before = p.sessions(); let proof = p.secret();
    let outside = p.root.join("outside"); fs::write(&outside, &proof).unwrap();
    fs::remove_file(p.proof()).unwrap(); symlink(&outside, p.proof()).unwrap();
    let out = p.mint("ranker", "2"); assert!(!out.status.success()); assert!(out.stdout.is_empty());
    fs::remove_file(p.proof()).unwrap(); fs::hard_link(&outside, p.proof()).unwrap();
    assert!(!p.mint("ranker", "2").status.success());
    fs::remove_file(p.proof()).unwrap(); fs::write(p.proof(), &proof).unwrap();
    fs::set_permissions(p.proof(), fs::Permissions::from_mode(0o644)).unwrap();
    assert!(!p.mint("ranker", "2").status.success());
    fs::set_permissions(p.proof(), fs::Permissions::from_mode(0o000)).unwrap();
    assert!(!p.mint("ranker", "2").status.success());
    assert_eq!(p.sessions(), before); assert_eq!(fs::read_to_string(outside).unwrap(), proof);
    drop(host);
    // A stale proof is never used offline, even if unreadable.
    let minted = token(p.mint("ranker", "2")); p.assert_session(&minted, "ranker", 2);
}

#[test]
fn ipv6_loopback_discovery_mints() {
    let p = Project::new(false); let host = Host::start(&p, "::1");
    host.who(&token(p.mint("ranker", "2")));
}

#[test]
fn first_dev_store_is_still_required_and_temporary_dev_never_publishes_a_proof() {
    let p = Project::new(false);
    let out = p.mint("ranker", "2");
    assert_eq!(out.status.code(), Some(2)); assert!(out.stdout.is_empty()); assert!(!p.store().exists());
    assert!(String::from_utf8_lossy(&out.stderr).contains("run `snapback4 dev` first"));
    let host = Host::with_flags(&p, "127.0.0.1", &["--fresh"]);
    assert!(!p.proof().exists()); assert!(!p.store().exists());
    assert!(!p.mint("ranker", "2").status.success());
    let (status, _) = request(host.address, host.address, "/dev/token", &format!("{HEADER}: {}\r\n", "a".repeat(64)), r#"{"service":"ranker","days":2}"#);
    assert_eq!(status, 403);
}

#[test]
fn startup_refuses_proof_symlinks_and_hard_links_without_overwriting_the_target() {
    for hard in [false, true] {
        let p = Project::new(true);
        let outside = p.root.join("outside"); fs::write(&outside, "sentinel").unwrap();
        if hard { fs::hard_link(&outside, p.proof()).unwrap(); } else { symlink(&outside, p.proof()).unwrap(); }
        let out = p.run(&["serve", "release", "--port", "0"]);
        assert!(!out.status.success()); assert!(out.stdout.is_empty());
        assert!(String::from_utf8_lossy(&out.stderr).contains("E_STORE"));
        assert_eq!(fs::read_to_string(outside).unwrap(), "sentinel"); assert_eq!(p.sessions(), 0);
    }
}

#[test]
fn proofs_bind_every_request_field_and_only_one_completion_can_mint() {
    for release in [false, true] {
        let p = Project::new(release); let host = Host::start(&p, "127.0.0.1");
        let body = protocol::body(&p);
        for field in ["service", "days", "store", "client_nonce", "server_nonce", "direction"] {
            let (client, challenge) = protocol::challenge(host.address, &body);
            let server = challenge["server_nonce"].as_str().unwrap();
            assert_eq!(challenge["server_proof"], protocol::tag(&p.secret(), "snapback4-token-server", &client, server, &body));
            let mut headers = protocol::headers(&p.secret(), &client, server, &body);
            let mut changed = body.clone();
            match field {
                "service" => changed["service"] = json!("other"), "days" => changed["days"] = json!(3),
                "store" => changed["store"] = json!("0".repeat(64)),
                "client_nonce" => headers = headers.replace(&client, &"0".repeat(64)),
                "server_nonce" => headers = headers.replace(server, &"0".repeat(64)),
                "direction" => headers = format!("{}: {client}\r\n{}: {server}\r\n{}: {}\r\n", protocol::CLIENT, protocol::SERVER, protocol::PROOF, challenge["server_proof"].as_str().unwrap()),
                _ => unreachable!(),
            }
            let (status, _) = request(host.address, host.address, "/dev/token", &headers, &changed.to_string());
            assert_eq!(status, 403, "{field}"); assert_eq!(p.sessions(), 0);
        }
        let (client, challenge) = protocol::challenge(host.address, &body);
        let headers = protocol::headers(&p.secret(), &client, challenge["server_nonce"].as_str().unwrap(), &body);
        let (status, reply) = request(host.address, host.address, "/dev/token", &headers, &body.to_string());
        assert_eq!(status, 200); assert!(reply["sealed"].is_string()); assert!(reply.get("session").is_none());
        assert_eq!(p.sessions(), 1);
        let (status, _) = request(host.address, host.address, "/dev/token", &headers, &body.to_string());
        assert_eq!(status, 403); assert_eq!(p.sessions(), 1);
    }
}

#[test]
fn impostor_captures_only_a_nonce_and_cannot_mint_or_elicit_a_client_proof() {
    let p = Project::new(false); let host = Host::start(&p, "0.0.0.0");
    let body = protocol::body(&p);
    // Use address-hint redirection to deliver the CLI to a real impostor on every
    // OS. This exercises the BSD interception outcome without requiring Linux
    // to permit a second bind to a wildcard listener's port.
    for variant in ["forged", "stale", "service", "days", "store"] {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        fs::write(p.store().with_file_name("serve.lock"), format!("{}\nhttp://{address}\n", address.port())).unwrap();
        let secret = p.secret(); let real = host.address;
        let thread = std::thread::spawn(move || {
            let (mut socket, _) = listener.accept().unwrap();
            let wire = protocol::read_http(&mut socket);
            let client = protocol::wire_header(&wire, protocol::CLIENT);
            let mut body: Value = serde_json::from_str(wire.split_once("\r\n\r\n").unwrap().1).unwrap();
            let challenge = match variant {
                "forged" => json!({"server_nonce":"0".repeat(64),"server_proof":"0".repeat(64)}),
                "stale" => protocol::challenge(real, &body).1,
                field => {
                    body[field] = if field == "days" { json!(3) } else { json!("other") };
                    // A valid MAC for a different binding must also fail at the CLI.
                    let server = "a".repeat(64);
                    json!({"server_nonce":server,"server_proof":protocol::tag(&secret,"snapback4-token-server", client, &server, &body)})
                }
            }.to_string();
            write!(socket, "HTTP/1.0 200 OK\r\nContent-Length: {}\r\n\r\n{challenge}", challenge.len()).unwrap();
            drop(socket); (listener, wire)
        });
        let out = p.mint("ranker", "2");
        assert_eq!(out.status.code(), Some(2)); assert!(out.stdout.is_empty());
        assert!(String::from_utf8_lossy(&out.stderr).contains("no mint proof sent"));
        let (listener, wire) = thread.join().unwrap();
        listener.set_nonblocking(true).unwrap();
        assert_eq!(listener.accept().unwrap_err().kind(), std::io::ErrorKind::WouldBlock, "no second request or retry");
        assert!(!wire.contains(&p.secret())); assert!(!wire.to_ascii_lowercase().contains(HEADER));
        assert!(!wire.to_ascii_lowercase().contains(protocol::PROOF));
        let replay = protocol::send_raw(host.address, &protocol::forward_request(&wire, host.address));
        let replay: Value = serde_json::from_str(replay.split_once("\r\n\r\n").unwrap().1).unwrap();
        assert!(replay.get("session").is_none()); assert!(replay.get("sealed").is_none());
        let client = protocol::wire_header(&wire, protocol::CLIENT);
        let reflected = format!("{}: {client}\r\n{}: {}\r\n{}: {}\r\n", protocol::CLIENT, protocol::SERVER,
            replay["server_nonce"].as_str().unwrap(), protocol::PROOF, replay["server_proof"].as_str().unwrap());
        let (status, _) = request(host.address, host.address, "/dev/token", &reflected, &body.to_string());
        assert_eq!(status, 403); assert_eq!(p.sessions(), 0);
    }
}

#[test]
fn a_forwarding_impostor_cannot_read_the_minted_token_or_replay_completion() {
    let p = Project::new(false); let host = Host::start(&p, "0.0.0.0");
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap(); let address = listener.local_addr().unwrap();
    fs::write(p.store().with_file_name("serve.lock"), format!("{}\nhttp://{address}\n", address.port())).unwrap();
    let real = host.address;
    let thread = std::thread::spawn(move || {
        let mut capture = Vec::new();
        for _ in 0..2 {
            let (mut socket, _) = listener.accept().unwrap(); let wire = protocol::read_http(&mut socket);
            let forwarded = protocol::forward_request(&wire, real);
            let response = protocol::send_raw(real, &forwarded); socket.write_all(response.as_bytes()).unwrap();
            capture.push((forwarded, response));
        }
        capture
    });
    let minted = token(p.mint("ranker", "2")); host.who(&minted);
    let capture = thread.join().unwrap();
    for (request, response) in &capture {
        assert!(!request.contains(&p.secret()) && !response.contains(&p.secret()));
        assert!(!request.contains(&minted) && !response.contains(&minted));
    }
    assert!(capture[1].1.contains("\"sealed\""));
    let replay = protocol::send_raw(host.address, &capture[1].0);
    assert!(replay.starts_with("HTTP/1.0 403 ")); assert_eq!(p.sessions(), 1);
    assert!(!fs::read_to_string(p.root.join("server.log")).unwrap().contains(&minted));
}

#[test]
fn ipv6_wildcard_refuses_ipv4_mapped_loopback_and_remote_peers() {
    let socket = UdpSocket::bind("0.0.0.0:0").unwrap(); socket.connect("192.0.2.1:9").unwrap();
    let remote_ip = socket.local_addr().unwrap().ip(); assert!(!remote_ip.is_loopback());
    for release in [false, true] {
        let p = Project::new(release); let host = Host::start(&p, "::");
        let body = protocol::body(&p); let (client, challenge) = protocol::challenge(host.address, &body);
        let headers = protocol::headers(&p.secret(), &client, challenge["server_nonce"].as_str().unwrap(), &body);
        // On a dual-stack [::] listener these are ::ffff:127.0.0.1 and
        // ::ffff:<interface>. Both fail closed; never classify all mapped IPs as local.
        for ip in ["127.0.0.1".parse().unwrap(), remote_ip] {
            let mapped = SocketAddr::new(ip, host.address.port());
            let (status, _) = request(mapped, host.address, "/dev/token", &headers, &body.to_string());
            assert_eq!(status, 403); assert_eq!(p.sessions(), 0);
        }
        host.who(&token(p.mint("ranker", "2"))); // Native ::1 discovery still works.
    }
}

#[test]
fn literal_host_no_origin_and_no_cors_apply_to_both_rounds() {
    let p = Project::new(false); let host = Host::start(&p, "127.0.0.1"); let body = protocol::body(&p);
    let (client, challenge) = protocol::challenge(host.address, &body);
    let proof = protocol::headers(&p.secret(), &client, challenge["server_nonce"].as_str().unwrap(), &body);
    for headers in [format!("{}: {client}\r\n", protocol::CLIENT), proof] {
        for (method, authority, origin) in [("POST", "localhost", ""), ("POST", "evil.test", ""),
            ("POST", "127.0.0.1", "Origin: http://127.0.0.1\r\n"), ("OPTIONS", "127.0.0.1", "")] {
            let body = body.to_string();
            let wire = format!("{method} /dev/token HTTP/1.0\r\nHost: {authority}\r\n{origin}{headers}Content-Length: {}\r\n\r\n{body}", body.len());
            let reply = protocol::send_raw(host.address, &wire);
            assert!(reply.starts_with("HTTP/1.0 403 "), "{reply}");
            let headers = reply.split_once("\r\n\r\n").unwrap().0.to_ascii_lowercase();
            assert!(!headers.contains("access-control-allow-origin")); assert!(headers.contains("cache-control: no-store"));
        }
    }
    assert_eq!(p.sessions(), 0);
}

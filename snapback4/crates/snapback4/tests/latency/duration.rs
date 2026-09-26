use super::*;
use std::io::{BufRead, BufReader};

fn png(size: usize) -> Vec<u8> {
    let mut bytes = b"\x89PNG\r\n\x1a\n\x00\x00\x00\x0dIHDR\x00\x00\x00\x01\x00\x00\x00\x01".to_vec();
    bytes.resize(size, 0); bytes
}
fn asset(host: &Host, size: usize) -> String {
    let bytes = png(size);
    let mut engine = lock(&host.shared.engine);
    let upload = engine.prepare_asset("dev:alice", snapback4_core::assets::sniff(&bytes).unwrap(), size as u64, host.shared.now()).unwrap().write(&bytes).unwrap();
    engine.finish_asset(upload).unwrap().id
}
fn get(host: &Host, path: &str, body_length: usize) -> BufReader<TcpStream> {
    let mut stream = TcpStream::connect(host.address).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    write!(stream, "GET {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{PERSONA}Content-Length: {body_length}\r\n\r\n").unwrap();
    BufReader::new(stream)
}
fn head(reader: &mut BufReader<TcpStream>) -> String {
    let mut head = String::new();
    loop {
        let mut line = String::new();
        assert!(reader.read_line(&mut line).unwrap() > 0);
        head.push_str(&line);
        if line == "\r\n" { break; }
    }
    assert_eq!(status(&head), 200, "{head}"); head
}
fn content_length(head: &str) -> usize {
    head.lines().find_map(|line| line.to_ascii_lowercase().strip_prefix("content-length: ").and_then(|n| n.parse().ok())).unwrap()
}

#[test]
fn latency_total_excludes_post_response_drain_for_changes_and_asset() {
    let host = Host::new(true);
    let id = asset(&host, 24);
    for (path, operation, delay) in [
        ("/changes?wait=0".to_owned(), "/changes", 500),
        (format!("/assets/{id}"), "/assets (download)", 300),
    ] {
        let began = Instant::now();
        let mut reader = get(&host, &path, 2048);
        let headers = head(&mut reader);
        let mut body = vec![0; content_length(&headers)];
        reader.read_exact(&mut body).unwrap();
        let arrived = began.elapsed();
        // The complete framed reply is already here, but disposal cannot finish
        // until this request's 2 KiB body arrives.
        thread::sleep(Duration::from_millis(delay));
        reader.get_mut().write_all(&vec![b'x'; 2048]).unwrap();
        let mut tail = Vec::new(); reader.read_to_end(&mut tail).unwrap();
        let result = counted(&host, operation, 1);
        let total = result["operations"][operation]["total"]["max"].as_f64().unwrap();
        println!("{path}: complete response={arrived:?}; withheld body={delay}ms; total={total:.3}ms");
        assert!(total <= arrived.as_secs_f64() * 1000.0 + 50.0, "post-response drain entered total: {result}");
    }
}

#[test]
fn latency_query_total_includes_controlled_engine_work() {
    let dir = std::env::temp_dir().join(format!("sb4-lt-query-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    let host = Host::with_store(true, snapback4_core::Store::open(&dir.join("store.sqlite")).unwrap(), SOURCE);
    let (entered, received) = mpsc::channel();
    *lock(&host.shared.query_wait) = Some(Arc::new(move || {
        entered.send(()).unwrap(); thread::sleep(Duration::from_millis(150));
    }));
    let reply = host.request("POST", "/q/read", PERSONA, "{}");
    received.recv_timeout(Duration::from_secs(1)).unwrap();
    assert_eq!(status(&reply), 200);
    let result = counted(&host, "/q/read", 1);
    let total = result["operations"]["/q/read"]["total"]["max"].as_f64().unwrap();
    println!("query engine work held 150ms: total={total:.3}ms");
    assert!(total >= 150.0, "engine work missing from total: {result}");
    drop(host); let _ = std::fs::remove_dir_all(dir);
}

#[test]
fn latency_held_poll_ends_at_final_frame_before_request_body_drain() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
    let mut reader = get(&host, "/changes?wait=25&heartbeat=1", 2048);
    let headers = head(&mut reader);
    assert!(headers.contains("Transfer-Encoding: chunked"));
    let mut heartbeat = [0; 6]; reader.read_exact(&mut heartbeat).unwrap();
    assert_eq!(&heartbeat, b"1\r\n\n\r\n");
    let first = Instant::now();
    thread::sleep(Duration::from_millis(180));
    host.request("POST", "/m/put", PERSONA, r#"{"id":"wake","args":{"n":1}}"#);
    let mut frame = String::new(); reader.read_line(&mut frame).unwrap();
    let length = usize::from_str_radix(frame.trim(), 16).unwrap();
    let mut final_body = vec![0; length + 7]; reader.read_exact(&mut final_body).unwrap();
    assert!(final_body.ends_with(b"\r\n0\r\n\r\n"));
    let final_elapsed = first.elapsed();
    thread::sleep(Duration::from_millis(300));
    reader.get_mut().write_all(&vec![b'x'; 2048]).unwrap();
    let mut tail = Vec::new(); reader.read_to_end(&mut tail).unwrap();
    let result = counted(&host, "/changes", 1);
    let total = result["operations"]["/changes"]["total"]["max"].as_f64().unwrap();
    println!("held poll final frame after heartbeat={final_elapsed:?}; withheld body=300ms; total={total:.3}ms");
    assert!(total >= 180.0, "first heartbeat ended total: {result}");
    assert!(total < final_elapsed.as_secs_f64() * 1000.0 + 100.0, "body drain entered total: {result}");
}

#[test]
fn latency_large_asset_total_includes_blocked_socket_write() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), &SCHEMA.replace("image <=1024", "image <=64000000"));
    let size = 32 << 20;
    let id = asset(&host, size);
    let mut reader = get(&host, &format!("/assets/{id}"), 0);
    let headers = head(&mut reader);
    // Body is streamed (chunked for HTTP/1.1). 32 MiB exceeds the socket's
    // send/receive buffers, so withholding reads holds the final write.
    assert!(headers.contains("Transfer-Encoding: chunked"));
    thread::sleep(Duration::from_millis(200));
    let mut bytes = Vec::new(); reader.read_to_end(&mut bytes).unwrap();
    assert!(bytes.len() >= size);
    let result = counted(&host, "/assets (download)", 1);
    let total = result["operations"]["/assets (download)"]["total"]["max"].as_f64().unwrap();
    println!("32MiB asset; socket reads held 200ms: total={total:.3}ms");
    assert!(total >= 200.0, "asset write missing from total: {result}");
    assert_eq!(result["operations"]["/assets (download)"]["refused"], 0);
}

#[test]
fn latency_panicking_handler_excludes_withheld_request_body_cleanup() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
    *lock(&host.shared.request_work) = Some(Arc::new(|| panic!("intentional unanswered handler")));
    let began = Instant::now();
    let mut stream = TcpStream::connect(host.address).unwrap();
    stream.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    write!(stream, "POST /q/read HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{PERSONA}Content-Length: 2048\r\n\r\n").unwrap();
    let mut reader = BufReader::new(stream);
    let mut headers = String::new();
    loop {
        let mut line = String::new(); assert!(reader.read_line(&mut line).unwrap() > 0);
        headers.push_str(&line); if line == "\r\n" { break; }
    }
    assert_eq!(status(&headers), 500);
    let arrived = began.elapsed();
    *lock(&host.shared.request_work) = None;
    thread::sleep(Duration::from_millis(300));
    reader.get_mut().write_all(&vec![b'x'; 2048]).unwrap();
    let mut tail = Vec::new(); reader.read_to_end(&mut tail).unwrap();
    let result = counted(&host, "/q/read", 1);
    let op = &result["operations"]["/q/read"];
    assert_eq!(op["refused"], 1);
    let total = op["total"]["max"].as_f64().unwrap();
    println!("panicking handler; 500 at {arrived:?}; body withheld 300ms; total={total:.3}ms");
    assert!(total < arrived.as_secs_f64() * 1000.0 + 50.0, "panic cleanup entered total: {result}");
}

// Constrain real TCP buffers before connecting, so final response writes block
// when the client stops reading. Shared by JSON and held-poll regressions.
fn constrained_socket() -> (Server, TcpStream) {
    use std::os::fd::{AsRawFd, FromRawFd};
    let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
    let buffer: libc::c_int = 1024;
    let set_buffer = |fd, option| {
        assert_eq!(unsafe { libc::setsockopt(fd, libc::SOL_SOCKET, option, (&buffer as *const libc::c_int).cast(), std::mem::size_of_val(&buffer) as _) }, 0);
    };
    set_buffer(listener.as_raw_fd(), libc::SO_SNDBUF);
    let address = listener.local_addr().unwrap();
    let server = Server::from_listener(listener, None).unwrap();
    let fd = unsafe { libc::socket(libc::AF_INET, libc::SOCK_STREAM, 0) };
    assert!(fd >= 0);
    assert_eq!(unsafe { libc::fcntl(fd, libc::F_SETFD, libc::FD_CLOEXEC) }, 0);
    let reader = unsafe { TcpStream::from_raw_fd(fd) };
    set_buffer(reader.as_raw_fd(), libc::SO_RCVBUF);
    // Set the receive window before the handshake; changing it afterwards can
    // leave the peer enough previously advertised credit for the entire reply.
    let mut target: libc::sockaddr_in = unsafe { std::mem::zeroed() };
    #[cfg(target_os = "macos")]
    { target.sin_len = std::mem::size_of_val(&target) as _; }
    target.sin_family = libc::AF_INET as _;
    target.sin_port = address.port().to_be();
    target.sin_addr.s_addr = u32::from_ne_bytes([127, 0, 0, 1]);
    assert_eq!(unsafe { libc::connect(reader.as_raw_fd(), (&target as *const libc::sockaddr_in).cast(), std::mem::size_of_val(&target) as _) }, 0);
    reader.set_read_timeout(Some(Duration::from_secs(5))).unwrap();
    (server, reader)
}

#[test]
fn latency_small_json_total_includes_blocked_socket_write() {
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), SOURCE);
    let (server, mut reader) = constrained_socket();
    reader.write_all(b"POST /q/read HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Length: 0\r\n\r\n").unwrap();
    let request = server.recv().unwrap();
    let sample = latency::Sample::new(&request, &host.shared.latency).unwrap();
    let payload = "x".repeat(16 * 1024);
    let expected = json!({"data":payload});
    let answer = expected.clone();
    let worker = thread::spawn(move || sample.run(|| {
        let mut request = request;
        request.set_cleanup_guard(latency::FinishOnDrop);
        respond(request, 200, answer);
    }));
    let mut first = [0]; reader.read_exact(&mut first).unwrap();
    thread::sleep(Duration::from_millis(200));
    let mut bytes = first.to_vec(); reader.read_to_end(&mut bytes).unwrap();
    worker.join().unwrap();
    let response = String::from_utf8(bytes).unwrap();
    assert_eq!(status(&response), 200);
    assert!(!response.contains("Transfer-Encoding: chunked"));
    assert_eq!(body(&response), expected);
    let result = counted(&host, "/q/read", 1);
    let total = result["operations"]["/q/read"]["total"]["max"].as_f64().unwrap();
    println!("16KiB JSON; socket reads held 200ms: total={total:.3}ms");
    assert!(total >= 200.0, "JSON write missing from total: {result}");
    assert_eq!(result["operations"]["/q/read"]["refused"], 0);
}

#[test]
fn latency_disconnected_asset_records_exactly_one_sample_and_refusal() {
    use std::os::fd::AsRawFd;
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), &SCHEMA.replace("image <=1024", "image <=64000000"));
    let id = asset(&host, 32 << 20);
    let mut reader = get(&host, &format!("/assets/{id}"), 0);
    assert!(head(&mut reader).contains("Transfer-Encoding: chunked"));
    let mut prefix = [0; 1024]; reader.read_exact(&mut prefix).unwrap();
    // Reset the TCP connection mid-body, while the 32 MiB response still
    // exceeds the socket buffers, so the transport must report a write error.
    let linger = libc::linger { l_onoff: 1, l_linger: 0 };
    assert_eq!(unsafe { libc::setsockopt(reader.get_ref().as_raw_fd(), libc::SOL_SOCKET, libc::SO_LINGER, (&linger as *const libc::linger).cast(), std::mem::size_of_val(&linger) as _) }, 0);
    drop(reader);
    let result = counted(&host, "/assets (download)", 1);
    assert_eq!(result["operations"]["/assets (download)"]["refused"], 1, "{result}");
    // The permit is released after the sample; no later completion can add a
    // second sample once this worker has exited.
    let deadline = Instant::now() + Duration::from_secs(3);
    while host.admission.short.load(Ordering::Acquire) != 0 {
        assert!(Instant::now() < deadline); thread::yield_now();
    }
    let result = snapshot(&host);
    assert_eq!(result["operations"]["/assets (download)"]["n"], 1);
    assert_eq!(result["operations"]["/assets (download)"]["refused"], 1);
}


#[test]
fn latency_held_poll_total_includes_blocked_final_frame_write() {
    use snapback4_core::{Value, value::object};
    // The final invalidation list is larger than the constrained socket buffers.
    // The actual changes handler holds a poll, emits a heartbeat, then wakes
    // after these tables are seeded; no substitute responder or clock is used.
    let tables: Vec<_> = (0..160).map(|n| format!("table{n}_{}", "x".repeat(96))).collect();
    let source = format!("{SOURCE}{}", tables.iter().map(|name| format!("table {name}:\n  n: int\n  public\n")).collect::<String>());
    let host = Host::with_store(true, snapback4_core::Store::memory().unwrap(), &source);
    let (server, mut stream) = constrained_socket();
    write!(stream, "GET /changes?wait=25&heartbeat=1 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{PERSONA}Content-Length: 0\r\n\r\n").unwrap();
    let request = server.recv().unwrap();
    let sample = latency::Sample::new(&request, &host.shared.latency).unwrap();
    let shared = host.shared.clone();
    let worker = thread::spawn(move || sample.run(|| handle(request, &shared)));
    // A one-byte buffer prevents read-ahead from freeing the final frame's window.
    let mut reader = BufReader::with_capacity(1, stream);
    assert!(head(&mut reader).contains("Transfer-Encoding: chunked"));
    let mut heartbeat = [0; 6]; reader.read_exact(&mut heartbeat).unwrap();
    assert_eq!(&heartbeat, b"1\r\n\n\r\n");
    {
        let mut engine = lock(&host.shared.engine);
        engine.seed(tables.iter().map(|table| (table.clone(), object([("id", Value::Id("row".into())), ("n", Value::Int(1))])))).unwrap();
        host.shared.durable_committed(&engine);
    }
    let mut first = [0]; reader.read_exact(&mut first).unwrap();
    thread::sleep(Duration::from_millis(200));
    let mut bytes = first.to_vec(); reader.read_to_end(&mut bytes).unwrap();
    worker.join().unwrap();
    let frame = String::from_utf8(bytes).unwrap();
    let (length, payload) = frame.split_once("\r\n").unwrap();
    let length = usize::from_str_radix(length, 16).unwrap();
    assert!(length > 16 * 1024);
    assert_eq!(&payload[length..], "\r\n0\r\n\r\n");
    let reply: Json = serde_json::from_str(&payload[..length]).unwrap();
    assert_eq!(reply["tables"].as_array().unwrap().len(), tables.len());
    let result = counted(&host, "/changes", 1);
    let total = result["operations"]["/changes"]["total"]["max"].as_f64().unwrap();
    println!("held poll final frame {length}B; socket reads held 200ms: total={total:.3}ms");
    assert!(total >= 200.0, "final frame write missing from total: {result}");
    assert_eq!(result["operations"]["/changes"]["refused"], 0);
}

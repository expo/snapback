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

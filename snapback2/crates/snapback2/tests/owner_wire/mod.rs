//! HTTP and SSE helpers shared by the owner integration scenarios.

use serde_json::{Value, json};
#[cfg(not(feature = "hermes"))]
use std::io::{BufRead, BufReader};
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::time::Duration;

pub(super) struct Response {
    pub(super) status: u16,
    pub(super) body: Value,
}

pub(super) fn request(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Value,
) -> Response {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
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
    let head = String::from_utf8_lossy(&bytes[..split]);
    let status = head
        .lines()
        .next()
        .unwrap()
        .split_whitespace()
        .nth(1)
        .unwrap()
        .parse()
        .unwrap();
    let body = serde_json::from_slice(&bytes[split + 4..]).unwrap();
    Response { status, body }
}

pub(super) fn status(port: u16, secret: &str) -> Value {
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

#[cfg(not(feature = "hermes"))]
pub(super) struct Sse {
    reader: BufReader<TcpStream>,
    pub(super) last_id: Option<u64>,
}

#[cfg(not(feature = "hermes"))]
impl Sse {
    pub(super) fn open(port: u16, path: &str, persona: &str) -> Self {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(6)))
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
        Self {
            reader,
            last_id: None,
        }
    }

    pub(super) fn event(&mut self) -> Value {
        loop {
            let mut size = String::new();
            self.reader.read_line(&mut size).unwrap();
            let size = usize::from_str_radix(size.trim(), 16).unwrap();
            assert!(size > 0);
            let mut bytes = vec![0; size];
            self.reader.read_exact(&mut bytes).unwrap();
            let mut ending = [0; 2];
            self.reader.read_exact(&mut ending).unwrap();
            let text = String::from_utf8(bytes).unwrap();
            self.last_id = text
                .lines()
                .find_map(|line| line.strip_prefix("id: "))
                .and_then(|value| value.parse().ok());
            if let Some(data) = text.lines().find_map(|line| line.strip_prefix("data: ")) {
                return serde_json::from_str(data).unwrap();
            }
        }
    }

    pub(super) fn assert_silent(&mut self, timeout: Duration) {
        let started = std::time::Instant::now();
        loop {
            let remaining = timeout.saturating_sub(started.elapsed());
            self.reader
                .get_mut()
                .set_read_timeout(Some(remaining))
                .unwrap();
            let mut size = String::new();
            match self.reader.read_line(&mut size) {
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::WouldBlock | std::io::ErrorKind::TimedOut
                    ) =>
                {
                    break;
                }
                Ok(0) => panic!("subscription closed while silence was expected"),
                Ok(_) => {}
                Err(error) => panic!("subscription silence probe failed: {error}"),
            }
            let size = usize::from_str_radix(size.trim(), 16).unwrap();
            assert!(size > 0, "subscription closed while silence was expected");
            let mut bytes = vec![0; size];
            self.reader.read_exact(&mut bytes).unwrap();
            let mut ending = [0; 2];
            self.reader.read_exact(&mut ending).unwrap();
            let text = String::from_utf8(bytes).unwrap();
            if text.lines().any(|line| line.starts_with("data: ")) {
                panic!("subscription delivered while silence was expected: {text:?}");
            }
            assert!(
                text.lines().any(|line| line == ": heartbeat"),
                "unexpected SSE frame while silence was expected: {text:?}"
            );
        }
        self.reader
            .get_mut()
            .set_read_timeout(Some(Duration::from_secs(6)))
            .unwrap();
    }
}

//! HTTP and SSE helpers shared by the owner integration scenarios.

use serde_json::{Value, json};
use std::io::{BufRead, BufReader};
use std::io::{Read, Write};
use std::net::{Shutdown, TcpStream};
use std::time::Duration;

pub(super) struct Response {
    pub(super) status: u16,
    pub(super) body: Value,
    pub(super) body_bytes: Vec<u8>,
    pub(super) headers: String,
}

pub(super) fn request(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    body: Value,
) -> Response {
    let bytes = if method == "GET" {
        Vec::new()
    } else {
        serde_json::to_vec(&body).unwrap()
    };
    let response = request_bytes(port, method, path, headers, "application/json", &bytes);
    if let Err(error) = serde_json::from_slice::<Value>(&response.body_bytes) {
        panic!(
            "{method} {path}: response body is not one JSON value: {error}; body={}",
            String::from_utf8_lossy(&response.body_bytes),
        );
    }
    response
}

/// The same request with a raw body (an upload's bytes) and a body that may not be JSON
/// (a delivered asset): `body` is `Null` when `body_bytes` does not parse.
pub(super) fn request_bytes(
    port: u16,
    method: &str,
    path: &str,
    headers: &[(&str, &str)],
    content_type: &str,
    bytes: &[u8],
) -> Response {
    let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .unwrap();
    write!(
        stream,
        "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\nConnection: close\r\nContent-Type: {content_type}\r\nContent-Length: {}\r\n",
        bytes.len()
    )
    .unwrap();
    for (name, value) in headers {
        write!(stream, "{name}: {value}\r\n").unwrap();
    }
    stream.write_all(b"\r\n").unwrap();
    stream.write_all(bytes).unwrap();
    stream.flush().unwrap();
    stream.shutdown(Shutdown::Write).unwrap();
    let mut bytes = Vec::new();
    stream.read_to_end(&mut bytes).unwrap();
    let split = bytes
        .windows(4)
        .position(|window| window == b"\r\n\r\n")
        .unwrap();
    let head = String::from_utf8_lossy(&bytes[..split]).into_owned();
    let status = head
        .lines()
        .next()
        .unwrap()
        .split_whitespace()
        .nth(1)
        .unwrap()
        .parse()
        .unwrap();
    let wire_body = &bytes[split + 4..];
    let body_bytes = if head
        .lines()
        .any(|line| line.eq_ignore_ascii_case("Transfer-Encoding: chunked"))
    {
        decode_chunked(wire_body)
    } else {
        wire_body.to_vec()
    };
    let body = serde_json::from_slice(&body_bytes).unwrap_or(Value::Null);
    Response {
        status,
        body,
        body_bytes,
        headers: head,
    }
}

fn decode_chunked(bytes: &[u8]) -> Vec<u8> {
    let mut cursor = 0;
    let mut decoded = Vec::new();
    loop {
        let line_end = bytes[cursor..]
            .windows(2)
            .position(|window| window == b"\r\n")
            .map(|offset| cursor + offset)
            .unwrap();
        let size =
            usize::from_str_radix(std::str::from_utf8(&bytes[cursor..line_end]).unwrap(), 16)
                .unwrap();
        cursor = line_end + 2;
        if size == 0 {
            break;
        }
        decoded.extend_from_slice(&bytes[cursor..cursor + size]);
        cursor += size;
        assert_eq!(&bytes[cursor..cursor + 2], b"\r\n");
        cursor += 2;
    }
    decoded
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

pub(super) struct Sse {
    reader: BufReader<TcpStream>,
    pub(super) last_id: Option<u64>,
}

impl Sse {
    pub(super) fn open(port: u16, path: &str, persona: &str) -> Self {
        Self::open_with_header(port, path, "X-Snapback-As", persona)
    }

    pub(super) fn live_anonymous(port: u16) -> Self {
        Self::open_stream(port, "POST", "/api/live", "Accept", "text/event-stream")
    }

    pub(super) fn shutdown(&self) {
        self.reader.get_ref().shutdown(Shutdown::Both).unwrap();
    }

    pub(super) fn open_bearer(port: u16, path: &str, token: &str) -> Self {
        let authorization = format!("Bearer {token}");
        Self::open_with_header(port, path, "Authorization", &authorization)
    }

    fn open_with_header(port: u16, path: &str, header: &str, value: &str) -> Self {
        Self::open_stream(port, "GET", path, header, value)
    }

    pub(super) fn live(port: u16, persona: &str) -> Self {
        Self::open_stream(port, "POST", "/api/live", "X-Snapback-As", persona)
    }

    pub(super) fn live_bearer(port: u16, token: &str) -> Self {
        Self::open_stream(
            port,
            "POST",
            "/api/live",
            "Authorization",
            &format!("Bearer {token}"),
        )
    }

    fn open_stream(port: u16, method: &str, path: &str, header: &str, value: &str) -> Self {
        let mut stream = TcpStream::connect(("127.0.0.1", port)).unwrap();
        stream
            .set_read_timeout(Some(Duration::from_secs(6)))
            .unwrap();
        write!(
            stream,
            "{method} {path} HTTP/1.1\r\nHost: 127.0.0.1:{port}\r\n{header}: {value}\r\nContent-Length: 2\r\nContent-Type: application/json\r\nConnection: close\r\n\r\n{{}}"
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
        serde_json::from_str(&self.event_text()).unwrap()
    }

    pub(super) fn event_text(&mut self) -> String {
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
                return data.to_owned();
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

    pub(super) fn assert_closed(&mut self) {
        let mut size = String::new();
        self.reader.read_line(&mut size).unwrap();
        assert_eq!(
            size.trim(),
            "0",
            "expected terminal SSE chunk, got {size:?}"
        );
    }
}

//! Shared deterministic Expo HTTP fixture for the send/receipt acceptance.
//! Scripts own exact paths, bounded JSON responses, bearer expectations, and
//! the response-loss cut (accept request bytes, then close the socket).

use serde_json::Value;
use std::collections::VecDeque;
use std::io::{Read, Write};
use std::net::{Shutdown, TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;
use std::time::Duration;

pub(super) enum FakeExpoStep {
    Json {
        path: &'static str,
        status: u16,
        body: Value,
        bearer: Option<&'static str>,
    },
    DropAfterRequest {
        path: &'static str,
    },
}

#[derive(Clone, Debug)]
pub(super) struct FakeExpoRequest {
    pub(super) path: String,
    pub(super) body: Value,
}

pub(super) struct FakeExpo {
    base_url: String,
    requests: Arc<Mutex<Vec<FakeExpoRequest>>>,
    worker: Option<JoinHandle<()>>,
}

impl FakeExpo {
    pub(super) fn start(steps: Vec<FakeExpoStep>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").expect("bind fake Expo");
        let address = listener.local_addr().expect("fake Expo address");
        let requests = Arc::new(Mutex::new(Vec::new()));
        let captured = requests.clone();
        let worker = std::thread::spawn(move || {
            let mut steps = VecDeque::from(steps);
            while let Some(step) = steps.pop_front() {
                let (mut stream, _) = listener.accept().expect("accept fake Expo request");
                stream
                    .set_read_timeout(Some(Duration::from_secs(5)))
                    .expect("fake Expo read timeout");
                let request = read_request(&mut stream);
                let (expected_path, expected_bearer) = match &step {
                    FakeExpoStep::Json { path, bearer, .. } => (*path, *bearer),
                    FakeExpoStep::DropAfterRequest { path } => (*path, None),
                };
                assert_eq!(request.path, expected_path, "fake Expo path");
                if let Some(bearer) = expected_bearer {
                    let expected = format!("Bearer {bearer}");
                    assert_eq!(
                        request.authorization.as_deref(),
                        Some(expected.as_str()),
                        "fake Expo bearer"
                    );
                }
                captured
                    .lock()
                    .expect("fake Expo request lock")
                    .push(FakeExpoRequest {
                        path: request.path,
                        body: request.body,
                    });
                match step {
                    FakeExpoStep::Json { status, body, .. } => {
                        let bytes = serde_json::to_vec(&body).expect("fake Expo response JSON");
                        let reason = match status {
                            200 => "OK",
                            400 => "Bad Request",
                            401 => "Unauthorized",
                            429 => "Too Many Requests",
                            _ => "Fixture",
                        };
                        write!(
                            stream,
                            "HTTP/1.1 {status} {reason}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                            bytes.len()
                        )
                        .expect("fake Expo response headers");
                        stream.write_all(&bytes).expect("fake Expo response body");
                    }
                    FakeExpoStep::DropAfterRequest { .. } => {
                        stream.shutdown(Shutdown::Both).ok();
                    }
                }
            }
        });
        Self {
            base_url: format!("http://{address}"),
            requests,
            worker: Some(worker),
        }
    }

    pub(super) fn endpoint(&self, path: &str) -> String {
        format!("{}{}", self.base_url, path)
    }

    pub(super) fn finish(mut self) -> Vec<FakeExpoRequest> {
        self.worker
            .take()
            .expect("fake Expo worker")
            .join()
            .expect("fake Expo script completed");
        Arc::try_unwrap(self.requests)
            .expect("fake Expo fixture owns request log")
            .into_inner()
            .expect("fake Expo request log")
    }
}

struct ParsedRequest {
    path: String,
    authorization: Option<String>,
    body: Value,
}

fn read_request(stream: &mut TcpStream) -> ParsedRequest {
    let mut bytes = Vec::new();
    let mut chunk = [0_u8; 4_096];
    let (header_end, content_length) = loop {
        let read = stream.read(&mut chunk).expect("read fake Expo request");
        assert!(read > 0, "fake Expo request closed before headers");
        bytes.extend_from_slice(&chunk[..read]);
        if let Some(index) = bytes.windows(4).position(|window| window == b"\r\n\r\n") {
            let header_end = index + 4;
            let headers = std::str::from_utf8(&bytes[..header_end]).expect("request headers UTF-8");
            let content_length = headers
                .lines()
                .find_map(|line| {
                    line.split_once(':').and_then(|(name, value)| {
                        name.eq_ignore_ascii_case("content-length")
                            .then(|| value.trim().parse::<usize>().expect("content length"))
                    })
                })
                .expect("fake Expo content length");
            break (header_end, content_length);
        }
    };
    while bytes.len() < header_end + content_length {
        let read = stream.read(&mut chunk).expect("read fake Expo body");
        assert!(read > 0, "fake Expo request closed before body");
        bytes.extend_from_slice(&chunk[..read]);
    }
    let headers = std::str::from_utf8(&bytes[..header_end]).expect("request headers UTF-8");
    let mut lines = headers.lines();
    let path = lines
        .next()
        .and_then(|line| line.split_whitespace().nth(1))
        .expect("request path")
        .to_owned();
    let authorization = lines.find_map(|line| {
        line.split_once(':').and_then(|(name, value)| {
            name.eq_ignore_ascii_case("authorization")
                .then(|| value.trim().to_owned())
        })
    });
    let body = serde_json::from_slice(&bytes[header_end..header_end + content_length])
        .expect("fake Expo request JSON");
    ParsedRequest {
        path,
        authorization,
        body,
    }
}

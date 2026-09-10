//! Minimal SSE reader used by the derived invalidation checks.

use super::{Json, OwnerInfo, Refusal, percent_encode, test_io};
use crate::client;
use serde_json::json;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

pub(super) struct SseProbe {
    pub(super) reader: BufReader<TcpStream>,
    close: Option<(OwnerInfo, String, String, String)>,
}

pub(super) struct SilenceError {
    pub(super) message: String,
    pub(super) delivery: Option<Json>,
}

enum SseFrame {
    Event(Json),
    Heartbeat,
    TimedOut,
}

impl SseProbe {
    #[cfg(test)]
    pub(super) fn from_stream(stream: TcpStream) -> Self {
        Self { reader: BufReader::new(stream), close: None }
    }

    pub(super) fn connect(
        owner: &OwnerInfo,
        op: &str,
        args: Json,
        persona: &str,
    ) -> Result<Self, Refusal> {
        let mut stream = TcpStream::connect(("127.0.0.1", owner.port)).map_err(test_io)?;
        let encoded =
            percent_encode(&serde_json::to_string(&args).unwrap_or_else(|_| "{}".to_owned()));
        write!(
            stream,
            "POST /api/live HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nX-Snapback-As: {}\r\nContent-Length: 2\r\nConnection: close\r\n\r\n{{}}",
            owner.port,
            persona,
        )
        .map_err(test_io)?;
        stream.flush().map_err(test_io)?;
        let mut reader = BufReader::new(stream);
        let mut status = String::new();
        reader.read_line(&mut status).map_err(test_io)?;
        if !status.contains(" 200 ") {
            return Err(Refusal::owner(
                "E_OWNER_TEST_SSE",
                format!("subscription returned {status}"),
                "run snapback2 why for the query and persona",
            ));
        }
        loop {
            let mut line = String::new();
            reader.read_line(&mut line).map_err(test_io)?;
            if line == "\r\n" || line.is_empty() {
                break;
            }
        }
        let mut probe = Self { reader, close: None };
        let ready = probe.event(Duration::from_secs(2)).map_err(|error|
            Refusal::owner("E_OWNER_TEST_SSE", error, "reconnect the live stream"))?;
        let session = ready.get("session").and_then(Json::as_str).ok_or_else(||
            Refusal::owner("E_OWNER_TEST_SSE", "live stream omitted its session", "reconnect the live stream"))?.to_owned();
        let path = format!("/api/subscribe?op={}&args={}", percent_encode(op), encoded);
        probe.close = Some((owner.clone(), persona.to_owned(), session.clone(), path.clone()));
        let response = client::api(owner, "POST", "/api/live/control", &[("X-Snapback-As", persona)],
            json!({ "session": session, "add": [{ "id": "probe", "path": path }] }))?;
        if response.status >= 400 {
            return Err(Refusal::owner("E_OWNER_TEST_SSE", response.body.to_string(), "reconnect the live stream"));
        }
        Ok(probe)
    }

    pub(super) fn event(&mut self, timeout: Duration) -> Result<Json, String> {
        let started = Instant::now();
        loop {
            let remaining = timeout.saturating_sub(started.elapsed());
            if remaining.is_zero() {
                return Err("timed out waiting for delivery".to_owned());
            }
            match self.frame(remaining)? {
                SseFrame::Event(event) => return Ok(if event.get("id").is_some() { event["data"].clone() } else { event }),
                SseFrame::Heartbeat => {}
                SseFrame::TimedOut => return Err("timed out waiting for delivery".to_owned()),
            }
        }
    }

    pub(super) fn prove_silence(&mut self, timeout: Duration) -> Result<(), SilenceError> {
        let failure = |message: String| SilenceError { message, delivery: None };
        // The write and its notifications settle on the owner before this add.
        // serve_live drains children in key order: probe precedes z-silence, so
        // its unwanted delivery cannot hide behind the fresh subscription frame.
        if let Some((owner, persona, session, path)) = &self.close {
            let response = client::api(owner, "POST", "/api/live/control", &[("X-Snapback-As", persona)],
                json!({ "session": session, "add": [{ "id": "z-silence", "path": path }] }))
                .map_err(|error| failure(format!("silence barrier: {error:?}")))?;
            if response.status >= 400 { return Err(failure(format!("silence barrier: {}", response.body))); }
        }
        let started = Instant::now();
        loop {
            let remaining = timeout.saturating_sub(started.elapsed());
            if remaining.is_zero() { return Err(failure("silence barrier timed out".into())); }
            match self.frame(remaining) {
                Ok(SseFrame::Event(event)) if event["id"] == "z-silence" && event.get("data").is_some() => return Ok(()),
                Ok(SseFrame::Event(event)) => return Err(SilenceError {
                    message: "delivery received before the silence barrier".into(),
                    delivery: Some(if event.get("id").is_some() { event["data"].clone() } else { event }),
                }),
                Ok(SseFrame::Heartbeat) => {},
                Ok(SseFrame::TimedOut) => return Err(failure("silence barrier timed out".into())),
                Err(message) => return Err(failure(message)),
            }
        }
    }

    fn frame(&mut self, timeout: Duration) -> Result<SseFrame, String> {
        self.reader
            .get_mut()
            .set_read_timeout(Some(timeout))
            .map_err(|error| error.to_string())?;
        loop {
            let mut size = String::new();
            match self.reader.read_line(&mut size) {
                Ok(0) => return Err("subscription ended".to_owned()),
                Ok(_) => {}
                Err(error)
                    if matches!(
                        error.kind(),
                        std::io::ErrorKind::TimedOut | std::io::ErrorKind::WouldBlock
                    ) =>
                {
                    return Ok(SseFrame::TimedOut);
                }
                Err(error) => return Err(error.to_string()),
            }
            let size = usize::from_str_radix(size.trim(), 16).map_err(|error| error.to_string())?;
            if size == 0 {
                return Err("subscription ended".to_owned());
            }
            let mut payload = vec![0_u8; size];
            self.reader
                .read_exact(&mut payload)
                .map_err(|error| error.to_string())?;
            let mut crlf = [0_u8; 2];
            self.reader
                .read_exact(&mut crlf)
                .map_err(|error| error.to_string())?;
            let text = String::from_utf8_lossy(&payload);
            if let Some(data) = text.lines().find_map(|line| line.strip_prefix("data: ")) {
                return serde_json::from_str::<Json>(data)
                    .map(SseFrame::Event)
                    .map_err(|error| error.to_string());
            }
            if text.lines().any(|line| line == ": heartbeat") {
                return Ok(SseFrame::Heartbeat);
            }
        }
    }
}

// The installed transport has an explicit close. Each derived probe releases
// its worker before the next one instead of waiting for a TCP heartbeat.
impl Drop for SseProbe {
    fn drop(&mut self) {
        if let Some((owner, persona, session, _)) = self.close.take() {
            let _ = client::api(&owner, "POST", "/api/live/control", &[("X-Snapback-As", &persona)],
                json!({ "session": session, "close": true }));
        }
    }
}

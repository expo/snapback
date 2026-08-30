//! Minimal SSE reader used by the derived invalidation checks.

use super::{Json, OwnerInfo, Refusal, percent_encode, test_io};
use std::io::{BufRead, BufReader, Read, Write};
use std::net::TcpStream;
use std::time::{Duration, Instant};

pub(super) struct SseProbe {
    pub(super) reader: BufReader<TcpStream>,
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
            "GET /api/subscribe?op={}&args={} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nX-Snapback-As: {}\r\nConnection: close\r\n\r\n",
            percent_encode(op),
            encoded,
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
        Ok(Self { reader })
    }

    pub(super) fn event(&mut self, timeout: Duration) -> Result<Json, String> {
        let started = Instant::now();
        loop {
            let remaining = timeout.saturating_sub(started.elapsed());
            if remaining.is_zero() {
                return Err("timed out waiting for delivery".to_owned());
            }
            match self.frame(remaining)? {
                SseFrame::Event(event) => return Ok(event),
                SseFrame::Heartbeat => {}
                SseFrame::TimedOut => return Err("timed out waiting for delivery".to_owned()),
            }
        }
    }

    pub(super) fn prove_silence(&mut self, window: Duration) -> Result<(), SilenceError> {
        let started = Instant::now();
        loop {
            let remaining = window.saturating_sub(started.elapsed());
            if remaining.is_zero() {
                return Ok(());
            }
            match self.frame(remaining) {
                Ok(SseFrame::Event(delivery)) => {
                    return Err(SilenceError {
                        message: "delivery received during the silence window".to_owned(),
                        delivery: Some(delivery),
                    });
                }
                Ok(SseFrame::Heartbeat) => {}
                Ok(SseFrame::TimedOut) => return Ok(()),
                Err(message) => {
                    return Err(SilenceError {
                        message,
                        delivery: None,
                    });
                }
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
                return serde_json::from_str(data)
                    .map(SseFrame::Event)
                    .map_err(|error| error.to_string());
            }
            if text.lines().any(|line| line == ": heartbeat") {
                return Ok(SseFrame::Heartbeat);
            }
        }
    }
}

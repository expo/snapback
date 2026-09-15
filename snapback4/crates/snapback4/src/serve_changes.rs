//! Held change polls: JSON whitespace heartbeats, followed by one JSON result.
use super::{JsonBuffer, Shared, cors, lock, principal_of, query_params, refusal_json, respond};
use serde_json::{Value as Json, json};
use std::io;
use std::time::{Duration, Instant};
use tiny_http::Request;

const HEARTBEAT: Duration = Duration::from_secs(2);

pub(super) fn serve(request: Request, shared: &Shared, url: &str) {
    let params = query_params(url);
    let since: u64 = params.get("since").and_then(|s| s.parse().ok()).unwrap_or(0);
    let wait: u64 = params.get("wait").and_then(|s| s.parse().ok()).unwrap_or(0).min(25);
    let deadline = Instant::now() + Duration::from_secs(wait);
    let connected = match principal_of(&request, shared) {
        Ok(principal) => principal,
        Err(refusal) => return respond(request, 401, json!({ "denied": refusal_json(&refusal) })),
    };
    let heartbeat = params.get("heartbeat").is_some_and(|s| s == "1") && request.http_version().0 == 1 && request.http_version().1 >= 1;
    let mut response = PollResponse { request: Some(request), started: false };
    shared.presence.enter(&connected);
    let result = (|| -> io::Result<()> {
        let mut beat = Instant::now();
        loop {
            let seq = lock(&shared.seq);
            if *seq > since || Instant::now() >= deadline { break; }
            if heartbeat && Instant::now() >= beat {
                drop(seq);
                response.heartbeat()?;
                beat = Instant::now() + HEARTBEAT;
                continue;
            }
            let wake = if heartbeat { deadline.min(beat) } else { deadline };
            let _ = shared.committed.wait_timeout(seq, wake.saturating_duration_since(Instant::now())).unwrap_or_else(|poisoned| poisoned.into_inner());
        }
        Ok(())
    })();
    shared.presence.leave(&connected);
    if result.is_err() { return; }
    if let Err(refusal) = principal_of(response.request.as_ref().unwrap(), shared) {
        response.finish(401, json!({ "denied": refusal_json(&refusal) }));
        return;
    }
    let reader = { lock(&shared.engine).reader() };
    let changes = match reader {
        Ok(mut reader) => reader.store().meta("store_id").and_then(|store_id| reader.changes(since, 500).map(|changes| (changes, store_id))),
        Err(_) => {
            let mut engine = lock(&shared.engine);
            engine.store().meta("store_id").and_then(|store_id| engine.changes(since, 500).map(|changes| (changes, store_id)))
        },
    };
    match changes {
        Ok((changes, store_id)) => {
            let seq = changes.last().map(|(seq, _)| *seq).unwrap_or(since);
            let mut tables: Vec<String> = changes.into_iter().flat_map(|(_, tables)| tables).collect();
            tables.sort();
            tables.dedup();
            let generation = *lock(&shared.generation);
            response.finish(200, json!({ "seq": seq, "tables": tables, "generation": generation, "store_id": store_id }));
        }
        Err(error) => {
            let refusal = error.refusal();
            response.finish(if refusal.retryable { 503 } else { 500 }, json!({ "denied": refusal_json(&refusal) }));
        }
    }
}

struct PollResponse {
    request: Option<Request>,
    started: bool,
}

impl PollResponse {
    fn heartbeat(&mut self) -> io::Result<()> {
        let request = self.request.as_mut().unwrap();
        let mut frame = String::new();
        if !self.started {
            frame.push_str("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store, no-transform\r\nX-Accel-Buffering: no\r\nTransfer-Encoding: chunked\r\n");
            for header in cors(request) { frame.push_str(&format!("{header}\r\n")); }
            frame.push_str("\r\n");
            self.started = true;
        }
        frame.push_str("1\r\n\n\r\n");
        request.write_response_frame(frame.as_bytes())
    }

    fn finish(mut self, status: u16, body: Json) {
        if !self.started { return respond(self.request.take().unwrap(), status, body); }
        // Once heartbeats began the status is 200; the final JSON still
        // carries a typed denial, including a session revoked during the wait.
        let mut bytes = JsonBuffer(Vec::new());
        if serde_json::to_writer(&mut bytes, &body).is_err() {
            let refusal = snapback4_core::error::Refusal::new("E_BOUND", "bound", "the HTTP JSON response exceeds 16 MiB; request fewer changes").guide("reads");
            bytes.0.clear();
            serde_json::to_writer(&mut bytes, &json!({ "denied": refusal_json(&refusal) })).unwrap();
        }
        let mut frame = format!("{:x}\r\n", bytes.0.len()).into_bytes();
        frame.extend_from_slice(&bytes.0);
        frame.extend_from_slice(b"\r\n0\r\n\r\n");
        if self.request.as_mut().unwrap().write_response_frame(&frame).is_ok() {
            self.request.take().unwrap().finish_stream();
        }
    }
}

impl Drop for PollResponse {
    fn drop(&mut self) {
        // A failed or panicking stream cannot append a second response after
        // incomplete chunk framing, including on pipelined connections.
        if let Some(request) = self.request.take() { request.abort(); }
    }
}

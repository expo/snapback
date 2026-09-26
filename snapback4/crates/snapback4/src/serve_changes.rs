//! Held change polls: JSON whitespace heartbeats, followed by one JSON result.
use super::{JsonBuffer, Shared, cors, lock, principal_of, query_params, refusal_json, respond_timed, wake_presence};
use serde_json::{Value as Json, json};
use std::io;
use std::time::{Duration, Instant};
use tiny_http::Request;

const HEARTBEAT: Duration = Duration::from_secs(2);
/// A poll follows at most this many tokens (LLP 3000.017 §3.2).
pub(crate) const FOLLOW_LIMIT: usize = 64;

/// `follow=<token>,…`: the opaque tokens the client's watches hold.
pub(crate) fn followed(list: Option<&String>) -> Vec<String> {
    let Some(list) = list else { return Vec::new() };
    let mut tokens: Vec<String> = Vec::new();
    for token in list.split(',') {
        if token.is_empty() || token.len() > 64 || !token.chars().all(|c| c.is_ascii_alphanumeric()) || tokens.iter().any(|t| t == token) { continue; }
        tokens.push(token.to_owned());
        if tokens.len() == FOLLOW_LIMIT { break; }
    }
    tokens
}

/// The followed tokens whose presence moved, and the earliest end of a grace
/// that alone keeps one of their principals connected. A token that lapsed
/// while the poll waited is dropped, never reported.
fn moved(shared: &Shared, viewer: &str, follow: &[String]) -> (Vec<String>, Option<Instant>) {
    let mut moved = Vec::new();
    let mut grace_end: Option<Instant> = None;
    for token in follow {
        let Some(bits) = shared.presence.token(viewer, token) else { continue };
        let mut changed = false;
        for (principal, seen) in &bits {
            let (now, remaining) = shared.presence.follow(principal);
            changed |= now != *seen;
            if let Some(remaining) = remaining {
                let end = Instant::now() + remaining;
                grace_end = Some(grace_end.map_or(end, |earliest| earliest.min(end)));
            }
        }
        if changed { moved.push(token.clone()); }
    }
    (moved, grace_end)
}

pub(super) fn serve(request: Request, shared: &Shared, url: &str) {
    let params = query_params(url);
    let since: u64 = params.get("since").and_then(|s| s.parse().ok()).unwrap_or(0);
    let wait: u64 = params.get("wait").and_then(|s| s.parse().ok()).unwrap_or(0).min(25);
    let deadline = Instant::now() + Duration::from_secs(wait);
    let connected = match principal_of(&request, shared) {
        Ok(principal) => principal,
        Err(refusal) => return respond_timed(request, shared, 401, json!({ "denied": refusal_json(&refusal) })),
    };
    let heartbeat = params.get("heartbeat").is_some_and(|s| s == "1") && request.http_version().0 == 1 && request.http_version().1 >= 1;
    // @ref LLP 3000.017#3.5 — a poll follows only tokens its own viewer's queries were issued.
    let follow: Vec<String> = followed(params.get("follow")).into_iter().filter(|token| shared.presence.token(&connected, token).is_some()).collect();
    let principals: Vec<(String, bool)> = follow.iter().flat_map(|token| shared.presence.token(&connected, token).unwrap_or_default()).collect();
    let mut response = PollResponse { request: Some(request), started: false, shared };
    let came_online;
    {
        let mut engine = lock(&shared.engine);
        if let Err(error) = engine.presence_reconnected(&connected, shared.now()) {
            response.finish(500, json!({ "denied": refusal_json(&error.refusal()) }));
            return;
        }
        came_online = shared.presence.enter(&connected);
    }
    // @ref LLP 3000.017#3.2 — coming online wakes held polls, only when one of them follows this principal.
    if came_online && shared.presence.followed(&connected) { wake_presence(shared); }
    let _following = shared.presence.following(&principals);
    let result = (|| -> io::Result<()> {
        let mut beat = Instant::now();
        loop {
            let generation = shared.presence.generation();
            // @ref LLP 3000.017#3.2 — a followed bit that differs from the client's answers at once.
            let (presence, grace_end) = moved(shared, &connected, &follow);
            if !presence.is_empty() { break; }
            // @ref LLP 3000.007#18.2 — the counter only wakes polls; the store decides whether its head changed.
            let observed = *lock(&shared.seq);
            let changed = {
                let engine = lock(&shared.engine);
                let store_id = engine.store().meta("store_id").map_err(io::Error::other)?;
                params.get("store_id").is_some_and(|supplied| Some(supplied) != store_id.as_ref())
                    || engine.seq().map_err(io::Error::other)? != since
            };
            let seq = lock(&shared.seq);
            if changed || *seq != observed || Instant::now() >= deadline { break; }
            // A presence change that raced the checks above is looked at again, never slept through.
            if shared.presence.generation() != generation { continue; }
            if heartbeat && Instant::now() >= beat {
                drop(seq);
                response.heartbeat()?;
                beat = Instant::now() + HEARTBEAT;
                continue;
            }
            let mut wake = if heartbeat { deadline.min(beat) } else { deadline };
            // A grace that ends while this poll waits is a presence change too.
            if let Some(end) = grace_end { wake = wake.min(end + Duration::from_millis(5)); }
            #[cfg(test)]
            super::test_work(&shared.poll_wait);
            let (woken, timeout) = shared.committed.wait_timeout(seq, wake.saturating_duration_since(Instant::now())).unwrap_or_else(|poisoned| poisoned.into_inner());
            if !timeout.timed_out() {
                // A presence wake answers only a poll whose own followed bits
                // moved; the next pass decides that. Every other wake answers.
                if *woken == observed && shared.presence.generation() != generation { continue; }
                break;
            }
        }
        Ok(())
    })();
    drop(_following);
    shared.presence.leave(&connected);
    if result.is_err() { return; }
    // Whatever ended the wait, the answer carries every followed bit that moved.
    let (presence, _) = moved(shared, &connected, &follow);
    if let Err(refusal) = principal_of(response.request.as_ref().unwrap(), shared) {
        response.finish(401, json!({ "denied": refusal_json(&refusal) }));
        return;
    }
    let reader = { lock(&shared.engine).reader() };
    let changes = match reader {
        Ok(mut reader) => check(&mut reader, since),
        Err(_) => check(&mut lock(&shared.engine), since),
    };
    match changes {
        Ok((seq, store_id, tables)) => {
            let generation = *lock(&shared.generation);
            let mut body = json!({ "seq": seq, "tables": tables, "generation": generation, "store_id": store_id });
            if !presence.is_empty() { body["presence"] = json!(presence); }
            response.finish(200, body);
        }
        Err(error) => {
            let refusal = error.refusal();
            response.finish(if refusal.retryable { 503 } else { 500 }, json!({ "denied": refusal_json(&refusal) }));
        }
    }
}

/// The notification's head, identity and invalidations share one read snapshot.
fn check(engine: &mut snapback4_core::engine::Engine, since: u64) -> Result<(u64, Option<String>, Vec<String>), snapback4_core::error::RuntimeError> {
    use rusqlite::OptionalExtension;
    let all_tables: Vec<_> = engine.schema().visible_tables().map(|(n,_)|n.clone()).collect();
    let tx = engine.store_mut().read_transaction()?;
    let head = tx.next_seq()? - 1;
    let store_id = tx.conn().query_row("SELECT value FROM _meta WHERE key = 'store_id'", [], |row| row.get(0)).optional()?;
    let changes = tx.commits_after(since, 500)?;
    // Advancing to the actual head must not skip invalidation beyond the
    // bounded commit page. Saturation conservatively invalidates every table.
    let mut tables = if changes.last().is_some_and(|(seq, _)| *seq < head) { all_tables }
        else { changes.into_iter().flat_map(|(_, tables)| tables).filter(|name| all_tables.contains(name)).collect() };
    tables.sort();
    tables.dedup();
    tx.rollback()?;
    Ok((head, store_id, tables))
}

struct PollResponse<'a> {
    request: Option<Request>,
    started: bool,
    shared: &'a Shared,
}

impl PollResponse<'_> {
    fn heartbeat(&mut self) -> io::Result<()> {
        let request = self.request.as_mut().unwrap();
        let mut frame = String::new();
        if !self.started {
            frame.push_str("HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nCache-Control: no-store, no-transform\r\nX-Accel-Buffering: no\r\nTransfer-Encoding: chunked\r\n");
            // Clock time belongs to the final body, after the hold. A buffering
            // transport must not mistake early headers for an end stamp.
            for header in cors(request) { frame.push_str(&format!("{header}\r\n")); }
            frame.push_str("\r\n");
            self.started = true;
        }
        frame.push_str("1\r\n\n\r\n");
        request.write_response_frame(frame.as_bytes())
    }

    fn finish(mut self, status: u16, mut body: Json) {
        if !self.started { return respond_timed(self.request.take().unwrap(), self.shared, status, body); }
        // Stamp after the hold, including any development clock advance.
        let clock = lock(&self.shared.clock);
        body["serverNow"] = json!(clock.now());
        body["clockRevision"] = json!(clock.revision());
        drop(clock);
        // Once heartbeats began the status is 200; the final JSON still
        // carries a typed denial, including a session revoked during the wait.
        let mut bytes = JsonBuffer(Vec::new());
        if serde_json::to_writer(&mut bytes, &body).is_err() {
            let refusal = snapback4_core::error::Refusal::new("E_BOUND", "bound", "the HTTP JSON response exceeds 16 MiB; request fewer changes").guide("reads");
            bytes.0.clear();
            serde_json::to_writer(&mut bytes, &json!({ "denied": refusal_json(&refusal), "serverNow": body["serverNow"], "clockRevision": body["clockRevision"] })).unwrap();
        }
        let mut frame = format!("{:x}\r\n", bytes.0.len()).into_bytes();
        frame.extend_from_slice(&bytes.0);
        frame.extend_from_slice(b"\r\n0\r\n\r\n");
        if self.request.as_mut().unwrap().write_response_frame(&frame).is_ok() {
            self.request.take().unwrap().finish_stream();
        }
    }
}

impl Drop for PollResponse<'_> {
    fn drop(&mut self) {
        // A failed or panicking stream cannot append a second response after
        // incomplete chunk framing, including on pipelined connections.
        if let Some(request) = self.request.take() { request.abort(); }
    }
}

#[cfg(test)]
mod column_tests {
    #[test]
    fn saturated_changes_uses_the_public_table_enumeration() {
        let bound=snapback4_lang::compile(&[("schema.q".into(),include_str!("../../snapback4-lang/tests/fixtures/maintained-columns.q").into())]);
        assert!(bound.diagnostics.is_empty(),"{:?}",bound.diagnostics);
        let mut engine=snapback4_core::Engine::memory(bound.schema,[]).unwrap();
        let private = engine.schema().maintains[0].target.clone();
        assert!(!engine.schema().visible(&private));
        let from = engine.seq().unwrap(); // Initial column activation has its own parent barrier.
        assert_eq!(super::check(&mut engine, 0).unwrap().2, ["posts"]);
        let touched: String = engine.store().conn().query_row("SELECT touched FROM _commits WHERE seq=?1", [from as i64], |r| r.get(0)).unwrap();
        assert_eq!(serde_json::from_str::<Vec<String>>(&touched).unwrap(), ["posts"]);
        let events: i64 = engine.store().conn().query_row("SELECT count(*) FROM _log WHERE seq=?1", [from as i64], |r| r.get(0)).unwrap();
        assert_eq!(events, 0);
        let tx = engine.store_mut().transaction().unwrap();
        tx.record_commit(from + 1, 1000, "legacy", "alice", "mutation", &[private, "likes".into()], 1).unwrap();
        tx.commit().unwrap();
        assert_eq!(super::check(&mut engine, from).unwrap().2, ["likes"]);
        let tx=engine.store_mut().transaction().unwrap();
        for seq in from + 2..=from + 501 {tx.record_commit(seq,1000,"like","alice","mutation",&["likes".into()],1).unwrap()}
        tx.commit().unwrap();
        let (seq,_,tables)=super::check(&mut engine,from).unwrap();
        assert_eq!(seq,from + 501);
        assert_eq!(tables,["likes","posts"]);
    }
}

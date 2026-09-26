//! Held change polls: JSON whitespace heartbeats, followed by one JSON result.
use super::{JsonBuffer, Shared, cors, lock, principal_of, query_params, refusal_json, respond_timed};
use serde_json::{Value as Json, json};
use std::io;
use std::time::{Duration, Instant};
use tiny_http::Request;

const HEARTBEAT: Duration = Duration::from_secs(2);

pub(super) fn serve(request: Request, shared: &Shared, url: &str) {
    let params = query_params(url);
    let since: u64 = params.get("since").and_then(|s| s.parse().ok()).unwrap_or(0);
    let wait: u64 = params.get("wait").and_then(|s| s.parse().ok()).unwrap_or(0).min(25);
    let began = Instant::now();
    let deadline = began + Duration::from_secs(wait);
    let paced = began + Duration::from_millis(100);
    let connected = match principal_of(&request, shared) {
        Ok(principal) => principal,
        Err(refusal) => return respond_timed(request, shared, 401, json!({ "denied": refusal_json(&refusal) })),
    };
    let heartbeat = params.get("heartbeat").is_some_and(|s| s == "1") && request.http_version().0 == 1 && request.http_version().1 >= 1;
    let mut response = PollResponse { request: Some(request), started: false, shared };
    let initial = { let wake=lock(&shared.wake); (wake.seq,wake.eph.version.clone(),wake.generation) };
    let epoch = params.get("eph").and_then(|s| s.parse().ok()).unwrap_or(initial.1.epoch);
    let incarnation = params.get("ephi").cloned().unwrap_or(initial.1.incarnation);
    let interest: Option<std::collections::BTreeSet<String>> = params.get("ephTables").map(|s| s.split(',').filter(|s|!s.is_empty()).map(str::to_owned).collect());
    let wants_ephemeral = ["eph", "ephi", "ephTables"].iter().any(|k|params.contains_key(*k));
    let mut reader = {
        let mut engine = lock(&shared.engine);
        if let Err(error) = engine.presence_reconnected(&connected, shared.now()) {
            response.finish(500, json!({ "denied": refusal_json(&error.refusal()) })); return;
        }
        shared.presence.enter(&connected);
        engine.reader().ok()
    };
    let refresh = |reader: &mut Option<snapback4_core::Engine>| {
        match reader {
            Some(reader) => check(reader, since),
            None => check(&mut lock(&shared.engine), since),
        }
    };
    let result = (|| -> Result<_, snapback4_core::RuntimeError> {
        let mut current=refresh(&mut reader)?;
        let mut observed=initial.0;
        let mut sequence_wake=false;
        let mut beat=Instant::now();
        loop {
            // Snapshot and wait share one mutex. Commit cannot pass between
            // the predicate check and the condvar's atomic unlock-and-wait.
            let wake=lock(&shared.wake);
            if wake.seq != observed {
                observed=wake.seq; sequence_wake=true; drop(wake);
                reader=lock(&shared.engine).reader().ok();
                current=refresh(&mut reader)?;
                continue;
            }
            let tables=wake.eph.changed(epoch,Some(&incarnation),interest.as_ref());
            let reset=wake.eph.version.incarnation!=incarnation;
            let eph_ready=reset||!tables.is_empty();
            let durable=wake.generation != initial.2 || sequence_wake || current.0!=since || params.get("store_id").is_some_and(|id|Some(id)!=current.1.as_ref());
            let now=Instant::now();
            if durable || now>=deadline || eph_ready && now>=paced {
                let eph=snapback4_core::engine::ephemeral::Change {epoch:wake.eph.version.epoch,incarnation:wake.eph.version.incarnation.clone(),tables};
                let generation=wake.generation;
                // Replacement publishes its identity with the incarnation. No
                // engine lock is needed to finish an ephemeral-only wake.
                if reset {current.1=wake.store_id.clone();}
                return Ok((current,generation,eph));
            }
            if heartbeat && now>=beat {
                drop(wake); response.heartbeat().map_err(|e|snapback4_core::RuntimeError::Store(e.to_string()))?;
                beat=Instant::now()+HEARTBEAT;continue;
            }
            let mut until=if heartbeat {deadline.min(beat)} else {deadline};
            if eph_ready {until=until.min(paced);}
            #[cfg(test)]
            super::test_work(&shared.poll_wait);
            let (_wake, _timeout)=shared.polls.wait_timeout(wake,until.saturating_duration_since(Instant::now())).unwrap_or_else(|e|e.into_inner());
        }
    })();
    shared.presence.leave(&connected);
    // Recheck bearer liveness on the detached connection. Ephemeral-only
    // wakes must not reacquire the serving engine merely to finish a poll.
    let auth_store_id = lock(&shared.wake).store_id.clone();
    let authenticated = if let Some(reader)=reader.as_ref() {
        if let Some(token)=response.request.as_ref().unwrap().headers().iter().find(|h|h.field.equiv("Authorization")).and_then(|h|h.value.as_str().strip_prefix("Bearer ")) {
            match snapback4_core::identity::resolve_read_only(reader.store(),token.trim(),shared.now(),auth_store_id.as_deref()) {
                Ok(Some(_))=>Ok(()),Ok(None)=>Err(snapback4_core::Refusal::new("E_AUTH","auth","this session is not live; sign in again").guide("personas")),Err(e)=>Err(e.refusal()),
            }
        } else {Ok(())}
    } else {principal_of(response.request.as_ref().unwrap(),shared).map(|_|())};
    if let Err(refusal)=authenticated { response.finish(401,json!({"denied":refusal_json(&refusal)}));return; }
    match result {
        Ok(((seq,store_id,tables),generation,ephemeral))=>{
            let mut reply=json!({"seq":seq,"tables":tables,"generation":generation,"store_id":store_id});
            if wants_ephemeral {reply["ephemeral"]=json!(ephemeral);}
            response.finish(200,reply);
        }
        Err(error)=>{let why=error.refusal();response.finish(if why.retryable {503}else{500},json!({"denied":refusal_json(&why)}));}
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
            for header in cors(request).into_iter().chain(super::ephemeral_headers(self.shared)) { frame.push_str(&format!("{header}\r\n")); }
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
        let mut refused = status >= 400 || super::latency::Reply::refused(&body);
        let mut bytes = JsonBuffer(Vec::new());
        if serde_json::to_writer(&mut bytes, &body).is_err() {
            refused = true;
            let refusal = snapback4_core::error::Refusal::new("E_BOUND", "bound", "the HTTP JSON response exceeds 16 MiB; request fewer changes").guide("reads");
            bytes.0.clear();
            serde_json::to_writer(&mut bytes, &json!({ "denied": refusal_json(&refusal), "serverNow": body["serverNow"], "clockRevision": body["clockRevision"] })).unwrap();
        }
        let mut frame = format!("{:x}\r\n", bytes.0.len()).into_bytes();
        frame.extend_from_slice(&bytes.0);
        frame.extend_from_slice(b"\r\n0\r\n\r\n");
        if self.request.as_mut().unwrap().write_response_frame(&frame).is_ok() {
            self.request.take().unwrap().finish_stream();
            // @ref LLP 3000.019#3.7 — the final frame completes a held poll, not its first heartbeat.
            super::latency::finished(refused);
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

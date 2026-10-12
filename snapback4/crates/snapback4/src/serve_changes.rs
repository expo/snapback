//! Held change polls: JSON whitespace heartbeats, followed by one JSON result.
use super::{trusted_dev_request, JsonBuffer, Shared, cors, lock, principal_of, query_params, refusal_json, respond_timed};
use serde_json::{Value as Json, json};
use std::io;
use std::time::{Duration, Instant};
use tiny_http::Request;

const HEARTBEAT: Duration = Duration::from_secs(2);

pub(super) fn serve(request: Request, shared: &Shared, url: &str) {
    let params = query_params(url);
    let since: u64 = params.get("since").and_then(|s| s.parse().ok()).unwrap_or(0);
    let wait: u64 = super::wait_seconds(url);
    let began = Instant::now();
    let deadline = began + Duration::from_secs(wait);
    let paced = began + Duration::from_millis(100);
    let capability = match principal_of(&request, shared) {
        Ok(principal) => principal,
        Err(refusal) => return respond_timed(request, shared, 401, json!({ "denied": refusal_json(&refusal) })),
    };
    if let Err(denied) = crate::device_handshake::check(shared, crate::device_handshake::header(&request), false) {
        return respond_timed(request, shared, 409, json!({ "denied": refusal_json(&denied) }));
    }
    let connected = &capability.0;
    // @ref LLP 3000.036#6-idle-live-clients-must-not-cost-a-thread — one principal's tabs cannot take the whole viewer pool; refused at once, never queued.
    let _share = if wait > 0 {
        match shared.long_waits.enter(connected) {
            Ok(share) => Some(share),
            Err(limit) => return super::long_waits::refuse_share(request, shared, limit),
        }
    } else { None };
    let present = capability.2 == snapback4_core::identity::SessionScope::Full;
    let heartbeat = params.get("heartbeat").is_some_and(|s| s == "1") && request.http_version().0 == 1 && request.http_version().1 >= 1;
    let mut response = PollResponse { request: Some(request), started: false, shared };
    let initial = { let wake=lock(&shared.wake); (wake.seq,wake.eph.version.clone(),wake.generation) };
    let epoch = params.get("eph").and_then(|s| s.parse().ok()).unwrap_or(initial.1.epoch);
    let incarnation = params.get("ephi").cloned().unwrap_or(initial.1.incarnation);
    let interest: Option<std::collections::BTreeSet<String>> = params.get("ephTables").map(|s| s.split(',').filter(|s|!s.is_empty()).map(str::to_owned).collect());
    let wants_ephemeral = ["eph", "ephi", "ephTables"].iter().any(|k|params.contains_key(*k));
    {
        let mut engine = lock(&shared.engine);
        if present && let Err(error) = engine.presence_reconnected(&connected, shared.now()) {
            response.finish(500, json!({ "denied": refusal_json(&error.refusal()) })); return;
        }
        if present { shared.presence.enter(&connected); }
    }
    let result = (|| -> Result<_, snapback4_core::RuntimeError> {
        // Entry always reads the store: the client may already know a head
        // committed after the last publication (LLP 3000 finding 5).
        let mut current=read_answer(shared, since)?;
        let mut observed=initial.0;
        let mut sequence_wake=false;
        let mut beat=Instant::now();
        loop {
            // Snapshot and wait share one mutex. Commit cannot pass between
            // the predicate check and the condvar's atomic unlock-and-wait.
            let wake=lock(&shared.wake);
            if wake.seq != observed {
                observed=wake.seq; sequence_wake=true; drop(wake);
                current=answer(shared, since)?;
                continue;
            }
            let tables=wake.eph.changed(epoch,Some(&incarnation),interest.as_ref());
            let reset=wake.eph.version.incarnation!=incarnation;
            let eph_ready=reset||!tables.is_empty();
            let durable=wake.generation != initial.2 || sequence_wake || current.0!=since || params.get("store_id").is_some_and(|id|Some(id)!=current.1.as_ref());
            let now=Instant::now();
            if durable || now>=deadline || eph_ready && now>=paced {
                let eph=snapback4_core::engine::ephemeral::Change {preserved:wake.eph.preserved_since(epoch,&incarnation),epoch:wake.eph.version.epoch,incarnation:wake.eph.version.incarnation.clone(),tables};
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
    // @ref LLP 3000.033#1.2 — a reader never enters OR leaves presence.
    if present { shared.presence.leave(&connected); }
    // Recheck bearer liveness on a pooled detached reader. Ephemeral-only
    // wakes must not reacquire the serving engine merely to finish a poll.
    let auth_store_id = lock(&shared.wake).store_id.clone();
    let bearer = response.request.as_ref().unwrap().headers().iter().find(|h|h.field.equiv("Authorization")).and_then(|h|crate::auth::parse_bearer(h.value.as_str())).map(|token| token.trim().to_owned());
    let authenticated = match bearer.map(|token| (shared.reader(), token)) {
        None => Ok(()),
        Some((Ok((reader_epoch, reader)), token)) => {
            let resolved = match snapback4_core::identity::resolve_read_only_supervised(reader.store(),&token,snapback4_core::identity::ServiceSample { now: shared.now(), supervisor_revision: shared.worker_revision.load(std::sync::atomic::Ordering::Acquire) },auth_store_id.as_deref()) {
                Ok(Some(current)) if current == capability => Ok(Ok(())),Ok(_)=>Ok(Err(snapback4_core::identity::diagnostics::refused(reader.store(), &token, shared.now(), trusted_dev_request(response.request.as_ref().unwrap(), shared)))),Err(e)=>Err(e),
            };
            match resolved {
                Ok(outcome) => { lock(&shared.readers).put(&reader_epoch, reader.into_inner()); outcome }
                // As for answers: a reader older than a finishing adoption is
                // not a verdict on the session. Ask again behind the engine.
                Err(_) => principal_of(response.request.as_ref().unwrap(),shared).and_then(|current| if current == capability { Ok(()) } else { Err(snapback4_core::Refusal::new("E_AUTH", "auth", "the poll credential changed")) }),
            }
        }
        Some((Err(_), _)) => principal_of(response.request.as_ref().unwrap(),shared).and_then(|current| if current == capability { Ok(()) } else { Err(snapback4_core::Refusal::new("E_AUTH", "auth", "the poll credential changed")) }),
    };
    if let Err(refusal)=authenticated { response.finish(401,json!({"denied":refusal_json(&refusal)}));return; }
    match result {
        Ok(((seq,store_id,tables,preserved,changes),generation,ephemeral))=>{
            let mut reply=json!({"seq":seq,"tables":tables,"preserved":preserved,"changes":changes,"generation":generation,"store_id":store_id});
            if wants_ephemeral {reply["ephemeral"]=json!(ephemeral);}
            response.finish(200,reply);
        }
        Err(error)=>{let why=error.refusal();response.finish(if why.retryable {503}else{500},json!({"denied":refusal_json(&why)}));}
    }
}

type Checked = (u64, Option<String>, Vec<String>, Vec<String>, Json);
// @ref LLP 3000.036#6-idle-live-clients-must-not-cost-a-thread — one commit wakes every held poll; they share one answer per cursor.
/// Wake answers by (cursor, published head, generation, store identity). Only
/// a held poll woken by a publication asks here, and an answer is computed
/// after reading that publication, so its snapshot is newer than the poll's
/// entry and than anything its client knew when it asked. The answer names
/// no viewer, so polls from the same cursor share one read: a commit costs one
/// read per distinct cursor, not one per held poll. Entry and unheld polls
/// read the store themselves (the published counter is a wake signal, never
/// the source of truth). A shared answer is at most a second old and never
/// below the cursor; failures are not kept.
#[derive(Default)]
pub(crate) struct Answers { entries: std::collections::VecDeque<((u64, u64, u64, Option<String>), Instant, Checked)> }
const ANSWERS_KEPT: usize = 64;
const ANSWER_AGE: Duration = Duration::from_secs(1);

fn answer(shared: &Shared, since: u64) -> Result<Checked, snapback4_core::RuntimeError> {
    let key = { let wake = lock(&shared.wake); (since, wake.seq, wake.generation, wake.store_id.clone()) };
    let mut answers = lock(&shared.change_answers);
    if let Some((_, _, hit)) = answers.entries.iter().find(|(k, at, hit)| *k == key && at.elapsed() < ANSWER_AGE && hit.0 >= since) {
        return Ok(hit.clone());
    }
    let checked = read_answer(shared, since)?;
    // Older publications are never asked for again.
    answers.entries.retain(|(k, at, _)| k.1 >= key.1 && *k != key && at.elapsed() < ANSWER_AGE);
    if answers.entries.len() >= ANSWERS_KEPT { answers.entries.pop_front(); }
    answers.entries.push_back((key, Instant::now(), checked.clone()));
    Ok(checked)
}

fn read_answer(shared: &Shared, since: u64) -> Result<Checked, snapback4_core::RuntimeError> {
    let _timing = super::latency::EngineSpan::new();
    #[cfg(test)]
    super::test_work(&shared.changes_refresh);
    if let Ok((epoch, mut reader)) = shared.reader() {
        // A pooled reader can predate an adoption that has committed but not
        // yet replaced the pool. Only a success is kept; anything else is read
        // again behind the engine, which waits for that adoption to finish.
        if let Ok(checked) = check(&mut reader, since) {
            lock(&shared.readers).put(&epoch, reader.into_inner());
            return Ok(checked);
        }
    }
    let mut engine = lock(&shared.engine);
    match shared.open_reader(&engine) {
        Ok(mut reader) => { drop(engine); check(&mut reader, since) }
        // A memory store has no detached reader: read under the engine.
        Err(_) => check(&mut engine, since),
    }
}

/// The notification's head, identity and invalidations share one read snapshot.
fn check(engine: &mut snapback4_core::engine::Engine, since: u64) -> Result<(u64, Option<String>, Vec<String>, Vec<String>, Json), snapback4_core::error::RuntimeError> {
    use rusqlite::OptionalExtension;
    let all_tables: Vec<_> = engine.schema().visible_tables().map(|(n,_)|n.clone()).collect();
    let schema = engine.schema().clone();
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
    let preserved = snapback4_core::revocation::preserved_between(tx.conn(), &schema, since, head);
    let changes = settlement_changes(tx.conn(), &schema, since, head);
    tx.rollback()?;
    Ok((head, store_id, tables, preserved, changes))
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
            for header in cors(request).into_iter().chain(request.connection_headers()).chain(super::ephemeral_headers(self.shared)).chain(super::latency::header()) { frame.push_str(&format!("{header}\r\n")); }
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
            // @ref LLP 3000.019#3.7 — the final frame completes a held poll, not its first heartbeat.
            super::latency::finished(refused);
            self.request.take().unwrap().finish_stream();
        } else {
            super::latency::finished(true);
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
    fn settlement_intervals_project_private_counts_and_keep_public_fields() {
        let bound = snapback4_lang::compile(&[("schema.q".into(), include_str!("../../snapback4-lang/tests/fixtures/maintained-columns.q").into())]);
        assert!(bound.diagnostics.is_empty());
        let mut engine = snapback4_core::Engine::memory(bound.schema, []).unwrap();
        let maintain = engine.schema().maintains.iter().find(|m| m.private.as_ref().is_some_and(|o| o.column == "likeCount")).unwrap();
        let private = maintain.target.clone();
        let after = engine.seq().unwrap();
        let tx = engine.store_mut().transaction().unwrap();
        tx.record_commit(after + 1, 1000, "like", "alice", "mutation", &["posts".into()], 1).unwrap();
        let proof = serde_json::json!({"unknown":false,"tables":{
            private: {"deleted":false,"population":true,"columns":[]},
            "posts": {"deleted":false,"population":false,"columns":["at"]}
        }});
        tx.conn().execute("INSERT OR REPLACE INTO _change_evidence(seq, footprint) VALUES (?1, ?2)", rusqlite::params![(after + 1) as i64, proof.to_string()]).unwrap();
        tx.commit().unwrap();
        let changes = super::settlement_changes(engine.store().conn(), engine.schema(), after, after + 1);
        assert_eq!(changes, serde_json::json!({"after":after,"through":after+1,"writes":{"posts":["at","likeCount"]}}));
        assert!(!changes.to_string().contains("$column"));
        assert!(super::settlement_changes(engine.store().conn(), engine.schema(), after, after + 2).is_null(), "a gap never certifies fields");
    }
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
        let (seq,_,tables,_,_)=super::check(&mut engine,from).unwrap();
        assert_eq!(seq,from + 501);
        assert_eq!(tables,["likes","posts"]);
    }
}

pub(super) fn ack_preserved(engine: &snapback4_core::Engine, outcome: Option<&snapback4_core::MutationOutcome>) -> Vec<String> {
    match outcome {
        Some(out) if !out.replayed => match out.state {
            snapback4_core::WriteState::Sent { .. } if out.receipt_only => snapback4_core::revocation::Footprint::default().preserved(engine.schema()),
            snapback4_core::WriteState::Sent { seq, .. } => snapback4_core::revocation::preserved_between(engine.store().conn(), engine.schema(), seq.saturating_sub(1), seq),
            _ => Vec::new(),
        }, _ => Vec::new(),
    }
}

// @ref LLP 3000.023#11 — certify the whole interval, including server-only inputs.
pub(super) fn settlement_changes(conn: &rusqlite::Connection, schema: &snapback4_core::Schema, after: u64, through: u64) -> Json {
    let Some(f) = snapback4_core::revocation::footprint_between(conn, after, through).filter(|f| !f.unknown) else { return Json::Null; };
    let mut public = snapback4_core::revocation::Footprint::default();
    for (name, c) in f.tables {
        if schema.visible(&name) {
            let target = public.tables.entry(name).or_default();
            target.deleted |= c.deleted; target.population |= c.population; target.columns.extend(c.columns);
        }
        else if let Some(owner) = schema.maintains.iter().filter(|m| m.target == name).find_map(|m| m.private.as_ref()) {
            // Private aggregate state changes its public owner field, never leaks its formula/table.
            public.tables.entry(owner.table.clone()).or_default().columns.insert(owner.column.clone());
        } else { return Json::Null; }
    }
    let writes: serde_json::Map<String, Json> = public.tables.into_iter().map(|(name, c)|
        (name, if c.population || c.deleted { Json::Null } else { json!(c.columns) })).collect();
    json!({"after":after,"through":through,"writes":writes})
}

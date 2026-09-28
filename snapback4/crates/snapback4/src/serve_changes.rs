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
        shared.open_reader(&engine).ok()
    };
    let refresh = |reader: &mut Option<snapback4_core::Engine>| {
        match reader {
            Some(reader) => {
                let _timing = super::latency::EngineSpan::new();
                #[cfg(test)]
                super::test_work(&shared.changes_refresh);
                check(reader, since)
            },
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
                reader=shared.open_reader(&lock(&shared.engine)).ok();
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
        let _timing = super::latency::EngineSpan::new();
        if let Some(token)=response.request.as_ref().unwrap().headers().iter().find(|h|h.field.equiv("Authorization")).and_then(|h|h.value.as_str().strip_prefix("Bearer ")) {
            match snapback4_core::identity::resolve_read_only(reader.store(),token.trim(),shared.now(),auth_store_id.as_deref()) {
                Ok(Some(_))=>Ok(()),Ok(None)=>Err(snapback4_core::Refusal::new("E_AUTH","auth","this session is not live; sign in again").guide("personas")),Err(e)=>Err(e.refusal()),
            }
        } else {Ok(())}
    } else {principal_of(response.request.as_ref().unwrap(),shared).map(|_|())};
    if let Err(refusal)=authenticated { response.finish(401,json!({"denied":refusal_json(&refusal)}));return; }
    match result {
        Ok(((seq,store_id,tables,non_revoking),generation,ephemeral))=>{
            let mut reply=json!({"seq":seq,"tables":tables,"generation":generation,"store_id":store_id});
            if !non_revoking.is_empty() { reply["nonRevoking"] = json!(non_revoking); }
            if wants_ephemeral {reply["ephemeral"]=json!(ephemeral);}
            response.finish(200,reply);
        }
        Err(error)=>{let why=error.refusal();response.finish(if why.retryable {503}else{500},json!({"denied":refusal_json(&why)}));}
    }
}

/// The notification's head, identity and invalidations share one read snapshot.
fn check(engine: &mut snapback4_core::engine::Engine, since: u64) -> Result<(u64, Option<String>, Vec<String>, Vec<String>), snapback4_core::error::RuntimeError> {
    use rusqlite::OptionalExtension;
    let all_tables: Vec<_> = engine.schema().visible_tables().map(|(n,_)|n.clone()).collect();
    let stable: std::collections::BTreeMap<_, _> = engine.programs().map(|p| (p.name.clone(), non_revoking(engine, &p.name))).collect();
    let tx = engine.store_mut().read_transaction()?;
    let head = tx.next_seq()? - 1;
    let store_id = tx.conn().query_row("SELECT value FROM _meta WHERE key = 'store_id'", [], |row| row.get(0)).optional()?;
    // Same bounded scan as the table feed; program/kind allow a positive proof.
    let mut statement = tx.conn().prepare("SELECT seq,touched,program,kind FROM _commits WHERE seq > ?1 ORDER BY seq LIMIT 500")?;
    let changes = statement.query_map([since as i64], |r| Ok((r.get::<_, i64>(0)? as u64, r.get::<_, String>(1)?, r.get::<_, String>(2)?, r.get::<_, String>(3)?)))?.collect::<Result<Vec<_>, _>>()?;
    let saturated = changes.last().is_some_and(|(seq, ..)| *seq < head);
    let mut tables = Vec::new();
    let mut non_revoking: std::collections::BTreeSet<_> = all_tables.iter().cloned().collect();
    for (_, touched, program, kind) in changes {
        let touched: Vec<String> = serde_json::from_str(&touched).unwrap_or_else(|_| all_tables.clone());
        for table in touched.into_iter().filter(|t| all_tables.contains(t)) {
            if kind != "mutation" || !stable.get(&program).is_some_and(|safe| safe.contains(&table)) { non_revoking.remove(&table); }
            tables.push(table);
        }
    }
    if saturated { tables = all_tables; non_revoking.clear(); }
    drop(statement);
    tables.sort();
    tables.dedup();
    tx.rollback()?;
    non_revoking.retain(|t| tables.contains(t));
    Ok((head, store_id, tables, non_revoking.into_iter().collect()))
}

// @ref LLP 3000.029#7 — only unconditional base-row puts prove non-revocation.
pub(super) fn non_revoking(engine: &snapback4_core::Engine, name: &str) -> Vec<String> {
    use snapback4_core::{ir::{ProgramKind, write_tables}, schema::RuleExpr};
    let Some(program) = engine.programs().find(|p| p.name == name) else { return vec![] };
    if program.kind != ProgramKind::Mutation || program.native { return vec![]; }
    let writes = write_tables(program);
    if writes.iter().any(|(_, kind)| *kind == "delete") { return vec![]; }
    writes.into_iter().filter_map(|(name, _)| {
        let table = engine.schema().tables.get(&name)?;
        (matches!(table.rules.read, RuleExpr::Allow | RuleExpr::Public { .. }) && table.expire.is_none()
            && table.through.is_none() && table.ephemeral.is_none() && table.written_by.is_empty()
            && !engine.schema().maintains.iter().any(|m| m.target == name)).then_some(name)
    }).collect()
}

// The affected query must itself be a direct immutable-key public lookup;
// a public membership table may otherwise be an authority probe for secrets.
pub(super) fn put_retention(engine: &snapback4_core::Engine, name: &str) -> Vec<String> {
    use snapback4_core::{ir::{Expr, Input, Stmt}, schema::{IndexComponent, RuleExpr}};
    let Some(program) = engine.programs().find(|p| p.name == name) else { return vec![] };
    let [Stmt::Return(Expr::Get(read))] = program.body.as_slice() else { return vec![] };
    if program.native || !read.key.iter().all(|k| matches!(k, Expr::Literal(_) | Expr::Input(Input::Viewer)) || matches!(k, Expr::Variable(v) if program.args.contains_key(v))) { return vec![]; }
    let Some(table) = engine.schema().tables.get(&read.table) else { return vec![] };
    let Some(index) = table.index(&read.index) else { return vec![] };
    if index.unique && index.components.len() == read.key.len() && index.components.iter().all(|c| matches!(c, IndexComponent::Column(c) if c == "id" || table.immutable_fields().any(|f| f == c)))
        && matches!(table.rules.read, RuleExpr::Allow | RuleExpr::Public { .. }) && table.expire.is_none()
        && table.through.is_none() && table.ephemeral.is_none() && table.written_by.is_empty()
        && !engine.schema().maintains.iter().any(|m| m.target == read.table) { vec![read.table.clone()] } else { vec![] }
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
            for header in cors(request).into_iter().chain(super::ephemeral_headers(self.shared)).chain(super::latency::header()) { frame.push_str(&format!("{header}\r\n")); }
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
    fn retention_needs_both_a_public_put_and_an_immutable_key_lookup() {
        let source = r#"table profiles:
  principal: principal
  handle: text <=30
  immutable principal
  unique principal
  unique handle
  public 'profiles'
  insert <- allow
  update <- allow
  delete <- allow
  sync public
query mine():
  return profiles[principal = viewer]
query byHandle(handle: text <=30):
  return profiles[handle = handle]
query gated():
  require exists profiles[principal = viewer] else MISSING
  return profiles[id = 'alice']
mutation save():
  upsert profiles[principal = viewer] { principal: viewer, handle: 'alice' }
mutation remove():
  delete profiles[principal = viewer]
"#;
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let programs = bound.programs.into_iter().map(|p| p.program);
        let mut engine = snapback4_core::Engine::memory(bound.schema, programs).unwrap();
        assert_eq!(super::put_retention(&engine, "mine"), ["profiles"]);
        assert!(super::put_retention(&engine, "byHandle").is_empty());
        assert!(super::put_retention(&engine, "gated").is_empty());
        assert!(super::non_revoking(&engine, "remove").is_empty());
        assert_eq!(super::non_revoking(&engine, "save"), ["profiles"]);
        let from = engine.seq().unwrap();
        let tx = engine.store_mut().transaction().unwrap();
        tx.record_commit(from + 1, 1000, "save", "alice", "mutation", &["profiles".into()], 1).unwrap();
        tx.commit().unwrap();
        assert_eq!(super::check(&mut engine, from).unwrap().3, ["profiles"]);
        let tx = engine.store_mut().transaction().unwrap();
        tx.record_commit(from + 2, 1000, "remove", "alice", "mutation", &["profiles".into()], 1).unwrap();
        tx.commit().unwrap();
        assert!(super::check(&mut engine, from).unwrap().3.is_empty(), "one destructive commit spoils the whole interval");
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
        let (seq,_,tables,_)=super::check(&mut engine,from).unwrap();
        assert_eq!(seq,from + 501);
        assert_eq!(tables,["likes","posts"]);
    }
}

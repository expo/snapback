//! Read-only durable metadata and request store binding.
use super::*;

pub(super) fn response_head(engine: &mut Engine) -> Result<(String, u64), Refusal> {
    let tx = engine.store_mut().read_transaction()?;
    let id: String = tx.store_id()?;
    Ok((id, tx.next_seq()? - 1))
}

// @ref LLP 3000.013#6 — a replay belongs to its acknowledged store, even if
// the endpoint changes between the client's probe and this transaction.
pub(super) fn intent_store(engine: &Engine, payload: &Json) -> Result<(), Refusal> {
    let Some(expected) = payload.get("store_id").filter(|id| !id.is_null()) else {
        return Ok(());
    };
    let current = engine.store().store_identity()?;
    if expected
        .as_str()
        .is_some_and(|id| Some(id) == current.as_deref())
    {
        return Ok(());
    }
    Err(Refusal::new(
        "E_STORE_REPLACED",
        "store",
        "the intent belongs to another store; its original outcome is unknown",
    )
    .site("request.store_id")
    .rewrite("reconcile this write with its original store before submitting new intent")
    .guide("sync"))
}

// Typed mutation inputs have one terminal failure envelope, including wire decoding.
pub(super) fn argument_refusal(request:Request,shared:&Shared,id:Option<&str>,why:Refusal){
    if !request.url().starts_with("/m/") {return operation_refusal(request,shared,400,why);}
    match shared.read_identity() {
        Ok((store_id,head,generation))=>{
            let mut reply=json!({"state":"failed","why":refusal_json(&why),"store_id":store_id,"head":head,"generation":generation});
            if let Some(id)=id {reply["id"]=json!(id);}
            respond_timed(request,shared,200,reply);
        }
        Err(error)=>respond_timed(request,shared,503,json!({"denied":refusal_json(&error)})),
    }
}

// @ref LLP 3000.000.000.001#11-wave-22-loop-repairs-dx6 — reconcile the exact bearer before the SDK observes advanced business time.
pub(super) fn session_clock_headers(request: &Request, shared: &Shared) -> Vec<Header> {
    if !shared.staging { return clock_headers(shared).into(); }
    let Ok(token) = crate::auth::bearer_token(request) else { return clock_headers(shared).into(); };
    // Detached readers never fall back to the writer: callers may still hold it.
    // Keep the process clock fixed across the committed authority snapshot, so
    // preserved lifetime and the clock stamp describe the same staging jump.
    let Ok((epoch, reader)) = shared.reader() else {
        return vec![Header::from_bytes("X-Snapback-Session-Timing", "unavailable").unwrap()];
    };
    let identity = lock(&shared.wake).store_id.clone();
    let clock = lock(&shared.clock);
    let now = clock.now().max(shared.time_audience_clock.load(Ordering::Acquire));
    let timing = identity.as_deref().ok_or_else(|| snapback4_core::RuntimeError::Auth("store identity unavailable".into()))
        .and_then(|identity| reader.staging_session_timing(token, now, identity));
    let headers = match timing {
        Ok(timing) => {
            let mut headers = vec![Header::from_bytes("X-Snapback-Session-Timing", "staging").unwrap(),
                Header::from_bytes("X-Snapback-Time", now.to_string()).unwrap(),
                Header::from_bytes("X-Snapback-Clock", clock.revision()).unwrap()];
            if let Some(timing) = timing {
                headers.push(Header::from_bytes("X-Snapback-Session-Expires", timing.expires_at.to_string()).unwrap());
                if let Some(cap) = timing.cap_expires_at { headers.push(Header::from_bytes("X-Snapback-Session-Cap", cap.to_string()).unwrap()); }
            }
            headers
        }
        Err(_) => vec![Header::from_bytes("X-Snapback-Session-Timing", "unavailable").unwrap()],
    };
    drop(clock);
    lock(&shared.readers).put(&epoch, reader.into_inner());
    headers
}

pub(crate) fn clock_headers(shared: &Shared) -> [Header; 2] {
    let clock = lock(&shared.clock);
    let now = clock.now().max(shared.time_audience_clock.load(Ordering::Acquire));
    [Header::from_bytes("X-Snapback-Time", now.to_string()).unwrap(),
     Header::from_bytes("X-Snapback-Clock", clock.revision()).unwrap()]
}

// @ref LLP 3000.017#3.3 — advertise only on ephemeral backends; durable-only HTTP bytes stay unchanged.
// The online tier can discover /schema facts through its ordinary traffic.
pub(crate) fn ephemeral_headers(shared: &Shared) -> Vec<Header> {
    if lock(&shared.wake).eph.tables.is_empty() { return Vec::new(); }
    vec![Header::from_bytes("X-Snapback-Ephemeral", "1").unwrap(),
         Header::from_bytes("Access-Control-Expose-Headers", "X-Snapback-Ephemeral").unwrap()]
}

// @ref LLP 3000.011.003.000#8 — absent request ids stay absent; result.id is the row id.
pub(crate) fn mutation_reply(mut body: Json) -> Json {
    if body.get("id").is_some_and(Json::is_null) { body.as_object_mut().unwrap().remove("id"); }
    body
}

// @ref LLP 3000.009.001.000.001#3.4 — committed facts cross the worker continuation into the response.
pub(super) fn mutation_acknowledgement(shared: &Shared, engine: &mut Engine, acknowledgement: Result<snapback4_core::engine::MutationAcknowledgement, Refusal>)
    -> (Result<snapback4_core::MutationOutcome, Refusal>, Result<(String, u64), Refusal>, Option<Vec<String>>, u64) {
    match acknowledgement {
        Ok(ack) if ack.publication.is_some() => {
            let publication = ack.publication.unwrap();
            #[cfg(test)] super::test_work(&shared.mutation_committed);
            if !ack.outcome.receipt_only {
                trace::mark("mutation_commit");
                shared.publish_commit(&publication);
            }
            (Ok(ack.outcome), Ok((publication.store_id, publication.head)), publication.preserved, publication.generation)
        }
        other => {
            let outcome = other.map(|ack| ack.outcome);
            // A replay discovered during execution still republishes the current
            // head, as before; its historical sequence is not publication data.
            if matches!(&outcome, Ok(out) if !out.receipt_only && matches!(out.state, snapback4_core::WriteState::Sent { .. })) {
                trace::mark("mutation_commit");
                shared.durable_committed(engine);
            }
            let preserved = changes::ack_preserved(engine, outcome.as_ref().ok());
            (outcome, response_head(engine), preserved, engine.generation())
        }
    }
}

// @ref LLP 3000.009.001.000.001#3.3 — identity and head belong to the borrowed query snapshot.
pub(super) fn borrowed_response_head(snapshot: &snapback4_core::store_port::ReadSnapshot<'_>, head: u64) -> Result<(String, u64), Refusal> {
    Ok((snapshot.store_id()?, head))
}

// A failed generation boundary already supplied the refusal; opening another
// snapshot would repeat it during every adoption handoff.
pub(super) fn query_response_head(engine: &mut Engine, metadata: Option<Result<(String, u64), Refusal>>, outcome: &Result<snapback4_core::QueryOutcome, Refusal>) -> Result<(String, u64), Refusal> {
    if let Some(metadata) = metadata { return metadata; }
    if let Err(why) = outcome && why.code == "E_GENERATION" { return Err(why.clone()); }
    response_head(engine)
}

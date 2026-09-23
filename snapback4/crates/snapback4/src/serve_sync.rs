//! Request-side generation discovery; row-page wire forms remain in serve.rs.
use super::*;
use snapback4_core::error::RuntimeError;

enum SyncOutcome<T> {
    Generation(Json),
    Page(T),
}

#[cfg(test)]
pub(super) static MATERIALIZATIONS: Mutex<BTreeMap<String, usize>> = Mutex::new(BTreeMap::new());

// @ref LLP 3000.007.003#5 — learn the answering generation before materializing a stale page.
fn under_generation<T>(engine: &mut Engine, requested: Option<u64>, store_id: &str,
    materialize: impl FnOnce(&mut Engine) -> Result<T, RuntimeError>,
) -> Result<SyncOutcome<T>, RuntimeError> {
    let generation = engine.generation();
    if requested.is_some_and(|requested| requested != generation) {
        let denied = Refusal::new("E_SYNC_GENERATION", "generation", "sync generation changed; adopt /schema before retrying this position").guide("sync");
        return Ok(SyncOutcome::Generation(json!({
            "denied": refusal_json(&denied), "generation": generation,
            "store_id": store_id, "watermark": engine.seq()?,
        })));
    }
    #[cfg(test)]
    { *lock(&MATERIALIZATIONS).entry(store_id.to_owned()).or_default() += 1; }
    materialize(engine).map(SyncOutcome::Page)
}

pub(super) fn serve(request: Request, shared: &Shared, body: &str) {
    let principal = match principal_of(&request, shared) {
        Ok(principal) => principal,
        Err(refusal) => {
            respond(request, 401, json!({ "denied": refusal_json(&refusal) }));
            return;
        }
    };
    let input = match serde_json::from_str::<SyncRequest>(body) {
        Ok(input) if input.pending.len() <= 256 && input.pending.iter().all(|id| !id.is_empty() && id.len() <= 128) => input,
        _ => return respond(request, 400, json!({ "denied": refusal_json(&Refusal::new("E_INPUT", "input", "sync needs { generation?, from, limit, after, stream, pending }: nonnegative integers, a cursor or null, a boolean, and at most 256 ids of 1..128 UTF-8 bytes")) })),
    };
    let SyncRequest { generation: requested_generation, from, limit, mut after, stream, pending, store_id: requested_store } = input;
    let store_id = match lock(&shared.engine).store().meta("store_id") {
        Ok(Some(id)) => id,
        _ => return respond(request, 503, json!({ "denied": refusal_json(&snapback4_core::error::RuntimeError::Store("the server store has no identity".into()).refusal()) })),
    };
    // An old snapshot cursor belongs to its database, not merely its schema.
    if requested_store.as_ref().is_some_and(|id| id != &store_id) { after = None; }
    let limit = limit.clamp(1, 10_000);
    if from == 0 && !stream {
        // `after` is the previous snapshot page's opaque `next` token.
        let (outcome, generation) = {
            let reader = { lock(&shared.engine).reader() };
            match reader {
                Ok(mut reader) => {
                    (under_generation(&mut reader, requested_generation, &store_id, |reader| reader.snapshot_acquisition_page_at(&principal, after.as_deref(), limit, shared.now()).and_then(|page| reader.acknowledged(&principal, &pending, page.watermark).map(|acks| (page, acks)))), reader.generation())
                }
                Err(_) => {
                    let mut engine = lock(&shared.engine);
                    (under_generation(&mut engine, requested_generation, &store_id, |engine| engine.snapshot_acquisition_page_at(&principal, after.as_deref(), limit, shared.now()).and_then(|page| engine.acknowledged(&principal, &pending, page.watermark).map(|acks| (page, acks)))), engine.generation())
                }
            }
        };
        match outcome {
            Ok(SyncOutcome::Page((page, acknowledged))) => {
                let next = page.next.map(|next| next.encode());
                let (events, watermark, held) = (page.events, page.watermark, page.held);
                let overflow = json!({ "generation": generation, "store_id": store_id, "watermark": watermark });
                respond_with_sync(request, 200, SnapshotReply {
                    acquisitions: page.acquisitions, acknowledged, events: SyncEvents::Snapshot(events), generation, store_id,
                    held, more: next.is_some(), next, after, snapshot: true, watermark,
                }, true, Some(overflow));
            }
            Ok(SyncOutcome::Generation(reply)) => respond(request, 200, reply),
            Err(error) => { let refusal = error.refusal(); respond(request, if refusal.retryable { 503 } else if refusal.code == "E_INPUT" { 400 } else { 500 }, json!({ "denied": refusal_json(&refusal) })) }
        }
    } else {
        let (outcome, generation) = {
            let reader = { lock(&shared.engine).reader() };
            match reader {
                Ok(mut reader) => {
                    (under_generation(&mut reader, requested_generation, &store_id, |reader| reader.stream_at(&principal, from, limit, shared.now()).and_then(|page| reader.acknowledged_at(&principal, &pending, page.watermark, page.images_at.unwrap_or(page.watermark)).map(|acks| (page, acks)))), reader.generation())
                }
                Err(_) => {
                    let mut engine = lock(&shared.engine);
                    (under_generation(&mut engine, requested_generation, &store_id, |engine| engine.stream_at(&principal, from, limit, shared.now()).and_then(|page| engine.acknowledged_at(&principal, &pending, page.watermark, page.images_at.unwrap_or(page.watermark)).map(|acks| (page, acks)))), engine.generation())
                }
            }
        };
        match outcome {
            Ok(SyncOutcome::Page((page, (acknowledged, committed_above)))) => {
                let mut overflow = json!({ "generation": generation, "store_id": store_id, "watermark": page.watermark });
                // Whole commits cannot be split by lowering the stream limit.
                // A snapshot pages their current rows individually instead.
                if limit == 1 { overflow["snapshot"] = json!(true); }
                respond_with_sync(request, 200, StreamReply {
                    images_at: page.images_at, committed_above, acquisitions: page.acquisitions, acknowledged, events: SyncEvents::Stream(page.events), generation, store_id,
                    joined: page.joined, more: page.more, snapshot: false, watermark: page.watermark,
                }, true, Some(overflow));
            }
            Ok(SyncOutcome::Generation(reply)) => respond(request, 200, reply),
            Err(error) => { let refusal = error.refusal(); respond(request, if refusal.retryable { 503 } else { 500 }, json!({ "denied": refusal_json(&refusal) })) }
        }
    }
}

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
struct SyncRequest {
    #[serde(default)]
    generation: Option<u64>,
    #[serde(default)]
    from: u64,
    #[serde(default = "sync_limit")]
    limit: usize,
    #[serde(default)]
    after: Option<String>,
    #[serde(default)]
    stream: bool,
    #[serde(default)]
    pending: Vec<String>,
    #[serde(default)]
    store_id: Option<String>,
}
fn sync_limit() -> usize { 2_000 }

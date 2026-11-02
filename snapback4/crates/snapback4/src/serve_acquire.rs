//! Opt-in acquisition uses the snapshot path's admission and response ceiling.
use super::*;
use snapback4_core::partition::{AcquisitionGroup, AcquisitionProgress};

#[derive(serde::Deserialize)]
#[serde(deny_unknown_fields)]
pub(super) struct AcquireRequest {
    /// Null starts the walk. With from=0 the reply pins the cold stream at its
    /// image head; the device must publish nothing before accepting that pin.
    pub cursor: Option<String>,
    #[serde(default)]
    hint: Option<AcquisitionGroup>,
    #[serde(default)]
    pub skip: Vec<AcquisitionGroup>,
}

#[derive(serde::Serialize)]
struct AcquisitionReply {
    /// `pinned` identifies the first cold unit; only it advances watermark to
    /// images_at. Receipts remain split against the request's from, not the pin.
    acquire: AcquisitionProgress,
    #[serde(flatten)]
    stream: StreamReply,
}
impl super::super::latency::Reply for AcquisitionReply {
    fn generation(&self) -> Option<u64> { Some(self.stream.generation) }
}

// @ref LLP 3000.001.001#9-scope-compatibility-and-costs — requesting the advertised protocol opts in; old device capabilities remain sufficient.
pub(super) fn serve(request: Request, shared: &Shared, now: i64, principal: String,
    device: snapback4_core::device_protocol::DeviceEngine, requested_generation: Option<u64>,
    store_id: String, from: u64, limit: usize, pending: Vec<String>, acquire: AcquireRequest,
) {
    let materialize = |engine: &mut Engine| engine.acquisition_page_at(&principal,
        acquire.cursor.as_deref(), acquire.hint.as_ref(), &acquire.skip, from, limit, now, &pending);
    let (outcome, generation) = match shared.reader().map(|(_, reader)| reader) {
        Ok(mut reader) => {
            if let Err(why) = session_identity::persona_read_authority(&request, shared, &reader) {
                return respond_timed(request, shared, 401, json!({"denied": refusal_json(&why)}));
            }
            let generation = reader.generation();
            (under_generation(&mut reader, requested_generation, generation, &store_id, &device, materialize), generation)
        }
        Err(error) if !shared.memory_store() => {
            return respond_timed(request, shared, 503, json!({"denied": error.refusal()}));
        }
        Err(_) => {
            let admission = session_identity::Admission::capture(&request, shared);
            let (principal, store_id) = (principal.clone(), store_id.clone());
            let result = shared.engine.attempt(move |engine, shared| {
                admission?.check(shared, engine, &principal)?;
                let generation = engine.generation();
                let outcome = under_generation(engine, requested_generation, generation, &store_id, &device, |engine|
                    engine.acquisition_page_at(&principal, acquire.cursor.as_deref(), acquire.hint.as_ref(),
                        &acquire.skip, from, limit, now, &pending));
                shared.publish_engine(engine);
                Ok::<_, Refusal>((outcome, generation))
            });
            match result {
                Ok(value) => value,
                Err(why) => return respond_timed(request, shared, 401, json!({"denied": why})),
            }
        }
    };
    match outcome {
        Ok(SyncOutcome::Page(answer)) => {
            let page = answer.page;
            let overflow = json!({"generation": generation, "store_id": store_id, "watermark": from});
            respond_with_sync(request, 200, AcquisitionReply {
                acquire: answer.acquire,
                stream: StreamReply {
                    sent: answer.acknowledged.iter().chain(answer.committed_above.iter())
                        .map(|(id, seq)| (id.clone(), *seq)).collect(),
                    acquisitions: page.acquisitions, acknowledged: answer.acknowledged,
                    committed_above: answer.committed_above, images_at: page.images_at,
                    events: SyncEvents::Stream(page.events), generation, store_id, joined: page.joined,
                    more: page.more, now, snapshot: false, watermark: page.watermark,
                    preserved: None, changes: Json::Null,
                },
            }, true, Some(overflow), Some(shared));
        }
        Ok(SyncOutcome::Version(reply)) => respond_timed(request, shared, 409, reply),
        Ok(SyncOutcome::Generation(reply)) => respond_timed(request, shared, 200, reply),
        Err(error @ RuntimeError::Bound { .. }) => respond_timed(request, shared, 200,
            json!({"denied": refusal_json(&error.refusal()), "generation": generation,
                "store_id": store_id, "watermark": from})),
        Err(error) => {
            let refusal = error.refusal();
            let status = if refusal.retryable { 503 } else if refusal.code == "E_INPUT" { 400 }
                else { 500 };
            respond_timed(request, shared, status, json!({"denied": refusal_json(&refusal)}));
        }
    }
}

//! Discovery has no partition authority. Recovery is an independently checked
//! decision about the next indivisible commit at one requested position.
use super::*;
use snapback4_core::error::RuntimeError;

pub(super) fn serve(request: Request, shared: &Shared, principal: &str, input: SyncRequest) {
    let result = inspect(shared, principal, &input);
    match result {
        Ok(body) => respond(request, 200, body),
        Err(error) => respond(request, if matches!(error, RuntimeError::Input(_)) { 400 } else { 503 }, json!({ "denied": refusal_json(&error.refusal()) })),
    }
}

fn inspect(shared: &Shared, principal: &str, input: &SyncRequest) -> Result<Json, RuntimeError> {
    // Keep identity, generation, head and the measurement in one writer window;
    // release it before writing HTTP bytes. No error payload supplies evidence.
    let mut engine = lock(&shared.engine);
    let store_id = engine.store().meta("store_id")?.ok_or_else(|| RuntimeError::Store("sync metadata is unavailable".into()))?;
    if input.store_id.as_ref().is_some_and(|id| id != &store_id) {
        return Err(RuntimeError::Input("sync metadata belongs to another store; retry ordinary sync".into()));
    }
    let generation = engine.generation();
    let watermark = engine.seq()?;
    let mut body = json!({ "metadata": true, "store_id": store_id, "generation": generation, "watermark": watermark });
    if input.recover && input.store_id.as_ref() == Some(&store_id) && input.generation == Some(generation)
        && input.limit == 1 && (input.from > 0 || input.stream) && input.after.is_none() && input.from <= watermark {
        let page = engine.stream_at(principal, input.from, 1, shared.now())?;
        let acknowledged = engine.acknowledged(principal, &input.pending, page.watermark)?;
        let reply = StreamReply {
            acquisitions: page.acquisitions, acknowledged, events: SyncEvents::Stream(page.events), generation, store_id,
            joined: page.joined, more: page.more, snapshot: false, watermark: page.watermark,
        };
        // Use exactly the ordinary reply serializer and ceiling. Only this
        // writer's overflow flag (not an arbitrary encoding error) grants reset.
        let mut size = ResponseSize { bytes: 0, overflow: false };
        let encoded = serde_json::to_writer(&mut size, &reply);
        if encoded.is_err() && !size.overflow { return Err(RuntimeError::Store("sync recovery encoding failed".into())); }
        body["recovery"] = json!({ "from": input.from, "snapshot": size.overflow });
    }
    Ok(body)
}

struct ResponseSize { bytes: usize, overflow: bool }
impl io::Write for ResponseSize {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > JSON_RESPONSE_CEILING.saturating_sub(self.bytes) {
            self.overflow = true;
            return Err(io::Error::other("sync response exceeds the wire ceiling"));
        }
        self.bytes += bytes.len();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> { Ok(()) }
}

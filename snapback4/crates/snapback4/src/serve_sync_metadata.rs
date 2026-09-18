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
    // Opening a catalog-bound reader is short. Materialization and counting
    // run without the global writer mutex on the file-backed serving store.
    let reader = {
        let engine = lock(&shared.engine);
        if engine.store().conn().path().is_some_and(|path| !path.is_empty()) { Some(engine.reader()?) } else { None }
    };
    match reader {
        Some(mut reader) => inspect_engine(&mut reader, principal, input, shared.now()),
        // dev --fresh and in-memory test hosts have no independent connection.
        // A file-reader failure refuses; it must not fall back to a long lock.
        None => inspect_engine(&mut lock(&shared.engine), principal, input, shared.now()),
    }
}

fn inspect_engine(engine: &mut Engine, principal: &str, input: &SyncRequest, now: i64) -> Result<Json, RuntimeError> {
    let generation = engine.generation();
    let schema = engine.schema().clone();
    // read_transaction validates the reader's catalog identity before opening
    // one deferred snapshot for identity, head, rows and acknowledgements.
    let tx = engine.store_mut().read_transaction()?;
    let store_id: String = tx.conn().query_row("SELECT value FROM _meta WHERE key = 'store_id'", [], |row| row.get(0))?;
    if input.store_id.as_ref().is_some_and(|id| id != &store_id) {
        return Err(RuntimeError::Input("sync metadata belongs to another store; retry ordinary sync".into()));
    }
    let watermark = tx.next_seq()?.saturating_sub(1);
    let mut body = json!({ "metadata": true, "store_id": store_id, "generation": generation, "watermark": watermark });
    if input.recover && input.store_id.as_ref() == Some(&store_id) && input.generation == Some(generation)
        && input.limit == 1 && (input.from > 0 || input.stream) && input.after.is_none() && input.from <= watermark {
        // An event prefix is a strict lower bound on the full reply. Stop
        // fetching current images as soon as that prefix alone overflows.
        // The same borrowed event serializer is used by ordinary StreamReply;
        // a fitting prefix still goes through the exact full-reply count below.
        let mut prefix = ResponseSize { bytes: 0, overflow: false };
        let page = snapback4_core::partition::stream_inspected(&tx, &schema, principal, input.from, 1, now, |event| {
            let encoded = serde_json::to_writer(&mut prefix, &SyncEvent::from(event));
            if encoded.is_err() && !prefix.overflow { return Err(RuntimeError::Store("sync recovery encoding failed".into())); }
            Ok(!prefix.overflow)
        })?;
        let Some(page) = page else {
            body["recovery"] = json!({ "from": input.from, "snapshot": true });
            return Ok(body);
        };
        let acknowledged = Engine::acknowledged_in(&tx, principal, &input.pending, page.watermark)?;
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn oversized_current_images_stop_materializing_at_the_wire_ceiling() {
        use snapback4_core::value::{object, Value};
        let source = "table items:\n  body: text <=400000\n  read <- allow\n  sync public\n";
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut engine = Engine::memory(bound.schema.clone(), vec![]).unwrap();
        engine.seed([("items".into(), object([("id", Value::Id("before".into())), ("body", Value::String("small".into()))]))]).unwrap();
        let from = engine.seq().unwrap();
        engine.seed((0..192).map(|i| ("items".into(), object([("id", Value::Id(format!("item-{i}"))), ("body", Value::String("small".into()))])))).unwrap();
        for n in (0..192).step_by(4) {
            engine.seed((n..n+4).map(|i| ("items".into(), object([("id", Value::Id(format!("item-{i}"))), ("body", Value::String("x".repeat(400000)))])))).unwrap();
        }
        let mut size = ResponseSize { bytes: 0, overflow: false };
        let mut fetched = 0;
        let tx = engine.store_mut().read_transaction().unwrap();
        let page = snapback4_core::partition::stream_inspected(&tx, &bound.schema, "alice", from, 1, 0, |event| {
            fetched += 1;
            let result = serde_json::to_writer(&mut size, &SyncEvent::from(event));
            assert!(result.is_ok() || size.overflow);
            Ok(!size.overflow)
        }).unwrap();
        assert!(page.is_none(), "no partial commit can be returned");
        assert!(size.overflow);
        assert_eq!(fetched, 42, "stop current-image fetches at the first overflowing prefix, not after all 192 rows");
    }

    #[test]
    fn a_stale_reader_cannot_grant_recovery_after_adoption() {
        let dir = std::env::temp_dir().join(format!("sb4-metadata-reader-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("store.sqlite");
        let bound = snapback4_lang::compile(&[("schema.q".into(), "query value():\n  return 1\n".into())]);
        let mut engine = Engine::new(snapback4_core::Store::open(&path).unwrap(), bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
        let mut reader = engine.reader().unwrap();
        let changed = snapback4_lang::compile(&[("schema.q".into(), "query value():\n  return 2\n".into())]);
        engine.adopt(changed.schema, changed.programs.into_iter().map(|p| p.program)).unwrap();
        let input: SyncRequest = serde_json::from_value(json!({ "metadata": true })).unwrap();
        assert!(matches!(inspect_engine(&mut reader, "alice", &input, 0), Err(RuntimeError::Generation(_))));
        drop(reader); drop(engine);
        std::fs::remove_dir_all(dir).unwrap();
    }
}

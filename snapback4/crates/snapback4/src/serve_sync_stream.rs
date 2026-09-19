//! The ordinary reply and its overflow proof share one read snapshot and codec.
//! Only this module can mint OverflowGrant; it has no decoder or public constructor.
use super::*;
use snapback4_core::error::RuntimeError;

// All successful /sync responses cross this opaque boundary. The private
// variants cannot be selected by handle; only read can choose the wire shape.
// Snapshot acquisition is data, not a recovery grant. Neither data variant
// has a recovery field; MetadataReply needs measurement::OverflowGrant.
#[derive(serde::Serialize)]
#[serde(transparent)]
pub(super) struct Reply(ReadReply);

#[derive(serde::Serialize)]
pub(super) struct MetadataReply {
    metadata: bool,
    store_id: String,
    generation: u64,
    watermark: u64,
    #[serde(skip_serializing_if = "Option::is_none")]
    recovery: Option<OverflowGrant>,
}

use measurement::{OverflowGrant, ResponseSize};

#[derive(serde::Serialize)]
#[serde(untagged)]
enum ReadReply { Stream(StreamReply), Snapshot(SnapshotReply), Metadata(MetadataReply) }
enum ReadMode { Stream, Snapshot, Discovery }

pub(super) fn reply(engine: &mut Engine, principal: &str, input: &SyncRequest, now: i64) -> Result<Reply, RuntimeError> {
    let mode = if input.metadata || input.recover { ReadMode::Discovery }
        else if input.from == 0 && !input.stream { ReadMode::Snapshot }
        else { ReadMode::Stream };
    read(engine, principal, input, now, mode).map(Reply)
}

#[cfg(test)]
pub(super) fn metadata(engine: &mut Engine, principal: &str, input: &SyncRequest, now: i64) -> Result<MetadataReply, RuntimeError> {
    match read(engine, principal, input, now, ReadMode::Discovery)? {
        ReadReply::Metadata(reply) => Ok(reply),
        _ => unreachable!("metadata mode returns only metadata"),
    }
}

#[cfg(test)]
pub(super) fn stream(engine: &mut Engine, principal: &str, input: &SyncRequest, now: i64) -> Result<StreamReply, RuntimeError> {
    match read(engine, principal, input, now, ReadMode::Stream)? {
        ReadReply::Stream(reply) => Ok(reply),
        _ => unreachable!("stream test helper returns only stream"),
    }
}

fn read(engine: &mut Engine, principal: &str, input: &SyncRequest, now: i64, mode: ReadMode) -> Result<ReadReply, RuntimeError> {
    let discovery = matches!(mode, ReadMode::Discovery);
    if discovery && input.store_id.as_ref().is_none_or(|id| id.is_empty()) {
        return Err(RuntimeError::Input("sync metadata needs the captured store_id; retry ordinary sync".into()));
    }
    let generation = engine.generation();
    let schema = engine.schema().clone();
    // Catalog validation establishes this deferred SQLite snapshot. Identity,
    // head, selected images, joins/renewals and acks all come from that snapshot,
    // in ordinary streaming too; no second acknowledgement transaction.
    let tx = engine.store_mut().read_transaction()?;
    let store_id: String = tx.conn().query_row("SELECT value FROM _meta WHERE key = 'store_id'", [], |row| row.get(0))?;
    let watermark = tx.next_seq()?.saturating_sub(1);
    if matches!(mode, ReadMode::Snapshot) {
        // A cursor belongs to its store. Identity, snapshot images and acks
        // share this catalog-validated transaction, just like the stream.
        let after = input.after.as_deref().filter(|_| input.store_id.as_ref().is_none_or(|id| id == &store_id));
        let cursor = after.map(|token| snapback4_core::partition::SnapshotCursor::decode(token)
            .ok_or_else(|| RuntimeError::Input("the snapshot cursor is not one this server minted".into()))).transpose()?;
        let page = snapback4_core::partition::snapshot_page(&tx, &schema, principal, cursor, input.limit.clamp(1, 10_000), now)?;
        let acknowledged = Engine::acknowledged_in(&tx, principal, &input.pending, page.watermark)?;
        let next = page.next.map(|next| next.encode());
        return Ok(ReadReply::Snapshot(SnapshotReply {
            acquisitions: page.acquisitions, acknowledged, after: after.map(str::to_owned),
            events: SyncEvents::Snapshot(page.events), generation, held: page.held,
            more: next.is_some(), next, snapshot: true, store_id, watermark: page.watermark,
        }));
    }
    let mut metadata = MetadataReply { metadata: true, store_id: store_id.clone(), generation, watermark, recovery: None };
    if discovery && !(input.recover && input.store_id.as_ref() == Some(&store_id) && input.generation == Some(generation)
        && input.limit == 1 && (input.from > 0 || input.stream) && input.after.is_none() && input.from < watermark) {
        return Ok(ReadReply::Metadata(metadata));
    }
    let mut prefix = ResponseSize::new(input.from, &store_id, generation);
    let page = snapback4_core::partition::stream_inspected(&tx, &schema, principal, input.from, input.limit.clamp(1, 10_000), now, |event| {
        if discovery { prefix.event(event)?; }
        #[cfg(test)]
        if let Some(run) = ON_EVENT.with(|hook| hook.borrow_mut().take()) { run(); }
        #[cfg(test)]
        if ABORT_INSPECTION.with(|abort| abort.get()) { return Ok(false); }
        Ok(!prefix.overflowed())
    })?;
    let Some(page) = page else {
        // An incomplete page carries no authority. Only the consumed counter
        // can supply a grant, and only if its serializer actually overflowed.
        metadata.recovery = prefix.into_grant();
        return if discovery && metadata.recovery.is_some() { Ok(ReadReply::Metadata(metadata)) }
            else { Err(RuntimeError::Store("sync inspection was incomplete without a measured overflow; retry sync".into())) };
    };
    let acknowledged = Engine::acknowledged_in(&tx, principal, &input.pending, page.watermark)?;
    let reply = StreamReply { acquisitions: page.acquisitions, acknowledged, events: SyncEvents::Stream(page.events), generation, store_id: store_id.clone(),
        joined: page.joined, more: page.more, snapshot: false, watermark: page.watermark };
    if !discovery { return Ok(ReadReply::Stream(reply)); }
    let mut size = ResponseSize::new(input.from, &store_id, generation);
    size.reply(&reply)?;
    metadata.recovery = size.into_grant();
    Ok(ReadReply::Metadata(metadata))
}

// Keep construction below the read-path branches: none can set the overflow
// bit or construct a grant, even within this file. The counter captures identity
// before counting; it cannot be rebound to another position after overflow.
mod measurement {
    use super::*;
    #[derive(serde::Serialize)]
    pub(super) struct OverflowGrant {
        from: u64,
        snapshot: bool,
        store_id: String,
        generation: u64,
    }

    struct Counter { bytes: usize, overflow: bool }
    pub(super) struct ResponseSize { counter: Counter, from: u64, store_id: String, generation: u64 }
    impl ResponseSize {
        pub(super) fn new(from: u64, store_id: &str, generation: u64) -> Self {
            Self { counter: Counter { bytes: 0, overflow: false }, from, store_id: store_id.into(), generation }
        }
        pub(super) fn overflowed(&self) -> bool { self.counter.overflow }
        pub(super) fn event(&mut self, event: &snapback4_core::store::LogEvent) -> Result<(), RuntimeError> {
            // A sum of the ordinary serializer's event images is a strict lower
            // bound. This stops further current-image fetches, not the entire walk.
            let encoded = serde_json::to_writer(&mut self.counter, &SyncEvent::from(event));
            self.checked(encoded)
        }
        pub(super) fn reply(&mut self, reply: &StreamReply) -> Result<(), RuntimeError> {
            let encoded = serde_json::to_writer(&mut self.counter, reply);
            self.checked(encoded)
        }
        pub(super) fn checked(&self, encoded: serde_json::Result<()>) -> Result<(), RuntimeError> {
            if encoded.is_err() && !self.counter.overflow { return Err(RuntimeError::Store("sync recovery encoding failed".into())); }
            Ok(())
        }
        pub(super) fn into_grant(self) -> Option<OverflowGrant> {
            self.counter.overflow.then(|| OverflowGrant { from: self.from, snapshot: true, store_id: self.store_id, generation: self.generation })
        }
    }
    impl io::Write for Counter {
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

}

#[cfg(test)]
thread_local! {
    pub(super) static ABORT_INSPECTION: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static ON_EVENT: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
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
        let mut size = ResponseSize::new(from, "test", 1);
        let mut fetched = 0;
        let tx = engine.store_mut().read_transaction().unwrap();
        let page = snapback4_core::partition::stream_inspected(&tx, &bound.schema, "alice", from, 1, 0, |event| {
            fetched += 1;
            let result = size.event(event);
            assert!(result.is_ok() || size.overflowed());
            Ok(!size.overflowed())
        }).unwrap();
        assert!(page.is_none(), "no partial commit can be returned");
        assert!(size.overflowed());
        assert_eq!(fetched, 42, "stop current-image fetches at the first overflowing prefix, not after all 192 rows");
    }

    fn file_snapshot(initially_wide: bool) {
        use snapback4_core::value::{object, Value};
        let dir = std::env::temp_dir().join(format!("sb4-measure-snapshot-{}-{initially_wide}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let source = "table items:\n  body: text <=400000\n  read <- allow\n  sync public\n";
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        let mut writer = Engine::new(snapback4_core::Store::open(&dir.join("store.sqlite")).unwrap(), bound.schema, vec![]).unwrap();
        writer.seed([("items".into(), object([("id", Value::Id("before".into())), ("body", Value::String("small".into()))]))]).unwrap();
        let from = writer.seq().unwrap();
        writer.seed((0..48).map(|i| ("items".into(), object([("id", Value::Id(format!("item-{i}"))), ("body", Value::String("small".into()))])))).unwrap();
        let resize = |engine: &mut Engine, wide: bool| {
            for i in 0..48 { engine.seed([("items".into(), object([("id", Value::Id(format!("item-{i}"))),
                ("body", Value::String(if wide { "x".repeat(400000) } else { "small".into() }))]))]).unwrap(); }
        };
        if initially_wide { resize(&mut writer, true); }
        let mut reader = writer.reader().unwrap();
        let input: SyncRequest = serde_json::from_value(json!({"metadata":true,"recover":true,"from":from,"limit":1,
            "store_id":writer.store().meta("store_id").unwrap(),"generation":writer.generation()})).unwrap();
        let before = stream(&mut reader, "alice", &input, 0).unwrap();
        assert_eq!(serde_json::to_writer(&mut JsonBuffer(Vec::new()), &before).is_err(), initially_wide);
        let writer = std::rc::Rc::new(std::cell::RefCell::new(writer));
        let concurrent = writer.clone();
        ON_EVENT.with(|hook| *hook.borrow_mut() = Some(Box::new(move || resize(&mut concurrent.borrow_mut(), !initially_wide))));
        let measured = metadata(&mut reader, "alice", &input, 0).unwrap();
        assert_eq!(measured.recovery.is_some(), initially_wide, "writes between measured images cannot change the pinned reply");
        let after = stream(&mut reader, "alice", &input, 0).unwrap();
        assert_eq!(serde_json::to_writer(&mut JsonBuffer(Vec::new()), &after).is_err(), !initially_wide, "the concurrent writer really changed ordinary streaming");
        drop(reader); drop(writer);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test] fn file_measurement_cannot_mix_in_later_enlargements() { file_snapshot(false); }
    #[test] fn file_measurement_cannot_mix_in_later_shrinks() { file_snapshot(true); }

}

#[cfg(test)]
#[path = "serve_sync_grant_tests.rs"]
mod grant_tests;

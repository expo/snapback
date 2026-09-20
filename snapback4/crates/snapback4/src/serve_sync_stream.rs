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

use measurement::OverflowGrant;
#[path = "serve_sync_measurement.rs"]
mod measurement;

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
    if discovery {
        metadata.recovery = measurement::measure(&tx, &schema, principal, input, now, &metadata)?;
        return Ok(ReadReply::Metadata(metadata));
    }
    let page = snapback4_core::partition::stream(&tx, &schema, principal, input.from, input.limit.clamp(1, 10_000), now)?;
    let (acknowledged, committed_above) = Engine::acknowledged_at_in(&tx, principal, &input.pending, page.watermark, page.images_at.unwrap_or(page.watermark))?;
    Ok(ReadReply::Stream(StreamReply { images_at: page.images_at, committed_above, acquisitions: page.acquisitions, acknowledged, events: SyncEvents::Stream(page.events), generation, store_id,
        joined: page.joined, more: page.more, snapshot: false, watermark: page.watermark }))
}

#[cfg(test)]
thread_local! {
    pub(super) static ABORT_INSPECTION: std::cell::Cell<bool> = const { std::cell::Cell::new(false) };
    static ON_EVENT: std::cell::RefCell<Option<Box<dyn FnOnce()>>> = const { std::cell::RefCell::new(None) };
}

#[cfg(test)]
mod tests {
    use super::*;
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
            "store_id":writer.store().meta("store_id").unwrap(),"generation":writer.generation(),"send_revision":7})).unwrap();
        let before = stream(&mut reader, "alice", &input, 0).unwrap();
        assert_eq!(serde_json::to_writer(&mut JsonBuffer(Vec::new()), &before).is_err(), initially_wide);
        assert!(serde_json::to_value(&before).unwrap().get("recovery").is_none(), "data streams cannot carry grants");
        let writer = std::rc::Rc::new(std::cell::RefCell::new(writer));
        let concurrent = writer.clone();
        ON_EVENT.with(|hook| *hook.borrow_mut() = Some(Box::new(move || resize(&mut concurrent.borrow_mut(), !initially_wide))));
        let measured = metadata(&mut reader, "alice", &input, 0).unwrap();
        assert_eq!(measured.recovery.is_some(), initially_wide, "writes between measured images cannot change the pinned reply");
        let after = stream(&mut reader, "alice", &input, 0).unwrap();
        assert!(serde_json::to_value(&after).unwrap().get("recovery").is_none(), "data streams cannot carry grants");
        assert_eq!(serde_json::to_writer(&mut JsonBuffer(Vec::new()), &after).is_err(), !initially_wide, "the concurrent writer really changed ordinary streaming");
        drop(reader); drop(writer);
        std::fs::remove_dir_all(dir).unwrap();
    }

    #[test] fn file_measurement_cannot_mix_in_later_enlargements() { file_snapshot(false); }
    #[test] fn file_measurement_cannot_mix_in_later_shrinks() { file_snapshot(true); }

}

//! Real /sync encoders; only request transport is replaced by in-process calls.
use super::*;
use sync_wire::{SnapshotReply, StreamReply, SyncEvents};

pub fn snapshot(e: &mut Engine, who: &str, after: Option<String>, now: i64) -> Vec<u8> {
    let p = e
        .snapshot_acquisition_page_at(who, after.as_deref(), 1000, now)
        .unwrap();
    let next = p.next.map(|n| n.encode());
    serde_json::to_vec(&SnapshotReply { now, sent: Default::default(),
        acknowledged: e.acknowledged(who, &[], p.watermark).unwrap(),
        acquisitions: p.acquisitions,
        events: SyncEvents::Snapshot(p.events),
        generation: e.generation(),
        store_id: e.store().meta("store_id").unwrap().unwrap(),
        held: p.held,
        more: next.is_some(),
        next,
        after,
        snapshot: true,
        watermark: p.watermark,
    })
    .unwrap()
}

pub fn stream(e: &mut Engine, who: &str, from: u64, now: i64) -> Vec<u8> {
    let p = e.stream_at(who, from, 10000, now).unwrap();
    let (acknowledged, committed_above) = e
        .acknowledged_at(who, &[], p.watermark, p.images_at.unwrap_or(p.watermark))
        .unwrap();
    serde_json::to_vec(&StreamReply { preserved: Default::default(), now, sent: Default::default(),
        acknowledged,
        committed_above,
        acquisitions: p.acquisitions,
        events: SyncEvents::Stream(p.events),
        generation: e.generation(),
        store_id: e.store().meta("store_id").unwrap().unwrap(),
        images_at: p.images_at,
        joined: p.joined,
        more: p.more,
        snapshot: false,
        watermark: p.watermark,
    })
    .unwrap()
}

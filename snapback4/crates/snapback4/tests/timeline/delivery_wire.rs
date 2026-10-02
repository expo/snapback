#![allow(dead_code)]
use snapback4_core::{Engine, partition::StreamPage};
pub fn reply(e: &Engine, page: StreamPage) -> crate::sync_wire::StreamReply {
    crate::sync_wire::StreamReply { preserved: Default::default(), now: 0, sent: Default::default(), acquisitions: page.acquisitions, acknowledged: Default::default(), committed_above: Default::default(),
        images_at: page.images_at, events: crate::sync_wire::SyncEvents::Stream(page.events), generation:e.generation(),
        joined:page.joined,more:page.more,snapshot:false,store_id:e.store().meta("store_id").unwrap().unwrap(),watermark:page.watermark }
}

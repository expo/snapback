//! Own the walk as well as the counter: callers cannot feed bytes from another
//! position, limit, or reply shape and then relabel them as recovery evidence.
use super::*;

#[derive(serde::Serialize)]
pub(super) struct OverflowGrant {
    #[serde(flatten)]
    measurement: Measurement,
    snapshot: bool,
}

#[derive(serde::Serialize)]
struct Measurement {
    from: u64,
    limit: usize,
    stream: bool,
    send_revision: u64,
    single_commit: bool,
    commit: u64,
    measured_head: u64,
    store_id: String,
    generation: u64,
}

pub(super) fn measure(tx: &snapback4_core::store::Tx<'_>, schema: &snapback4_core::schema::Schema,
    principal: &str, input: &SyncRequest, now: i64, metadata: &MetadataReply) -> Result<Option<OverflowGrant>, RuntimeError> {
    let Some(mut size) = ResponseSize::new(input, metadata) else { return Ok(None); };
    // These exact captured inputs drive the only walk that can feed the mint.
    // limit 1 selects one indivisible raw commit, including join expansion.
    let page = snapback4_core::partition::stream_inspected(tx, schema, principal, input.from, input.limit, now, |event| {
        size.event(event)?;
        #[cfg(test)]
        if let Some(run) = ON_EVENT.with(|hook| hook.borrow_mut().take()) { run(); }
        #[cfg(test)]
        if ABORT_INSPECTION.with(|abort| abort.get()) { return Ok(false); }
        Ok(!size.counter.overflow)
    })?;
    if let Some(page) = page {
        let (acknowledged, committed_above) = Engine::acknowledged_at_in(tx, principal, &input.pending, page.watermark, page.images_at.unwrap_or(page.watermark))?;
        let reply = StreamReply { images_at: page.images_at, committed_above, acquisitions: page.acquisitions, acknowledged, events: SyncEvents::Stream(page.events),
            generation: metadata.generation, store_id: metadata.store_id.clone(), joined: page.joined,
            more: page.more, snapshot: false, watermark: page.watermark };
        size.reply(&reply)?;
    } else if !size.counter.overflow {
        return Err(RuntimeError::Store("sync inspection was incomplete without a measured overflow; retry sync".into()));
    }
    Ok(size.into_grant())
}

struct Counter { bytes: usize, overflow: bool }
struct ResponseSize { counter: Counter, evidence: Measurement, valid: bool }
impl ResponseSize {
    fn new(input: &SyncRequest, metadata: &MetadataReply) -> Option<Self> {
        let revision = input.send_revision.filter(|r| *r <= 9_007_199_254_740_991)?;
        if !input.recover || input.store_id.as_ref() != Some(&metadata.store_id) || input.generation != Some(metadata.generation)
            || input.limit != 1 || input.after.is_some() || input.from >= metadata.watermark { return None; }
        Some(Self { counter: Counter { bytes: 0, overflow: false }, valid: true,
            evidence: Measurement { from: input.from, limit: input.limit, stream: input.stream, send_revision: revision,
                single_commit: true, commit: 0, measured_head: metadata.watermark,
                store_id: metadata.store_id.clone(), generation: metadata.generation } })
    }
    fn event(&mut self, event: &snapback4_core::store::LogEvent) -> Result<(), RuntimeError> {
        if self.counter.overflow { return self.checked(Err(<serde_json::Error as serde::ser::Error>::custom("counting after overflow"))); }
        if self.evidence.commit == 0 { self.evidence.commit = event.seq; }
        self.evidence.single_commit &= event.seq == self.evidence.commit && event.seq > self.evidence.from;
        // A strict lower bound, using the ordinary event serializer. Stops
        // current-image fetching, not the entire underlying log traversal.
        let encoded = serde_json::to_writer(&mut self.counter, &SyncEvent::from(event));
        self.checked(encoded)
    }
    fn reply(&mut self, reply: &StreamReply) -> Result<(), RuntimeError> {
        if self.counter.overflow { return self.checked(Err(<serde_json::Error as serde::ser::Error>::custom("counting after overflow"))); }
        self.counter.bytes = 0;
        let encoded = serde_json::to_writer(&mut self.counter, reply);
        self.checked(encoded)
    }
    fn checked(&mut self, encoded: serde_json::Result<()>) -> Result<(), RuntimeError> {
        if let Err(error) = encoded {
            if self.counter.overflow && error.io_error_kind() == Some(io::ErrorKind::FileTooLarge) { return Ok(()); }
            self.valid = false;
            return Err(RuntimeError::Store("sync recovery encoding failed".into()));
        }
        Ok(())
    }
    fn into_grant(self) -> Option<OverflowGrant> {
        (self.valid && self.counter.overflow && self.evidence.single_commit
            && self.evidence.commit > self.evidence.from && self.evidence.commit <= self.evidence.measured_head).then(|| OverflowGrant { measurement: self.evidence, snapshot: true })
    }
}
impl io::Write for Counter {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > JSON_RESPONSE_CEILING.saturating_sub(self.bytes) {
            self.overflow = true;
            return Err(io::Error::new(io::ErrorKind::FileTooLarge, "sync response exceeds the wire ceiling"));
        }
        self.bytes += bytes.len();
        Ok(bytes.len())
    }
    fn flush(&mut self) -> io::Result<()> { Ok(()) }
}

#[cfg(test)]
#[path = "serve_sync_grant_tests.rs"]
mod tests;

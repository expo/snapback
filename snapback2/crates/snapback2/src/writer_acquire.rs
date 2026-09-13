//! Native acquisition owns one bounded wire frame; product replay is unchanged.
// @ref LLP 1001#native-owner-image-pipeline — typed rows reach one encoded frame,
// and native receipt commits hand their durable record directly to the owner.
// @ref LLP 1019#native-acquisition-restart — fairness separates complete units.
use super::*;
use serde::Deserialize;
use snapback2_core::{ColumnType, CursorColumn, decode_cursor_for};

const MAX_BYTES: usize = 1_048_576;
const ERROR_RESERVE: usize = 4096;
const MAX_WORK: Duration = Duration::from_millis(20);

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct Request {
    protocol: u8,
    generation: String,
    schema_hash: String,
    auth_epoch: u64,
    log: String,
    after: Option<String>,
    #[serde(default)]
    receipts: Vec<Packet>,
    #[serde(default = "eight")]
    pages: usize,
}
fn eight() -> usize { 8 }

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Packet { id: String, events: Vec<String> }

/// Rows/pages contain their final JSON bytes, without outer array delimiters.
/// Small metadata is the only JSON tree retained by the response builder.
struct Frame {
    metadata: Json,
    rows: Vec<u8>,
    pages: Vec<u8>,
    row_count: usize,
    page_count: usize,
}
impl Frame {
    fn new(metadata: Json) -> Self {
        Self { metadata, rows: Vec::new(), pages: Vec::new(), row_count: 0, page_count: 0 }
    }
    fn len(&self) -> usize {
        // Replace the metadata's final } with these two arrays and final }.
        serde_json::to_vec(&self.metadata).expect("metadata serializes").len() - 1
            + b",\"rows\":[".len() + self.rows.len()
            + b"],\"pages\":[".len() + self.pages.len() + b"]}".len()
    }
    fn append(&mut self, rows: &[u8], count: usize, page: &[u8]) -> bool {
        let extra = rows.len() + usize::from(count > 0 && self.row_count > 0)
            + page.len() + usize::from(self.page_count > 0);
        // `more:false` may add one byte after admission; preserve its space too.
        if self.len().saturating_add(extra).saturating_add(1) > MAX_BYTES - ERROR_RESERVE { return false; }
        if count > 0 {
            if self.row_count > 0 { self.rows.push(b','); }
            self.rows.extend_from_slice(rows);
            self.row_count += count;
        }
        if self.page_count > 0 { self.pages.push(b','); }
        self.pages.extend_from_slice(page);
        self.page_count += 1;
        true
    }
    fn error(&mut self, refusal: &Refusal) {
        self.metadata["error"] = crate::protocol::refusal_json(refusal);
        if self.len() > MAX_BYTES {
            self.metadata["error"] = json!({"code":"E_BOUND","family":"bound",
                "message":"native page refusal exceeds response capacity",
                "rewrite":"use the authored bounded query surface","guide":"bound/ceiling"});
        }
    }
    fn finish(self) -> Result<Vec<u8>, Refusal> {
        if self.len() > MAX_BYTES { return Err(frame_bound()); }
        let mut bytes = serde_json::to_vec(&self.metadata).expect("metadata serializes");
        assert_eq!(bytes.pop(), Some(b'}'));
        bytes.extend_from_slice(b",\"rows\":[");
        bytes.extend_from_slice(&self.rows);
        bytes.extend_from_slice(b"],\"pages\":[");
        bytes.extend_from_slice(&self.pages);
        bytes.extend_from_slice(b"]}");
        debug_assert!(bytes.len() <= MAX_BYTES);
        Ok(bytes)
    }
}
fn frame_bound() -> Refusal {
    Refusal::new("E_BOUND", "bound", "native page exceeds 1 MiB response",
        "use the authored bounded query surface", "bound/ceiling")
}

impl State {
    pub(super) fn acquire_encoded(&mut self, body: Json, identity: Identity) -> Result<Vec<u8>, Refusal> {
        self.acquire_encoded_with_work(body, identity, MAX_WORK)
    }
    #[cfg(test)]
    pub(super) fn acquire(&mut self, body: Json, identity: Identity) -> Result<Json, Refusal> {
        self.acquire_with_work(body, identity, MAX_WORK)
    }
    #[cfg(test)]
    pub(super) fn acquire_with_work(&mut self, body: Json, identity: Identity, max_work: Duration) -> Result<Json, Refusal> {
        self.acquire_encoded_with_work(body, identity, max_work)
            .map(|bytes| serde_json::from_slice(&bytes).expect("native frame is JSON"))
    }
    fn acquire_encoded_with_work(&mut self, body: Json, identity: Identity, max_work: Duration) -> Result<Vec<u8>, Refusal> {
        let started = Instant::now();
        let authority = self.resolve_authority(identity)?;
        let request: Request = serde_json::from_value(body).map_err(|_| Refusal::input(
            "invalid native acquisition request", "send protocol 1 with generation, schemaHash, authEpoch, log, after and bounded receipts"))?;
        if request.protocol != 1 || !(1..=8).contains(&request.pages) || request.receipts.len() > 16 {
            return Err(Refusal::input("native acquisition requires protocol 1, 1..8 pages and at most 16 receipt packets", "use a bounded native acquisition request"));
        }
        let mut packet_ids = BTreeSet::new();
        for packet in &request.receipts {
            if packet.id.is_empty() || packet.id.len() > 128 || !packet_ids.insert(&packet.id)
                || packet.events.is_empty() || packet.events.len() > 50 {
                return Err(Refusal::input("receipt packets require unique bounded IDs and 1..50 events", "retain the exact packet ID and events across retries"));
            }
        }
        let generation = self.runtime().generation();
        if request.generation != generation.program_hash() || request.schema_hash != generation.schema().hash()
            || request.auth_epoch != authority.auth_epoch() {
            return Err(Refusal::offline("E_OFFLINE_RESUME", "native acquisition identity is no longer current"));
        }
        let content = self.runtime().acquisition_content(&request.log)
            .map_err(|e| Refusal::from_runtime(&e))?.to_owned();
        if let Some(after) = &request.after {
            decode_cursor_for(generation.schema(), after, &request.log, "byRecipient", Order::Asc,
                &[CursorColumn { name: "seq".into(), kind: ColumnType::Int }, CursorColumn { name: "id".into(), kind: ColumnType::Id }])
                .map_err(|_| Refusal::input("native acquisition cursor is not canonical for this log", "resume with the last committed cursor"))?;
        }
        let context = self.execution_context(&authority, BTreeMap::new())?;
        let mut receipts = Vec::new();
        for packet in request.receipts.iter().take(8) {
            if !receipts.is_empty() && started.elapsed() >= max_work { break; }
            let outcome = self.runtime_mut().acquire_receipts(&request.log, packet.events.clone(), context.clone());
            let result = match outcome {
                Ok(acknowledgement) => {
                    if let Some(commit) = acknowledgement.commit { self.after_commit_record(commit)?; }
                    json!({"id":packet.id,"state":"complete","seq":acknowledgement.execution.seq})
                }
                Err(error) => json!({"id":packet.id,"state":"rejected","seq":self.runtime().store().commit_seq().map_err(|e| Refusal::from_runtime(&e))?,"code":error.code()}),
            };
            receipts.push(result);
        }
        let pending_receipts = receipts.len() < request.receipts.len();
        let has_receipts = !receipts.is_empty();
        let mut frame = Frame::new(json!({
            "protocol":1,"generation":request.generation,"schemaHash":request.schema_hash,
            "authority":{"principal":authority.principal.id.as_str(),"authEpoch":authority.auth_epoch()},
            "log":request.log,"content":content,"seq":self.runtime().store().commit_seq().map_err(|e| Refusal::from_runtime(&e))?,
            "readTime":context.read_time,"receipts":receipts,"more":true,
        }));
        let mut pooled = BTreeMap::<String, BTreeSet<String>>::new();
        let mut after = request.after;
        for ordinal in 0..request.pages {
            if (ordinal > 0 || has_receipts) && started.elapsed() >= max_work { break; }
            let read = match self.runtime_mut().acquire_page(&request.log, after.clone(), context.clone()) {
                Ok(read) => read,
                Err(error) => {
                    let refusal = Refusal::from_runtime(&error);
                    if !has_receipts && ordinal == 0 { return Err(refusal); }
                    frame.error(&refusal);
                    break;
                }
            };
            let mut rows = Vec::new();
            let mut identities = Vec::new();
            for row in read.rows {
                if pooled.get(&row.table).is_some_and(|ids| ids.contains(&row.id)) { continue; }
                if !identities.is_empty() { rows.push(b','); }
                serde_json::to_writer(&mut rows, &row).expect("native typed row serializes");
                identities.push((row.table, row.id));
            }
            let page = serde_json::to_vec(&read.page).expect("native page serializes");
            frame.metadata["seq"] = json!(read.seq);
            if !frame.append(&rows, identities.len(), &page) {
                if ordinal == 0 { frame.error(&frame_bound()); }
                break;
            }
            for (table, id) in identities { pooled.entry(table).or_default().insert(id); }
            after = read.page.cursor;
            frame.metadata["more"] = json!(pending_receipts || !read.page.exhausted);
            if read.page.exhausted { break; }
        }
        frame.finish()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_acquisition_encoded_frame_bounds_survive_suffix_refusal_and_escaping() {
        let mut frame = Frame::new(json!({"receipts":[{"id":"kept","state":"complete","seq":3}],"more":true}));
        let first = serde_json::to_vec(&json!({"id":"one","body":"é\\\"\n"})).unwrap();
        assert!(frame.append(&first, 1, b"{\"cursor\":\"one\"}"));
        let large = serde_json::to_vec(&json!({"id":"two","body":"x".repeat(MAX_BYTES-ERROR_RESERVE-500)})).unwrap();
        assert!(frame.append(&large, 1, b"{\"cursor\":\"two\"}"));
        let prior = frame.len();
        assert!(!frame.append(&vec![b'x'; 1000], 1, b"{}"));
        assert_eq!(frame.len(), prior);
        frame.error(&Refusal::input("x".repeat(MAX_BYTES), "retry"));
        let expected = frame.len();
        let bytes = frame.finish().unwrap();
        assert_eq!(bytes.len(), expected);
        assert!(bytes.len() <= MAX_BYTES);
        let decoded: Json = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(decoded["rows"][0]["body"], "é\\\"\n");
        assert_eq!(decoded["rows"].as_array().unwrap().len(), 2);
        assert_eq!(decoded["pages"].as_array().unwrap().len(), 2);
        assert_eq!(decoded["receipts"][0]["id"], "kept");
        assert_eq!(decoded["error"]["code"], "E_BOUND");
    }

    #[test]
    fn native_acquisition_never_returns_an_oversized_metadata_frame() {
        let frame = Frame::new(json!({"generation":"x".repeat(MAX_BYTES)}));
        assert_eq!(frame.finish().unwrap_err().code, "E_BOUND");
    }
}

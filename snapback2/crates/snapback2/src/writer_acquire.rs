//! The isolated native acquisition protocol; product mutation replay is unchanged.
// @ref LLP 1019#native-acquisition-restart — pages and native receipt packets
// share one authenticated owner turn, with fairness between bounded units.
use super::*;
use serde::Deserialize;
use snapback2_core::{ColumnType, CursorColumn, decode_cursor_for};

const MAX_BYTES: usize = 1_048_576;
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

fn page_error(error: &Refusal, used: usize) -> Json {
    let value = crate::protocol::refusal_json(error);
    if used.saturating_add(serde_json::to_vec(&value).expect("refusal serializes").len()).saturating_add(16) <= MAX_BYTES {
        value
    } else {
        json!({"code":"E_BOUND","family":"bound","message":"native page refusal exceeds response capacity",
            "rewrite":"use the authored bounded query surface","guide":"bound/ceiling"})
    }
}

impl State {
    pub(super) fn acquire(&mut self, body: Json, identity: Identity) -> Result<Json, Refusal> {
        self.acquire_with_work(body, identity, MAX_WORK)
    }

    pub(super) fn acquire_with_work(&mut self, body: Json, identity: Identity, max_work: Duration) -> Result<Json, Refusal> {
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
        // Every page uses this clock; packet writes finish before any row pool
        // is collected, so pooled images also share one final commit sequence.
        let context = self.execution_context(&authority, BTreeMap::new())?;
        let mut receipts = Vec::new();
        for packet in request.receipts.iter().take(8) {
            if !receipts.is_empty() && started.elapsed() >= max_work { break; }
            let outcome = self.runtime_mut().acquire_receipts(&request.log, packet.events.clone(), context.clone());
            let result = match outcome {
                Ok(execution) => {
                    if !execution.trace.writes.is_empty() { self.after_commit(execution.seq)?; }
                    json!({"id":packet.id,"state":"complete","seq":execution.seq})
                }
                Err(error) => json!({"id":packet.id,"state":"rejected","seq":self.runtime().store().commit_seq().map_err(|e| Refusal::from_runtime(&e))?,"code":error.code()}),
            };
            receipts.push(result);
        }
        let pending_receipts = receipts.len() < request.receipts.len();
        let mut response = json!({
            "protocol":1,"generation":request.generation,"schemaHash":request.schema_hash,
            "authority":{"principal":authority.principal.id.as_str(),"authEpoch":authority.auth_epoch()},
            "log":request.log,"content":content,"seq":self.runtime().store().commit_seq().map_err(|e| Refusal::from_runtime(&e))?,
            "readTime":context.read_time,"rows":[],"pages":[],"receipts":receipts,"more":true,
        });
        let mut bytes = serde_json::to_vec(&response).expect("JSON serializes").len();
        let mut pooled = BTreeSet::new();
        let mut after = request.after;
        for ordinal in 0..request.pages {
            if (ordinal > 0 || !response["receipts"].as_array().unwrap().is_empty()) && started.elapsed() >= max_work { break; }
            let read = match self.runtime_mut().acquire_page(&request.log, after.clone(), context.clone()) {
                Ok(read) => read,
                Err(error) => {
                    let refusal = Refusal::from_runtime(&error);
                    if response["receipts"].as_array().unwrap().is_empty() && ordinal == 0 { return Err(refusal); }
                    response["error"] = page_error(&refusal, bytes);
                    break;
                }
            };
            let rows = read.rows.into_iter().filter(|row| !pooled.contains(&(row.table.clone(), row.id.clone()))).collect::<Vec<_>>();
            let page = serde_json::to_value(&read.page).expect("native page serializes");
            let added = serde_json::to_vec(&rows).expect("rows serialize").len()
                + serde_json::to_vec(&page).expect("page serializes").len() + 2;
            // Leave bounded room for a final refusal. Unlike generic query
            // batches, this protocol never overshoots its complete 1 MiB frame.
            if bytes + added > MAX_BYTES - 4096 {
                if ordinal == 0 {
                    response["error"] = json!({"code":"E_BOUND","family":"bound","message":"native page exceeds 1 MiB response","rewrite":"use the authored bounded query surface","guide":"bound/ceiling"});
                }
                break;
            }
            bytes += added;
            for row in rows {
                pooled.insert((row.table.clone(), row.id.clone()));
                response["rows"].as_array_mut().unwrap().push(serde_json::to_value(row).expect("row serializes"));
            }
            response["seq"] = json!(read.seq);
            after = read.page.cursor.clone();
            response["pages"].as_array_mut().unwrap().push(page);
            response["more"] = json!(pending_receipts || !read.page.exhausted);
            if read.page.exhausted { break; }
        }
        Ok(response)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn native_acquisition_refusal_cannot_overflow_a_committed_response_prefix() {
        let used = MAX_BYTES - 4096;
        let long = Refusal::input("x".repeat(MAX_BYTES), "retry");
        let error = page_error(&long, used);
        assert_eq!(error["code"], "E_BOUND");
        assert!(used + serde_json::to_vec(&error).unwrap().len() + 16 <= MAX_BYTES);
        let short = Refusal::input("invalid page", "retry");
        assert_eq!(page_error(&short, used), crate::protocol::refusal_json(&short));
    }
}

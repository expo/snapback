//! Finite acquisition batches on the existing query and mutation routes.
// @ref LLP 1018.008.007.002#3-bounded-query-batches — one bounded owner turn;
// network backpressure and the next batch never occupy this owner action.

use super::*;
use snapback2_core::certificate::resumable_log_cursor;

const MAX_BATCH: usize = 16;
const MAX_BYTES: usize = 1_048_576;
const MAX_WORK: Duration = Duration::from_millis(20);

struct Batch {
    values: Vec<Json>,
    bytes: usize,
    max_bytes: usize,
    max_work: Duration,
    started: Instant,
}

impl Batch {
    fn new(field: &str) -> Self {
        Self {
            values: Vec::new(),
            bytes: encoded_length(&json!({field: [], "more": false})),
            max_bytes: MAX_BYTES,
            max_work: MAX_WORK,
            started: Instant::now(),
        }
    }

    fn stopped(&self) -> bool {
        !self.values.is_empty()
            && (self.bytes >= self.max_bytes || self.started.elapsed() >= self.max_work)
    }

    /// Read-only frames may be repeated next turn. Executed terminals cannot
    /// be omitted: a complete final terminal is the permitted replay overshoot.
    fn push(&mut self, value: Json, terminal: bool) -> bool {
        let added = encoded_length(&value) + usize::from(!self.values.is_empty());
        if !terminal && !self.values.is_empty() && self.bytes + added > self.max_bytes {
            return false;
        }
        self.bytes += added;
        self.values.push(value);
        true
    }

    fn response(self, field: &str, more: bool) -> Json {
        json!({field: self.values, "more": more})
    }

    fn failure(self, field: &str, error: Refusal) -> Result<Json, Refusal> {
        let refusal = crate::protocol::refusal_json(&error);
        // A refusal belongs to the next unreturned position. If it cannot fit
        // beside the durable prefix, leave that position for the next request.
        // An oversized first refusal retains the ordinary HTTP refusal form.
        if self.bytes + encoded_length(&refusal) + b",\"error\":".len() > self.max_bytes {
            return if self.values.is_empty() {
                Err(error)
            } else {
                Ok(self.response(field, true))
            };
        }
        let mut response = self.response(field, false);
        response["error"] = refusal;
        Ok(response)
    }
}

fn encoded_length(value: &Json) -> usize {
    // Json owns no fallible custom serializer. Count each frame once, never
    // serialize the growing collection again to measure a transport limit.
    serde_json::to_vec(value)
        .expect("JSON values serialize")
        .len()
}

fn batch_count(count: Option<u64>) -> Result<usize, Refusal> {
    count
        .filter(|count| (1..=MAX_BATCH as u64).contains(count))
        .map(|count| count as usize)
        .ok_or_else(|| {
            Refusal::input(
                "batch must contain between 1 and 16 operations",
                "send a bounded acquisition batch",
            )
        })
}

fn operation(body: &Json) -> Result<(&str, Json), Refusal> {
    let op = body.get("op").and_then(Json::as_str).ok_or_else(|| {
        Refusal::input(
            "batch operation must name op",
            "send the ordinary op and named args",
        )
    })?;
    Ok((op, body.get("args").cloned().unwrap_or_else(|| json!({}))))
}

impl State {
    pub(super) fn query_batch(&mut self, body: Json, identity: Identity) -> Result<Json, Refusal> {
        self.query_batch_with(body, identity, Batch::new("pages"))
    }

    fn query_batch_with(
        &mut self,
        body: Json,
        identity: Identity,
        mut batch: Batch,
    ) -> Result<Json, Refusal> {
        let count = batch_count(body.get("batch").and_then(Json::as_u64))?;
        let (op, mut args) = operation(&body)?;
        let authority = self.resolve_authority(identity)?;
        self.admit_drain(op)?;
        let (program, certificate) = &self.runtime().generation().programs()[op];
        let cursor = resumable_log_cursor(program, certificate).expect("drain admitted");
        let mut seen = BTreeSet::new();
        if let Some(cursor) = args.get(&cursor).and_then(Json::as_str) {
            seen.insert(cursor.to_owned());
        }
        loop {
            let full = self.execute_batch_page(op, args.clone(), &authority);
            let envelope = match full {
                Ok(envelope) => envelope,
                Err(error) => return batch.failure("pages", error),
            };
            let next = envelope["next"].as_str().map(str::to_owned);
            let complete = matches!(envelope["state"].as_str(), Some("complete" | "capped"));
            if complete && next.as_ref().is_some_and(|next| !seen.insert(next.clone())) {
                return batch.failure(
                    "pages",
                    Refusal::offline(
                        "E_OFFLINE_RESUME",
                        "the acquisition page repeated its cursor",
                    )
                    .with_detail("reason", json!("repeated-cursor")),
                );
            }
            if !batch.push(json!({"args": args, "envelope": envelope}), false) {
                return Ok(batch.response("pages", true));
            }
            let Some(next) = next.filter(|_| complete) else {
                return Ok(batch.response("pages", false));
            };
            if batch.values.len() == count || batch.stopped() {
                return Ok(batch.response("pages", true));
            }
            args.as_object_mut()
                .expect("execution validated named args")
                .insert(cursor.clone(), Json::String(next));
        }
    }

    fn execute_batch_page(
        &mut self,
        op: &str,
        args: Json,
        authority: &writer_auth::ResolvedAuthority,
    ) -> Result<Json, Refusal> {
        let context = self.context(authority, op, args)?;
        let execution = self
            .runtime_mut()
            .execute(op, context.clone())
            .map_err(|error| Refusal::from_runtime(&error))?;
        writer_offline::envelope_json(self.runtime().generation(), op, &context, &execution)
    }

    // @ref LLP 1018.008.007.002#5-batch-acknowledgement-admission-and-replay —
    // each result has its own ordinary transaction, effects and durable intent.
    pub(super) fn replay_batch(&mut self, body: Json, identity: Identity) -> Result<Json, Refusal> {
        self.replay_batch_with(body, identity, Batch::new("results"))
    }

    fn replay_batch_with(
        &mut self,
        body: Json,
        identity: Identity,
        mut batch: Batch,
    ) -> Result<Json, Refusal> {
        let entries = body.get("batch").and_then(Json::as_array);
        batch_count(entries.map(|entries| entries.len() as u64))?;
        let entries = entries.expect("bounded array checked");
        let authority = self.resolve_authority(identity)?;
        for (index, entry) in entries.iter().enumerate() {
            let result = (|| {
                let (op, args) = operation(entry)?;
                let mut replay = entry
                    .get("replay")
                    .filter(|value| value.is_object())
                    .cloned()
                    .ok_or_else(|| {
                        Refusal::input(
                            "batch entry requires a replay envelope",
                            "send the unchanged durable replay envelope",
                        )
                    })?;
                if let Some(expected) = entry.get("expectedGeneration") {
                    replay["expectedGeneration"] = expected.clone();
                }
                self.execute_replayed_mutation(op, args, &authority, replay, true)
            })();
            match result {
                Ok(terminal) => {
                    batch.push(terminal, true);
                }
                Err(error) => return batch.failure("results", error),
            }
            if batch.stopped() {
                return Ok(batch.response("results", index + 1 < entries.len()));
            }
        }
        Ok(batch.response("results", false))
    }
}

#[cfg(test)]
#[path = "writer_batch_tests.rs"]
mod tests;

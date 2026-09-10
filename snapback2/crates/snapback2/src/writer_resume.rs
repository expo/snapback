//! Bounded reconnect as one serialized owner action.
// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — resume
// authenticates and re-authorizes the log plus mounted queries without
// reopening subscriptions.

use super::writer_auth::ResolvedAuthority;
use super::*;
use serde::Deserialize;
use snapback2_core::certificate::resumable_log_cursor;
use snapback2_core::{CursorPosition, encode_cursor};

const MAX_MOUNTED: usize = 32;
const MAX_RESUME_BYTES: usize = 1_048_576;
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResumeRequest {
    protocol: u8,
    generation: String,
    schema_hash: String,
    auth_epoch: u64,
    /// The drained range, once. A client that has drained nothing sends no log.
    #[serde(default)]
    log: Option<ResumeLog>,
    mounted: Vec<ResumeMounted>,
    /// The client's count of unused pinned ids; absent means it holds none.
    #[serde(default)]
    remaining: Option<Json>,
    /// The selected mutation; request.generation binds its certified demand.
    #[serde(default)]
    demand: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResumeLog {
    op: String,
    args: Json,
    watermark: Option<String>,
    #[serde(default)]
    validator: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResumeMounted {
    op: String,
    args: Json,
    validator: String,
}

pub(super) fn drain_metadata(
    program: &snapback2_core::Program,
    certificate: &snapback2_core::Certificate,
) -> Json {
    match resumable_log_cursor(program, certificate) {
        Ok(cursor) => json!({ "cursor": cursor }),
        Err(shape) => json!({ "reason": shape }),
    }
}

fn unsupported_log(op: &str, shape: &str) -> Refusal {
    Refusal::new("E_OFFLINE_RESUME", "offline",
        format!("operation {op} cannot drain/resume a log ({shape}); every returned page must ascend after the same cursor with at most 50 rows"),
        "use an ascending delivery log (after c first N, N <= 50); subscribe normally at c: null for newest-first data; queued writes are kept",
        "offline")
        .with_site("/api/resume.log").with_detail("which", json!("log"))
        .with_detail("reason", json!("unsupported-log")).with_detail("shape", json!(shape))
        .with_detail("op", json!(op))
}

impl State {
    pub(super) fn admit_drain(&self, op: &str) -> Result<(), Refusal> {
        let (program, certificate) = self
            .runtime()
            .generation()
            .programs()
            .get(op)
            .ok_or_else(|| unknown_op(op))?;
        resumable_log_cursor(program, certificate)
            .map(|_| ())
            .map_err(|shape| unsupported_log(op, shape))
    }

    pub(super) fn resume(&mut self, body: Json, identity: Identity) -> Result<Json, Refusal> {
        let request: ResumeRequest = serde_json::from_value(body).map_err(|error| {
            Refusal::input(
                format!("invalid resume request: {error}"),
                "send protocol, generation, schemaHash, authEpoch, log, and mounted",
            )
        })?;
        if request.protocol != snapback2_core::DELIVERY_PROTOCOL_V1 {
            return Err(Refusal::input(
                format!("unsupported offline protocol {}", request.protocol),
                "send protocol: 1",
            ));
        }
        let authority = self.resolve_authority(identity)?;
        if request.auth_epoch != authority.auth_epoch() {
            return Err(
                Refusal::from_identity(&snapback2_core::IdentityError::Session)
                    .with_site("/api/resume.authEpoch"),
            );
        }
        let current_generation = self.runtime().generation().program_hash().to_owned();
        let current_schema_hash = self.runtime().generation().schema().hash();
        if request.generation != current_generation || request.schema_hash != current_schema_hash {
            return Err(Refusal::offline(
                "E_OFFLINE_RESET",
                "the held program generation or schema no longer matches the owner",
            )
            .with_detail("generation", json!(current_generation))
            .with_detail("schemaHash", json!(current_schema_hash)));
        }
        if request.mounted.len() > MAX_MOUNTED {
            return Err(Refusal::offline(
                "E_OFFLINE_RESUME",
                format!(
                    "resume mounted {} queries, above the cap of {MAX_MOUNTED}",
                    request.mounted.len()
                ),
            )
            .with_detail("reason", json!("limit"))
            .with_detail("which", json!("mounted"))
            .with_detail("cap", json!(MAX_MOUNTED)));
        }
        let log_args = match &request.log {
            Some(held) => {
                Some(self.log_page(&held.op, held.args.clone(), held.watermark.as_deref())?)
            }
            None => None,
        };

        // @ref LLP 1018.008.000#capacity-acquisition — capacity follows the
        // selected generation's existing allocation formula, not client arithmetic.
        let demand = match request.demand.as_deref() {
            None => 0,
            Some(op) => {
                let (program, certificate) = self.runtime().generation().programs().get(op)
                    .ok_or_else(|| unknown_op(op))?;
                if program.kind != ProgramKind::Mutation {
                    return Err(Refusal::input("capacity demand must name a mutation", "select a mutation from /api/program"));
                }
                let count = certificate.write_sites.iter().filter(|site| matches!(site.kind,
                    snapback2_core::certificate::WriteKind::Insert | snapback2_core::certificate::WriteKind::Upsert))
                    .fold(1u64, |count, site| count.saturating_add(site.max_rows));
                if count > u64::from(snapback2_core::REPLAY_GRANT_COUNT) {
                    return Err(Refusal::offline("E_OFFLINE_ID_BLOCK",
                        format!("{op} needs {count} pinned IDs, above one {}-ID replay grant", snapback2_core::REPLAY_GRANT_COUNT))
                        .with_site("/api/resume.demand"));
                }
                count
            }
        };
        let grant = self.grant_if_low(authority.principal.id.as_str(), request.remaining.as_ref(), demand)?;
        let log = match (&request.log, log_args) {
            (Some(held), Some(args)) => self.resume_log(held, args, &authority)?,
            _ => Json::Null,
        };
        let mut mounted = Vec::new();
        let mut more = None;
        let log_alone = resume_response(
            self,
            &authority,
            &current_generation,
            &current_schema_hash,
            &log,
            &mounted,
            grant.as_ref(),
            None,
        )?;
        // The log page is measured against the same budget as the mounted
        // answers; when it alone exceeds it, every mounted query waits.
        if byte_length(&log_alone)? > MAX_RESUME_BYTES {
            more = Some(request.mounted.len());
        } else {
            for (index, held) in request.mounted.iter().enumerate() {
                let delivery = self.resume_mounted(held, &authority)?;
                let mut candidate = resume_response(
                    self,
                    &authority,
                    &current_generation,
                    &current_schema_hash,
                    &log,
                    &mounted,
                    grant.as_ref(),
                    None,
                )?;
                candidate["mounted"]
                    .as_array_mut()
                    .expect("resume mounted array")
                    .push(delivery.clone());
                if byte_length(&candidate)? > MAX_RESUME_BYTES {
                    more = Some(request.mounted.len() - index);
                    break;
                }
                mounted.push(delivery);
            }
        }
        resume_response(
            self,
            &authority,
            &current_generation,
            &current_schema_hash,
            &log,
            &mounted,
            grant.as_ref(),
            more,
        )
    }

    fn resume_log(
        &mut self,
        held: &ResumeLog,
        args: Json,
        authority: &ResolvedAuthority,
    ) -> Result<Json, Refusal> {
        let context = self.context(authority, &held.op, args)?;
        let execution = self.execute_resume_query(&held.op, context.clone())?;
        let full = writer_offline::envelope_json(
            self.runtime().generation(),
            &held.op,
            &context,
            &execution,
        )?;
        let current_validator = full["validator"].as_str().unwrap_or_default();
        let empty_tail = matches!(&execution.result, Value::Array(values) if values.is_empty());
        if empty_tail && current_validator == held.validator {
            return Ok(json!({ "unchanged": true }));
        }
        let watermark = self
            .delivery_watermark(&held.op, &execution)?
            .or_else(|| held.watermark.clone());
        let mut response = full;
        response
            .as_object_mut()
            .expect("delivery envelope is an object")
            .insert(
                "watermark".to_owned(),
                watermark.map_or(Json::Null, Json::String),
            );
        Ok(response)
    }

    fn resume_mounted(
        &mut self,
        held: &ResumeMounted,
        authority: &ResolvedAuthority,
    ) -> Result<Json, Refusal> {
        let context = self.context(authority, &held.op, held.args.clone())?;
        let execution = self.execute_resume_query(&held.op, context.clone())?;
        let full = writer_offline::envelope_json(
            self.runtime().generation(),
            &held.op,
            &context,
            &execution,
        )?;
        if full["validator"].as_str() == Some(held.validator.as_str()) {
            Ok(json!({
                "op": held.op,
                "args": held.args,
                "unchanged": true,
                "validator": held.validator,
            }))
        } else {
            Ok(full)
        }
    }

    fn execute_resume_query(&mut self, op: &str, context: Context) -> Result<Execution, Refusal> {
        let kind = self
            .runtime()
            .generation()
            .programs()
            .get(op)
            .map(|entry| entry.0.kind)
            .ok_or_else(|| unknown_op(op))?;
        if kind != ProgramKind::Query {
            return Err(Refusal::new(
                "E_OP_KIND",
                "op",
                format!("resume operation {op} is not a query"),
                "send only query operations in log and mounted",
                "op/kind",
            ));
        }
        self.runtime_mut()
            .execute(op, context)
            .map_err(|error| Refusal::from_runtime(&error))
    }

    /// The log op must be the drained range: a certified ascending page of at
    /// most 50 rows with a cursor argument, which the watermark
    /// fills. Page size is certified, never requested, so the tail is
    /// `after watermark first ≤ 50` whatever the request's args say.
    // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — the
    // server runs the log's tail `after watermark first 50`.
    fn log_page(&self, op: &str, mut args: Json, watermark: Option<&str>) -> Result<Json, Refusal> {
        let (program, certificate) = self
            .runtime()
            .generation()
            .programs()
            .get(op)
            .ok_or_else(|| unknown_op(op))?;
        let cursor = resumable_log_cursor(program, certificate)
            .map_err(|shape| unsupported_log(op, shape))?;
        let object = args.as_object_mut().ok_or_else(|| {
            Refusal::input(
                "resume log args must be an object",
                "pass the query's named args",
            )
        })?;
        object.insert(
            cursor,
            watermark.map_or(Json::Null, |value| Json::String(value.to_owned())),
        );
        Ok(args)
    }

    fn delivery_watermark(
        &self,
        op: &str,
        execution: &Execution,
    ) -> Result<Option<String>, Refusal> {
        let certificate = &self
            .runtime()
            .generation()
            .programs()
            .get(op)
            .expect("resume operation was resolved")
            .1;
        let Some(page) = execution
            .trace
            .result_page_return
            .as_ref()
            .and_then(|path| certificate.result_pages.get(path))
        else {
            return Ok(None);
        };
        let values = if page.merge {
            execution
                .trace
                .merges
                .iter()
                .rev()
                .find(|entry| entry.site == page.site)
                .and_then(|entry| entry.last_returned_suffix.clone())
        } else {
            execution
                .trace
                .ranges
                .iter()
                .rev()
                .find(|range| range.site == page.site)
                .and_then(|range| range.returned_ids.last())
                .and_then(|id| {
                    execution
                        .trace
                        .rows
                        .iter()
                        .rev()
                        .find(|row| row.table == page.table && &row.id == id)
                })
                .and_then(|row| {
                    page.suffix
                        .iter()
                        .map(|column| row.row.field(&column.name).cloned().ok())
                        .collect::<Option<Vec<_>>>()
                })
        };
        let Some(values) = values else {
            return Ok(None);
        };
        encode_cursor(
            self.runtime().generation().schema(),
            &CursorPosition {
                table: page.table.clone(),
                index: page.index.clone(),
                order: page.order,
                suffix: page.suffix.clone(),
                values,
            },
        )
        .map(Some)
        .map_err(|error| Refusal::input(error.to_string(), "resume with the last server watermark"))
    }
}

fn unknown_op(op: &str) -> Refusal {
    Refusal::new(
        "E_OP_UNKNOWN",
        "op",
        format!("unknown operation {op}"),
        "use a query listed by /api/manifest",
        "op/manifest",
    )
}

#[allow(clippy::too_many_arguments)]
fn resume_response(
    state: &State,
    authority: &ResolvedAuthority,
    generation: &str,
    schema_hash: &str,
    log: &Json,
    mounted: &[Json],
    grant: Option<&snapback2_core::ReplayGrant>,
    more: Option<usize>,
) -> Result<Json, Refusal> {
    let seq = state
        .runtime()
        .store()
        .commit_seq()
        .map_err(|error| Refusal::from_runtime(&error))?;
    let mut response = json!({
        "seq": seq,
        "generation": generation,
        "schemaHash": schema_hash,
        "authority": {
            "principal": authority.principal.id,
            "authEpoch": authority.auth_epoch(),
        },
        "log": log,
        "mounted": mounted,
    });
    let object = response
        .as_object_mut()
        .expect("resume response is an object");
    if let Some(grant) = grant {
        object.insert("grant".to_owned(), json!(grant));
    }
    if let Some(more) = more {
        object.insert("more".to_owned(), json!(more));
    }
    Ok(response)
}

fn byte_length(value: &Json) -> Result<usize, Refusal> {
    serde_json::to_vec(value)
        .map(|bytes| bytes.len())
        .map_err(|error| {
            Refusal::from_runtime(&snapback2_core::RuntimeError::Serialization(
                error.to_string(),
            ))
        })
}

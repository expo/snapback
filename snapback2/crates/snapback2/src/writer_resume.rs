//! Bounded reconnect as one serialized owner action.
// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — resume
// authenticates and re-authorizes the log plus mounted queries without
// reopening subscriptions.

use super::*;
use super::writer_auth::ResolvedAuthority;
use serde::Deserialize;
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
    log: ResumeLog,
    mounted: Vec<ResumeMounted>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResumeLog {
    op: String,
    args: Json,
    watermark: Option<String>,
    validator: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ResumeMounted {
    op: String,
    args: Json,
    validator: String,
}

impl State {
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
            .with_detail("which", json!("mounted"))
            .with_detail("cap", json!(MAX_MOUNTED)));
        }

        // The request has no client-grant cursor. Treat reconnect as the low
        // watermark and mint a disjoint principal-bound grant every time.
        let grant = self.mint_replay_grant(authority.principal.id.as_str())?;
        let (log, _) = self.resume_log(&request.log, &authority)?;
        let mut mounted = Vec::new();
        let mut more = None;
        for (index, held) in request.mounted.iter().enumerate() {
            let delivery = self.resume_mounted(held, &authority)?;
            let mut candidate = resume_response(
                self,
                &authority,
                &current_generation,
                &current_schema_hash,
                &log,
                &mounted,
                &grant,
                None,
            )?;
            candidate["mounted"]
                .as_array_mut()
                .expect("resume mounted array")
                .push(delivery.clone());
            if serde_json::to_vec(&candidate)
                .map_err(serialization_refusal)?
                .len()
                > MAX_RESUME_BYTES
            {
                more = Some(request.mounted.len() - index);
                break;
            }
            mounted.push(delivery);
        }
        resume_response(
            self,
            &authority,
            &current_generation,
            &current_schema_hash,
            &log,
            &mounted,
            &grant,
            more,
        )
    }

    fn resume_log(
        &mut self,
        held: &ResumeLog,
        authority: &ResolvedAuthority,
    ) -> Result<(Json, Execution), Refusal> {
        let args = self.log_args(&held.op, held.args.clone(), held.watermark.as_deref())?;
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
        let response = if empty_tail && current_validator == held.validator {
            json!({ "unchanged": true })
        } else {
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
            response
        };
        Ok((response, execution))
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
            .ok_or_else(|| {
                Refusal::new(
                    "E_OP_UNKNOWN",
                    "op",
                    format!("unknown operation {op}"),
                    "use a query listed by /api/manifest",
                    "op/manifest",
                )
            })?;
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

    fn log_args(
        &self,
        op: &str,
        mut args: Json,
        watermark: Option<&str>,
    ) -> Result<Json, Refusal> {
        let program = &self
            .runtime()
            .generation()
            .programs()
            .get(op)
            .ok_or_else(|| {
                Refusal::new(
                    "E_OP_UNKNOWN",
                    "op",
                    format!("unknown operation {op}"),
                    "use a query listed by /api/manifest",
                    "op/manifest",
                )
            })?
            .0;
        let cursor = program.args.iter().find_map(|(name, kind)| {
            (matches!(kind, ArgType::Cursor)
                || matches!(kind, ArgType::Optional(boxed) if matches!(boxed.as_ref(), ArgType::Cursor)))
            .then(|| name.clone())
        });
        let Some(cursor) = cursor else {
            if watermark.is_none() {
                return Ok(args);
            }
            return Err(Refusal::input(
                format!("resume log operation {op} has no cursor argument"),
                "use the drained delivery-log query as the resume log",
            ));
        };
        let object = args.as_object_mut().ok_or_else(|| {
            Refusal::input("resume log args must be an object", "pass the query's named args")
        })?;
        object.insert(
            cursor,
            watermark.map_or(Json::Null, |value| Json::String(value.to_owned())),
        );
        Ok(args)
    }

    fn delivery_watermark(&self, op: &str, execution: &Execution) -> Result<Option<String>, Refusal> {
        let certificate = &self
            .runtime()
            .generation()
            .programs()
            .get(op)
            .expect("resume operation was resolved")
            .1;
        let Some(page) = &certificate.result_page_site else {
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
        encode_cursor(&CursorPosition {
            table: page.table.clone(),
            index: page.index.clone(),
            order: page.order,
            suffix: page.suffix.clone(),
            values,
        })
        .map(Some)
        .map_err(|error| Refusal::input(error.to_string(), "resume with the last server watermark"))
    }
}

fn resume_response(
    state: &State,
    authority: &ResolvedAuthority,
    generation: &str,
    schema_hash: &str,
    log: &Json,
    mounted: &[Json],
    grant: &snapback2_core::ReplayGrant,
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
        "grant": grant,
    });
    if let Some(more) = more {
        response
            .as_object_mut()
            .expect("resume response is an object")
            .insert("more".to_owned(), json!(more));
    }
    Ok(response)
}

fn serialization_refusal(error: serde_json::Error) -> Refusal {
    Refusal::from_runtime(&snapback2_core::RuntimeError::Serialization(error.to_string()))
}

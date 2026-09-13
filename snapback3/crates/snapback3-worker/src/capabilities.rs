//! Private worker adapters for runtime capabilities whose bytes, transports,
//! provider calls, and scheduling remain owned by Node.
// @ref LLP 2000#13-first-implementation-choices — the Rust child owns bounded certified state transitions; Node owns raw I/O.

use crate::protocol::{Fault, Owner};
use serde::Deserialize;
use serde_json::{Value as Json, json};
use snapback3_core::{
    Actor, ArgType, AssetKind, AssetReadyFacts, AssetState, ChannelSide, ColumnType,
    ExecutionState, OperatorId, Program, ProgramKind, RuntimeError, value_to_wire_json,
};
use std::collections::{BTreeMap, BTreeSet};

const RESULT_BYTES: usize = 16 * 1024;
const SAFE_U64: u64 = 9_007_199_254_740_991;
const ASSET_RECLAIM_LIMIT: usize = 32;
const EFFECT_CLEANUP_LIMIT: usize = 64;

pub(crate) fn handles(method: &str) -> bool {
    matches!(
        method,
        "asset.begin"
            | "asset.reserve"
            | "asset.finalize"
            | "asset.status"
            | "asset.discard"
            | "asset.reclaim"
            | "asset.reclaim.finish"
            | "asset.delivery"
            | "asset.delivery.public"
            | "asset.open"
            | "background.turn"
            | "operator.run"
            | "job.enqueue"
            | "job.recover"
            | "job.plan"
            | "job.status"
            | "job.resume"
            | "job.cancel"
            | "effect.recover"
            | "effect.requeue"
            | "effect.list"
            | "effect.claim"
            | "effect.settle"
            | "presence.replace"
            | "channel.admit"
    )
}

pub(crate) fn call(owner: &mut Owner, method: &str, params: &Json, at: i64) -> Result<Json, Fault> {
    match method {
        "asset.begin" => asset_begin(owner, params, at),
        "asset.reserve" => asset_reserve(owner, params, at),
        "asset.finalize" => asset_finalize(owner, params, at),
        "asset.status" => asset_status(owner, params, at),
        "asset.discard" => asset_discard(owner, params, at),
        "asset.reclaim" => asset_reclaim(owner, params, at),
        "asset.reclaim.finish" => asset_reclaim_finish(owner, params),
        "asset.delivery" => asset_delivery(owner, params, at, false),
        "asset.delivery.public" => asset_delivery_public(owner, params),
        "asset.open" => asset_delivery(owner, params, at, true),
        "background.turn" => background_turn(owner, params, at),
        "operator.run" => operator_run(owner, params, at),
        "job.enqueue" => job_enqueue(owner, params, at),
        "job.recover" => job_recover(owner, params),
        "job.plan" => job_plan(owner, params),
        "job.status" => job_status(owner, params),
        "job.resume" => job_control(owner, params, at, true),
        "job.cancel" => job_control(owner, params, at, false),
        "effect.recover" => effect_recover(owner, params),
        "effect.requeue" => effect_requeue(owner, params),
        "effect.list" => effect_list(owner, params),
        "effect.claim" => effect_claim(owner, params, at),
        "effect.settle" => effect_settle(owner, params, at),
        "presence.replace" => presence_replace(owner, params),
        "channel.admit" => channel_admit(owner, params, at),
        _ => unreachable!("capability method dispatch is exhaustive"),
    }
}

fn decode<T: for<'de> Deserialize<'de>>(params: &Json) -> Result<T, Fault> {
    serde_json::from_value(params.clone()).map_err(Fault::input)
}

fn actor(owner: &Owner, token: &str, at: i64) -> Result<Actor, Fault> {
    let authority = owner
        .runtime
        .authenticate(token, at)
        .map_err(|error| Fault::new("S3_AUTH", error))?;
    Actor::try_from(&authority.principal).map_err(Fault::input)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AssetBegin {
    token: String,
    kind: AssetKind,
    bytes: u64,
}

fn asset_begin(owner: &mut Owner, params: &Json, at: i64) -> Result<Json, Fault> {
    let request: AssetBegin = decode(params)?;
    let actor = actor(owner, &request.token, at)?;
    let max = asset_max(owner, request.kind);
    if max == 0 {
        return Err(Fault::new(
            "S3_ASSET_TYPE",
            format!(
                "the active generation declares no {} asset bound",
                request.kind
            ),
        ));
    }
    if request.bytes == 0 || request.bytes > max {
        return Err(Fault::new(
            "S3_ASSET_TOO_LARGE",
            format!("{} upload bytes must be between 1 and {max}", request.kind),
        ));
    }
    let id = owner
        .runtime
        .begin_asset_charged(request.kind, &actor, at, request.bytes)
        .map_err(asset_mutation_fault)?;
    Ok(json!({"id":id,"maxBytes":max}))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AssetReserve {
    token: String,
    id: String,
    bytes: u64,
}

// @ref LLP 1006#9a-where-bytes-live-author-ruling-2026-09-03 — finalized
// growth is admitted durably before Node publishes the immutable blob.
// @ref LLP 2000#integration-choices — this private owner command accepts no
// media facts and is never an arbitrary public worker-forwarding surface.
fn asset_reserve(owner: &mut Owner, params: &Json, at: i64) -> Result<Json, Fault> {
    let request: AssetReserve = decode(params)?;
    let actor = actor(owner, &request.token, at)?;
    let row = own_asset(owner, actor.id(), &request.id)?
        .filter(|row| row.locator.is_none())
        .ok_or_else(asset_unavailable)?;
    let max = asset_max(owner, row.kind);
    if max == 0 || request.bytes == 0 || request.bytes > max {
        return Err(Fault::new(
            "S3_ASSET_TOO_LARGE",
            format!(
                "finalized {} bytes must be between 1 and the active generation bound {max}",
                row.kind
            ),
        ));
    }
    if row.reclaiming || row.state == AssetState::Failed {
        return Err(asset_unavailable());
    }
    if row.state == AssetState::Ready {
        return if row.bytes == Some(request.bytes) {
            Ok(json!({"id":request.id,"bytes":request.bytes}))
        } else {
            Err(Fault::new(
                "S3_ASSET_FINALIZED",
                "asset is already ready with a different finalized byte count",
            ))
        };
    }
    owner
        .runtime
        .reserve_asset_finalized_bytes(&request.id, request.bytes)
        .map_err(asset_mutation_fault)?;
    Ok(json!({"id":request.id,"bytes":request.bytes}))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AssetFinalize {
    token: String,
    id: String,
    facts: FinalFacts,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct FinalFacts {
    #[serde(rename = "type")]
    media_type: String,
    bytes: u64,
    width: i64,
    height: i64,
    duration: Option<i64>,
}

fn asset_finalize(owner: &mut Owner, params: &Json, at: i64) -> Result<Json, Fault> {
    let request: AssetFinalize = decode(params)?;
    let actor = actor(owner, &request.token, at)?;
    let facts = AssetReadyFacts {
        media_type: request.facts.media_type,
        bytes: request.facts.bytes,
        width: request.facts.width,
        height: request.facts.height,
        duration: request.facts.duration,
    };
    let row = own_asset(owner, actor.id(), &request.id)?
        .ok_or_else(|| Fault::new("S3_ASSET_UNAVAILABLE", "asset is unavailable"))?;
    let max = asset_max(owner, row.kind);
    if facts.bytes == 0 || facts.bytes > max {
        return Err(Fault::new(
            "S3_ASSET_TOO_LARGE",
            format!("finalized asset bytes must be between 1 and {max}"),
        ));
    }
    if row.reclaiming {
        return Err(asset_unavailable());
    }
    if row.state == AssetState::Ready {
        let matches = row.media_type.as_deref() == Some(facts.media_type.as_str())
            && row.bytes == Some(facts.bytes)
            && row.width == Some(facts.width)
            && row.height == Some(facts.height)
            && row.duration == facts.duration;
        return if matches {
            Ok(asset_record(&request.id, &facts))
        } else {
            Err(Fault::new(
                "S3_ASSET_FINALIZED",
                "asset is already ready with different facts",
            ))
        };
    }
    owner
        .runtime
        .reserve_asset_finalized_bytes(&request.id, facts.bytes)
        .map_err(asset_mutation_fault)?;
    owner
        .runtime
        .mark_asset_ready(&request.id, &facts)
        .map_err(asset_mutation_fault)?;
    Ok(asset_record(&request.id, &facts))
}

fn asset_record(id: &str, facts: &AssetReadyFacts) -> Json {
    let mut value = json!({"id":id,"width":facts.width,"height":facts.height});
    if let Some(duration) = facts.duration {
        value["duration"] = json!(duration);
    }
    value
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AssetId {
    token: String,
    id: String,
}

fn asset_status(owner: &mut Owner, params: &Json, at: i64) -> Result<Json, Fault> {
    let request: AssetId = decode(params)?;
    let actor = actor(owner, &request.token, at)?;
    let Some(row) = own_asset(owner, actor.id(), &request.id)? else {
        return Ok(Json::Null);
    };
    if row.locator.is_some() || row.reclaiming {
        return Ok(Json::Null);
    }
    Ok(json!({
        "id":row.id,"kind":row.kind,"state":row.state,"bytes":row.bytes.unwrap_or(row.staged_bytes),
        "createdAt":row.created_at,"releasedAt":row.released_at
    }))
}

fn asset_discard(owner: &mut Owner, params: &Json, at: i64) -> Result<Json, Fault> {
    let request: AssetId = decode(params)?;
    let actor = actor(owner, &request.token, at)?;
    let Some(row) = own_asset(owner, actor.id(), &request.id)? else {
        return Ok(json!({"discarded":false}));
    };
    if row.reclaiming {
        return Ok(json!({"discarded":false}));
    }
    let discarded = owner
        .runtime
        .discard_upload(&actor, &request.id)
        .map_err(Fault::runtime)?;
    Ok(json!({"discarded":discarded}))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct AssetReclaim {
    #[serde(default)]
    after: String,
    #[serde(default = "default_asset_reclaim_limit")]
    limit: usize,
}

fn default_asset_reclaim_limit() -> usize {
    ASSET_RECLAIM_LIMIT
}

fn asset_reclaim(owner: &mut Owner, params: &Json, at: i64) -> Result<Json, Fault> {
    let request: AssetReclaim = decode(params)?;
    if request.limit == 0 || request.limit > ASSET_RECLAIM_LIMIT {
        return Err(Fault::input("asset reclaim limit must be between 1 and 32"));
    }
    let page = owner
        .runtime
        .reclaim_assets_page(at, &request.after, request.limit)
        .map_err(Fault::runtime)?;
    Ok(json!({"ids":page.ids,"next":page.continuation}))
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct AssetReclaimFinish {
    ids: Vec<String>,
}

fn asset_reclaim_finish(owner: &mut Owner, params: &Json) -> Result<Json, Fault> {
    let request: AssetReclaimFinish = decode(params)?;
    if request.ids.len() > ASSET_RECLAIM_LIMIT {
        return Err(Fault::input(
            "at most 32 asset reclaims may finish per turn",
        ));
    }
    let ids = request.ids.into_iter().collect::<BTreeSet<_>>();
    let mut finished = 0_u64;
    for id in &ids {
        if owner
            .runtime
            .store()
            .asset(id)
            .map_err(Fault::runtime)?
            .is_some_and(|row| row.reclaiming && row.locator.is_none())
        {
            finished += 1;
        }
    }
    owner
        .runtime
        .finish_asset_reclaims(&ids.into_iter().collect::<Vec<_>>())
        .map_err(Fault::runtime)?;
    Ok(json!({"finished":finished}))
}

fn asset_delivery(owner: &mut Owner, params: &Json, at: i64, open: bool) -> Result<Json, Fault> {
    let request: AssetId = decode(params)?;
    let authority = owner.authority(params, at)?;
    let context = Owner::context(&authority, at, false)?;
    let delivery = owner
        .runtime
        .asset_delivery(&request.id, context)
        .map_err(asset_delivery_fault)?;
    if delivery.once
        && owner
            .runtime
            .store()
            .asset_viewed(&request.id, authority.principal.id.as_str())
            .map_err(Fault::runtime)?
    {
        return Err(asset_viewed());
    }
    if open && delivery.once {
        // Calls to the private worker are serialized. Reauthorization and this
        // durable consume therefore form one owner turn before Node writes bytes.
        // @ref LLP 1006#2a1-one-use-image-delivery-clique-f3-2026-09-05 — a once open is consumed fail-closed before the response body begins.
        // @ref LLP 2000#13-first-implementation-choices — S3's Node/Rust split puts the consuming authority transition before Node streams raw bytes.
        owner
            .runtime
            .record_asset_view(&request.id, authority.principal.id.as_str(), at)
            .map_err(asset_delivery_fault)?;
    }
    let mut value = serde_json::to_value(delivery).map_err(Fault::internal)?;
    if open {
        value["seq"] = json!(owner.runtime.store().commit_seq().map_err(Fault::runtime)?);
    }
    Ok(value)
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PublicAssetId {
    id: String,
}

// @ref LLP 1006#2-authority-delivery-is-by-the-row-that-holds-it — anonymous
// delivery is certified from public(reason), never from a manufactured viewer.
fn asset_delivery_public(owner: &mut Owner, params: &Json) -> Result<Json, Fault> {
    let request: PublicAssetId = decode(params)?;
    let delivery = owner
        .runtime
        .public_asset_delivery(&request.id)
        .map_err(asset_delivery_fault)?;
    debug_assert!(delivery.public && !delivery.once);
    serde_json::to_value(delivery).map_err(Fault::internal)
}

fn asset_unavailable() -> Fault {
    Fault::new("S3_ASSET_UNAVAILABLE", "asset is unavailable")
}

fn asset_viewed() -> Fault {
    Fault::new("S3_ASSET_VIEWED", "asset was already viewed")
}

fn asset_delivery_fault(error: RuntimeError) -> Fault {
    match error {
        RuntimeError::AssetNotReady(_) => asset_unavailable(),
        RuntimeError::AssetViewed(_) => asset_viewed(),
        error => Fault::runtime(error),
    }
}

fn asset_mutation_fault(error: RuntimeError) -> Fault {
    match error {
        RuntimeError::AssetTooLarge(message) => Fault::new("S3_ASSET_TOO_LARGE", message),
        RuntimeError::AssetType(message) => Fault::new("S3_ASSET_TYPE", message),
        RuntimeError::AssetNotReady(_) => asset_unavailable(),
        error => Fault::runtime(error),
    }
}

fn own_asset(
    owner: &Owner,
    principal: &str,
    id: &str,
) -> Result<Option<snapback3_core::AssetLedgerRow>, Fault> {
    Ok(owner
        .runtime
        .store()
        .asset(id)
        .map_err(Fault::runtime)?
        .filter(|row| row.created_by == principal))
}

fn asset_max(owner: &Owner, wanted: AssetKind) -> u64 {
    let mut max = 0_u64;
    for kind in owner
        .runtime
        .generation()
        .schema()
        .tables
        .values()
        .flat_map(|table| table.columns.values())
    {
        column_asset_max(kind, wanted, &mut max);
    }
    for kind in owner
        .runtime
        .generation()
        .programs()
        .values()
        .flat_map(|(program, _)| program.args.values())
    {
        arg_asset_max(kind, wanted, &mut max);
    }
    max
}

fn column_asset_max(kind: &ColumnType, wanted: AssetKind, max: &mut u64) {
    match kind {
        ColumnType::Image { max: bound, .. } if wanted == AssetKind::Image => {
            *max = (*max).max(u64::from(*bound))
        }
        ColumnType::Video { max: bound } if wanted == AssetKind::Video => {
            *max = (*max).max(u64::from(*bound))
        }
        ColumnType::Optional(inner) | ColumnType::List { of: inner, .. } => {
            column_asset_max(inner, wanted, max)
        }
        _ => {}
    }
}

fn arg_asset_max(kind: &ArgType, wanted: AssetKind, max: &mut u64) {
    match kind {
        ArgType::Image { max: bound, .. } if wanted == AssetKind::Image => {
            *max = (*max).max(u64::from(*bound))
        }
        ArgType::Video { max: bound } if wanted == AssetKind::Video => {
            *max = (*max).max(u64::from(*bound))
        }
        ArgType::Optional(inner) => arg_asset_max(inner, wanted, max),
        ArgType::List {
            of: Some(inner), ..
        } => arg_asset_max(inner, wanted, max),
        _ => {}
    }
}

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Empty {}

fn background_turn(owner: &mut Owner, params: &Json, at: i64) -> Result<Json, Fault> {
    let _: Empty = decode(params)?;
    // @ref LLP 1016#d3--the-driver — one bounded owner turn drains timers before advancing one FIFO job chunk.
    let timers = owner.runtime.fire_due_at(64, at).map_err(Fault::runtime)?;
    let timer_values = timers
        .iter()
        .map(|outcome| json!({"firing":outcome.firing,"seq":outcome.seq}))
        .collect::<Vec<_>>();
    let timers_remain = !owner
        .runtime
        .store()
        .due_timers(at, 1)
        .map_err(Fault::runtime)?
        .is_empty();
    let job = if timers_remain {
        Json::Null
    } else if let Some(id) = owner.runtime.store().job_head().map_err(Fault::runtime)? {
        serde_json::to_value(
            owner
                .runtime
                .run_chunk_at(&id, at)
                .map_err(Fault::runtime)?,
        )
        .map_err(Fault::internal)?
    } else {
        Json::Null
    };
    let seq = owner.runtime.store().commit_seq().map_err(Fault::runtime)?;
    let next_timer_at = owner
        .runtime
        .store()
        .next_timer_at()
        .map_err(Fault::runtime)?;
    Ok(json!({
        "at":at,"timers":timer_values,"job":job,"seq":seq,"nextTimerAt":next_timer_at,
        "clockQueries":clock_queries(owner)
    }))
}

pub(crate) fn clock_queries(owner: &Owner) -> Json {
    Json::Object(
        owner
            .runtime
            .generation()
            .programs()
            .iter()
            .filter_map(|(name, (program, _))| {
                (program.kind == ProgramKind::Query)
                    .then_some(program.read_time_granularity_ms)
                    .flatten()
                    .map(|milliseconds| (name.clone(), json!({"granularityMs":milliseconds})))
            })
            .collect(),
    )
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct NamedOperator {
    by: String,
    op: String,
    args: Json,
}

fn validate_operator(by: &str) -> Result<OperatorId, Fault> {
    if by.is_empty() || by.len() > 144 {
        return Err(Fault::input("operator identity must be 1 to 144 bytes"));
    }
    Ok(OperatorId(by.to_owned()))
}

fn named_program_args(
    owner: &Owner,
    name: &str,
    args: &Json,
) -> Result<BTreeMap<String, snapback3_core::Value>, Fault> {
    let (program, _) = owner
        .runtime
        .generation()
        .programs()
        .get(name)
        .ok_or_else(|| Fault::new("S3_OPERATION_UNKNOWN", format!("unknown operation {name}")))?;
    snapback3_core::wire::program_args(program, args).map_err(Fault::runtime)
}

fn operator_run(owner: &mut Owner, params: &Json, at: i64) -> Result<Json, Fault> {
    let request: NamedOperator = decode(params)?;
    let (program, _) = owner
        .runtime
        .generation()
        .programs()
        .get(&request.op)
        .ok_or_else(|| Fault::new("S3_OPERATION_UNKNOWN", "unknown operator operation"))?;
    if program.kind != ProgramKind::Mutation {
        return Err(Fault::new(
            "S3_OPERATION_KIND",
            "operator.run accepts named mutations; enqueue jobs with job.enqueue",
        ));
    }
    let args = named_program_args(owner, &request.op, &request.args)?;
    let execution = owner
        .runtime
        .execute_operator_at(&request.op, args, validate_operator(&request.by)?, at)
        .map_err(Fault::runtime)?;
    serde_json::to_value(execution).map_err(Fault::internal)
}

fn job_declaration<'a>(
    owner: &'a Owner,
    name: &str,
) -> Result<&'a (Program, snapback3_core::Certificate), Fault> {
    owner
        .runtime
        .generation()
        .programs()
        .get(name)
        .filter(|(program, _)| program.kind == ProgramKind::Job)
        .ok_or_else(|| Fault::new("S3_JOB_UNKNOWN", format!("unknown job {name}")))
}

fn job_enqueue(owner: &mut Owner, params: &Json, at: i64) -> Result<Json, Fault> {
    let request: NamedOperator = decode(params)?;
    job_declaration(owner, &request.op)?;
    let args = named_program_args(owner, &request.op, &request.args)
        .map_err(|error| Fault::new("S3_JOB_INPUT", error.message))?;
    let id = owner
        .runtime
        .enqueue_job_at(&request.op, args, validate_operator(&request.by)?, at)
        .map_err(|error| {
            Fault::new(
                "S3_WORKER_JOB_SUBMISSION_UNCERTAIN",
                format!(
                    "the submitted job request failed without a confirmed ID: {error}. Do not enqueue it again until job recover shows whether durable custody exists"
                ),
            )
        })?;
    // `enqueue_job_at` returns only after its SQLite transaction commits. A
    // later projection/read failure must preserve that known durable identity
    // instead of looking like a definite pre-commit refusal.
    let row = owner.runtime.job_record(&id).map_err(|error| {
        Fault::new(
            "S3_WORKER_JOB_COMMITTED_RESPONSE",
            format!(
                "job {id} committed, but its response record could not be read: {error}. Do not enqueue it again; run job recover to inspect durable IDs"
            ),
        )
    })?;
    serde_json::to_value(row).map_err(|error| {
        Fault::new(
            "S3_WORKER_JOB_COMMITTED_RESPONSE",
            format!(
                "job {id} committed, but its response could not be encoded: {error}. Do not enqueue it again; run job recover to inspect durable IDs"
            ),
        )
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JobRecovery {
    by: String,
    after: Option<String>,
    #[serde(default = "default_job_recovery_limit")]
    limit: usize,
}

fn default_job_recovery_limit() -> usize {
    32
}

fn job_recover(owner: &mut Owner, params: &Json) -> Result<Json, Fault> {
    let request: JobRecovery = decode(params)?;
    validate_operator(&request.by)?;
    if request.limit == 0 || request.limit > 64 {
        return Err(Fault::input("job recovery limit must be between 1 and 64"));
    }
    let mut rows = owner
        .runtime
        .store()
        .jobs_for_operator(
            &request.by,
            request.after.as_deref(),
            request.limit.saturating_add(1),
        )
        .map_err(job_fault)?;
    let more = rows.len() > request.limit;
    rows.truncate(request.limit);
    let next = more
        .then(|| rows.last().map(|row| row.id.clone()))
        .flatten();
    let jobs = rows
        .into_iter()
        .map(|row| {
            json!({
                "id":row.id,"name":row.name,"state":row.state,
                "createdAt":row.created_at,"updatedAt":row.updated_at,
                "finishedAt":row.finished_at
            })
        })
        .collect::<Vec<_>>();
    Ok(json!({"jobs":jobs,"next":next,"limit":request.limit}))
}

fn job_plan(owner: &mut Owner, params: &Json) -> Result<Json, Fault> {
    let request: NamedOperator = decode(params)?;
    validate_operator(&request.by)?;
    let (program, certificate) = job_declaration(owner, &request.op)?.clone();
    let args =
        snapback3_core::wire::program_args(&program, &request.args).map_err(Fault::runtime)?;
    owner
        .runtime
        .plan_job(&program, &certificate, &args)
        .map_err(Fault::runtime)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct JobId {
    by: String,
    id: String,
}

fn job_status(owner: &mut Owner, params: &Json) -> Result<Json, Fault> {
    let request: JobId = decode(params)?;
    validate_operator(&request.by)?;
    let row = owner.runtime.job_record(&request.id).map_err(job_fault)?;
    let summary = owner
        .runtime
        .store()
        .job_commit_summary(&request.id)
        .map_err(Fault::runtime)?;
    Ok(json!({"job":row,"summary":summary}))
}

fn job_control(owner: &mut Owner, params: &Json, at: i64, resume: bool) -> Result<Json, Fault> {
    let request: JobId = decode(params)?;
    let by = validate_operator(&request.by)?;
    let row = if resume {
        owner.runtime.resume_job_at(&request.id, by, at)
    } else {
        owner.runtime.cancel_job_at(&request.id, by, at)
    }
    .map_err(job_fault)?;
    serde_json::to_value(row).map_err(Fault::internal)
}

fn job_fault(error: RuntimeError) -> Fault {
    match &error {
        RuntimeError::Input(message) if message.starts_with("unknown job ") => {
            Fault::new("S3_JOB_UNKNOWN", message)
        }
        RuntimeError::OpUnknown(name) => {
            Fault::new("S3_JOB_UNKNOWN", format!("unknown job {name}"))
        }
        _ => Fault::runtime(error),
    }
}

fn effect_recover(owner: &mut Owner, params: &Json) -> Result<Json, Fault> {
    let _: Empty = decode(params)?;
    let recovered = owner
        .runtime
        .store()
        .outbox_mark_unknown_running()
        .map_err(Fault::runtime)?;
    Ok(json!({"recovered":recovered}))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EffectId {
    id: String,
}

fn effect_requeue(owner: &mut Owner, params: &Json) -> Result<Json, Fault> {
    let request: EffectId = decode(params)?;
    let requeued = owner
        .runtime
        .store()
        .outbox_requeue(&request.id)
        .map_err(Fault::runtime)?;
    Ok(json!({"requeued":requeued}))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EffectList {
    state: String,
    #[serde(default)]
    after: String,
    #[serde(default = "default_effect_list_limit")]
    limit: usize,
}

fn default_effect_list_limit() -> usize {
    32
}

fn effect_list(owner: &mut Owner, params: &Json) -> Result<Json, Fault> {
    let request: EffectList = decode(params)?;
    if request.limit == 0 || request.limit > EFFECT_CLEANUP_LIMIT {
        return Err(Fault::input("effect list limit must be between 1 and 64"));
    }
    let page = owner
        .runtime
        .store()
        .outbox_recovery_page(&request.state, &request.after, request.limit)
        .map_err(Fault::runtime)?;
    Ok(json!({"items":page.items,"next":page.continuation}))
}

fn effect_claim(owner: &mut Owner, params: &Json, at: i64) -> Result<Json, Fault> {
    let _: Empty = decode(params)?;
    let declarations = owner
        .runtime
        .generation()
        .effects()
        .keys()
        .cloned()
        .collect::<Vec<_>>();
    if let Some(pending) = owner
        .runtime
        .store()
        .outbox_then_pending(1)
        .map_err(Fault::runtime)?
        .pop()
    {
        let id = pending.id.clone();
        settle_then(owner, pending, at)?;
        let row = owner
            .runtime
            .store()
            .outbox_get(&id)
            .map_err(Fault::runtime)?
            .expect("then settlement retains its row");
        let more = owner
            .runtime
            .store()
            .outbox_has_immediate_work(at, &declarations)
            .map_err(Fault::runtime)?;
        let seq = owner.runtime.store().commit_seq().map_err(Fault::runtime)?;
        return Ok(json!({
            "failed":[],"claim":null,"recoveredThen":outbox_json(&row),"seq":seq,"more":more
        }));
    }
    let claimed = owner.runtime.claim_effect(at).map_err(Fault::runtime)?;
    let failed = claimed.failed.iter().map(outbox_json).collect::<Vec<_>>();
    let claim = claimed
        .claimed
        .as_ref()
        .map(|row| {
            let declaration = owner.runtime.generation().effects().get(&row.effect);
            json!({"row":outbox_json(row),"declaration":declaration})
        })
        .unwrap_or(Json::Null);
    Ok(json!({"failed":failed,"claim":claim,"recoveredThen":null,"more":claimed.more}))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct EffectSettlement {
    id: String,
    state: String,
    result: Option<Json>,
    error: Option<String>,
    next_at: Option<i64>,
}

fn effect_settle(owner: &mut Owner, params: &Json, at: i64) -> Result<Json, Fault> {
    let request: EffectSettlement = decode(params)?;
    if !matches!(request.state.as_str(), "sent" | "queued" | "failed") {
        return Err(Fault::input("effect state must be sent, queued, or failed"));
    }
    if request
        .result
        .as_ref()
        .is_some_and(|result| result.to_string().len() > RESULT_BYTES)
    {
        return Err(Fault::input("effect result exceeds 16 KiB"));
    }
    let Some(row) = owner
        .runtime
        .store()
        .outbox_get(&request.id)
        .map_err(Fault::runtime)?
    else {
        return Err(Fault::new("S3_EFFECT_NOT_FOUND", "unknown outbox row"));
    };
    // Retried private settlement after a lost reply observes the durable result.
    if !matches!(row.state.as_str(), "running" | "then_pending") {
        return effect_result(owner, &request.id);
    }
    if row.state == "then_pending" {
        settle_then(owner, row, at)?;
        return effect_result(owner, &request.id);
    }
    if request.state != "sent" || row.then_op.is_none() {
        owner
            .runtime
            .store()
            .outbox_settle(
                &request.id,
                &request.state,
                request.result.as_ref(),
                request.error.as_deref(),
                request.next_at,
            )
            .map_err(Fault::runtime)?;
        return effect_result(owner, &request.id);
    }
    owner
        .runtime
        .store()
        .outbox_settle(
            &request.id,
            "then_pending",
            request.result.as_ref(),
            None,
            None,
        )
        .map_err(Fault::runtime)?;
    let pending = owner
        .runtime
        .store()
        .outbox_get(&request.id)
        .map_err(Fault::runtime)?
        .expect("settled row remains present");
    settle_then(owner, pending, at)?;
    effect_result(owner, &request.id)
}

fn settle_then(owner: &mut Owner, row: snapback3_core::OutboxRow, at: i64) -> Result<(), Fault> {
    let execution = owner
        .runtime
        .settle_effect_then(&row.id, at)
        .map_err(Fault::runtime)?;
    if let ExecutionState::Rejected { code, message, .. } = execution.state {
        return Err(Fault::new(&code, message));
    }
    Ok(())
}

fn effect_result(owner: &Owner, id: &str) -> Result<Json, Fault> {
    let row = owner
        .runtime
        .store()
        .outbox_get(id)
        .map_err(Fault::runtime)?
        .ok_or_else(|| Fault::new("S3_EFFECT_NOT_FOUND", "unknown outbox row"))?;
    let seq = owner.runtime.store().commit_seq().map_err(Fault::runtime)?;
    Ok(json!({"row":outbox_json(&row),"seq":seq}))
}

fn outbox_json(row: &snapback3_core::OutboxRow) -> Json {
    json!({
        "id":row.id,"seq":row.seq,"effect":row.effect,"payload":value_to_wire_json(&row.payload),
        "state":row.state,"attempts":row.attempts,"nextAt":row.next_at,
        "lastError":row.last_error,"result":row.result,"then":row.then_op,
        "thenSeq":row.then_seq,"generation":row.generation,"createdAt":row.created_at,"updatedAt":row.updated_at
    })
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct PresenceReplace {
    counts: BTreeMap<String, u64>,
}

fn presence_replace(owner: &mut Owner, params: &Json) -> Result<Json, Fault> {
    let request: PresenceReplace = decode(params)?;
    if request.counts.len() > 100_000 {
        return Err(Fault::input("presence counts exceed 100,000 principals"));
    }
    for (principal, count) in &request.counts {
        Actor::user(principal).map_err(Fault::input)?;
        if *count == 0 || *count > SAFE_U64 {
            return Err(Fault::input(
                "presence counts must be positive JavaScript-safe integers",
            ));
        }
    }
    let keys = owner
        .connected_counts
        .keys()
        .chain(request.counts.keys())
        .cloned()
        .collect::<BTreeSet<_>>();
    let changed = keys
        .into_iter()
        .filter(|principal| owner.connected_counts.get(principal) != request.counts.get(principal))
        .collect::<Vec<_>>();
    owner.runtime.set_connected(request.counts.clone());
    owner.connected_counts = request.counts;
    let seq = owner.runtime.store().commit_seq().map_err(Fault::runtime)?;
    Ok(json!({"changed":changed,"seq":seq}))
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ChannelAdmission {
    token: String,
    name: String,
    side: ChannelSide,
    args: Json,
    value: Option<Json>,
}

fn channel_admit(owner: &mut Owner, params: &Json, at: i64) -> Result<Json, Fault> {
    let request: ChannelAdmission = decode(params)?;
    let authority = owner.authority(params, at)?;
    let channel = owner
        .runtime
        .generation()
        .schema()
        .channels
        .get(&request.name)
        .ok_or_else(|| Fault::new("S3_CHANNEL_UNKNOWN", "unknown channel"))?;
    let args_program = Program {
        name: format!("__channel.{}", request.name),
        kind: ProgramKind::Query,
        args: channel.args.clone(),
        read_time_granularity_ms: None,
        body: Vec::new(),
    };
    let value_types = channel.value.clone();
    let args =
        snapback3_core::wire::program_args(&args_program, &request.args).map_err(Fault::runtime)?;
    let value = request
        .value
        .as_ref()
        .map(|value| {
            if request.side != ChannelSide::Publish {
                return Err(Fault::input("only channel publish admission accepts value"));
            }
            let value_program = Program {
                name: format!("__channel_value.{}", request.name),
                kind: ProgramKind::Query,
                args: value_types,
                read_time_granularity_ms: None,
                body: Vec::new(),
            };
            let typed = snapback3_core::wire::program_args(&value_program, value)
                .map_err(Fault::runtime)?;
            let typed = owner
                .runtime
                .channel_value(&request.name, typed)
                .map_err(Fault::runtime)?;
            Ok::<_, Fault>(Json::Object(
                typed
                    .iter()
                    .map(|(name, value)| (name.clone(), value_to_wire_json(value)))
                    .collect(),
            ))
        })
        .transpose()?;
    let context = Owner::context(&authority, at, false)?;
    let verdict = owner
        .runtime
        .channel_admit(&request.name, request.side, &args, &context)
        .map_err(Fault::runtime)?;
    let args = args
        .iter()
        .map(|(name, value)| (name.clone(), value_to_wire_json(value)))
        .collect::<serde_json::Map<_, _>>();
    let _ = request.token;
    Ok(json!({"args":args,"value":value,"verdict":verdict}))
}

#[cfg(test)]
#[path = "capabilities_tests.rs"]
mod tests;

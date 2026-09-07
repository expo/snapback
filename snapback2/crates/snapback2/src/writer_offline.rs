//! Offline envelope and certified-program custody on the owner thread.
// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — projection and validator comparison happen after authoritative execution on the sole owner.

use super::*;
use snapback2_core::{DeliveryProjectionContext, DeliveryProjectionError, project_delivery};

#[derive(Clone, Debug, Default)]
pub(crate) struct OfflineOptions {
    pub(crate) receipt: bool,
    pub(crate) drain: bool,
    pub(crate) validator: Option<String>,
}

pub(super) fn envelope_json(
    generation: &Generation,
    op: &str,
    context: &Context,
    execution: &Execution,
) -> Result<Json, Refusal> {
    let (_, certificate) = generation
        .programs()
        .get(op)
        .expect("execution operation belongs to active generation");
    let program_generation = generation.program_hash();
    let schema_hash = generation.schema().hash();
    let mut envelope = project_delivery(
        execution,
        &DeliveryProjectionContext {
            op,
            args: &context.args,
            generation: program_generation,
            schema_hash: &schema_hash,
            plan_hash: &certificate.plan_hash,
            principal: context.viewer(),
            auth_epoch: context.auth_epoch,
        },
    )
    .map_err(projection_refusal)?;
    envelope.connected = certificate
        .read_sites
        .iter()
        .any(|site| site.table == snapback2_core::CONNECTED_TABLE)
        .then_some(true);
    // @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — a program whose
    // certificate reads the clock re-executes at one durable seq with a different answer;
    // the execution read time pinned on this context lets the client order those deliveries.
    if certificate.read_time_granularity_ms.is_some() {
        envelope.read_time = context.read_time;
    }
    Ok(serde_json::to_value(envelope).expect("delivery envelope is serializable"))
}

pub(super) fn envelope_frame(
    generation: &Generation,
    op: &str,
    context: &Context,
    execution: &Execution,
) -> (Json, bool) {
    let (legacy, terminal) = live_frame(Ok(execution), execution.seq);
    if terminal {
        return (legacy, terminal);
    }
    match envelope_json(generation, op, context, execution) {
        Ok(envelope) => (envelope, false),
        Err(refusal) => refusal_frame(refusal, execution.seq),
    }
}

pub(super) fn connected_frame(
    generation: &Generation,
    op: &str,
    execution: &Execution,
) -> (Json, bool) {
    let (mut frame, terminal) = live_frame(Ok(execution), execution.seq);
    if !terminal
        && generation.programs()[op]
            .1
            .read_sites
            .iter()
            .any(|site| site.table == snapback2_core::CONNECTED_TABLE)
    {
        frame["connected"] = Json::Bool(true);
    }
    (frame, terminal)
}

pub(super) fn conditional_frame(full: &Json, validator: Option<&str>) -> Json {
    let current = full
        .get("validator")
        .and_then(Json::as_str)
        .expect("delivery envelope has validator");
    if full.get("connected") != Some(&Json::Bool(true)) && validator == Some(current) {
        json!({
            "state": "unchanged",
            "seq": full.get("seq").cloned().unwrap_or(Json::from(0)),
            "validator": current,
        })
    } else {
        full.clone()
    }
}

pub(super) fn program(generation: &Generation, requested: &str) -> Result<Json, Refusal> {
    if requested.is_empty() {
        return Err(Refusal::new(
            "E_INPUT",
            "input",
            "GET /api/program requires the generation query parameter",
            "read programGeneration from /api/manifest and pass ?generation=<programGeneration>",
            "input/runtime",
        ));
    }
    let current = generation.program_hash();
    if requested != current {
        return Err(Refusal::new(
            "E_OP_UNKNOWN",
            "op",
            format!("certified program generation {requested} is not active"),
            "read programGeneration from /api/manifest and request that generation",
            "op/manifest",
        ));
    }
    let programs = generation
        .programs()
        .iter()
        .filter(|(name, (p, _))| !name.starts_with("__owner.") && p.kind != ProgramKind::Job)
        .map(|(name, (program, certificate))| {
            (
                name.clone(),
                json!({
                    "kind": match program.kind {
                        ProgramKind::Query => "query",
                        ProgramKind::Job => "job", ProgramKind::Mutation => "mutation",
                    },
                    "planHash": certificate.plan_hash,
                    "ir": program,
                    "certificate": certificate,
                    "drain": writer_resume::drain_metadata(program, certificate),
                }),
            )
        })
        .collect::<serde_json::Map<_, _>>();
    Ok(json!({
        "generation": current,
        "schemaHash": generation.schema().hash(),
        "schema": generation.schema(),
        "programs": programs,
    }))
}

fn projection_refusal(error: DeliveryProjectionError) -> Refusal {
    match error {
        DeliveryProjectionError::NonQueryState => Refusal::new(
            "E_OP_KIND",
            "op",
            "a subscription query produced a mutation state",
            "subscribe only to query operations",
            "op/kind",
        ),
        DeliveryProjectionError::MissingPooledRow { .. } => Refusal::new(
            "E_TRACE_SUBSET",
            "bound",
            error.to_string(),
            "inspect the query receipt and result row provenance",
            "bound/runtime",
        ),
    }
}

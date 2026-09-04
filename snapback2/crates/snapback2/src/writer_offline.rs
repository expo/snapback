//! Offline envelope and certified-program custody on the owner thread.
// @ref LLP 1012#8-the-delivery-envelope-the-validator-and-resume — projection and validator comparison happen after authoritative execution on the sole owner.

use super::*;
use snapback2_core::{DeliveryProjectionContext, project_delivery};

#[derive(Clone, Debug, Default)]
pub(crate) struct OfflineOptions {
    pub(crate) receipt: bool,
    pub(crate) validator: Option<String>,
}

pub(super) fn envelope_json(
    generation: &Generation,
    op: &str,
    context: &Context,
    execution: &Execution,
) -> Json {
    let (_, certificate) = generation
        .programs()
        .get(op)
        .expect("execution operation belongs to active generation");
    let program_generation = generation.program_hash();
    let schema_hash = generation.schema().hash();
    serde_json::to_value(project_delivery(
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
    ))
    .expect("delivery envelope is serializable")
}

pub(super) fn conditional_frame(full: &Json, validator: Option<&str>) -> Json {
    let current = full
        .get("validator")
        .and_then(Json::as_str)
        .expect("delivery envelope has validator");
    if validator == Some(current) {
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
        .filter(|(name, _)| !name.starts_with("__owner."))
        .map(|(name, (program, certificate))| {
            (
                name.clone(),
                json!({
                    "kind": match program.kind {
                        ProgramKind::Query => "query",
                        ProgramKind::Mutation => "mutation",
                    },
                    "planHash": certificate.plan_hash,
                    "ir": program,
                    "certificate": certificate,
                }),
            )
        })
        .collect::<serde_json::Map<_, _>>();
    Ok(json!({
        "generation": current,
        "schemaHash": generation.schema().hash(),
        "programs": programs,
    }))
}

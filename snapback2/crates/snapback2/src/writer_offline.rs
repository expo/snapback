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
    let (program, certificate) = generation
        .programs()
        .get(op)
        .expect("execution operation belongs to active generation");
    let program_generation = generation.program_hash();
    let schema_hash = generation.schema().hash();
    let mut envelope = project_delivery(
        execution,
        &DeliveryProjectionContext {
            schema: generation.schema(),
            read_time: context
                .query_read_time(program, certificate)
                .map_err(|e| Refusal::from_runtime(&e))?,
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
                    "cursor": snapback2_core::certificate::result_cursor(program, certificate),
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
        DeliveryProjectionError::InvalidReadTime => Refusal::new(
            "E_INPUT",
            "input",
            error.to_string(),
            "pin the query readTime to signed safe-integer milliseconds",
            "input/runtime",
        ),
        DeliveryProjectionError::NonQueryState => Refusal::new(
            "E_OP_KIND",
            "op",
            "a subscription query produced a mutation state",
            "subscribe only to query operations",
            "op/kind",
        ),
        DeliveryProjectionError::MissingPooledRow { .. } | DeliveryProjectionError::InvalidPool => {
            Refusal::new(
                "E_TRACE_SUBSET",
                "bound",
                error.to_string(),
                "inspect the query receipt and result row provenance",
                "bound/runtime",
            )
        }
    }
}

#[cfg(test)]
mod clock_tests {
    use super::*;
    use snapback2_core::{ArgType, Ceilings, Engine, Expr, Input, ProjectJson, Schema, Stmt};

    #[test]
    fn pinned_clock_binds_full_query_states_and_preserves_untimed_validators() {
        let timed = snapback2_core::Program {
            name: "clock".into(),
            kind: ProgramKind::Query,
            args: BTreeMap::from([("read".into(), ArgType::Bool)]),
            read_time_granularity_ms: Some(1000),
            body: vec![Stmt::If {
                condition: Expr::Variable("read".into()),
                then_body: vec![Stmt::Return(Expr::Input(Input::ReadTime))],
                else_body: vec![Stmt::Return(Expr::Literal(Value::Int(7)))],
            }],
        };
        let mut untimed = timed.clone();
        untimed.name = "untimed".into();
        untimed.read_time_granularity_ms = None;
        untimed.body = vec![Stmt::Return(Expr::Literal(Value::Int(7)))];
        let generation = Generation::certify(
            &ProjectJson {
                version: 1,
                schema: Schema::default(),
                programs: vec![timed.clone(), untimed.clone()],
                effects: vec![],
                auth: Default::default(),
            },
            Ceilings::default(),
        )
        .unwrap();
        let mut engine = Engine::memory(Schema::default()).unwrap();
        let mut context = Context::query(
            snapback2_core::Actor::user("alice").unwrap(),
            BTreeMap::from([("read".into(), Value::Bool(false))]),
        );
        let mut previous: Option<Json> = None;
        let mut clockless: Option<Json> = None;
        for clock in [-1, 0, 1, 999, snapback2_core::I53_MAX] {
            context.read_time = Some(clock);
            let execution = engine
                .execute(&timed, &generation.programs()["clock"].1, context.clone())
                .unwrap();
            let full = envelope_json(&generation, "clock", &context, &execution).unwrap();
            assert_eq!(full["readTime"], clock);
            assert_eq!(full["data"], 7, "an unvisited timed branch still stamps");
            if let Some(old) = previous.as_ref() {
                assert_ne!(&full["validator"], old);
                assert_eq!(conditional_frame(&full, old.as_str()), full);
            }
            previous = Some(full["validator"].clone());
            for state in [
                ExecutionState::Complete,
                ExecutionState::Capped,
                ExecutionState::Partial {
                    reason: "coverage".into(),
                },
                ExecutionState::Denied {
                    rule: "membership".into(),
                },
            ] {
                let mut typed = execution.clone();
                typed.state = state;
                let (frame, terminal) = envelope_frame(&generation, "clock", &context, &typed);
                assert!(!terminal);
                assert_eq!(frame["readTime"], clock);
            }
            let execution = engine
                .execute(
                    &untimed,
                    &generation.programs()["untimed"].1,
                    context.clone(),
                )
                .unwrap();
            let full = envelope_json(&generation, "untimed", &context, &execution).unwrap();
            assert!(full.get("readTime").is_none());
            if let Some(old) = clockless.as_ref() {
                assert_eq!(&full["validator"], old);
            }
            clockless = Some(full["validator"].clone());
            assert_eq!(
                conditional_frame(&full, full["validator"].as_str())["state"],
                "unchanged"
            );
        }
        context.read_time = None;
        let execution = engine
            .execute(
                &untimed,
                &generation.programs()["untimed"].1,
                context.clone(),
            )
            .unwrap();
        assert!(envelope_json(&generation, "clock", &context, &execution).is_err());
        let full = envelope_json(&generation, "untimed", &context, &execution).unwrap();
        for invalid in [
            Json::Null,
            json!(1.5),
            json!("1"),
            json!(snapback2_core::I53_MAX + 1),
            json!(snapback2_core::I53_MIN - 1),
        ] {
            let mut forged = full.clone();
            forged["readTime"] = invalid;
            assert!(serde_json::from_value::<snapback2_core::DeliveryEnvelopeV1>(forged).is_err());
        }
    }
}

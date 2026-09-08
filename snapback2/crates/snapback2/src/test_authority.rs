//! Served-loop authorization proofs for projects that declare scoped membership.
// @ref LLP 1002#7-test-and-the-receipt — revocation and successor fences are named receipt proofs.

use super::test_authority_ir::{
    prepare_policy_successor, program_has_membership_guard_dependency, projected_policy_data,
};
use super::test_sse::SseProbe;
use super::{elapsed_ms, generated_args};
use crate::client;
use crate::owner::OwnerInfo;
use crate::project::{CompiledProject, SeedData};
use crate::receipt::CheckReceipt;
use serde_json::{Value as Json, json};
use snapback2_core::{
    ArgType, Ceilings, ColumnType, Expr, Generation, Program, ProgramKind, ProjectJson, ReadSite,
    RuleExpr, RuleTerm, Schema, Stmt, Value, WriteKind, WriteSite,
};
use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, Instant};

const LIVE_REVOCATION: &str = "live-revocation";
const SUCCESSOR_POLICY_FENCE: &str = "successor-policy-fence";
const GRANT_INCARNATION_ABA: &str = "grant-incarnation-aba";
const SUCCESSOR_DENIAL_PREFIX: &str = "SNAPBACK2_TEST_SUCCESSOR_POLICY_FENCE:";

#[derive(Clone, Debug)]
struct Recipe {
    membership_table: String,
    membership_index: String,
    scope_field: String,
    principal_field: String,
    scope_table: Option<String>,
    protected: Vec<ProtectedTable>,
}

#[derive(Clone, Debug)]
struct ProtectedTable {
    table: String,
    scope_field: String,
}

#[derive(Clone, Debug)]
struct QueryPlan {
    query: String,
    query_args: Json,
    persona: String,
    principal: String,
    membership_id: String,
    scope: Json,
    protected_table: String,
}

#[derive(Clone, Debug)]
struct RevokePlan {
    mutation: String,
    mutation_args: Json,
}

#[derive(Clone, Debug)]
struct ProtectedWritePlan {
    mutation: String,
    mutation_args: Json,
    persona: String,
    principal: String,
}

#[derive(Clone, Debug)]
struct AbaPlan {
    promote_mutation: String,
    promote_args: Json,
    remove_mutation: String,
    remove_args: Json,
    add_mutation: String,
    replacement_args: Json,
    successor_probe_args: Json,
    admin_persona: String,
    admin_principal: String,
    member_persona: String,
    member_principal: String,
    probe_principal: String,
    membership_id: String,
    scope: Json,
}

#[derive(Clone, Debug)]
struct PlanBlock {
    reason: String,
    candidates: Vec<String>,
}

pub(super) fn checks(
    owner: &OwnerInfo,
    compiled: &CompiledProject,
    seed: &SeedData,
) -> Vec<CheckReceipt> {
    let Some(recipe) = membership_recipe(compiled.generation.schema()) else {
        return Vec::new();
    };
    let query_plan = query_plan(compiled, seed, &recipe);
    vec![
        live_revocation(owner, compiled, seed, &recipe, query_plan.clone()),
        successor_policy_fence(owner, compiled, &recipe, query_plan.clone()),
        grant_incarnation_aba(owner, compiled, seed, &recipe, query_plan),
    ]
}

fn live_revocation(
    owner: &OwnerInfo,
    compiled: &CompiledProject,
    seed: &SeedData,
    recipe: &Recipe,
    query_plan: Result<QueryPlan, PlanBlock>,
) -> CheckReceipt {
    let started = Instant::now();
    let plan = match query_plan {
        Ok(plan) => plan,
        Err(reason) => return blocked(LIVE_REVOCATION, started, recipe, reason),
    };
    let revoke = match revoke_plan(compiled, seed, recipe, &plan) {
        Ok(revoke) => revoke,
        Err(reason) => return blocked(LIVE_REVOCATION, started, recipe, reason),
    };
    let protected_write = match protected_write_plan(compiled, seed, recipe, &plan) {
        Ok(write) => write,
        Err(reason) => return blocked(LIVE_REVOCATION, started, recipe, reason),
    };
    match live_revocation_attempt(
        owner,
        compiled.generation.schema(),
        recipe,
        &plan,
        &revoke,
        &protected_write,
    ) {
        Ok(detail) => CheckReceipt::pass(LIVE_REVOCATION, "derived", elapsed_ms(started), detail),
        Err(error) => CheckReceipt::fail(
            LIVE_REVOCATION,
            "derived",
            elapsed_ms(started),
            json!({
                "error": error,
                "query": plan.query,
                "mutation": revoke.mutation,
                "protectedWrite": protected_write.mutation,
                "as": plan.persona,
                "membership": { "table": recipe.membership_table, "id": plan.membership_id },
                "transport": "served SSE + mutation API",
            }),
        ),
    }
}

fn live_revocation_attempt(
    owner: &OwnerInfo,
    schema: &Schema,
    recipe: &Recipe,
    plan: &QueryPlan,
    revoke: &RevokePlan,
    protected_write: &ProtectedWritePlan,
) -> Result<Json, String> {
    reset(owner)?;
    let attempt = (|| {
        let mut stream =
            SseProbe::connect(owner, &plan.query, plan.query_args.clone(), &plan.persona)
                .map_err(|error| format!("subscription was refused: {error:?}"))?;
        let initial = stream
            .event(Duration::from_secs(2))
            .map_err(|error| format!("initial delivery missing: {error}"))?;
        require_visible_complete(&initial)?;

        let response = client::api(
            owner,
            "POST",
            "/api/mutation",
            &[("X-Snapback-As", plan.persona.as_str())],
            json!({ "op": revoke.mutation, "args": revoke.mutation_args }),
        )
        .map_err(|error| format!("mutation request failed: {error:?}"))?;
        if response.status != 200 || response.body["state"] != "committed" {
            return Err(format!(
                "named revocation did not commit (HTTP {}): {}",
                response.status, response.body
            ));
        }
        let mutation_seq = response.body["seq"]
            .as_u64()
            .ok_or_else(|| format!("committed revocation omitted seq: {}", response.body))?;
        let delivery = stream
            .event(Duration::from_secs(2))
            .map_err(|error| format!("post-revocation delivery missing: {error}"))?;
        if delivery["state"] != "denied" {
            return Err(format!(
                "post-revocation delivery was not denied: {delivery}"
            ));
        }
        if delivery["seq"].as_u64() != Some(mutation_seq) {
            return Err(format!(
                "denial seq differed from mutation seq {mutation_seq}: {delivery}"
            ));
        }
        require_no_rows(&delivery)?;

        let protected_response = client::api(
            owner,
            "POST",
            "/api/mutation",
            &[("X-Snapback-As", protected_write.persona.as_str())],
            json!({ "op": protected_write.mutation, "args": protected_write.mutation_args }),
        )
        .map_err(|error| format!("protected write request failed: {error:?}"))?;
        if protected_response.status != 200 || protected_response.body["state"] != "committed" {
            return Err(format!(
                "admitted protected write did not commit (HTTP {}): {}",
                protected_response.status, protected_response.body
            ));
        }
        let protected_write_seq = protected_response.body["seq"].as_u64().ok_or_else(|| {
            format!(
                "committed protected write omitted seq: {}",
                protected_response.body
            )
        })?;
        let trace = client::control(
            owner,
            "GET",
            &format!("/control/trace?seq={protected_write_seq}"),
            json!({}),
        )
        .map_err(|error| format!("protected write trace request failed: {error:?}"))?;
        if trace.status != 200 {
            return Err(format!(
                "protected write trace returned HTTP {}: {}",
                trace.status, trace.body
            ));
        }
        let protected_rows_written = trace.body["commit"]["writes"][plan.protected_table.as_str()]
            .as_u64()
            .unwrap_or(0);
        if protected_rows_written == 0 {
            return Err(format!(
                "{} committed without an actual {} row write: {}",
                protected_write.mutation, plan.protected_table, trace.body
            ));
        }
        let maintained_rows_written = schema
            .maintains
            .iter()
            .filter(|maintain| maintain.source == plan.protected_table)
            .map(|maintain| {
                let rows = trace.body["commit"]["writes"][maintain.target.as_str()]
                    .as_u64()
                    .unwrap_or(0);
                (maintain.target.clone(), rows)
            })
            .collect::<BTreeMap<_, _>>();
        if let Some((target, _)) = maintained_rows_written.iter().find(|(_, rows)| **rows == 0) {
            return Err(format!(
                "{} committed without an actual maintained {} row write: {}",
                protected_write.mutation, target, trace.body
            ));
        }
        stream
            .prove_silence(Duration::from_millis(250))
            .map_err(|error| match error.delivery {
                Some(delivery) => format!(
                    "revoked retained stream delivered after protected write at seq {protected_write_seq}: {delivery}"
                ),
                None => format!("post-write revoked SSE failed: {}", error.message),
            })?;
        Ok(json!({
            "query": plan.query,
            "mutation": revoke.mutation,
            "as": plan.persona,
            "principal": plan.principal,
            "membership": { "table": recipe.membership_table, "id": plan.membership_id },
            "scope": plan.scope,
            "initialState": initial["state"],
            "mutationSeq": mutation_seq,
            "deliveryState": delivery["state"],
            "deliverySeq": delivery["seq"],
            "postDenialRows": 0,
            "protectedWrite": protected_write.mutation,
            "protectedWriteAs": protected_write.persona,
            "protectedWritePrincipal": protected_write.principal,
            "protectedWriteSeq": protected_write_seq,
            "protectedTable": plan.protected_table,
            "protectedRowsWritten": protected_rows_written,
            "maintainedRowsWritten": maintained_rows_written,
            "postWriteDelivery": "none",
            "transport": "served SSE + mutation API",
        }))
    })();
    let cleanup = reset(owner);
    match (attempt, cleanup) {
        (Ok(detail), Ok(())) => Ok(detail),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(error)) => Err(format!("proof passed but seed reset failed: {error}")),
        (Err(error), Err(cleanup)) => Err(format!("{error}; seed reset also failed: {cleanup}")),
    }
}

fn successor_policy_fence(
    owner: &OwnerInfo,
    compiled: &CompiledProject,
    recipe: &Recipe,
    query_plan: Result<QueryPlan, PlanBlock>,
) -> CheckReceipt {
    let started = Instant::now();
    let plan = match query_plan {
        Ok(plan) => plan,
        Err(reason) => return blocked(SUCCESSOR_POLICY_FENCE, started, recipe, reason),
    };
    match successor_policy_attempt(owner, compiled, &plan) {
        Ok(detail) => CheckReceipt::pass(
            SUCCESSOR_POLICY_FENCE,
            "derived",
            elapsed_ms(started),
            detail,
        ),
        Err(error) => CheckReceipt::fail(
            SUCCESSOR_POLICY_FENCE,
            "derived",
            elapsed_ms(started),
            json!({
                "error": error,
                "query": plan.query,
                "as": plan.persona,
                "protectedTable": plan.protected_table,
                "generationG": compiled.generation.hash(),
                "transport": "served control apply + retained SSE + fresh query API",
            }),
        ),
    }
}

fn grant_incarnation_aba(
    owner: &OwnerInfo,
    compiled: &CompiledProject,
    seed: &SeedData,
    recipe: &Recipe,
    query_plan: Result<QueryPlan, PlanBlock>,
) -> CheckReceipt {
    let started = Instant::now();
    let query = match query_plan {
        Ok(plan) => plan,
        Err(reason) => return blocked(GRANT_INCARNATION_ABA, started, recipe, reason),
    };
    let plan = match aba_plan(compiled, seed, recipe, &query) {
        Ok(plan) => plan,
        Err(reason) => return blocked(GRANT_INCARNATION_ABA, started, recipe, reason),
    };
    match grant_incarnation_aba_attempt(owner, recipe, &plan) {
        Ok(detail) => CheckReceipt::pass(
            GRANT_INCARNATION_ABA,
            "derived",
            elapsed_ms(started),
            detail,
        ),
        Err(error) => CheckReceipt::fail(
            GRANT_INCARNATION_ABA,
            "derived",
            elapsed_ms(started),
            json!({
                "error": error,
                "promoteMutation": plan.promote_mutation,
                "removeMutation": plan.remove_mutation,
                "addMutation": plan.add_mutation,
                "as": plan.admin_persona,
                "memberAs": plan.member_persona,
                "membership": { "table": recipe.membership_table, "id": plan.membership_id },
                "scope": plan.scope,
                "transport": "served mutation API",
            }),
        ),
    }
}

fn aba_plan(
    compiled: &CompiledProject,
    seed: &SeedData,
    recipe: &Recipe,
    query: &QueryPlan,
) -> Result<AbaPlan, PlanBlock> {
    let mut reasons = BTreeSet::new();
    let Some(rows) = seed.rows.get(&recipe.membership_table) else {
        return Err(aba_block([format!(
            "seed has no {} rows whose identity can be captured",
            recipe.membership_table
        )]));
    };
    let Some(captured) = rows
        .iter()
        .find(|row| row.get("id").and_then(Json::as_str) == Some(&query.membership_id))
    else {
        return Err(aba_block([format!(
            "captured membership {} is absent from the seed",
            query.membership_id
        )]));
    };
    if captured.get("role").and_then(Json::as_str) != Some("member") {
        reasons.insert(format!(
            "captured membership {} is not a member-role grant",
            query.membership_id
        ));
    }

    let candidates = membership_candidates(seed, recipe);
    let admin = candidates.iter().find(|(persona, principal, id, scope)| {
        principal != &query.principal
            && scope == &query.scope
            && rows.iter().any(|row| {
                row.get("id").and_then(Json::as_str) == Some(id)
                    && row.get("role").and_then(Json::as_str) == Some("admin")
                    && row.get(&recipe.principal_field).and_then(Json::as_str) == Some(principal)
                    && seed.personas.iter().any(|seeded| seeded == persona)
            })
    });
    let Some((admin_persona, admin_principal, _, _)) = admin else {
        reasons.insert(format!(
            "scope {} has no second seeded admin persona for remove/recreate",
            query.scope
        ));
        return Err(aba_block(reasons));
    };

    let occupied = rows
        .iter()
        .filter(|row| row.get(&recipe.scope_field) == Some(&query.scope))
        .filter_map(|row| row.get(&recipe.principal_field).and_then(Json::as_str))
        .collect::<BTreeSet<_>>();
    let mut personas = seed.personas.clone();
    personas.sort();
    let probe_principal = personas
        .into_iter()
        .map(|persona| format!("dev:{persona}"))
        .find(|principal| !occupied.contains(principal.as_str()));
    let Some(probe_principal) = probe_principal else {
        reasons.insert(format!(
            "scope {} has no seeded persona absent from the membership set for the successor-role probe",
            query.scope
        ));
        return Err(aba_block(reasons));
    };

    let promote = aba_program(
        compiled,
        recipe,
        ".memberPromote",
        WriteKind::Update,
        true,
        false,
    );
    let remove = aba_program(
        compiled,
        recipe,
        ".memberRemove",
        WriteKind::Delete,
        true,
        false,
    );
    let add = aba_program(
        compiled,
        recipe,
        ".memberAdd",
        WriteKind::Insert,
        false,
        true,
    );
    for result in [&promote, &remove, &add] {
        if let Err(reason) = result {
            reasons.insert(reason.clone());
        }
    }
    let (promote_mutation, promote_program) = promote.map_err(|_| aba_block(reasons.clone()))?;
    let (remove_mutation, remove_program) = remove.map_err(|_| aba_block(reasons.clone()))?;
    let (add_mutation, add_program) = add.map_err(|_| aba_block(reasons.clone()))?;

    let promote_args = scoped_args(
        promote_program,
        seed,
        recipe,
        &query.scope,
        &query.membership_id,
        admin_principal,
    )
    .map_err(|reason| aba_block([format!("{promote_mutation}: {reason}")]))?;
    let remove_args = scoped_args(
        remove_program,
        seed,
        recipe,
        &query.scope,
        &query.membership_id,
        admin_principal,
    )
    .map_err(|reason| aba_block([format!("{remove_mutation}: {reason}")]))?;
    let replacement_args = scoped_args(
        add_program,
        seed,
        recipe,
        &query.scope,
        &query.membership_id,
        &query.principal,
    )
    .map_err(|reason| aba_block([format!("{add_mutation}: {reason}")]))?;
    let successor_probe_args = scoped_args(
        add_program,
        seed,
        recipe,
        &query.scope,
        &query.membership_id,
        &probe_principal,
    )
    .map_err(|reason| aba_block([format!("{add_mutation}: {reason}")]))?;

    Ok(AbaPlan {
        promote_mutation,
        promote_args,
        remove_mutation,
        remove_args,
        add_mutation,
        replacement_args,
        successor_probe_args,
        admin_persona: admin_persona.clone(),
        admin_principal: admin_principal.clone(),
        member_persona: query.persona.clone(),
        member_principal: query.principal.clone(),
        probe_principal,
        membership_id: query.membership_id.clone(),
        scope: query.scope.clone(),
    })
}

fn aba_program<'a>(
    compiled: &'a CompiledProject,
    recipe: &Recipe,
    suffix: &str,
    write_kind: WriteKind,
    needs_membership_ref: bool,
    needs_principal: bool,
) -> Result<(String, &'a Program), String> {
    compiled
        .generation
        .programs()
        .iter()
        .find(|(name, (program, certificate))| {
            name.ends_with(suffix)
                && program.kind == ProgramKind::Mutation
                && certificate.write_sites.iter().any(|site| {
                    site.table == recipe.membership_table && site.kind == write_kind
                })
                && (!needs_membership_ref
                    || program.args.iter().any(|(name, kind)| {
                        name == "membershipId"
                            && ref_table(kind) == Some(recipe.membership_table.as_str())
                    }))
                && (!needs_principal
                    || program
                        .args
                        .iter()
                        .any(|(_, kind)| matches!(unwrap_optional(kind), ArgType::Principal)))
                && program.args.iter().any(|(name, kind)| {
                    name == &recipe.scope_field
                        || recipe
                            .scope_table
                            .as_deref()
                            .is_some_and(|table| ref_table(kind) == Some(table))
                })
        })
        .map(|(name, (program, _))| (name.clone(), program))
        .ok_or_else(|| {
            format!(
                "no served {suffix} mutation carries the exact membership incarnation and scope needed for the ABA proof"
            )
        })
}

fn aba_block(reasons: impl IntoIterator<Item = String>) -> PlanBlock {
    PlanBlock {
        reason: "no durable captured-intent carrier binds a membership row identity to a served remove/recreate/replay path"
            .to_owned(),
        candidates: reasons.into_iter().collect(),
    }
}

fn grant_incarnation_aba_attempt(
    owner: &OwnerInfo,
    recipe: &Recipe,
    plan: &AbaPlan,
) -> Result<Json, String> {
    reset(owner)?;
    let attempt = (|| {
        let captured_promote_args = plan.promote_args.clone();
        let removed = served_mutation(
            owner,
            &plan.admin_persona,
            &plan.remove_mutation,
            plan.remove_args.clone(),
        )?;
        require_mutation_state(&removed, "committed", "captured membership removal")?;

        let replacement = served_mutation(
            owner,
            &plan.admin_persona,
            &plan.add_mutation,
            plan.replacement_args.clone(),
        )?;
        require_mutation_state(&replacement, "committed", "successor membership creation")?;
        let replacement_id = replacement["data"]["id"]
            .as_str()
            .ok_or_else(|| format!("successor membership omitted its row id: {replacement}"))?;
        if replacement_id == plan.membership_id {
            return Err(format!(
                "remove/recreate reused captured membership id {}",
                plan.membership_id
            ));
        }

        let stale_replay = served_mutation(
            owner,
            &plan.admin_persona,
            &plan.promote_mutation,
            captured_promote_args,
        )?;
        require_mutation_state(&stale_replay, "rejected", "stale promote replay")?;

        let successor_probe = served_mutation(
            owner,
            &plan.member_persona,
            &plan.add_mutation,
            plan.successor_probe_args.clone(),
        )?;
        require_mutation_state(
            &successor_probe,
            "rejected",
            "successor member authority probe",
        )?;
        let successor_code = successor_probe["code"].as_str().unwrap_or_default();
        if !successor_code.contains("ADMIN_REQUIRED") {
            return Err(format!(
                "successor probe did not reject specifically because the replacement remained a member: {successor_probe}"
            ));
        }

        Ok(json!({
            "promoteMutation": plan.promote_mutation,
            "removeMutation": plan.remove_mutation,
            "addMutation": plan.add_mutation,
            "as": plan.admin_persona,
            "principal": plan.admin_principal,
            "memberAs": plan.member_persona,
            "memberPrincipal": plan.member_principal,
            "membership": { "table": recipe.membership_table, "capturedId": plan.membership_id },
            "scope": plan.scope,
            "replacementId": replacement_id,
            "idReused": false,
            "staleReplayState": stale_replay["state"],
            "staleReplayCode": stale_replay["code"],
            "successorProbePrincipal": plan.probe_principal,
            "successorAuthorityState": successor_probe["state"],
            "successorAuthorityCode": successor_probe["code"],
            "successorRole": "member",
            "transport": "served mutation API",
        }))
    })();
    let cleanup = reset(owner);
    match (attempt, cleanup) {
        (Ok(detail), Ok(())) => Ok(detail),
        (Err(error), Ok(())) => Err(error),
        (Ok(_), Err(error)) => Err(format!("proof passed but seed reset failed: {error}")),
        (Err(error), Err(cleanup)) => Err(format!("{error}; seed reset also failed: {cleanup}")),
    }
}

fn served_mutation(
    owner: &OwnerInfo,
    persona: &str,
    operation: &str,
    args: Json,
) -> Result<Json, String> {
    let response = client::api(
        owner,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", persona)],
        json!({ "op": operation, "args": args }),
    )
    .map_err(|error| format!("{operation} request failed: {error:?}"))?;
    if response.status != 200 {
        return Err(format!(
            "{operation} returned HTTP {}: {}",
            response.status, response.body
        ));
    }
    Ok(response.body)
}

fn require_mutation_state(response: &Json, state: &str, subject: &str) -> Result<(), String> {
    if response["state"].as_str() == Some(state) {
        Ok(())
    } else {
        Err(format!("{subject} was not {state}: {response}"))
    }
}

fn successor_policy_attempt(
    owner: &OwnerInfo,
    compiled: &CompiledProject,
    plan: &QueryPlan,
) -> Result<Json, String> {
    reset(owner)?;
    let prepared_policy = prepare_policy_successor(&compiled.project, &plan.protected_table)?;
    let mut program_successor = compiled.project.clone();
    let program_denial = format!("{SUCCESSOR_DENIAL_PREFIX}{}", compiled.generation.hash());
    program_successor
        .programs
        .iter_mut()
        .find(|program| program.name == plan.query)
        .ok_or_else(|| format!("query {} disappeared", plan.query))?
        .body
        .insert(
            0,
            Stmt::Require {
                condition: Expr::Literal(Value::Bool(false)),
                code: program_denial.clone(),
            },
        );

    let attempt = successor_attempt(
        owner,
        compiled,
        plan,
        &prepared_policy.project,
        &program_successor,
        &program_denial,
        prepared_policy.retired_held_search,
        prepared_policy.stale_held_search_refused,
    );
    let restore = restore_generation(owner, compiled);
    let reset = reset(owner);
    match (attempt, restore, reset) {
        (Ok(detail), Ok(()), Ok(())) => Ok(detail),
        (result, restored, reset) => {
            let mut failures = Vec::new();
            if let Err(error) = result {
                failures.push(error);
            }
            if let Err(error) = restored {
                failures.push(format!("generation G restore failed: {error}"));
            }
            if let Err(error) = reset {
                failures.push(format!("seed reset failed: {error}"));
            }
            Err(failures.join("; "))
        }
    }
}

fn successor_attempt(
    owner: &OwnerInfo,
    compiled: &CompiledProject,
    plan: &QueryPlan,
    policy_successor: &ProjectJson,
    program_successor: &ProjectJson,
    program_denial: &str,
    retired_held_search: usize,
    stale_held_search_refused: bool,
) -> Result<Json, String> {
    let plan_hash_g = compiled
        .generation
        .programs()
        .get(&plan.query)
        .map(|(_, certificate)| certificate.plan_hash.clone())
        .ok_or_else(|| format!("generation G omitted query {}", plan.query))?;
    let program_generation = Generation::certify(program_successor, Ceilings::default())
        .map_err(|errors| format!("program successor did not certify: {errors:?}"))?;
    let plan_hash_g2 = program_generation
        .programs()
        .get(&plan.query)
        .map(|(_, certificate)| certificate.plan_hash.clone())
        .ok_or_else(|| format!("program successor omitted query {}", plan.query))?;
    if plan_hash_g2 == plan_hash_g {
        return Err(format!(
            "program successor retained predecessor plan hash {plan_hash_g}"
        ));
    }

    let mut retained =
        SseProbe::connect(owner, &plan.query, plan.query_args.clone(), &plan.persona)
            .map_err(|error| format!("generation G subscription was refused: {error:?}"))?;
    let initial = retained
        .event(Duration::from_secs(2))
        .map_err(|error| format!("generation G delivery missing: {error}"))?;
    require_visible_complete(&initial)?;
    let (_, certificate) = &compiled.generation.programs()[&plan.query];
    let projected = certificate.read_sites.iter().any(|site| {
        site.table != plan.protected_table
            && compiled.generation.schema().tables[&site.table]
                .tombstones
                .iter()
                .any(|t| t.table == plan.protected_table)
    });
    let expected_data = if projected {
        projected_policy_data(
            &initial["data"],
            &compiled.generation.schema().tables[&plan.protected_table],
        )?
    } else {
        json!([])
    };

    let policy_applied = apply_project(owner, policy_successor)?;
    let generation_g1 = policy_applied["to"]
        .as_str()
        .ok_or_else(|| format!("policy successor report omitted generation: {policy_applied}"))?;
    if generation_g1 == compiled.generation.hash() {
        return Err(format!(
            "denying policy successor retained generation {}",
            compiled.generation.hash()
        ));
    }
    let policy_retained = retained.event(Duration::from_secs(2)).map_err(|error| {
        format!("retained G handle was not redelivered under policy generation G+1: {error}")
    })?;
    require_policy_filtered(
        &policy_retained,
        "retained G handle under G+1 policy",
        &expected_data,
    )?;
    let policy_fresh = fresh_query(owner, plan, "G+1 policy")?;
    require_policy_filtered(
        &policy_fresh,
        "fresh invocation under G+1 policy",
        &expected_data,
    )?;

    let program_applied = apply_project(owner, program_successor)?;
    let generation_g2 = program_applied["to"]
        .as_str()
        .ok_or_else(|| format!("program successor report omitted generation: {program_applied}"))?;
    if generation_g2 != compiled.generation.hash() || generation_g2 == generation_g1 {
        return Err(format!(
            "program successor did not restore the base schema identity for G+2 (G={}, G+1={generation_g1}, G+2={generation_g2})",
            compiled.generation.hash(),
        ));
    }
    let program_retained = retained.event(Duration::from_secs(2)).map_err(|error| {
        format!("retained G handle was not redelivered under program generation G+2: {error}")
    })?;
    require_exact_denial(
        &program_retained,
        program_denial,
        "retained G handle under G+2 program",
    )?;
    let program_fresh = fresh_query(owner, plan, "G+2 program")?;
    require_exact_denial(
        &program_fresh,
        program_denial,
        "fresh invocation under G+2 program",
    )?;

    let manifest = client::api(owner, "GET", "/api/manifest", &[], json!({}))
        .map_err(|error| format!("G+2 manifest request failed: {error:?}"))?;
    if manifest.status != 200 || manifest.body["generation"].as_str() != Some(generation_g2) {
        return Err(format!(
            "served manifest did not bind G+2 {generation_g2}: {}",
            manifest.body
        ));
    }
    Ok(json!({
        "query": plan.query,
        "as": plan.persona,
        "protectedTable": plan.protected_table,
        "generationG": compiled.generation.hash(),
        "generationG1": generation_g1,
        "generationG2": generation_g2,
        "planHashG": plan_hash_g,
        "planHashG2": plan_hash_g2,
        "generationScope": "schema",
        "policyReplacement": "Deny",
        "policyRetiredHeldSearchDescriptors": retired_held_search,
        "staleHeldSearchDescriptorRefused": stale_held_search_refused,
        "policyRetainedHandleState": policy_retained["state"],
        "policyRetainedHandleRows": 0,
        "policyFreshInvocationState": policy_fresh["state"],
        "policyFreshInvocationRows": 0,
        "successorDenialRule": program_denial,
        "initialState": initial["state"],
        "retainedHandleState": program_retained["state"],
        "retainedHandleRule": program_retained["rule"],
        "retainedHandleSeq": program_retained["seq"],
        "freshInvocationState": program_fresh["state"],
        "freshInvocationRule": program_fresh["rule"],
        "activeManifestGeneration": manifest.body["generation"],
        "predecessorDisposition": "retained handle replanned independently under replacement policy and program generations",
        "transport": "two served control applies + retained SSE + fresh query API",
    }))
}

fn fresh_query(owner: &OwnerInfo, plan: &QueryPlan, stage: &str) -> Result<Json, String> {
    let fresh = client::api(
        owner,
        "POST",
        "/api/query",
        &[("X-Snapback-As", plan.persona.as_str())],
        json!({ "op": plan.query, "args": plan.query_args }),
    )
    .map_err(|error| format!("fresh {stage} query failed: {error:?}"))?;
    if fresh.status != 200 {
        return Err(format!(
            "fresh {stage} invocation returned HTTP {}: {}",
            fresh.status, fresh.body
        ));
    }
    Ok(fresh.body)
}

fn membership_recipe(schema: &Schema) -> Option<Recipe> {
    for (membership_table, table) in &schema.tables {
        let RuleExpr::Exists {
            table: target,
            index,
            key,
            ..
        } = &table.rules.read
        else {
            continue;
        };
        if target != membership_table {
            continue;
        }
        let Some(definition) = table.indexes.get(index) else {
            continue;
        };
        let Some(columns) = definition.scalar_columns() else {
            continue;
        };
        let Some((scope_field, principal_field)) = recipe_key(&columns, key) else {
            continue;
        };
        if !matches!(
            table.columns.get(&principal_field),
            Some(ColumnType::Principal)
        ) {
            continue;
        }
        if !viewer_is(&table.rules.delete, &principal_field) {
            continue;
        }
        let protected = schema
            .tables
            .iter()
            .filter(|(name, _)| *name != membership_table)
            .filter_map(|(name, protected)| {
                protected_scope(&protected.rules.read, membership_table, index, &columns).map(
                    |scope_field| ProtectedTable {
                        table: name.clone(),
                        scope_field,
                    },
                )
            })
            .collect::<Vec<_>>();
        if protected.is_empty() {
            continue;
        }
        let scope_table = match table.columns.get(&scope_field) {
            Some(ColumnType::Ref { table }) => Some(table.clone()),
            _ => None,
        };
        return Some(Recipe {
            membership_table: membership_table.clone(),
            membership_index: index.clone(),
            scope_field,
            principal_field,
            scope_table,
            protected,
        });
    }
    None
}

fn recipe_key(columns: &[String], key: &[RuleTerm]) -> Option<(String, String)> {
    if columns.len() != key.len() || key.len() < 2 {
        return None;
    }
    let mut scope = None;
    let mut principal = None;
    for (column, term) in columns.iter().zip(key) {
        match term {
            RuleTerm::Field(field) if field == column && scope.is_none() => {
                scope = Some(field.clone());
            }
            RuleTerm::Viewer if principal.is_none() => principal = Some(column.clone()),
            _ => return None,
        }
    }
    Some((scope?, principal?))
}

fn protected_scope(
    rule: &RuleExpr,
    membership_table: &str,
    membership_index: &str,
    columns: &[String],
) -> Option<String> {
    let RuleExpr::Exists {
        table, index, key, ..
    } = rule
    else {
        return None;
    };
    if table != membership_table || index != membership_index || columns.len() != key.len() {
        return None;
    }
    let mut scope = None;
    let mut saw_viewer = false;
    for term in key {
        match term {
            RuleTerm::Field(field) if scope.is_none() => scope = Some(field.clone()),
            RuleTerm::Viewer if !saw_viewer => saw_viewer = true,
            _ => return None,
        }
    }
    if saw_viewer { scope } else { None }
}

fn viewer_is(rule: &RuleExpr, field: &str) -> bool {
    match rule {
        RuleExpr::Eq(RuleTerm::Field(name), RuleTerm::Viewer)
        | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(name)) => name == field,
        RuleExpr::And(rules) | RuleExpr::Or(rules) => {
            rules.iter().any(|rule| viewer_is(rule, field))
        }
        _ => false,
    }
}

fn query_plan(
    compiled: &CompiledProject,
    seed: &SeedData,
    recipe: &Recipe,
) -> Result<QueryPlan, PlanBlock> {
    let mut reasons = BTreeSet::new();
    for protected in &recipe.protected {
        let has_scoped_write =
            compiled
                .generation
                .programs()
                .values()
                .any(|(program, certificate)| {
                    protected_write_eligible(
                        program,
                        &certificate.write_sites,
                        compiled.generation.schema(),
                        recipe,
                        &protected.table,
                    )
                });
        if !has_scoped_write {
            reasons.insert(format!(
                "{}: no mutation can write this protected scope",
                protected.table
            ));
            continue;
        }
        let queries =
            compiled
                .generation
                .programs()
                .iter()
                .filter(|(_, (program, certificate))| {
                    program.kind == ProgramKind::Query
                        && query_isolates_protected_table(
                            program,
                            &certificate.read_sites,
                            recipe,
                            &protected.table,
                            compiled.generation.schema(),
                        )
                        && certificate
                            .read_sites
                            .iter()
                            .any(|site| site.table == protected.table)
                });
        for (query, (program, _)) in queries {
            for (persona, principal, membership_id, scope) in membership_candidates(seed, recipe) {
                if !seed.rows.get(&protected.table).is_some_and(|rows| {
                    rows.iter()
                        .any(|row| row.get(&protected.scope_field) == Some(&scope))
                }) {
                    reasons.insert(format!(
                        "{query} as {persona}: no seeded {} row in scope {scope}",
                        protected.table
                    ));
                    continue;
                }
                match scoped_args(program, seed, recipe, &scope, &membership_id, &principal) {
                    Ok(args) => {
                        return Ok(QueryPlan {
                            query: query.clone(),
                            query_args: args,
                            persona,
                            principal,
                            membership_id,
                            scope,
                            protected_table: protected.table.clone(),
                        });
                    }
                    Err(reason) => {
                        reasons.insert(format!("{query} as {persona}: {reason}"));
                    }
                }
            }
        }
    }
    Err(PlanBlock {
        reason: format!(
            "canonical membership {}.{} has no seeded admitted protected query",
            recipe.membership_table, recipe.membership_index
        ),
        candidates: reasons.into_iter().collect(),
    })
}

fn query_isolates_protected_table(
    program: &Program,
    read_sites: &[ReadSite],
    recipe: &Recipe,
    protected_table: &str,
    schema: &Schema,
) -> bool {
    // A discovery scan can legitimately become an empty global-search lane
    // after membership removal. The terminal-revocation witness therefore
    // needs an explicit membership Require, not mere table overlap or take 1.
    read_sites
        .iter()
        .all(|site| site.table == recipe.membership_table || site.table == protected_table
            || schema.tables.get(&site.table).is_some_and(|table| table.tombstones.iter().any(|t| t.table == protected_table)))
        // This is only a bounded candidate preference. A dependency can be
        // semantically weakened (for example, `member || true`); the served
        // post-revocation terminal delivery below is the authority witness.
        && program_has_membership_guard_dependency(
            program,
            &recipe.membership_table,
            &recipe.membership_index,
        )
}

fn protected_write_eligible(
    program: &Program,
    write_sites: &[WriteSite],
    schema: &Schema,
    recipe: &Recipe,
    protected_table: &str,
) -> bool {
    if program.kind != ProgramKind::Mutation || !program_accepts_scope(program, recipe) {
        return false;
    }
    let maintain_sources = schema
        .maintains
        .iter()
        .filter(|maintain| maintain.target == protected_table)
        .map(|maintain| maintain.source.as_str())
        .collect::<BTreeSet<_>>();
    write_sites.iter().any(|site| {
        (site.table == protected_table || maintain_sources.contains(site.table.as_str()))
            && matches!(
                site.kind,
                WriteKind::Insert | WriteKind::Update | WriteKind::Upsert
            )
    })
}

fn program_accepts_scope(program: &Program, recipe: &Recipe) -> bool {
    program.args.iter().any(|(name, kind)| {
        name == &recipe.scope_field
            || recipe
                .scope_table
                .as_deref()
                .is_some_and(|table| ref_table(kind) == Some(table))
    })
}

fn membership_candidates(seed: &SeedData, recipe: &Recipe) -> Vec<(String, String, String, Json)> {
    let Some(rows) = seed.rows.get(&recipe.membership_table) else {
        return Vec::new();
    };
    let mut personas = seed.personas.clone();
    personas.sort_by_key(|persona| if persona == "bob" { 0 } else { 1 });
    personas
        .into_iter()
        .flat_map(|persona| {
            let principal = format!("dev:{persona}");
            rows.iter().filter_map(move |row| {
                let row_principal = row.get(&recipe.principal_field)?.as_str()?;
                if row_principal != principal {
                    return None;
                }
                Some((
                    persona.clone(),
                    row_principal.to_owned(),
                    row.get("id")?.as_str()?.to_owned(),
                    row.get(&recipe.scope_field)?.clone(),
                ))
            })
        })
        .collect()
}

fn revoke_plan(
    compiled: &CompiledProject,
    seed: &SeedData,
    recipe: &Recipe,
    plan: &QueryPlan,
) -> Result<RevokePlan, PlanBlock> {
    let mut reasons = BTreeSet::new();
    for (mutation, (program, certificate)) in compiled.generation.programs() {
        if program.kind != ProgramKind::Mutation
            || !certificate
                .write_sites
                .iter()
                .any(|site| site.table == recipe.membership_table && site.kind == WriteKind::Delete)
        {
            continue;
        }
        if !program.args.iter().any(|(name, kind)| {
            name == "membershipId" || ref_table(kind) == Some(recipe.membership_table.as_str())
        }) {
            reasons.insert(format!(
                "{mutation}: deletes {} but has no exact membership ref argument",
                recipe.membership_table
            ));
            continue;
        }
        match scoped_args(
            program,
            seed,
            recipe,
            &plan.scope,
            &plan.membership_id,
            &plan.principal,
        ) {
            Ok(args) => {
                return Ok(RevokePlan {
                    mutation: mutation.clone(),
                    mutation_args: args,
                });
            }
            Err(reason) => {
                reasons.insert(format!("{mutation}: {reason}"));
            }
        }
    }
    Err(PlanBlock {
        reason: format!(
            "canonical membership {}.{} has no named mutation that deletes an exact membership ref",
            recipe.membership_table, recipe.membership_index
        ),
        candidates: reasons.into_iter().collect(),
    })
}

fn protected_write_plan(
    compiled: &CompiledProject,
    seed: &SeedData,
    recipe: &Recipe,
    plan: &QueryPlan,
) -> Result<ProtectedWritePlan, PlanBlock> {
    let mut reasons = BTreeSet::new();
    let admitted = membership_candidates(seed, recipe)
        .into_iter()
        .filter(|(_, principal, _, scope)| principal != &plan.principal && scope == &plan.scope)
        .collect::<Vec<_>>();
    if admitted.is_empty() {
        reasons.insert(format!(
            "no second seeded principal remains admitted to scope {} after revoking {}",
            plan.scope, plan.principal
        ));
    }
    for (mutation, (program, certificate)) in compiled.generation.programs() {
        if !protected_write_eligible(
            program,
            &certificate.write_sites,
            compiled.generation.schema(),
            recipe,
            &plan.protected_table,
        ) {
            continue;
        }
        for (persona, principal, membership_id, scope) in &admitted {
            match scoped_args(program, seed, recipe, scope, membership_id, principal) {
                Ok(args) => {
                    return Ok(ProtectedWritePlan {
                        mutation: mutation.clone(),
                        mutation_args: args,
                        persona: persona.clone(),
                        principal: principal.clone(),
                    });
                }
                Err(reason) => {
                    reasons.insert(format!("{mutation} as {persona}: {reason}"));
                }
            }
        }
    }
    Err(PlanBlock {
        reason: format!(
            "canonical protected table {} has no probeable admitted mutation for a post-revocation write",
            plan.protected_table
        ),
        candidates: reasons.into_iter().collect(),
    })
}

fn scoped_args(
    program: &Program,
    seed: &SeedData,
    recipe: &Recipe,
    scope: &Json,
    membership_id: &str,
    principal: &str,
) -> Result<Json, String> {
    let mut args = generated_args(program, seed)?;
    let object = args
        .as_object_mut()
        .ok_or_else(|| format!("generated args for {} were not an object", program.name))?;
    for (name, kind) in &program.args {
        if name == "membershipId" || ref_table(kind) == Some(recipe.membership_table.as_str()) {
            object.insert(name.clone(), json!(membership_id));
        } else if name == &recipe.scope_field
            || recipe
                .scope_table
                .as_deref()
                .is_some_and(|table| ref_table(kind) == Some(table))
        {
            object.insert(name.clone(), scope.clone());
        } else if matches!(unwrap_optional(kind), ArgType::Principal) {
            object.insert(name.clone(), json!(principal));
        }
    }
    Ok(args)
}

fn ref_table(kind: &ArgType) -> Option<&str> {
    match unwrap_optional(kind) {
        ArgType::Ref { table } => Some(table),
        _ => None,
    }
}

fn unwrap_optional(mut kind: &ArgType) -> &ArgType {
    while let ArgType::Optional(inner) = kind {
        kind = inner;
    }
    kind
}

fn require_visible_complete(delivery: &Json) -> Result<(), String> {
    if delivery["state"] != "complete" {
        return Err(format!(
            "membership fixture did not begin complete: {delivery}"
        ));
    }
    let visible = match delivery.get("data") {
        Some(Json::Array(rows)) => !rows.is_empty(),
        Some(Json::Object(fields)) => !fields.is_empty(),
        _ => false,
    };
    if !visible {
        return Err(format!(
            "membership fixture did not begin with visible protected data: {delivery}"
        ));
    }
    Ok(())
}

fn require_no_rows(delivery: &Json) -> Result<(), String> {
    match delivery.get("data") {
        None | Some(Json::Null) => Ok(()),
        Some(Json::Array(rows)) if rows.is_empty() => Ok(()),
        Some(data) => Err(format!(
            "denied delivery exposed post-revocation data: {data}"
        )),
    }
}

fn require_policy_filtered(delivery: &Json, subject: &str, expected: &Json) -> Result<(), String> {
    if delivery["state"] != "complete" {
        return Err(format!(
            "{subject} did not resolve through the replacement table policy: {delivery}"
        ));
    }
    match delivery.get("data") {
        Some(data) if data == expected => Ok(()),
        Some(data) => Err(format!(
            "{subject} exposed rows despite the replacement deny policy: {data}"
        )),
        None => Err(format!(
            "{subject} omitted data under the replacement deny policy: {delivery}"
        )),
    }
}

fn require_exact_denial(
    delivery: &Json,
    successor_denial: &str,
    subject: &str,
) -> Result<(), String> {
    if delivery["state"] != "denied" {
        return Err(format!("{subject} did not resolve to denied: {delivery}"));
    }
    if delivery["rule"].as_str() != Some(successor_denial) {
        return Err(format!(
            "{subject} did not carry the exact denial rule {successor_denial}: {delivery}"
        ));
    }
    require_no_rows(delivery)
}

fn apply_project(owner: &OwnerInfo, project: &ProjectJson) -> Result<Json, String> {
    let project = serde_json::to_value(project)
        .map_err(|error| format!("cannot serialize successor project: {error}"))?;
    let response = client::control(
        owner,
        "POST",
        "/control/apply",
        json!({ "project": project }),
    )
    .map_err(|error| format!("successor apply request failed: {error:?}"))?;
    if response.status != 200 {
        return Err(format!(
            "successor apply returned HTTP {}: {}",
            response.status, response.body
        ));
    }
    Ok(response.body)
}

fn restore_generation(owner: &OwnerInfo, compiled: &CompiledProject) -> Result<(), String> {
    // Generation identity is schema-scoped, so a program-only successor can
    // share this hash while still carrying different executable content.
    // Always reapply the exact compiled project rather than trusting status.
    let restored = apply_project(owner, &compiled.project)?;
    if restored["to"].as_str() != Some(compiled.generation.hash().as_str()) {
        return Err(format!(
            "restore applied an unexpected generation: {restored}"
        ));
    }
    Ok(())
}

fn reset(owner: &OwnerInfo) -> Result<(), String> {
    let response = client::control(owner, "POST", "/control/reset", json!({}))
        .map_err(|error| format!("seed reset request failed: {error:?}"))?;
    if response.status == 200 {
        Ok(())
    } else {
        Err(format!(
            "seed reset returned HTTP {}: {}",
            response.status, response.body
        ))
    }
}

fn blocked(name: &str, started: Instant, recipe: &Recipe, reason: PlanBlock) -> CheckReceipt {
    CheckReceipt::blocked(
        name,
        "derived",
        elapsed_ms(started),
        json!({
            "reason": reason.reason,
            "candidates": reason.candidates,
            "membership": {
                "table": recipe.membership_table,
                "index": recipe.membership_index,
                "scopeField": recipe.scope_field,
                "principalField": recipe.principal_field,
            },
        }),
    )
}

#[cfg(test)]
#[path = "test_authority_tests.rs"]
mod tests;

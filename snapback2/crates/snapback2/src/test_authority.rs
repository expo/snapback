//! Served-loop authorization proofs for projects that declare scoped membership.
// @ref LLP 1002#7-test-and-the-receipt — revocation and successor fences are named receipt proofs.

use super::test_sse::SseProbe;
use super::{elapsed_ms, generated_args};
use crate::client;
use crate::owner::OwnerInfo;
use crate::project::{CompiledProject, SeedData};
use crate::receipt::CheckReceipt;
use serde_json::{Value as Json, json};
use snapback2_core::{
    ArgType, ColumnType, Expr, Program, ProgramKind, ProjectJson, RuleExpr, RuleTerm, Schema, Stmt,
    Value, WriteKind,
};
use std::collections::BTreeSet;
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
struct PlanBlock {
    reason: String,
    candidates: Vec<String>,
}

pub(super) fn checks(
    owner: &OwnerInfo,
    compiled: &CompiledProject,
    seed: &SeedData,
) -> Vec<CheckReceipt> {
    let Some(recipe) = membership_recipe(&compiled.generation.schema) else {
        return Vec::new();
    };
    let query_plan = query_plan(compiled, seed, &recipe);
    vec![
        live_revocation(owner, compiled, seed, &recipe, query_plan.clone()),
        successor_policy_fence(owner, compiled, &recipe, query_plan),
        grant_incarnation_aba(&recipe),
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
    match live_revocation_attempt(owner, recipe, &plan, &revoke, &protected_write) {
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
            "protectedRowsWritten": protected_rows_written,
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
                "generationG": compiled.generation.hash,
                "transport": "served control apply + retained SSE + fresh query API",
            }),
        ),
    }
}

fn grant_incarnation_aba(recipe: &Recipe) -> CheckReceipt {
    let started = Instant::now();
    blocked(
        GRANT_INCARNATION_ABA,
        started,
        recipe,
        PlanBlock {
            reason: "no durable captured-intent carrier binds a membership row identity, incarnation, or expected version; remove/recreate ABA cannot be replayed safely"
                .to_owned(),
            candidates: vec![
                "membership row ids exist, but no served operation captures and later replays one as durable authorization intent"
                    .to_owned(),
            ],
        },
    )
}

fn successor_policy_attempt(
    owner: &OwnerInfo,
    compiled: &CompiledProject,
    plan: &QueryPlan,
) -> Result<Json, String> {
    reset(owner)?;
    let mut policy_successor = compiled.project.clone();
    policy_successor
        .schema
        .tables
        .get_mut(&plan.protected_table)
        .ok_or_else(|| format!("protected table {} disappeared", plan.protected_table))?
        .rules
        .read = RuleExpr::Deny;
    let mut program_successor = compiled.project.clone();
    let program_denial = format!("{SUCCESSOR_DENIAL_PREFIX}{}", compiled.generation.hash);
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
        &policy_successor,
        &program_successor,
        &program_denial,
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
) -> Result<Json, String> {
    let mut retained =
        SseProbe::connect(owner, &plan.query, plan.query_args.clone(), &plan.persona)
            .map_err(|error| format!("generation G subscription was refused: {error:?}"))?;
    let initial = retained
        .event(Duration::from_secs(2))
        .map_err(|error| format!("generation G delivery missing: {error}"))?;
    require_visible_complete(&initial)?;

    let policy_applied = apply_project(owner, policy_successor)?;
    let generation_g1 = policy_applied["to"]
        .as_str()
        .ok_or_else(|| format!("policy successor report omitted generation: {policy_applied}"))?;
    if generation_g1 == compiled.generation.hash {
        return Err(format!(
            "denying policy successor retained generation {}",
            compiled.generation.hash
        ));
    }
    let policy_retained = retained.event(Duration::from_secs(2)).map_err(|error| {
        format!("retained G handle was not redelivered under policy generation G+1: {error}")
    })?;
    require_policy_filtered(&policy_retained, "retained G handle under G+1 policy")?;
    let policy_fresh = fresh_query(owner, plan, "G+1 policy")?;
    require_policy_filtered(&policy_fresh, "fresh invocation under G+1 policy")?;

    let program_applied = apply_project(owner, program_successor)?;
    let generation_g2 = program_applied["to"]
        .as_str()
        .ok_or_else(|| format!("program successor report omitted generation: {program_applied}"))?;
    if generation_g2 == compiled.generation.hash || generation_g2 == generation_g1 {
        return Err(format!(
            "program successor did not establish a distinct G+2 (G={}, G+1={generation_g1}, G+2={generation_g2})",
            compiled.generation.hash,
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
        "generationG": compiled.generation.hash,
        "generationG1": generation_g1,
        "generationG2": generation_g2,
        "policyReplacement": "Deny",
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
        let Some((scope_field, principal_field)) = recipe_key(&definition.columns, key) else {
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
                protected_scope(
                    &protected.rules.read,
                    membership_table,
                    index,
                    &definition.columns,
                )
                .map(|scope_field| ProtectedTable {
                    table: name.clone(),
                    scope_field,
                })
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
    matches!(
        rule,
        RuleExpr::Eq(RuleTerm::Field(name), RuleTerm::Viewer)
            | RuleExpr::Eq(RuleTerm::Viewer, RuleTerm::Field(name)) if name == field
    )
}

fn query_plan(
    compiled: &CompiledProject,
    seed: &SeedData,
    recipe: &Recipe,
) -> Result<QueryPlan, PlanBlock> {
    let mut reasons = BTreeSet::new();
    for protected in &recipe.protected {
        let queries = compiled
            .generation
            .programs
            .iter()
            .filter(|(_, (program, certificate))| {
                program.kind == ProgramKind::Query
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
    for (mutation, (program, certificate)) in &compiled.generation.programs {
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
    for (mutation, (program, certificate)) in &compiled.generation.programs {
        if program.kind != ProgramKind::Mutation
            || !certificate.write_sites.iter().any(|site| {
                site.table == plan.protected_table
                    && matches!(
                        site.kind,
                        WriteKind::Insert | WriteKind::Update | WriteKind::Upsert
                    )
            })
        {
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
    if !delivery["data"]
        .as_array()
        .is_some_and(|rows| !rows.is_empty())
    {
        return Err(format!(
            "membership fixture did not begin with a visible protected row: {delivery}"
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

fn require_policy_filtered(delivery: &Json, subject: &str) -> Result<(), String> {
    if delivery["state"] != "complete" {
        return Err(format!(
            "{subject} did not resolve through the replacement table policy: {delivery}"
        ));
    }
    match delivery.get("data") {
        Some(Json::Array(rows)) if rows.is_empty() => Ok(()),
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
    let status = client::control(owner, "GET", "/control/status", json!({}))
        .map_err(|error| format!("cannot inspect active generation: {error:?}"))?;
    if status.status != 200 {
        return Err(format!(
            "status returned HTTP {}: {}",
            status.status, status.body
        ));
    }
    if status.body["generation"].as_str() == Some(compiled.generation.hash.as_str()) {
        return Ok(());
    }
    let restored = apply_project(owner, &compiled.project)?;
    if restored["to"].as_str() != Some(compiled.generation.hash.as_str()) {
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
mod tests {
    use super::*;
    use snapback2_core::{Index, KeyProvenance, Rules, Table};
    use std::collections::BTreeMap;

    fn authority_schema(principal_column: ColumnType) -> Schema {
        let membership_rule = RuleExpr::Exists {
            table: "memberships".to_owned(),
            index: "byScopePrincipal".to_owned(),
            key: vec![RuleTerm::Field("scopeId".to_owned()), RuleTerm::Viewer],
            provenance: KeyProvenance::Shape,
        };
        let viewer_is_principal =
            RuleExpr::Eq(RuleTerm::Field("principal".to_owned()), RuleTerm::Viewer);
        let memberships = Table {
            columns: BTreeMap::from([
                (
                    "scopeId".to_owned(),
                    ColumnType::Ref {
                        table: "scopes".to_owned(),
                    },
                ),
                ("principal".to_owned(), principal_column),
            ]),
            indexes: BTreeMap::from([(
                "byScopePrincipal".to_owned(),
                Index {
                    columns: vec!["scopeId".to_owned(), "principal".to_owned()],
                    unique: true,
                },
            )]),
            rules: Rules {
                read: membership_rule.clone(),
                insert: RuleExpr::Allow,
                update: viewer_is_principal.clone(),
                delete: viewer_is_principal,
            },
            constraints: Vec::new(),
        };
        let protected = Table {
            columns: BTreeMap::from([(
                "scopeId".to_owned(),
                ColumnType::Ref {
                    table: "scopes".to_owned(),
                },
            )]),
            indexes: BTreeMap::new(),
            rules: Rules {
                read: membership_rule,
                insert: RuleExpr::Allow,
                update: RuleExpr::Allow,
                delete: RuleExpr::Allow,
            },
            constraints: Vec::new(),
        };
        Schema {
            tables: BTreeMap::from([
                ("memberships".to_owned(), memberships),
                ("documents".to_owned(), protected),
            ]),
            ..Schema::default()
        }
    }

    #[test]
    fn authority_recipe_requires_a_nominal_principal_axis() {
        let principal = authority_schema(ColumnType::Principal);
        let recipe = membership_recipe(&principal).expect("Principal axis should be discovered");
        assert_eq!(recipe.membership_table, "memberships");
        assert_eq!(recipe.principal_field, "principal");

        let pseudo_membership = authority_schema(ColumnType::Ref {
            table: "profiles".to_owned(),
        });
        assert!(
            membership_recipe(&pseudo_membership).is_none(),
            "a Ref column must not synthesize canonical authority proofs"
        );
    }

    #[test]
    fn membership_candidates_require_the_authenticated_principal() {
        let schema = authority_schema(ColumnType::Principal);
        let recipe = membership_recipe(&schema).expect("Principal axis should be discovered");
        let seed = SeedData {
            personas: vec!["alice".to_owned()],
            rows: BTreeMap::from([(
                "memberships".to_owned(),
                vec![
                    json!({ "id": "legacy", "scopeId": "scope-1", "principal": "alice" }),
                    json!({ "id": "exact", "scopeId": "scope-1", "principal": "dev:alice" }),
                ],
            )]),
        };

        let candidates = membership_candidates(&seed, &recipe);
        assert_eq!(candidates.len(), 1);
        assert_eq!(candidates[0].1, "dev:alice");
        assert_eq!(candidates[0].2, "exact");
    }

    #[test]
    fn successor_denial_requires_the_unique_program_rule() {
        let expected = "SNAPBACK2_TEST_SUCCESSOR_POLICY_FENCE:g";
        for delivery in [
            json!({ "state": "denied", "data": [] }),
            json!({ "state": "denied", "rule": "generation-g-rule", "data": [] }),
            json!({ "state": "complete", "rule": expected, "data": [] }),
        ] {
            assert!(
                require_exact_denial(&delivery, expected, "probe").is_err(),
                "a non-G+1 denial was accepted: {delivery}"
            );
        }
        require_exact_denial(
            &json!({ "state": "denied", "rule": expected, "data": [] }),
            expected,
            "probe",
        )
        .expect("the exact empty G+1 denial should pass");
    }
}

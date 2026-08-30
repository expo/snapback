//! Rule, revocation, and invalidation derived checks for `snapback2 test`.
// @ref LLP 1002#7-test-and-the-receipt — policy changes are proved through
// the same receipt-producing test verb as the other derived checks.

use super::*;
use crate::project::seed_rows;
use snapback2_core::{Actor, Expr, RuleExpr, Stmt};

pub(super) fn check_rules(
    owner: &OwnerInfo,
    compiled: &CompiledProject,
    seed: &SeedData,
) -> CheckReceipt {
    let started = Instant::now();
    let mut failures = Vec::new();
    let mut blocked = Vec::new();
    let mut probes = 0_u64;
    let mut tables = Map::new();
    for (table_name, table) in &compiled.generation.schema.tables {
        if table.rules.read.is_public() {
            continue;
        }
        let rows = seed.rows.get(table_name).cloned().unwrap_or_default();
        if rows.is_empty() {
            blocked.push(json!({
                "table": table_name,
                "reason": format!("no seed rows for {table_name}"),
            }));
            tables.insert(
                table_name.clone(),
                json!({ "seedRows": 0, "personas": 0, "probes": 0 }),
            );
            continue;
        }
        let mut personas = seed.personas.clone();
        let unlisted = format!("__snapback2_unlisted_{table_name}");
        personas.push(unlisted.clone());
        let mut table_probes = 0_u64;
        for persona in &personas {
            let actual_response = client::control(
                owner,
                "POST",
                "/control/data",
                json!({
                    "table": table_name,
                    "index": "byId",
                    "prefix": [],
                    "limit": 500,
                    "as": persona,
                }),
            );
            let actual_body = match actual_response {
                Ok(response) if response.status < 400 => response.body,
                Ok(response) => {
                    failures.push(json!({
                        "table": table_name,
                        "as": persona,
                        "source": "data",
                        "response": response.body,
                    }));
                    continue;
                }
                Err(error) => {
                    failures.push(json!({ "table": table_name, "as": persona, "source": "data", "error": error }));
                    continue;
                }
            };
            let expected_response = client::control(
                owner,
                "POST",
                "/control/verdicts",
                json!({ "table": table_name, "as": persona }),
            );
            let expected_body = match expected_response {
                Ok(response) if response.status < 400 => response.body,
                Ok(response) => {
                    failures.push(json!({
                        "table": table_name,
                        "as": persona,
                        "source": "engine",
                        "response": response.body,
                    }));
                    continue;
                }
                Err(error) => {
                    failures.push(json!({ "table": table_name, "as": persona, "source": "engine", "error": error }));
                    continue;
                }
            };
            let actual = actual_body
                .get("data")
                .and_then(Json::as_array)
                .into_iter()
                .flatten()
                .filter_map(|row| row.get("id").and_then(Json::as_str).map(ToOwned::to_owned))
                .collect::<BTreeSet<_>>();
            let verdicts = expected_body
                .get("rows")
                .and_then(Json::as_array)
                .cloned()
                .unwrap_or_default();
            let expected = verdicts
                .iter()
                .filter(|row| row.get("admitted").and_then(Json::as_bool) == Some(true))
                .filter_map(|row| row.get("id").and_then(Json::as_str).map(ToOwned::to_owned))
                .collect::<BTreeSet<_>>();
            table_probes += verdicts.len() as u64;
            probes += verdicts.len() as u64;
            if !rule_id_sets_match(&actual, &expected) {
                failures.push(json!({ "table": table_name, "as": persona, "expected": expected, "actual": actual }));
            }
        }
        tables.insert(
            table_name.clone(),
            json!({
                "seedRows": rows.len(),
                "personas": personas.len(),
                "probes": table_probes,
            }),
        );
    }
    let detail = json!({
        "probes": probes,
        "tables": tables,
        "expectedBy": "engine",
        "actualBy": "data",
        "blocked": blocked,
    });
    if !failures.is_empty() {
        CheckReceipt::fail(
            "rules",
            "derived",
            elapsed_ms(started),
            json!({ "failures": failures, "summary": detail }),
        )
    } else if !blocked.is_empty() {
        CheckReceipt::blocked("rules", "derived", elapsed_ms(started), detail)
    } else {
        CheckReceipt::pass("rules", "derived", elapsed_ms(started), detail)
    }
}

pub(super) fn rule_id_sets_match(actual: &BTreeSet<String>, expected: &BTreeSet<String>) -> bool {
    actual == expected
}

pub(super) fn check_invalidation(
    owner: &OwnerInfo,
    compiled: &CompiledProject,
    seed: &SeedData,
) -> CheckReceipt {
    let started = Instant::now();
    let mut failures = Vec::new();
    let mut blocked = Vec::new();
    let mut probes = 0_u64;
    let mut attempts = 0_u64;
    let mut silence_probes = 0_u64;
    let mut intersections = Vec::new();
    for (query_name, (query, query_certificate)) in &compiled.generation.programs {
        if query.kind != ProgramKind::Query {
            continue;
        }
        let query_args = match generated_args_at(query, seed, 0) {
            Ok(args) => args,
            Err(reason) => {
                blocked.push(json!({ "query": query_name, "reason": reason }));
                continue;
            }
        };
        let query_persona = seed
            .personas
            .first()
            .cloned()
            .unwrap_or_else(|| "alice".to_owned());
        let mut query_has_silence = false;
        for (mutation_name, (mutation, mutation_certificate)) in &compiled.generation.programs {
            if mutation.kind != ProgramKind::Mutation {
                continue;
            }
            let shared_sites = certificate_site_intersection(
                query_certificate,
                mutation_certificate,
                &compiled.generation,
            );
            let candidates = match probe_candidates(mutation, seed) {
                Ok(candidates) => candidates,
                Err(reason) => {
                    blocked.push(json!({ "mutation": mutation_name, "reason": reason }));
                    continue;
                }
            };
            if shared_sites.is_empty() {
                for (persona, mutation_args) in &candidates {
                    attempts += 1;
                    let (committed, failure) = invalidation_attempt(
                        owner,
                        query_name,
                        &query_args,
                        mutation_name,
                        mutation_args,
                        &query_persona,
                        persona,
                        false,
                    );
                    let proved_silence = committed && failure.is_none();
                    if let Some(failure) = failure {
                        failures.push(failure);
                    }
                    if proved_silence {
                        probes += 1;
                        silence_probes += 1;
                        query_has_silence = true;
                        break;
                    }
                }
                continue;
            }

            intersections.push(json!({
                "query": query_name,
                "mutation": mutation_name,
                "sites": shared_sites.iter().map(|(table, index)| json!({
                    "table": table,
                    "index": index,
                })).collect::<Vec<_>>(),
            }));
            let mut committed_intersection = false;
            for (persona, mutation_args) in candidates
                .iter()
                .filter(|(_, args)| probe_args_align(&query_args, args))
            {
                attempts += 1;
                let (committed, failure) = invalidation_attempt(
                    owner,
                    query_name,
                    &query_args,
                    mutation_name,
                    mutation_args,
                    persona,
                    persona,
                    true,
                );
                if let Some(failure) = failure {
                    failures.push(failure);
                }
                if committed {
                    committed_intersection = true;
                    probes += 1;
                    break;
                }
            }
            if !committed_intersection {
                blocked.push(json!({
                    "query": query_name,
                    "mutation": mutation_name,
                    "reason": "no committing probe",
                }));
                continue;
            }

            for (persona, mutation_args) in candidates
                .iter()
                .filter(|(_, args)| probe_args_diverge(&query_args, args))
            {
                attempts += 1;
                let (committed, failure) = invalidation_attempt(
                    owner,
                    query_name,
                    &query_args,
                    mutation_name,
                    mutation_args,
                    &query_persona,
                    persona,
                    false,
                );
                let proved_silence = committed && failure.is_none();
                if let Some(failure) = failure {
                    failures.push(failure);
                }
                if proved_silence {
                    probes += 1;
                    silence_probes += 1;
                    query_has_silence = true;
                    break;
                }
            }
        }
        if !query_has_silence {
            let disjoint_persona = format!("__snapback2_disjoint_{}", query_name.replace('.', "_"));
            for (mutation_name, (mutation, _)) in &compiled.generation.programs {
                if mutation.kind != ProgramKind::Mutation {
                    continue;
                }
                attempts += 1;
                let mutation_args = match generated_args_at(mutation, seed, 0) {
                    Ok(args) => args,
                    Err(reason) => {
                        blocked.push(json!({ "mutation": mutation_name, "reason": reason }));
                        continue;
                    }
                };
                let (committed, failure) = invalidation_attempt(
                    owner,
                    query_name,
                    &query_args,
                    mutation_name,
                    &mutation_args,
                    &query_persona,
                    &disjoint_persona,
                    false,
                );
                match failure {
                    None if committed => {
                        probes += 1;
                        silence_probes += 1;
                        query_has_silence = true;
                        break;
                    }
                    Some(failure)
                        if failure.get("error").and_then(Json::as_str)
                            == Some("non-intersecting committed mutation delivered") => {}
                    Some(failure) => failures.push(failure),
                    None => {}
                }
            }
        }
        if !query_has_silence {
            blocked.push(json!({
                "query": query_name,
                "reason": format!("no disjoint committing probe for {query_name}"),
            }));
        }
    }

    let (revocation, revocation_failures, revocation_blocked) =
        revocation_while_live(compiled, seed);
    failures.extend(revocation_failures);
    blocked.extend(revocation_blocked);
    let (subscription_replan, replan_failures, replan_blocked) =
        subscription_replan(compiled, seed);
    failures.extend(replan_failures);
    blocked.extend(replan_blocked);

    let detail = json!({
        "probes": probes,
        "attempts": attempts,
        "silenceProbes": silence_probes,
        "transport": "SSE",
        "intersectionLevel": "table+index",
        "intersections": intersections,
        "revocationWhileLive": revocation,
        "subscriptionReplan": subscription_replan,
        "blocked": blocked,
    });
    if !failures.is_empty() {
        CheckReceipt::fail(
            "invalidation",
            "derived",
            elapsed_ms(started),
            json!({ "failures": failures, "summary": detail }),
        )
    } else if !blocked.is_empty() {
        CheckReceipt::blocked("invalidation", "derived", elapsed_ms(started), detail)
    } else {
        CheckReceipt::pass("invalidation", "derived", elapsed_ms(started), detail)
    }
}

fn revocation_while_live(
    compiled: &CompiledProject,
    seed: &SeedData,
) -> (Json, Vec<Json>, Vec<Json>) {
    let rows = match seed_rows(seed, compiled) {
        Ok(rows) => rows,
        Err(error) => {
            return (
                json!({ "status": "fail" }),
                vec![json!({ "probe": "revocationWhileLive", "error": error })],
                Vec::new(),
            );
        }
    };
    let mut saw_rule_input = false;
    let mut rejected = Vec::new();
    let personas = if seed.personas.is_empty() {
        vec!["alice".to_owned()]
    } else {
        seed.personas.clone()
    };
    for (query_name, (query, certificate)) in &compiled.generation.programs {
        if query.kind != ProgramKind::Query {
            continue;
        }
        let grant_tables = direct_rule_input_tables(certificate, &compiled.generation);
        let args = match generated_args_at(query, seed, 0) {
            Ok(args) => args,
            Err(_) => continue,
        };
        for persona in &personas {
            let mut runtime = match Runtime::open(
                Store::memory().expect("memory store"),
                compiled.generation.clone(),
            ) {
                Ok(runtime) => runtime,
                Err(error) => {
                    return (
                        json!({ "status": "fail" }),
                        vec![json!({ "probe": "revocationWhileLive", "error": error })],
                        Vec::new(),
                    );
                }
            };
            if let Err(error) = runtime.seed(&rows) {
                return (
                    json!({ "status": "fail" }),
                    vec![json!({ "probe": "revocationWhileLive", "error": error })],
                    Vec::new(),
                );
            }
            let context = match derived_context(query, &args, persona, false) {
                Ok(context) => context,
                Err(_) => continue,
            };
            let (subscription, initial) = match runtime.subscribe(query_name, context.clone()) {
                Ok(value) => value,
                Err(_) => continue,
            };
            for input in initial
                .trace
                .rule_inputs
                .iter()
                .filter(|input| input.result && grant_tables.contains(&input.table))
            {
                saw_rule_input = true;
                let Some(row) = row_for_rule_input(&compiled.generation, &rows, input) else {
                    continue;
                };
                let Ok(id) = row.field("id").and_then(Value::as_str) else {
                    continue;
                };
                let program = Program {
                    name: "__snapback2.revoke".to_owned(),
                    kind: ProgramKind::Mutation,
                    args: BTreeMap::new(),
                    read_time_granularity_ms: None,
                    body: vec![Stmt::Delete {
                        table: input.table.clone(),
                        key: Expr::Literal(Value::Id(id.to_owned())),
                    }],
                };
                let before_seq = runtime.store().commit_seq().unwrap_or_default();
                let mutation_context = Context::mutation(
                    Actor::persona(persona).expect("derived persona"),
                    BTreeMap::new(),
                );
                let deleted = match runtime.execute_adhoc(&program, mutation_context) {
                    Ok(execution) => execution,
                    Err(error) => {
                        rejected.push(json!({ "table": input.table, "id": id, "error": error }));
                        continue;
                    }
                };
                if !matches!(deleted.state, ExecutionState::Committed { .. }) {
                    rejected
                        .push(json!({ "table": input.table, "id": id, "state": deleted.state }));
                    continue;
                }
                let commit = match runtime.store().commits_since(before_seq, 1) {
                    Ok(mut commits) if !commits.is_empty() => commits.remove(0),
                    value => {
                        return (
                            json!({ "status": "fail", "query": query_name }),
                            vec![json!({ "probe": "revocationWhileLive", "commits": value })],
                            Vec::new(),
                        );
                    }
                };
                let invalidated = runtime.invalidated(&commit);
                let deliveries = runtime.rerun(&invalidated);
                let delivery = deliveries
                    .iter()
                    .find(|delivery| delivery.id == subscription);
                let transitioned = delivery.is_some_and(|delivery| {
                    delivery.changed
                        && match &delivery.execution {
                            Ok(execution) => {
                                matches!(execution.state, ExecutionState::Denied { .. })
                                    || is_blank(&execution.result)
                            }
                            Err(error) => error.code() == "E_RULE",
                        }
                });
                if transitioned {
                    return (
                        json!({
                            "status": "pass",
                            "transport": "engineSubscription",
                            "query": query_name,
                            "principal": persona,
                            "deleted": { "table": input.table, "id": id },
                            "subscription": subscription,
                            "seq": commit.seq,
                            "delivery": delivery,
                        }),
                        Vec::new(),
                        Vec::new(),
                    );
                }
                rejected.push(json!({
                    "probe": "revocationWhileLive",
                    "query": query_name,
                    "deleted": { "table": input.table, "id": id },
                    "invalidated": invalidated,
                    "deliveries": deliveries,
                }));
                continue;
            }
        }
    }
    if saw_rule_input {
        let reason = "no rule-input row could be deleted by its running viewer";
        (
            json!({ "status": "blocked", "reason": reason, "rejected": rejected }),
            Vec::new(),
            vec![json!({ "probe": "revocationWhileLive", "reason": reason })],
        )
    } else {
        (
            json!({ "status": "notApplicable", "reason": "no live query has a seeded rule-input row" }),
            Vec::new(),
            Vec::new(),
        )
    }
}

fn direct_rule_input_tables(
    certificate: &Certificate,
    generation: &Generation,
) -> BTreeSet<String> {
    // @ref LLP 1002#7-test-and-the-receipt — the in-process revocation probe
    // deletes only direct application grant rows, never nested visibility data.
    fn collect(rule: &RuleExpr, tables: &mut BTreeSet<String>) {
        match rule {
            RuleExpr::Exists { table, .. } => {
                tables.insert(table.clone());
            }
            RuleExpr::And(rules) | RuleExpr::Or(rules) => {
                for rule in rules {
                    collect(rule, tables);
                }
            }
            RuleExpr::Not(rule) => collect(rule, tables),
            _ => {}
        }
    }

    let mut tables = BTreeSet::new();
    for site in &certificate.read_sites {
        if let Some(table) = generation.schema.tables.get(&site.table) {
            collect(&table.rules.read, &mut tables);
        }
    }
    tables
}

fn subscription_replan(
    compiled: &CompiledProject,
    seed: &SeedData,
) -> (Json, Vec<Json>, Vec<Json>) {
    let rows = match seed_rows(seed, compiled) {
        Ok(rows) => rows,
        Err(error) => {
            return (
                json!({ "status": "fail" }),
                vec![json!({ "probe": "subscriptionReplan", "error": error })],
                Vec::new(),
            );
        }
    };
    let personas = if seed.personas.is_empty() {
        vec!["alice".to_owned()]
    } else {
        seed.personas.clone()
    };
    let mut candidates = 0_u64;
    for (query_name, (query, certificate)) in &compiled.generation.programs {
        if query.kind != ProgramKind::Query {
            continue;
        }
        let args = match generated_args_at(query, seed, 0) {
            Ok(args) => args,
            Err(_) => continue,
        };
        for persona in &personas {
            for site in &certificate.read_sites {
                candidates += 1;
                let mut runtime = match Runtime::open(
                    Store::memory().expect("memory store"),
                    compiled.generation.clone(),
                ) {
                    Ok(runtime) => runtime,
                    Err(_) => continue,
                };
                if runtime.seed(&rows).is_err() {
                    continue;
                }
                let context = match derived_context(query, &args, persona, false) {
                    Ok(context) => context,
                    Err(_) => continue,
                };
                let (subscription_id, initial) =
                    match runtime.subscribe(query_name, context.clone()) {
                        Ok((id, execution))
                            if !matches!(execution.state, ExecutionState::Denied { .. })
                                && !is_blank(&execution.result) =>
                        {
                            (id, execution)
                        }
                        _ => continue,
                    };
                if !initial.trace.rows.iter().any(|row| row.table == site.table) {
                    continue;
                }
                let predecessor_schema_hash = runtime.generation().programs[query_name]
                    .1
                    .schema_hash
                    .clone();
                let mut project = compiled.project.clone();
                let Some(table) = project.schema.tables.get_mut(&site.table) else {
                    continue;
                };
                table.rules.read = RuleExpr::Deny;
                let next = match Generation::certify(&project, snapback2_core::Ceilings::default())
                {
                    Ok(next) => next,
                    Err(_) => continue,
                };
                let from = runtime.generation().hash.clone();
                let to = next.hash.clone();
                if runtime.apply_successor(next).is_err() {
                    continue;
                }
                let successor_schema_hash = runtime.generation().programs[query_name]
                    .1
                    .schema_hash
                    .clone();
                if predecessor_schema_hash == successor_schema_hash {
                    return (
                        json!({ "status": "fail", "query": query_name }),
                        vec![json!({
                            "probe": "subscriptionReplan",
                            "query": query_name,
                            "error": "policy successor retained the predecessor certificate hash",
                            "schemaHash": successor_schema_hash,
                        })],
                        Vec::new(),
                    );
                }
                let mut deliveries = runtime.rerun(&[subscription_id]);
                let delivery = deliveries.pop();
                match delivery.and_then(|delivery| delivery.execution.ok()) {
                    Some(execution)
                        if matches!(execution.state, ExecutionState::Denied { .. })
                            || is_blank(&execution.result) =>
                    {
                        let successor_verdict =
                            if matches!(execution.state, ExecutionState::Denied { .. }) {
                                "denied"
                            } else {
                                "blank"
                            };
                        return (
                            json!({
                                "status": "pass",
                                "disposition": "replanned",
                                "query": query_name,
                                "table": site.table,
                                "fromGeneration": from,
                                "toGeneration": to,
                                "certificateDisposition": "successorReplanned",
                                "predecessorObservedAtSubscribeSchemaHash": predecessor_schema_hash,
                                "successorRerunSchemaHash": successor_schema_hash,
                                "successorVerdict": successor_verdict,
                                "successorState": execution.state,
                                "successorResult": execution.result,
                            }),
                            Vec::new(),
                            Vec::new(),
                        );
                    }
                    execution => {
                        return (
                            json!({ "status": "fail", "query": query_name }),
                            vec![json!({
                                "probe": "subscriptionReplan",
                                "query": query_name,
                                "table": site.table,
                                "fromGeneration": from,
                                "toGeneration": to,
                                "error": "subscription rerun returned neither a successor denial nor a blank result",
                                "rerun": format!("{execution:?}"),
                                "predecessorObservedAtSubscribeSchemaHash": predecessor_schema_hash,
                                "successorRerunSchemaHash": successor_schema_hash,
                                "predecessorResult": initial.result,
                            })],
                            Vec::new(),
                        );
                    }
                }
            }
        }
    }
    (
        json!({ "status": "notApplicable", "reason": "no seeded visible query subscription", "candidates": candidates }),
        Vec::new(),
        Vec::new(),
    )
}

fn row_for_rule_input<'a>(
    generation: &Generation,
    rows: &'a [(String, Value)],
    input: &snapback2_core::RuleInputTrace,
) -> Option<&'a Value> {
    let table = generation.schema.tables.get(&input.table)?;
    let index = table.indexes.get(&input.index)?;
    rows.iter()
        .filter(|(table, _)| table == &input.table)
        .map(|(_, row)| row)
        .find(|row| {
            index
                .columns
                .iter()
                .zip(&input.key)
                .all(|(column, expected)| row.field(column).is_ok_and(|actual| actual == expected))
        })
}

fn derived_context(
    program: &Program,
    generated: &Json,
    persona: &str,
    mutation: bool,
) -> Result<Context, Refusal> {
    let mut args = BTreeMap::new();
    for (name, kind) in &program.args {
        let value = generated.get(name).cloned().unwrap_or(Json::Null);
        let value = if arg_is_id(kind) && value.as_str().is_some() {
            Value::Id(value.as_str().unwrap_or_default().to_owned())
        } else {
            json_to_value(&value)?
        };
        args.insert(name.clone(), value);
    }
    let context = if mutation {
        Context::mutation(Actor::persona(persona).expect("derived persona"), args)
    } else {
        Context::query(Actor::persona(persona).expect("derived persona"), args)
    };
    Ok(context)
}

fn is_blank(value: &Value) -> bool {
    match value {
        Value::Null => true,
        Value::Array(values) => values.is_empty(),
        _ => false,
    }
}

fn certificate_site_intersection(
    query: &Certificate,
    mutation: &Certificate,
    generation: &Generation,
) -> BTreeSet<(String, String)> {
    let reads = query
        .read_sites
        .iter()
        .map(|site| (site.table.clone(), site.index.clone()))
        .collect::<BTreeSet<_>>();
    let writes = mutation
        .write_sites
        .iter()
        .flat_map(|site| {
            generation
                .schema
                .tables
                .get(&site.table)
                .into_iter()
                .flat_map(move |table| {
                    table
                        .indexes
                        .keys()
                        .cloned()
                        .map(move |index| (site.table.clone(), index))
                })
        })
        .collect::<BTreeSet<_>>();
    reads.intersection(&writes).cloned().collect()
}

fn probe_args_align(query: &Json, mutation: &Json) -> bool {
    let Some(query) = query.as_object() else {
        return true;
    };
    let Some(mutation) = mutation.as_object() else {
        return true;
    };
    query
        .iter()
        .filter_map(|(name, value)| mutation.get(name).map(|other| (value, other)))
        .all(|(left, right)| left == right)
}

fn probe_args_diverge(query: &Json, mutation: &Json) -> bool {
    let Some(query) = query.as_object() else {
        return false;
    };
    let Some(mutation) = mutation.as_object() else {
        return false;
    };
    query
        .iter()
        .any(|(name, value)| mutation.get(name).is_some_and(|other| other != value))
}

fn invalidation_attempt(
    owner: &OwnerInfo,
    query: &str,
    query_args: &Json,
    mutation: &str,
    mutation_args: &Json,
    query_persona: &str,
    mutation_persona: &str,
    expect_delivery: bool,
) -> (bool, Option<Json>) {
    if let Err(error) = client::control(owner, "POST", "/control/reset", json!({})) {
        return (
            false,
            Some(
                json!({ "query": query, "mutation": mutation, "as": mutation_persona, "error": error }),
            ),
        );
    }
    let mut stream = match SseProbe::connect(owner, query, query_args.clone(), query_persona) {
        Ok(stream) => stream,
        Err(error) => {
            return (
                false,
                Some(
                    json!({ "query": query, "mutation": mutation, "as": mutation_persona, "error": error }),
                ),
            );
        }
    };
    if let Err(error) = stream.event(Duration::from_secs(2)) {
        return (
            false,
            Some(json!({
                "query": query,
                "mutation": mutation,
                "as": query_persona,
                "error": format!("initial SSE delivery missing: {error}"),
            })),
        );
    }
    let body = match client::api(
        owner,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", mutation_persona)],
        json!({ "op": mutation, "args": mutation_args }),
    ) {
        Ok(response) => response.body,
        Err(error) => {
            return (
                false,
                Some(
                    json!({ "query": query, "mutation": mutation, "as": mutation_persona, "error": error }),
                ),
            );
        }
    };
    if body.get("state").and_then(Json::as_str) != Some("committed") {
        return (false, None);
    }
    let expected_seq = body.get("seq").and_then(Json::as_u64);
    if expect_delivery {
        match stream.event(Duration::from_secs(2)) {
            Ok(delivery) if delivery.get("seq").and_then(Json::as_u64) == expected_seq => {
                (true, None)
            }
            delivery => (
                true,
                Some(json!({
                    "query": query,
                    "mutation": mutation,
                    "as": mutation_persona,
                    "expectedSeq": expected_seq,
                    "delivery": delivery.ok(),
                })),
            ),
        }
    } else {
        match stream.prove_silence(Duration::from_millis(250)) {
            Ok(()) => (true, None),
            Err(error) if error.delivery.is_some() => (
                true,
                Some(json!({
                    "query": query,
                    "mutation": mutation,
                    "as": mutation_persona,
                    "error": "non-intersecting committed mutation delivered",
                    "delivery": error.delivery,
                })),
            ),
            Err(error) => (
                true,
                Some(json!({
                    "query": query,
                    "mutation": mutation,
                    "as": mutation_persona,
                    "error": format!("silence probe stream failed: {}", error.message),
                })),
            ),
        }
    }
}

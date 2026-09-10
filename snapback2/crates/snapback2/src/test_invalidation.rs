//! Physical trace-key × touched-key oracle for served invalidation proofs.
// @ref LLP 1002#7-test-and-the-receipt — static intersections only prioritize
// candidates; retained authoritative traces and physical commit keys decide
// overlap, invalidation, delivery, or proven silence.

use super::{
    asset_probe_skip, elapsed_ms, generated_args_at, probe_candidates, program_has_asset_arguments,
    test_sse::SseProbe,
};
use crate::{
    client,
    owner::OwnerInfo,
    project::{CompiledProject, SeedData},
    protocol::{Refusal, json_to_value},
    receipt::CheckReceipt,
};
use serde_json::{Value as Json, json};
use snapback2_core::{
    ArgType, AuthoritativeTrace, Certificate, ColumnType, CommitRecord, Generation, Program,
    ProgramKind, RuleExpr, Value, decode_bytes_hex,
};
use std::collections::{BTreeMap, BTreeSet};
use std::time::{Duration, Instant};

pub(super) fn specialize_probe_args(
    program: &Program,
    seed: &SeedData,
    sample: usize,
    persona: &str,
    args: &mut Json,
) -> Result<(), String> {
    let object = args
        .as_object_mut()
        .ok_or_else(|| format!("generated args for {} were not an object", program.name))?;

    if let Some(table) = program.args.get("membershipId").and_then(ref_table) {
        let rows = seed.rows.get(table).map(Vec::as_slice).unwrap_or_default();
        let preferred = rows
            .iter()
            .filter(|row| row.get("role").and_then(Json::as_str) == Some("member"))
            .collect::<Vec<_>>();
        let candidates = if preferred.is_empty() {
            rows.iter().collect::<Vec<_>>()
        } else {
            preferred
        };
        if let Some(row) = candidates.get(sample % candidates.len().max(1)) {
            if let Some(id) = row.get("id") {
                object.insert("membershipId".to_owned(), id.clone());
            }
            if program.args.contains_key("conversationId") {
                if let Some(scope) = row.get("conversationId") {
                    object.insert("conversationId".to_owned(), scope.clone());
                }
            }
        }
    }

    let viewer = format!("dev:{persona}");
    let scope = object.get("conversationId").cloned();
    let occupied = scope
        .as_ref()
        .map(|scope| {
            seed.rows
                .values()
                .flatten()
                .filter(|row| row.get("conversationId") == Some(scope))
                .filter_map(|row| row.get("principal").and_then(Json::as_str))
                .collect::<BTreeSet<_>>()
        })
        .unwrap_or_default();
    let choose_principal = || {
        seed.personas
            .iter()
            .map(|candidate| format!("dev:{candidate}"))
            .find(|candidate| candidate != &viewer && !occupied.contains(candidate.as_str()))
            .or_else(|| {
                seed.personas
                    .iter()
                    .map(|candidate| format!("dev:{candidate}"))
                    .find(|candidate| candidate != &viewer)
            })
    };
    if program.args.get("recipientId").and_then(ref_table) == Some("profiles")
        && scope.is_some()
        && let Some(profile_id) = seed
            .rows
            .get("profiles")
            .into_iter()
            .flatten()
            .find_map(|row| {
                row.get("principal")
                    .and_then(Json::as_str)
                    .filter(|principal| occupied.contains(*principal))
                    .and_then(|_| row.get("id"))
                    .cloned()
            })
    {
        object.insert("recipientId".to_owned(), profile_id);
    }
    for (name, kind) in &program.args {
        match unwrap_optional(kind) {
            ArgType::Principal => {
                if let Some(principal) = choose_principal() {
                    object.insert(name.clone(), json!(principal));
                }
            }
            ArgType::List { of: Some(of), .. }
                if matches!(unwrap_optional(of), ArgType::Principal) =>
            {
                if let Some(principal) = choose_principal() {
                    object.insert(name.clone(), json!([principal]));
                }
            }
            _ => {}
        }
    }
    Ok(())
}

pub(super) fn affected_query_persona(
    program: &Program,
    seed: &SeedData,
    args: &Json,
    sites: &BTreeSet<(String, String)>,
    generation: &Generation,
) -> Option<String> {
    for (table_name, _) in sites {
        let table = generation.schema().tables.get(table_name)?;
        let principal_field = table.columns.iter().find_map(|(name, kind)| {
            matches!(kind, ColumnType::Principal).then_some(name.as_str())
        })?;
        let principal = program
            .args
            .iter()
            .find(|(_, kind)| ref_table(kind) == Some(table_name))
            .and_then(|(name, _)| args.get(name))
            .and_then(Json::as_str)
            .and_then(|id| {
                seed.rows.get(table_name)?.iter().find_map(|row| {
                    (row.get("id").and_then(Json::as_str) == Some(id))
                        .then(|| row.get(principal_field).and_then(Json::as_str))
                        .flatten()
                })
            })
            .or_else(|| args.get(principal_field).and_then(Json::as_str));
        if let Some(persona) = principal.and_then(|principal| principal.strip_prefix("dev:"))
            && seed.personas.iter().any(|seeded| seeded == persona)
        {
            return Some(persona.to_owned());
        }
    }
    None
}

pub(super) fn probe_args_align(query: &Json, mutation: &Json) -> bool {
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

pub(super) fn trace_write_count(trace: &Json) -> Result<u64, String> {
    let writes = trace
        .get("commit")
        .and_then(|commit| commit.get("writes"))
        .and_then(Json::as_object)
        .ok_or_else(|| format!("commit trace omitted its writes map: {trace}"))?;
    writes.values().try_fold(0_u64, |total, count| {
        count
            .as_u64()
            .and_then(|count| total.checked_add(count))
            .ok_or_else(|| format!("commit trace carried an invalid write count: {trace}"))
    })
}

fn served_trace(owner: &OwnerInfo, seq: u64) -> Result<Json, String> {
    let response = client::control(
        owner,
        "GET",
        &format!("/control/trace?seq={seq}"),
        json!({}),
    )
    .map_err(|error| format!("trace request failed: {error:?}"))?;
    if response.status != 200 {
        return Err(format!(
            "trace returned HTTP {}: {}",
            response.status, response.body
        ));
    }
    Ok(response.body)
}

#[derive(Clone, Debug)]
pub(super) struct QueryEvidence {
    result: Json,
    trace: AuthoritativeTrace,
    subscription_id: u64,
}

#[derive(Clone, Copy, Debug)]
pub(super) struct CommitEvidence {
    seq: u64,
    writes: u64,
    overlaps: bool,
    changed: bool,
    observed_invalidated: bool,
    observed_delivered: bool,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum ProbeRole {
    Pair,
    Silence,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum MutationDisposition {
    Committed,
    Rejected,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
struct TraceDisposition {
    await_delivery: bool,
    counts_as_probe: bool,
}

pub(super) fn physical_commit_evidence(
    owner: &OwnerInfo,
    response: &Json,
    before: &QueryEvidence,
    query: &str,
    query_args: &Json,
    query_persona: &str,
) -> Result<Option<CommitEvidence>, String> {
    let seq = response
        .get("seq")
        .and_then(Json::as_u64)
        .ok_or_else(|| format!("committed mutation omitted seq: {response}"))?;
    let trace = served_trace(owner, seq)?;
    let writes = trace_write_count(&trace)?;
    if writes == 0 {
        return Ok(None);
    }
    let commit = trace
        .get("commit")
        .cloned()
        .ok_or_else(|| format!("commit trace omitted commit data: {trace}"))
        .and_then(|commit| {
            serde_json::from_value::<CommitRecord>(commit)
                .map_err(|error| format!("commit trace was malformed: {error}: {trace}"))
        })?;
    let invalidated = trace
        .get("invalidated")
        .and_then(Json::as_array)
        .ok_or_else(|| format!("commit trace omitted invalidated subscriptions: {trace}"))?;
    let deliveries = trace
        .get("deliveries")
        .and_then(Json::as_array)
        .ok_or_else(|| format!("commit trace omitted deliveries: {trace}"))?;
    let invalidated_ids = invalidated
        .iter()
        .map(|id| {
            id.as_u64()
                .ok_or_else(|| format!("commit trace carried a malformed invalidation id: {trace}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    let delivery_ids = deliveries
        .iter()
        .map(|delivery| {
            delivery
                .get("id")
                .and_then(Json::as_u64)
                .ok_or_else(|| format!("commit trace carried a malformed delivery id: {trace}"))
        })
        .collect::<Result<Vec<_>, _>>()?;
    if invalidated_ids
        .iter()
        .chain(&delivery_ids)
        .any(|id| *id != before.subscription_id)
    {
        return Err(format!(
            "commit trace named an unexpected subscription after the isolated reset: {trace}"
        ));
    }
    if deliveries
        .iter()
        .any(|delivery| delivery.get("seq").and_then(Json::as_u64) != Some(seq))
    {
        return Err(format!(
            "commit trace carried a delivery at the wrong seq: {trace}"
        ));
    }
    let after = query_result(owner, query, query_args, query_persona)?;
    Ok(Some(CommitEvidence {
        seq,
        writes,
        overlaps: query_trace_intersects_commit(&before.trace, &commit),
        changed: normalized_result(&before.result) != normalized_result(&after),
        observed_invalidated: invalidated_ids.contains(&before.subscription_id),
        observed_delivered: delivery_ids.contains(&before.subscription_id),
    }))
}

fn trace_disposition(
    role: ProbeRole,
    static_sites_intersect: bool,
    evidence: CommitEvidence,
) -> Result<TraceDisposition, String> {
    if evidence.observed_delivered && !evidence.observed_invalidated {
        return Err("commit trace delivered a subscription it did not invalidate".to_owned());
    }
    if evidence.overlaps {
        if !evidence.observed_invalidated {
            return Err("authoritative query keys overlapped the commit, but the retained subscription was not invalidated".to_owned());
        }
        if evidence.changed != evidence.observed_delivered {
            return Err(if evidence.changed {
                "overlapping commit changed the query output without recording a delivery"
                    .to_owned()
            } else {
                "overlapping commit recorded a delivery for unchanged query output".to_owned()
            });
        }
    } else if evidence.observed_invalidated || evidence.observed_delivered {
        return Err(
            "authoritative query keys were disjoint from the commit, but the subscription was invalidated"
                .to_owned(),
        );
    }
    let requires_disjoint = role == ProbeRole::Silence || !static_sites_intersect;
    Ok(TraceDisposition {
        await_delivery: evidence.changed && evidence.overlaps,
        counts_as_probe: !requires_disjoint || !evidence.overlaps,
    })
}

pub(super) fn capture_query_evidence(
    owner: &OwnerInfo,
    query: &str,
    args: &Json,
    persona: &str,
    initial: &Json,
) -> Result<QueryEvidence, String> {
    let body = query_why(owner, query, args, persona)?;
    let subscriptions = body
        .get("subscriptions")
        .and_then(Json::as_array)
        .ok_or_else(|| format!("query oracle omitted matching subscriptions: {body}"))?;
    if subscriptions.len() != 1 {
        return Err(format!(
            "query oracle expected exactly one retained subscription, found {}: {body}",
            subscriptions.len()
        ));
    }
    let subscription_id = subscriptions[0]
        .get("id")
        .and_then(Json::as_u64)
        .ok_or_else(|| format!("retained subscription omitted its id: {body}"))?;
    let trace = subscriptions[0]
        .get("trace")
        .cloned()
        .ok_or_else(|| format!("retained subscription omitted its trace: {body}"))
        .and_then(|trace| {
            serde_json::from_value::<AuthoritativeTrace>(trace)
                .map_err(|error| format!("retained subscription trace was malformed: {error}"))
        })?;
    Ok(QueryEvidence {
        result: initial.clone(),
        trace,
        subscription_id,
    })
}

fn query_result(
    owner: &OwnerInfo,
    query: &str,
    args: &Json,
    persona: &str,
) -> Result<Json, String> {
    let body = query_why(owner, query, args, persona)?;
    body.get("result")
        .cloned()
        .ok_or_else(|| format!("query oracle omitted result: {body}"))
}

fn query_why(owner: &OwnerInfo, query: &str, args: &Json, persona: &str) -> Result<Json, String> {
    let response = client::control(
        owner,
        "POST",
        "/control/why",
        json!({ "op": query, "args": args, "as": persona }),
    )
    .map_err(|error| format!("query oracle failed: {error:?}"))?;
    if response.status != 200 {
        return Err(format!(
            "query oracle returned HTTP {}: {}",
            response.status, response.body
        ));
    }
    Ok(response.body)
}

fn normalized_result(result: &Json) -> Json {
    let mut normalized = result.clone();
    if let Some(object) = normalized.as_object_mut() {
        object.remove("seq");
    }
    normalized
}

fn query_trace_intersects_commit(query: &AuthoritativeTrace, commit: &CommitRecord) -> bool {
    if commit.scope_touches.iter().any(|touch| {
        query.ranges.iter().any(|range| {
            range.table == touch.table
                && range.index == touch.index
                && snapback2_core::search_key::scope_intersects(&touch.prefix, &range.prefix)
        }) || query
            .constraint_inputs
            .iter()
            .any(|c| c.table == touch.table)
    }) {
        return true;
    }

    for touched in &commit.touched {
        let range_overlap = query.ranges.iter().any(|range| {
            range.table == touched.table
                && range.index == touched.index
                && snapback2_core::search_key::scalar_key_starts_with(&touched.key, &range.prefix)
        });
        let point_overlap = query.points.iter().any(|point| {
            point.table == touched.table && point.index == touched.index && point.key == touched.key
        }) || query.rule_inputs.iter().any(|input| {
            input.table == touched.table && input.index == touched.index && input.key == touched.key
        });
        let absence_overlap = query.absences.iter().any(|(table, index, key)| {
            table == &touched.table && index == &touched.index && key == &touched.key
        });
        let constraint_overlap = query
            .constraint_inputs
            .iter()
            .any(|constraint| constraint.table == touched.table);
        if range_overlap || point_overlap || absence_overlap || constraint_overlap {
            return true;
        }
    }
    false
}

#[derive(Clone, Copy)]
struct AttemptMeta<'a> {
    query: &'a str,
    query_args: &'a Json,
    mutation: &'a str,
    mutation_args: &'a Json,
    query_persona: &'a str,
    mutation_persona: &'a str,
    role: ProbeRole,
    static_sites_intersect: bool,
}

#[derive(Debug)]
struct AttemptResult {
    selected: bool,
    evidence: Option<CommitEvidence>,
    failure: Option<Json>,
    outcome: Json,
}

fn role_name(role: ProbeRole) -> &'static str {
    match role {
        ProbeRole::Pair => "pair",
        ProbeRole::Silence => "silence",
    }
}

fn attempt_outcome(
    meta: AttemptMeta<'_>,
    disposition: &str,
    selected: bool,
    details: Json,
) -> Json {
    let mut outcome = json!({
        "query": meta.query,
        "queryArgs": meta.query_args,
        "queryPersona": meta.query_persona,
        "mutation": meta.mutation,
        "mutationArgs": meta.mutation_args,
        "mutationPersona": meta.mutation_persona,
        "probeRole": role_name(meta.role),
        "staticSitesIntersect": meta.static_sites_intersect,
        "disposition": disposition,
        "selected": selected,
    });
    if let (Some(outcome), Some(details)) = (outcome.as_object_mut(), details.as_object()) {
        outcome.extend(details.clone());
    }
    outcome
}

fn failed_attempt(meta: AttemptMeta<'_>, stage: &str, error: impl ToString) -> AttemptResult {
    let error = error.to_string();
    let failure = json!({
        "query": meta.query,
        "mutation": meta.mutation,
        "as": meta.mutation_persona,
        "stage": stage,
        "error": error,
    });
    AttemptResult {
        selected: false,
        evidence: None,
        failure: Some(failure),
        outcome: attempt_outcome(
            meta,
            "harness-error",
            false,
            json!({ "stage": stage, "error": error }),
        ),
    }
}

fn finish_invalidation_attempt(
    stream: &mut SseProbe,
    evidence: CommitEvidence,
    meta: AttemptMeta<'_>,
) -> AttemptResult {
    let disposition = match trace_disposition(meta.role, meta.static_sites_intersect, evidence) {
        Ok(disposition) => disposition,
        Err(error) => {
            let mut result = failed_attempt(meta, "oracle", &error);
            result.evidence = Some(evidence);
            result.outcome = attempt_outcome(
                meta,
                "physical",
                false,
                physical_outcome_details(evidence, meta.static_sites_intersect, None, Some(error)),
            );
            return result;
        }
    };
    let (sse_delivery, stream_error) = if disposition.await_delivery {
        match stream.event(Duration::from_secs(2)) {
            Ok(delivery) if delivery.get("seq").and_then(Json::as_u64) == Some(evidence.seq) => {
                (Some(delivery), None)
            }
            Ok(delivery) => (
                Some(delivery.clone()),
                Some(format!(
                    "expected SSE delivery at seq {}, received {}",
                    evidence.seq, delivery
                )),
            ),
            Err(error) => (None, Some(format!("expected SSE delivery: {error}"))),
        }
    } else {
        match stream.prove_silence(Duration::from_millis(250)) {
            Ok(()) => (None, None),
            Err(error) if error.delivery.is_some() => (
                error.delivery,
                Some("trace-declared silence delivered an SSE event".to_owned()),
            ),
            Err(error) => (
                None,
                Some(format!("silence probe stream failed: {}", error.message)),
            ),
        }
    };
    let selected = disposition.counts_as_probe && stream_error.is_none();
    let failure = stream_error.as_ref().map(|error| {
        json!({
            "query": meta.query,
            "mutation": meta.mutation,
            "as": meta.mutation_persona,
            "expectedSeq": evidence.seq,
            "error": error,
            "delivery": sse_delivery,
        })
    });
    AttemptResult {
        selected,
        evidence: Some(evidence),
        failure,
        outcome: attempt_outcome(
            meta,
            "physical",
            selected,
            physical_outcome_details(
                evidence,
                meta.static_sites_intersect,
                sse_delivery,
                stream_error,
            ),
        ),
    }
}

fn physical_outcome_details(
    evidence: CommitEvidence,
    static_sites_intersect: bool,
    sse_delivery: Option<Json>,
    error: Option<String>,
) -> Json {
    json!({
        "seq": evidence.seq,
        "writes": evidence.writes,
        "overlaps": evidence.overlaps,
        "staticConcreteMismatch": static_sites_intersect != evidence.overlaps,
        "changed": evidence.changed,
        "invalidated": evidence.observed_invalidated,
        "delivered": evidence.observed_delivered,
        "sseDelivered": sse_delivery.is_some(),
        "sseSeq": sse_delivery.as_ref().and_then(|delivery| delivery.get("seq")).cloned(),
        "error": error,
    })
}

pub(super) fn check(
    owner: &OwnerInfo,
    compiled: &CompiledProject,
    seed: &SeedData,
) -> CheckReceipt {
    let started = Instant::now();
    let mut failures = Vec::new();
    let mut blocked = Vec::new();
    let asset_mutations = compiled
        .generation
        .programs()
        .iter()
        .filter_map(|(name, (program, _))| {
            (program.kind == ProgramKind::Mutation && program_has_asset_arguments(program))
                .then_some(name.as_str())
        })
        .collect::<BTreeSet<_>>();
    let skipped = asset_mutations
        .iter()
        .map(|name| asset_probe_skip(name))
        .collect::<Vec<_>>();
    let mut outcomes = Vec::new();
    let mut intersections = Vec::new();
    let mut coverage = Vec::new();
    let mut attempts = 0_u64;
    let mut probes = 0_u64;
    let mut overlap_probes = 0_u64;
    let mut delivery_probes = 0_u64;
    let mut silence_probes = 0_u64;
    let mut exclusions = 0_u64;
    let system_targets = compiled
        .generation
        .effects()
        .values()
        .filter_map(|effect| effect.then.as_deref())
        .chain(compiled.generation.schema().schedules.iter().map(|schedule| schedule.target.as_str()))
        .collect::<BTreeSet<_>>();
    let default_persona = seed
        .personas
        .first()
        .cloned()
        .unwrap_or_else(|| "alice".to_owned());
    for (query_name, (query, query_certificate)) in compiled.generation.programs() {
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
        let mut query_has_silence = false;
        let mut query_has_generic_mutation = false;
        // One witnessed representative per certificate-intersection signature,
        // rather than repeating the same subscription proof for every operation.
        let mut required_groups = BTreeMap::new();
        let mut selected_groups = BTreeSet::new();
        let mut query_attempts = 0_u64;
        for (mutation_name, (mutation, mutation_certificate)) in compiled.generation.programs() {
            if mutation.kind != ProgramKind::Mutation {
                continue;
            }
            if asset_mutations.contains(mutation_name.as_str()) {
                continue;
            }
            let shared_sites = certificate_site_intersection(
                query_certificate,
                mutation_certificate,
                &compiled.generation,
            );
            let static_sites_intersect = !shared_sites.is_empty();
            if static_sites_intersect {
                intersections.push(json!({
                    "query": query_name,
                    "mutation": mutation_name,
                    "sites": shared_sites.iter().map(|(table, index)| json!({
                        "table": table,
                        "index": index,
                    })).collect::<Vec<_>>(),
                }));
            }
            if system_targets.contains(mutation_name.as_str()) {
                exclusions += 1;
                outcomes.push(json!({
                    "query": query_name,
                    "queryArgs": query_args,
                    "queryPersona": default_persona,
                    "mutation": mutation_name,
                    "mutationArgs": generated_args_at(mutation, seed, 0).ok(),
                    "mutationPersona": null,
                    "probeRole": "excluded",
                    "staticSitesIntersect": static_sites_intersect,
                    "disposition": "excluded",
                    "selected": false,
                    "reason": "system-only effect continuation or schedule target",
                }));
                continue;
            }
            query_has_generic_mutation = true;
            required_groups
                .entry(shared_sites.clone())
                .or_insert_with(Vec::new)
                .push(mutation_name.clone());
            if selected_groups.contains(&shared_sites) {
                continue;
            }
            let candidates = match probe_candidates(mutation, seed) {
                Ok(candidates) => candidates,
                Err(reason) => {
                    blocked.push(json!({
                        "query": query_name,
                        "mutation": mutation_name,
                        "reason": reason,
                    }));
                    continue;
                }
            };
            let mut ordered = candidates.iter().collect::<Vec<_>>();
            if static_sites_intersect {
                ordered.sort_by_key(|(_, args)| !probe_args_align(&query_args, args));
            }
            for (mutation_persona, mutation_args) in ordered {
                if query_attempts >= 32 {
                    break;
                }
                query_attempts += 1;
                attempts += 1;
                let query_persona = if static_sites_intersect {
                    affected_query_persona(
                        mutation,
                        seed,
                        mutation_args,
                        &shared_sites,
                        &compiled.generation,
                    )
                    .unwrap_or_else(|| default_persona.clone())
                } else {
                    default_persona.clone()
                };
                let result = invalidation_attempt(
                    owner,
                    &compiled.generation,
                    AttemptMeta {
                        query: query_name,
                        query_args: &query_args,
                        mutation: mutation_name,
                        mutation_args,
                        query_persona: &query_persona,
                        mutation_persona,
                        role: ProbeRole::Pair,
                        static_sites_intersect,
                    },
                );
                if let Some(evidence) = absorb_attempt(result, &mut outcomes, &mut failures) {
                    selected_groups.insert(shared_sites.clone());
                    count_probe(
                        evidence,
                        &mut probes,
                        &mut overlap_probes,
                        &mut delivery_probes,
                        &mut silence_probes,
                        &mut query_has_silence,
                    );
                    break;
                }
            }
        }
        for (sites, mutations) in &required_groups {
            coverage.push(json!({ "query": query_name, "sites": sites,
                "candidates": mutations, "witnessed": selected_groups.contains(sites) }));
            if !selected_groups.contains(sites) {
                blocked.push(json!({
                    "query": query_name, "mutations": mutations, "sites": sites,
                    "reason": if query_attempts >= 32 { "candidate attempt budget exhausted" }
                        else if sites.is_empty() { "no physical concrete-disjoint probe" }
                        else { "no physical committing probe" },
                }));
            }
        }
        if !query_has_silence && query_has_generic_mutation {
            let disjoint_persona = format!("__snapback2_disjoint_{}", query_name.replace('.', "_"));
            'fallback: for (mutation_name, (mutation, mutation_certificate)) in
                compiled.generation.programs()
            {
                if mutation.kind != ProgramKind::Mutation
                    || system_targets.contains(mutation_name.as_str())
                    || asset_mutations.contains(mutation_name.as_str())
                {
                    continue;
                }
                let shared_sites = certificate_site_intersection(
                    query_certificate,
                    mutation_certificate,
                    &compiled.generation,
                );
                let candidates = match probe_candidates(mutation, seed) {
                    Ok(candidates) => candidates,
                    Err(_) => continue,
                };
                for (mutation_persona, mutation_args) in &candidates {
                    if query_attempts >= 64 {
                        break 'fallback;
                    }
                    query_attempts += 1;
                    attempts += 1;
                    let result = invalidation_attempt(
                        owner,
                        &compiled.generation,
                        AttemptMeta {
                            query: query_name,
                            query_args: &query_args,
                            mutation: mutation_name,
                            mutation_args,
                            query_persona: &default_persona,
                            mutation_persona,
                            role: ProbeRole::Silence,
                            static_sites_intersect: !shared_sites.is_empty(),
                        },
                    );
                    if let Some(evidence) = absorb_attempt(result, &mut outcomes, &mut failures) {
                        count_probe(
                            evidence,
                            &mut probes,
                            &mut overlap_probes,
                            &mut delivery_probes,
                            &mut silence_probes,
                            &mut query_has_silence,
                        );
                        break 'fallback;
                    }
                }
                let mut mutation_args = match generated_args_at(mutation, seed, 0) {
                    Ok(args) => args,
                    Err(_) => continue,
                };
                if specialize_probe_args(mutation, seed, 0, &disjoint_persona, &mut mutation_args)
                    .is_err()
                {
                    continue;
                }
                if query_attempts >= 64 {
                    break 'fallback;
                }
                query_attempts += 1;
                attempts += 1;
                let result = invalidation_attempt(
                    owner,
                    &compiled.generation,
                    AttemptMeta {
                        query: query_name,
                        query_args: &query_args,
                        mutation: mutation_name,
                        mutation_args: &mutation_args,
                        query_persona: &default_persona,
                        mutation_persona: &disjoint_persona,
                        role: ProbeRole::Silence,
                        static_sites_intersect: !shared_sites.is_empty(),
                    },
                );
                if let Some(evidence) = absorb_attempt(result, &mut outcomes, &mut failures) {
                    count_probe(
                        evidence,
                        &mut probes,
                        &mut overlap_probes,
                        &mut delivery_probes,
                        &mut silence_probes,
                        &mut query_has_silence,
                    );
                    break 'fallback;
                }
            }
        }
        if !query_has_silence && query_has_generic_mutation {
            blocked.push(json!({
                "query": query_name,
                "reason": format!("no physical concrete-disjoint probe for {query_name}"),
            }));
        }
    }
    let detail = json!({
        "coverage": "one physical representative per query and certificate-intersection signature, plus concrete-disjoint silence per query; not every operation pair",
        "groups": coverage,
        "candidateLimit": 12,
        "attemptLimitPerQuery": 64,
        "probes": probes,
        "attempts": attempts,
        "overlapProbes": overlap_probes,
        "deliveryProbes": delivery_probes,
        "silenceProbes": silence_probes,
        "exclusions": exclusions,
        "transport": "SSE",
        "intersectionLevel": "exact authoritative trace key x commit touched key",
        "intersections": intersections,
        "outcomes": outcomes,
        "blocked": blocked,
        "skipped": skipped,
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

fn invalidation_attempt(owner: &OwnerInfo, generation: &Generation, meta: AttemptMeta<'_>) -> AttemptResult {
    match client::control(owner, "POST", "/control/reset", json!({})) {
        Ok(response) if response.status == 200 => {}
        Ok(response) => {
            return failed_attempt(
                meta,
                "reset",
                format!("HTTP {}: {}", response.status, response.body),
            );
        }
        Err(error) => return failed_attempt(meta, "reset", format!("{error:?}")),
    }
    // Native seed deliveries have owner-minted IDs, so authored seed arguments
    // cannot exercise the generated acknowledgement's physical receipt write.
    let mut mutation_args = meta.mutation_args.clone();
    if let Some((_, delivery)) = generation.programs().get(meta.mutation)
        .and_then(|(program, _)| snapback2_core::delivery::acknowledgement(generation.schema(), program))
    {
        let response = match client::control(owner, "POST", "/control/data", json!({
            "table": delivery.log, "index": "byRecipient", "prefix": [format!("dev:{}", meta.mutation_persona)],
            "limit": snapback2_core::delivery::ACK_BATCH, "as": meta.mutation_persona,
        })) {
            Ok(response) if response.status == 200 => response,
            Ok(response) => return failed_attempt(meta, "ack-events", format!("HTTP {}: {}", response.status, response.body)),
            Err(error) => return failed_attempt(meta, "ack-events", format!("{error:?}")),
        };
        mutation_args = json!({ "events": response.body["data"].as_array().into_iter().flatten()
            .filter_map(|row| row.get("id")).collect::<Vec<_>>() });
    }
    let meta = AttemptMeta { mutation_args: &mutation_args, ..meta };
    let mut stream = match SseProbe::connect(
        owner,
        meta.query,
        meta.query_args.clone(),
        meta.query_persona,
    ) {
        Ok(stream) => stream,
        Err(error) => return failed_attempt(meta, "subscribe", format!("{error:?}")),
    };
    let initial = match stream.event(Duration::from_secs(2)) {
        Ok(initial) => initial,
        Err(error) => return failed_attempt(meta, "initial-delivery", error),
    };
    let before = match capture_query_evidence(
        owner,
        meta.query,
        meta.query_args,
        meta.query_persona,
        &initial,
    ) {
        Ok(evidence) => evidence,
        Err(error) => return failed_attempt(meta, "retained-trace", error),
    };
    let response = match client::api(
        owner,
        "POST",
        "/api/mutation",
        &[("X-Snapback-As", meta.mutation_persona)],
        json!({ "op": meta.mutation, "args": meta.mutation_args }),
    ) {
        Ok(response) => response,
        Err(error) => return failed_attempt(meta, "mutation", format!("{error:?}")),
    };
    let body = response.body;
    let mutation_disposition = match classify_mutation_response(response.status, &body) {
        Ok(disposition) => disposition,
        Err(error) => return failed_attempt(meta, "mutation-protocol", error),
    };
    if mutation_disposition == MutationDisposition::Rejected {
        return AttemptResult {
            selected: false,
            evidence: None,
            failure: None,
            outcome: attempt_outcome(
                meta,
                "rejected",
                false,
                json!({
                    "responseState": body.get("state"),
                    "code": body.get("code"),
                    "family": body.get("family"),
                    "message": body.get("message"),
                    "rule": body.get("rule"),
                }),
            ),
        };
    }
    let evidence = match physical_commit_evidence(
        owner,
        &body,
        &before,
        meta.query,
        meta.query_args,
        meta.query_persona,
    ) {
        Ok(Some(evidence)) => evidence,
        Ok(None) => {
            return AttemptResult {
                selected: false,
                evidence: None,
                failure: None,
                outcome: attempt_outcome(
                    meta,
                    "no-write",
                    false,
                    json!({ "seq": body.get("seq") }),
                ),
            };
        }
        Err(error) => return failed_attempt(meta, "commit-evidence", error),
    };
    finish_invalidation_attempt(&mut stream, evidence, meta)
}

fn classify_mutation_response(status: u16, body: &Json) -> Result<MutationDisposition, String> {
    if status != 200 {
        return Err(format!("HTTP {status}: {body}"));
    }
    match body.get("state").and_then(Json::as_str) {
        Some("committed") => Ok(MutationDisposition::Committed),
        Some("rejected") => Ok(MutationDisposition::Rejected),
        _ => Err(format!(
            "HTTP 200 carried an untyped mutation state: {body}"
        )),
    }
}

fn absorb_attempt(
    result: AttemptResult,
    outcomes: &mut Vec<Json>,
    failures: &mut Vec<Json>,
) -> Option<CommitEvidence> {
    outcomes.push(result.outcome);
    if let Some(failure) = result.failure {
        failures.push(failure);
    }
    result.selected.then_some(result.evidence).flatten()
}

fn count_probe(
    evidence: CommitEvidence,
    probes: &mut u64,
    overlap_probes: &mut u64,
    delivery_probes: &mut u64,
    silence_probes: &mut u64,
    query_has_silence: &mut bool,
) {
    *probes += 1;
    if evidence.overlaps {
        *overlap_probes += 1;
    } else {
        *silence_probes += 1;
        *query_has_silence = true;
    }
    if evidence.observed_delivered {
        *delivery_probes += 1;
    }
}

pub(super) fn replay_arg_value(kind: &ArgType, value: &Json) -> Result<Value, Refusal> {
    match kind {
        ArgType::Cursor => value
            .as_str()
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| Refusal::input("cursor arguments must be strings", "pass next")),
        ArgType::Optional(_) if value.is_null() => Ok(Value::Null),
        ArgType::Optional(inner) => replay_arg_value(inner, value),
        ArgType::Id | ArgType::Principal | ArgType::Ref { .. } => value
            .as_str()
            .map(|value| Value::Id(value.to_owned()))
            .ok_or_else(|| Refusal::input("id arguments must be strings", "pass a string id")),
        ArgType::List { of, .. } => value
            .as_array()
            .ok_or_else(|| Refusal::input("list arguments must be arrays", "pass a JSON array"))?
            .iter()
            .map(|value| match of {
                Some(of) => replay_arg_value(of, value),
                None => json_to_value(value),
            })
            .collect::<Result<Vec<_>, _>>()
            .map(Value::Array),
        ArgType::Int | ArgType::Time | ArgType::Decimal { .. } | ArgType::Money { .. } => value
            .as_i64()
            .map(Value::Int)
            .ok_or_else(|| Refusal::input("numeric arguments must be integers", "pass an integer")),
        ArgType::Text { .. } | ArgType::Enum { .. } => value
            .as_str()
            .map(|value| Value::String(value.to_owned()))
            .ok_or_else(|| Refusal::input("text arguments must be strings", "pass a string")),
        ArgType::Bytes { .. } => value
            .as_object()
            .filter(|value| value.len() == 1)
            .and_then(|value| value.get("Bytes"))
            .and_then(Json::as_str)
            .and_then(decode_bytes_hex)
            .map(Value::Bytes)
            .ok_or_else(|| {
                Refusal::input(
                    "bytes arguments must be canonical lowercase hex",
                    "pass { Bytes: \"00\" } with an even number of lowercase hex digits",
                )
            }),
        ArgType::Image { .. } | ArgType::Video { .. } => json_to_value(value),
        ArgType::Bool => value.as_bool().map(Value::Bool).ok_or_else(|| {
            Refusal::input("boolean arguments must be true or false", "pass a boolean")
        }),
        ArgType::Json { .. } | ArgType::Scalar => json_to_value(value),
    }
}

fn ref_table(kind: &ArgType) -> Option<&str> {
    match unwrap_optional(kind) {
        ArgType::Ref { table } => Some(table),
        _ => None,
    }
}

pub(super) fn unwrap_optional(mut kind: &ArgType) -> &ArgType {
    while let ArgType::Optional(inner) = kind {
        kind = inner;
    }
    kind
}

pub(super) fn certificate_site_intersection(
    query: &Certificate,
    mutation: &Certificate,
    generation: &Generation,
) -> BTreeSet<(String, String)> {
    let direct_reads = query
        .read_sites
        .iter()
        .map(|site| (site.table.clone(), site.index.clone()))
        .collect::<BTreeSet<_>>();
    let mut rule_reads = BTreeSet::new();
    for site in &query.read_sites {
        if let Some(table) = generation.schema().tables.get(&site.table) {
            collect_rule_reads(&table.rules.read, &mut rule_reads);
        }
    }
    let reads = direct_reads
        .union(&rule_reads)
        .cloned()
        .collect::<BTreeSet<_>>();
    let writes = mutation
        .write_sites
        .iter()
        .flat_map(|site| {
            generation
                .schema()
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

fn collect_rule_reads(rule: &RuleExpr, reads: &mut BTreeSet<(String, String)>) {
    match rule {
        // Both rule forms perform one indexed point read that can invalidate a query.
        RuleExpr::Exists { table, index, .. } | RuleExpr::Created { table, index, .. } => {
            reads.insert((table.clone(), index.clone()));
        }
        RuleExpr::And(rules) | RuleExpr::Or(rules) => {
            for rule in rules {
                collect_rule_reads(rule, reads);
            }
        }
        RuleExpr::Not(rule) => collect_rule_reads(rule, reads),
        RuleExpr::Public { .. }
        | RuleExpr::Allow
        | RuleExpr::Deny
        | RuleExpr::Eq(_, _)
        | RuleExpr::Ne(_, _) => {}
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use snapback2_core::{KeyProvenance, ProgramKind, RuleInputTrace, TouchedKey};
    use std::collections::BTreeMap;

    #[test]
    fn created_rule_points_participate_in_static_invalidation_intersections() {
        let mut reads = BTreeSet::new();
        collect_rule_reads(
            &RuleExpr::Created {
                table: "conversations".to_owned(),
                index: "byIdCreator".to_owned(),
                key: Vec::new(),
                provenance: KeyProvenance::Shape,
            },
            &mut reads,
        );
        assert_eq!(
            reads,
            BTreeSet::from([("conversations".to_owned(), "byIdCreator".to_owned())])
        );
    }

    #[test]
    fn membership_probe_args_bind_scope_to_a_member_incarnation() {
        let program = Program {
            name: "groups.memberPromote".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::from([
                (
                    "conversationId".to_owned(),
                    ArgType::Ref {
                        table: "conversations".to_owned(),
                    },
                ),
                (
                    "membershipId".to_owned(),
                    ArgType::Ref {
                        table: "memberships".to_owned(),
                    },
                ),
            ]),
            read_time_granularity_ms: None,
            body: Vec::new(),
        };
        let seed = SeedData {
            personas: vec!["alice".to_owned(), "bob".to_owned()],
            rows: BTreeMap::from([(
                "memberships".to_owned(),
                vec![
                    json!({ "id": "admin", "conversationId": "conversation-2", "principal": "dev:alice", "role": "admin" }),
                    json!({ "id": "member", "conversationId": "conversation-1", "principal": "dev:bob", "role": "member" }),
                ],
            )]),
        };
        let mut args = json!({
            "conversationId": "conversation-2",
            "membershipId": "admin",
        });
        specialize_probe_args(&program, &seed, 0, "alice", &mut args).unwrap();
        assert_eq!(args["membershipId"], "member");
        assert_eq!(args["conversationId"], "conversation-1");
    }

    #[test]
    fn principal_probe_args_choose_a_non_viewer_absent_from_scope() {
        let program = Program {
            name: "groups.memberAdd".to_owned(),
            kind: ProgramKind::Mutation,
            args: BTreeMap::from([
                (
                    "conversationId".to_owned(),
                    ArgType::Ref {
                        table: "conversations".to_owned(),
                    },
                ),
                ("principal".to_owned(), ArgType::Principal),
                (
                    "members".to_owned(),
                    ArgType::List {
                        of: Some(Box::new(ArgType::Principal)),
                        max: 4,
                    },
                ),
            ]),
            read_time_granularity_ms: None,
            body: Vec::new(),
        };
        let seed = SeedData {
            personas: vec!["alice".to_owned(), "bob".to_owned(), "charlie".to_owned()],
            rows: BTreeMap::from([(
                "memberships".to_owned(),
                vec![
                    json!({ "conversationId": "conversation-1", "principal": "dev:alice" }),
                    json!({ "conversationId": "conversation-1", "principal": "dev:bob" }),
                ],
            )]),
        };
        let mut args = json!({
            "conversationId": "conversation-1",
            "principal": "dev:alice",
            "members": [],
        });
        specialize_probe_args(&program, &seed, 0, "alice", &mut args).unwrap();
        assert_eq!(args["principal"], "dev:charlie");
        assert_eq!(args["members"], json!(["dev:charlie"]));
    }

    #[test]
    fn commit_trace_counts_only_physical_writes() {
        assert_eq!(
            trace_write_count(&json!({ "commit": { "writes": {} } })).unwrap(),
            0
        );
        assert_eq!(
            trace_write_count(&json!({ "commit": { "writes": { "posts": 2, "profiles": 1 } } }))
                .unwrap(),
            3
        );
        assert!(trace_write_count(&json!({ "commit": {} })).is_err());
    }

    #[test]
    fn only_typed_http_200_rejections_are_skippable_candidates() {
        assert_eq!(
            classify_mutation_response(200, &json!({ "state": "rejected" })).unwrap(),
            MutationDisposition::Rejected
        );
        assert_eq!(
            classify_mutation_response(200, &json!({ "state": "committed", "seq": 2 })).unwrap(),
            MutationDisposition::Committed
        );
        assert!(classify_mutation_response(500, &json!({ "state": "rejected" })).is_err());
        assert!(classify_mutation_response(200, &json!({ "state": "refused" })).is_err());
    }

    #[test]
    fn physical_probe_selection_never_uses_observed_invalidation_as_its_oracle() {
        let evidence = |overlaps, changed, invalidated, delivered| CommitEvidence {
            seq: 2,
            writes: 1,
            overlaps,
            changed,
            observed_invalidated: invalidated,
            observed_delivered: delivered,
        };
        assert!(
            trace_disposition(ProbeRole::Pair, true, evidence(true, true, false, false)).is_err()
        );
        assert_eq!(
            trace_disposition(ProbeRole::Pair, true, evidence(false, false, false, false)).unwrap(),
            TraceDisposition {
                await_delivery: false,
                counts_as_probe: true,
            }
        );
        assert_eq!(
            trace_disposition(ProbeRole::Pair, true, evidence(true, false, true, false)).unwrap(),
            TraceDisposition {
                await_delivery: false,
                counts_as_probe: true,
            }
        );
        assert_eq!(
            trace_disposition(ProbeRole::Pair, true, evidence(true, true, true, true)).unwrap(),
            TraceDisposition {
                await_delivery: true,
                counts_as_probe: true,
            }
        );
        assert_eq!(
            trace_disposition(ProbeRole::Pair, false, evidence(false, false, false, false))
                .unwrap(),
            TraceDisposition {
                await_delivery: false,
                counts_as_probe: true,
            }
        );
        assert_eq!(
            trace_disposition(ProbeRole::Pair, false, evidence(true, true, true, true)).unwrap(),
            TraceDisposition {
                await_delivery: true,
                counts_as_probe: false,
            }
        );
        assert_eq!(
            trace_disposition(ProbeRole::Silence, true, evidence(true, false, true, false))
                .unwrap(),
            TraceDisposition {
                await_delivery: false,
                counts_as_probe: false,
            }
        );
        assert!(
            trace_disposition(ProbeRole::Pair, false, evidence(false, false, true, false)).is_err()
        );
    }

    #[test]
    fn query_trace_commit_oracle_matches_exact_rule_keys_not_ledger_outcome() {
        let mut query = AuthoritativeTrace::default();
        query.rule_inputs.push(RuleInputTrace {
            rule_hash: "rule".to_owned(),
            table: "memberships".to_owned(),
            index: "byConversationPrincipal".to_owned(),
            key: vec![
                Value::Id("conversation-1".to_owned()),
                Value::Id("dev:bob".to_owned()),
            ],
            result: true,
            hidden: false,
            pinned_inputs_digest: "pinned".to_owned(),
        });
        let touched = |principal: &str| CommitRecord {
            scope_touches: vec![],
            job: None,
            job_chunk: None,
            schedule: None,
            by: None,
            seq: 2,
            at: 1,
            program: "groups.memberAdd".to_owned(),
            principal: "dev:alice".to_owned(),
            kind: "mutation".to_owned(),
            touched: vec![TouchedKey {
                table: "memberships".to_owned(),
                index: "byConversationPrincipal".to_owned(),
                key: vec![
                    Value::Id("conversation-1".to_owned()),
                    Value::Id(principal.to_owned()),
                ],
                row_id: "membership".to_owned(),
            }],
            writes: Default::default(),
            emits: 0,
        };
        assert!(query_trace_intersects_commit(&query, &touched("dev:bob")));
        assert!(!query_trace_intersects_commit(
            &query,
            &touched("dev:charlie")
        ));
    }
}

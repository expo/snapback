//! Rust arm of the Draft-bound LLP 0070 transition-model checkpoint.
//!
//! This test has no product-runtime import path and proves no storage,
//! durability, worker, or target capability. It independently consumes the
//! same committed corpus as `tests/durable_work_protocol_v0.mjs`.
//!
//! @ref LLP 0070#state-machine — exhaustive legal edges, CAS/fence guards,
//!   cancellation precedence, reclaim supersession, and terminal immutability.
//! @ref LLP 0070#acceptance — a shared corpus exercised by multiple language
//!   arms is an input to, not a substitute for, target-specific fault evidence.

use serde::Deserialize;
use std::collections::{BTreeMap, BTreeSet};

const CORPUS: &str = include_str!("conformance/durable-work-state-machine-v0.json");
const CAS_STALE: &str = "SNAPBACK_JOB_CAS_STALE";
const CLAIM_STALE: &str = "SNAPBACK_JOB_CLAIM_STALE";
const TRANSITION_INVALID: &str = "SNAPBACK_JOB_TRANSITION_INVALID";

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Corpus {
    version: String,
    rfc: String,
    claim_class: String,
    states: Vec<String>,
    terminal_states: Vec<String>,
    events: Vec<String>,
    transitions: Vec<Transition>,
    guard_vectors: Vec<GuardVector>,
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "camelCase")]
struct Transition {
    current: String,
    event: String,
    next: String,
    claim_guard: bool,
    attempt_delta: u64,
    fence_delta: u64,
    slot: String,
    attempt_disposition: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GuardVector {
    name: String,
    state: String,
    event: String,
    #[serde(rename = "override")]
    override_values: GuardOverride,
    code: String,
}

#[derive(Debug, Default, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GuardOverride {
    state_version: Option<u64>,
    target_incarnation: Option<String>,
    restore_epoch: Option<u64>,
    execution_domain: Option<String>,
    claim_id: Option<String>,
    fence: Option<u64>,
}

#[derive(Clone, Debug, Eq, PartialEq)]
struct ModelState {
    state: String,
    state_version: u64,
    attempt: u64,
    fence: u64,
    claim_id: Option<String>,
    slot_owner: Option<String>,
    target_incarnation: String,
    restore_epoch: u64,
    execution_domain: String,
}

#[derive(Clone, Debug)]
struct Guard {
    state_version: u64,
    target_incarnation: String,
    restore_epoch: u64,
    execution_domain: String,
    claim_id: Option<String>,
    fence: u64,
}

fn corpus() -> Corpus {
    serde_json::from_str(CORPUS).expect("durable-work corpus parses")
}

fn table(corpus: &Corpus) -> BTreeMap<(String, String), Transition> {
    corpus
        .transitions
        .iter()
        .cloned()
        .map(|transition| {
            (
                (transition.current.clone(), transition.event.clone()),
                transition,
            )
        })
        .collect()
}

fn state_for(state: &str) -> ModelState {
    let claimed = matches!(state, "claimed" | "cancelRequested");
    ModelState {
        state: state.to_owned(),
        state_version: 7,
        attempt: 2,
        fence: 2,
        claim_id: claimed.then(|| "claim-2".to_owned()),
        slot_owner: claimed.then(|| "claim-2".to_owned()),
        target_incarnation: "target-a".to_owned(),
        restore_epoch: 4,
        execution_domain: "domain-a".to_owned(),
    }
}

fn guard_for(state: &ModelState) -> Guard {
    Guard {
        state_version: state.state_version,
        target_incarnation: state.target_incarnation.clone(),
        restore_epoch: state.restore_epoch,
        execution_domain: state.execution_domain.clone(),
        claim_id: state.claim_id.clone(),
        fence: state.fence,
    }
}

fn apply_override(guard: &mut Guard, values: &GuardOverride) {
    if let Some(value) = values.state_version {
        guard.state_version = value;
    }
    if let Some(value) = &values.target_incarnation {
        guard.target_incarnation = value.clone();
    }
    if let Some(value) = values.restore_epoch {
        guard.restore_epoch = value;
    }
    if let Some(value) = &values.execution_domain {
        guard.execution_domain = value.clone();
    }
    if let Some(value) = &values.claim_id {
        guard.claim_id = Some(value.clone());
    }
    if let Some(value) = values.fence {
        guard.fence = value;
    }
}

fn apply_transition(
    table: &BTreeMap<(String, String), Transition>,
    state: &ModelState,
    event: &str,
    guard: &Guard,
    next_claim_id: &str,
) -> Result<(ModelState, Transition), &'static str> {
    if guard.state_version != state.state_version
        || guard.target_incarnation != state.target_incarnation
        || guard.restore_epoch != state.restore_epoch
        || guard.execution_domain != state.execution_domain
    {
        return Err(CAS_STALE);
    }

    let transition = table
        .get(&(state.state.clone(), event.to_owned()))
        .ok_or(TRANSITION_INVALID)?
        .clone();
    if transition.claim_guard && (guard.claim_id != state.claim_id || guard.fence != state.fence) {
        return Err(CLAIM_STALE);
    }

    let mut next = state.clone();
    next.state = transition.next.clone();
    next.state_version += 1;
    next.attempt += transition.attempt_delta;
    next.fence += transition.fence_delta;
    match transition.slot.as_str() {
        "acquire" | "transfer" => {
            next.claim_id = Some(next_claim_id.to_owned());
            next.slot_owner = Some(next_claim_id.to_owned());
        }
        "retain" => {}
        "release" | "none" => {
            next.claim_id = None;
            next.slot_owner = None;
        }
        _ => panic!("unknown slot action {}", transition.slot),
    }
    Ok((next, transition))
}

#[test]
fn corpus_is_explicitly_draft_bound_and_internally_complete() {
    let corpus = corpus();
    assert_eq!(corpus.version, "durable-work-state-machine-v0");
    assert_eq!(corpus.rfc, "LLP 0070");
    assert_eq!(corpus.claim_class, "draft-nonclaim");
    assert_eq!(
        corpus.states.iter().collect::<BTreeSet<_>>().len(),
        corpus.states.len()
    );
    assert_eq!(
        corpus.events.iter().collect::<BTreeSet<_>>().len(),
        corpus.events.len()
    );
    assert_eq!(table(&corpus).len(), corpus.transitions.len());
    for terminal in corpus.terminal_states {
        assert!(corpus.states.contains(&terminal));
    }
}

#[test]
fn every_admitted_transition_applies_its_version_attempt_fence_and_slot_rule() {
    let corpus = corpus();
    let table = table(&corpus);
    for expected in &corpus.transitions {
        let before = state_for(&expected.current);
        let (next, observed) = apply_transition(
            &table,
            &before,
            &expected.event,
            &guard_for(&before),
            "claim-next",
        )
        .expect("listed transition is admitted");
        assert_eq!(&observed, expected);
        assert_eq!(next.state, expected.next);
        assert_eq!(next.state_version, before.state_version + 1);
        assert_eq!(next.attempt, before.attempt + expected.attempt_delta);
        assert_eq!(next.fence, before.fence + expected.fence_delta);
        match expected.slot.as_str() {
            "acquire" | "transfer" => {
                assert_eq!(next.claim_id.as_deref(), Some("claim-next"));
                assert_eq!(next.slot_owner.as_deref(), Some("claim-next"));
            }
            "retain" => {
                assert_eq!(next.claim_id, before.claim_id);
                assert_eq!(next.slot_owner, before.slot_owner);
            }
            "release" | "none" => {
                assert_eq!(next.claim_id, None);
                assert_eq!(next.slot_owner, None);
            }
            _ => unreachable!(),
        }
    }
}

#[test]
fn full_state_event_cross_product_rejects_every_unspecified_edge() {
    let corpus = corpus();
    let table = table(&corpus);
    let mut rejected = 0;
    for state_name in &corpus.states {
        for event in &corpus.events {
            if table.contains_key(&(state_name.clone(), event.clone())) {
                continue;
            }
            let before = state_for(state_name);
            assert_eq!(
                apply_transition(&table, &before, event, &guard_for(&before), "claim-next"),
                Err(TRANSITION_INVALID),
                "{state_name} + {event}"
            );
            rejected += 1;
        }
    }
    assert_eq!(
        rejected,
        corpus.states.len() * corpus.events.len() - corpus.transitions.len()
    );
}

#[test]
fn all_cas_and_claim_guard_vectors_fail_closed() {
    let corpus = corpus();
    let table = table(&corpus);
    for vector in corpus.guard_vectors {
        let before = state_for(&vector.state);
        let mut guard = guard_for(&before);
        apply_override(&mut guard, &vector.override_values);
        assert_eq!(
            apply_transition(&table, &before, &vector.event, &guard, "claim-next"),
            Err(vector.code.as_str()),
            "{}",
            vector.name
        );
    }
}

#[test]
fn success_proven_after_cancellation_request_wins_and_releases_slot() {
    let corpus = corpus();
    let table = table(&corpus);
    let claimed = state_for("claimed");
    let (cancel_requested, _) = apply_transition(
        &table,
        &claimed,
        "requestCancel",
        &guard_for(&claimed),
        "unused",
    )
    .unwrap();
    assert_eq!(cancel_requested.state, "cancelRequested");
    assert_eq!(cancel_requested.slot_owner.as_deref(), Some("claim-2"));

    let (succeeded, _) = apply_transition(
        &table,
        &cancel_requested,
        "terminalSucceeded",
        &guard_for(&cancel_requested),
        "unused",
    )
    .unwrap();
    assert_eq!(succeeded.state, "succeeded");
    assert_eq!(succeeded.state_version, 9);
    assert_eq!(succeeded.slot_owner, None);
}

#[test]
fn reclaim_supersedes_atomically_and_predecessor_fence_cannot_publish() {
    let corpus = corpus();
    let table = table(&corpus);
    let claimed = state_for("claimed");
    let predecessor_guard = guard_for(&claimed);
    let (successor, _) =
        apply_transition(&table, &claimed, "reclaim", &predecessor_guard, "claim-3").unwrap();
    assert_eq!(successor.state, "claimed");
    assert_eq!(successor.attempt, 3);
    assert_eq!(successor.fence, 3);
    assert_eq!(successor.slot_owner.as_deref(), Some("claim-3"));
    assert_eq!(
        apply_transition(
            &table,
            &successor,
            "terminalSucceeded",
            &predecessor_guard,
            "unused",
        ),
        Err(CAS_STALE)
    );
}

#[test]
fn terminal_states_never_reopen() {
    let corpus = corpus();
    let table = table(&corpus);
    for terminal in &corpus.terminal_states {
        for event in &corpus.events {
            let before = state_for(terminal);
            assert_eq!(
                apply_transition(&table, &before, event, &guard_for(&before), "unused"),
                Err(TRANSITION_INVALID)
            );
        }
    }
}

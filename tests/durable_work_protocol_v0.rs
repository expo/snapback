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

use hmac::{Hmac, Mac};
use serde::Deserialize;
use sha2::Sha256;
use std::collections::{BTreeMap, BTreeSet};

const CORPUS: &str = include_str!("conformance/durable-work-state-machine-v0.json");
const CAS_STALE: &str = "SNAPBACK_JOB_CAS_STALE";
const CLAIM_STALE: &str = "SNAPBACK_JOB_CLAIM_STALE";
const TRANSITION_INVALID: &str = "SNAPBACK_JOB_TRANSITION_INVALID";
const MAX_PORTABLE_INTEGER: u64 = 9_007_199_254_740_991;

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
    jitter_vectors: Vec<JitterVector>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JitterVector {
    name: String,
    job_id_hex: String,
    attempt: u32,
    base_delay_ms: u64,
    max_delay_ms: u64,
    server_now_ms: u64,
    message_hex: String,
    mac_hex: String,
    first64: String,
    low_ms: u64,
    high_ms: u64,
    uncapped_delay_ms: u64,
    delay_ms: u64,
    available_at_ms: String,
}

#[derive(Debug, Eq, PartialEq)]
struct JitterResult {
    message_hex: String,
    mac_hex: String,
    first64: String,
    low_ms: u64,
    high_ms: u64,
    uncapped_delay_ms: u64,
    delay_ms: u64,
    available_at_ms: String,
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

fn decode_hex(value: &str) -> Result<Vec<u8>, &'static str> {
    if value.is_empty() || value.len() % 2 != 0 {
        return Err("SNAPBACK_JOB_JITTER_INVALID");
    }
    value
        .as_bytes()
        .chunks_exact(2)
        .map(|pair| {
            let text = std::str::from_utf8(pair).map_err(|_| "SNAPBACK_JOB_JITTER_INVALID")?;
            u8::from_str_radix(text, 16).map_err(|_| "SNAPBACK_JOB_JITTER_INVALID")
        })
        .collect()
}

fn encode_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn jitter_v1(vector: &JitterVector) -> Result<JitterResult, &'static str> {
    if vector.attempt == 0
        || vector.base_delay_ms > MAX_PORTABLE_INTEGER
        || vector.max_delay_ms > MAX_PORTABLE_INTEGER
        || vector.server_now_ms > MAX_PORTABLE_INTEGER
    {
        return Err("SNAPBACK_JOB_JITTER_INVALID");
    }
    let job_id = decode_hex(&vector.job_id_hex)?;
    let label = b"retry-jitter-v1";
    let attempt = vector.attempt.to_be_bytes();
    let mut message = Vec::with_capacity(4 + label.len() + 4 + attempt.len());
    message.extend_from_slice(&(label.len() as u32).to_be_bytes());
    message.extend_from_slice(label);
    message.extend_from_slice(&(attempt.len() as u32).to_be_bytes());
    message.extend_from_slice(&attempt);

    let mut hmac =
        Hmac::<Sha256>::new_from_slice(&job_id).map_err(|_| "SNAPBACK_JOB_JITTER_INVALID")?;
    hmac.update(&message);
    let mac = hmac.finalize().into_bytes();
    let first64 = u64::from_be_bytes(mac[..8].try_into().expect("eight digest bytes"));
    let low = vector
        .base_delay_ms
        .checked_mul(3)
        .ok_or("SNAPBACK_JOB_JITTER_OVERFLOW")?
        / 4;
    let high = vector
        .base_delay_ms
        .checked_mul(5)
        .ok_or("SNAPBACK_JOB_JITTER_OVERFLOW")?
        / 4;
    let span = high
        .checked_sub(low)
        .and_then(|range| range.checked_add(1))
        .ok_or("SNAPBACK_JOB_JITTER_OVERFLOW")?;
    let uncapped = low
        .checked_add(first64 % span)
        .ok_or("SNAPBACK_JOB_JITTER_OVERFLOW")?;
    let delay = uncapped.min(vector.max_delay_ms);
    let available_at = vector
        .server_now_ms
        .checked_add(delay)
        .filter(|value| *value <= MAX_PORTABLE_INTEGER)
        .ok_or("SNAPBACK_JOB_JITTER_OVERFLOW")?;

    Ok(JitterResult {
        message_hex: encode_hex(&message),
        mac_hex: encode_hex(&mac),
        first64: first64.to_string(),
        low_ms: low,
        high_ms: high,
        uncapped_delay_ms: uncapped,
        delay_ms: delay,
        available_at_ms: available_at.to_string(),
    })
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
fn snapback_job_jitter_v1_matches_every_committed_golden_vector() {
    for vector in corpus().jitter_vectors {
        let expected = JitterResult {
            message_hex: vector.message_hex.clone(),
            mac_hex: vector.mac_hex.clone(),
            first64: vector.first64.clone(),
            low_ms: vector.low_ms,
            high_ms: vector.high_ms,
            uncapped_delay_ms: vector.uncapped_delay_ms,
            delay_ms: vector.delay_ms,
            available_at_ms: vector.available_at_ms.clone(),
        };
        assert_eq!(jitter_v1(&vector), Ok(expected), "{}", vector.name);
    }
}

#[test]
fn snapback_job_jitter_v1_rejects_malformed_and_overflowing_inputs() {
    let mut corpus = corpus();
    let mut vector = corpus.jitter_vectors.remove(0);
    vector.job_id_hex.clear();
    assert_eq!(jitter_v1(&vector), Err("SNAPBACK_JOB_JITTER_INVALID"));
    vector.job_id_hex = "00".to_owned();
    vector.attempt = 0;
    assert_eq!(jitter_v1(&vector), Err("SNAPBACK_JOB_JITTER_INVALID"));
    vector.attempt = 1;
    vector.server_now_ms = MAX_PORTABLE_INTEGER;
    vector.base_delay_ms = 1_000;
    vector.max_delay_ms = 5_000;
    assert_eq!(jitter_v1(&vector), Err("SNAPBACK_JOB_JITTER_OVERFLOW"));
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

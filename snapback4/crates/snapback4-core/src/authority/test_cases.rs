//! One authority fact set and policy suite, loaded by both store adapters.

use super::{AdmissionRecord, AdmissionStanding, AuthorityTransaction, WorkRecord};

pub(crate) struct GenerationFact(pub &'static str, pub i64);
pub(crate) struct SessionFact {
    pub digest: &'static str,
    pub principal: &'static str,
    pub kind: &'static str,
    pub created_at: i64,
    pub expires_at: i64,
    pub family: Option<&'static str>,
}
pub(crate) struct WorkFact {
    pub id: &'static str,
    pub principal: &'static str,
    pub state: &'static str,
    pub claimed_by: Option<&'static str>,
    pub session_digest: Option<&'static str>,
    pub lease_until: Option<i64>,
    pub deadline: Option<i64>,
    pub family: Option<&'static str>,
    pub generation: Option<i64>,
    pub admitted_expires_at: Option<i64>,
    pub service_generation: Option<i64>,
}

pub(crate) fn generations() -> Vec<GenerationFact> {
    vec![
        GenerationFact("alice", 2),
        GenerationFact("bob", 1),
        GenerationFact("service:worker", 4),
        GenerationFact("service:stale", 5),
    ]
}

pub(crate) fn sessions() -> Vec<SessionFact> {
    vec![
        session("base-old", "alice", "member", 300, Some("family-root")),
        session("base-new", "alice", "member", 500, Some("family-root")),
        session("expired", "alice", "member", 100, Some("expired-family")),
        session("legacy", "alice", "member", 250, None),
        session("exact-a", "alice", "member", 500, Some("revoke-family")),
        session("exact-b", "alice", "member", 500, Some("revoke-family")),
        session("child", "alice", "action", 450, Some("child-family")),
        session("grandchild", "alice", "action", 440, Some("grandchild-family")),
        session("cycle", "alice", "action", 430, Some("cycle-family")),
        session("revoked-child", "alice", "action", 420, Some("revoked-child-family")),
        session("wrong-principal-child", "alice", "action", 420, Some("wrong-principal-family")),
        session("service-live", "service:worker", "service", 500, Some("service-family")),
    ]
}

fn session(
    digest: &'static str,
    principal: &'static str,
    kind: &'static str,
    expires_at: i64,
    family: Option<&'static str>,
) -> SessionFact {
    SessionFact { digest, principal, kind, created_at: 1, expires_at, family }
}

pub(crate) fn work() -> Vec<WorkFact> {
    vec![
        work_fact("parent", "alice", "running", Some("service:worker"), Some("child"), Some(400), Some(350), Some("family-root"), Some(2), Some(150), None),
        work_fact("grandparent", "alice", "running", Some("service:worker"), Some("grandchild"), Some(340), Some(330), Some("child-family"), Some(2), Some(120), None),
        work_fact("cycle-parent", "alice", "running", Some("service:worker"), Some("cycle"), Some(400), Some(390), Some("cycle-family"), Some(2), Some(300), None),
        work_fact("revoked-parent", "alice", "running", Some("service:worker"), Some("revoked-child"), Some(400), None, Some("missing-family"), Some(2), Some(300), None),
        work_fact("wrong-principal", "bob", "running", Some("service:worker"), Some("wrong-principal-child"), Some(400), None, Some("family-root"), Some(1), Some(300), None),
        work_fact("owned", "alice", "running", Some("service:worker"), Some("owned-digest"), Some(200), None, None, None, None, None),
        work_fact("wrong-state", "alice", "queued", Some("service:worker"), Some("wrong-state-digest"), Some(200), None, None, None, None, None),
        work_fact("lease-equal", "alice", "running", Some("service:worker"), Some("lease-equal-digest"), Some(100), Some(200), None, None, None, None),
        work_fact("deadline-equal", "alice", "running", Some("service:worker"), Some("deadline-equal-digest"), Some(200), Some(100), None, None, None, None),
        work_fact("service-current", "service:worker", "running", Some("service:worker"), Some("service-current-digest"), Some(200), None, None, None, None, Some(4)),
        work_fact("service-stale", "service:stale", "running", Some("service:worker"), Some("service-stale-digest"), Some(200), None, None, None, None, Some(4)),
        work_fact("partial-generation", "alice", "running", Some("service:worker"), Some("partial-generation-digest"), Some(200), None, Some("family-root"), None, Some(90), None),
        work_fact("partial-family", "alice", "running", Some("service:worker"), Some("partial-family-digest"), Some(200), None, None, Some(2), Some(90), None),
        work_fact("partial-expiry", "alice", "running", Some("service:worker"), Some("partial-expiry-digest"), Some(200), None, Some("family-root"), Some(2), None, None),
        work_fact("mapped", "alice", "running", Some("mapper"), Some("mapped-digest"), Some(321), Some(654), Some("mapped-family"), Some(2), Some(987), Some(2)),
        work_fact("ambiguous-a", "alice", "running", None, Some("duplicate-digest"), Some(200), None, None, None, None, None),
        work_fact("ambiguous-b", "bob", "running", None, Some("duplicate-digest"), Some(200), None, None, None, None, None),
    ]
}

#[allow(clippy::too_many_arguments)]
fn work_fact(
    id: &'static str,
    principal: &'static str,
    state: &'static str,
    claimed_by: Option<&'static str>,
    session_digest: Option<&'static str>,
    lease_until: Option<i64>,
    deadline: Option<i64>,
    family: Option<&'static str>,
    generation: Option<i64>,
    admitted_expires_at: Option<i64>,
    service_generation: Option<i64>,
) -> WorkFact {
    WorkFact { id, principal, state, claimed_by, session_digest, lease_until, deadline, family, generation, admitted_expires_at, service_generation }
}

pub(crate) fn assert_adapter_facts(tx: &impl AuthorityTransaction) {
    assert_eq!(tx.principal_generation("alice").unwrap(), 2);
    assert_eq!(tx.principal_generation("missing").unwrap(), 0);
    let exact = tx.session_by_digest("base-old").unwrap().unwrap();
    assert_eq!((exact.principal.as_str(), exact.family.as_str(), exact.kind.as_str(), exact.digest.as_str(), exact.expires_at), ("alice", "family-root", "member", "base-old", 300));
    assert_eq!(tx.latest_live_family_member("alice", "family-root", 100).unwrap().unwrap().digest, "base-new");
    assert!(tx.latest_live_family_member("alice", "expired-family", 100).unwrap().is_none());
    assert_eq!(tx.session_by_digest("legacy").unwrap().unwrap().family, "legacy");

    let mapped = tx.work_by_id("mapped").unwrap().unwrap();
    assert_eq!(mapped, WorkRecord {
        principal: "alice".into(), state: "running".into(), claimed_by: Some("mapper".into()),
        session_digest: Some("mapped-digest".into()), lease_until: Some(321), deadline: Some(654),
        admission: AdmissionRecord { family: Some("mapped-family".into()), generation: Some(2), expires_at: Some(987) },
        service_generation: Some(2),
    });
    let ambiguous = tx.work_by_claimed_session_digest("duplicate-digest").unwrap().unwrap();
    assert!(matches!(ambiguous.principal.as_str(), "alice" | "bob"));
}

pub(crate) fn assert_policy_cases(tx: &impl AuthorityTransaction) {
    match super::admission_authority(tx, "base-old", "alice", 100).unwrap() {
        AdmissionStanding::Live(authority) => assert_eq!((authority.family.as_str(), authority.generation, authority.expires_at), ("family-root", 2, 300)),
        _ => panic!("live admission refused"),
    }
    assert!(matches!(super::admission_authority(tx, "base-old", "bob", 100).unwrap(), AdmissionStanding::SessionNotLive));
    assert!(matches!(super::admission_authority(tx, "expired", "alice", 100).unwrap(), AdmissionStanding::SessionNotLive));
    match super::admission_authority(tx, "legacy", "alice", 100).unwrap() {
        AdmissionStanding::Live(authority) => assert_eq!((authority.family.as_str(), authority.expires_at), ("legacy", 250)),
        _ => panic!("legacy NULL family refused"),
    }
    assert_eq!(super::family_authority_expiry(tx, "alice", "family-root", 2, 100).unwrap(), Some(500));
    assert_eq!(super::family_authority_expiry(tx, "alice", "family-root", 1, 100).unwrap(), None);
    assert_eq!(super::family_authority_expiry(tx, "alice", "child-family", 2, 100).unwrap(), Some(350));
    assert_eq!(super::family_authority_expiry(tx, "alice", "grandchild-family", 2, 100).unwrap(), Some(330));
    assert_eq!(super::family_authority_expiry(tx, "alice", "cycle-family", 2, 100).unwrap(), None);
    assert_eq!(super::family_authority_expiry(tx, "alice", "revoked-child-family", 2, 100).unwrap(), None);
    assert_eq!(super::family_authority_expiry(tx, "alice", "wrong-principal-family", 2, 100).unwrap(), None);

    assert!(super::held_claim_authority(tx, "owned", "service:worker", "owned-digest", 100).unwrap());
    assert!(!super::held_claim_authority(tx, "owned", "service:other", "owned-digest", 100).unwrap());
    assert!(!super::held_claim_authority(tx, "owned", "service:worker", "other-digest", 100).unwrap());
    assert!(!super::live_claim_authority(tx, "wrong-state-digest", 100).unwrap());
    assert!(!super::live_claim_authority(tx, "lease-equal-digest", 100).unwrap());
    assert!(!super::live_claim_authority(tx, "deadline-equal-digest", 100).unwrap());
    assert!(super::live_claim_authority(tx, "service-current-digest", 100).unwrap());
    assert!(!super::live_claim_authority(tx, "service-stale-digest", 100).unwrap());
    for id in ["partial-generation", "partial-family", "partial-expiry"] {
        assert_eq!(super::work_authority_expiry(tx, &tx.work_by_id(id).unwrap().unwrap(), 100).unwrap(), Some(i64::MAX));
    }
    assert!(super::live_service_session(tx, "service-live", "service:worker", 100).unwrap());
    assert!(!super::live_service_session(tx, "service-live", "service:other", 100).unwrap());
}

pub(crate) fn assert_invalidations(tx: &impl AuthorityTransaction) {
    tx.invalidate_session("exact-a").unwrap();
    assert!(tx.session_by_digest("exact-a").unwrap().is_none());
    assert!(tx.session_by_digest("exact-b").unwrap().is_some());
    tx.invalidate_family("alice", "revoke-family").unwrap();
    assert!(tx.session_by_digest("exact-b").unwrap().is_none());
}

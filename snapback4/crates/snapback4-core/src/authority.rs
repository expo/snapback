//! Store-neutral authority decisions over typed transaction capabilities.
//!
//! Storage adapters expose identity and work facts. This module alone walks
//! admission families and decides whether a session or claim still stands.

use crate::RuntimeError;

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Authority {
    pub family: String,
    pub generation: i64,
    pub expires_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct SessionRecord {
    pub principal: String,
    pub family: String,
    pub kind: String,
    pub digest: String,
    pub expires_at: i64,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct WorkRecord {
    pub principal: String,
    pub state: String,
    pub claimed_by: Option<String>,
    pub session_digest: Option<String>,
    pub lease_until: Option<i64>,
    pub deadline: Option<i64>,
    pub admission: AdmissionRecord,
    pub service_generation: Option<i64>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct AdmissionRecord {
    pub family: Option<String>,
    pub generation: Option<i64>,
    pub expires_at: Option<i64>,
}

/// The durable facts the authority kernel may read in one store transaction.
/// Implementations perform access only; the policy below interprets records.
pub(crate) trait AuthorityTransaction {
    fn principal_generation(&self, principal: &str) -> Result<i64, RuntimeError>;
    fn session_by_digest(&self, digest: &str) -> Result<Option<SessionRecord>, RuntimeError>;
    fn latest_live_family_member(
        &self,
        principal: &str,
        family: &str,
        now: i64,
    ) -> Result<Option<SessionRecord>, RuntimeError>;
    fn work_by_id(&self, id: &str) -> Result<Option<WorkRecord>, RuntimeError>;
    fn work_by_claimed_session_digest(
        &self,
        digest: &str,
    ) -> Result<Option<WorkRecord>, RuntimeError>;

    fn invalidate_session(&self, digest: &str) -> Result<(), RuntimeError>;
    fn invalidate_family(&self, principal: &str, family: &str) -> Result<(), RuntimeError>;
}

pub(crate) enum AdmissionStanding {
    SessionNotLive,
    AuthorityNotLive,
    Live(Authority),
}

/// Resolve the credential captured at admission. Refresh may replace its row,
/// but the family and principal generation remain the durable authority.
// @ref LLP 3000.009#5.1 — action authority is bound at admission and walked inside one transaction.
pub(crate) fn admission_authority(
    tx: &impl AuthorityTransaction,
    token_digest: &str,
    principal: &str,
    now: i64,
) -> Result<AdmissionStanding, RuntimeError> {
    let Some(session) = tx.session_by_digest(token_digest)? else {
        return Ok(AdmissionStanding::SessionNotLive);
    };
    if session.principal != principal || session.expires_at <= now {
        return Ok(AdmissionStanding::SessionNotLive);
    }
    let generation = tx.principal_generation(principal)?;
    let Some(standing) = family_authority_expiry(tx, principal, &session.family, generation, now)?
    else {
        return Ok(AdmissionStanding::AuthorityNotLive);
    };
    Ok(AdmissionStanding::Live(Authority {
        family: session.family,
        generation,
        expires_at: session.expires_at.min(standing),
    }))
}

/// Walk a refresh/delegation family at one transaction snapshot. The admitted
/// expiry is deliberately not an ongoing cap: refresh lifetime and admission
/// lifetime are distinct. Claim leases and deadlines remain hard caps.
pub(crate) fn family_authority_expiry(
    tx: &impl AuthorityTransaction,
    principal: &str,
    family: &str,
    generation: i64,
    now: i64,
) -> Result<Option<i64>, RuntimeError> {
    let current_generation = tx.principal_generation(principal)?;
    let (mut family, mut generation, mut bound) = (family.to_owned(), generation, i64::MAX);
    let mut seen = std::collections::BTreeSet::new();
    loop {
        if generation != current_generation || !seen.insert(family.clone()) {
            return Ok(None);
        }
        let Some(session) = tx.latest_live_family_member(principal, &family, now)? else {
            return Ok(None);
        };
        bound = bound.min(session.expires_at);
        if session.kind != "action" {
            return Ok(Some(bound));
        }
        let Some(parent) = tx.work_by_claimed_session_digest(&session.digest)? else {
            return Ok(None);
        };
        if parent.principal != principal || !claim_window_is_live(&parent, now) {
            return Ok(None);
        }
        let lease = parent.lease_until.expect("a live claim has a lease");
        bound = bound.min(lease).min(parent.deadline.unwrap_or(i64::MAX));
        if let Some(service_generation) = parent.service_generation {
            return Ok((service_generation == current_generation).then_some(bound));
        }
        match (parent.admission.family, parent.admission.generation) {
            (Some(next), Some(next_generation)) => {
                family = next;
                generation = next_generation;
            }
            (None, None) => return Ok(Some(bound)), // Legacy work and development personas.
            _ => return Ok(None),
        }
    }
}

pub(crate) fn work_authority_expiry(
    tx: &impl AuthorityTransaction,
    work: &WorkRecord,
    now: i64,
) -> Result<Option<i64>, RuntimeError> {
    if let Some(generation) = work.service_generation {
        return Ok((tx.principal_generation(&work.principal)? == generation).then_some(i64::MAX));
    }
    match (&work.admission.family, work.admission.generation, work.admission.expires_at) {
        (Some(family), Some(generation), Some(_)) => family_authority_expiry(
            tx,
            &work.principal,
            family,
            generation,
            now,
        ),
        _ => Ok(Some(i64::MAX)), // Legacy rows and development personas.
    }
}

fn claim_window_is_live(work: &WorkRecord, now: i64) -> bool {
    work.state == "running"
        && work.lease_until.is_some_and(|lease| lease > now)
        && work.deadline.is_none_or(|deadline| deadline > now)
}

pub(crate) fn claim_is_owned(work: &WorkRecord, worker: &str, digest: &str) -> bool {
    work.claimed_by.as_deref() == Some(worker) && work.session_digest.as_deref() == Some(digest)
}

pub(crate) fn live_claim_authority(
    tx: &impl AuthorityTransaction,
    digest: &str,
    now: i64,
) -> Result<bool, RuntimeError> {
    let Some(work) = tx.work_by_claimed_session_digest(digest)? else {
        return Ok(false);
    };
    Ok(claim_window_is_live(&work, now) && work_authority_expiry(tx, &work, now)?.is_some())
}

pub(crate) fn held_claim_authority(
    tx: &impl AuthorityTransaction,
    id: &str,
    worker: &str,
    digest: &str,
    now: i64,
) -> Result<bool, RuntimeError> {
    let Some(work) = tx.work_by_id(id)? else {
        return Ok(false);
    };
    if !claim_is_owned(&work, worker, digest) {
        return Ok(false);
    }
    live_claim_authority(tx, digest, now)
}

pub(crate) fn live_session(
    tx: &impl AuthorityTransaction,
    digest: &str,
    now: i64,
) -> Result<Option<SessionRecord>, RuntimeError> {
    let Some(session) = tx.session_by_digest(digest)? else {
        return Ok(None);
    };
    if session.expires_at <= now {
        return Ok(None);
    }
    if session.kind == "action" && !live_claim_authority(tx, digest, now)? {
        return Ok(None);
    }
    Ok(Some(session))
}

pub(crate) fn live_service_session(
    tx: &impl AuthorityTransaction,
    digest: &str,
    principal: &str,
    now: i64,
) -> Result<bool, RuntimeError> {
    Ok(tx.session_by_digest(digest)?.is_some_and(|session| {
        session.principal == principal && session.kind == "service" && session.expires_at > now
    }))
}

//! Long-wait capacity (LLP 3000.036 §6 A): the viewers' pool, the service
//! workers' claim pool, a per-principal share of held change polls, and the
//! `E_STREAMS` refusals that name which bound was full.
use super::{Shared, lock, refusal_json, respond_with_headers};
use crate::host_limits::Capacity;
use serde_json::json;
use snapback4_core::error::Refusal;
use std::collections::BTreeMap;
use std::sync::Mutex;
use tiny_http::{Header, Request};

/// A full pool is refused on the dispatcher; Retry-After spreads the retries.
pub(super) const POOL_RETRY_SECONDS: u32 = 2;
/// A principal at its share waits for one of its own polls to end.
pub(super) const SHARE_RETRY_SECONDS: u32 = 5;

fn refusal(message: String) -> Refusal {
    let mut why = Refusal::new("E_STREAMS", "limit", message).guide("wire");
    why.retryable = true;
    why
}

/// The fixed bodies the dispatcher writes, nonblocking, when a pool is full.
pub(super) struct PoolRefusals { pub(super) viewer: String, pub(super) claim: String }

impl PoolRefusals {
    pub(super) fn new(capacity: &Capacity) -> Self {
        let body = |message: String| json!({ "denied": refusal_json(&refusal(message)) }).to_string();
        Self {
            viewer: body(format!("all {} viewer long waits on this host are held (GET /changes?wait and POST /a/<action>); retry after Retry-After, and poll /changes without wait meanwhile; the host's operator can raise --long-waits", capacity.long_waits)),
            claim: body(format!("all {} worker claim polls on this host are held (POST /effects/claim, /actions/claim); retry after Retry-After; the host's operator can raise --claim-waits", capacity.claim_waits)),
        }
    }
}

// @ref LLP 3000#contended-read-serving — a share inside the wait class's permit, never a second admission queue.
/// Held change polls per principal. Entry happens after the pool permit and
/// authentication, and is refused at once, never queued.
#[derive(Debug)]
pub(crate) struct LongWaits { limit: usize, held: Mutex<BTreeMap<String, usize>> }

impl LongWaits {
    pub(crate) fn new(capacity: &Capacity) -> Self { Self { limit: capacity.per_principal, held: Mutex::new(BTreeMap::new()) } }

    pub(super) fn enter<'a>(&'a self, principal: &str) -> Result<Share<'a>, usize> {
        let mut held = lock(&self.held);
        let count = held.entry(principal.to_owned()).or_insert(0);
        if *count >= self.limit {
            let limit = self.limit;
            if *count == 0 { held.remove(principal); }
            return Err(limit);
        }
        *count += 1;
        Ok(Share { waits: self, principal: principal.to_owned() })
    }

    #[cfg(test)]
    pub(crate) fn held(&self, principal: &str) -> usize { lock(&self.held).get(principal).copied().unwrap_or(0) }
}

pub(super) struct Share<'a> { waits: &'a LongWaits, principal: String }

impl Drop for Share<'_> {
    fn drop(&mut self) {
        let mut held = lock(&self.waits.held);
        if let Some(count) = held.get_mut(&self.principal) {
            *count -= 1;
            if *count == 0 { held.remove(&self.principal); }
        }
    }
}

/// HTTP 429 with Retry-After: this principal's share, not the host, is full.
pub(super) fn refuse_share(request: Request, shared: &Shared, limit: usize) {
    let why = refusal(format!("this principal already holds {limit} of {limit} held change polls (one per open tab or device); retry after Retry-After, close a tab, or poll /changes without wait meanwhile"));
    respond_with_headers(request, shared, 429, json!({ "denied": refusal_json(&why) }), vec![
        Header::from_bytes("Retry-After", SHARE_RETRY_SECONDS.to_string()).unwrap(),
        Header::from_bytes("Access-Control-Expose-Headers", "Retry-After").unwrap(),
    ]);
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn a_share_is_refused_at_its_limit_and_released_on_drop() {
        let waits = LongWaits::new(&Capacity::sized(8, 2, 1));
        let a = waits.enter("alice").unwrap();
        let b = waits.enter("alice").unwrap();
        assert_eq!(waits.enter("alice").err(), Some(2));
        let other = waits.enter("bob").unwrap();
        drop(a);
        let c = waits.enter("alice").unwrap();
        drop((b, c, other));
        assert_eq!(waits.held("alice"), 0);
        assert!(lock(&waits.held).is_empty(), "no entry outlives its last share");
    }
}

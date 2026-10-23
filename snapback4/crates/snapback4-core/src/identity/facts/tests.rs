//! Generated cross-product over authority facts, using both physical adapters.
use super::*;
use crate::{identity, authority::{AuthorityTransaction}, metadata::MetadataReader};

#[derive(Debug)]
pub(crate) struct Case {
    pub read_storage: bool,
    pub read: bool,
    pub state: u8,
    pub cap_live: bool,
    pub generation_bumped: bool,
    pub worker: u8,
    pub store_generation_changed: bool,
    pub incarnation_changed: bool,
    pub kind: &'static str,
}

pub(crate) fn cases(read_storage: bool) -> Vec<Case> {
    let mut cases = Vec::new();
    for read in [false, true] {
        if read && !read_storage { continue; }
        for state in 0..3 { for cap_live in [false, true] { for generation_bumped in [false, true] {
            for worker in 0..4 { for store_generation_changed in [false, true] { for incarnation_changed in [false, true] {
                for kind in ["guest", "user", "member", "service", "action", "custom"] {
                    cases.push(Case { read_storage, read, state, cap_live, generation_bumped, worker,
                        store_generation_changed, incarnation_changed, kind });
                }
            } } }
        } } }
    }
    cases
}

impl Case {
    // Deliberate fixed fixture literals, shared by both dialects. Production
    // adapters bind all caller input; no dynamic SQL enters their surface.
    pub fn seed(&self) -> String {
        let mut sql = String::from("DELETE FROM _sessions; DELETE FROM _principal_generations; DELETE FROM _meta WHERE key IN ('worker:session-family','worker:session-revision','worker:family:family','store_id','generation');");
        if self.read_storage { sql.push_str("DELETE FROM _read_sessions;"); }
        let generation = if self.generation_bumped { 1 } else { 0 };
        sql.push_str(&format!("INSERT INTO _principal_generations VALUES ('member:matrix',{generation}); INSERT INTO _meta VALUES ('generation','{}'),('store_id','{}');",
            if self.store_generation_changed { "2" } else { "1" }, if self.incarnation_changed { "new-store" } else { "store" }));
        match self.worker {
            0 => {},
            1 => sql.push_str("INSERT INTO _meta VALUES ('worker:session-family','family'),('worker:session-revision','7');"),
            2 => sql.push_str("INSERT INTO _meta VALUES ('worker:session-family','family'),('worker:session-revision','8');"),
            3 => sql.push_str("INSERT INTO _meta VALUES ('worker:session-family','other'),('worker:session-revision','7'),('worker:family:family','8');"),
            _ => unreachable!(),
        }
        if self.state != 2 {
            let expires = if self.state == 1 { 1_000 } else { 10_000 };
            let cap = if self.cap_live { 10_000 } else { 1_000 };
            if self.read {
                sql.push_str(&format!("INSERT INTO _read_sessions VALUES ('digest','member:matrix','{}','family',0,{expires},{cap},0);", self.kind));
            } else {
                sql.push_str(&format!("INSERT INTO _sessions(token_digest,principal,kind,family,created_at,expires_at) VALUES ('digest','member:matrix','{}','family',0,{expires});", self.kind));
            }
        }
        sql
    }
}

pub(crate) fn compare(
    tx: &(impl AuthorityTransaction + MetadataReader),
    fetch: impl Fn(&str) -> Result<SessionFacts, RuntimeError>,
    case: &Case,
) {
    assert_eq!(fetch("digest\0nul").unwrap_err().code(), "E_AUTH");
    for digest in ["digest", "absent", &identity::digest("nul\0token")] {
        let old_session = tx.session_by_digest(digest).unwrap();
        let facts = fetch(digest).unwrap();
        assert_eq!(facts.sessions, old_session.clone().into_iter().collect::<Vec<_>>(), "{case:?}");
        assert_eq!(facts.store_id, tx.store_identity().unwrap(), "{case:?}");
        assert_eq!(facts.store_generation, tx.generation_value().unwrap(), "{case:?}");
        if let Some(generation) = facts.backend_generation {
            assert_eq!(generation, if case.store_generation_changed { 2 } else { 1 });
        }
        assert_eq!(facts.worker_family, tx.worker_session_family().unwrap());
        assert_eq!(facts.worker_revision, tx.worker_session_revision().unwrap());
        if let Some(s) = old_session {
            assert_eq!(facts.current_generation, tx.principal_generation(&s.principal).unwrap());
            assert_eq!(facts.family_revision, tx.worker_family_revision(&s.family).unwrap());
        }
        for revision in [None, Some(7), Some(8)] {
            let old = || -> Result<Option<SessionRecord>, RuntimeError> {
                let Some(s) = authority::live_session(tx, digest, 1_000)? else { return Ok(None); };
                if let Some(rev) = revision {
                    if !identity::supervisor_current(tx, &s.family, rev)? { return Ok(None); }
                }
                Ok(Some(s))
            };
            assert_eq!(resolve(tx, fetch(digest).unwrap(), 1_000, revision).unwrap(), old().unwrap(), "{case:?}, {digest}, {revision:?}");
            // Identity comparison retains precedence over session resolution.
            for expected in ["store", "new-store", "wrong"] {
                let facts = fetch(digest).unwrap();
                let new = if facts.store_id.as_deref() == Some(expected) { resolve(tx, facts, 1_000, revision).unwrap() } else { None };
                let old = if tx.store_identity().unwrap().as_deref() == Some(expected) { old().unwrap() } else { None };
                assert_eq!(new, old, "{case:?}, expected={expected}");
            }
        }
    }
}

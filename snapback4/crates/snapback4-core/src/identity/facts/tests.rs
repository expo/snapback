//! Generated cross-product over authority facts, using both physical adapters.
use super::*;
use crate::{identity, authority::{AuthorityTransaction}, metadata::MetadataReader};

#[derive(Clone, Debug)]
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
    pub edge: u8,
}

pub(crate) fn cases(read_storage: bool) -> Vec<Case> {
    let mut cases = Vec::new();
    for read in [false, true] {
        if read && !read_storage { continue; }
        for state in 0..3 { for cap_live in [false, true] { for generation_bumped in [false, true] {
            for worker in 0..5 { for store_generation_changed in [false, true] { for incarnation_changed in [false, true] {
                for kind in ["guest", "user", "member", "service", "action", "custom"] {
                    cases.push(Case { read_storage, read, state, cap_live, generation_bumped, worker,
                        store_generation_changed, incarnation_changed, kind, edge: 0 });
                }
            } } }
        } } }
    }
    // Add the sparse edge states to each live kind/scope/worker combination.
    let live: Vec<_> = cases.iter().filter(|c| c.state == 0 && c.cap_live && !c.generation_bumped
        && !c.store_generation_changed && !c.incarnation_changed).cloned().collect();
    for case in live {
        for edge in 1..=4 {
            if (edge == 2 && !read_storage) || (edge == 3 && case.read) || (edge == 4 && case.kind != "action") { continue; }
            cases.push(Case { edge, ..case.clone() });
        }
    }
    cases
}

impl Case {
    // Deliberate fixed fixture literals, shared by both dialects. Production
    // adapters bind all caller input; no dynamic SQL enters their surface.
    pub fn seed(&self) -> String {
        let mut sql = String::from("DELETE FROM _sessions; DELETE FROM _requests; DELETE FROM _principal_generations; DELETE FROM _meta WHERE key IN ('worker:session-family','worker:session-revision','worker:family:family','store_id','generation','schema_hash','activation_hash','device:generation');");
        if self.read_storage { sql.push_str("DELETE FROM _read_sessions;"); }
        let generation = if self.generation_bumped { 1 } else { 0 };
        if self.edge != 1 { sql.push_str(&format!("INSERT INTO _principal_generations VALUES ('member:matrix',{generation});")); }
        sql.push_str(&format!("INSERT INTO _meta VALUES ('schema_hash','matrix-schema'),('activation_hash','matrix-activation'),('device:generation','matrix-device'),('generation','{}'),('store_id','{}');",
            if self.store_generation_changed { "2" } else { "1" }, if self.incarnation_changed { "new-store" } else { "store" }));
        match self.worker {
            0 => {},
            1 => sql.push_str("INSERT INTO _meta VALUES ('worker:session-family','family'),('worker:session-revision','7');"),
            2 => sql.push_str("INSERT INTO _meta VALUES ('worker:session-family','family'),('worker:session-revision','8');"),
            3 => sql.push_str("INSERT INTO _meta VALUES ('worker:session-family','other'),('worker:session-revision','7'),('worker:family:family','8');"),
            4 => sql.push_str("INSERT INTO _meta VALUES ('worker:session-family','family'),('worker:session-revision','7'),('worker:family:family','8');"),
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
        match self.edge {
            2 => {
                if self.read { sql.push_str(&format!("INSERT INTO _sessions(token_digest,principal,kind,family,created_at,expires_at) VALUES ('digest','member:matrix','{}','family',0,10000);", self.kind)); }
                else { sql.push_str(&format!("INSERT INTO _read_sessions VALUES ('digest','member:matrix','{}','family',0,10000,10000,0);", self.kind)); }
            },
            3 => sql.push_str("UPDATE _sessions SET family=NULL WHERE token_digest='digest';"),
            4 => sql.push_str("INSERT INTO _requests(id,name,args,principal,at,state,claimed_by,session_digest,lease_until,deadline) VALUES ('matrix-claim','test','{}','member:matrix',0,'running','worker','digest',9000,9500);"),
            _ => {},
        }
        sql
    }
}

pub(crate) fn compare(
    tx: &(impl AuthorityTransaction + MetadataReader),
    baseline: &impl AuthorityTransaction,
    fetch: impl Fn(&str) -> Result<SessionFacts, RuntimeError>,
    case: &Case,
) {
    let scope = crate::round_trips::Scope::begin();
    assert!(fetch("digest\0nul").unwrap().sessions.is_empty());
    assert_eq!(scope.counts().sqlite + scope.counts().postgres, 0);
    drop(scope);
    for digest in ["digest", "absent", &identity::digest("nul\0token")] {
        let facts = fetch(digest).unwrap();
        let old_session = match baseline.session_by_digest(digest) {
            Ok(session) => session,
            Err(old) => {
                assert_eq!(facts.sessions.len(), 2, "{case:?}");
                for revision in [None, Some(7), Some(8)] {
                    let new = resolve(tx, fetch(digest).unwrap(), 1_000, revision).unwrap_err();
                    assert_eq!((new.code(), new.to_string()), (old.code(), old.to_string()), "{case:?}");
                }
                continue;
            }
        };
        assert_eq!(facts.sessions, old_session.clone().into_iter().collect::<Vec<_>>(), "{case:?}");
        assert_eq!(facts.store_id, tx.store_identity().unwrap(), "{case:?}");
        assert_eq!(facts.store_generation, tx.generation_value().unwrap(), "{case:?}");
        if facts.backend_generation.is_none() {
            assert_eq!(facts.schema_hash.as_deref(), Some("matrix-schema"));
            assert_eq!(facts.activation_hash.as_deref(), Some("matrix-activation"));
            assert_eq!(facts.device_generation.as_deref(), Some("matrix-device"));
        }
        if let Some(generation) = facts.backend_generation {
            assert_eq!(generation, if case.store_generation_changed { 2 } else { 1 });
        }
        assert_eq!(facts.worker_family, tx.worker_session_family().unwrap());
        assert_eq!(facts.worker_revision, tx.worker_session_revision().unwrap());
        if let Some(s) = old_session {
            assert_eq!(facts.current_generation, tx.principal_generation(&s.principal).unwrap());
            assert_eq!(facts.family_revision, tx.worker_family_revision(&s.family).unwrap());
        }
        if case.edge == 4 && digest == "digest" {
            assert!(authority::live_session(baseline, digest, 1_000).unwrap().is_some(), "live action claim: {case:?}");
        }
        for revision in [None, Some(7), Some(8)] {
            let old = || -> Result<Option<SessionRecord>, RuntimeError> {
                let Some(s) = authority::live_session(baseline, digest, 1_000)? else { return Ok(None); };
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

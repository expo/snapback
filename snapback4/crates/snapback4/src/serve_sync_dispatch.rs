//! Every /sync request uses one typed reply, on one catalog-validated reader.
use super::*;
use snapback4_core::error::RuntimeError;

pub(super) fn serve(request: Request, shared: &Shared, principal: &str, input: SyncRequest) {
    match with_reader(shared, |engine| sync_stream::reply(engine, principal, &input, shared.now())) {
        Ok(body) => respond(request, 200, body),
        // Failure is deliberately identity-free and grants nothing. Identity
        // from another read would not describe the failed transaction.
        Err(error) => {
            let refusal = error.refusal();
            respond(request, if refusal.retryable { 503 } else if refusal.code == "E_INPUT" { 400 } else { 500 },
                json!({ "denied": refusal_json(&refusal) }));
        }
    }
}

fn with_reader<T>(shared: &Shared, read: impl FnOnce(&mut Engine) -> Result<T, RuntimeError>) -> Result<T, RuntimeError> {
    let reader = {
        let engine = lock(&shared.engine);
        if engine.store().conn().path().is_some_and(|path| !path.is_empty()) { Some(engine.reader()?) } else { None }
    };
    match reader {
        Some(mut reader) => read(&mut reader),
        // An in-memory dev host has no second connection. File-reader errors
        // refuse; ordinary and discovery never silently change read semantics.
        None => read(&mut lock(&shared.engine)),
    }
}

#[cfg(test)]
fn inspect_engine(engine: &mut Engine, principal: &str, input: &SyncRequest, now: i64) -> Result<sync_stream::Reply, RuntimeError> {
    sync_stream::reply(engine, principal, input, now)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn a_stale_reader_cannot_grant_recovery_after_adoption() {
        let dir = std::env::temp_dir().join(format!("sb4-metadata-reader-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let path = dir.join("store.sqlite");
        let bound = snapback4_lang::compile(&[("schema.q".into(), "query value():\n  return 1\n".into())]);
        let mut engine = Engine::new(snapback4_core::Store::open(&path).unwrap(), bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())).unwrap();
        let mut reader = engine.reader().unwrap();
        let changed = snapback4_lang::compile(&[("schema.q".into(), "query value():\n  return 2\n".into())]);
        engine.adopt(changed.schema, changed.programs.into_iter().map(|p| p.program)).unwrap();
        for wire in [json!({}), json!({"stream":true}), json!({"metadata":true,"store_id":"captured"}),
            json!({"recover":true,"store_id":"captured","generation":1,"send_revision":7,"limit":1}),
            json!({"recover":true,"store_id":"captured","generation":1,"send_revision":7,"limit":1,"stream":true})] {
            let input: SyncRequest = serde_json::from_value(wire.clone()).unwrap();
            assert!(matches!(sync_stream::reply(&mut reader, "alice", &input, 0), Err(RuntimeError::Generation(_))), "{wire}");
        }
        drop(reader); drop(engine);
        std::fs::remove_dir_all(dir).unwrap();
    }
}

#[cfg(test)]
use super::sync_stream::ABORT_INSPECTION;
#[cfg(test)]
#[path = "serve_sync_recovery_tests.rs"]
mod recovery_tests;

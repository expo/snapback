use super::*;

fn oqc_generation_manifest(marker: &str) -> FunctionManifest {
    let mut probe = FunctionDefinition::new(
        "generationProbe",
        FunctionKind::Query,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table_visibility: None,
            table: "items".to_owned(),
            filters: Vec::new(),
            membership_filters: Vec::new(),
            order: Vec::new(),
            limit: None,
            indexed_by: None,
        })),
    );
    probe.read_set_summary.tables = vec!["items".to_owned()];
    FunctionManifest {
        bundle_hash: Some(format!("oqc-generation-{marker}")),
        functions: vec![probe],
        ..FunctionManifest::default()
    }
}

fn oqc_commit_file_backed_generation(
    database_path: &std::path::Path,
    manifest: &FunctionManifest,
) -> u64 {
    let mut snapback = LocalSnapback::open(database_path).expect("open OQ-C generation fixture");
    snapback
        .apply_schema(reload_schema("oqc-generation-schema", false))
        .expect("apply OQ-C generation schema");
    let diagnostics = snapback.load_functions(manifest.clone());
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != crate::diagnostic::DiagnosticSeverity::Error),
        "initial OQ-C generation loads: {diagnostics:?}"
    );
    let generation_high_water = snapback
        .db
        .function_generation_record()
        .expect("read initial OQ-C generation record")
        .expect("initial OQ-C generation is committed")
        .generation_high_water;
    assert_eq!(
        snapback
            .invoke_query("generationProbe", HandlerInput::default())
            .expect("initial OQ-C generation serves")
            .rows,
        Vec::<Value>::new()
    );
    generation_high_water
}

fn assert_oqc_generation_load_succeeds(diagnostics: &[crate::diagnostic::Diagnostic]) {
    assert!(
        diagnostics
            .iter()
            .all(|diagnostic| diagnostic.severity != crate::diagnostic::DiagnosticSeverity::Error),
        "OQ-C generation load succeeds: {diagnostics:?}"
    );
}

fn oqc_generation_high_water(snapback: &LocalSnapback) -> u64 {
    snapback
        .db
        .function_generation_record()
        .expect("read OQ-C generation record")
        .expect("OQ-C generation record remains committed")
        .generation_high_water
}

fn assert_oqc_generation_serves(snapback: &LocalSnapback) {
    assert_eq!(
        snapback
            .invoke_query("generationProbe", HandlerInput::default())
            .expect("OQ-C generation serves after recovery")
            .rows,
        Vec::<Value>::new()
    );
}

// @ref LLP 0225#open-questions-for-the-author — OQ-C's recorded exception
//   ends only with full-LocalSnapback reopen/reload/retry acceptance.
#[test]
fn oqc_storage_reopen_without_committed_generation_preserves_unknown_function_behavior() {
    let directory = tempfile::tempdir().expect("OQ-C empty reopen directory");
    let database_path = directory.path().join("oqc-empty-reopen.sqlite3");
    drop(LocalSnapback::open(&database_path).expect("create empty OQ-C database"));

    let reopened = LocalSnapback::open(&database_path).expect("reopen empty OQ-C database");
    assert!(!reopened.has_committed_generation_record());
    assert!(reopened.db.function_generation_record().unwrap().is_none());
    assert_eq!(
        reopened
            .invoke_query("generationProbe", HandlerInput::default())
            .expect_err("fresh reopened store keeps ordinary unknown-function behavior")
            .diagnostic
            .code,
        "SNAPBACK_UNKNOWN_FUNCTION"
    );
}

#[test]
fn oqc_storage_reopen_with_committed_generation_fences_invocation_until_reload() {
    let directory = tempfile::tempdir().expect("OQ-C fenced reopen directory");
    let database_path = directory.path().join("oqc-fenced-reopen.sqlite3");
    let manifest = oqc_generation_manifest("committed");
    let generation_high_water = oqc_commit_file_backed_generation(&database_path, &manifest);

    let reopened = LocalSnapback::open(&database_path).expect("reopen committed OQ-C database");
    assert!(reopened.awaits_committed_generation_reload());
    assert_eq!(
        reopened.awaiting_generation_high_water(),
        Some(generation_high_water)
    );
    let error = reopened
        .invoke_query("generationProbe", HandlerInput::default())
        .expect_err("reopened generation remains fenced before reload");
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_FUNCTION_GENERATION_AWAITING_RELOAD"
    );
    assert_eq!(error.diagnostic.details["function"], "generationProbe");
    assert_eq!(
        error.diagnostic.details["generationHighWater"],
        generation_high_water
    );
}

#[test]
fn oqc_storage_matching_reload_resumes_without_advancing_generation_high_water() {
    let directory = tempfile::tempdir().expect("OQ-C matching reload directory");
    let database_path = directory.path().join("oqc-matching-reload.sqlite3");
    let manifest = oqc_generation_manifest("matching");
    let generation_high_water = oqc_commit_file_backed_generation(&database_path, &manifest);

    let mut reopened = LocalSnapback::open(&database_path).expect("reopen matching OQ-C database");
    let diagnostics = reopened.load_functions(manifest);
    assert_oqc_generation_load_succeeds(&diagnostics);
    assert_eq!(
        oqc_generation_high_water(&reopened),
        generation_high_water,
        "verified rehydration must not advance the durable generation high-water"
    );
    assert_oqc_generation_serves(&reopened);
}

#[test]
fn oqc_storage_different_reload_commits_one_successor_generation() {
    let directory = tempfile::tempdir().expect("OQ-C successor reload directory");
    let database_path = directory.path().join("oqc-successor-reload.sqlite3");
    let committed = oqc_generation_manifest("committed");
    let successor = oqc_generation_manifest("successor");
    let generation_high_water = oqc_commit_file_backed_generation(&database_path, &committed);

    let mut reopened = LocalSnapback::open(&database_path).expect("reopen successor OQ-C database");
    let diagnostics = reopened.load_functions(successor.clone());
    assert_oqc_generation_load_succeeds(&diagnostics);
    assert_eq!(
        oqc_generation_high_water(&reopened),
        generation_high_water + 1,
        "an automatic digest mismatch is exactly one successor deployment"
    );
    assert_eq!(reopened.served_function_manifest(), &successor);
    assert_oqc_generation_serves(&reopened);
}

#[test]
fn oqc_storage_explicit_mismatched_rehydration_refuses_without_unfencing() {
    let directory = tempfile::tempdir().expect("OQ-C refused rehydration directory");
    let database_path = directory.path().join("oqc-refused-rehydration.sqlite3");
    let committed = oqc_generation_manifest("committed");
    let mismatch = oqc_generation_manifest("mismatch");
    let generation_high_water = oqc_commit_file_backed_generation(&database_path, &committed);

    let mut reopened = LocalSnapback::open(&database_path).expect("reopen refused OQ-C database");
    let diagnostics = reopened.rehydrate_committed_generation(mismatch);
    assert!(diagnostics.iter().any(|diagnostic| {
        diagnostic.code == "SNAPBACK_FUNCTION_GENERATION_REHYDRATION_MISMATCH"
            && diagnostic.severity == crate::diagnostic::DiagnosticSeverity::Error
    }));
    assert_eq!(
        oqc_generation_high_water(&reopened),
        generation_high_water,
        "a refused explicit rehydration cannot advance durable generation state"
    );
    assert!(reopened.awaits_committed_generation_reload());
    assert_eq!(
        reopened
            .invoke_query("generationProbe", HandlerInput::default())
            .expect_err("refused explicit rehydration leaves serving fenced")
            .diagnostic
            .code,
        "SNAPBACK_FUNCTION_GENERATION_AWAITING_RELOAD"
    );
}

#[test]
fn oqc_storage_correct_retry_after_refused_rehydration_still_succeeds() {
    let directory = tempfile::tempdir().expect("OQ-C rehydration retry directory");
    let database_path = directory.path().join("oqc-rehydration-retry.sqlite3");
    let committed = oqc_generation_manifest("committed");
    let mismatch = oqc_generation_manifest("mismatch");
    let generation_high_water = oqc_commit_file_backed_generation(&database_path, &committed);

    let mut reopened = LocalSnapback::open(&database_path).expect("reopen retry OQ-C database");
    let refused = reopened.rehydrate_committed_generation(mismatch);
    assert!(refused.iter().any(|diagnostic| {
        diagnostic.code == "SNAPBACK_FUNCTION_GENERATION_REHYDRATION_MISMATCH"
    }));
    let diagnostics = reopened.rehydrate_committed_generation(committed);
    assert_oqc_generation_load_succeeds(&diagnostics);
    assert_eq!(
        oqc_generation_high_water(&reopened),
        generation_high_water,
        "the successful retry rehydrates rather than deploying a successor"
    );
    assert_oqc_generation_serves(&reopened);
}

#[test]
fn oqc_storage_rehydrate_then_deploy_successor_advances_exactly_once() {
    let directory = tempfile::tempdir().expect("OQ-C post-recovery successor directory");
    let database_path = directory.path().join("oqc-post-recovery-successor.sqlite3");
    let committed = oqc_generation_manifest("committed");
    let successor = oqc_generation_manifest("successor");
    let generation_high_water = oqc_commit_file_backed_generation(&database_path, &committed);

    let mut reopened =
        LocalSnapback::open(&database_path).expect("reopen post-recovery OQ-C database");
    let rehydration = reopened.rehydrate_committed_generation(committed);
    assert_oqc_generation_load_succeeds(&rehydration);
    assert_eq!(oqc_generation_high_water(&reopened), generation_high_water);

    let deployment = reopened.load_functions(successor.clone());
    assert_oqc_generation_load_succeeds(&deployment);
    assert_eq!(
        oqc_generation_high_water(&reopened),
        generation_high_water + 1,
        "rehydration plus one successor deployment advances exactly once"
    );
    assert_eq!(reopened.served_function_manifest(), &successor);
    assert_oqc_generation_serves(&reopened);
}

//! LLP 0185 Phase 3 item 3 bypass negative, VM level: a real JS action
//! running in the Hermes handler VM cannot reach `ctx.fetch` /
//! `ctx.fetchStream` on a derived fork. The durable payload-free egress
//! marker is the proof the deny gate — not argument validation or ambient
//! egress policy — refused the call.

use serde_json::Value;
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionRuntime, HandlerInput, IbexModule, SchemaManifest, TableManifest,
};
use std::path::Path;

const SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async fetchAction(ctx) {
    return await ctx.fetch({ url: 'https://example.invalid/never-reached' });
  },
  async fetchStreamAction(ctx) {
    return await ctx.fetchStream({ url: 'https://example.invalid/never-reached' });
  }
};
"#;

fn function(name: &str) -> FunctionDefinition {
    let mut function = FunctionDefinition::new(
        name,
        FunctionKind::Action,
        FunctionRuntime::IbexModule(IbexModule {
            source: SOURCE.to_owned(),
            export: name.to_owned(),
        }),
    );
    function.auth_requirement = None;
    function
}

fn schema() -> SchemaManifest {
    SchemaManifest {
        app_id: "vm-egress".to_owned(),
        tables: vec![TableManifest {
            name: "notes".to_owned(),
            fields: vec![FieldManifest {
                name: "body".to_owned(),
                field_type: FieldType::String,
                optional: false,
            }],
            indexes: Vec::new(),
            syncable: true,
            permission_backing: false,
            permission_fields: None,
            search_indexes: Vec::new(),
            vector_indexes: Vec::new(),
            search_live_limits: None,
            membership: None,
            authority_profile: None,
            asset_sharing: None,
            visibility: None,
            history: None,
        }],
        ..SchemaManifest::default()
    }
}

fn load(snapback: &mut LocalSnapback) {
    snapback.apply_schema(schema()).expect("apply schema");
    let diagnostics = snapback.load_functions(FunctionManifest {
        functions: vec![function("fetchAction"), function("fetchStreamAction")],
        ..FunctionManifest::default()
    });
    assert!(
        diagnostics
            .iter()
            .all(|d| d.severity != snapback::diagnostic::DiagnosticSeverity::Error),
        "manifest must install: {diagnostics:?}"
    );
}

fn input() -> HandlerInput {
    HandlerInput {
        args: Value::Object(Default::default()),
        auth: AuthInput {
            principal: Some("user_vm".to_owned()),
            user_id: Some("user_vm".to_owned()),
            ..AuthInput::default()
        },
        ..HandlerInput::default()
    }
}

fn marker_rows(database: &Path) -> Vec<(String, u64)> {
    let conn = snapback_services::test_support::rusqlite::Connection::open(database)
        .expect("open fork database");
    let mut statement = conn
        .prepare("SELECT family, attempts FROM _snapback_fork_egress_attempts_v1 ORDER BY family")
        .expect("prepare marker query");
    statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, u64>(1)?))
        })
        .expect("query markers")
        .collect::<Result<Vec<_>, _>>()
        .expect("collect markers")
}

#[test]
fn js_actions_cannot_fetch_or_stream_from_a_fork_through_the_real_vm() {
    let directory = tempfile::tempdir().expect("vm egress fixture");
    let source = directory.path().join("parent.sqlite3");
    let mut parent = LocalSnapback::open(&source).expect("parent snapback");
    load(&mut parent);
    drop(parent);

    let destination = directory.path().join("fork");
    snapback::instance_fork::publish(&source, &destination, "vm-egress", "parent-a", 42, None)
        .expect("publish fork");
    let database = destination.join("parent.sqlite3");
    let mut fork = LocalSnapback::open(&database).expect("fork snapback");
    // Loading the worktree's functions into the fork is the normal flow —
    // `fork create` posts them after boot; the deny gate must hold anyway.
    load(&mut fork);

    for action in ["fetchAction", "fetchStreamAction"] {
        let result = fork.run_function(action, input());
        assert!(!result.ok, "{action} must fail on a fork");
        let diagnostic = result.diagnostic.expect("action failure diagnostic");
        assert_eq!(
            diagnostic.code, "SNAPBACK_FORK_EGRESS_DENIED",
            "{action}: the typed fork denial survives the VM boundary, got {diagnostic:?}"
        );
    }
    drop(fork);
    // Both ctx.fetch and ctx.fetchStream announce their external effect
    // through `action.externalEffectBegin` first, so both denials land as
    // family `fetch` — two attempts on one durable, payload-free marker row.
    // The markers prove the fork deny gate — not URL validation, DNS, or
    // ambient policy — is what refused the calls.
    assert_eq!(
        marker_rows(&database),
        vec![("fetch".to_owned(), 2)],
        "each VM-mediated attempt left its payload-free family marker"
    );

    // Contrast: the parent instance never hits the fork gate. Whatever the
    // ambient egress policy decides for these URLs, it is not the fork code
    // and it leaves no fork marker table.
    let mut parent = LocalSnapback::open(&source).expect("reopen parent");
    let parent_result = parent.run_function("fetchAction", input());
    if let Some(diagnostic) = parent_result.diagnostic.as_ref() {
        assert_ne!(
            diagnostic.code, "SNAPBACK_FORK_EGRESS_DENIED",
            "the fork egress code must never fire on a non-fork instance"
        );
    }
    drop(parent);
    let conn = snapback_services::test_support::rusqlite::Connection::open(&source)
        .expect("open parent database");
    let marker_table_exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name=?1)",
            ["_snapback_fork_egress_attempts_v1"],
            |row| row.get(0),
        )
        .expect("marker table probe");
    assert!(
        !marker_table_exists,
        "the parent never grows a fork egress marker table"
    );
}

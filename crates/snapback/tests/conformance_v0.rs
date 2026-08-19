//! LLP 0146 D1 — declaration/observation conformance, first tranche.
//!
//! Covers the D1 acceptance obligations that are decidable on the local
//! target today: the per-invocation report carries class-tagged deltas with
//! per-class provenance (a read/write swap reports both `missingReads` and
//! `missingWrites` rather than cancelling); a successful action reports
//! `unsupported` provenance rather than any conformant verdict, while a
//! throwing action reports `incomplete`; and under the per-app
//! strict opt-in an undeclared application-table read or write is refused at
//! the runtime seam with the named platform code before any durable effect.
//! The `verify` coverage aggregation is D2 and is not claimed here.

use serde_json::{Value, json};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    ActionPlan, DependencySummary, FieldManifest, FieldType, FunctionDefinition, FunctionKind,
    FunctionManifest, FunctionRuntime, HandlerInput, HandlerPlan, IbexModule, SchemaManifest,
    SourceSpan, TableManifest,
};

const HANDLERS: &str = r#"
globalThis.__snapbackHandlers = {
  async readOthers(ctx) {
    return await ctx.db.query('others').collect();
  },
  async readNotes(ctx) {
    return await ctx.db.query('notes').collect();
  },
  async writeOthers(ctx) {
    await ctx.db.insert('others', { title: 'undeclared write' });
    return { ok: true };
  },
  async writeNotes(ctx) {
    await ctx.db.insert('notes', { title: 'declared write' });
    return { ok: true };
  },
  async swapReadWrite(ctx) {
    await ctx.db.query('others').collect();
    await ctx.db.insert('notes', { title: 'swapped' });
    return { ok: true };
  },
  async throwingAction() {
    throw new Error('action execution failed');
  }
};
"#;

fn table(name: &str) -> TableManifest {
    TableManifest {
        name: name.to_owned(),
        fields: vec![FieldManifest {
            name: "title".to_owned(),
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
        visibility: Some(snapback::manifest::TableVisibilityV1::PublicRead),
        history: None,
    }
}

fn schema(strict: bool) -> SchemaManifest {
    SchemaManifest {
        schema_hash: Some("conformance-schema-v0".to_owned()),
        strict_declarations: strict,
        tables: vec![table("notes"), table("others")],
        ..SchemaManifest::default()
    }
}

fn summary(tables: &[&str]) -> DependencySummary {
    DependencySummary {
        primary_table: tables.first().map(|table| (*table).to_owned()),
        tables: tables.iter().map(|table| (*table).to_owned()).collect(),
        mode: None,
        auth_scope_field: None,
    }
}

fn js_function(
    name: &str,
    kind: FunctionKind,
    declared_reads: &[&str],
    declared_writes: &[&str],
) -> FunctionDefinition {
    let mut function = FunctionDefinition::new(
        name,
        kind,
        FunctionRuntime::IbexModule(IbexModule {
            source: HANDLERS.to_owned(),
            export: name.to_owned(),
        }),
    );
    function.read_set_summary = summary(declared_reads);
    function.write_set_summary = summary(declared_writes);
    function.source_span = Some(SourceSpan {
        file: "snapback/app.js".to_owned(),
        line: 42,
        column: 3,
    });
    function
}

fn instance(strict: bool) -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("memory instance");
    snapback
        .apply_schema(schema(strict))
        .expect("schema applies");
    let manifest = FunctionManifest {
        functions: vec![
            js_function("readOthers", FunctionKind::Query, &["notes"], &[]),
            js_function("readNotes", FunctionKind::Query, &["notes"], &[]),
            js_function("writeOthers", FunctionKind::Mutation, &[], &["notes"]),
            js_function("writeNotes", FunctionKind::Mutation, &[], &["notes"]),
            js_function(
                "swapReadWrite",
                FunctionKind::Mutation,
                &["notes"],
                &["others"],
            ),
            FunctionDefinition::new(
                "inertAction",
                FunctionKind::Action,
                FunctionRuntime::HostPlan(HandlerPlan::Action(ActionPlan {
                    steps: Vec::new(),
                    return_value: None,
                })),
            ),
            js_function("throwingAction", FunctionKind::Action, &[], &[]),
        ],
        ..FunctionManifest::default()
    };
    let diagnostics = snapback.load_functions(manifest);
    assert!(
        diagnostics.iter().all(
            |diagnostic| diagnostic.severity != snapback::diagnostic::DiagnosticSeverity::Error
        ),
        "fixture manifest must load: {diagnostics:?}"
    );
    snapback
}

fn conformance(result: &snapback::local::FunctionRunResult) -> Value {
    serde_json::to_value(result.conformance.as_ref().expect("conformance emitted"))
        .expect("conformance serializes")
}

#[test]
fn undeclared_read_reports_missing_reads_with_complete_provenance() {
    let mut snapback = instance(false);
    let result = snapback.run_function("readOthers", HandlerInput::default());
    assert!(result.ok, "non-strict app still serves: {result:?}");
    let report = conformance(&result);
    assert_eq!(report["missingReads"], json!(["others"]));
    assert_eq!(report["readProvenance"], json!("complete"));
    // The declared-but-unwitnessed table is data, not a verdict (aggregate
    // coverage is D2's judgement).
    assert_eq!(report["extraReads"], json!(["notes"]));
    assert_eq!(report["missingWrites"], json!([]));
}

#[test]
fn declared_read_reports_clean_conformance() {
    let mut snapback = instance(false);
    let result = snapback.run_function("readNotes", HandlerInput::default());
    assert!(result.ok, "{result:?}");
    let report = conformance(&result);
    assert_eq!(report["missingReads"], json!([]));
    assert_eq!(report["extraReads"], json!([]));
    assert_eq!(report["readProvenance"], json!("complete"));
}

#[test]
fn read_write_swap_reports_both_classes_without_cancelling() {
    let mut snapback = instance(false);
    // Declares read `notes` + write `others`; observably reads `others` and
    // writes `notes`. One untagged union would cancel to empty — the class
    // split must report both violations.
    let result = snapback.run_function("swapReadWrite", HandlerInput::default());
    assert!(result.ok, "{result:?}");
    let report = conformance(&result);
    assert_eq!(report["missingReads"], json!(["others"]));
    assert_eq!(report["missingWrites"], json!(["notes"]));
    assert_eq!(report["readProvenance"], json!("complete"));
    assert_eq!(report["writeProvenance"], json!("complete"));
}

#[test]
fn action_reports_unsupported_provenance_not_a_verdict() {
    let mut snapback = instance(false);
    let result = snapback.run_function("inertAction", HandlerInput::default());
    let report = conformance(&result);
    assert_eq!(report["readProvenance"], json!("unsupported"));
    assert_eq!(report["writeProvenance"], json!("unsupported"));
    assert_eq!(report["missingReads"], json!([]));
    assert_eq!(report["missingWrites"], json!([]));
}

#[test]
fn throwing_action_reports_incomplete_provenance() {
    let mut snapback = instance(false);
    let result = snapback.run_function("throwingAction", HandlerInput::default());
    assert!(!result.ok, "throwing action must fail: {result:?}");
    let report = conformance(&result);
    assert_eq!(report["readProvenance"], json!("incomplete"));
    assert_eq!(report["writeProvenance"], json!("incomplete"));
    assert_eq!(report["missingReads"], json!([]));
    assert_eq!(report["missingWrites"], json!([]));
}

#[test]
fn strict_mode_refuses_undeclared_read_with_named_code_and_span() {
    let mut snapback = instance(true);
    let result = snapback.run_function("readOthers", HandlerInput::default());
    assert!(!result.ok, "strict app must refuse: {result:?}");
    let diagnostic = result.diagnostic.expect("refusal diagnostic");
    assert_eq!(diagnostic.code, "SNAPBACK_HANDLER_UNDECLARED_READ");
    assert_eq!(diagnostic.details["table"], json!("others"));
    assert_eq!(diagnostic.details["function"], json!("fn:readOthers"));
    assert_eq!(
        diagnostic.details["sourceSpan"],
        json!({ "file": "snapback/app.js", "line": 42, "column": 3 })
    );
}

#[test]
fn strict_mode_refuses_undeclared_write_before_any_durable_effect() {
    let mut snapback = instance(true);
    let before = snapback.run_function("readNotes", HandlerInput::default());
    let version_before = before.version.expect("query reports version");

    let result = snapback.run_function("writeOthers", HandlerInput::default());
    assert!(!result.ok, "strict app must refuse: {result:?}");
    let diagnostic = result.diagnostic.expect("refusal diagnostic");
    assert_eq!(diagnostic.code, "SNAPBACK_HANDLER_UNDECLARED_WRITE");
    assert_eq!(diagnostic.details["table"], json!("others"));
    assert_eq!(diagnostic.details["function"], json!("fn:writeOthers"));

    let after = snapback.run_function("readNotes", HandlerInput::default());
    assert_eq!(
        after.version.expect("query reports version"),
        version_before,
        "the refused write must not advance the durable version"
    );
}

#[test]
fn strict_mode_serves_declared_conformant_handlers() {
    let mut snapback = instance(true);
    let result = snapback.run_function("writeNotes", HandlerInput::default());
    assert!(
        result.ok,
        "declared-conformant mutation commits: {result:?}"
    );
    let report = conformance(&result);
    assert_eq!(report["missingWrites"], json!([]));
    assert_eq!(report["writeProvenance"], json!("complete"));
}

#[test]
fn default_posture_stays_declarations_as_evidence() {
    // OQ1 ruling (2026-08-03): a newly generated app does not opt in by
    // default — the manifest flag defaults off and drift is report-only.
    assert!(!SchemaManifest::default().strict_declarations);
    let mut snapback = instance(false);
    let result = snapback.run_function("writeOthers", HandlerInput::default());
    assert!(result.ok, "non-strict drift commits: {result:?}");
    let report = conformance(&result);
    assert_eq!(report["missingWrites"], json!(["others"]));
}

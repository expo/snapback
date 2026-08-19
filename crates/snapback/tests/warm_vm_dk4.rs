//! VM-lifecycle regressions for LLP 0009's retired DK-4 warm pool.
//!
//! Upstream Ibex runtimes are owner-thread-affine. Snapback therefore runs
//! each handler in a fresh runtime, including after an instance crosses worker
//! threads, and reports that posture in its capability manifest.

use serde_json::{Value, json};
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionRuntime, HandlerInput, IbexModule, SchemaManifest, TableManifest,
};

const MODULE_SOURCE: &str = r#"
let moduleCounter = 0;
globalThis.__snapbackHandlers = {
  async count() {
    moduleCounter += 1;
    return [{ n: moduleCounter }];
  },
  async writeGlobal() {
    globalThis.snapbackResidue = "present";
    return [];
  },
  async readGlobal() {
    return [{ residue: typeof globalThis.snapbackResidue }];
  },
  async insert(ctx, args) {
    return await ctx.db.insert("items", { n: args.n });
  },
  async list(ctx) {
    return await ctx.db.query("items").order("_createdAt", "asc").collect();
  }
};
"#;

fn configured() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("snapback");
    snapback
        .apply_schema(SchemaManifest {
            schema_hash: Some("fresh-vm-v0".to_owned()),
            tables: vec![TableManifest {
                name: "items".to_owned(),
                fields: vec![FieldManifest {
                    name: "n".to_owned(),
                    field_type: FieldType::Integer,
                    optional: false,
                }],
                indexes: Vec::new(),
                search_indexes: Vec::new(),
                vector_indexes: Vec::new(),
                search_live_limits: None,
                syncable: true,
                permission_backing: false,
                permission_fields: None,
                membership: None,
                authority_profile: None,
                asset_sharing: None,
                visibility: Some(snapback::manifest::TableVisibilityV1::PublicRead),
                history: None,
            }],
            ..SchemaManifest::default()
        })
        .expect("schema");
    let function = |name: &str, kind| {
        FunctionDefinition::new(
            name,
            kind,
            FunctionRuntime::IbexModule(IbexModule {
                source: MODULE_SOURCE.to_owned(),
                export: name.to_owned(),
            }),
        )
    };
    snapback.load_functions(FunctionManifest {
        functions: vec![
            function("count", FunctionKind::Query),
            function("writeGlobal", FunctionKind::Mutation),
            function("readGlobal", FunctionKind::Query),
            function("insert", FunctionKind::Mutation),
            function("list", FunctionKind::Query),
        ],
        ..FunctionManifest::default()
    });
    snapback
}

fn input(args: Value) -> HandlerInput {
    HandlerInput {
        args,
        auth: AuthInput::default(),
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    }
}

fn count(snapback: &LocalSnapback) -> u64 {
    snapback
        .invoke_query("count", input(json!({})))
        .expect("count")
        .rows[0]["n"]
        .as_u64()
        .expect("counter")
}

#[test]
fn fresh_vm_does_not_retain_module_or_global_state() {
    let mut snapback = configured();
    assert_eq!(count(&snapback), 1);
    assert_eq!(count(&snapback), 1, "module state must start fresh");
    snapback
        .invoke_mutation("writeGlobal", input(json!({})))
        .expect("write global");
    let row = &snapback
        .invoke_query("readGlobal", input(json!({})))
        .expect("read global")
        .rows[0];
    assert_eq!(row["residue"], "undefined");
}

#[test]
fn capability_manifest_reports_fresh_per_invocation() {
    let mut snapback = configured();
    assert_eq!(
        snapback
            .inspect()
            .expect("inspect")
            .capability_manifest
            .vm_lifecycle,
        "fresh-per-invocation"
    );
}

#[test]
fn instance_can_cross_threads_without_moving_an_ibex_runtime() {
    let mut snapback = configured();
    assert_eq!(count(&snapback), 1);
    snapback
        .invoke_mutation("insert", input(json!({ "n": 1 })))
        .expect("main-thread mutation");

    let snapback = std::thread::spawn(move || {
        assert_eq!(count(&snapback), 1);
        snapback
    })
    .join()
    .expect("worker");

    let rows = snapback
        .invoke_query("list", input(json!({})))
        .expect("main-thread query")
        .rows;
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0]["n"], 1);
}

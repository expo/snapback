//! Shared finite Ibex benchmark fixture (schema, functions, handler input).
//!
//! Both the transport-owned harness (`crate::bench`) and the background-owned
//! telemetry evidence harness (`crate::telemetry`'s phase-1 bench) exercise
//! this exact fixture. It lives below both so neither imports upward; it
//! depends only on the shared manifest contract types.
//!
//! @ref LLP 0225#1-ownership-map — background-services may not depend on
//!   transport-adapters, so the fixture the two harnesses share sits with the
//!   background owner rather than inside `bench.rs`.

use serde_json::Value;

use crate::manifest::{
    AuthInput, FieldManifest, FieldType, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionRuntime, HandlerInput, IbexModule, SchemaManifest, TableManifest,
};

#[doc(hidden)]
pub const HANDLER_SOURCE: &str = r#"
globalThis.__snapbackHandlers = {
  async noop(ctx) { return []; },
  async listTodos(ctx) {
    return await ctx.db.query('todos').order('_createdAt', 'asc').collect();
  },
  async createTodo(ctx, args) {
    return await ctx.db.insert('todos', { title: args.title, done: false });
  },
  async touchTodo(ctx, args) {
    return (await ctx.db.patch('todos', args.id, { title: args.title })) ? args.id : null;
  },
  async listOthers(ctx) {
    return await ctx.db.query('others').order('_createdAt', 'asc').collect();
  },
  async createOther(ctx, args) {
    return await ctx.db.insert('others', { label: args.label });
  },
};
"#;

#[doc(hidden)]
pub fn schema() -> SchemaManifest {
    let string_field = |name: &str| FieldManifest {
        name: name.to_owned(),
        field_type: FieldType::String,
        optional: false,
    };
    SchemaManifest {
        schema_hash: Some("bench-v0".to_owned()),
        inputs_hash: Some("bench-inputs-v0".to_owned()),
        tables: vec![
            TableManifest {
                name: "todos".to_owned(),
                fields: vec![
                    string_field("title"),
                    FieldManifest {
                        name: "done".to_owned(),
                        field_type: FieldType::Boolean,
                        optional: false,
                    },
                ],
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
                visibility: Some(crate::manifest::TableVisibilityV1::PublicRead),
                history: None,
            },
            TableManifest {
                name: "others".to_owned(),
                fields: vec![string_field("label")],
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
                visibility: Some(crate::manifest::TableVisibilityV1::PublicRead),
                history: None,
            },
        ],
        ..SchemaManifest::default()
    }
}

#[doc(hidden)]
pub fn functions() -> FunctionManifest {
    let live_query = |name: &str, table: &str| {
        let mut def = FunctionDefinition::new(
            name,
            FunctionKind::LiveQuery,
            FunctionRuntime::IbexModule(IbexModule {
                source: HANDLER_SOURCE.to_owned(),
                export: name.to_owned(),
            }),
        );
        def.required_capabilities = vec![
            "live_subscriptions".to_owned(),
            "ibex_ctx_db_host_bridge".to_owned(),
        ];
        def.read_set_summary.primary_table = Some(table.to_owned());
        def.read_set_summary.tables = vec![table.to_owned()];
        def.read_set_summary.mode = Some("handlerDeclared".to_owned());
        def
    };
    // DK-4 measures the reusable finite-query profile. Auth-scoped live
    // queries intentionally use a protected fresh realm, so registering this
    // no-data probe as LiveQuery would make the "warm" and forced-fresh
    // measurements exercise the same path.
    let noop = FunctionDefinition::new(
        "noop",
        FunctionKind::Query,
        FunctionRuntime::IbexModule(IbexModule {
            source: HANDLER_SOURCE.to_owned(),
            export: "noop".to_owned(),
        }),
    );
    let mutation = |name: &str, table: &str| {
        let mut def = FunctionDefinition::new(
            name,
            FunctionKind::Mutation,
            FunctionRuntime::IbexModule(IbexModule {
                source: HANDLER_SOURCE.to_owned(),
                export: name.to_owned(),
            }),
        );
        def.required_capabilities = vec![
            "ibex_ctx_db_host_bridge".to_owned(),
            "mutation_read_set_validation".to_owned(),
        ];
        def.write_set_summary.primary_table = Some(table.to_owned());
        def.write_set_summary.tables = vec![table.to_owned()];
        def.write_set_summary.mode = Some("handlerDeclared".to_owned());
        def
    };
    FunctionManifest {
        bundle_hash: Some("bench-functions-v0".to_owned()),
        inputs_hash: Some("bench-inputs-v0".to_owned()),
        functions: vec![
            noop,
            live_query("listTodos", "todos"),
            live_query("listOthers", "others"),
            mutation("createTodo", "todos"),
            mutation("touchTodo", "todos"),
            mutation("createOther", "others"),
        ],
        ..FunctionManifest::default()
    }
}

#[doc(hidden)]
pub fn auth() -> AuthInput {
    AuthInput {
        principal: Some("bench".to_owned()),
        session_id: None,
        user_id: Some("bench".to_owned()),
        ..AuthInput::default()
    }
}

#[doc(hidden)]
pub fn args(value: Value) -> HandlerInput {
    HandlerInput {
        args: value,
        auth: auth(),
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    }
}

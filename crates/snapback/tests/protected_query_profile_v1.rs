//! LLP 0053 protected-query admission and invocation profile.

use std::collections::BTreeMap;

use serde_json::json;
use snapback::local::LocalSnapback;
use snapback::manifest::{
    AuthInput, FilterExpr, FilterOp, FunctionDefinition, FunctionKind, FunctionManifest,
    FunctionRuntime, HandlerInput, HandlerPlan, IbexModule, QueryPlan, ValueExpr,
};

fn host_live_with(value: ValueExpr) -> FunctionDefinition {
    FunctionDefinition::new(
        "protectedHost",
        FunctionKind::LiveQuery,
        FunctionRuntime::HostPlan(HandlerPlan::Query(QueryPlan {
            table_visibility: None,
            table: "todos".to_owned(),
            filters: vec![FilterExpr {
                field: "ownerId".to_owned(),
                op: FilterOp::Eq,
                value,
            }],
            order: Vec::new(),
            limit: None,
            membership_filters: Vec::new(),
            indexed_by: None,
        })),
    )
}

fn manifest_error(function: FunctionDefinition) -> snapback::diagnostic::SnapbackError {
    FunctionManifest {
        functions: vec![function],
        ..FunctionManifest::default()
    }
    .validate_artifact()
    .expect_err("protected input must fail at manifest load")
    .into()
}

#[test]
fn protected_hostplan_walk_is_recursive_and_typed() {
    let mut fields = BTreeMap::new();
    fields.insert(
        "nested".to_owned(),
        ValueExpr::Call {
            func: "coalesce".to_owned(),
            args: vec![ValueExpr::Literal(json!(null)), ValueExpr::RuntimeNow],
        },
    );
    let clock = manifest_error(host_live_with(ValueExpr::Field {
        base: Box::new(ValueExpr::Record { fields }),
        key: "nested".to_owned(),
    }));
    assert_eq!(
        clock.diagnostic.code,
        "SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY"
    );
    assert_eq!(clock.diagnostic.details["inputKind"], "RuntimeNow");

    let generated_id = manifest_error(host_live_with(ValueExpr::If {
        cond: Box::new(ValueExpr::Literal(json!(true))),
        then: Box::new(ValueExpr::Concat(vec![ValueExpr::RuntimeId])),
        r#else: Box::new(ValueExpr::Literal(json!("fixed"))),
    }));
    assert_eq!(
        generated_id.diagnostic.code,
        "SNAPBACK_AUTH_MUTABLE_INPUT_DENIED"
    );
    assert_eq!(generated_id.diagnostic.details["inputKind"], "RuntimeId");
}

const PROTECTED_MODULE: &str = r#"
let counter = 0;
globalThis.__snapbackHandlers = {
  async freshCounter() { counter += 1; return [{ n: counter }]; },
  async aliasedNow(ctx) {
    const runtime = ctx.runtime;
    return [{ value: await runtime["now"]() }];
  },
  async aliasedId(ctx) {
    const runtime = ctx["runtime"];
    return [{ value: await runtime.id() }];
  }
};
"#;

fn ibex(name: &str, kind: FunctionKind) -> FunctionDefinition {
    FunctionDefinition::new(
        name,
        kind,
        FunctionRuntime::IbexModule(IbexModule {
            source: PROTECTED_MODULE.to_owned(),
            export: name.to_owned(),
        }),
    )
}

fn input() -> HandlerInput {
    HandlerInput {
        args: json!({}),
        auth: AuthInput::default(),
        read_set: Vec::new(),
        correlation: None,
        ctx_ledger: None,
    }
}

fn configured() -> LocalSnapback {
    let mut snapback = LocalSnapback::memory().expect("local Snapback");
    snapback.load_functions(FunctionManifest {
        functions: vec![
            ibex("freshCounter", FunctionKind::LiveQuery),
            ibex("aliasedNow", FunctionKind::LiveQuery),
            ibex("aliasedId", FunctionKind::LiveQuery),
        ],
        ..FunctionManifest::default()
    });
    snapback
}

#[test]
fn protected_ibex_uses_a_fresh_module_graph_every_time() {
    let snapback = configured();
    for _ in 0..2 {
        let output = snapback
            .invoke_query("freshCounter", input())
            .expect("protected query");
        assert_eq!(output.rows[0]["n"], 1, "module lexical state must reset");
    }
}

#[test]
fn protected_runtime_gate_catches_dynamic_clock_and_id_aliases() {
    let snapback = configured();
    let clock = snapback
        .invoke_query("aliasedNow", input())
        .expect_err("dynamic clock alias must be refused");
    assert_eq!(
        clock.diagnostic.code,
        "SNAPBACK_AUTH_CLOCK_DEPENDENT_VISIBILITY"
    );

    let generated_id = snapback
        .invoke_query("aliasedId", input())
        .expect_err("dynamic id alias must be refused");
    assert_eq!(
        generated_id.diagnostic.code,
        "SNAPBACK_AUTH_MUTABLE_INPUT_DENIED"
    );
}

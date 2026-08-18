//! Bounded size witness for LLP 0129 Phase 2a.
//!
//! This crate path-imports Snapback's exact pure Rust `value_expr` and
//! `result_transform` evaluators. The small shims below reproduce only the
//! data types and error methods those source files require, avoiding the
//! server crate's Hermes, SQLite, HTTP, and async dependency graph. The C ABI
//! exports keep parsing, validation, evaluation, hashing, and serialization in
//! the linked artifact; this is a payload anchor, not a browser handler host.

use serde::{Deserialize, Serialize};
use serde_json::Value;
use std::collections::BTreeMap;

pub mod diagnostic {
    use serde_json::Value;

    #[derive(Debug)]
    pub struct SnapbackError {
        pub code: String,
        pub subsystem: String,
        pub message: String,
        pub details: Value,
    }

    impl SnapbackError {
        pub fn error(
            code: impl Into<String>,
            subsystem: impl Into<String>,
            message: impl Into<String>,
        ) -> Self {
            Self {
                code: code.into(),
                subsystem: subsystem.into(),
                message: message.into(),
                details: Value::Object(Default::default()),
            }
        }

        pub fn with_details(mut self, details: Value) -> Self {
            self.details = details;
            self
        }
    }

    pub type SnapbackResult<T> = Result<T, SnapbackError>;
}

pub mod manifest {
    use super::*;

    #[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
    pub struct ActionPlan {
        #[serde(default)]
        pub steps: Vec<ActionStep>,
        #[serde(default, rename = "returnValue", alias = "return_value")]
        pub return_value: Option<ActionReturnValue>,
    }

    #[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
    pub enum ActionStep {
        RunMutation {
            name: String,
            #[serde(default)]
            args: BTreeMap<String, ValueExpr>,
            #[serde(default, rename = "bindResultAs", alias = "bind_result_as")]
            bind_result_as: Option<String>,
        },
    }

    #[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
    pub enum ActionReturnValue {
        Literal(Value),
        Binding(String),
        LastMutationResult,
        ChangedCount,
    }

    #[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
    pub struct MutationPlan {
        #[serde(default)]
        pub steps: Vec<MutationStep>,
        pub return_value: Option<ReturnValue>,
    }

    #[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
    pub enum MutationStep {
        AllocateSequence {
            counter: String,
            scope: ValueExpr,
            into: String,
        },
        Insert {
            table: String,
            values: BTreeMap<String, ValueExpr>,
            bind_id_as: Option<String>,
        },
        Patch {
            table: String,
            id: ValueExpr,
            values: BTreeMap<String, ValueExpr>,
        },
        Delete {
            table: String,
            id: ValueExpr,
        },
        Get {
            table: String,
            id: ValueExpr,
            bind_as: String,
            else_error: Option<String>,
        },
        Guard {
            cond: ValueExpr,
            else_error: String,
        },
        AssertCurrentRelation {
            table: String,
            id: ValueExpr,
            scope_table: String,
            scope_id: ValueExpr,
            foreign_key_field: String,
            incarnation_field: String,
            else_error: String,
        },
        Let {
            bind_as: String,
            expr: ValueExpr,
        },
        DeleteWhere {
            table: String,
            filter: Vec<FilterExpr>,
        },
        InsertEach {
            table: String,
            source: ValueExpr,
            item_as: String,
            values: BTreeMap<String, ValueExpr>,
        },
        AssertSourceChanged {
            table: String,
            id: ValueExpr,
            operation: WriteWithActivitySourceOperation,
        },
    }

    #[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
    pub enum ReturnValue {
        Literal(Value),
        Binding(String),
        Document { table: String, id: ValueExpr },
        ChangedCount,
        Expr(ValueExpr),
    }

    #[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
    pub struct FilterExpr {
        pub field: String,
        pub op: FilterOp,
        pub value: ValueExpr,
    }

    #[derive(Clone, Debug, Deserialize, Eq, PartialEq, Serialize)]
    pub enum FilterOp {
        Eq,
        In,
        Lt,
        Lte,
        Gt,
        Gte,
    }

    #[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
    #[serde(rename_all = "lowercase")]
    pub enum WriteWithActivitySourceOperation {
        Insert,
        Patch,
        Delete,
    }

    #[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
    #[serde(deny_unknown_fields)]
    pub struct MembershipPredicate {
        pub declaration: String,
        pub resource: MembershipResourceRef,
        #[serde(default, skip_serializing_if = "Option::is_none")]
        pub roles: Option<Vec<String>>,
    }

    #[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
    #[serde(rename_all = "camelCase", deny_unknown_fields)]
    pub enum MembershipResourceRef {
        RowField(String),
        Arg {
            path: String,
            #[serde(rename = "resourceTable", alias = "resource_table")]
            resource_table: Option<String>,
        },
    }

    #[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
    pub enum ValueExpr {
        Arg(String),
        Args,
        AuthUserId,
        AuthKind,
        AuthActorKind,
        AuthActivityActorKind,
        AuthActorUserId,
        AuthGrantId,
        ClientMutationDigest,
        AuthIsDelegated,
        Binding(String),
        Literal(Value),
        RuntimeId,
        RuntimeNow,
        Field {
            base: Box<ValueExpr>,
            key: String,
        },
        Binary {
            op: BinaryOp,
            left: Box<ValueExpr>,
            right: Box<ValueExpr>,
        },
        Unary {
            op: UnaryOp,
            expr: Box<ValueExpr>,
        },
        If {
            cond: Box<ValueExpr>,
            then: Box<ValueExpr>,
            #[serde(rename = "else")]
            r#else: Box<ValueExpr>,
        },
        Concat(Vec<ValueExpr>),
        Call {
            func: String,
            args: Vec<ValueExpr>,
        },
        Record {
            fields: BTreeMap<String, ValueExpr>,
        },
        MembershipExists(Box<MembershipPredicate>),
    }

    #[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
    pub enum BinaryOp {
        Add,
        Sub,
        Mul,
        Div,
        Mod,
        Eq,
        Ne,
        Lt,
        Lte,
        Gt,
        Gte,
        And,
        Or,
    }

    #[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq, Serialize)]
    pub enum UnaryOp {
        Not,
        Neg,
    }
}

#[path = "../../../../../../../crates/snapback/src/value_expr.rs"]
mod value_expr;
#[path = "../../../../../../../crates/snapback/src/result_transform.rs"]
mod result_transform;

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExprRequest {
    expr: manifest::ValueExpr,
    #[serde(default)]
    args: Value,
    #[serde(default)]
    bindings: BTreeMap<String, Value>,
}

/// Parse and evaluate an expression supplied by the browser host. Returning a
/// digest-shaped scalar keeps all evaluator branches live without introducing
/// a wasm-bindgen or allocator ABI into this size witness.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn snapback_poc_eval_value_expr(ptr: *const u8, len: usize) -> usize {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let Ok(request) = serde_json::from_slice::<ExprRequest>(bytes) else {
        return 0;
    };
    let runtime_id = |_site: &str| Ok("poc-id".to_owned());
    let env = value_expr::ExprEnv {
        args: &request.args,
        auth_user_id: Some("poc-user"),
        auth_kind: Some("session"),
        auth_actor_kind: None,
        auth_activity_actor_kind: Some("human"),
        auth_actor_user_id: Some("poc-user"),
        auth_grant_id: None,
        client_mutation_digest: Some("poc-digest"),
        auth_is_delegated: false,
        bindings: Some(&request.bindings),
        now_ms: Some(1_754_390_400_000),
        runtime_id: Some(&runtime_id),
    };
    value_expr::eval_value_expr(&request.expr, &env)
        .ok()
        .and_then(|value| serde_json::to_vec(&value).ok())
        .map_or(0, |output| output.len())
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn snapback_poc_validate_mutation_plan(
    ptr: *const u8,
    len: usize,
) -> usize {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    serde_json::from_slice::<manifest::MutationPlan>(bytes)
        .ok()
        .and_then(|plan| value_expr::validate_mutation_plan(&plan).ok())
        .map_or(0, |_| 1)
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn snapback_poc_validate_action_plan(
    ptr: *const u8,
    len: usize,
) -> usize {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    serde_json::from_slice::<manifest::ActionPlan>(bytes)
        .ok()
        .and_then(|plan| value_expr::validate_action_plan(&plan).ok())
        .map_or(0, |_| 1)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TransformRequest {
    plan: Value,
    materialization_key: String,
    projected_fields: Vec<String>,
    base: Value,
    #[serde(default)]
    optimistic_rows: Option<Vec<Value>>,
}

#[unsafe(no_mangle)]
pub unsafe extern "C" fn snapback_poc_eval_result_transform(
    ptr: *const u8,
    len: usize,
) -> usize {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let Ok(request) = serde_json::from_slice::<TransformRequest>(bytes) else {
        return 0;
    };
    let outcome = result_transform::outcome_value(result_transform::evaluate_result_transform_v1(
        &request.plan,
        &request.materialization_key,
        &request.projected_fields,
        &request.base,
        request.optimistic_rows.as_deref(),
    ));
    serde_json::to_vec(&outcome).map_or(0, |output| output.len())
}

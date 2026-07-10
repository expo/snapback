//! The shared `ValueExpr` evaluator for the data-tier v1 profile.
//!
//! One evaluator serves every consumer — mutation execution (`storage.rs`),
//! the live matcher (`live_matcher.rs`), and filter→SQL compilation — so
//! matcher/SQL/mutation semantics cannot drift per call site. The profile is
//! deliberately closed: a finite expression set plus a pinned function
//! library, so every evaluator in every language is finite work.
//!
//! Value-model rules pinned here (and by the data-tier corpus,
//! `tests/conformance/data-tier/`):
//! - Field access is by arbitrary string key; access on null/absent yields
//!   null (never a type error). Arrays index by decimal-string keys.
//! - Arithmetic and ordering comparisons with a null operand yield null
//!   (three-valued, matching the live-filter NULL semantics of LLP 0008),
//!   *not* JS null-coercion.
//! - `And`/`Or` are value-returning over truthiness (JS-style: null, false,
//!   0, NaN, and "" are falsy; objects and arrays are truthy).
//! - Numbers evaluate in f64; integral finite results within the safe range
//!   serialize as JSON integers (JS `JSON.stringify` parity).
//! - `Eq`/`Ne` are deep value equality with cross-representation numeric
//!   comparison; NaN is not equal to NaN.
//!
//! @ref LLP 0051#d2-promote-the-mutation-ir-extend-it-to-the-common-mutation —
//!   the v1 expression profile, its closed function library, and the
//!   null-propagation/defaulting semantics the demo corpus decided.

use crate::diagnostic::{SnapbackError, SnapbackResult};
use crate::manifest::{BinaryOp, UnaryOp, ValueExpr};
use serde_json::{Map, Value, json};
use std::collections::BTreeMap;

/// Data-tier profile version shared by the IR, its bounds, and the corpus
/// cases that pin its semantics (LLP 0051 D5's shared version).
pub const DATA_TIER_PROFILE_VERSION: u32 = 1;

/// Declared plan bounds — versioned with the profile and enforced, not
/// assumed: an expression tree is still CPU and memory (LLP 0051 D2).
pub const MAX_PLAN_STEPS: usize = 64;
pub const MAX_EXPR_DEPTH: usize = 32;
pub const MAX_INSERT_EACH_FANOUT: usize = 1024;
pub const MAX_PLAN_SERIALIZED_BYTES: usize = 65_536;

/// The pinned expression function library: small, versioned, corpus-pinned.
/// Growing this list is a profile-version event, not a convenience edit.
pub const PINNED_FUNCTIONS: &[&str] = &[
    "len", "trim", "lower", "abs", "min", "max", "round", "floor", "ceil", "coalesce",
];

/// What the evaluation environment can answer. The matcher deliberately
/// evaluates without bindings or runtime intrinsics: expressions that need
/// them are unanalyzable for delta maintenance and fall back to
/// `live_replace`, the honest default.
pub struct ExprEnv<'a> {
    pub args: &'a Value,
    pub auth_user_id: Option<&'a str>,
    pub bindings: Option<&'a BTreeMap<String, Value>>,
    pub now_ms: Option<u64>,
    /// Fresh-id source (`RuntimeId`). Pluggable because callers differ
    /// (storage `new_id`, cron actions use the store's generator); absent in
    /// the matcher, where `RuntimeId` is unanalyzable by definition.
    pub runtime_id: Option<&'a dyn Fn() -> SnapbackResult<String>>,
}

pub enum ExprError {
    /// The environment cannot answer (no bindings / no clock / no id source).
    /// The live matcher maps this to "unanalyzable"; mutation execution never
    /// sees it because its environment is complete.
    Unanalyzable(&'static str),
    /// A typed evaluation failure.
    Fail(SnapbackError),
}

impl ExprError {
    fn type_error(message: impl Into<String>) -> Self {
        ExprError::Fail(SnapbackError::error(
            "SNAPBACK_EXPR_TYPE",
            "runtime",
            message,
        ))
    }

    pub fn into_snapback(self) -> SnapbackError {
        match self {
            ExprError::Fail(error) => error,
            ExprError::Unanalyzable(what) => SnapbackError::error(
                "SNAPBACK_EXPR_UNANALYZABLE",
                "runtime",
                format!("expression form {what} is not available in this context"),
            ),
        }
    }
}

pub type ExprResult = Result<Value, ExprError>;

pub fn eval_value_expr(expr: &ValueExpr, env: &ExprEnv<'_>) -> ExprResult {
    eval_at_depth(expr, env, 0)
}

fn eval_at_depth(expr: &ValueExpr, env: &ExprEnv<'_>, depth: usize) -> ExprResult {
    if depth > MAX_EXPR_DEPTH {
        return Err(ExprError::Fail(SnapbackError::error(
            "SNAPBACK_PLAN_BOUNDS",
            "runtime",
            format!("expression depth exceeds the declared bound ({MAX_EXPR_DEPTH})"),
        )));
    }
    match expr {
        ValueExpr::Arg(path) => lookup_path(env.args, path).cloned().ok_or_else(|| {
            ExprError::Fail(SnapbackError::error(
                "SNAPBACK_ARG_MISSING",
                "runtime",
                format!("handler arg {path} was not provided"),
            ))
        }),
        ValueExpr::Args => Ok(env.args.clone()),
        ValueExpr::AuthUserId => env
            .auth_user_id
            .map(|id| Value::String(id.to_owned()))
            .ok_or_else(|| {
                ExprError::Fail(SnapbackError::error(
                    "SNAPBACK_AUTH_USER_MISSING",
                    "runtime",
                    "handler requested auth.user_id but no user was supplied",
                ))
            }),
        ValueExpr::Binding(name) => match env.bindings {
            None => Err(ExprError::Unanalyzable("Binding")),
            Some(bindings) => bindings.get(name).cloned().ok_or_else(|| {
                ExprError::Fail(SnapbackError::error(
                    "SNAPBACK_BINDING_MISSING",
                    "runtime",
                    format!("handler binding {name} was not available"),
                ))
            }),
        },
        ValueExpr::Literal(value) => Ok(value.clone()),
        ValueExpr::RuntimeId => match env.runtime_id {
            Some(generate) => generate().map(Value::String).map_err(ExprError::Fail),
            None => Err(ExprError::Unanalyzable("RuntimeId")),
        },
        ValueExpr::RuntimeNow => match env.now_ms {
            Some(now_ms) => Ok(json!(now_ms)),
            None => Err(ExprError::Unanalyzable("RuntimeNow")),
        },
        ValueExpr::Field { base, key } => {
            let base = eval_at_depth(base, env, depth + 1)?;
            Ok(field_access(&base, key))
        }
        ValueExpr::Binary { op, left, right } => {
            let left = eval_at_depth(left, env, depth + 1)?;
            let right = eval_at_depth(right, env, depth + 1)?;
            eval_binary(*op, left, right)
        }
        ValueExpr::Unary { op, expr } => {
            let value = eval_at_depth(expr, env, depth + 1)?;
            match op {
                UnaryOp::Not => Ok(Value::Bool(!truthy(&value))),
                UnaryOp::Neg => {
                    if value.is_null() {
                        return Ok(Value::Null);
                    }
                    let number = as_number(&value)
                        .ok_or_else(|| ExprError::type_error("Neg expects a number"))?;
                    Ok(number_value(-number))
                }
            }
        }
        ValueExpr::If {
            cond,
            then,
            r#else,
        } => {
            let cond = eval_at_depth(cond, env, depth + 1)?;
            if truthy(&cond) {
                eval_at_depth(then, env, depth + 1)
            } else {
                eval_at_depth(r#else, env, depth + 1)
            }
        }
        ValueExpr::Concat(parts) => {
            let mut output = String::new();
            for part in parts {
                let value = eval_at_depth(part, env, depth + 1)?;
                output.push_str(&stringify_for_concat(&value)?);
            }
            Ok(Value::String(output))
        }
        ValueExpr::Call { func, args } => {
            let mut values = Vec::with_capacity(args.len());
            for arg in args {
                values.push(eval_at_depth(arg, env, depth + 1)?);
            }
            eval_call(func, values)
        }
        ValueExpr::Record { fields } => {
            let mut output = Map::new();
            for (key, field_expr) in fields {
                output.insert(key.clone(), eval_at_depth(field_expr, env, depth + 1)?);
            }
            Ok(Value::Object(output))
        }
    }
}

/// Null-propagating access by arbitrary string key: hyphenated JSON keys are
/// first-class, arrays index by decimal string, and any miss is null — the
/// defaulting idiom composes with `coalesce` (LLP 0051 D2, settles 0329 EQ8).
fn field_access(base: &Value, key: &str) -> Value {
    match base {
        Value::Object(map) => map.get(key).cloned().unwrap_or(Value::Null),
        Value::Array(items) => key
            .parse::<usize>()
            .ok()
            .and_then(|index| items.get(index))
            .cloned()
            .unwrap_or(Value::Null),
        _ => Value::Null,
    }
}

fn eval_binary(op: BinaryOp, left: Value, right: Value) -> ExprResult {
    match op {
        BinaryOp::And => Ok(if truthy(&left) { right } else { left }),
        BinaryOp::Or => Ok(if truthy(&left) { left } else { right }),
        BinaryOp::Eq => Ok(Value::Bool(values_equal(&left, &right))),
        BinaryOp::Ne => Ok(Value::Bool(!values_equal(&left, &right))),
        BinaryOp::Add => {
            // String + string concatenates; otherwise numeric addition.
            if let (Value::String(a), Value::String(b)) = (&left, &right) {
                return Ok(Value::String(format!("{a}{b}")));
            }
            numeric_binary(op, &left, &right)
        }
        BinaryOp::Sub | BinaryOp::Mul | BinaryOp::Div | BinaryOp::Mod => {
            numeric_binary(op, &left, &right)
        }
        BinaryOp::Lt | BinaryOp::Lte | BinaryOp::Gt | BinaryOp::Gte => {
            if left.is_null() || right.is_null() {
                return Ok(Value::Null);
            }
            if let (Value::String(a), Value::String(b)) = (&left, &right) {
                let ordering = a.cmp(b);
                return Ok(Value::Bool(match op {
                    BinaryOp::Lt => ordering.is_lt(),
                    BinaryOp::Lte => ordering.is_le(),
                    BinaryOp::Gt => ordering.is_gt(),
                    BinaryOp::Gte => ordering.is_ge(),
                    _ => unreachable!(),
                }));
            }
            let (Some(a), Some(b)) = (as_number(&left), as_number(&right)) else {
                return Err(ExprError::type_error(
                    "ordering comparison expects two numbers or two strings",
                ));
            };
            Ok(Value::Bool(match op {
                BinaryOp::Lt => a < b,
                BinaryOp::Lte => a <= b,
                BinaryOp::Gt => a > b,
                BinaryOp::Gte => a >= b,
                _ => unreachable!(),
            }))
        }
    }
}

fn numeric_binary(op: BinaryOp, left: &Value, right: &Value) -> ExprResult {
    // Three-valued: a null operand yields null (matches the live-filter NULL
    // semantics; the corpus never relies on JS null-coercion).
    if left.is_null() || right.is_null() {
        return Ok(Value::Null);
    }
    let (Some(a), Some(b)) = (as_number(left), as_number(right)) else {
        return Err(ExprError::type_error(format!(
            "{op:?} expects numeric operands"
        )));
    };
    let result = match op {
        BinaryOp::Add => a + b,
        BinaryOp::Sub => a - b,
        BinaryOp::Mul => a * b,
        BinaryOp::Div => a / b,
        BinaryOp::Mod => {
            // JS `%` (remainder with dividend sign), not Euclidean modulo.
            a % b
        }
        _ => unreachable!("numeric_binary only handles arithmetic ops"),
    };
    Ok(number_value(result))
}

fn eval_call(func: &str, mut args: Vec<Value>) -> ExprResult {
    let arity = |expected: usize| -> Result<(), ExprError> {
        if args.len() == expected {
            Ok(())
        } else {
            Err(ExprError::type_error(format!(
                "{func} expects {expected} argument(s), got {}",
                args.len()
            )))
        }
    };
    match func {
        "coalesce" => Ok(args
            .drain(..)
            .find(|value| !value.is_null())
            .unwrap_or(Value::Null)),
        "len" => {
            arity(1)?;
            match &args[0] {
                Value::Null => Ok(Value::Null),
                // UTF-16 code units: JS `.length` parity, corpus-pinned.
                Value::String(s) => Ok(json!(s.encode_utf16().count())),
                Value::Array(items) => Ok(json!(items.len())),
                _ => Err(ExprError::type_error("len expects a string or array")),
            }
        }
        "trim" | "lower" => {
            arity(1)?;
            match &args[0] {
                Value::Null => Ok(Value::Null),
                Value::String(s) => Ok(Value::String(if func == "trim" {
                    s.trim().to_owned()
                } else {
                    s.to_lowercase()
                })),
                _ => Err(ExprError::type_error(format!("{func} expects a string"))),
            }
        }
        "abs" | "round" | "floor" | "ceil" => {
            arity(1)?;
            if args[0].is_null() {
                return Ok(Value::Null);
            }
            let number = as_number(&args[0])
                .ok_or_else(|| ExprError::type_error(format!("{func} expects a number")))?;
            let result = match func {
                "abs" => number.abs(),
                // JS Math.round: half-up toward +Infinity (not banker's, not
                // away-from-zero) — (-0.5).round() is -0 in JS, 0.5 -> 1.
                "round" => (number + 0.5).floor(),
                "floor" => number.floor(),
                "ceil" => number.ceil(),
                _ => unreachable!(),
            };
            Ok(number_value(result))
        }
        "min" | "max" => {
            if args.is_empty() {
                return Err(ExprError::type_error(format!(
                    "{func} expects at least one argument"
                )));
            }
            if args.iter().any(Value::is_null) {
                return Ok(Value::Null);
            }
            let mut best: Option<f64> = None;
            for value in &args {
                let number = as_number(value)
                    .ok_or_else(|| ExprError::type_error(format!("{func} expects numbers")))?;
                best = Some(match best {
                    None => number,
                    Some(current) => {
                        if (func == "min") == (number < current) {
                            number
                        } else {
                            current
                        }
                    }
                });
            }
            Ok(number_value(best.expect("at least one argument checked above")))
        }
        other => Err(ExprError::Fail(
            SnapbackError::error(
                "SNAPBACK_EXPR_UNSUPPORTED_FUNCTION",
                "runtime",
                format!("expression function {other} is not in the pinned v1 library"),
            )
            .with_details(json!({ "function": other, "pinned": PINNED_FUNCTIONS })),
        )),
    }
}

/// JS truthiness: null, false, 0, NaN, and "" are falsy; objects/arrays truthy.
pub fn truthy(value: &Value) -> bool {
    match value {
        Value::Null => false,
        Value::Bool(b) => *b,
        Value::Number(_) => as_number(value).map(|n| n != 0.0 && !n.is_nan()) == Some(true),
        Value::String(s) => !s.is_empty(),
        Value::Array(_) | Value::Object(_) => true,
    }
}

pub fn as_number(value: &Value) -> Option<f64> {
    value.as_f64()
}

/// Integral finite results in the safe range serialize as JSON integers —
/// `JSON.stringify(2)` parity so cross-engine corpus outputs match exactly.
pub fn number_value(number: f64) -> Value {
    const SAFE: f64 = 9_007_199_254_740_992.0; // 2^53
    if number.is_finite() && number.fract() == 0.0 && number.abs() <= SAFE {
        json!(number as i64)
    } else {
        json!(number)
    }
}

fn values_equal(left: &Value, right: &Value) -> bool {
    match (as_number(left), as_number(right)) {
        // Numeric compare across representations; NaN != NaN (JS parity).
        (Some(a), Some(b)) => a == b,
        _ => left == right,
    }
}

fn stringify_for_concat(value: &Value) -> Result<String, ExprError> {
    match value {
        Value::Null => Ok("null".to_owned()),
        Value::Bool(b) => Ok(b.to_string()),
        Value::String(s) => Ok(s.clone()),
        Value::Number(_) => {
            let number =
                as_number(value).ok_or_else(|| ExprError::type_error("unrepresentable number"))?;
            if number.is_finite() && number.fract() == 0.0 && number.abs() < 1e21 {
                Ok(format!("{}", number as i64))
            } else {
                Ok(format!("{number}"))
            }
        }
        Value::Array(_) | Value::Object(_) => Err(ExprError::type_error(
            "string templates cannot interpolate arrays or objects",
        )),
    }
}

pub fn lookup_path<'a>(value: &'a Value, path: &str) -> Option<&'a Value> {
    let mut current = value;
    for part in path.split('.') {
        current = current.as_object()?.get(part)?;
    }
    Some(current)
}

/// Static plan validation against the declared v1 bounds and the pinned
/// function library — fail-closed before any step executes, the same checks
/// codegen applies at authoring time. Rejection classes are corpus-pinned
/// (LLP 0051 D5): plan over bounds and unsupported expression forms are
/// typed rejections, never best-effort execution.
pub fn validate_mutation_plan(plan: &crate::manifest::MutationPlan) -> Result<(), SnapbackError> {
    use crate::manifest::{MutationStep, ReturnValue};

    let bounds_error = |message: String| {
        SnapbackError::error("SNAPBACK_PLAN_BOUNDS", "runtime", message).with_details(json!({
            "profileVersion": DATA_TIER_PROFILE_VERSION,
            "maxSteps": MAX_PLAN_STEPS,
            "maxExprDepth": MAX_EXPR_DEPTH,
            "maxInsertEachFanout": MAX_INSERT_EACH_FANOUT,
            "maxSerializedBytes": MAX_PLAN_SERIALIZED_BYTES,
        }))
    };

    if plan.steps.len() > MAX_PLAN_STEPS {
        return Err(bounds_error(format!(
            "plan has {} steps; the declared bound is {MAX_PLAN_STEPS}",
            plan.steps.len()
        )));
    }
    let serialized = serde_json::to_vec(plan).map_err(|error| {
        SnapbackError::error(
            "SNAPBACK_PLAN_INVALID",
            "runtime",
            format!("mutation plan failed to serialize: {error}"),
        )
    })?;
    if serialized.len() > MAX_PLAN_SERIALIZED_BYTES {
        return Err(bounds_error(format!(
            "plan serializes to {} bytes; the declared bound is {MAX_PLAN_SERIALIZED_BYTES}",
            serialized.len()
        )));
    }

    let mut exprs: Vec<&ValueExpr> = Vec::new();
    for step in &plan.steps {
        match step {
            MutationStep::Insert { values, .. } => exprs.extend(values.values()),
            MutationStep::Patch { id, values, .. } => {
                exprs.push(id);
                exprs.extend(values.values());
            }
            MutationStep::Delete { id, .. } => exprs.push(id),
            MutationStep::Get { id, .. } => exprs.push(id),
            MutationStep::Guard { cond, .. } => exprs.push(cond),
            MutationStep::Let { expr, .. } => exprs.push(expr),
            MutationStep::DeleteWhere { filter, .. } => {
                exprs.extend(filter.iter().map(|f| &f.value))
            }
            MutationStep::InsertEach { source, values, .. } => {
                exprs.push(source);
                exprs.extend(values.values());
            }
        }
    }
    match &plan.return_value {
        Some(ReturnValue::Document { id, .. }) => exprs.push(id),
        Some(ReturnValue::Expr(expr)) => exprs.push(expr),
        _ => {}
    }
    for expr in exprs {
        validate_expr(expr, 0)?;
    }
    Ok(())
}

fn validate_expr(expr: &ValueExpr, depth: usize) -> Result<(), SnapbackError> {
    if depth > MAX_EXPR_DEPTH {
        return Err(SnapbackError::error(
            "SNAPBACK_PLAN_BOUNDS",
            "runtime",
            format!("expression depth exceeds the declared bound ({MAX_EXPR_DEPTH})"),
        ));
    }
    match expr {
        ValueExpr::Arg(_)
        | ValueExpr::Args
        | ValueExpr::AuthUserId
        | ValueExpr::Binding(_)
        | ValueExpr::Literal(_)
        | ValueExpr::RuntimeId
        | ValueExpr::RuntimeNow => Ok(()),
        ValueExpr::Field { base, .. } => validate_expr(base, depth + 1),
        ValueExpr::Binary { left, right, .. } => {
            validate_expr(left, depth + 1)?;
            validate_expr(right, depth + 1)
        }
        ValueExpr::Unary { expr, .. } => validate_expr(expr, depth + 1),
        ValueExpr::If { cond, then, r#else } => {
            validate_expr(cond, depth + 1)?;
            validate_expr(then, depth + 1)?;
            validate_expr(r#else, depth + 1)
        }
        ValueExpr::Concat(parts) => {
            for part in parts {
                validate_expr(part, depth + 1)?;
            }
            Ok(())
        }
        ValueExpr::Call { func, args } => {
            if !PINNED_FUNCTIONS.contains(&func.as_str()) {
                return Err(SnapbackError::error(
                    "SNAPBACK_EXPR_UNSUPPORTED_FUNCTION",
                    "runtime",
                    format!("expression function {func} is not in the pinned v1 library"),
                )
                .with_details(json!({ "function": func, "pinned": PINNED_FUNCTIONS })));
            }
            for arg in args {
                validate_expr(arg, depth + 1)?;
            }
            Ok(())
        }
        ValueExpr::Record { fields } => {
            for field in fields.values() {
                validate_expr(field, depth + 1)?;
            }
            Ok(())
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn test_id() -> SnapbackResult<String> {
        Ok("id-test".to_owned())
    }

    fn env<'a>(args: &'a Value, bindings: &'a BTreeMap<String, Value>) -> ExprEnv<'a> {
        ExprEnv {
            args,
            auth_user_id: Some("user-1"),
            bindings: Some(bindings),
            now_ms: Some(1_000),
            runtime_id: Some(&test_id),
        }
    }

    fn eval(expr: &ValueExpr, args: &Value) -> Value {
        let bindings = BTreeMap::new();
        eval_value_expr(expr, &env(args, &bindings))
            .map_err(|e| e.into_snapback())
            .expect("expression evaluates")
    }

    #[test]
    fn field_access_null_propagates() {
        let args = json!({ "tick": { "delays": { "sb-local": 90 } } });
        let expr = ValueExpr::Field {
            base: Box::new(ValueExpr::Field {
                base: Box::new(ValueExpr::Arg("tick".into())),
                key: "delays".into(),
            }),
            key: "sb-local".into(),
        };
        assert_eq!(eval(&expr, &args), json!(90));

        let missing = ValueExpr::Field {
            base: Box::new(ValueExpr::Field {
                base: Box::new(ValueExpr::Args),
                key: "absent".into(),
            }),
            key: "sb-local".into(),
        };
        assert_eq!(eval(&missing, &args), Value::Null);
    }

    #[test]
    fn arithmetic_is_three_valued_and_js_integral() {
        let args = json!({});
        let modulo = ValueExpr::Binary {
            op: BinaryOp::Mod,
            left: Box::new(ValueExpr::Literal(json!(7))),
            right: Box::new(ValueExpr::Literal(json!(3))),
        };
        assert_eq!(eval(&modulo, &args), json!(1));

        let with_null = ValueExpr::Binary {
            op: BinaryOp::Add,
            left: Box::new(ValueExpr::Literal(Value::Null)),
            right: Box::new(ValueExpr::Literal(json!(1))),
        };
        assert_eq!(eval(&with_null, &args), Value::Null);
    }

    #[test]
    fn clamp_idiom_matches_corpus() {
        // max(-300, min(3600, round(x)))
        let args = json!({ "delay": 3999.6 });
        let expr = ValueExpr::Call {
            func: "max".into(),
            args: vec![
                ValueExpr::Literal(json!(-300)),
                ValueExpr::Call {
                    func: "min".into(),
                    args: vec![
                        ValueExpr::Literal(json!(3600)),
                        ValueExpr::Call {
                            func: "round".into(),
                            args: vec![ValueExpr::Arg("delay".into())],
                        },
                    ],
                },
            ],
        };
        assert_eq!(eval(&expr, &args), json!(3600));
    }

    #[test]
    fn concat_formats_integers_without_decimals() {
        let args = json!({ "n": 3.0 });
        let expr = ValueExpr::Concat(vec![
            ValueExpr::Literal(json!("tick-")),
            ValueExpr::Arg("n".into()),
        ]);
        assert_eq!(eval(&expr, &args), json!("tick-3"));
    }

    #[test]
    fn unknown_function_fails_typed() {
        let args = json!({});
        let bindings = BTreeMap::new();
        let expr = ValueExpr::Call {
            func: "eval".into(),
            args: vec![],
        };
        let error = eval_value_expr(&expr, &env(&args, &bindings))
            .expect_err("must fail")
            .into_snapback();
        assert_eq!(error.diagnostic.code, "SNAPBACK_EXPR_UNSUPPORTED_FUNCTION");
    }

    #[test]
    fn depth_bound_enforced() {
        let args = json!({});
        let bindings = BTreeMap::new();
        let mut expr = ValueExpr::Literal(json!(1));
        for _ in 0..(MAX_EXPR_DEPTH + 1) {
            expr = ValueExpr::Unary {
                op: UnaryOp::Neg,
                expr: Box::new(expr),
            };
        }
        let error = eval_value_expr(&expr, &env(&args, &bindings))
            .expect_err("must fail")
            .into_snapback();
        assert_eq!(error.diagnostic.code, "SNAPBACK_PLAN_BOUNDS");
    }
}

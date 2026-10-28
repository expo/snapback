//! Conservative suggestions for the leading caller-only guard prefix.
//! This is not security analysis: unsupported reads/branches stop inference.
use snapback4_core::{
    Value,
    ir::{BinaryOp, Expr, Input, Program, Read, Stmt, UnaryOp},
    schema::{ColumnDefault, RuleTerm, Schema},
};
use std::collections::BTreeMap;
const VIEWER: &str = "proof-viewer";
type Env = BTreeMap<String, Value>;
pub(super) struct Roster {
    table: String,
    row: Env,
}
impl Roster {
    pub(super) fn from(
        program: &Program,
        principal: &str,
        role_arg: &str,
        role: &str,
        schema: &Schema,
    ) -> Option<Self> {
        fn writes(value: &serde_json::Value) -> usize {
            match value {
                serde_json::Value::Object(m) => {
                    usize::from(
                        [
                            "Insert",
                            "InsertIfAbsent",
                            "Upsert",
                            "Update",
                            "WriteTarget",
                            "Delete",
                            "DeleteTarget",
                        ]
                        .iter()
                        .any(|tag| m.contains_key(*tag)),
                    ) + m.values().map(writes).sum::<usize>()
                }
                serde_json::Value::Array(v) => v.iter().map(writes).sum(),
                _ => 0,
            }
        }
        if writes(&serde_json::to_value(&program.body).ok()?) != 1 {
            return None;
        }
        Self::shape(program, principal, role_arg, role, schema)
    }
    pub(super) fn shape(
        program: &Program,
        principal: &str,
        role_arg: &str,
        role: &str,
        schema: &Schema,
    ) -> Option<Self> {
        let mut env = Env::from([
            (principal.into(), Value::String(VIEWER.into())),
            (role_arg.into(), Value::String(role.into())),
        ]);
        for stmt in &program.body {
            if let Stmt::Let { name, value } | Stmt::Const { name, value } = stmt {
                if let Some(v) = eval(value, &env, None, schema) {
                    env.insert(name.clone(), v);
                }
            }
            let write = match stmt {
                Stmt::Upsert { table, row, .. } | Stmt::Insert { table, row } => Some((table, row)),
                Stmt::WriteTarget {
                    target,
                    patch,
                    upsert: true,
                    condition: None,
                    ..
                } => Some((&target.table, patch)),
                _ => None,
            };
            if let Some((table, expression)) = write {
                let Some(Value::Row(fields)) = eval(expression, &env, None, schema) else {
                    continue;
                };
                let mut row = fields
                    .iter()
                    .map(|(n, v)| (n.clone(), v.clone()))
                    .collect::<Env>();
                let target = schema.table(table)?;
                let principal_columns = row
                    .iter()
                    .filter_map(|(name, value)| {
                        (value == &Value::String(VIEWER.into())
                            && matches!(
                                target.columns.get(name),
                                Some(snapback4_core::schema::ColumnType::Principal)
                            ))
                        .then_some(name)
                    })
                    .collect::<Vec<_>>();
                let direct_role = row.iter().any(|(name,value)| value==&Value::String(role.into()) && matches!((target.columns.get(name),program.args.get(role_arg)),(Some(snapback4_core::schema::ColumnType::Enum{variants:a}),Some(snapback4_core::ir::ArgType::Enum{variants:b})) if a==b));
                if !direct_role
                    || !principal_columns.iter().any(|name| {
                        target
                            .indexes
                            .values()
                            .any(|i| i.unique && i.columns() == [(*name).clone()])
                    })
                {
                    continue;
                }
                for (n, default) in &target.defaults {
                    if let ColumnDefault::Literal(v) = default {
                        row.entry(n.clone()).or_insert(v.clone());
                    }
                }
                if matches!(program.args.get(role_arg),Some(snapback4_core::ir::ArgType::Enum{variants}) if !variants.iter().any(|r|r==role))
                {
                    row.clear();
                }
                return Some(Self {
                    table: table.clone(),
                    row,
                });
            }
        }
        None
    }
}
fn get(read: &Read, env: &Env, roster: Option<&Roster>, schema: &Schema) -> Option<Value> {
    let roster = roster?;
    if read.table != roster.table {
        return None;
    }
    let t = schema.table(&read.table)?;
    if t.expire.is_some() || t.not_before.is_some() {
        return None;
    }
    let index = t.index(&read.index)?;
    if !index.unique || read.key.len() != index.columns().len() {
        return None;
    }
    let terms = read
        .key
        .iter()
        .map(|e| match e {
            Expr::Input(Input::Viewer) => Some(RuleTerm::Viewer),
            Expr::Literal(v) => Some(RuleTerm::Literal(v.clone())),
            _ => None,
        })
        .collect::<Option<Vec<_>>>()?;
    if !schema.rule_input_is_readable(&read.table, &read.index, &terms) {
        return None;
    }
    if roster.row.is_empty() {
        return Some(Value::Null);
    }
    for (n, key) in index.columns().iter().zip(&read.key) {
        let expected = eval(key, env, Some(roster), schema)?;
        let actual = roster.row.get(n)?;
        if *actual != expected {
            return Some(Value::Null);
        }
    }
    Some(snapback4_core::value::object(roster.row.clone()))
}
fn eval(expr: &Expr, env: &Env, roster: Option<&Roster>, schema: &Schema) -> Option<Value> {
    match expr {
        Expr::Object(fields) => Some(snapback4_core::value::object(
            fields
                .iter()
                .map(|(k, v)| Some((k.clone(), eval(v, env, roster, schema)?)))
                .collect::<Option<Vec<_>>>()?,
        )),
        Expr::Literal(v) => Some(v.clone()),
        Expr::Variable(n) => env.get(n).cloned(),
        Expr::Input(Input::Viewer) => Some(Value::String(VIEWER.into())),
        Expr::Field { base, name } => eval(base, env, roster, schema)?.field(name).ok().cloned(),
        Expr::Get(read) => get(read, env, roster, schema),
        Expr::Exists(read) => get(read, env, roster, schema).map(|v| Value::Bool(v != Value::Null)),
        Expr::Unary {
            op: UnaryOp::Not,
            value,
        } => Some(Value::Bool(
            !eval(value, env, roster, schema)?.as_bool().ok()?,
        )),
        Expr::Binary { op, left, right } => {
            let l = eval(left, env, roster, schema);
            let r = eval(right, env, roster, schema);
            match op {
                BinaryOp::And if l == Some(Value::Bool(false)) || r == Some(Value::Bool(false)) => {
                    Some(Value::Bool(false))
                }
                BinaryOp::Or if l == Some(Value::Bool(true)) || r == Some(Value::Bool(true)) => {
                    Some(Value::Bool(true))
                }
                BinaryOp::And => Some(Value::Bool(l?.as_bool().ok()? && r?.as_bool().ok()?)),
                BinaryOp::Or => Some(Value::Bool(l?.as_bool().ok()? || r?.as_bool().ok()?)),
                BinaryOp::Eq => Some(Value::Bool(l? == r?)),
                BinaryOp::Ne => Some(Value::Bool(l? != r?)),
                _ => None,
            }
        }
        _ => None,
    }
}
pub(super) fn refusal(
    program: &Program,
    roster: Option<&Roster>,
    schema: &Schema,
) -> Option<String> {
    let mut env = Env::new();
    for stmt in &program.body {
        match stmt {
            Stmt::Let { name, value } | Stmt::Const { name, value } => {
                env.insert(name.clone(), eval(value, &env, roster, schema)?);
            }
            Stmt::Require {
                condition, code, ..
            } => match eval(condition, &env, roster, schema)? {
                Value::Bool(false) => return Some(code.clone()),
                Value::Bool(true) => {}
                _ => return None,
            },
            _ => return None,
        }
    }
    None
}

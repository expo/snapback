//! Hiding cannot turn an absent safety witness into a grant.
// @ref LLP 3000.000.000#20-visible-rollback-views-roll — current clauses also need their safety population.
use super::*;
use crate::{
    ir::{BinaryOp, Builtin, Expr, Program, Stmt},
    schema::{RuleExpr, RuleTerm},
};
use std::collections::{BTreeMap, BTreeSet};
fn refuse() -> RuntimeError {
    RuntimeError::Structural{code:"E_ADOPT",message:"intentional rollback hiding can weaken an authority/guard through a changed lookup population; retain the safety witness in a visible bridge".into()}
}
fn reference(t: &RuleTerm, hidden: &BTreeSet<String>) -> bool {
    t.references().any(|(table, _)| hidden.contains(table))
}
fn nonnull(t: &RuleTerm) -> bool {
    matches!(t, RuleTerm::Viewer) || matches!(t,RuleTerm::Literal(v) if v!=&Value::Null)
}
fn null(t: &RuleTerm) -> bool {
    matches!(t, RuleTerm::Literal(Value::Null))
}
fn rule(r: &RuleExpr, hidden: &BTreeSet<String>, negative: bool) -> bool {
    use RuleExpr::*;
    match r {
        Not(r) => rule(r, hidden, !negative),
        And(rs) | Or(rs) => rs.iter().any(|r| rule(r, hidden, negative)),
        Exists {
            table,
            key,
            equalities,
            ..
        }
        | Created {
            table,
            key,
            equalities,
            ..
        } => {
            negative && hidden.contains(table)
                || key
                    .iter()
                    .chain(equalities.iter().map(|(_, v)| v))
                    .any(|v| reference(v, hidden))
        }
        Eq(a, b) | Ne(a, b) => {
            let eq = matches!(r, Eq(..)) ^ negative;
            [(a, b), (b, a)]
                .iter()
                .any(|(a, b)| reference(a, hidden) && if eq { !nonnull(b) } else { !null(b) })
        }
        Compare(_, a, b) => reference(a, hidden) || reference(b, hidden),
        _ => false,
    }
}
fn json_taint(v: &serde_json::Value, env: &BTreeSet<String>, hidden: &BTreeSet<String>) -> bool {
    match v {
        serde_json::Value::Object(o) => {
            if o.get("Variable")
                .and_then(|v| v.as_str())
                .is_some_and(|n| env.contains(n))
            {
                return true;
            }
            if o.get("table")
                .and_then(|v| v.as_str())
                .is_some_and(|n| hidden.contains(n))
            {
                return true;
            }
            o.values().any(|v| json_taint(v, env, hidden))
        }
        serde_json::Value::Array(a) => a.iter().any(|v| json_taint(v, env, hidden)),
        _ => false,
    }
}
fn signature(v: &impl serde::Serialize, points: &BTreeSet<String>) -> String {
    fn expand(v: &mut serde_json::Value, points: &BTreeSet<String>, depth: usize) {
        if depth > 64 {
            return;
        }
        if let Some(name) = v.get("Variable").and_then(|v| v.as_str()) {
            if let Some(value) = points
                .iter()
                .find_map(|p| p.strip_prefix(&format!("alias:{name}:")))
            {
                *v = serde_json::from_str(value).unwrap();
                expand(v, points, depth + 1);
                return;
            }
        }
        match v {
            serde_json::Value::Object(m) => {
                for v in m.values_mut() {
                    expand(v, points, depth + 1)
                }
            }
            serde_json::Value::Array(a) => {
                for v in a {
                    expand(v, points, depth + 1)
                }
            }
            _ => (),
        }
    }
    let mut v = serde_json::to_value(v).unwrap();
    expand(&mut v, points, 0);
    canonical_json(&v)
}
fn point_key(e: &Expr, points: &BTreeSet<String>) -> Option<String> {
    match e {
        Expr::Get(r) => Some(format!("{}:{}", r.table, signature(&r.key, points))),
        Expr::Builtin {
            builtin: Builtin::RequireUncapped,
            args,
        } if args.len() == 1 => point_key(&args[0], points),
        _ => None,
    }
}
fn guarded(table: &str, key: &Expr, points: &BTreeSet<String>) -> bool {
    points.contains(&format!("guard:{table}:{}", signature(&vec![key], points)))
}
fn point(e: &Expr, env: &BTreeSet<String>, hidden: &BTreeSet<String>) -> bool {
    match e {
        Expr::Get(r) => {
            hidden.contains(&r.table)
                && !json_taint(&serde_json::to_value(&r.key).unwrap(), env, hidden)
        }
        Expr::Builtin {
            builtin: Builtin::RequireUncapped,
            args,
        } => args.len() == 1 && point(&args[0], env, hidden),
        _ => false,
    }
}
fn expr(e: &Expr, env: &BTreeSet<String>, hidden: &BTreeSet<String>) -> Result<bool, RuntimeError> {
    Ok(match e {
        Expr::Literal(_) => false,
        Expr::Variable(n) => env.contains(n),
        Expr::Block { body, value } => {
            let mut local = env.clone();
            body_check(body, &mut local, &mut BTreeSet::new(), hidden)?;
            expr(value, &local, hidden)?
        }
        Expr::Binary { left, right, .. } => expr(left, env, hidden)? | expr(right, env, hidden)?,
        Expr::Unary { value, .. } | Expr::Field { base: value, .. } => expr(value, env, hidden)?,
        Expr::Array(a) => {
            let mut result = false;
            for e in a {
                result |= expr(e, env, hidden)?;
            }
            result
        }
        Expr::Object(m) => {
            let mut result = false;
            for e in m.values() {
                result |= expr(e, env, hidden)?;
            }
            result
        }
        Expr::Shape { base, fields } => {
            let mut result = expr(base, env, hidden)?;
            for e in fields.values() {
                result |= expr(e, env, hidden)?;
            }
            result
        }
        Expr::Scan(scan) => {
            let mut encoded = serde_json::to_value(scan).unwrap();
            encoded.as_object_mut().unwrap().remove("table");
            if json_taint(&encoded, env, hidden) {
                return Err(refuse());
            }
            hidden.contains(&scan.table)
        }
        Expr::Merge(m) => {
            if json_taint(&serde_json::to_value(m).unwrap(), env, hidden) {
                return Err(refuse());
            }
            false
        }
        Expr::Builtin { builtin, args } => {
            if matches!(builtin, Builtin::JobQuery { .. })
                && json_taint(&serde_json::to_value(builtin).unwrap(), env, hidden)
            {
                return Err(refuse());
            }
            let mut result = false;
            for e in args {
                result |= expr(e, env, hidden)?;
            }
            if matches!(builtin, Builtin::JobAs) && result {
                return Err(refuse());
            }
            result
        }
        _ => json_taint(&serde_json::to_value(e).unwrap(), env, hidden),
    })
}
fn body_check(
    body: &[Stmt],
    env: &mut BTreeSet<String>,
    points: &mut BTreeSet<String>,
    hidden: &BTreeSet<String>,
) -> Result<(), RuntimeError> {
    for s in body {
        match s {
            Stmt::Let { name, value }
            | Stmt::Const { name, value }
            | Stmt::Assign { name, value } => {
                let p = point(value, env, hidden);
                let taint = expr(value, env, hidden)?;
                points.retain(|p| !p.starts_with(&format!("{name}=>")));
                if p {
                    points.insert(name.clone());
                    if let Some(key) = point_key(value, points) {
                        points.insert(format!("{name}=>{key}"));
                    }
                } else {
                    points.remove(name);
                }
                if taint {
                    env.insert(name.clone());
                } else {
                    env.remove(name);
                }
                let alias = if matches!(
                    value,
                    Expr::Variable(_)
                        | Expr::Literal(_)
                        | Expr::Input(
                            crate::ir::Input::Viewer
                                | crate::ir::Input::Now
                                | crate::ir::Input::ReadTime
                        )
                ) {
                    signature(value, points)
                } else {
                    canonical_json(&Expr::Variable(format!("$opaque:{s:p}:{name}")))
                };
                points.retain(|p| !p.starts_with(&format!("alias:{name}:")));
                points.insert(format!("alias:{name}:{alias}"));
            }
            Stmt::Require { condition, .. } => {
                if !expr(condition, env, hidden)? {
                    continue;
                }
                if let Expr::Binary {
                    op: BinaryOp::Ne,
                    left,
                    right,
                } = condition
                {
                    let name = match (left.as_ref(), right.as_ref()) {
                        (Expr::Variable(n), Expr::Literal(Value::Null))
                        | (Expr::Literal(Value::Null), Expr::Variable(n)) => Some(n),
                        _ => None,
                    };
                    if let Some(n) = name.filter(|n| points.contains(*n)) {
                        if let Some(key) = points
                            .iter()
                            .find_map(|v| v.strip_prefix(&format!("{n}=>")).map(str::to_owned))
                        {
                            points.insert(format!("guard:{key}"));
                        }
                        env.remove(n);
                        continue;
                    }
                }
                if let Expr::Exists(r) = condition {
                    if hidden.contains(&r.table)
                        && !json_taint(&serde_json::to_value(&r.key).unwrap(), env, hidden)
                    {
                        continue;
                    }
                }
                return Err(refuse());
            }
            Stmt::If {
                condition,
                then_body,
                else_body,
            } => {
                if expr(condition, env, hidden)? {
                    return Err(refuse());
                }
                let mut a = env.clone();
                let mut b = env.clone();
                body_check(then_body, &mut a, &mut points.clone(), hidden)?;
                body_check(else_body, &mut b, &mut points.clone(), hidden)?;
                env.extend(a);
                env.extend(b);
                points.clear();
            }
            Stmt::For { domain, body, .. } => {
                if json_taint(&serde_json::to_value(domain).unwrap(), env, hidden) {
                    return Err(refuse());
                }
                body_check(body, env, points, hidden)?;
            }
            Stmt::Return(e) => {
                expr(e, env, hidden)?;
            }
            Stmt::Push { target, value } => {
                if expr(value, env, hidden)? {
                    env.insert(target.clone());
                    points.remove(target);
                }
            }
            Stmt::Insert { row, .. } | Stmt::InsertIfAbsent { row, .. } => {
                if expr(row, env, hidden)? {
                    return Err(refuse());
                }
            }
            Stmt::Update { table, key, patch }
            | Stmt::Upsert {
                table,
                key,
                row: patch,
            } => {
                if hidden.contains(table) && !guarded(table, key, points) {
                    return Err(refuse());
                }
                if expr(key, env, hidden)? || expr(patch, env, hidden)? {
                    return Err(refuse());
                }
            }
            Stmt::Delete { table, key } => {
                if hidden.contains(table) && !guarded(table, key, points) || expr(key, env, hidden)?
                {
                    return Err(refuse());
                }
            }
            Stmt::WriteTarget {
                target,
                patch,
                condition,
                result,
                ..
            } => {
                if hidden.contains(&target.table)
                    && !points.contains(&format!(
                        "guard:{}:{}",
                        target.table,
                        signature(&target.key, points)
                    ))
                {
                    return Err(refuse());
                }
                if json_taint(&serde_json::to_value(&target.key).unwrap(), env, hidden)
                    || expr(patch, env, hidden)?
                    || json_taint(&serde_json::to_value(condition).unwrap(), env, hidden)
                {
                    return Err(refuse());
                }
                if let Some(name) = result {
                    env.remove(name);
                    points.remove(name);
                }
            }
            Stmt::DeleteTarget { target } => {
                if hidden.contains(&target.table)
                    && !points.contains(&format!(
                        "guard:{}:{}",
                        target.table,
                        signature(&target.key, points)
                    ))
                    || json_taint(&serde_json::to_value(&target.key).unwrap(), env, hidden)
                {
                    return Err(refuse());
                }
            }
            _ => {
                if json_taint(&serde_json::to_value(s).unwrap(), env, hidden) {
                    return Err(refuse());
                }
            }
        }
    }
    Ok(())
}
pub(super) fn validate(
    schema: &Schema,
    programs: &BTreeMap<String, Program>,
    hidden: &BTreeSet<String>,
) -> Result<(), RuntimeError> {
    if hidden.is_empty() {
        return Ok(());
    }
    // A positive audience witness can disappear without physically archiving
    // the row it protects. Follow that visibility dependency as well.
    let mut closure = hidden.clone();
    loop {
        let before = closure.len();
        for (name, table) in &schema.tables {
            if json_taint(
                &serde_json::to_value(&table.rules.read).unwrap(),
                &BTreeSet::new(),
                &closure,
            ) {
                closure.insert(name.clone());
            }
        }
        if closure.len() == before {
            break;
        }
    }
    let hidden = &closure;
    // A positive freeze witness has the opposite safety polarity to a grant:
    // disappearing locks can enable a write, including a trusted system write.
    if schema.tables.values().any(|t|t.frozen_columns.values().any(|r|json_taint(&serde_json::to_value(r).unwrap(),&BTreeSet::new(),hidden))) {return Err(refuse());}

    // Point-presence discharge is valid only when surviving payload cells do
    // not change visibility. No payload-policy implication is guessed here.
    if schema.tables.values().any(|t| {
        t.column_reads
            .values()
            .any(|r| json_taint(&serde_json::to_value(r).unwrap(), &BTreeSet::new(), hidden))
    }) {
        return Err(refuse());
    }
    if schema.maintains.iter().any(|m| hidden.contains(&m.source))
        || schema.tables.values().any(|t| {
            t.maintained
                .values()
                .any(|s| hidden.contains(s.split('.').next().unwrap_or(s)))
        })
    {
        return Err(refuse());
    }
    for table in schema.tables.values() {
        for r in [
            &table.rules.read,
            &table.rules.insert,
            &table.rules.update,
            &table.rules.delete,
        ]
        .into_iter()
        .chain(table.column_reads.values())
        {
            if rule(r, hidden, false) {
                return Err(refuse());
            }
        }
    }
    for p in programs.values() {
        body_check(&p.body, &mut BTreeSet::new(), &mut BTreeSet::new(), hidden)?;
    }
    Ok(())
}

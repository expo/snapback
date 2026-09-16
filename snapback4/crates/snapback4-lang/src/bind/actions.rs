//! Actions share argument types and API names with mutations, with no data-plane body.
use super::{BoundProgram, catalog::Catalog, operation_name};
use crate::ast::{Expr as A, Literal, ScalarType, TypeKind, WorkDecl};
use crate::diag::{Diagnostic, Fallible, Site, type_error, unknown};
use crate::types::{Ty, scalar_to_arg};
use snapback4_core::ir::{BinaryOp, Expr, Input, Program, ProgramKind, Stmt, UnaryOp};
use snapback4_core::value::Value;
use snapback4_core::schema::{ActionSpec, Schema, WorkSpec};
use std::collections::{BTreeMap, BTreeSet};

pub(super) fn bind(catalog: &Catalog, schema: &mut Schema, programs: &mut Vec<BoundProgram>, diagnostics: &mut Vec<Diagnostic>) {
    for doc in &catalog.documents {
        let module = std::path::Path::new(&doc.file).file_stem().and_then(|s| s.to_str()).unwrap_or("schema");
        for decl in &doc.actions {
            let name = operation_name(module, &decl.name);
            let root = if module == "schema" { &decl.name } else { module };
            if programs.iter().any(|p| p.program.name == name || (p.program.kind != ProgramKind::Job && (p.module != "schema") != (module != "schema") && if p.module == "schema" { p.program.name == root } else { p.module == root })) {
                diagnostics.push(unknown(&decl.site, format!("duplicate operation or API module {name}"), "rename the action or its module"));
                continue;
            }
            let result = (|| -> Fallible<(BoundProgram, ActionSpec)> {
                let mut args = BTreeMap::new();
                let mut types = Vec::new();
                for arg in &decl.args {
                    if args.contains_key(&arg.name) {
                        return Err(unknown(&arg.site, format!("duplicate argument {}", arg.name), "rename one argument"));
                    }
                    validate_type(&arg.type_, catalog, &arg.site, false)?;
                    args.insert(arg.name.clone(), scalar_to_arg(&arg.type_));
                    types.push((arg.name.clone(), Ty::from_scalar(&arg.type_)));
                }
                let mut result_type = Ty::Unknown;
                let returns = if let Some(fields) = &decl.returns {
                    let mut returns = BTreeMap::new();
                    let mut types = BTreeMap::new();
                    for field in fields {
                        if returns.contains_key(&field.name) {
                            return Err(unknown(&field.site, format!("duplicate result field {}", field.name), "declare each result field once").guide("actions"));
                        }
                        validate_type(&field.type_, catalog, &field.site, true)?;
                        returns.insert(field.name.clone(), scalar_to_arg(&field.type_));
                        types.insert(field.name.clone(), Ty::from_scalar(&field.type_));
                    }
                    result_type = Ty::Object(types);
                    Some(returns)
                } else { None };
                let spec = ActionSpec { returns, work: bind_work(&decl.work, &decl.site)? };
                let condition = rule(&decl.rule)?;
                // Admission is the only IR body: it cannot read, write or emit.
                let body = vec![Stmt::Require { condition, code: "E_RULE".into(), site: Some(format!("actions.{name}")) }];
                Ok((BoundProgram { sources: Default::default(), program: Program { name, kind: ProgramKind::Action, args, read_time_granularity_ms: None, body, native: false }, presence: None, module: module.into(), args: types, result: result_type, notes: Vec::new(), site: decl.site.clone() }, spec))
            })();
            match result {
                Ok((program, spec)) => {
                    schema.action_specs.insert(program.program.name.clone(), spec);
                    programs.push(program);
                }
                Err(error) => diagnostics.push(error),
            }
        }
    }
}

// @ref LLP 3000.009#5.1 — result refs are IDs, and only declared bounded fields can settle.
fn validate_type(ty: &ScalarType, catalog: &Catalog, site: &Site, result: bool) -> Fallible<()> {
    let bad = |message| type_error(site, message, "use a bounded scalar type or list of scalars; references name declared tables").guide("actions");
    match &ty.kind {
        TypeKind::Cursor if result => return Err(bad("an action result cannot contain a query cursor")),
        TypeKind::Text { min, max, .. } if *max == 0 || min.is_some_and(|min| min > *max) => return Err(bad("text needs a positive maximum at least as large as its minimum")),
        TypeKind::Json { max } | TypeKind::Bytes { max } | TypeKind::Image { max, .. } | TypeKind::Video { max } if *max == 0 => return Err(bad("a bounded type needs a positive maximum")),
        TypeKind::Ref { table } if !catalog.tables.contains_key(table) => return Err(bad("an action type references an unknown table")),
        TypeKind::List { item, max } => {
            if *max == 0 { return Err(bad("a list needs a positive maximum")); }
            validate_type(item, catalog, site, result)?;
        }
        TypeKind::Enum { variants } => {
            let unique: BTreeSet<_> = variants.iter().collect();
            if unique.len() != variants.len() { return Err(bad("enum variants must be distinct")); }
        }
        _ => {}
    }
    Ok(())
}

pub(super) fn bind_work(decl: &WorkDecl, site: &Site) -> Fallible<WorkSpec> {
    let mut work = WorkSpec::default();
    let mut secrets = BTreeSet::new();
    for secret in &decl.secrets {
        let valid = secret.bytes().next().is_some_and(|b| b.is_ascii_uppercase() || b == b'_')
            && secret.bytes().all(|b| b.is_ascii_uppercase() || b.is_ascii_digit() || b == b'_');
        let reserved = ["SNAPBACK_", "SNAPBACK4_", "NODE_", "DYLD_", "LD_", "LC_"].iter().any(|prefix| secret.starts_with(prefix))
            || matches!(secret.as_str(), "PATH" | "HOME" | "TMPDIR" | "TMP" | "TEMP" | "LANG" | "TZ" | "SHELL" | "ENV" | "BASH_ENV" | "IFS" | "PWD" | "USER" | "LOGNAME");
        if !valid || reserved {
            return Err(type_error(site, format!("secret {secret} must be an uppercase environment name outside the runtime's reserved names"), "secrets [MAIL_API_KEY]").guide("actions"));
        }
        if !secrets.insert(secret.clone()) {
            return Err(unknown(site, format!("duplicate secret {secret}"), "declare each secret once").guide("actions"));
        }
    }
    work.secrets = secrets.into_iter().collect();
    if let Some(value) = decl.max_attempts { work.policy.max_attempts = value; }
    if let Some(value) = decl.backoff_ms { work.policy.backoff_ms = value; }
    work.policy.deadline_ms = decl.deadline_ms;
    if let Some(value) = decl.cancellable { work.policy.cancellable = value; }
    if !work.policy.valid() {
        return Err(type_error(site, "work policy requires retry 1–100 total attempts, backoff 1s–5m, and deadline 1s–30d", "retry 8 backoff 2s deadline 1h cancellation allow").guide("actions"));
    }
    Ok(work)
}

fn rule(expr: &A) -> Fallible<Expr> {
    Ok(match expr {
        A::Name { name, .. } if matches!(name.as_str(), "allow" | "deny") => Expr::Literal(Value::Bool(name == "allow")),
        A::Unary { op, value, .. } if op == "not" => Expr::Unary { op: UnaryOp::Not, value: Box::new(rule(value)?) },
        A::Binary { op, left, right, .. } if op == "and" || op == "or" => Expr::Binary { op: if op == "and" { BinaryOp::And } else { BinaryOp::Or }, left: Box::new(rule(left)?), right: Box::new(rule(right)?) },
        A::Binary { op, left, right, .. } if op == "=" || op == "!=" => {
            let principal = |e: &A| match e { A::Literal { value: Literal::Str(s), .. } if snapback4_core::value::identity_fits(s) && s != snapback4_core::SYSTEM_PRINCIPAL => Some(s.clone()), _ => None };
            let viewer = |e: &A| matches!(e, A::Name { name, .. } if name == "viewer");
            let value = if viewer(left) { principal(right) } else if viewer(right) { principal(left) } else { None };
            let Some(value) = value else { return Err(bad_rule(expr)); };
            Expr::Binary { op: if op == "=" { BinaryOp::Eq } else { BinaryOp::Ne }, left: Box::new(Expr::Input(Input::Viewer)), right: Box::new(Expr::Literal(Value::Id(value))) }
        }
        _ => return Err(bad_rule(expr)),
    })
}

fn bad_rule(expr: &A) -> Diagnostic {
    type_error(expr.site(), "an action rule compares viewer with a principal; it cannot read data or arguments", "action invite(email: text <=200) <- viewer = 'service:worker'  -- or allow / deny").guide("actions")
}

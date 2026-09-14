//! Actions share argument types and API names with mutations, with no data-plane body.
use super::{BoundProgram, catalog::Catalog, operation_name};
use crate::ast::{Expr as A, Literal, ScalarType, TypeKind};
use crate::diag::{Diagnostic, Fallible, type_error, unknown};
use crate::types::{Ty, scalar_to_arg};
use snapback4_core::ir::{BinaryOp, Expr, Input, Program, ProgramKind, Stmt, UnaryOp};
use snapback4_core::value::Value;
use std::collections::BTreeMap;

pub(super) fn bind(catalog: &Catalog, programs: &mut Vec<BoundProgram>, diagnostics: &mut Vec<Diagnostic>) {
    for doc in &catalog.documents {
        let module = std::path::Path::new(&doc.file).file_stem().and_then(|s| s.to_str()).unwrap_or("schema");
        for decl in &doc.actions {
            let name = operation_name(module, &decl.name);
            let root = if module == "schema" { &decl.name } else { module };
            if programs.iter().any(|p| p.program.name == name || (p.program.kind != ProgramKind::Job && (p.module != "schema") != (module != "schema") && if p.module == "schema" { p.program.name == root } else { p.module == root })) {
                diagnostics.push(unknown(&decl.site, format!("duplicate operation or API module {name}"), "rename the action or its module"));
                continue;
            }
            let result = (|| -> Fallible<BoundProgram> {
                let mut args = BTreeMap::new();
                let mut types = Vec::new();
                for arg in &decl.args {
                    if args.contains_key(&arg.name) {
                        return Err(unknown(&arg.site, format!("duplicate argument {}", arg.name), "rename one argument"));
                    }
                    fn references(kind: &ScalarType, catalog: &Catalog) -> bool {
                        match &kind.kind { TypeKind::Ref { table } => catalog.tables.contains_key(table), TypeKind::List { item, .. } => references(item, catalog), _ => true }
                    }
                    if !references(&arg.type_, catalog) { return Err(type_error(&arg.site, "an action argument references an unknown table", "use a declared table, or id")); }
                    args.insert(arg.name.clone(), scalar_to_arg(&arg.type_));
                    types.push((arg.name.clone(), Ty::from_scalar(&arg.type_)));
                }
                let condition = rule(&decl.rule)?;
                // Admission is the only IR body: it cannot read, write or emit.
                let body = vec![Stmt::Require { condition, code: "E_RULE".into(), site: Some(format!("actions.{name}")) }];
                Ok(BoundProgram { sources: Default::default(), program: Program { name, kind: ProgramKind::Action, args, read_time_granularity_ms: None, body, native: false }, presence: None, module: module.into(), args: types, result: Ty::Unknown, notes: Vec::new(), site: decl.site.clone() })
            })();
            match result { Ok(program) => programs.push(program), Err(error) => diagnostics.push(error) }
        }
    }
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

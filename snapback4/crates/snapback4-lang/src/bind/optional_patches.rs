//! N_PATCH_CLEARS: an omitted optional argument is null, the same as an
//! explicit null (no test tells them apart), so an edit mutation that patches
//! `{ title, body }` with `body: text ?` clears `body` whenever a client sends
//! only the title (wave 7 lanes 047 090, both "silent data loss"). The note
//! names the patch when the argument goes straight into a nullable column,
//! beside at least one other field (an edit form, not a one-field setter whose
//! null means "clear"), and nothing in the mutation tests the argument. An
//! `upsert` is not named: it replaces the caller's record (a vote and its
//! optional note), and its insert arm writes the same null.
// @ref LLP 3000.036#17.9 — omitted means null; the note points at `x ?? row.c` and a clear flag.
use super::catalog::Catalog;
use crate::{ast::*, diag::Diagnostic};

pub(super) fn notes(catalog: &Catalog) -> Vec<Diagnostic> {
    let mut notes = Vec::new();
    for program in catalog.documents.iter().flat_map(|doc| &doc.programs).filter(|p| p.kind == ProgramKind::Mutation && !p.native) {
        let optional: Vec<&str> = program.args.iter().filter(|arg| arg.type_.optional && !matches!(arg.type_.kind, TypeKind::Cursor)).map(|arg| arg.name.as_str()).collect();
        if optional.is_empty() { continue; }
        let mut tested = Vec::new();
        conditions(&program.prelude, &mut tested);
        conditions(&program.body, &mut tested);
        let rows = bindings(&program.body);
        let mut writes = Vec::new();
        let mut body = program.prelude.clone();
        body.extend(program.body.iter().cloned());
        super::intent_walk::statements(&mut body, &mut |expr: &mut Expr| {
            if let Expr::Write { op: op @ WriteOp::Update, table, keys, fields, site, .. } = expr { writes.push((*op, table.clone(), keys.clone(), fields.clone(), site.clone())); }
        });
        for (op, table, keys, fields, site) in writes {
            let Some(info) = catalog.tables.get(&table) else { continue };
            if fields.iter().any(|f| f.spread) || fields.iter().filter(|f| f.name != "id").count() < 2 { continue; }
            let cleared: Vec<(&str, &str)> = fields.iter().filter_map(|field| {
                let arg = match &field.value { None => field.name.as_str(), Some(Expr::Name { name, .. }) => name.as_str(), _ => return None };
                (optional.contains(&arg) && info.columns.get(&field.name).is_some_and(|ty| ty.optional) && !tested.iter().any(|c| mentions(c, arg)))
                    .then_some((field.name.as_str(), arg))
            }).collect();
            let Some((column, arg)) = cleared.first().copied() else { continue };
            let key = keys.iter().map(|k| match &k.column { Some(c) => format!("{c} = {}", crate::print::expression(&k.value)), None => crate::print::expression(&k.value) }).collect::<Vec<_>>().join(", ");
            let row = rows.iter().find(|(_, read)| read == &format!("{table}[{key}]")).map(|(name, _)| name.clone());
            let (bind, row) = match row { Some(row) => (String::new(), row), None => (format!("bind `row = {table}[{key}] ! else NOT_FOUND` before it, then "), "row".to_owned()) };
            let all = cleared.iter().map(|(c, a)| if c == a { format!("`{c}`") } else { format!("`{c}` (from `{a}`)") }).collect::<Vec<_>>().join(", ");
            notes.push(Diagnostic::new(&site, "N_PATCH_CLEARS",
                format!("mutation {}: `{} {table}[{key}]` writes {all} from optional arguments, and an omitted argument is null, the same as an explicit null: a client that sends only the other fields clears `{column}`{}", program.name, op.word(), if cleared.len() > 1 { " (and each other column named)" } else { "" }),
                format!("to keep the stored value when `{arg}` is omitted, {bind}write `{column}: {arg} ?? {row}.{column}`; if clearing is meant too, add `clear: bool ?` and write `{column}: null if clear = true else {arg} ?? {row}.{column}` (guide writes, Details); if a null `{arg}` always means \"clear\", nothing changes")).guide("writes"));
        }
    }
    notes
}

fn conditions(body: &[Stmt], out: &mut Vec<Expr>) {
    for statement in body {
        match statement {
            Stmt::Require { condition, .. } => out.push(condition.clone()),
            Stmt::If { condition, then_body, else_body, .. } => { out.push(condition.clone()); conditions(then_body, out); conditions(else_body, out); }
            Stmt::For { body, .. } | Stmt::As { body, .. } => conditions(body, out),
            _ => {}
        }
    }
}

/// `name = t[key]` (with or without `!`) at the top of the body, as `(name, "t[key]")`.
fn bindings(body: &[Stmt]) -> Vec<(String, String)> {
    body.iter().filter_map(|statement| {
        let Stmt::Bind { names, value, .. } = statement else { return None };
        let [name] = names.as_slice() else { return None };
        let read = match value { Expr::Assert { value, .. } => value.as_ref(), other => other };
        let Expr::Read(read) = read else { return None };
        let key = read.keys.iter().map(|k| match &k.column { Some(c) => format!("{c} = {}", crate::print::expression(&k.value)), None => crate::print::expression(&k.value) }).collect::<Vec<_>>().join(", ");
        Some((name.clone(), format!("{}[{key}]", read.table)))
    }).collect()
}

fn mentions(expr: &Expr, name: &str) -> bool {
    let mut found = false;
    let mut copy = expr.clone();
    super::intent_walk::expression(&mut copy, &mut |e: &mut Expr| { if matches!(e, Expr::Name { name: n, .. } if n == name) { found = true; } });
    found
}

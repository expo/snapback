//! Developer source coordinates and static first-membership guidance.
use super::catalog::Catalog;
use crate::{Diagnostic, ast};
use snapback4_core::schema::{Schema, RuleExpr, RuleTerm};
use std::collections::BTreeMap;

// Use the parser's retained declaration bytes, never a reconstructed IR or
// normalized AST spelling (notably `$readThrough`). These stay host-only.
fn authored_clause(catalog: &Catalog, site: &crate::Site, value: &ast::Expr) -> Option<String> {
    let count = catalog.source.get(value).map(|(text, _)| text.lines().count()).unwrap_or(1).max(1);
    catalog.source.declarations.iter().find_map(|(key, text)| {
        let mut parts = key.rsplitn(3, ':');
        let _column = parts.next()?;
        let line = parts.next()?.parse::<u32>().ok()?;
        let file = parts.next()?;
        if file != site.file || line > site.line { return None; }
        let lines: Vec<_> = text.lines().collect();
        let at = (site.line - line) as usize;
        (at < lines.len()).then(|| lines[at..lines.len().min(at + count)].join("\n").trim().to_owned())
    })
}

pub(super) fn sites(catalog: &Catalog) -> BTreeMap<(String, String), String> {
    let mut out = BTreeMap::new();
    for (name, info) in &catalog.tables {
        out.insert((name.clone(), "table".into()), info.decl.site.to_string());
        for rule in &info.decl.rules {
            out.insert((name.clone(), format!("{} rule", rule.effect.word())), rule.site.to_string());
            if info.through.is_some() && rule.effect == ast::Effect::Read {
                for cause in ["read through capture", "read through parent missing or expired", "read through parent read rule", "read through parent reference"] {
                    out.insert((name.clone(), cause.into()), rule.site.to_string());
                }
            }
        }
        for col in &info.decl.columns {
            if col.written_by.is_some() { out.insert((name.clone(), format!("field authority {}", col.name)), col.site.to_string()); }
            if col.sequence.is_some() { out.insert((name.clone(), "sequence read authority".into()), col.site.to_string()); }
        }
        for index in &info.indexes { out.insert((name.clone(), format!("unique {}", index.columns.join(", "))), index.site.to_string()); }
        for cap in &info.decl.caps { out.insert((name.clone(), format!("cap {}", cap.by.join(", "))), cap.site.to_string()); }
        // @ref LLP 3000.036#13.9 — constraint refusals name their own line in the dev log.
        for (fields, site) in &info.decl.immutable { for field in fields { out.insert((name.clone(), format!("immutable {field}")), site.to_string()); } }
        fn asset(kind: &ast::TypeKind) -> bool {
            match kind { ast::TypeKind::Image { .. } | ast::TypeKind::Video { .. } | ast::TypeKind::File { .. } => true, ast::TypeKind::List { item, .. } => asset(&item.kind), _ => false }
        }
        for col in info.decl.columns.iter().filter(|col| asset(&col.type_.kind)) {
            out.insert((name.clone(), format!("asset {}", col.name)), col.site.to_string());
        }
    }
    for rule in catalog.documents.iter().flat_map(|d| &d.tables).flat_map(|t| &t.rules) {
        if let Some(text) = authored_clause(catalog, &rule.site, &rule.value) { out.insert(("$clause".into(), rule.site.to_string()), text); }
    }
    // Source text is developer metadata, never part of a wire Refusal.
    // @ref LLP 3000.036.002#12 — distinguish authored requires from generated lookup assertions.
    fn requires(catalog: &Catalog, body: &[ast::Stmt], kind: &str, out: &mut BTreeMap<(String, String), String>) {
        for statement in body {
            match statement {
                ast::Stmt::Require { condition, site, .. } => {
                    out.insert(("$program".into(), site.to_string()), format!("{kind} require"));
                    if let Some(text) = authored_clause(catalog, site, condition) { out.insert(("$clause".into(), site.to_string()), text); }
                }
                ast::Stmt::If { then_body, else_body, .. } => { requires(catalog, then_body, kind, out); requires(catalog, else_body, kind, out); }
                ast::Stmt::For { body, .. } | ast::Stmt::As { body, .. } => requires(catalog, body, kind, out),
                _ => {}
            }
        }
    }
    for function in catalog.documents.iter().flat_map(|d| &d.functions) {
        if let ast::FunctionBody::Block(body) = &function.body { requires(catalog, body, "program", &mut out); }
    }
    for program in catalog.documents.iter().flat_map(|d| &d.programs) {
        let kind = match program.kind { ast::ProgramKind::Mutation => "mutation", ast::ProgramKind::Query => "query", ast::ProgramKind::Job => "job" };
        requires(catalog, &program.prelude, kind, &mut out);
        requires(catalog, &program.body, kind, &mut out);
    }
    out
}

/// `(table, "lookup <site>")` → site for each `t[x] ! else CODE`: development
/// evidence can then say a program refusal at that site was a lookup of `t`,
/// so a row its read rule hid in the same request reads as absent there.
pub(super) fn lookup_sites(programs: &[super::BoundProgram]) -> BTreeMap<(String, String), String> {
    use snapback4_core::ir::{Expr, Stmt};
    fn walk(body: &[Stmt], out: &mut BTreeMap<(String, String), String>) {
        for pair in body.windows(2) {
            if let [Stmt::Let { name, value: Expr::Get(read) }, Stmt::Require { condition: Expr::Binary { left, .. }, site: Some(site), .. }] = pair
                && matches!(&**left, Expr::Variable(var) if var == name) {
                out.insert((read.table.clone(), format!("lookup {site}")), site.clone());
            }
        }
        for stmt in body {
            match stmt {
                Stmt::If { then_body, else_body, .. } => { walk(then_body, out); walk(else_body, out); }
                Stmt::For { body, .. } => walk(body, out),
                _ => {}
            }
        }
    }
    let mut out = BTreeMap::new();
    for program in programs { walk(&program.program.body, &mut out); }
    out
}

// @ref LLP 3000.015#2.1 — created parent identity is not a proof about its shared counter.
pub(super) fn sequence_notes(catalog: &Catalog, schema: &Schema) -> Vec<Diagnostic> {
    let mut out = Vec::new();
    for (name, info) in &catalog.tables {
        let Some(table) = schema.table(name) else { continue };
        let RuleExpr::Exists { table: witness, index, key, equalities, .. } = &table.rules.read else { continue };
        if witness != name { continue; }
        for column in info.decl.columns.iter().filter(|col| col.sequence.is_some()) {
            let reference = column.sequence.as_ref().unwrap();
            let Some(index) = table.index(index) else { continue };
            // A same-table witness only proves a nonempty sequence group when
            // the witness's parent column is pinned to this row's parent.
            if !index.columns().iter().zip(key).chain(equalities.iter().map(|(column,term)|(column,term))).any(|(column, term)|
                column == reference && term == &RuleTerm::Field(reference.clone())) { continue; }
            let Some(ast::ScalarType { kind: ast::TypeKind::Ref { table: parent }, .. }) = info.columns.get(reference) else { continue };
            out.push(Diagnostic::new(&column.site, "N_SEQUENCE_READ",
                format!("{}.{}: the first membership in an empty {} group always refuses E_RULE: sequence read authority requires `{}` before this row is inserted. `created {parent}[.{reference}]` can admit the insert rule but cannot establish that read authority or a fresh shared counter", name, column.name, reference, table.rules.read.quarry()),
                format!("preserve this membership audience with the manual allocator in `guide sequences`: use `{}: int` on {name}, `lastOrdinal: int default 0` on {parent}; seed the new parent's {name} rows with {}: 0. For later inserts, assign {} from the readable parent's counter and advance it atomically wherever your model allocates a position. Preserve existing uniqueness constraints. See `guide sequences` for counters shared across tables.", column.name, column.name, column.name)).guide("sequences"));
        }
    }
    out
}

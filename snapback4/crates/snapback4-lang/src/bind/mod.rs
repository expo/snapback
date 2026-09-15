//! Binding: documents in, a core schema and typed programs out, with every
//! problem as a located diagnostic.

pub mod catalog;
mod defaults;
mod maintains;
pub mod program;
pub mod schema;
pub mod residency;
mod actions;

use crate::ast::Document;
use crate::diag::Diagnostic;
use catalog::Catalog;
pub use program::BoundProgram;
use snapback4_core::schema::Schema;

pub struct Bound {
    pub schema: Schema,
    pub programs: Vec<BoundProgram>,
    pub personas: Vec<String>,
    pub diagnostics: Vec<Diagnostic>,
    /// Facts the compiler can state that are not errors: a page that is
    /// never `complete` because its read rule is not decided by its prefix.
    pub notes: Vec<Diagnostic>,
}

pub fn bind(documents: Vec<Document>) -> Bound {
    let mut diagnostics = Vec::new();
    let personas: Vec<String> = documents.iter().flat_map(|d| d.personas.iter().cloned()).collect();
    let catalog = Catalog::build(documents, &mut diagnostics);
    let mut schema = schema::bind_schema(&catalog, &mut diagnostics);
    let mut programs = Vec::new();
    let mut names = std::collections::BTreeMap::new();
    let mut api_roots = std::collections::BTreeMap::new();
    for doc in &catalog.documents {
        let module = std::path::Path::new(&doc.file).file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_else(|| "schema".into());
        for decl in &doc.programs {
            let full_name = operation_name(&module, &decl.name);
            if let Some(first) = names.get(&full_name) {
                diagnostics.push(crate::diag::unknown(&decl.site, format!("duplicate operation {full_name}; first declared at {first}"), "rename one operation or put it in a different module"));
                continue;
            }
            names.insert(full_name, decl.site.clone());
            if decl.kind != crate::ast::ProgramKind::Job {
                let nested = module != "schema";
                let root = if nested { &module } else { &decl.name };
                if let Some((first_nested, first_site)) = api_roots.get(root) && *first_nested != nested {
                    diagnostics.push(crate::diag::unknown(&decl.site, format!("API name {root} is both an operation and a module; first declared at {first_site}"), "rename the bare operation or the module file"));
                    continue;
                }
                api_roots.entry(root.clone()).or_insert((nested, decl.site.clone()));
            }
            if let Some(bound) = program::Binder::bind(&catalog, &module, decl, &mut diagnostics) {
                programs.push(bound);
            }
        }
    }
    actions::bind(&catalog, &mut programs, &mut diagnostics);
    // The residency facts come before admission: a never-predicting mutation may pass over a uniformly authorized page (LLP 3000.007 §5.9), and admission reads that class here.
    schema.operations = programs.iter().map(|bound| {
        let mut fact = residency::execution_with_presence(&schema, &bound.program, bound.presence.as_ref());
        for site in &mut fact.sites {
            if let Some((location, name)) = bound.sources.get(&site.site) {
                site.site = format!("{location} ({name})");
            } else if site.site.starts_with("programs.") {
                site.site = format!("{} ({} by {})", bound.site, site.table, site.index);
            }
        }
        (bound.program.name.clone(), fact)
    }).collect();
    for doc in &catalog.documents {
        let module = std::path::Path::new(&doc.file).file_stem().unwrap().to_string_lossy();
        for decl in &doc.programs {
            if decl.server && let Some(fact) = schema.operations.get_mut(&operation_name(&module, &decl.name)) {
                fact.predicts = Some("never".into());
                fact.sites.push(snapback4_core::schema::ResidencySite { site: decl.site.to_string(), table: "server".into(), index: "".into(), kind: "dispatch".into(), class: snapback4_core::schema::SiteClass::Server, reason: "author marked this mutation : server".into(), rewrite: "remove : server to allow prediction when every site is held".into() });
            }
        }
    }
    // @ref LLP 3000.007#20 — predicts asserts the existing eligibility decision; it never changes residency.
    for doc in &catalog.documents {
        let module = std::path::Path::new(&doc.file).file_stem().unwrap().to_string_lossy();
        for decl in doc.programs.iter().filter(|decl| decl.predicts) {
            let name = operation_name(&module, &decl.name);
            if let Some(fact) = schema.operations.get(&name) && fact.predicts.as_deref() == Some("never")
                && let Some(site) = fact.sites.iter().find(|site| site.class == snapback4_core::schema::SiteClass::Server) {
                diagnostics.push(Diagnostic::new(&decl.site, "E_NOT_PREDICTABLE", format!("mutation {name} asserts predicts, but {}", residency::prediction_reason(&schema, site)), &site.rewrite).guide("prediction"));
            }
        }
    }
    if diagnostics.is_empty() {
        programs.retain(|bound| match snapback4_core::engine::admission::check_detail(&schema, &bound.program) {
            Ok(()) => true,
            Err(error) => {
                let source = bound.sources.get(&error.site).or_else(|| error.page_site.as_ref().and_then(|site| bound.sources.get(site)));
                let site = source.map_or(&bound.site, |(site, _)| site);
                let message = if error.site.starts_with("for/") && let Some((_, name)) = source { format!("loop over {name}: {}", error.message) } else { error.message };
                let mut rewrite = error.rewrite;
                if rewrite.starts_with("iterate the original group:") && let Some(page) = error.page_site.as_ref().and_then(|site| bound.sources.get(site))
                    && let Some(scan) = snapback4_core::ir::scans(&bound.program).into_iter().find(|scan| Some(&scan.site) == error.page_site.as_ref()) {
                    let spelling = format!("{}[..]", scan.table);
                    rewrite = rewrite.replace(&spelling, &page.1);
                }
                diagnostics.push(Diagnostic::new(site, error.code, message, rewrite).guide("programs"));
                false
            }
        });
    }
    for doc in &catalog.documents {
        for decl in &doc.schedules {
            match bind_schedule(decl, &programs) {
                Ok(schedule) => schema.schedules.push(schedule),
                Err(diagnostic) => diagnostics.push(diagnostic),
            }
        }
    }
    schema.operations.retain(|name, _| programs.iter().any(|bound| &bound.program.name == name));
    let mut notes: Vec<_> = programs.iter().flat_map(|p| p.notes.clone()).collect();
    notes.extend(completeness_notes(&catalog, &schema, &programs));
    notes.extend(residency::maintain_notes(&catalog, &schema));
    Bound { schema, programs, personas, diagnostics, notes }
}

fn operation_name(module: &str, name: &str) -> String {
    if module == "schema" { name.to_owned() } else { format!("{module}.{name}") }
}

/// Programs and rules use the same i53 literal domain. A token must never
/// change its numeric meaning because it was written in a rule position.
fn integer_literal(text: &str, site: &crate::diag::Site) -> crate::diag::Fallible<i64> {
    text.parse::<i64>().ok().filter(|n| (snapback4_core::value::I53_MIN..=snapback4_core::value::I53_MAX).contains(n)).ok_or_else(|| crate::diag::type_error(site, "number literals are integers within ±(2^53 − 1)", "use a decimal column with scaled integer minor units"))
}

/// A named key is a one-to-one spelling of an index prefix, never a mix
/// of names and positions. Validate before either program or rule binding.
fn validate_key_names(read: &crate::ast::ReadExpr) -> crate::diag::Fallible<()> {
    let mut names = std::collections::BTreeSet::new();
    for key in &read.keys {
        if let Some(name) = &key.column && !names.insert(name) {
            return Err(crate::diag::unknown(&key.site, format!("key repeats column {name}"), format!("name each {} index column once; replace the repeated {name} with the missing column", read.table)));
        }
    }
    if !names.is_empty() && names.len() != read.keys.len() {
        return Err(crate::diag::unknown(&read.site, "a key cannot mix named and positional components", "name every key component, or supply all components in index order"));
    }
    Ok(())
}

/// A schedule fires a job; the job may take the period it covers, as
/// `periodStart: time` and `periodEnd: time`, and nothing else.
fn bind_schedule(decl: &crate::ast::ScheduleDecl, programs: &[BoundProgram]) -> Result<snapback4_core::schema::Schedule, Diagnostic> {
    use snapback4_core::ir::{ArgType, ProgramKind};
    let rewrite = format!("job {}(periodStart: time, periodEnd: time):\n  chunk p in profiles first 100 by byId:\n    ...", decl.target);
    let Some(target) = programs.iter().find(|p| p.program.name == decl.target) else {
        let candidates: Vec<_> = programs.iter().filter(|p| p.program.kind == ProgramKind::Job && p.program.name.rsplit_once('.').is_some_and(|(_, name)| name == decl.target)).collect();
        if let [target] = candidates.as_slice() {
            return Err(crate::diag::unknown(&decl.site, format!("schedule {} names bare job {}; {} declares it as {}", decl.name, decl.target, target.site.file, target.program.name), target.program.name.clone()).guide("jobs").mechanical());
        }
        return Err(crate::diag::unknown(&decl.site, format!("schedule {} names no job {}; jobs outside schema.q are named <module>.<job>", decl.name, decl.target), crate::diag::name_rewrite(&decl.target, programs.iter().filter(|p| p.program.kind == ProgramKind::Job).map(|p| p.program.name.as_str()), None)).guide("jobs"));
    };
    if target.program.kind != ProgramKind::Job {
        return Err(Diagnostic::new(&decl.site, "E_SCHEDULE", format!("schedule {} names {}, which is a {}; a schedule fires a job", decl.name, decl.target, target.program.kind.word()), rewrite));
    }
    for (name, kind) in &target.program.args {
        if !(matches!(name.as_str(), "periodStart" | "periodEnd") && *kind == ArgType::Time) {
            return Err(Diagnostic::new(&decl.site, "E_SCHEDULE", format!("schedule {} fires {}, whose argument {name} the clock cannot supply; a scheduled job takes periodStart: time and periodEnd: time, or nothing", decl.name, decl.target), rewrite));
        }
    }
    Ok(snapback4_core::schema::Schedule { name: decl.name.clone(), every_ms: decl.every_ms, offset_ms: decl.offset_ms, target: decl.target.clone() })
}

/// A scan whose read rule reads a column the prefix does not pin is
/// `complete: false` on the server whatever it finds (LLP 3000 §7,
/// completeness is a class): say so at compile time, with the index that
/// would decide it, as Snapback 2's structural facts did.
fn completeness_notes(catalog: &Catalog, schema: &Schema, programs: &[BoundProgram]) -> Vec<Diagnostic> {
    let mut notes = Vec::new();
    // A synced table with no horizon: every row of every group a device
    // holds reaches it, and stays. Say so once per table, with the index a
    // horizon would name, before the table grows.
    for (name, table, sync) in schema.synced() {
        if sync.horizon.is_some() || schema.maintain_for(name).is_some() {
            continue;
        }
        let prefix: Vec<String> = match &sync.audience {
            snapback4_core::schema::Audience::Public => Vec::new(),
            snapback4_core::schema::Audience::Column(column) => vec![column.clone()],
            snapback4_core::schema::Audience::Target { prefix, .. } => prefix.clone(),
        };
        // A group of one row (the table's own id), or a group a `cap` bounds,
        // cannot grow: nothing to horizon.
        if prefix == ["id"] || table.constraints.iter().any(|c| matches!(c, snapback4_core::schema::Constraint::Cap { by, .. } if *by == prefix)) {
            continue;
        }
        let ordered = table.indexes.iter().find(|(index_name, index)| *index_name != "byId" && index.columns().starts_with(&prefix) && index.columns().len() > prefix.len()).map(|(index_name, _)| index_name.clone());
        let site = catalog.site_for(&format!("tables.{name}"));
        let rewrite = match ordered {
            Some(index) => format!("{} last 500 by {index}", sync.line()),
            None => format!("by by{}At: {}at, id  -- then: {} last 500 by by{}At", if prefix.is_empty() { "".to_owned() } else { "Group".to_owned() }, prefix.iter().map(|c| format!("{c}, ")).collect::<String>(), sync.line(), if prefix.is_empty() { "" } else { "Group" }),
        };
        notes.push(Diagnostic::new(&site, "N_NO_HORIZON", format!("table {name}: `{}` has no horizon, so every row of every group a device holds reaches it and stays; a device that holds many groups, or a public table that grows, pays for all of it at every cold start", sync.line()), rewrite).guide("sync"));
    }
    for bound in programs {
        // Follow the same return/alias/shape provenance as continuations.
        // A consumed loop is not a page the caller needs to continue.
        let returned = snapback4_core::engine::returned_page_sites(&bound.program);
        let mut noted = std::collections::BTreeSet::new();
        for page in snapback4_core::ir::scans(&bound.program) {
            let site = page.merge_site.as_ref().unwrap_or(&page.site);
            let pinned = schema.tables[&page.table].indexes[&page.index].columns().into_iter().take(page.prefix.len()).collect::<Vec<_>>();
            // A lane cap does not bound the union of a merge. Quarry page takes are literals.
            let group_complete = page.merge_site.is_none() && schema.group_bound(&page.table, &pinned).is_some_and(|n| u64::from(n) <= page.take.maximum());
            if !page.opaque_cursor && !group_complete && returned.contains(site) && noted.insert(site) {
                let (table, take) = (&page.table, page.take.maximum());
                notes.push(Diagnostic::new(&bound.site, "N_NO_CURSOR", format!("{} {} returns a page of {take} {table} rows with no cursor: when more rows exist the card reads `complete: false` and there is no `next` to continue on", bound.program.kind.word(), bound.program.name), format!("declare `c: cursor ?` and page with `after c` — {}(.., c: cursor ?): return {}[..] after c last {take} by <index>", bound.program.name, table)).guide("reads"));
            }
        }
        // Wide merges still pay for lane discovery and authorization, even
        // when ordered heads avoid reading a full page from every lane.
        for merge in merges(&bound.program.body) {
            let take = merge.take() + 1;
            let lanes: u64 = merge.lanes.iter().map(|lane| lane.source.as_ref().map_or(1, |source| source.take.maximum())).sum();
            if lanes <= 50 {
                continue;
            }
            let rows = lanes * take;
            let ceiling = snapback4_core::Ceilings::default().examined.to_string();
            let ceiling = if ceiling == "8192" { "8,192" } else { &ceiling };
            let work = if snapback4_core::engine::rules::lazy_merge(schema, merge) {
                format!("up to {lanes} lanes, reading one head per lane and advancing the winning lanes; discovery, lookahead, duplicates and expired rows also consume the meter")
            } else {
                format!("up to {lanes} lanes, one page of {take} each — up to {rows} rows per read")
            };
            notes.push(
                Diagnostic::new(
                    &bound.site,
                    "N_WIDE_MERGE",
                    format!("{} {}: the merge over {} reads {work}; a read past the {ceiling} examined ceiling returns `complete: false`", bound.program.kind.word(), bound.program.name, merge.table()),
                    "measure with `snapback4 test --cost`; keep the lanes under 50 (`first 50` on the lane source), or write the feed on the way in: a table of entries per reader, synced to .reader, read as one page (`snapback4 guide feeds`)",
                )
                .guide("feeds"),
            );
        }
        // A job sweeps as the system principal, which every rule admits.
        if bound.program.kind == snapback4_core::ir::ProgramKind::Job {
            continue;
        }
        for scan in snapback4_core::ir::scans(&bound.program) {
            let Some(table) = schema.table(&scan.table) else { continue };
            if table.rules.read.is_uniformly_readable() {
                continue;
            }
            let visibility = snapback4_core::engine::rules::scan_visibility(schema, scan);
            if visibility.uniform {
                continue;
            }
            let Some(index) = table.index(&scan.index) else { continue };
            let pinned: std::collections::BTreeSet<String> = index.components.iter().zip(&scan.prefix).filter_map(|(component, key)| key.scalar().and(component.column()).cloned()).collect();
            let used = snapback4_core::engine::rules::deciding_fields(&scan.table, table, &table.rules.read);
            let unpinned: Vec<String> = used.difference(&pinned).cloned().collect();
            let mut leading = unpinned.clone();
            for column in index.columns().into_iter().skip(scan.prefix.len()) {
                if !leading.contains(&column) { leading.push(column); }
            }
            let leading = leading.join(", ");
            let search_rewrite = matching_merge_rewrite(schema, scan, table);
            notes.push(
                Diagnostic::new(
                    &bound.site,
                    "N_NEVER_COMPLETE",
                    format!("{} {}: the page over {}[..] by {} is never `complete` — the read rule `{}` reads {}, which the scan does not pin, so the server cannot tell \"no more\" from \"more you may not read\"", bound.program.kind.word(), bound.program.name, scan.table, scan.index, table.rules.read.quarry(), unpinned.iter().map(|c| format!(".{c}")).collect::<Vec<_>>().join(", ")),
                    search_rewrite.clone().unwrap_or_else(|| format!("scan by an index leading with {leading} (`by by{}: {leading}`), or read the page on the device, where the partition holds exactly what the viewer may read", unpinned.iter().map(|c| { let mut cs = c.chars(); cs.next().map(|f| f.to_uppercase().collect::<String>() + cs.as_str()).unwrap_or_default() }).collect::<String>())),
                )
                .guide(if search_rewrite.is_some() { "search" } else { "reads" }),
            );
        }
    }
    notes
}

fn matching_merge_rewrite(schema: &Schema, scan: &snapback4_core::ir::Scan, table: &snapback4_core::schema::Table) -> Option<String> {
    use snapback4_core::{ir::IndexKeyExpr, schema::{RuleExpr, RuleTerm}};
    if !scan.prefix.iter().any(|key| matches!(key, IndexKeyExpr::WordPrefix(_))) { return None; }
    // @ref LLP 3000.007#18.1 — a membership conjunct supplies lanes when their scope decides the whole rule.
    fn conjuncts(rule: &RuleExpr) -> Vec<&RuleExpr> {
        match rule { RuleExpr::And(terms) => terms.iter().flat_map(conjuncts).collect(), other => vec![other] }
    }
    conjuncts(&table.rules.read).into_iter().find_map(|rule| {
        let RuleExpr::Exists { table: members, index: membership_index, key, .. } = rule else { return None; };
        let membership = schema.table(members)?;
        let columns = membership.index(membership_index)?.columns();
        let principal = key.iter().position(|term| matches!(term, RuleTerm::Viewer))?;
        let scope: Vec<_> = key.iter().filter_map(|term| if let RuleTerm::Field(field) = term { Some(field.clone()) } else { None }).collect();
        let deciding = snapback4_core::engine::rules::deciding_fields(&scan.table, table, &table.rules.read);
        if !deciding.iter().all(|field| scope.contains(field)) { return None; }
        let fields = table.index(&scan.index)?.word_component()?.1;
        let (words_index, _) = table.indexes.iter().find(|(_, index)| index.word_component().is_some_and(|(position, text)| index.columns()[..position] == scope && text == fields))?;
        let (source_index, _) = membership.indexes.iter().find(|(_, index)| index.is_plain() && index.columns().first() == columns.get(principal) && index.columns().last().is_some_and(|column| column == "id"))?;
        let prefix = key.iter().zip(&columns).filter_map(|(term, column)| matches!(term, RuleTerm::Field(_)).then(|| format!("m.{column}"))).collect::<Vec<_>>().join(", ");
        Some(format!("merge {} matching q last {} by {words_index}: [{prefix}] for m in {members}[viewer] first 50 by {source_index} — one verdict per scope and a complete page; or read the page on the device", scan.table, scan.take.maximum()))
    })
}

/// Every merge a program's body evaluates.
pub fn merges(stmts: &[snapback4_core::ir::Stmt]) -> Vec<&snapback4_core::ir::Merge> {
    use snapback4_core::ir::{Expr, Stmt};
    fn in_expr<'a>(expr: &'a Expr, out: &mut Vec<&'a snapback4_core::ir::Merge>) {
        match expr {
            Expr::Merge(merge) => out.push(merge),
            Expr::Field { base, .. } => in_expr(base, out),
            Expr::Array(items) | Expr::Builtin { args: items, .. } => items.iter().for_each(|item| in_expr(item, out)),
            Expr::Object(fields) => fields.values().for_each(|item| in_expr(item, out)),
            Expr::Binary { left, right, .. } => {
                in_expr(left, out);
                in_expr(right, out);
            }
            Expr::Unary { value, .. } => in_expr(value, out),
            _ => {}
        }
    }
    fn in_stmts<'a>(stmts: &'a [Stmt], out: &mut Vec<&'a snapback4_core::ir::Merge>) {
        for stmt in stmts {
            match stmt {
                Stmt::Const { value, .. } | Stmt::Let { value, .. } | Stmt::Assign { value, .. } | Stmt::Push { value, .. } | Stmt::Return(value) | Stmt::Emit { payload: value, .. } => in_expr(value, out),
                Stmt::If { condition, then_body, else_body } => {
                    in_expr(condition, out);
                    in_stmts(then_body, out);
                    in_stmts(else_body, out);
                }
                Stmt::For { body, .. } => in_stmts(body, out),
                _ => {}
            }
        }
    }
    let mut out = Vec::new();
    in_stmts(stmts, &mut out);
    out
}

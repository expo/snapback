//! Binding: documents in, a core schema and typed programs out, with every
//! problem as a located diagnostic.

pub mod catalog;
mod columns;
mod defaults;
mod maintains;
mod row_views;
pub mod program;
pub mod schema;
pub mod residency;
mod actions;
mod routes;
mod server;
mod key_bound;
mod aggregate_copies;
mod time_indexes;
mod timeline;
mod feed_view;
mod intent;
mod intent_aggregates;
mod intent_walk;
mod intent_views;
mod view_predicate;
mod intent_lanes;
mod intent_windows;
mod intent_sync;

use crate::ast::Document;
use crate::diag::Diagnostic;
use catalog::Catalog;
pub use program::BoundProgram;
pub use aggregate_copies::truth as rule_truth;
use snapback4_core::schema::Schema;

pub struct Bound {
    pub view_types: std::collections::BTreeMap<String, crate::types::Ty>,
    /// Authoring-only opt-in; never stored in the core schema, IR or wire.
    pub server: bool,
    pub schema: Schema,
    pub programs: Vec<BoundProgram>,
    pub personas: Vec<String>,
    pub diagnostics: Vec<Diagnostic>,
    /// Facts the compiler can state that are not errors: a page that is
    /// never `complete` because its read rule is not decided by its prefix.
    pub notes: Vec<Diagnostic>,
}

pub fn bind(mut documents: Vec<Document>) -> Bound {
    let mut diagnostics = Vec::new();
    let server = documents.iter().any(|doc| doc.server);
    server::admit(&mut documents, &mut diagnostics);
    let feeds = feed_view::expand(&mut documents, &mut diagnostics);
    let documents = timeline::expand(documents, &mut diagnostics);
    let personas: Vec<String> = documents.iter().flat_map(|d| d.personas.iter().cloned()).collect();
    let mut catalog = Catalog::build(documents, &mut diagnostics);
    catalog.feed_views = feeds;
    intent::table_order(&mut catalog);
    intent_views::expand(&mut catalog, &mut diagnostics);
    intent::plan(&mut catalog, &mut diagnostics);
    let mut schema = schema::bind_schema(&catalog, &mut diagnostics);
    timeline::admit(&catalog, &mut schema, &mut diagnostics);
    // Timeline ownership is resolved after the ordinary schema checks.
    for issue in snapback4_core::schema::columns::timeline_issues(&schema) {
        diagnostics.push(columns::refusal(&catalog.site_for(&issue.path), issue.message));
    }
    key_bound::check(&catalog, &schema, &mut diagnostics);
    let mut view_types: std::collections::BTreeMap<_, _> = catalog.feed_views.iter().map(|(name, plan)| (name.clone(), plan.ty())).collect();
    for doc in &catalog.documents {
        for decl in doc.programs.iter().filter(|decl| decl.name.starts_with("$view:")) {
            if let Some(bound) = program::Binder::bind(&catalog, &schema, "schema", decl, &mut diagnostics) {
                view_types.extend(bound.view_types);
            }
        }
    }
    catalog.view_types = view_types.clone();
    for doc in &mut catalog.documents { doc.programs.retain(|decl| !decl.name.starts_with("$view:")); }
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
            if let Some(bound) = program::Binder::bind(&catalog, &schema, &module, decl, &mut diagnostics) {
                programs.push(bound);
            }
        }
    }
    actions::bind(&catalog, &mut schema, &mut programs, &mut diagnostics);
    routes::bind(&catalog, &mut schema, &mut diagnostics);
    // The residency facts come before admission: a never-predicting mutation may pass over a uniformly authorized page (LLP 3000.007 §5.9), and admission reads that class here.
    schema.operations = programs.iter().map(|bound| {
        let mut fact = residency::execution_with_presence(&schema, &bound.program, bound.presence.as_ref());
        residency::locate_sites(&catalog, bound, &mut fact);
        (bound.program.name.clone(), fact)
    }).collect();
    for doc in &catalog.documents {
        let module = std::path::Path::new(&doc.file).file_stem().unwrap().to_string_lossy();
        for decl in &doc.programs {
            if decl.held && let Some(fact) = schema.operations.get_mut(&operation_name(&module, &decl.name)) {
                fact.held = true;
                fact.components.clear();
                fact.runs = Some("device".into());
            }
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
                    let group = whole_group_rewrite(&catalog, &page.1, scan);
                    rewrite = format!("iterate the original group: `for row in {group}:`; put the condition and work inside that loop");
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
    schema.action_specs.retain(|name, _| programs.iter().any(|bound| &bound.program.name == name && bound.program.kind == snapback4_core::ir::ProgramKind::Action));
    let mut notes: Vec<_> = programs.iter().flat_map(|p| p.notes.clone()).chain(catalog.planner_notes.clone()).collect();
    notes.extend(completeness_notes(&catalog, &schema, &programs));
    notes.extend(residency::maintain_notes(&catalog, &schema));
    notes.extend(columns::notes(&catalog, &schema));
    notes.extend(residency::guard_notes(&schema, &programs));
    notes.extend(timeline::notes(&catalog, &schema));
    if diagnostics.is_empty() { notes.extend(aggregate_copies::notes(&catalog, &schema)); }
    Bound { view_types, server, schema, programs, personas, diagnostics, notes }
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

/// A schedule fires a job or a service-authorized action; either may take
/// `periodStart: time` and `periodEnd: time`, and nothing else.
fn bind_schedule(decl: &crate::ast::ScheduleDecl, programs: &[BoundProgram]) -> Result<snapback4_core::schema::Schedule, Diagnostic> {
    use snapback4_core::ir::{ArgType, ProgramKind};
    let rewrite = format!("job {}(periodStart: time, periodEnd: time):\n  for p in profiles:\n    ...", decl.target);
    let Some(target) = programs.iter().find(|p| p.program.name == decl.target) else {
        let candidates: Vec<_> = programs.iter().filter(|p| matches!(p.program.kind, ProgramKind::Job | ProgramKind::Action) && p.program.name.rsplit_once('.').is_some_and(|(_, name)| name == decl.target)).collect();
        if let [target] = candidates.as_slice() {
            return Err(crate::diag::unknown(&decl.site, format!("schedule {} names bare {} {}; {} declares it as {}", decl.name, target.program.kind.word(), decl.target, target.site.file, target.program.name), target.program.name.clone()).guide("jobs").mechanical());
        }
        return Err(crate::diag::unknown(&decl.site, format!("schedule {} names no job or action {}; targets outside schema.q are named <module>.<name>", decl.name, decl.target), crate::diag::name_rewrite(&decl.target, programs.iter().filter(|p| matches!(p.program.kind, ProgramKind::Job | ProgramKind::Action)).map(|p| p.program.name.as_str()), None)).guide("jobs"));
    };
    if !matches!(target.program.kind, ProgramKind::Job | ProgramKind::Action) {
        return Err(Diagnostic::new(&decl.site, "E_SCHEDULE", format!("schedule {} names {}, which is a {}; a schedule fires a job or action", decl.name, decl.target, target.program.kind.word()), rewrite));
    }
    // @ref LLP 3000.009#5.2 — a scheduled action names a service seat, never a caller or the system.
    match (target.program.kind, decl.service.as_deref()) {
        (ProgramKind::Action, None) => return Err(Diagnostic::new(&decl.site, "E_SCHEDULE", "a scheduled action requires a service seat", format!("schedule {} every 1m as service:billing: {}", decl.name, decl.target)).guide("actions")),
        (ProgramKind::Job, Some(_)) => return Err(Diagnostic::new(&decl.site, "E_SCHEDULE", "a job runs as the system; its schedule cannot declare a service seat", format!("schedule {} every 1m: {}", decl.name, decl.target))),
        (_, Some(service)) if !service.strip_prefix("service:").is_some_and(|name| !name.is_empty() && name.len() <= 64 && name.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_' || b == b'-')) => return Err(Diagnostic::new(&decl.site, "E_SCHEDULE", "a service seat needs 1–64 letters, digits, _ or -", "as service:billing").guide("actions")),
        _ => {}
    }
    if target.program.kind == ProgramKind::Action && decl.service.as_deref().is_some_and(|service|
        snapback4_core::engine::actions::authorize(&target.program, service).is_err()) {
        return Err(Diagnostic::new(&decl.site, "E_SCHEDULE", "the scheduled service seat is refused by the action's admission rule", "name a service seat the action admits, or revise its rule").guide("actions"));
    }
    for (name, kind) in &target.program.args {
        if !(matches!(name.as_str(), "periodStart" | "periodEnd") && *kind == ArgType::Time) {
            return Err(Diagnostic::new(&decl.site, "E_SCHEDULE", format!("schedule {} fires {}, whose argument {name} the clock cannot supply; a scheduled job or action takes periodStart: time and periodEnd: time, or nothing", decl.name, decl.target), if target.program.kind == ProgramKind::Action { format!("action {}(periodStart: time, periodEnd: time)", decl.target) } else { rewrite }));
        }
    }
    Ok(snapback4_core::schema::Schedule { name: decl.name.clone(), every_ms: decl.every_ms, offset_ms: decl.offset_ms, target: decl.target.clone(), service: decl.service.clone() })
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
        if sync.horizon.is_some() || schema.maintain_for(name).is_some() || residency::needs_whole_partition(schema, name)
            || schema.timelines.iter().any(|t| t.maps(name) || t.owns(name)) {
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
        // @ref LLP 3000.007#20.23 — a horizon decides *which* rows a device keeps, so the
        // index must order the group by when its rows were minted. Any other index is
        // well-formed: it compiles, silences this note, and leaves residency arbitrary,
        // and no later check can tell the two apart. `id` qualifies by construction —
        // ids carry 48 bits of milliseconds and sort in mint order (core `ids.rs`).
        // `find` hands the predicate `&(&String, &Index)`, so its `index` binds as
        // `&&Index`: method calls auto-deref, a closure argument does not.
        let orders_by_mint_time = |index: &&snapback4_core::schema::Index| {
            index.columns().get(prefix.len()).is_some_and(|column| {
                column.as_str() == "id"
                    || table.columns.get(column.as_str()) == Some(&snapback4_core::schema::ColumnType::Time)
            })
        };
        let ordered = table.indexes.iter().find(|(index_name, index)| *index_name != "byId" && index.is_plain() && index.columns().starts_with(&prefix) && index.columns().len() > prefix.len() && orders_by_mint_time(index)).map(|(index_name, _)| index_name.clone());
        // A `cap` over columns that are not the sync group bounds rows per group, not
        // what a device acquires. An author who wrote one has already tried to bound
        // this table and will read an unqualified note as not having noticed.
        let unbounding_cap = table.constraints.iter().find_map(|c| match c {
            snapback4_core::schema::Constraint::Cap { by, max } if *by != prefix => Some((by.join(", "), *max)),
            _ => None,
        });
        let site = catalog.site_for(&format!("tables.{name}"));
        let rewrite = match ordered {
            Some(ref index) => format!("{} last 500 by .{}", sync.line(), table.indexes[index].columns()[prefix.len()]),
            None => format!("{} last 500 by .id", sync.line()),
        };
        let affected = residency::incompatible_horizon_pages(schema, programs, name, ordered.as_deref());
        let rewrite = if affected.is_empty() { rewrite } else {
            format!("a horizon would cost these mutations their prediction: {}; keep `{}`", affected.join(", "), sync.line())
        };
        let mut message = format!("table {name}: `{}` has no horizon, so every row of every group a device holds reaches it and stays; a device that holds many groups, or a public table that grows, pays for all of it at every cold start", sync.line());
        if let Some((by, max)) = unbounding_cap {
            message.push_str(&format!("; `cap {max} by {by}` bounds the rows per {by}, not what a device acquires — `{}` delivers every {by}'s rows to every device", sync.line()));
        }
        message.push_str("; measure what it costs with `check --residency`");
        notes.push(Diagnostic::new(&site, "N_NO_HORIZON", message, rewrite).guide("sync"));
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
            // @ref LLP 3000.007#5.6 — a meter-cut page still needs continuation; a plain scan charges one examined unit per candidate.
            let group_complete = page.merge_site.is_none() && schema.group_bound(&page.table, &pinned).is_some_and(|n| {
                u64::from(n) <= page.take.maximum() && u64::from(n) <= snapback4_core::Ceilings::default().examined
            });
            if !page.opaque_cursor && !group_complete && returned.contains(site) && noted.insert(site) {
                let (table, take) = (&page.table, page.take.maximum());
                let cap = if !pinned.is_empty() && schema.group_bound(table, &pinned).is_none() && page.merge_site.is_none() && schema.maintain_for(table).is_none() && schema.tables[table].indexes[&page.index].is_plain() {
                    let limit = take.min(snapback4_core::Ceilings::default().examined);
                    let by = format!(" by {}", pinned.join(", "));
                    format!("or declare `cap {limit}{by}` on table {table} if that is the intended group limit, then read `{table} where {}` without a page clause; other metered work can still cut the read", pinned.iter().map(|column| format!(".{column} = <value>")).collect::<Vec<_>>().join(" and "))
                } else {
                    "read the whole group with its where predicate and no page clause when its schema cap fits the examined ceiling; otherwise this page still needs continuation".into()
                };
                notes.push(Diagnostic::new(&bound.site, "N_NO_CURSOR", format!("{} {} returns a page of {take} {table} rows with no cursor: when more rows exist the card reads `complete: false` and there is no `next` to continue on", bound.program.kind.word(), bound.program.name), format!("declare `c: cursor ?` in {} and append `after c` to this {table} page, keeping its current predicate, direction and column order; {cap}", bound.program.name)).guide("reads"));
            }
        }
        // Wide merges still pay for lane discovery and authorization, even
        // when ordered heads avoid reading a full page from every lane.
        for merge in merges(&bound.program.body) {
            let take = merge.take() + 1;
            let Some(lanes) = merge.static_lanes() else { continue };
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
            // @ref LLP 3000.007#20.3 — principal-to-principal discovery grows with the relationship count; Following is one example.
            let related_principals = merge.lanes.iter().any(|lane| {
                use snapback4_core::ir::{Expr, Stmt};
                let Some(source) = lane.source.as_ref().and_then(snapback4_core::ir::LaneSource::scan) else { return false };
                let table = &schema.tables[&source.table];
                let index = &table.indexes[&source.index];
                let pinned = index.columns().into_iter().take(source.prefix.len()).collect::<Vec<_>>();
                pinned.iter().any(|name| table.columns.get(name) == Some(&snapback4_core::schema::ColumnType::Principal))
                    && lane.scan.prefix.iter().filter_map(|key| key.scalar()).any(|key| {
                        matches!(key, Expr::Field { base, name }
                            if matches!(base.as_ref(), Expr::Variable(binding) if binding == &lane.binding
                                || lane.setup.iter().any(|stmt| matches!(stmt, Stmt::Let { name, value: Expr::Variable(source) } if name == binding && source == &lane.binding)))
                                && !pinned.contains(name) && table.columns.get(name) == Some(&snapback4_core::schema::ColumnType::Principal))
                    })
            });
            let matching = merge.lanes.iter().any(|lane| lane.scan.prefix.iter().any(|key| matches!(key, snapback4_core::ir::IndexKeyExpr::WordPrefix(_))));
            let (message, rewrite) = if matching {
                // @ref LLP 3000.007#20.22.4 — a grouped filtered page continues membership discovery through a meter cut.
                (format!("{} {}: the merge over {} reads {work}; a read past the {ceiling} examined ceiling returns `complete: false`", bound.program.kind.word(), bound.program.name, merge.table()),
                    "use the grouped one-cursor form in `snapback4 guide search`, section \"Search every chat I'm in\", to search every membership through a meter cut; measure with `snapback4 check --cost`")
            } else if related_principals {
                (format!("{} {}: read cost grows with the number of related principals (up to {lanes} lanes); a read past the {ceiling} examined ceiling returns `complete: false`", bound.program.kind.word(), bound.program.name),
                    "keep read-time merges for a bounded small number of related principals; for Following, declare `maintain feed: timeline` (see `snapback4 guide feeds`); measure with `snapback4 check --cost`; if a held query answers this read, delete the merge")
            } else {
                // @ref LLP 3000.007#18.1 — membership search needs scope lanes; a timeline declaration addresses relationship-driven reads.
                (format!("{} {}: the merge over {} reads {work}; a read past the {ceiling} examined ceiling returns `complete: false`", bound.program.kind.word(), bound.program.name, merge.table()),
                    "measure with `snapback4 check --cost`; bound lane discovery to the scopes this read needs, and pass a cursor to continue the result; fewer lanes reduce read cost; if a held query answers this read, delete the merge")
            };
            notes.push(
                Diagnostic::new(
                    &bound.site,
                    "N_WIDE_MERGE",
                    message,
                    rewrite,
                )
                .guide(if matching { "search" } else if related_principals { "feeds" } else { "reads" }),
            );
        }
        // A held query has no server completeness class; its device still checks horizons and cuts.
        if schema.operations.get(&bound.program.name).is_some_and(|fact| fact.held) { continue; }
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
            // @ref LLP 3000.011.000.000#6 — prefer an existing compatible index without dropping the old equality prefix.
            for column in index.columns().into_iter().skip(if index.is_plain() { 0 } else { scan.prefix.len() }) {
                if !leading.contains(&column) { leading.push(column); }
            }
            let existing = index.is_plain().then(|| table.indexes.iter().find(|(_, candidate)| candidate.is_plain() && candidate.columns() == leading)).flatten();
            let columns = leading.join(", ");
            let search_rewrite = matching_merge_rewrite(schema, scan, table);
            let scope_rewrite = existing.map(|(name, _)| format!("pin {} with where equalities as well as the current equality prefix, choosing the intended scope (this narrows the answer); the existing index `{name}: {columns}` supports it; or read the page on the device", unpinned.iter().map(|column| format!(".{column}")).collect::<Vec<_>>().join(", ")));
            notes.push(
                Diagnostic::new(
                    &bound.site,
                    "N_NEVER_COMPLETE",
                    format!("{} {}: the page over {}[..] by {} is never `complete` — the read rule `{}` reads {}, which the scan does not pin, so the server cannot tell \"no more\" from \"more you may not read\"", bound.program.kind.word(), bound.program.name, scan.table, scan.index, table.rules.read.quarry(), unpinned.iter().map(|c| format!(".{c}")).collect::<Vec<_>>().join(", ")),
                    search_rewrite.clone().or(scope_rewrite).unwrap_or_else(|| format!("pin {} with where equalities as well as the current equality prefix, choosing the intended scope (this narrows the answer); or read the page on the device, where the partition holds exactly what the viewer may read", unpinned.iter().map(|column| format!(".{column}")).collect::<Vec<_>>().join(", "))),
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
        let (_, words_index) = table.indexes.iter().find(|(_, index)| index.word_component().is_some_and(|(position, text)| index.columns()[..position] == scope && text == fields))?;
        let _ = membership.indexes.iter().find(|(_, index)| index.is_plain() && index.columns().first() == columns.get(principal) && index.columns().last().is_some_and(|column| column == "id"))?;
        let order = words_index.columns().into_iter().skip(scope.len()).map(|column| format!(".{column}")).collect::<Vec<_>>().join(", ");
        Some(format!("{} matching q where {} last {} by {order} after c — one verdict per scope; complete while every head opens and the page fits in one read; or read the page on the device", scan.table, table.rules.read.quarry(), scan.take.maximum()))
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
                Stmt::Const { value, .. } | Stmt::Let { value, .. } | Stmt::Assign { value, .. } | Stmt::Push { value, .. } | Stmt::Return(value) => in_expr(value, out),
            Stmt::Emit { payload: value, once, .. } => { in_expr(value, out); if let Some(value) = once { in_expr(value, out); } },
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

// Admission rewrites remove the rejected page bound, retaining its exact pins.
fn whole_group_rewrite(catalog: &Catalog, source: &str, scan: &snapback4_core::ir::Scan) -> String {
    let (doc, errors) = crate::parse_document("rewrite.q", &format!("query group():\n  return {source}\n"));
    if errors.is_empty() && let Some(crate::ast::Stmt::Return { value: crate::ast::Expr::Read(read), .. }) = doc.programs.first().and_then(|program| program.body.first()) {
        let mut read = read.clone();
        intent::Requests::default().read(&catalog.tables, &mut read, false);
        let index = catalog.tables.get(&scan.table).and_then(|info| info.indexes.iter().find(|index| index.name == scan.index));
        let pins = read.keys.iter().enumerate().filter_map(|(i, key)| {
            let column = key.column.as_ref().or_else(|| index.and_then(|index| index.columns.get(i)))?;
            Some(format!(".{column} = {}", crate::print::expression(&key.value)))
        }).collect::<Vec<_>>();
        return if pins.is_empty() { read.table } else { format!("{} where {}", read.table, pins.join(" and ")) };
    }
    source.into()
}

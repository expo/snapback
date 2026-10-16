//! Binding: documents in, a core schema and typed programs out, with every
//! problem as a located diagnostic.

pub mod catalog;
mod columns;
mod ephemeral;
mod defaults;
mod first_paste;
mod maintains;
mod own_keys;
mod refusals;
pub(crate) mod rule_operator;
mod pin_rewrite;
mod complete_form;
mod auth_lints;
mod owner_equality;
mod write_affordances;
mod rule_composition;
pub(crate) mod audience_diagnostics;
mod row_views;
mod through;
pub mod program;
pub mod schema;
pub mod residency;
mod actions;
mod routes;
mod server;
mod key_bound;
pub(crate) mod unique_bound;
mod point_key;
mod index_diagnostics;
mod mixed_keys;
mod page_shapes;
pub(crate) mod stable_page_keys;
pub(crate) mod where_guards;
mod bracket_ranges;
mod reference_actions;
mod cascade_repair;
mod reference_arguments;
mod delete_guards;
mod private_scans;
mod optional_patches;
mod positional_keys;
mod helper_names;
mod aggregate_copies;
mod maintain_authorization;
mod time_indexes;
mod timeline;
mod feed_view;
mod intent;
mod intent_aggregates;
mod intent_variants;
pub(crate) mod intent_walk;
mod intent_views;
mod view_predicate;
mod intent_lanes;
mod intent_branches;
mod intent_compound;
mod intent_windows;
mod intent_sync;
mod intent_search;
mod held;
mod delivery;
mod receipts;
mod generated;

use crate::ast::Document;
use crate::diag::Diagnostic;
use catalog::Catalog;
pub use program::BoundProgram;
pub use aggregate_copies::truth as rule_truth;
use snapback4_core::schema::Schema;

pub struct Bound {
    /// Receipt member operation names, needed only by TypeScript emission.
    pub receipt_members: std::collections::BTreeMap<String, String>,
    /// Compiler-side source map; never serialized into the client backend.
    pub refusal_sites: std::collections::BTreeMap<(String, String), String>,
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

pub fn bind(documents: Vec<Document>) -> Bound {
    let mut bound = bind_unverified(documents.clone());
    crate::repair::verify_bound(&documents, &mut bound.diagnostics);
    bound
}

// Repair checks run the same planner and admission, without recursively
// verifying the diagnostics from a rejected candidate.
pub(crate) fn bind_unverified(mut documents: Vec<Document>) -> Bound {
    let mut diagnostics = Vec::new();
    let mut first_identity = None;
    for document in &documents {
        if let (Some(methods), Some(site)) = (document.identity, document.identity_site.as_ref()) {
            if let Some((first_methods, first_site)) = &first_identity {
                diagnostics.push(crate::parser::repeated_identity(
                    site,
                    *first_methods,
                    first_site,
                    methods,
                ));
            } else {
                first_identity = Some((methods, site.clone()));
            }
        }
    }
    // @ref LLP 3000.007#8 — catalog provenance comes from source, before any generated declarations.
    let authored_indexes = documents.iter().flat_map(|doc|
        doc.tables.iter().map(|t| (&t.name, &t.indexes))
            .chain(doc.maintains.iter().map(|m| (&m.name, &m.indexes))))
        .map(|(name, indexes)| (name.clone(), indexes.iter().map(|i| i.name.clone()).collect())).collect();
    receipts::expand(&mut documents, &mut diagnostics);
    ephemeral::declarations(&documents, &mut diagnostics);
    helper_names::normalize(&mut documents, &mut diagnostics);
    let server = documents.iter().any(|doc| doc.server);
    server::admit(&mut documents, &mut diagnostics);
    let feeds = feed_view::expand(&mut documents, &mut diagnostics);
    // Following expansion adds its durable timeline inputs. Recheck before lowering.
    if !feeds.is_empty() { ephemeral::declarations(&documents, &mut diagnostics); }
    let documents = timeline::expand(documents, &mut diagnostics);
    let personas: Vec<String> = documents.iter().flat_map(|d| d.personas.iter().cloned()).collect();
    let mut catalog = Catalog::build(documents, &mut diagnostics);
    catalog.feed_views = feeds;
    page_shapes::hoist(&mut catalog);
    mixed_keys::normalize(&mut catalog);
    intent::table_order(&mut catalog);
    intent_aggregates::remember_domains(&mut catalog);
    intent_search::capture(&mut catalog);
    intent_variants::expand(&mut catalog);
    intent_views::expand(&mut catalog, &mut diagnostics);
    // After argument-presence variants: `x = null or …` stays theirs (cursor validation across variants).
    where_guards::lower(&mut catalog);
    let stable_fields = catalog.tables.iter().map(|(name, table)| {
        let mut fields: std::collections::BTreeSet<String> = table.decl.columns.iter()
            .filter(|column| column.written_by.is_none() && column.maintained.is_none()).map(|column| column.name.clone()).collect();
        fields.insert("id".into()); (name.clone(), fields)
    }).collect();
    for doc in &mut catalog.documents { for program in &mut doc.programs { stable_page_keys::lower_program(program, &stable_fields); } }
    intent::plan(&mut catalog, &mut diagnostics);
    reference_actions::indexes(&mut catalog);
    let mut schema = schema::bind_schema(&catalog, &mut diagnostics);
    schema.authored_indexes = snapback4_core::schema::inspection::AuthoredIndexes(Some(authored_indexes));
    timeline::admit(&catalog, &mut schema, &mut diagnostics);
    delivery::bind(&catalog, &mut schema, &mut diagnostics);
    receipts::bind(&catalog, &mut schema, &mut diagnostics);
    schema.prepare_receipt_dependencies();
    reference_actions::bind(&catalog, &mut schema, &mut diagnostics);
    // @ref LLP 3000.015#1 — timeline mappings exist only after lowering both spellings.
    for issue in snapback4_core::schema::field_authority::validate(&schema) {
        if !diagnostics.iter().any(|d| d.code == "E_FIELD_AUTHORITY" && d.message == issue.message) {
            diagnostics.push(crate::diag::Diagnostic::new(&catalog.site_for(&issue.path), "E_FIELD_AUTHORITY", issue.message,
                "declare readable by audience before using a private field in a timeline mapping or predicate").guide("rules"));
        }
    }
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
    if diagnostics.is_empty() { intent_search::provision(&mut catalog, &mut schema, &programs); }
    // Planner-added indexes participate in the same final source prices.
    schema.export_write_reservations();
    // The residency facts come before admission: a never-predicting mutation may pass over a uniformly authorized page (LLP 3000.007 §5.9), and admission reads that class here.
    let mut receipt_notes = Vec::new();
    schema.operations = programs.iter().map(|bound| {
        let mut fact = residency::execution_with_presence(&schema, &bound.program, bound.presence.as_ref());
        residency::locate_sites(&catalog, bound, &mut fact);
        if bound.program.kind == snapback4_core::ir::ProgramKind::Mutation {
            let mut timed = false;
            for site in &mut fact.sites {
                if schema.table(&site.table).is_some_and(|table| table.not_before.is_some()) {
                    timed = true;
                    site.class = snapback4_core::schema::SiteClass::Server;
                    site.reason = format!("{} has `not before`; only the server resolves and changes scheduled rows", site.table);
                    site.rewrite = "queue this mutation while offline; a device clock never authorizes scheduled payloads".into();
                }
            }
            if timed { fact.predicts = Some("never".into()); }
        }
        if let Some((site, location)) = residency::receipts::located(&schema, bound, &catalog) {
            fact.predicts = Some("never".into());
            fact.sites.retain(|s| s.kind != "receipt dependency");
            let generated = schema.receipts.iter().any(|f| [f.delivered.as_str(), f.seen.as_str(), f.compact.as_str()].contains(&bound.program.name.as_str()));
            if !generated {
                receipt_notes.push(Diagnostic::new(&location, "N_RECEIPT_PREDICTION", format!("mutation {} predicts: never; queued without a row: {}", bound.program.name, site.reason), &site.rewrite).guide("receipts"));
            }
            fact.sites.insert(0, site);
        }
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
    ephemeral::programs(&catalog, &mut schema, &programs, &mut diagnostics);
    delivery::durability(&catalog, &schema, &mut diagnostics);
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
        let scopes = programs.iter().map(|bound| (&bound.program, &bound.maintenance_scopes)).collect::<Vec<_>>();
        for (i, message) in snapback4_core::engine::admission::check_state_predicate_scopes(&schema, &scopes) {
            diagnostics.push(Diagnostic::new(&programs[i].site, "E_VIEW_KEY", message,
                "project value or member fields before computing; use a separate variable for the row").guide("maintains"));
        }
    }
    if diagnostics.is_empty() {
        programs.retain(|bound| match snapback4_core::engine::admission::check_detail_with_statements(&schema, &bound.program, &bound.statement_ends) {
            Ok(()) => true,
            Err(error) => {
                if let Some(diagnostic) = bound.expiry_gap_diagnostic(&schema, &error).or_else(|| bound.constraint_diagnostic(&schema, &error)) {
                    diagnostics.push(diagnostic);
                    return false;
                }
                let source = bound.sources.get(&error.site).or_else(|| error.page_site.as_ref().and_then(|site| bound.sources.get(site)));
                let site = source.map_or(&bound.site, |(site, _)| site);
                // @ref LLP 3000.036.002#9 — the direct viewer predicate is the smallest structural-fanout repair.
                let direct_viewer_repair = bound.direct_viewer_repair(&schema, &error);
                let message = if error.site.starts_with("for/") && let Some((_, name)) = source { format!("loop over {name}: {}", error.message) } else { error.message };
                let mut rewrite = error.rewrite;
                if let Some(direct) = direct_viewer_repair {
                    rewrite = format!("{direct}{rewrite}");
                }
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
            let target = decl.target.strip_prefix("schema.").unwrap_or(&decl.target);
            if schema.operations.get(target).is_some_and(|f| f.ephemeral) {
                diagnostics.push(Diagnostic::new(&decl.site, "E_QUARRY_EPHEMERAL", "schedule cannot call an ephemeral mutation", "call the ephemeral mutation from the client").guide("ephemeral"));
                continue;
            }
            match bind_schedule(decl, &programs) {
                Ok(schedule) => schema.schedules.push(schedule),
                Err(mut diagnostic) => {
                    // A declared job that failed to bind already has its own error; this one only follows from it.
                    if !programs.iter().any(|p| p.program.name == decl.target)
                        && let Some(failed) = catalog.documents.iter().flat_map(|doc| doc.programs.iter()).find(|p| p.name == target || decl.target.ends_with(&format!(".{}", p.name))) {
                        diagnostic.cascade_of = Some(failed.site.clone());
                        // @ref LLP 3000.036#15.7 — lane 039: the job's own problem is the one to fix;
                        // this follows from it, so it reads as a cascade and hides beside its cause.
                        let end = catalog.documents.iter().flat_map(|doc| doc.programs.iter())
                            .filter(|p| p.site.file == failed.site.file && p.site.line > failed.site.line).map(|p| p.site.line).min().unwrap_or(u32::MAX);
                        if let Some(cause) = diagnostics.iter().find(|d| d.site.file == failed.site.file && (failed.site.line..end).contains(&d.site.line) && d.cascade_of.is_none()) {
                            diagnostic.message = format!("schedule {} names {}, which did not compile (its problem is at {})", decl.name, decl.target, cause.site);
                            diagnostic.rewrite = "fix this Quarry line and rerun snapback4 check".into();
                            diagnostic.cascade_of = Some(cause.site.clone());
                        }
                    }
                    diagnostics.push(diagnostic)
                }
            }
        }
    }
    schema.operations.retain(|name, _| programs.iter().any(|bound| &bound.program.name == name));
    schema.action_specs.retain(|name, _| programs.iter().any(|bound| &bound.program.name == name && bound.program.kind == snapback4_core::ir::ProgramKind::Action));
    let mut notes: Vec<_> = programs.iter().flat_map(|p| p.notes.clone()).chain(catalog.planner_notes.clone()).collect();
    notes.extend(receipt_notes);
    notes.extend(ephemeral::notes(&schema, &programs));
    notes.extend(completeness_notes(&catalog, &schema, &programs));
    notes.extend(denied_reads(&catalog, &schema, &programs));
    notes.extend(maintain_authorization::notes(&catalog, &schema));
    // @ref LLP 3000.036#16.4 — wave 6 #22: authorization shapes that compile but grant or withhold more than meant.
    notes.extend(auth_lints::notes(&catalog, &schema));
    notes.extend(write_affordances::notes(&catalog, &schema));
    notes.extend(rule_composition::notes(&catalog));
    notes.extend(optional_patches::notes(&catalog));
    notes.extend(residency::maintain_notes(&catalog, &schema));
    notes.extend(columns::notes(&catalog, &schema));
    notes.extend(residency::guard_notes(&schema, &programs));
    notes.extend(residency::sync_order_notes(&schema, &programs));
    notes.extend(residency::empty_partition_notes(&schema, &programs));
    notes.extend(held::notes(&schema, &programs));
    notes.extend(timeline::notes(&catalog, &schema));
    if diagnostics.is_empty() { notes.extend(aggregate_copies::notes(&catalog, &schema)); }
    index_diagnostics::authored(&catalog, &mut diagnostics);
    index_diagnostics::authored(&catalog, &mut notes);
    for program in &mut programs { index_diagnostics::authored(&catalog, &mut program.notes); }
    notes.extend(refusals::sequence_notes(&catalog, &schema));
    notes.extend(reference_actions::sites(&catalog, &schema, &mut diagnostics));
    notes.extend(reference_arguments::notes(&catalog, &schema));
    receipts::diagnostics(&catalog.documents, &mut diagnostics);
    if diagnostics.iter().any(|d| d.code == "E_SYNC") {
        for note in &mut notes {
            if matches!(note.code.as_str(),"N_NO_HORIZON"|"N_HORIZON_GUARD"|"N_SYNC_ORDER"|"N_NOT_PREDICTABLE"|"N_HELD_UNKNOWN") {
                note.message.insert_str(0,"provisional while E_SYNC is unresolved: ");
            }
        }
    }
    // @ref LLP 3000.032#4.3 — use the expanded mapping, never guess default operation names.
    let receipt_members = catalog.documents.iter().flat_map(|doc| {
        let module = std::path::Path::new(&doc.file).file_stem().unwrap().to_string_lossy();
        doc.tables.iter().filter_map(move |table| table.receipts.as_ref().map(|clause|
            (clause.name.clone(), operation_name(&module, &clause.operations[3]))))
    }).collect();
    if !schema.receipts.is_empty() && let Some(collision) = programs.iter().find(|bound|
        bound.program.kind != snapback4_core::ir::ProgramKind::Job
        && bound.program.name.split('.').next() == Some("receiptFamilies")) {
        diagnostics.push(Diagnostic::new(&collision.site, "E_RECEIPTS_CLAUSE",
            "API name receiptFamilies collides with the generated receipt-family namespace",
            "rename the operation or module receiptFamilies").guide("receipts"));
    }
    // A `$name` the author wrote (a quoted sort key, say) is theirs, not an internal.
    let authored: std::collections::BTreeSet<String> = catalog.source.declarations.values().flat_map(|text| dollar_words(text)).collect();
    internal_names(&mut diagnostics, &authored);
    // @ref LLP 3000.036#15.6 — notes print no `$` internals either (captures, temporaries).
    for note in &mut notes {
        note.message = spell_internals_except(&note.message, &authored);
        note.rewrite = spell_internals_except(&note.rewrite, &authored);
    }
    // Last, so the programs went through admission as before: a page the server
    // always refuses is still a program the disclosure suites can run.
    private_scans::check(&catalog, &schema, &programs, &mut diagnostics);
    let mut refusal_sites = refusals::sites(&catalog);
    refusal_sites.extend(refusals::lookup_sites(&programs));
    Bound { receipt_members, refusal_sites, view_types, server, schema, programs, personas, diagnostics, notes }
}

/// A read-through child binds its parent's rule over hidden captures
/// (`.$enrollment.dancer`); those names never parse. A problem that spells one
/// and, read through the parent (`.dancer`), repeats another problem is the
/// parent's refusal again: it is dropped. Otherwise the capture reads as the
/// reference it copies (`.enrollment.dancer`).
// @ref LLP 3000.036#14.3 — wave 4 #8 (064 080): never print `$`-prefixed internals in a problem.
fn internal_names(diagnostics: &mut Vec<Diagnostic>, authored: &std::collections::BTreeSet<String>) {
    let internal = |d: &Diagnostic| capture_spelling(&d.message).is_some() || capture_spelling(&d.rewrite).is_some();
    let through_parent = |text: &str| {
        let mut text = text.to_owned();
        while let Some(at) = capture_spelling(&text) {
            let name = text[at + 1..].bytes().take_while(|b| b.is_ascii_alphanumeric() || *b == b'_').count();
            text.replace_range(at..at + name + 2, "");
        }
        text
    };
    let plain: Vec<(String, String)> = diagnostics.iter().filter(|d| !internal(d)).map(|d| (d.code.clone(), d.message.clone())).collect();
    diagnostics.retain(|d| !internal(d) || !plain.contains(&(d.code.clone(), through_parent(&d.message))));
    for d in diagnostics.iter_mut().filter(|d| internal(d)) {
        while let Some(at) = capture_spelling(&d.message) { d.message.remove(at); }
        while let Some(at) = capture_spelling(&d.rewrite) { d.rewrite.remove(at); }
        d.mechanical = false;
    }
    // Any other `$`-prefixed compiler name (`$readThrough(report)`, `$intentLane`)
    // is a lowering's, never the author's: a problem spelling one beside another
    // problem at its site is that problem's cascade and is dropped; otherwise it
    // reads as the author wrote it (`read through .report`) or without the `$`.
    // @ref LLP 3000.036#15.6 — wave 5 lane 082: no `$` internal reaches a printed problem.
    let dollar = |d: &Diagnostic| internal_word_from(&d.message, 0, authored).is_some() || internal_word_from(&d.rewrite, 0, authored).is_some();
    let clean_sites: Vec<crate::Site> = diagnostics.iter().filter(|d| !dollar(d)).flat_map(|d| [Some(d.site.clone()), d.cascade_of.clone()]).flatten().collect();
    diagnostics.retain(|d| !dollar(d) || !(clean_sites.contains(&d.site) || d.cascade_of.as_ref().is_some_and(|site| clean_sites.contains(site))));
    for d in diagnostics.iter_mut() {
        if dollar(d) { d.mechanical = false; }
        d.message = spell_internals_except(&d.message, authored);
        d.rewrite = spell_internals_except(&d.rewrite, authored);
    }
    // The child's copy of the parent's refusal, reported at the parent's own site.
    let own: Vec<(crate::Site, String)> = diagnostics.iter().filter(|d| d.cascade_of.as_ref() != Some(&d.site)).map(|d| (d.site.clone(), d.code.clone())).collect();
    diagnostics.retain(|d| d.cascade_of.as_ref() != Some(&d.site) || !own.contains(&(d.site.clone(), d.code.clone())));
}

/// The byte range of a `$`-prefixed compiler name (`$readThrough`): a `$`
/// that starts an identifier and follows no word or quote character, so a
/// user's text literal (`'$5'`, `"$saved"`) is never one. A canonical
/// identity (`$intent:byAt:…`, `$view:…`) is not one either: `check` labels
/// planner indexes itself and `--verbose` prints them canonical on purpose.
fn internal_word_from(text: &str, from: usize, authored: &std::collections::BTreeSet<String>) -> Option<(usize, usize)> {
    let bytes = text.as_bytes();
    (from..bytes.len()).find_map(|at| {
        if bytes[at] != b'$' { return None; }
        if at > 0 && (bytes[at - 1].is_ascii_alphanumeric() || matches!(bytes[at - 1], b'_' | b'\'' | b'"')) { return None; }
        if !bytes.get(at + 1).is_some_and(|b| b.is_ascii_alphabetic()) { return None; }
        let name = text[at + 1..].bytes().take_while(|b| b.is_ascii_alphanumeric() || *b == b'_').count();
        if bytes.get(at + 1 + name) == Some(&b':') || authored.contains(&text[at..at + 1 + name]) { return None; }
        Some((at, at + 1 + name))
    })
}

/// Every `$name` spelled in authored source.
fn dollar_words(text: &str) -> Vec<String> {
    let bytes = text.as_bytes();
    (0..bytes.len()).filter(|&at| bytes[at] == b'$').filter_map(|at| {
        let name = text[at + 1..].bytes().take_while(|b| b.is_ascii_alphanumeric() || *b == b'_').count();
        (name > 0).then(|| text[at..at + 1 + name].to_owned())
    }).collect()
}

/// The author's spelling of each `$` name: `$readThrough(x)` is `read
/// through .x`, a capture `.$ref.field` (or `$a.$b.id`) is the path it copies
/// (`.ref.field`), and any other compiler name loses its `$`.
pub fn spell_internals(text: &str) -> String {
    spell_internals_except(text, &Default::default())
}

fn spell_internals_except(text: &str, authored: &std::collections::BTreeSet<String>) -> String {
    let mut text = text.to_owned();
    let mut from = 0;
    while let Some((start, end)) = internal_word_from(&text, from, authored) {
        let call = &text[end..];
        if &text[start..end] == "$readThrough" && call.starts_with('(') && let Some(close) = call.find(')') {
            let reference = call[1..close].trim().trim_start_matches('.').to_owned();
            let spelled = format!("read through .{reference}");
            text.replace_range(start..end + close + 1, &spelled);
            from = start + spelled.len();
        } else {
            text.remove(start);
            from = start;
        }
    }
    text
}

/// The byte offset of the `$` in a captured-parent spelling `.$reference.field`.
fn capture_spelling(text: &str) -> Option<usize> {
    let bytes = text.as_bytes();
    (1..bytes.len()).find(|&at| bytes[at] == b'$' && bytes[at - 1] == b'.' && {
        let name = text[at + 1..].bytes().take_while(|b| b.is_ascii_alphanumeric() || *b == b'_').count();
        name > 0 && bytes.get(at + 1 + name) == Some(&b'.')
    })
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
    Ok(snapback4_core::schema::Schedule { name: decl.name.clone(), every_ms: decl.every_ms, offset_ms: decl.offset_ms, target: decl.target.clone(), service: decl.service.clone(), months: decl.months })
}

/// A scan whose read rule reads a column the prefix does not pin is
/// `complete: false` on the server whatever it finds (LLP 3000 §7,
/// completeness is a class): say so at compile time, with the index that
/// would decide it, as Snapback 2's structural facts did.
/// `N_READ_DENIED`: a query or mutation looks up an aggregate by key whose
/// read rule is `deny`, so every caller reads an unavailable null.
// @ref LLP 3000.036#11 — lane 008: a deny maintain looked up in a shape read as 0.
fn denied_reads(catalog: &Catalog, schema: &Schema, programs: &[BoundProgram]) -> Vec<Diagnostic> {
    use snapback4_core::{ir::ProgramKind, schema::RuleExpr};
    let mut notes = Vec::new();
    for bound in programs {
        if !matches!(bound.program.kind, ProgramKind::Query | ProgramKind::Mutation) { continue; }
        let mut seen = std::collections::BTreeSet::new();
        for read in snapback4_core::ir::read_sites(&bound.program) {
            let Some(table) = schema.table(&read.table) else { continue };
            let Some(info) = catalog.tables.get(&read.table) else { continue };
            // A keyed aggregate lookup reserves the same rule decision for a hit
            // and miss. A denied one is unavailable in both worlds.
            if read.kind != "point" || info.maintained.is_none() { continue; }
            // Only an authored `read <- deny`: an aggregate without a read line inherits its source's audience.
            let Some(rule) = info.maintained.as_ref().and_then(|maintain| maintain.read.as_ref()) else { continue };
            let authored_deny = matches!(&rule.value, crate::ast::Expr::Name { name, .. } if name == "deny" || name == "false")
                || matches!(&rule.value, crate::ast::Expr::Literal { value: crate::ast::Literal::Bool(false), .. });
            if !authored_deny || !matches!(table.rules.read, RuleExpr::Deny) || !seen.insert(read.table.clone()) { continue; }
            let site = &rule.site;
            notes.push(Diagnostic::new(&bound.site, "N_READ_DENIED",
                format!("{} {} looks up aggregate {} by key, whose read rule is deny ({site}): every caller reads null, never an error", bound.program.kind.word(), bound.program.name, read.table),
                format!("give {} the read rule its readers need, over its group keys (for example the source table's rule), or read it only in a job, which runs as the system", read.table)).guide("rules"));
        }
    }
    notes
}

fn scan_pin<'a>(schema: &Schema, scan: &'a snapback4_core::ir::Scan, column: &str) -> Option<&'a snapback4_core::ir::Expr> {
    let index = schema.table(&scan.table)?.index(&scan.index)?;
    let position = index.columns().iter().position(|candidate| candidate == column)?;
    if position < scan.prefix.len() { return scan.prefix[position].scalar(); }
    if position == scan.prefix.len() && let Some(range) = &scan.range
        && range.gt.is_none() && range.lt.is_none() && range.gte == range.lte {
        return range.gte.as_deref();
    }
    None
}

fn definitely_non_null_pin(bound: &BoundProgram, value: &snapback4_core::ir::Expr) -> bool {
    use snapback4_core::{Value, ir::{Expr, Input}};
    match value {
        Expr::Literal(value) => value != &Value::Null,
        Expr::Input(Input::Viewer | Input::Now | Input::NewId | Input::ReadTime) => true,
        Expr::Variable(name) => bound.program.args.get(name).is_some_and(|ty| !ty.is_optional()),
        _ => false,
    }
}

/// A branch merge over one capped group cannot leave rows behind when every
/// branch pins the same group values and the cap fits both the page and meter.
fn merged_group_complete(schema: &Schema, bound: &BoundProgram, merge: &snapback4_core::ir::Merge) -> bool {
    if merge.lanes.is_empty() { return false; }
    if schema.group_bound(merge.table(), &[]).is_some_and(|cap| u64::from(cap) <= merge.take()
        && u64::from(cap) <= snapback4_core::Ceilings::default().examined) { return true; }
    let table = match schema.table(merge.table()) { Some(table) => table, None => return false };
    // System and grant lanes cover the other branches when they run. Every
    // remaining branch can scan the capped group, including the same row
    // through two party indexes, so its examined allowance is per lane. A
    // generated source has an additional discovery walk that this bound does
    // not prove.
    let participating: Vec<_> = merge.lanes.iter().filter(|lane| !lane.system() && !lane.grant()).collect();
    // Sum the finite populations of every branch, including a list lane's
    // finite values. Overlap only tightens this upper bound. A scan source
    // needs discovery work too and does not get this cursor-only silence.
    let finite = merge.lanes.iter().filter(|lane| !lane.system()).try_fold(0u64, |sum, lane| {
        let multiple = match &lane.source {
            None => 1,
            Some(snapback4_core::ir::LaneSource::List { max, .. }) => u64::from(*max),
            _ => return None,
        };
        let index = table.index(&lane.scan.index)?;
        let pins = index.columns().into_iter().take(lane.scan.prefix.len()).collect::<Vec<_>>();
        let n = unique_bound::group_bound(schema, &lane.scan.table, &pins)?;
        Some(sum.saturating_add(u64::from(n).saturating_mul(multiple)))
    });
    if finite.is_some_and(|n| n <= merge.take() && n <= snapback4_core::Ceilings::default().examined) { return true; }
    if !merge.branches() { return false; }
    if participating.iter().any(|lane| lane.source.is_some()) { return false; }
    let scans = participating.len().max(1) as u64;
    table.constraints.iter().any(|constraint| {
        let snapback4_core::schema::Constraint::Cap { by, max } = constraint else { return false };
        if u64::from(*max) > merge.take()
            || u64::from(*max).saturating_mul(scans) > snapback4_core::Ceilings::default().examined { return false; }
        by.iter().all(|column| {
            let Some(first) = scan_pin(schema, &merge.lanes[0].scan, column) else { return false };
            // `set null` rows belong to no parent group, so that reference's
            // cap does not count them. Recover the per-parent bound only when
            // the shared pin is statically known to be non-null.
            if table.on_delete.get(column) == Some(&snapback4_core::schema::references::OnDelete::SetNull)
                && !definitely_non_null_pin(bound, first) { return false; }
            merge.lanes[1..].iter().all(|lane| scan_pin(schema, &lane.scan, column) == Some(first))
        })
    })
}

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
        // @ref LLP 3000.036.000.000#8 — a union cannot be repaired by adding a window.
        if sync.is_union() {
            let global_cap = table.constraints.iter().any(|c| matches!(c, snapback4_core::schema::Constraint::Cap { by, .. } if by.is_empty()));
            let bounded = global_cap || sync.arms().all(|(arm, _)| {
                let columns = arm.columns();
                columns == ["id"] || table.constraints.iter().any(|c| matches!(c, snapback4_core::schema::Constraint::Cap { by, .. } if *by == columns))
                    || !columns.is_empty() && table.indexes.values().any(|index| index.unique && index.is_plain() && !index.columns().is_empty() && index.columns().iter().all(|column| columns.contains(&column.to_string())))
            });
            if !bounded {
                let site = catalog.site_for(&format!("tables.{name}"));
                notes.push(Diagnostic::new(&site, "N_NO_HORIZON",
                    format!("table {name}: `{}` replicates every readable row; union audiences admit no acquisition window, so measure cold-start cost with `check --residency`", sync.line()),
                    "online only  -- keep this read rule and queries; or declare intended caps for every audience group").guide("sharing"));
            }
            continue;
        }
        if prefix == ["id"] || table.constraints.iter().any(|c| matches!(c, snapback4_core::schema::Constraint::Cap { by, .. } if *by == prefix)) {
            continue;
        }
        // @ref LLP 3000.036#12 — a unique key inside the group (`unique principal`
        // under `sync to .principal`) holds at most one row per group.
        if !prefix.is_empty() && table.indexes.values().any(|index| index.unique && index.is_plain() && !index.columns().is_empty() && index.columns().iter().all(|column| prefix.contains(column))) {
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
        // @ref LLP 3000.036#13.3 — prefer the index the group's own pages already read, so the window and the pages agree.
        let group_pages: Vec<(&str, &snapback4_core::ir::Scan)> = programs.iter().filter(|bound| bound.program.kind == snapback4_core::ir::ProgramKind::Query)
            .flat_map(|bound| snapback4_core::ir::scans(&bound.program).into_iter().map(move |scan| (bound.program.name.as_str(), scan)))
            .filter(|(_, scan)| scan.table == *name && !scan.existence && scan.prefix.len() == prefix.len()
                && table.index(&scan.index).is_some_and(|index| index.is_plain() && index.columns().starts_with(&prefix) && index.columns().len() > prefix.len() && orders_by_mint_time(&index)))
            .collect();
        let mut read_by: Vec<(usize, &str)> = Vec::new();
        for (_, scan) in &group_pages {
            match read_by.iter_mut().find(|(_, index)| *index == scan.index) { Some((count, _)) => *count += 1, None => read_by.push((1, scan.index.as_str())) }
        }
        read_by.sort_by_key(|(count, _)| std::cmp::Reverse(*count));
        let ordered = read_by.first().map(|(_, index)| (*index).to_owned())
            .or_else(|| table.indexes.iter().find(|(index_name, index)| *index_name != "byId" && index.is_plain() && index.columns().starts_with(&prefix) && index.columns().len() > prefix.len() && orders_by_mint_time(index)).map(|(index_name, _)| index_name.clone()));
        // A `cap` over columns that are not the sync group bounds rows per group, not
        // what a device acquires. An author who wrote one has already tried to bound
        // this table and will read an unqualified note as not having noticed.
        let unbounding_cap = table.constraints.iter().find_map(|c| match c {
            snapback4_core::schema::Constraint::Cap { by, max } if *by != prefix => Some((by.join(", "), *max)),
            _ => None,
        });
        let site = catalog.site_for(&format!("tables.{name}"));
        let window_index = ordered.clone().unwrap_or_else(|| "byId".into());
        let mut rewrite = match ordered {
            Some(ref index) => format!("{} last 500 by .{}", sync.line(), table.indexes[index].columns()[prefix.len()]),
            None => format!("{} last 500 by .id", sync.line()),
        };
        // A horizon keeps the newest rows; a page over it reads newest first, or N_SYNC_ORDER follows.
        let ascending: Vec<&str> = group_pages.iter().filter(|(_, scan)| scan.index == window_index && scan.order == snapback4_core::ir::Order::Asc).map(|(query, _)| *query).collect();
        if !ascending.is_empty() {
            let mut queries = ascending.clone();
            queries.dedup();
            rewrite.push_str(&format!(", and read {} newest first (`last N` in place of `first N`): a horizon keeps the newest rows", queries.join(", ")));
        }
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
        let returned = snapback4_core::engine::uncontinued_page_sites(&bound.program);
        let branch_merges = snapback4_core::ir::body_merges(&bound.program.body);
        let mut noted = std::collections::BTreeSet::new();
        for page in snapback4_core::ir::scans(&bound.program) {
            let site = page.merge_site.as_ref().unwrap_or(&page.site);
            let columns = schema.tables[&page.table].indexes[&page.index].columns();
            let mut pinned = columns.iter().take(page.prefix.len()).cloned().collect::<Vec<_>>();
            // `.id = x` plans as the closed range `x ..= x` on the next column: an equality too.
            if let Some(range) = &page.range && range.gt.is_none() && range.lt.is_none() && range.gte.is_some() && range.gte == range.lte
                && let Some(next) = columns.get(page.prefix.len()) { pinned.push(next.clone()); }
            // A cap bounds a merged union only when every branch pins the
            // same cap group. Quarry page takes are literals.
            // @ref LLP 3000.007#5.6 — a meter-cut page still needs continuation; a plain scan charges one examined unit per candidate.
            let group_complete = if let Some(merge_site) = &page.merge_site {
                branch_merges.iter().find(|merge| &merge.site == merge_site).is_some_and(|merge| merged_group_complete(schema, bound, merge))
            } else {
                unique_bound::group_bound(schema, &page.table, &pinned).is_some_and(|n| {
                    u64::from(n) <= page.take.maximum() && u64::from(n) <= snapback4_core::Ceilings::default().examined
                })
            };
            if !page.opaque_cursor && !group_complete && returned.contains(site) && noted.insert(site) {
                let (table, take) = (&page.table, page.take.maximum());
                // @ref LLP 3000.027#3 — continuation advice does not question a top-N answer's completeness.
                notes.push(Diagnostic::new(&bound.site, "N_NO_CURSOR", format!("{} {} returns a page of {take} {table} rows with no cursor, so the page cannot continue: rows past the first {take} are not reachable. Fine for a top-{take} list, or a list that stays under {take} rows; a pinned unique key or a `cap` at or under {take} silences this when its full planned walk fits the examined allowance", bound.program.kind.word(), bound.program.name), format!("if the screen pages, declare `c: cursor ?` in {} and append `after c` to this {table} page, keeping its current predicate, direction and column order", bound.program.name)).guide("reads"));
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
        let inferred_search = snapback4_core::search_plan::ordinary::plan(schema, &bound.program);
        // @ref LLP 3000.036.001#14 — grant, system and witnessed membership lanes carry their own proof.
        let proof_lanes: Vec<*const snapback4_core::ir::Scan> = snapback4_core::ir::body_merges(&bound.program.body).into_iter()
            .filter(|merge| merge.branches()).flat_map(|merge| merge.lanes.iter().filter(|lane|
                lane.grant() || lane.system() || lane.membership() || lane.guarded() || lane.exhaustive())
                .map(|lane| &lane.scan as *const _)).collect();

        for scan in snapback4_core::ir::scans(&bound.program) {
            if proof_lanes.contains(&(scan as *const _)) { continue; }
            if inferred_search.is_some() && scan.prefix.iter().any(|key| matches!(key, snapback4_core::ir::IndexKeyExpr::WordPrefix(_))) { continue; }
            let Some(table) = schema.table(&scan.table) else { continue };
            if table.rules.read.is_uniformly_readable() {
                continue;
            }
            let visibility = snapback4_core::engine::rules::scan_visibility(schema, scan);
            if visibility.uniform {
                continue;
            }
            // @ref LLP 3000.036#12 — after `require exists staff[viewer]`, every caller who reaches the page holds the grant.
            if snapback4_core::engine::rules::grant_dominated(schema, &bound.program, scan) {
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
            // @ref LLP 3000.036#18 — a readable parent binding alone is not a proof about copied child audience fields.
            let parent_advice = index.components.iter().zip(&scan.prefix).find_map(|(part, key)| {
                let reference = part.column()?;
                let snapback4_core::schema::ColumnType::Ref { table: parent } = table.columns.get(reference)?.required() else { return None; };
                let snapback4_core::ir::Expr::Variable(argument) = key.scalar()? else { return None; };
                if !bound.program.args.contains_key(argument) { return None; }
                let parent_table = schema.table(&parent)?;
                let owner = parent_table.rules.read.disjuncts().into_iter().find_map(|rule| match rule {
                    snapback4_core::schema::RuleExpr::Eq(snapback4_core::schema::RuleTerm::Field(column), snapback4_core::schema::RuleTerm::Viewer) => Some(column),
                    _ => None,
                })?;
                Some(format!(" For parent-scoped history, reading {parent}[{argument}] alone does not prove a copied child audience. If the whole parent audience is intended, declare read through .{reference}; for a parent-owner branch, declare exists {parent}[.{reference}, {owner} = viewer] in the child's read rule and guard its page with require exists {parent}[{argument}, {owner} = viewer] else FORBIDDEN (guide recipes)."))
            }).unwrap_or_default();
            let columns = leading.join(", ");
            let search_rewrite = matching_merge_rewrite(schema, scan, table);
            let held_rewrite = (search_rewrite.is_none() && unpinned == ["id"] && table.sync.is_some()
                && schema.operations.get(&bound.program.name).is_some_and(|fact| fact.runs.as_deref() == Some("device")))
                .then(|| first_paste::held_query(catalog, &bound.site)).flatten();
            let scope_rewrite = existing.map(|(name, _)| format!("pin {} with where equalities as well as the current equality prefix, choosing the intended scope (this narrows the answer); the existing index `{name}: {columns}` supports it; or read the page on the device", unpinned.iter().map(|column| format!(".{column}")).collect::<Vec<_>>().join(", ")));
            let equality_index_rewrite = equality_filter_index_rewrite(catalog, table, scan, &unpinned, &leading,
                &bound.site, bound.sources.get(&scan.site).map(|(site, _)| site));
            let cap_repair = bound
                .sources
                .get(&scan.site)
                .and_then(|(site, _)| catalog.membership_cap_repairs.get(&site.to_string()))
                .cloned();
            // @ref LLP 3000.036#18 — a runtime parent guard can certify the page for its holders.
            let conditional = snapback4_core::engine::rules::page_guard_decision(schema, scan).is_some_and(|guard| {
                let mut fields = std::collections::BTreeSet::new(); guard.fields(&mut fields); !fields.is_empty()
            });
            notes.push(
                Diagnostic::new(
                    &bound.site,
                    if conditional { "N_CONDITIONAL_COMPLETE" } else { "N_NEVER_COMPLETE" },
                    if held_rewrite.is_some() { format!("query {}: this lookup does not pin an authorized row's id; matching a name does not prove uniqueness or absence. The server may return matches but cannot certify complete. The held replacement (check --verbose) keeps the same matches and shape on the device; it requires acquired coverage and has no server fallback. Keep the original query if server lookup is required", bound.program.name) }
                    else {
                        let grant = snapback4_core::engine::rules::grant_decision(schema, scan);
                        // @ref LLP 3000.036#13.2 — the one line says what a test and a client do with the verdict, and where the complete form is.
                        let parties = table.rules.read.disjuncts().iter().filter(|d| matches!(d, snapback4_core::schema::RuleExpr::Eq(snapback4_core::schema::RuleTerm::Field(c), snapback4_core::schema::RuleTerm::Viewer) | snapback4_core::schema::RuleExpr::Eq(snapback4_core::schema::RuleTerm::Viewer, snapback4_core::schema::RuleTerm::Field(c)) if unpinned.contains(c))).count();
                        // @ref LLP 3000.036#16.3 — a disjunct the pins decide is a page guard for its holders when they can read what it probes; say which.
                        let (guarding, unreadable): (Vec<_>, Vec<_>) = pin_rewrite::prefix_decided(table, &pinned).into_iter()
                            .partition(|d| snapback4_core::engine::rules::pinned_probe_readable(schema, d));
                        let decided_clause = match (guarding.first(), unreadable.first()) {
                            (Some(d), _) => format!("; `{}` is decided by the scan's pins, so the server decides the page once, with the pinned values, for a caller it admits, and answers `complete` (an `if` or `require` on it is followed)", d.quarry()),
                            (None, Some(d)) => format!("; `{}` is decided by the scan's pins, but its holders cannot read the row it probes, so it does not decide the page: `complete: false` for them too", d.quarry()),
                            (None, None) => String::new(),
                        };
                        let mut admitted = Vec::new();
                        for guard in grant.iter().flat_map(|g| g.disjuncts()).chain(guarding.iter()) {
                            let text=guard.quarry(); if !admitted.contains(&text) { admitted.push(text); }
                        }
                        if conditional && let Some(guard) = snapback4_core::engine::rules::page_guard_decision(schema, scan) {
                            for guard in guard.disjuncts() { let text=guard.quarry(); if !admitted.contains(&text) { admitted.push(text); } }
                        }
                        let admitted = (!admitted.is_empty()).then(|| admitted.join(" or "));
                        let declaration = catalog.source.declarations.get(&bound.site.to_string()).map(String::as_str);
                        // @ref LLP 3000.036#16.1 — the phrase names the form `check` verified, or says there is none.
                        // @ref LLP 3000.036#17.1 — the phrase carries its own lead ("the complete form …", "the closest form …", "no verified complete form …"); the sentence around it never repeats it (wave 7 R1).
                        let lead = if grant.is_some() { "the complete form for everyone is" } else { "the complete form is" };
                        let hidden_repair = pin_rewrite::hidden_parent_repair(schema, &scan.table, table);
                        let complete_form = hidden_repair.map(|repair| format!("truly partial absence evidence under this authority: the hidden parent witness cannot be discovered completely; the complete form requires the checked immutable copy: {repair}")).or_else(|| cap_repair.as_ref().map(|repair| format!("the complete form is to {repair}")))
                            .unwrap_or_else(|| match complete_form::complete_form(schema, &bound.program, scan, table, declaration) {
                                complete_form::Outcome::Form(form) => format!("the complete form for everyone is {}", form.phrase),
                                complete_form::Outcome::None(reason) => format!("analyzer limitation: no verified complete form for this read ({reason}); keep the query and expect `capped`"),
                                complete_form::Outcome::NotApplicable if parties >= 2 => format!("{lead} one query per party"),
                                complete_form::Outcome::NotApplicable => format!("{lead} the pin"),
                            });
                        // @ref LLP 3000.036#15.12 — an `exists` answers a visible match as `true` and nothing else: say what it returns.
                        let treatment = if search_rewrite.is_some() { String::new() } else if scan.existence {
                            format!("; {}it answers `true` (`complete: false`) when a row the caller may read matches, otherwise null with no value (a client shows `loading`), never `false` from the server: rows the caller may not read leave absence unproven — test.cases.jsonl: the default passes it (`\"data\": true` pins a match); {complete_form} (check --verbose)",
                                admitted.as_ref().map_or_else(String::new, |grant| format!("for a caller `{grant}` does not admit, ")))
                        } else { match &admitted {
                            Some(grant) => format!("; test.cases.jsonl: run it as a caller `{grant}` admits to expect `complete`, and expect `capped` (the default passes either) for the rest; a client shows the rows it has and treats `complete: false` as \"there may be more\", not an error; {complete_form} (check --verbose)"),
                            None => format!("; it answers `complete: false` even when every row the caller may read is there — test.cases.jsonl: the default passes it (or write `\"expect\": \"capped\"`); a client shows the rows it has and treats `complete: false` as \"there may be more\", not an error; {complete_form} (check --verbose)"),
                        } };
                        let limitation = if conditional { "analyzer limitation for other callers: " }
                            else if complete_form::hidden_source(schema, &table.rules.read) {
                                "truly partial absence evidence: "
                            } else { "analyzer limitation: " };
                        let verdict = if conditional { "is `complete`" } else { "is never `complete`" };
                        format!("{} {}: {limitation}{}the {} over {}[..] by {} {verdict}{} — the read rule `{}` reads {}, which the scan does not pin, so the server cannot tell \"no more\" from \"more you may not read\"{decided_clause}{treatment}", bound.program.kind.word(), bound.program.name, if inferred_search.is_some() { "when the search text folds to no words, " } else { "" }, if scan.existence { "`exists`" } else { "page" }, scan.table, scan.index,
                        admitted.as_ref().map_or_else(String::new, |grant| if conditional { format!(" for callers `{grant}` admits, and otherwise remains capped") } else { format!(" except for callers `{grant}` admits") }),
                        table.rules.read.quarry(), unpinned.iter().map(|c| format!(".{c}")).collect::<Vec<_>>().join(", ")) },
                    cap_repair.or(held_rewrite).or(search_rewrite.clone()).unwrap_or_else(|| {
                        let base = scope_rewrite.or(equality_index_rewrite).unwrap_or_else(|| format!("pin {} with where equalities as well as the current equality prefix, choosing the intended scope (this narrows the answer); or read the page on the device, where the partition holds exactly what the viewer may read", unpinned.iter().map(|column| format!(".{column}")).collect::<Vec<_>>().join(", ")));
                        let declaration = catalog.source.declarations.get(&bound.site.to_string()).map(String::as_str);
                        // @ref LLP 3000.036.002#10 — a copied scope is not a
                        // stored dependency. Keep every caller rather than
                        // presenting a viewer pin as its replacement.
                        let copied_scope = index.components.iter().take(scan.prefix.len()).filter_map(|part| part.column())
                            .any(|reference| table.columns.get(reference).and_then(|kind| match kind.required() {
                                snapback4_core::schema::ColumnType::Ref { table } => schema.table(&table), _ => None,
                            }).is_some_and(|parent| unpinned.iter().any(|column| parent.columns.get(column) == table.columns.get(column))));
                        if copied_scope && let Some(declaration) = declaration {
                            return format!("nearest supported query, preserving every authorized caller (the copied fields are not an enforced stored dependency):\n{declaration}\nHandle complete: false and continue its cursor. Keep explicit parent/child scope equalities when that narrower scope is what the screen requests; a viewer pin is not an equivalent repair.{parent_advice}");
                        }
                        match pin_rewrite::pin_rewrite(schema, &bound.program, scan, table, &unpinned, declaration) {
                            Some((Some(code), pin)) => format!("{code}\n\nOtherwise: {base}. As code: {pin}{parent_advice}"),
                            Some((None, pin)) => format!("{base}. As code: {pin}{parent_advice}"),
                            None => base,
                        }
                    }),
                )
                .guide(if search_rewrite.is_some() { "search" } else { "reads" }),
            );
        }
    }
    notes
}

/// An authored equality may already be the right authorization scope while a
/// named order index leaves it as a residual filter. Print the two exact edits
/// together: the compatible declaration and the same query selecting it.
// @ref LLP 3000.036.001#18 — equality-filter advice is mechanically coherent even when it remains advisory.
fn equality_filter_index_rewrite(catalog: &Catalog, table: &snapback4_core::schema::Table,
    scan: &snapback4_core::ir::Scan, unpinned: &[String], leading: &[String],
    declaration_site: &crate::Site, read_site: Option<&crate::Site>) -> Option<String> {
    use snapback4_core::ir::{BinaryOp, Expr};
    fn pins(expr: &Expr, column: &str) -> bool {
        match expr {
            Expr::Binary { op: BinaryOp::And, left, right } => pins(left, column) || pins(right, column),
            Expr::Binary { op: BinaryOp::Eq, left, right } => field(left, column) && independent(right)
                || field(right, column) && independent(left),
            _ => false,
        }
    }
    fn field(expr: &Expr, column: &str) -> bool {
        matches!(expr, Expr::Field { base, name } if name == column
            && matches!(base.as_ref(), Expr::Variable(binding) if binding == "$filter"))
    }
    fn independent(expr: &Expr) -> bool {
        match expr {
            Expr::Field { base, .. } => !matches!(base.as_ref(), Expr::Variable(binding) if binding == "$filter") && independent(base),
            Expr::Binary { left, right, .. } => independent(left) && independent(right),
            Expr::Unary { value, .. } => independent(value),
            Expr::Array(values) => values.iter().all(independent),
            Expr::Object(fields) => fields.values().all(independent),
            Expr::Builtin { args, .. } => args.iter().all(independent),
            Expr::Get(_) | Expr::Exists(_) | Expr::Scan(_) | Expr::Merge(_) | Expr::Block { .. } => false,
            _ => true,
        }
    }
    let filter = scan.filter.as_deref()?;
    if unpinned.is_empty() || leading.len() > 8 || !unpinned.iter().all(|column| pins(filter, column)) { return None; }
    let title = |value: &str| { let mut chars = value.chars(); chars.next()
        .map(|first| first.to_uppercase().collect::<String>() + chars.as_str()).unwrap_or_default() };
    let stem = leading.iter().filter(|column| column.as_str() != "id").map(|column| title(column)).collect::<String>();
    if stem.is_empty() { return None; }
    let mut name = format!("by{stem}");
    let mut suffix = 2;
    while table.indexes.contains_key(&name) {
        name = format!("by{stem}{suffix}"); suffix += 1;
    }
    let authored = catalog.tables.get(&scan.table)?;
    let candidate = crate::ast::IndexDecl { name: name.clone(), columns: leading.to_vec(), unique: false,
        refusal: None, words: None, computed: Default::default(), site: declaration_site.clone() };
    if !key_bound::plain_index_fits(authored, &candidate, &name) { return None; }
    // Locate the authored read by its source-map span. A declaration can use
    // the same old index more than once; replacing a text occurrence can edit
    // an earlier, unrelated read and print a query that does not compile.
    let read_site = read_site?;
    let (mut read, text, grouped, start) = catalog.source.read(read_site)?;
    // Positional/named bracket keys address the old index's columns. Merely
    // prepending authorization components would retarget those values, so a
    // coherent repair needs authored key expressions for the new prefix.
    if !read.keys.is_empty() { return None; }
    if read.index.as_deref() != Some(scan.index.as_str()) { return None; }
    read.index = Some(name.clone());
    let fixed = crate::ast::Expr::Read(read);
    let replacement = crate::print::with_source_at(&fixed, if grouped { 8 } else { 0 }, &|expr| catalog.source.get(expr));
    let declaration = catalog.source.declarations.get(&declaration_site.to_string())?;
    let line = start.line.checked_sub(declaration_site.line)? as usize;
    let lines = declaration.split('\n').collect::<Vec<_>>();
    let column = start.col.checked_sub(1)? as usize;
    let byte = lines.get(line)?.char_indices().map(|(i, _)| i).chain([lines[line].len()]).nth(column)?;
    let offset = lines[..line].iter().map(|line| line.len() + 1).sum::<usize>() + byte;
    let span = offset..offset.checked_add(text.len())?;
    if declaration.get(span.clone())? != text { return None; }
    let rewritten = crate::parser::repairs::splice(declaration, vec![(span, replacement)])?;
    Some(format!("on table {} add `by {name}: {}`; use the same index in the rewritten query:\n```quarry\n{rewritten}\n```", scan.table, leading.join(", ")))
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
pub use snapback4_core::search_plan::merges;

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

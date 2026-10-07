//! The verbs that do not serve: `check`, `run`, `types`, `why`, `doctor`,
//! `init`, `data`, `test`. Each prints one honest answer and exits with it.

use crate::project::{Project, persona_principal};
use snapback4_core::engine::rules::scan_visibility;
use snapback4_core::ir::{self, ProgramKind};
use snapback4_core::schema::Audience;
use snapback4_core::{Context, WriteState, wire};
use snapback4_lang::Bound;
use serde_json::{Value as Json, json};
use std::collections::BTreeMap;
use std::path::Path;
use std::time::Instant;

mod fix;
mod init;
mod sql;
mod work_records;
pub mod witness;
pub use init::init;
pub use sql::sql;
mod residency;
mod test_fixture;
mod adoption;
mod latency;
mod run_admission;

pub struct Options {
    pub positionals: Vec<String>,
    pub flags: BTreeMap<String, String>,
    pub json: bool,
}

pub fn parse(args: &[String]) -> Options {
    let mut positionals = Vec::new();
    let mut flags = BTreeMap::new();
    let mut json = false;
    let mut iter = args.iter().skip(1).peekable();
    while let Some(arg) = iter.next() {
        if arg == "--json" {
            json = true;
        } else if let Some(flag) = arg.strip_prefix("--") {
            // A switch takes no value; any other flag takes the next token
            // unless that token is itself a flag.
            const SWITCHES: &[&str] = &["trace-empty", "latency", "reset", "values", "no-watch", "fresh", "memory", "replay", "hold-effects", "hold-schedules", "cost", "residency", "fix", "verbose", "online", "expo", "web", "allow-destructive", "allow-feed-adoption", "i-understand-cleartext"];
            let (name, value) = match flag.split_once('=') {
                Some((name, value)) => (name.to_owned(), value.to_owned()),
                None if SWITCHES.contains(&flag) || iter.peek().is_none_or(|next| next.starts_with("--")) => (flag.to_owned(), String::new()),
                None => (flag.to_owned(), iter.next().cloned().unwrap_or_default()),
            };
            flags.insert(name, value);
        } else {
            positionals.push(arg.clone());
        }
    }
    Options { positionals, flags, json }
}

fn project_or_exit() -> Project {
    match std::env::current_dir().ok().and_then(|dir| Project::locate(&dir)) {
        Some(project) => project,
        None => {
            eprintln!("no snapback/schema.q here or above; run `snapback4 init` to start one");
            std::process::exit(2);
        }
    }
}

fn compile_or_exit(project: &Project, json: bool) -> Bound {
    let bound = match project.compile() {
        Ok(bound) => bound,
        Err(error) => {
            eprintln!("cannot read snapback/: {error}");
            std::process::exit(2);
        }
    };
    compiled_or_exit(bound, json)
}

fn compiled_or_exit(bound: Bound, json: bool) -> Bound {
    if !bound.diagnostics.is_empty() {
        // These one-shot verbs retain their complete diagnostic output.
        report_diagnostics(&bound, json, false, true);
        std::process::exit(1);
    }
    bound
}

fn report_diagnostics(bound: &Bound, json: bool, explain_repeats: bool, verbose: bool) {
    if json {
        println!("{}", json!({ "ok": false, "problems": bound.diagnostics }));
        return;
    }
    report_problems(bound, "check", "", explain_repeats, verbose);
}

pub(crate) fn report_problems(bound: &Bound, label: &str, suffix: &str, explain_repeats: bool, verbose: bool) {
    let (reports, hidden) = problem_reports(bound, explain_repeats, verbose);
    let shown = reports.len();
    eprintln!("{label}: {shown} problem{}{suffix}", if shown == 1 { "" } else { "s" });
    for report in reports { eprintln!("{}", crate::presentation::indexes(&bound.schema, &report, verbose)); }
    if hidden > 0 { eprintln!("{label}: {hidden} redundant cascade diagnostic(s) hidden; use --verbose to show them"); }
}

pub(crate) fn problem_reports(bound: &Bound, explain_repeats: bool, verbose: bool) -> (Vec<String>, usize) {
    // Suppress redundant cascades first, so a hidden diagnostic never counts
    // towards the repeat threshold that earns an inline card excerpt.
    let mut hidden = 0;
    let mut shown_diagnostics = Vec::new();
    for (i, diagnostic) in bound.diagnostics.iter().enumerate() {
        if !verbose && diagnostic.rewrite == "fix this Quarry line and rerun snapback4 check"
            && diagnostic.cascade_of.as_ref().is_some_and(|cause| bound.diagnostics[..i].iter().any(|earlier| earlier.code.starts_with("E_") && earlier.site == *cause)) {
            hidden += 1;
            continue;
        }
        shown_diagnostics.push(diagnostic.clone());
    }
    (diagnostic_reports(&shown_diagnostics, "", explain_repeats), hidden)
}

// @ref LLP 3000.007#20.1 — bring the diagnostic's own card to the builder at the repeated problem.
fn diagnostic_reports(diagnostics: &[snapback4_lang::Diagnostic], prefix: &str, explain_repeats: bool) -> Vec<String> {
    let mut counts = BTreeMap::new();
    for diagnostic in diagnostics {
        *counts.entry((&diagnostic.code, &diagnostic.guide)).or_insert(0) += 1;
    }
    // Two is the first recurrence; pre-counting puts help under its first site.
    // At most three existing bounded why excerpts add <= 12,291 bytes, including blank lines.
    let mut remaining = if explain_repeats { 3 } else { 0 };
    diagnostics.iter().map(|diagnostic| {
        let mut report = format!("{prefix}{diagnostic}\n");
        if counts.remove(&(&diagnostic.code, &diagnostic.guide)).is_some_and(|count| count >= 2)
            && remaining > 0 && let Some(explanation) = diagnostic.explanation_section() {
            report.push_str(&format!("\n{explanation}\n"));
            remaining -= 1;
        }
        report
    }).collect()
}

fn note_reports(notes: &[snapback4_lang::Diagnostic], verbose: bool) -> Vec<String> {
    let mut explained = std::collections::BTreeSet::new();
    notes.iter().map(|note| {
        let mut compact = note.clone();
        if !verbose && let Some((summary, _)) = compact.message.split_once('\n') {
            compact.message = format!("{}.", summary.trim_end_matches(':'));
        }
        let mut report = format!("note: {compact}\n  why: snapback4 why {}\n", note.code);
        if verbose && explained.insert((&note.code, &note.guide))
            && let Some(explanation) = note.explanation() {
            report.push_str(&format!("\n{explanation}\n"));
        }
        report
    }).collect()
}

fn print_prediction(bound: &Bound, verbose: bool) {
    let summary = if verbose { snapback4_lang::bind::residency::prediction_summary(bound) }
        else { snapback4_lang::bind::residency::prediction_overview(bound) };
    if let Some(summary) = summary { println!("{}", crate::presentation::indexes(&bound.schema, &summary, verbose)); }
}

fn note_summary(note: &snapback4_lang::Diagnostic) -> String {
    let Some((first, rest)) = note.message.split_once('\n') else { return note.message.clone(); };
    if note.code == "N_MAINTAIN_SYNCED" {
        let names = rest.lines().filter_map(|line| line.trim().strip_prefix("maintain ")?.split_once(':').map(|(name, _)| name)).collect::<Vec<_>>();
        let consequences = rest.lines().filter_map(|line| {
            let (_, consequence) = line.rsplit_once("; ")?;
            consequence.contains("would stop predicting").then(|| consequence.split(" (site ").next().unwrap())
        }).collect::<Vec<_>>();
        return format!("{first} {}. Inherited sync has no horizon; online only loses offline coverage{}", names.join(", "),
            if consequences.is_empty() { String::new() } else { format!("; {}", consequences.join("; ")) });
    }
    format!("{}.", first.trim_end_matches(':'))
}

pub fn check(options: &Options) -> i32 {
    let project = project_or_exit();
    let started = Instant::now();
    let mut bound = match fix::checked(if options.flags.contains_key("fix") { fix::compile(&project) } else { project.compile() }) {
        Ok(bound) => bound,
        Err(code) => return code,
    };
    if !bound.diagnostics.is_empty() {
        report_diagnostics(&bound, options.json, true, options.flags.contains_key("verbose"));
        if !options.json { print_prediction(&bound, options.flags.contains_key("verbose")); }
        return 1;
    }
    // @ref LLP 3000.007#18.3 — check judges adoption against the dev store's active generation and rows, read-only
    match adoption::diagnostics(&project, &bound.schema, options.flags.get("store")) {
        Ok((problems, notes)) => { bound.diagnostics.extend(problems); bound.notes.extend(notes); },
        Err(error) => { eprintln!("cannot check store adoption: {error}"); return 2; }
    }
    if !bound.diagnostics.is_empty() {
        report_diagnostics(&bound, options.json, true, options.flags.contains_key("verbose"));
        if !options.json { print_prediction(&bound, options.flags.contains_key("verbose")); }
        return 1;
    }
    bound.notes.extend(snapback4_lang::bind::residency::change_notes(&bound, &residency::previous(&project)));
    if let Err(error) = project.write_generated(&bound) {
        eprintln!("cannot write generated types: {error}");
        return 2;
    }
    if let Err(error) = project.check_server() {
        if options.json { println!("{}", json!({ "ok": false, "problems": [{ "code": if error.starts_with("E_SERVER_TOOLCHAIN") { "E_SERVER_TOOLCHAIN" } else { "E_SERVER_TYPECHECK" }, "message": error, "guide": "actions" }] })); }
        else { eprintln!("{error}"); }
        return 1;
    }
    // A native job's module is built here too (LLP 3000.005): the schema's
    // Rust types written, cargo run, the module checked against the jobs.
    let native = match crate::native::build(&project, &bound) {
        Ok(built) => built,
        Err(problem) => {
            if options.json {
                println!("{}", json!({ "ok": false, "problems": [{ "code": problem.code, "message": problem.message, "rewrite": problem.rewrite, "guide": "native" }] }));
            } else {
                eprintln!("{problem}\n");
                eprintln!("check: 1 problem");
            }
            return 1;
        }
    };
    if let Err(error) = residency::remember(&project, &bound) { eprintln!("cannot write residency facts: {error}"); return 2; }
    let acquisition = if options.flags.contains_key("residency") {
        match residency::at_check(&project, &bound, options) {
            Ok(report) => report,
            Err(error) => { eprintln!("residency measurement failed: {error}"); return 1; }
        }
    } else { None };
    let present = |text: &str| crate::presentation::indexes(&bound.schema, text, options.flags.contains_key("verbose"));
    let details = acquisition.is_none() || options.flags.contains_key("verbose");
    let certificates: Vec<_> = bound.programs.iter().map(|p| crate::scale::analyze_bound(&bound.schema, p)).collect();
    let scale_summary = crate::scale::summary(&certificates);
    let note_count = bound.notes.len() + certificates.iter().map(|certificate| certificate.search.len()).sum::<usize>();
    let field_authority: Vec<_> = bound.schema.visible_tables().flat_map(|(name,table)| table.written_by.iter().map(move |(column,authority)|
        format!("{name}.{column}: written by .{}; visibility: {}", authority.owner, if authority.audience { "readable by audience" } else { "private to owner" }))).collect();
    let row_views = bound.schema.maintains.iter().filter_map(|m| m.row_key.as_ref().map(|k| json!({
        "view": m.target, "source": m.source, "sourceKey": k.source_key, "member": k.table,
        "memberKey": k.member_key, "fanout": k.fanout, "range": row_view_range(&bound.schema, m), "writerRecount": snapback4_core::engine::row_views::WRITER_RECOUNT, "recountChunk": snapback4_core::engine::row_views::RECOUNT_CHUNK
    }))).collect::<Vec<_>>();
    let elapsed = started.elapsed();
    let synced = bound.schema.synced().count();
    let sequences: Vec<_> = bound.schema.visible_tables().flat_map(|(name, table)| table.sequences.iter().map(move |(column, reference)| {
        format!("sequence {name}.{column}: counter per {} row through .{reference}; immutable, provisional while pending", table.columns[reference])
    })).collect();
    if options.json {
        println!("{}", json!({ "ok": true, "rowViews": row_views, "fieldAuthority": field_authority, "sequences": sequences, "scaleSummary": scale_summary, "search": certificates.iter().flat_map(|certificate| &certificate.search).collect::<Vec<_>>(), "plans": if options.flags.contains_key("cost") { Some(bound.programs.iter().map(|p| (&p.program.name, p.selections())).collect::<BTreeMap<_, _>>()) } else { None }, "scale": if options.flags.contains_key("cost") { Some(&certificates) } else { None }, "tables": bound.schema.visible_tables().count(), "synced": synced, "operations": bound.programs.len(), "heldQueries": bound.schema.operations.iter().filter(|(_, fact)| fact.held).map(|(name, _)| name).collect::<Vec<_>>(), "notes": bound.notes, "predictionSummary": snapback4_lang::bind::residency::prediction_summary(&bound), "acquisition": acquisition, "residency": if options.flags.contains_key("residency") { Some(residency::facts(&bound)) } else { None }, "native": native.as_ref().map(|b| json!({ "module": b.path, "bytes": b.bytes, "jobs": b.jobs, "ms": b.ms })), "ms": elapsed.as_millis() }));
    } else {
        println!("check: ok — {} tables ({synced} synced), {} operations, no problems{}, {:.1} ms{}", bound.schema.visible_tables().count(), bound.programs.len(), if note_count == 0 { String::new() } else { format!(", {} note{}", note_count, if note_count == 1 { "" } else { "s" }) }, elapsed.as_secs_f64() * 1000.0, match &native { Some(b) => format!("; native: {} → {} ({} B, {} ms)", b.jobs.join(", "), b.path.display(), b.bytes, b.ms), None => String::new() });
        if options.flags.contains_key("verbose") {
            for line in &sequences { println!("  {line}"); }
            for (name, _) in bound.schema.visible_tables().filter(|(_, t)| t.ephemeral.is_some()) {
                println!("  {name}: {}", snapback4_lang::bind::residency::table_line(&bound.schema, name));
            }
            for (name, fact) in bound.schema.operations.iter().filter(|(_, f)| f.ephemeral) {
                println!("{}", present(&snapback4_lang::bind::residency::operation_lines(name, fact)));
            }
        }
        if options.flags.contains_key("verbose") { for line in &field_authority { println!("  {line}"); } }
        if options.flags.contains_key("verbose") {
            for report in note_reports(&bound.notes, true) { println!("{}", present(&report)); }
        } else {
            for note in &bound.notes {
                let summary = note_summary(note);
                println!("note: {} — {}: {}", note.site, note.code, present(&summary));
            }
        }
    }
    if !options.json && (options.flags.contains_key("verbose") || options.flags.contains_key("cost")) {
        println!("{scale_summary}");
    }
    if !options.json {
        for search in certificates.iter().flat_map(|certificate| &certificate.search) {
            if options.flags.contains_key("verbose") {
                println!("  {} at {}: {}; rewrite: {} (guide {})", search.code, search.site, search.message, search.rewrite, search.guide);
            } else {
                println!("note: {} — {}: {}", search.site, search.code, present(search.summary));
            }
        }
    }
    if details && !options.json {
        print_prediction(&bound, options.flags.contains_key("verbose"));
        if !options.flags.contains_key("verbose") { println!("check --verbose for explanations, rewrites and execution details; why <op> for one operation"); }
    }
    if details && options.flags.contains_key("residency") && !options.json { println!("{}", present(&residency::facts(&bound))); }
    if !details && options.flags.contains_key("residency") && !options.json {
        for (name, fact) in bound.schema.operations.iter().filter(|(_, fact)| !fact.components.is_empty()) {
            println!("  {name}: components: {}", fact.components.iter().map(|component| component.field.as_str()).collect::<Vec<_>>().join(", "));
        }
    }
    if !options.json && let Some(report) = &acquisition { println!("{report}"); }
    if !options.json && options.flags.contains_key("residency") && acquisition.is_none() {
        println!("residency (measurements): not measured — no dev store; use check --residency --fixture <fixture-directory> --as <principal>");
    }
    if !options.json && (options.flags.contains_key("verbose") || options.flags.contains_key("cost")) { for m in &bound.schema.maintains { if let Some(k)=&m.row_key {
        println!("  view {}: key {}.{} = {}.{}; one value per {} row; source fanout <= {}; writer recount <= {} examined source rows within remaining meter, then pending/background chunks <= {}",m.target,m.source,k.source_key,k.table,k.member_key,k.table,k.fanout,snapback4_core::engine::row_views::WRITER_RECOUNT,snapback4_core::engine::row_views::RECOUNT_CHUNK);
        if let Some(range) = row_view_range(&bound.schema, m) {
            println!("    device range: {}; index {}; horizon {} by {}; {}; {}", range["predicate"].as_str().unwrap(), range["index"].as_str().unwrap(), range["horizon"]["last"], range["horizon"]["index"].as_str().unwrap(), range["selection"].as_str().unwrap(), range["fallback"].as_str().unwrap());
        }
    } } }
    if !options.json && (options.flags.contains_key("verbose") || options.flags.contains_key("cost")) && !options.flags.contains_key("residency") {
        for (name, fact) in bound.schema.operations.iter().filter(|(_, fact)| fact.held) {
            println!("{}", present(&snapback4_lang::bind::residency::operation_lines(name, fact)));
        }
    }
    if options.flags.contains_key("cost") {
        for program in &bound.programs {
            let report = cost_report(&bound, &program.program, options.json || options.flags.contains_key("verbose"));
            if options.json { eprintln!("{report}"); } else { println!("{report}"); }
        }
    }
    0
}

/// The structural cost class of a program: what `check --cost` prints
/// instead of a price (LLP 2000.000 §6).
fn cost_report(bound: &Bound, program: &ir::Program, canonical: bool) -> String {
    let certificate = bound.programs.iter().find(|p| p.program.name == program.name).map_or_else(
        || crate::scale::analyze(&bound.schema, program), |p| crate::scale::analyze_bound(&bound.schema, p));
    // @ref LLP 3000.025#6-diagnostics-and-exact-documentation-changes — a domain count completes or aborts; growth explains reaching the ceiling.
    let expiring_mutation = program.kind == ProgramKind::Mutation && ir::scans(program).iter().any(|scan| bound.schema.table(&scan.table).is_some_and(|table| table.is_expiring()));
    let scale = certificate.line();
    let scale = if expiring_mutation {
        format!("scale: examined ceiling {}; E_BOUND, with no write, if exceeded; {}", certificate.bounds.meters.examined, scale.strip_prefix("scale: ").unwrap_or(&scale))
    } else { scale };
    let mut lines = vec![format!("  {} {}:", program.kind.word(), program.name), format!("    {scale}")];
    // @ref LLP 3000.028#4-put-the-rules-where-the-builder-meets-them — why must describe the same caller authority and whole-recipient meter as the refusal.
    if program.kind == ProgramKind::Job && let Some(p) = bound.programs.iter().find(|p| p.program.name == program.name)
        && !p.job_bound_helpers.is_empty() {
        lines.push(format!("    system job: helper(s) {} share the chunk meter; inner recipient work must fit one chunk even when the outer sweep adapts. An oversized recipient parks with E_BOUND; no partial digest commits. A viewer query calling the helper keeps viewer authority and query bounds; first 50 is only a partial preview (guide jobs)", p.job_bound_helpers.iter().cloned().collect::<Vec<_>>().join(", ")));
    }
    for aggregate in &certificate.aggregates { lines.push(format!("    {aggregate}")); }
    for growth in &certificate.growth_sites {
        let rewrite = if growth.rewrite.is_empty() { String::new() } else { format!("; rewrite: {}", growth.rewrite) };
        lines.push(format!("      {}: {}{rewrite}", growth.site, growth.reason));
    }
    if program.native {
        lines.push(match program.kind {
            ProgramKind::Query => format!("    native read: the module's reads go through the host as the viewer, metered under the read ceilings ({} rows examined), {} fuel; no writes, no cursor; on a device, over the rows it holds", snapback4_core::Ceilings::default().examined, snapback4_core::engine::native::FUEL_PER_READ),
            _ => format!("    native: the module's reads and writes go through the host, metered per chunk under the job ceilings ({} rows examined, {} written), {} fuel per chunk", snapback4_core::Ceilings::job().examined, snapback4_core::Ceilings::job().rows_written, snapback4_core::engine::native::FUEL_PER_CHUNK),
        });
        return crate::presentation::indexes(&bound.schema, &lines.join("\n"), canonical);
    }
    crate::timeline_cost::report(&bound.schema, program, &mut lines);
    crate::column_cost::report(&bound.schema, program, &mut lines);
    range_costs(&program.body, &mut lines);
    for merge in snapback4_lang::bind::merges(&program.body) {
        let matching = merge.lanes.iter().any(|lane| lane.scan.prefix.iter().any(|key| matches!(key, ir::IndexKeyExpr::WordPrefix(_))));
        let lanes = if merge.static_lanes().is_none() { "lanes ≤ meter".into() } else { format!("up to {} lanes", merge.max_lanes()) };
        lines.push(format!("    merge {}: {lanes}{}", merge.table(), if matching { "; uniform matching scopes expand first-term words under the meter; admitted non-uniform scopes keep at most 32 (word_cut_at names a cut), later lanes continue; further terms filter; discovery/opening meter cuts have no next; resumable read-meter drain cuts may continue after a fully shaped emitted row when the owning uniform traversal and final answer are eligible; heap exhaustion clears data to null even during drain; steps abort, output may refuse, terminal pages need no next, usePage retains earlier incompleteness; meter ceilings remain query-wide" } else { "" }));
    }
    let scans = ir::scans(program);
    let sites = ir::read_sites(program);
    if sites.is_empty() {
        lines.push("    no explicit reads".into());
    }
    for site in &sites {
        let hoist = match site.kind {
            "scan" => {
                let scan = scans.iter().copied().find(|scan| scan.site == site.site);
                match scan.map(|scan| scan_visibility(&bound.schema, scan)) {
                    Some(v) if v.decided_true => "rule decided by the prefix: no probes",
                    Some(v) if v.uniform => "rule uniform over the prefix: one verdict",
                    Some(_) => "rule checked per row",
                    None => "",
                }
            }
            "point" => "one row, one rule check",
            "write target" => "engine-private lookup; the update rule decides",
            _ => "bounded walk",
        };
        let scan = scans.iter().copied().find(|scan| scan.site == site.site);
        let take = if scan.is_some_and(|scan| scan.take == ir::Bound::Meter) {
            let ceiling = if program.kind == ProgramKind::Job { snapback4_core::Ceilings::job() } else { snapback4_core::Ceilings::default() };
            let digits = ceiling.examined.to_string();
            let examined = digits.chars().enumerate().map(|(i, c)| format!("{}{c}", if i > 0 && (digits.len() - i) % 3 == 0 { "," } else { "" })).collect::<String>();
            format!(" rows ≤ meter ({examined} examined)")
        } else if site.kind == "scan" {
            format!(" {} {}", if scan.is_some_and(|scan| scan.order == ir::Order::Desc) { "last" } else { "first" }, site.take)
        } else { String::new() };
        let kind = if scan.is_some_and(|s| s.range.is_some()) { "prefix seek" } else { site.kind };
        lines.push(format!("    {kind} {}.{}{take} — {hoist}", site.table, site.index));
        if let Some(selection) = bound.programs.iter().find(|bound| bound.program.name == program.name).and_then(|bound| bound.selection(&site.site))
            && selection.contains("synthesized;") {
            lines.push(format!("      {selection}"));
        }
        if let Some(scan) = scan {
            lines.push(if scan.existence { "      exists: first match, no page overflow or cursor" }
                else if scan.take == ir::Bound::Meter && program.kind == ProgramKind::Job { "      job domain: all inner work shares this chunk's meter; a refusal rolls back the chunk, never commits a partial total" }
                else if scan.take == ir::Bound::Meter && bound.schema.table(&scan.table).is_some_and(|table| table.is_expiring()) { "      domain aggregate: complete the domain or refuse; no partial total" }
                else { "      sort/group/sum/count consume this page, not the whole population" }.into());
            if let Some(filter) = &scan.filter {
                let ceiling = if program.kind == ProgramKind::Job { snapback4_core::Ceilings::job() } else { snapback4_core::Ceilings::default() }.examined;
                lines.push(format!("      filter over ≤ examined ceiling ({ceiling})"));
                let filter_program = ir::Program { body: vec![ir::Stmt::Return(*filter.clone())], ..program.clone() };
                if !ir::read_sites(&filter_program).is_empty() { lines.push("      probe × examined".into()); }
            }
        }
        if site.kind == "scan" && program.kind == ProgramKind::Mutation && bound.schema.operations.get(&program.name).is_some_and(|fact| fact.predicts.as_deref() == Some("never")) {
            // @ref LLP 3000.025#6-diagnostics-and-exact-documentation-changes — expiry prices backlog, never just the requested output rows.
            if bound.schema.table(&site.table).is_some_and(|table| table.is_expiring()) {
                lines.push(format!("    A mutation refuses E_BOUND, with no write, when the unswept prefix exceeds the examined ceiling {}; the scan attempt also costs one examined unit.", snapback4_core::Ceilings::default().examined));
                continue;
            }
            // @ref LLP 3000.007#5.9 — a never-predicting mutation's pass over a uniformly authorized page, priced as one.
            let prefix = scan.map(|scan| scan.prefix.iter().map(|key| match key {
                ir::IndexKeyExpr::Scalar(value) | ir::IndexKeyExpr::WordPrefix(value) => crate::scale::expression(value),
            }).collect::<Vec<_>>().join(", ")).unwrap_or_else(|| "..".into());
            let domain = bound.programs.iter().find(|p| p.program.name == program.name).and_then(|p| p.domain_source(&site.site))
                .map(str::to_owned).unwrap_or_else(|| format!("{}[{prefix}]", site.table));
            lines.push(format!("    a pass over the first {} rows of {domain} by {}; examined ceiling {}", site.take, site.index, snapback4_core::Ceilings::default().examined));
        }
    }
    let writes = ir::write_tables(program);
    for (table, kind) in &writes {
        let audience = bound.schema.tables.get(table).and_then(|t| t.sync.as_ref()).map(|s| format!(", fans out to {}", match &s.audience { Audience::Public => "everyone".to_owned(), Audience::Column(c) => format!(".{c}"), Audience::Target { table, .. } => format!("the members in {table}") })).unwrap_or_default();
        lines.push(format!("    {kind} {table}{audience}"));
        if let Some(table) = bound.schema.tables.get(table) {
            if matches!(*kind, "insert" | "insert-if-absent" | "upsert") && !table.recorded.is_empty() {
                lines.push(format!("      recorded attribution: {} extra point reads per inserted row (one per path: {})", table.recorded.len(), table.recorded.keys().cloned().collect::<Vec<_>>().join(", ")));
            }
            if matches!(*kind, "insert" | "insert-if-absent" | "upsert") {
                for constraint in &table.constraints {
                    if let snapback4_core::schema::Constraint::FinalExistsOnInsert { key, .. } = constraint {
                        for term in key { reference_costs(term, "after insert", &mut lines); }
                    }
                }
            }
            match *kind {
                "insert" | "insert-if-absent" => probe_costs(&table.rules.insert, &mut lines),
                "update" => probe_costs(&table.rules.update, &mut lines),
                "delete" => probe_costs(&table.rules.delete, &mut lines),
                "upsert" => { probe_costs(&table.rules.insert, &mut lines); probe_costs(&table.rules.update, &mut lines); }
                _ => {}
            }
        }
    }
    crate::presentation::indexes(&bound.schema, &lines.join("\n"), canonical)
}

/// Residual equalities do not add a read site to a total unique rule probe.
fn probe_costs(rule: &snapback4_core::schema::RuleExpr, lines: &mut Vec<String>) {
    use snapback4_core::schema::RuleExpr;
    match rule {
        RuleExpr::Eq(a,b) | RuleExpr::Ne(a,b) | RuleExpr::Compare(_,a,b) => { reference_costs(a, "write rule", lines); reference_costs(b, "write rule", lines); }
        RuleExpr::Exists { key, equalities, .. } | RuleExpr::Created { key, equalities, .. } => {
            for term in key.iter().chain(equalities.iter().map(|(_, term)| term)) { reference_costs(term, "write rule", lines); }
        }
        _ => {}
    }
    match rule {
        RuleExpr::Exists { table, index, equalities, .. } | RuleExpr::Created { table, index, equalities, .. } if !equalities.is_empty() => {
            lines.push(format!("      rule probe {table}.{index} — one point read, then {} extra equality check(s) when this branch runs", equalities.len()));
        }
        RuleExpr::And(rules) | RuleExpr::Or(rules) => rules.iter().for_each(|rule| probe_costs(rule, lines)),
        RuleExpr::Not(rule) => probe_costs(rule, lines),
        _ => {}
    }
}

// @ref LLP 3000.007#5.4 — each syntactic hop prepays its point probe, including short-circuited paths.
fn reference_costs(term: &snapback4_core::schema::RuleTerm, position: &str, lines: &mut Vec<String>) {
    for (hop, (table, field)) in term.references().enumerate() {
        lines.push(format!("      {position} hop {}: {table}.byId -> {field}; 1 prepaid rule probe; live readable row, current device coverage", hop + 1));
    }
}

// @ref LLP 3000.007#5.7 — expression ranges have an intended bound and are priced by the step meter.
fn range_costs(body: &[ir::Stmt], lines: &mut Vec<String>) {
    for stmt in body {
        match stmt {
            ir::Stmt::For { domain, body, .. } => {
                if matches!(domain, ir::LoopDomain::ExpressionRange { .. }) { lines.push("    range: steps ≤ meter".into()); }
                range_costs(body, lines);
            }
            ir::Stmt::If { then_body, else_body, .. } => { range_costs(then_body, lines); range_costs(else_body, lines); }
            _ => {}
        }
    }
}

pub fn types(options: &Options) -> i32 {
    let project = project_or_exit();
    let bound = compile_or_exit(&project, options.json);
    match project.write_generated(&bound) {
        Ok(path) => {
            println!("{}", path.display());
            eprintln!("types: wrote {}", path.display());
            0
        }
        Err(error) => {
            eprintln!("cannot write generated types: {error}");
            2
        }
    }
}

pub fn run(options: &Options) -> i32 {
    let Some(op) = options.positionals.first() else {
        eprintln!("usage: snapback4 run <operation> [json-args] --as <persona|principal-id> [--json]");
        return 2;
    };
    let now = match crate::dev_clock::run_now(options.flags.get("now")) { Ok(now) => now, Err(error) => { eprintln!("{error}"); return 1; } };
    let project = project_or_exit();
    let source = match run_admission::Source::capture(&project) {
        Ok(source) => source,
        Err(error) => { eprintln!("cannot read the source: {error}"); return 2; }
    };
    let bound = compiled_or_exit(source.compile(), options.json);
    if bound.schema.tables.values().any(|t| t.ephemeral.is_some()) {
        eprintln!("run: ephemeral rows live only in this process; use dev and client calls to observe them across calls");
    }
    let Some(program) = bound.programs.iter().find(|p| &p.program.name == op).map(|p| p.program.clone()) else {
        let names: Vec<&str> = bound.programs.iter().map(|p| p.program.name.as_str()).collect();
        eprintln!("unknown operation {op}; operations: {}", names.join(", "));
        return 1;
    };
    let args_json: Json = match options.positionals.get(1) {
        Some(text) => match serde_json::from_str(text) {
            Ok(json) => json,
            Err(error) => {
                eprintln!("arguments are JSON: {error}");
                return 2;
            }
        },
        None => json!({}),
    };
    let mut args = BTreeMap::new();
    if let Json::Object(fields) = &args_json {
        for (name, value) in fields {
            let Some(kind) = program.args.get(name) else {
                eprintln!("{op} takes no argument {name}");
                return 1;
            };
            match wire::from_json(kind, value) {
                Ok(typed) => {
                    args.insert(name.clone(), typed);
                }
                Err(why) => {
                    eprintln!("argument {name}: {why}");
                    return 1;
                }
            }
        }
    }
    let principal = match options.flags.get("as") {
        Some(name) if bound.personas.contains(name) => persona_principal(name),
        Some(principal) => principal.clone(),
        None => persona_principal("alice"),
    };
    let _owner = match crate::store_owner::command(&project.store_path()) {
        Ok(owner) => owner,
        Err(error) => { eprintln!("{error}"); return 2; }
    };
    let mut engine = match run_admission::open(&project, &_owner, &bound, &source, op, now) {
        Ok(engine) => engine,
        Err(error) => {
            eprintln!("cannot open the store: {error}");
            return 2;
        }
    };
    if let Err(problem) = crate::native::install(&mut engine, &project) {
        eprintln!("{problem}");
        return 2;
    }
    if let Err(error) = source.validate(&project) {
        eprintln!("run {op}: {error}");
        return 2;
    }
    if program.kind == ProgramKind::Job {
        // A job runs as the system principal, every chunk in turn, here.
        if options.flags.contains_key("as") {
            eprintln!("run: --as is ignored for a job; jobs run as the system");
        }
        return match engine.run_job(op, args, now) {
            Ok(run) => {
                for line in engine.take_native_logs() {
                    eprintln!("native {line}");
                }
                let body = json!({ "job": run.name, "id": run.id, "state": run.state, "chunks": run.chunks, "chunkSize": run.chunk_size, "retries": run.retries, "heapPeak": run.heap_peak, "rowsWritten": run.rows_written, "error": run.error });
                println!("{}", if options.json { body.to_string() } else { serde_json::to_string_pretty(&body).unwrap() });
                if run.state == snapback4_core::JobState::Done { 0 } else { 1 }
            }
            Err(error) => {
                eprintln!("{op}: {error}");
                1
            }
        };
    }
    let context = Context::new(principal, args).at(now);
    if program.kind == ProgramKind::Query {
        match engine.query(op, context) {
            Ok(outcome) => {
                let body = if outcome.unavailable { json!({ "loading": true, "data": null, "complete": false, "metered": outcome.metered }) }
                    else { json!({ "data": wire::to_json(&outcome.data), "complete": outcome.complete, "cut": outcome.cut, "next": outcome.next, "metered": outcome.metered }) };
                println!("{}", if options.json { body.to_string() } else { serde_json::to_string_pretty(&body).unwrap() });
                0
            }
            Err(refusal) => {
                println!("{}", if options.json { json!({ "denied": refusal, "complete": false }).to_string() } else { format!("denied {refusal}") });
                1
            }
        }
    } else {
        match engine.mutate(op, None, context) {
            Ok(outcome) => match outcome.state {
                WriteState::Sent { seq, result } => {
                    let body = json!({ "state": "sent", "seq": seq, "result": wire::to_json(&result), "events": outcome.events, "metered": outcome.metered });
                    println!("{}", if options.json { body.to_string() } else { serde_json::to_string_pretty(&body).unwrap() });
                    0
                }
                WriteState::Failed { why, current } => {
                    let body = json!({ "state": "failed", "why": why, "current": current.map(|c| wire::to_json(&c)) });
                    println!("{}", if options.json { body.to_string() } else { format!("failed {why}") });
                    1
                }
            },
            Err(error) => {
                eprintln!("{error}");
                2
            }
        }
    }
}

pub fn data(options: &Options) -> i32 {
    let Some(table) = options.positionals.first() else {
        eprintln!("usage: snapback4 data <table> [--limit N]");
        return 2;
    };
    let project = project_or_exit();
    // @ref LLP 3000.019#3.4 — inspection must not acquire a writer through store initialization.
    let mut store = match snapback4_core::Store::open_read_only(&project.store_path()) {
        Ok(store) => store,
        Err(error) => {
            eprintln!("cannot open the store: {error}");
            return 2;
        }
    };
    let limit: usize = match options.flags.get("limit") {
        None => 50,
        Some(text) => match text.parse() {
            Ok(limit) => limit,
            Err(_) => {
                eprintln!("data: --limit must be a non-negative integer");
                return 2;
            }
        },
    };
    // Read the schema and rows from one snapshot; source on disk may be unadopted.
    let inspected = (|| -> Result<_, snapback4_core::RuntimeError> {
        let tx = store.read_transaction()?;
        let encoded: String = tx.conn().query_row("SELECT schema FROM _generations WHERE generation = (SELECT value FROM _meta WHERE key = 'generation')", [], |row| row.get(0))?;
        let schema: snapback4_core::schema::Schema = serde_json::from_str(&encoded).map_err(|e| snapback4_core::RuntimeError::Store(e.to_string()))?;
        schema.refuse_private(table)?;
        let definition = schema.table(table).ok_or_else(|| snapback4_core::RuntimeError::Schema(format!("no table {table}")))?;
        if definition.ephemeral.is_some() {
            eprintln!("data: skipping {table}: ephemeral rows live only in the serving process's memory");
            tx.rollback()?;
            return Ok((Vec::new(), false));
        }
        let mut rows: Vec<_> = tx.scan(table, "byId", &[], &Default::default(), snapback4_core::rows::Dir::Asc, limit.saturating_add(1))?.into_iter().map(|(row, _)| row).collect();
        let more = rows.len() > limit;
        rows.truncate(limit);
        // @ref LLP 3000.007#18.3 — data prints the interpreted row of the stored generation.
        for row in &mut rows { snapback4_core::schema::materialize_optional_fields(row, definition); }
        tx.rollback()?;
        Ok((rows, more))
    })();
    match inspected {
        Ok((rows, more)) => {
            for row in &rows {
                println!("{}", wire::to_json(row));
            }
            if more {
                eprintln!("… more rows (increase --limit)");
            }
            0
        }
        Err(error) => {
            if error.to_string().starts_with(&format!("E_SCHEMA: no table {table}")) {
                let tables = snapback4_core::Engine::open(store)
                    .ok()
                    .map(|engine| engine.schema().visible_tables().map(|(name,_)|name.clone()).collect::<Vec<_>>())
                    .unwrap_or_default();
                let tables = if tables.is_empty() { "(none)".to_owned() } else { tables.join(", ") };
                eprintln!("no table {table}; tables: {tables}");
            } else {
                eprintln!("{error}");
            }
            1
        }
    }
}

fn human_period(ms: u64) -> String {
    if ms % 86_400_000 == 0 { format!("{}d", ms / 86_400_000) }
    else if ms % 3_600_000 == 0 { format!("{}h", ms / 3_600_000) }
    else if ms % 60_000 == 0 { format!("{}m", ms / 60_000) }
    else if ms % 1_000 == 0 { format!("{}s", ms / 1_000) }
    else { format!("{ms}ms") }
}

fn human(bytes: u64) -> String {
    match bytes {
        b if b >= 1 << 20 => format!("{:.1} MB", b as f64 / (1 << 20) as f64),
        b if b >= 1 << 10 => format!("{:.1} KB", b as f64 / (1 << 10) as f64),
        b => format!("{b} B"),
    }
}

#[cfg(test)]
#[path = "../tests/doctor/mod.rs"]
pub(crate) mod doctor_tests;

fn effect_health(engine: &snapback4_core::Engine, now: i64) -> Result<(BTreeMap<String, u64>, rusqlite::Result<(i64, Option<i64>)>), snapback4_core::RuntimeError> {
    // Counts (including replay suppression) and grace deadlines describe one snapshot.
    let snapshot = engine.store().conn().unchecked_transaction()?;
    let counts = engine.effect_counts()?;
    // @ref LLP 3000.007#20.16 — report grace deferrals without treating retry backoff as presence.
    let deferred = engine.store().conn().query_row(
        "SELECT COUNT(*), MIN(next_at) FROM _outbox WHERE state = 'queued' AND next_at > ?1 AND EXISTS (SELECT 1 FROM _effect_presence WHERE id = _outbox.id)",
        [now], |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?)),
    );
    snapshot.rollback()?;
    Ok((counts, deferred))
}

pub fn doctor(options: &Options) -> i32 {
    if options.flags.contains_key("latency") || options.flags.contains_key("reset") { return latency::doctor(options); }
    let started = Instant::now();
    let mut lines = Vec::new();
    let mut ok = true;
    let mut storage: Option<snapback4_core::store::Sizes> = None;
    let mut latency_snapshot = None;
    let version = env!("CARGO_PKG_VERSION");
    let project = match work_records::project(options) { Ok(project) => project, Err(error) => { eprintln!("doctor: {error}"); return 1; } };
    lines.push(format!("project   {}", project.root.display()));
    if let Some(summary) = witness::background::doctor_summary(&project.root) { lines.push(summary); }
    lines.push(format!("worker    dev entry: {}; serve entry: --worker <path>", crate::dev_worker::source(&project).map(|p| p.display().to_string()).unwrap_or_else(|| "none (add snapback/worker.ts, .mts or .mjs)".into())));
    match crate::dev_worker::declared(&project) {
        Ok(workers) => for (name, path) in workers { lines.push(format!("worker    {name}: {} (dev and serve)", path.display())); },
        Err(error) => { lines.push(format!("worker    {error}")); ok = false; }
    }
    let (personas, native_jobs) = match project.compile() {
        Ok(bound) if bound.diagnostics.is_empty() => {
            lines.push(format!("schema    ok: {} tables, {} synced, {} operations", bound.schema.visible_tables().count(), bound.schema.synced().count(), bound.programs.len()));
            let native = crate::native::declared(&bound);
            (bound.personas, native)
        }
        Ok(bound) => {
            ok = false;
            lines.push(format!("schema    {} problem{} (`snapback4 check`)", bound.diagnostics.len(), if bound.diagnostics.len() == 1 { "" } else { "s" }));
            let native = crate::native::declared(&bound);
            (bound.personas, native)
        }
        Err(error) => {
            ok = false;
            lines.push(format!("schema    FAIL {error}"));
            (Vec::new(), Vec::new())
        }
    };
    if !native_jobs.is_empty() {
        // A native job's module and toolchain (LLP 3000.005).
        let module = project.native_module();
        let built = match std::fs::metadata(&module) {
            Ok(meta) => format!("module {} ({})", module.display(), human(meta.len())),
            Err(_) => {
                ok = false;
                "module not built (`snapback4 check` builds snapback/native)".to_owned()
            }
        };
        let toolchain = match crate::native::toolchain() {
            Ok(version) => version,
            Err(why) => {
                ok = false;
                why
            }
        };
        lines.push(format!("native    {} declared: {}; {built}; {toolchain}", if native_jobs.len() == 1 { "program" } else { "programs" }, native_jobs.join(", ")));
    }
    let host = match adoption::host(&project, options) {
        Ok(host) => host,
        Err(error) => { eprintln!("E_INPUT at doctor: {error}"); return 1; }
    };
    lines.push(crate::host_limits::describe_for_doctor(host.as_ref()));
    if let Some(host) = &host {
        if host["fileDescriptors"]["startup"]["error"].as_str().is_some() { ok = false; }
        if host["scheduling"]["qosFailures"].as_u64().unwrap_or(0) + host["scheduling"]["niceFailures"].as_u64().unwrap_or(0) > 0 {
            ok = false;
            lines.push(format!("scheduling  {} QoS / {} nice setter failures; HTTP startup readback {}; inspect host stderr", host["scheduling"]["qosFailures"], host["scheduling"]["niceFailures"], host["scheduling"]["startupReadback"].as_str().unwrap_or("not recorded")));
            if let Some(classes) = host["scheduling"]["failures"].as_object() {
                for (class, failure) in classes {
                    lines.push(format!("scheduling  {class}: {} failed setters; last errno {} at Unix ms {}", failure["count"], failure["lastErrno"], failure["lastAtMs"]));
                }
            }
        }
    }
    if host.is_none() && !options.flags.contains_key("release") {
        lines.push(format!("latency   {}", adoption::NO_HOST));
    }
    if let Some(host) = host.as_ref().filter(|host| host["temporary"] == true) {
        lines.push(format!("store     temporary dev store {}; generation {}", host["storeId"].as_str().unwrap_or("unknown"), host["generation"]));
        latency_snapshot = latency::read(host, false);
        if let Some(snapshot) = &latency_snapshot { lines.extend(latency::lines(snapshot, false)); }
        if let Some(reason) = host["adoption"].as_str() {
            ok = false;
            lines.push(format!("adoption  pending: {reason}; serving the previous generation"));
        }
    } else {
    // Source diagnostics and persisted backend health are independent. Even
    // broken or destructive edits must leave the active generation usable.
    match snapback4_core::Store::open_read_only(&work_records::store_path(options)) {
        Ok(store) => {
            if let Ok(mut statement) = store.conn().prepare("SELECT value FROM _meta WHERE key = 'worker:status' OR key LIKE 'worker:status:%' ORDER BY key") {
                if let Ok(rows) = statement.query_map([], |row| row.get::<_, String>(0)) {
                    for status in rows.flatten() { lines.push(format!("worker    last report: {status}")); }
                }
            }
            let generation = store.meta("generation").ok().flatten().unwrap_or_else(|| "unrecorded".into());
            lines.push(format!("store     {} at seq {}, generation {}", work_records::store_path(options).display(), store.seq().unwrap_or(0), generation));
            if host.as_ref().is_some_and(|host| store.meta("store_id").ok().flatten().as_deref() != host["storeId"].as_str()) {
                eprintln!("E_INPUT at doctor: the dev server serves a different persisted store; run doctor in that server's project with its current store");
                return 1;
            }
            let now = host.as_ref().and_then(|h| h["now"].as_i64()).unwrap_or_else(snapback4_core::now_ms);
            if let Some(host) = &host {
                latency_snapshot = latency::read(host, false);
                if let Some(snapshot) = &latency_snapshot { lines.extend(latency::lines(snapshot, false)); }
                if let Some(active) = host["generation"].as_u64() {
                    if active.to_string() != generation {
                        ok = false;
                        lines.push(format!("backend   E_GENERATION: host generation {active} differs from store generation {generation}; jobs and sweeps refuse the stale backend; dev retries adoption unless --no-watch (restart that host)"));
                    } else { lines.push(format!("backend   host generation {active} matches store")); }
                }
                if let Some(reason) = host["adoption"].as_str() {
                    ok = false;
                    lines.push(format!("adoption  pending: {reason}; serving the previous generation; jobs and sweeps may fail until adoption succeeds"));
                }
            }
            let replay = store.meta("dev:replay").ok().flatten().as_deref() == Some("true");
            let held = store.meta("dev:hold-schedules").ok().flatten().as_deref() == Some("true");
            lines.push(format!("replay    {} — new effects {}; schedules {} (persisted dev policy)", if replay { "on" } else { "off" }, if replay { "suppressed" } else { "enabled" }, if held { "held" } else { "enabled" }));
            if let Ok(sizes) = store.sizes() {
                storage = Some(sizes);
                lines.push(format!("storage   rows {} ({} rows, including engine-internal storage) · indexes {} · log {} ({} events, {:.1}× rows) · ops {} · file {}", human(sizes.rows), sizes.row_count, human(sizes.indexes), human(sizes.log), sizes.log_events, sizes.amplification(), human(sizes.ops), human(sizes.file)));
            }
            match snapback4_core::Engine::open(store) {
                Ok(mut engine) => {
                    match engine.recorded_nulls() {
                        Ok(counts) => {
                            for (name, paths) in counts.captures {
                                for (path, count) in paths { lines.push(format!("attribution {name}: {count} null captures at {path}")); }
                            }
                            for (name, count) in counts.contributions { lines.push(format!("attribution {name}: {count} null-attributed contributions")); }
                        }
                        Err(error) => { ok = false; lines.push(format!("attribution FAIL {error}")); }
                    }
                    if let Ok(counts) = engine.action_counts() {
                        lines.push(format!("requests  {}", ["queued", "running", "done", "failed"].into_iter().map(|state| format!("{} {state}", counts.get(state).copied().unwrap_or(0))).collect::<Vec<_>>().join(", ")));
                    }
                    for schedule in &engine.schema().schedules {
                        let last = engine.store().meta(&format!("schedule:{}", schedule.name)).ok().flatten();
                        lines.push(format!("schedule  {} every {}{} → {}; {}", schedule.name, human_period(schedule.every_ms), if schedule.offset_ms > 0 { format!(" at {:02}:{:02}", schedule.offset_ms / 3_600_000, schedule.offset_ms % 3_600_000 / 60_000) } else { String::new() }, schedule.target, match last { Some(at) => format!("last boundary {at}"), None => "not yet started (a running server starts it)".into() }));
                    }
                    if let Ok(work) = engine.timeline_work_counts() {
                        for (name, pending, parked) in work { lines.push(format!("timeline  {name}: {pending} pending delivery work, {parked} parked")); }
                    }
                    if let Ok(runs) = engine.jobs(5) {
                        for run in runs {
                            lines.push(format!("job       {} {} {:?}: {} chunk{}, {} row{} (chunk size {}, retries {}, peak heap {}){}", run.name, run.id, run.state, run.chunks, if run.chunks == 1 { "" } else { "s" }, run.rows_written, if run.rows_written == 1 { "" } else { "s" }, run.chunk_size, run.retries, run.heap_peak, run.error.map(|e| format!(" — {e}")).unwrap_or_default()));
                        }
                    }
                    if let Ok((counts, deferred)) = effect_health(&engine, now) && !counts.is_empty() {
                        let deferred = match deferred {
                            Ok((count, Some(at))) => format!("{count} deferred (next at {at}, +{}s)", (at - now + 999) / 1000),
                            Ok((count, None)) => format!("{count} deferred"),
                            Err(error) => { ok = false; format!("deferred count unavailable: {error}") }
                        };
                        lines.push(format!("effects   {}, {deferred}", counts.iter().map(|(state, n)| format!("{n} {state}")).collect::<Vec<_>>().join(", ")));
                        if let Ok(failed) = engine.effects(Some("failed"), 3) {
                            for run in failed {
                                lines.push(format!("effect    {} {} failed after {} attempt{}: {}", run.effect, run.id, run.attempts, if run.attempts == 1 { "" } else { "s" }, run.error.unwrap_or_default()));
                            }
                        }
                    }
                }
                Err(error) => {
                    ok = false;
                    lines.push(format!("backend   FAIL {error}"));
                }
            }
        }
        Err(error) => {
            ok = false;
            lines.push(format!("store     FAIL {error}"));
        }
    }
    }
    lines.push(format!("types     {}", if project.generated_dir().join("api.ts").is_file() { "generated" } else { "not generated yet (`snapback4 check` writes them)" }));
    if !personas.is_empty() {
        lines.push(format!("personas  {}", personas.join(", ")));
    }
    if options.json {
        println!("{}", json!({ "ok": ok, "lines": lines, "storage": storage, "latency": latency_snapshot, "ms": started.elapsed().as_millis() }));
    } else {
        println!("snapback4 {version}");
        for line in lines {
            println!("  {line}");
        }
        println!("  {} in {:.1} ms", if ok { "ok" } else { "not ok" }, started.elapsed().as_secs_f64() * 1000.0);
    }
    if ok { 0 } else { 1 }
}

pub fn why(options: &Options) -> i32 {
    let Some(subject) = options.positionals.first() else {
        eprintln!("usage: snapback4 why <E_CODE | recent | operation | table | id> [--release dir] [--values]");
        return 2;
    };
    if subject == "recent" {
        let project = match work_records::project(options) { Ok(project) => project, Err(error) => { eprintln!("why: {error}"); return 1; } };
        return match crate::serve::dev_refusals::recent(&project.data_dir(), options.flags.get("store").map(String::as_str), options.flags.get("instance").map(String::as_str)) {
            Ok(records) => { println!("{}", serde_json::to_string_pretty(&records).unwrap()); 0 }
            Err(error) => { eprintln!("why recent: {error}"); 1 }
        };
    }
    if subject == "reports" {
        println!("{}", snapback4_lang::guide::card("receipts").expect("receipts card"));
        return 0;
    }
    if let Some(explanation) = snapback4_lang::guide::explain_code(subject) {
        // @ref LLP 3000.007#20.1 — follow the current diagnostic's card when one code spans several recipes.
        let contextual = std::env::current_dir().ok().and_then(|dir| Project::locate(&dir)).and_then(|project| project.compile().ok()).and_then(|bound| {
            bound.diagnostics.iter().chain(&bound.notes).find(|diagnostic| diagnostic.code == *subject).and_then(|diagnostic| diagnostic.explanation())
        });
        let explanation = contextual.unwrap_or(explanation);
        println!("{explanation}");
        return 0;
    }
    let project = match work_records::project(options) { Ok(project) => project, Err(error) => { eprintln!("why: {error}"); return 1; } };
    // A broken working source must not make durable work uninspectable.
    let bound = project.compile().ok().filter(|bound| bound.diagnostics.is_empty());
    if let Some(bound) = &bound {
        if let Err(error) = bound.schema.refuse_private(subject) { eprintln!("{error}"); return 1; }
        if let Some(program) = bound.programs.iter().find(|p| &p.program.name == subject) {
            if let Ok(evidence) = crate::serve::dev_refusals::recent(&project.data_dir(), options.flags.get("store").map(String::as_str), options.flags.get("instance").map(String::as_str)) {
                if let Some(record) = evidence["records"].as_array().and_then(|records| records.iter().rev().find(|r| r["operation"].as_str() == Some(subject))) {
                    println!("Latest request evidence (not a claim about this invocation): {}", record);
                }
            }
            println!("{} {}({})", program.program.kind.word(), program.program.name, program.args.iter().map(|(name, ty)| format!("{name}: {}", ty.name())).collect::<Vec<_>>().join(", "));
            println!("  returns {}", program.result.name());
            // @ref LLP 3000.022#14.6 — discover the generated handle and its declared coordinates.
            for family in &bound.schema.receipts {
                if [&family.seen, &family.delivered, &family.compact].contains(&&program.program.name)
                    || bound.receipt_members.get(&family.name) == Some(&program.program.name) {
                    println!("  api.receiptFamilies.{}: member {}, seen {}; counter {}.{}, joining floor {}.{}, recipient count {}.{}, delivered/seen {} / {}",
                        family.name, bound.receipt_members[&family.name], family.seen, family.scope, family.counter,
                        family.members, family.floor, family.messages, family.count, family.delivered_field, family.seen_field);
                    println!("  useSeen: visible confirmed positions only; read bare retained history and live decorations independently. Membership, join floors and delivery coverage remain server-authoritative.");
                }
            }
            println!("{}", crate::presentation::indexes(&bound.schema, &snapback4_lang::bind::residency::operation_lines(subject, &bound.schema.operations[subject]), options.json || options.flags.contains_key("verbose")));
            println!("{}", cost_report(&bound, &program.program, options.json || options.flags.contains_key("verbose")));
            return 0;
        }
        if let Some(table) = bound.schema.tables.get(subject).filter(|_|bound.schema.visible(subject)) {
            println!("table {subject}");
            println!("  residency: {}", snapback4_lang::bind::residency::table_line(&bound.schema, subject));
            if let Some(source) = &table.residency.inherited_from {
                println!("  inherited from {source} without a horizon; keep this audience for offline aggregate/absence coverage, or use online only and lose that coverage. Measure the replica census: snapback4 test --residency; guide maintains; guide offline-interactions");
            }
            if table.residency.inferred { println!("  inferred from read <- {}", table.rules.read.quarry()); }
            println!("  read   <- {}", table.rules.read.quarry());
            println!("  insert <- {}", table.rules.insert.quarry());
            println!("  update <- {}", table.rules.update.quarry());
            println!("  delete <- {}", table.rules.delete.quarry());
            match &table.sync {
                Some(sync) => println!("  {} — a device holds these rows; {}", sync.line(), match &sync.audience { Audience::Public => "everyone holds the same partition".to_owned(), Audience::Column(c) => format!("each row reaches the principal in .{c}"), Audience::Target { table, principal, .. } => format!("each row reaches every principal in {table}.{principal} whose group matches") }),
                None => println!("  online-only — no sync line; reads go to the server"),
            }
            if let Some(column) = &table.expire {
                println!("  expire at .{column} — a row past it is absent to every reader, then swept; null never expires");
            }
            for line in crate::column_cost::description(&bound.schema, subject) { println!("{line}"); }
            for (path, recorded) in &table.recorded {
                let Some(kind) = table.columns.get(path) else { eprintln!("why: recorded field {path} has no stored column; run doctor"); return 1; };
                println!("  engine-recorded {path}: {kind} — captured from {}.{} at insertion/import/activation; trusted restore preserves it; absent from * and generated types, visible to sql", recorded.table, recorded.column);
            }
            for (name, index) in &table.indexes {
                println!("  {} {name}: {}", if index.unique { "unique" } else { "by" }, index.columns().join(", "));
            }
            return 0;
        }
    }
    match work_records::explain(options, subject) {
        Ok(true) => return 0,
        Err(error) => { eprintln!("why: {error}"); return 1; }
        Ok(false) => {}
    }
    if subject.starts_with("E_") || subject.starts_with("N_") {
        // A guessed code: name the real ones.
        eprintln!("{subject} is not a refusal code. A unique clash, a cap, an immutable column or a text format is E_CONSTRAINT; a program's own `require .. else CODE` codes are the program's. The codes: {}", snapback4_lang::guide::codes().join(", "));
        return 1;
    }
    eprintln!("nothing named {subject}: not a refusal code, an operation, a table, or a work id");
    1
}

/// `test`: run every argument-free query as each persona against the store
/// (optionally loaded from a fixture) and print the meters beside the
/// ceilings, so a builder reads numbers instead of being refused on a bound.
pub fn test(options: &Options) -> i32 {
    let project = project_or_exit();
    let bound = compile_or_exit(&project, options.json);
    let _owner = if options.flags.contains_key("fixture") { None } else {
        match crate::store_owner::command(&project.store_path()) {
            Ok(owner) => Some(owner),
            Err(error) => { eprintln!("{error}"); return 1; }
        }
    };
    let opened = match &_owner {
        Some(owner) => owner.open_engine(&bound, std::time::Duration::from_secs(5), snapback4_core::now_ms()).map_err(|e| e.to_string()),
        None => test_fixture::engine(&project, &bound, options),
    };
    let mut engine = match opened {
        Ok(engine) => engine,
        Err(error) => { eprintln!("{error}"); return 1; }
    };
    let personas = residency::personas(&bound, options);
    if options.flags.contains_key("residency") {
        let verbose = options.flags.contains_key("verbose");
        if let Err(error) = residency::measure(&mut engine, &bound, &personas, verbose) { eprintln!("residency measurement failed: {error}"); return 1; }
        if !verbose { return 0; }
    }
    let ceilings = engine.ceilings();
    let mut failures = 0;
    println!("test: {:<28} {:>8} {:>8} {:>8} {:>8} {:>10} {:>10}", "operation (persona)", "examined", "entries", "probes", "steps", "heap B", "output B");
    println!("      {:<28} {:>8} {:>8} {:>8} {:>8} {:>10} {:>10}", "ceilings", ceilings.examined, ceilings.index_entries, ceilings.rule_probes, ceilings.steps, ceilings.heap_bytes, ceilings.output_bytes);
    let mut skipped = Vec::new();
    let mut near = Vec::new();
    for program in &bound.programs {
        if program.program.kind != ProgramKind::Query {
            continue;
        }
        // @ref LLP 3000.007#18.1 — a server fixture is not the device's held partition.
        if bound.schema.operations.get(&program.program.name).is_some_and(|fact| fact.held) {
            println!("      not run: {} is held (device only)", program.program.name);
            continue;
        }
        for persona in &personas {
            let principal = if persona.contains(':') { persona.clone() } else { persona_principal(persona) };
            // Arguments come from the data: a reference is the table's first
            // row, a principal is the persona, a text is the shortest that
            // fits. What cannot be derived is named, never skipped silently.
            let mut args = BTreeMap::new();
            let mut missing = Vec::new();
            for (name, kind) in &program.program.args {
                match sample_arg(&engine, kind, &principal) {
                    Some(value) => {
                        args.insert(name.clone(), value);
                    }
                    None => missing.push(format!("{name}: {}", arg_word(kind))),
                }
            }
            if !missing.is_empty() {
                skipped.push(format!("{} ({persona}): needs {}", program.program.name, missing.join(", ")));
                continue;
            }
            let shown = if args.is_empty() { String::new() } else { format!(" {}", serde_json::to_string(&args.iter().map(|(k, v)| (k.clone(), wire::to_json(v))).collect::<serde_json::Map<_, _>>()).unwrap_or_default()) };
            let started = Instant::now();
            let derived = !args.is_empty();
            match engine.query(&program.program.name, Context::new(principal, args)) {
                Ok(outcome) => {
                    let m = outcome.metered;
                    let state = if outcome.complete { "complete" } else { "capped" };
                    // @ref LLP 3000.007#20.22.1 — report approach to a ceiling on the fixture, separately from actual cuts.
                    if outcome.capped_at.is_none() && outcome.word_cut_at.is_none() {
                        if let Some(cost) = crate::serve::read_cost::near_ceiling(m, ceilings) { near.push(format!("{} ({persona}) {cost}", program.program.name)); }
                    }
                    println!("      {:<28} {:>8} {:>8} {:>8} {:>8} {:>10} {:>10}  {state} in {:.1} ms{shown}", format!("{} ({persona})", program.program.name), m.examined, m.index_entries, m.rule_probes, m.steps, m.heap_bytes, m.output_bytes, started.elapsed().as_secs_f64() * 1000.0);
                }
                Err(refusal) if refusal.family == "rule" && derived => {
                    // A program's own `require` refusing a derived argument
                    // is information, not a failure: the persona is not in
                    // that group. Run it with yours to see the meters.
                    println!("      {:<28} refused {} on derived arguments{shown} — run it with yours: snapback4 run {} '{{..}}' --as {persona}", format!("{} ({persona})", program.program.name), refusal.code, program.program.name);
                }
                Err(refusal) => {
                    failures += 1;
                    println!("      {:<28} denied {}: {}{shown}", format!("{} ({persona})", program.program.name), refusal.code, refusal.message);
                }
            }
        }
    }
    for line in near.iter().take(10) { println!("near ceiling: {line}"); }
    if near.len() > 10 { println!("near ceiling: {} more query/persona reads passed half a ceiling without a cut", near.len() - 10); }
    for line in &skipped {
        println!("      not run: {line} — pass a fixture with a row of that table, or run it: snapback4 run <query> '{{..}}' --as <persona>");
    }
    if failures > 0 { 1 } else { 0 }
}

/// A plausible argument for `test`, from the store and the persona.
fn sample_arg(engine: &snapback4_core::Engine, kind: &ir::ArgType, principal: &str) -> Option<snapback4_core::Value> {
    use snapback4_core::Value;
    Some(match kind {
        ir::ArgType::Optional(_) | ir::ArgType::Cursor => Value::Null,
        ir::ArgType::Principal => Value::Id(principal.to_owned()),
        ir::ArgType::Ref { table } => engine.store().rows(table).ok()?.into_iter().next()?.field("id").ok()?.clone(),
        ir::ArgType::Text { min, format, .. } => Value::String(match format {
            Some(snapback4_core::schema::TextFormat::Url) => "https://example.com/".to_owned(),
            Some(snapback4_core::schema::TextFormat::Handle) => "a".repeat((*min).max(3) as usize),
            None => "a".repeat((*min).max(1) as usize),
        }),
        ir::ArgType::Int => Value::Int(0),
        ir::ArgType::Time => Value::Int(snapback4_core::now_ms()),
        ir::ArgType::Bool => Value::Bool(false),
        ir::ArgType::Enum { variants } => Value::String(variants.first()?.clone()),
        _ => return None,
    })
}

fn arg_word(kind: &ir::ArgType) -> String {
    match kind {
        ir::ArgType::Ref { table } => format!("a {table} id"),
        ir::ArgType::Id => "an id".into(),
        ir::ArgType::List { .. } | ir::ArgType::ListRange { .. } => "a list".into(),
        ir::ArgType::Json { .. } => "json".into(),
        ir::ArgType::Bytes { .. } | ir::ArgType::Image { .. } | ir::ArgType::Video { .. } => "bytes".into(),
        other => format!("{other:?}").to_lowercase(),
    }
}


mod releases;
pub use releases::{deploy, rollback, serve_release};
pub(crate) use releases::release_bind;

/// `token --service <name> [--days N] [--release <dir>]`: a bearer session
/// for a service principal, printed once. A service is a worker's seat: it
/// claims effects, mints sessions for the accounts the application
/// authenticates itself, and is admitted by rules as `service:<name>`.
pub fn token(options: &Options) -> i32 {
    let Some(name) = options.flags.get("service").filter(|name| !name.is_empty()) else {
        eprintln!("usage: snapback4 token --service <name> [--days N] [--release <dir>]");
        return 2;
    };
    let days: i64 = options.flags.get("days").and_then(|d| d.parse().ok()).unwrap_or(365);
    let path = options.flags.get("release").map(|dir| Path::new(dir).join("store.sqlite"))
        .unwrap_or_else(|| project_or_exit().store_path());
    if !options.flags.contains_key("release") && !path.is_file() {
        eprintln!("cannot open the store: no store at {}; run `snapback4 dev` first", path.display());
        return 2;
    }
    let _owner = match crate::store_owner::command(&path) {
        Ok(owner) => Some(owner),
        Err(error) if error.starts_with("E_STORE_BUSY ") => None,
        Err(error) => { eprintln!("{error}"); return 2; }
    };
    let store_path = &path;
    let session = if let Some(owner) = &_owner {
        let store = match owner.open_store(std::time::Duration::from_secs(5)) {
            Ok(store) => store,
            Err(error) => { eprintln!("cannot open the store: {error}"); return 2; }
        };
        snapback4_core::identity::service_session(&store, name, snapback4_core::now_ms(), days)
            .map_err(|error| (1, format!("token: {error}")))
    } else {
        crate::serve::token::mint_live(&path, name, days)
    };
    match session {
        Ok(session) => {
            // Shell capture has one form, including when the shared --json flag is present.
            println!("{}", session.token);
            eprintln!("token: a session for {} until {} — printed once; keep it where the worker keeps secrets", session.principal, session.expires_at);
            eprintln!("store: {} — this token belongs only to this store; each isolated store needs its own", store_path.display());
            0
        }
        Err((status, error)) => {
            eprintln!("{error}");
            status
        }
    }
}

// @ref LLP 3000.020#3.1 — report the same normalized candidates execution chooses between.
fn row_view_range(schema: &snapback4_core::schema::Schema, m: &snapback4_core::schema::Maintain) -> Option<serde_json::Value> {
    let k = m.row_key.as_ref()?;
    let source = &schema.tables[&m.source];
    if !source.is_expiring() { return None; }
    let range = k.device_range(source)?;
    let horizon = source.sync.as_ref()?.horizon.as_ref()?;
    Some(json!({
        "column": range.column, "index": k.range_index(range.column),
        "bounds": range.lower().iter().map(|(field, strict)| json!({"column": range.column, "memberField": field, "operator": if *strict { ">" } else { ">=" }})).collect::<Vec<_>>(),
        "predicate": range.lower().iter().map(|(field, strict)| format!(".{} {} member.{field}", range.column, if *strict { ">" } else { ">=" })).collect::<Vec<_>>().join(" and "),
        "horizon": {"index": horizon.by, "last": horizon.last},
        "selection": "greatest encoded lower bound; strict wins equal values; null is weakest",
        "fallback": "whole group when every range operand is null; Whole keeps the live-basis scan"
    }))
}

/// The native module as a process: the same `Device` the Expo and Exact2
/// hosts link, speaking one JSON request per line on stdin and one answer
/// per line on stdout, so a JavaScript client can be tested end to end
/// against the real module without a native build, and a host without a
/// linker can still run it.
pub fn device(options: &Options) -> i32 {
    let Some(path) = options.positionals.first() else {
        eprintln!("usage: snapback4 device <store.sqlite> [backend.json]");
        println!("{}", json!({ "denied": { "code": "E_INPUT", "family": "input", "message": "usage: snapback4 device <store.sqlite> [backend.json]" } }));
        return 2;
    };
    let backend = match options.positionals.get(1) {
        Some(file) => {
            let text = match std::fs::read_to_string(file) {
                Ok(text) => text,
                Err(error) => {
                    let message = format!("device: {file}: {error}");
                    eprintln!("{message}");
                    println!("{}", json!({ "denied": { "code": "E_INPUT", "family": "input", "message": message } }));
                    return 2;
                }
            };
            match snapback4_device::opening::Opening::parse(Some(&text)) {
                Ok(backend) => backend,
                Err(error) => {
                    eprintln!("device: {file}: {error}");
                    println!("{}", json!({ "denied": error.refusal() }));
                    return 2;
                }
            }
        },
        None => snapback4_device::opening::Opening::Kept,
    };
    // Shared device ownership preserves multiple native-process handles while
    // excluding backend hosts and offline commands before any store writes.
    let owner = match crate::store_owner::device(Path::new(path)) {
        Ok(owner) => owner,
        Err(error) => {
            // @ref LLP 3000.019#3.4 — process hosts must receive ownership refusals before readiness.
            let code = if error.starts_with("E_STORE_BUSY ") { "E_STORE_BUSY" } else { "E_STORE" };
            eprintln!("{error}");
            println!("{}", json!({ "denied": { "code": code, "family": "store", "message": error } }));
            return 2;
        }
    };
    let opened = owner.path().and_then(|path| snapback4_device::native::Device::open_with(path, backend));
    let mut device = match opened {
        Ok(device) => device,
        Err(error) => {
            println!("{}", json!({ "denied": error.refusal() }));
            return 1;
        }
    };
    println!("{}", json!({ "ok": { "device": path } }));
    use std::io::{BufRead, Write};
    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    for line in stdin.lock().lines() {
        let Ok(line) = line else { break };
        if line.trim().is_empty() {
            continue;
        }
        let answer = match snapback4_device::call::try_call_text(&mut device, &line) {
            Ok(answer) => answer,
            Err(error) => json!({ "denied": { "code": "E_INPUT", "family": "input", "message": format!("the request is JSON: {error}") } }),
        };
        if writeln!(stdout, "{answer}").and_then(|()| stdout.flush()).is_err() {
            break;
        }
    }
    0
}

//! The verbs that do not serve: `check`, `run`, `types`, `why`, `doctor`,
//! `init`, `data`, `test`. Each prints one honest answer and exits with it.

use crate::project::{GITIGNORE, Project, persona_principal};
use snapback4_core::engine::rules::scan_visibility;
use snapback4_core::ir::{self, ProgramKind};
use snapback4_core::schema::Audience;
use snapback4_core::{Context, WriteState, wire};
use snapback4_lang::Bound;
use serde_json::{Value as Json, json};
use std::collections::BTreeMap;
use std::path::Path;
use std::time::Instant;

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
            const SWITCHES: &[&str] = &["no-watch", "fresh", "cost", "allow-destructive"];
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
    if !bound.diagnostics.is_empty() {
        report_diagnostics(&bound, json);
        std::process::exit(1);
    }
    bound
}

fn report_diagnostics(bound: &Bound, json: bool) {
    if json {
        println!("{}", json!({ "ok": false, "problems": bound.diagnostics }));
        return;
    }
    for diagnostic in &bound.diagnostics {
        eprintln!("{diagnostic}\n");
    }
    eprintln!("check: {} problem{}", bound.diagnostics.len(), if bound.diagnostics.len() == 1 { "" } else { "s" });
}

pub fn check(options: &Options) -> i32 {
    let project = project_or_exit();
    let started = Instant::now();
    let bound = match project.compile() {
        Ok(bound) => bound,
        Err(error) => {
            eprintln!("cannot read snapback/: {error}");
            return 2;
        }
    };
    if !bound.diagnostics.is_empty() {
        report_diagnostics(&bound, options.json);
        return 1;
    }
    let _ = project.write_generated(&bound);
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
    let elapsed = started.elapsed();
    let synced = bound.schema.synced().count();
    if options.json {
        println!("{}", json!({ "ok": true, "tables": bound.schema.tables.len(), "synced": synced, "operations": bound.programs.len(), "notes": bound.notes, "native": native.as_ref().map(|b| json!({ "module": b.path, "bytes": b.bytes, "jobs": b.jobs, "ms": b.ms })), "ms": elapsed.as_millis() }));
    } else {
        println!("check: ok — {} tables ({synced} synced), {} operations, no problems{}, {:.1} ms{}", bound.schema.tables.len(), bound.programs.len(), if bound.notes.is_empty() { String::new() } else { format!(", {} note{}", bound.notes.len(), if bound.notes.len() == 1 { "" } else { "s" }) }, elapsed.as_secs_f64() * 1000.0, match &native { Some(b) => format!("; native: {} → {} ({} B, {} ms)", b.jobs.join(", "), b.path.display(), b.bytes, b.ms), None => String::new() });
        for note in &bound.notes {
            println!("note: {note}\n");
        }
    }
    if options.flags.contains_key("cost") {
        for program in &bound.programs {
            println!("{}", cost_report(&bound, &program.program));
        }
    }
    0
}

/// The structural cost class of a program: what `check --cost` prints
/// instead of a price (LLP 2000.000 §6).
fn cost_report(bound: &Bound, program: &ir::Program) -> String {
    let mut lines = vec![format!("  {} {}:", program.kind.word(), program.name)];
    if program.native {
        lines.push(format!("    native: the module's reads and writes go through the host, metered per chunk under the job ceilings ({} rows examined, {} written), {} fuel per chunk", snapback4_core::Ceilings::job().examined, snapback4_core::Ceilings::job().rows_written, snapback4_core::engine::native::FUEL_PER_CHUNK));
        return lines.join("\n");
    }
    let sites = ir::read_sites(program);
    if sites.is_empty() {
        lines.push("    reads nothing".into());
    }
    for site in &sites {
        let hoist = match site.kind {
            "scan" => {
                let scan = find_scan(&program.body, &site.site);
                match scan.map(|scan| scan_visibility(&bound.schema, scan)) {
                    Some(v) if v.decided_true => "rule decided by the prefix: no probes",
                    Some(v) if v.uniform => "rule uniform over the prefix: one verdict",
                    Some(_) => "rule checked per row",
                    None => "",
                }
            }
            "point" => "one row, one rule check",
            _ => "bounded walk",
        };
        let take = if site.kind == "scan" { format!(" first {}", site.take) } else { String::new() };
        lines.push(format!("    {} {}.{}{take} — {hoist}", site.kind, site.table, site.index));
    }
    let writes = ir::write_tables(program);
    for (table, kind) in &writes {
        let audience = bound.schema.tables.get(table).and_then(|t| t.sync.as_ref()).map(|s| format!(", fans out to {}", match &s.audience { Audience::Public => "everyone".to_owned(), Audience::Column(c) => format!(".{c}"), Audience::Target { table, .. } => format!("the members in {table}") })).unwrap_or_default();
        lines.push(format!("    {kind} {table}{audience}"));
    }
    lines.join("\n")
}

fn find_scan<'a>(stmts: &'a [ir::Stmt], site: &str) -> Option<&'a ir::Scan> {
    fn in_expr<'a>(expr: &'a ir::Expr, site: &str) -> Option<&'a ir::Scan> {
        match expr {
            ir::Expr::Scan(scan) if scan.site == site => Some(scan),
            ir::Expr::Merge(merge) => merge.lanes.iter().find_map(|lane| if lane.scan.site == site { Some(&lane.scan) } else { lane.source.as_ref().filter(|s| s.site == site) }),
            ir::Expr::Field { base, .. } => in_expr(base, site),
            ir::Expr::Array(items) | ir::Expr::Builtin { args: items, .. } => items.iter().find_map(|e| in_expr(e, site)),
            ir::Expr::Object(fields) => fields.values().find_map(|e| in_expr(e, site)),
            ir::Expr::Binary { left, right, .. } => in_expr(left, site).or_else(|| in_expr(right, site)),
            ir::Expr::Unary { value, .. } => in_expr(value, site),
            _ => None,
        }
    }
    for stmt in stmts {
        let found = match stmt {
            ir::Stmt::For { domain: ir::LoopDomain::Page(scan), body, .. } => {
                if scan.site == site {
                    Some(scan)
                } else {
                    find_scan(body, site)
                }
            }
            ir::Stmt::For { body, .. } => find_scan(body, site),
            ir::Stmt::If { then_body, else_body, .. } => find_scan(then_body, site).or_else(|| find_scan(else_body, site)),
            ir::Stmt::Const { value, .. } | ir::Stmt::Let { value, .. } | ir::Stmt::Assign { value, .. } | ir::Stmt::Push { value, .. } | ir::Stmt::Return(value) => in_expr(value, site),
            _ => None,
        };
        if found.is_some() {
            return found;
        }
    }
    None
}

pub fn types(options: &Options) -> i32 {
    let project = project_or_exit();
    let bound = compile_or_exit(&project, options.json);
    match project.write_generated(&bound) {
        Ok(path) => {
            println!("types: {}", path.display());
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
        eprintln!("usage: snapback4 run <operation> [json-args] --as <persona> [--json]");
        return 2;
    };
    let project = project_or_exit();
    let bound = compile_or_exit(&project, options.json);
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
    let persona = options.flags.get("as").cloned().unwrap_or_else(|| "alice".into());
    let mut engine = match project.open_engine(&bound) {
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
    if program.kind == ProgramKind::Job {
        // A job runs as the system principal, every chunk in turn, here.
        return match engine.run_job(op, args, snapback4_core::now_ms()) {
            Ok(run) => {
                for line in engine.take_native_logs() {
                    eprintln!("native {line}");
                }
                let body = json!({ "job": run.name, "id": run.id, "state": run.state, "chunks": run.chunks, "rowsWritten": run.rows_written, "error": run.error });
                println!("{}", if options.json { body.to_string() } else { serde_json::to_string_pretty(&body).unwrap() });
                if run.state == snapback4_core::JobState::Done { 0 } else { 1 }
            }
            Err(error) => {
                eprintln!("{op}: {error}");
                1
            }
        };
    }
    let context = Context::new(persona_principal(&persona), args);
    if program.kind == ProgramKind::Query {
        match engine.query(op, context) {
            Ok(outcome) => {
                let body = json!({ "data": wire::to_json(&outcome.data), "complete": outcome.complete, "next": outcome.next, "metered": outcome.metered });
                println!("{}", if options.json { body.to_string() } else { serde_json::to_string_pretty(&body).unwrap() });
                0
            }
            Err(refusal) => {
                println!("{}", if options.json { json!({ "denied": refusal }).to_string() } else { format!("denied {refusal}") });
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
    let store = match project.open_store() {
        Ok(store) => store,
        Err(error) => {
            eprintln!("cannot open the store: {error}");
            return 2;
        }
    };
    let limit: usize = options.flags.get("limit").and_then(|s| s.parse().ok()).unwrap_or(50);
    match store.rows(table) {
        Ok(rows) => {
            let total = rows.len();
            for row in rows.iter().take(limit) {
                println!("{}", wire::to_json(row));
            }
            if total > limit {
                println!("… {} more (--limit {total})", total - limit);
            }
            0
        }
        Err(error) => {
            eprintln!("{error}");
            1
        }
    }
}

fn human_period(ms: u64) -> String {
    if ms % 86_400_000 == 0 { format!("{}d", ms / 86_400_000) } else if ms % 3_600_000 == 0 { format!("{}h", ms / 3_600_000) } else { format!("{}m", ms / 60_000) }
}

fn human(bytes: u64) -> String {
    match bytes {
        b if b >= 1 << 20 => format!("{:.1} MB", b as f64 / (1 << 20) as f64),
        b if b >= 1 << 10 => format!("{:.1} KB", b as f64 / (1 << 10) as f64),
        b => format!("{b} B"),
    }
}

pub fn doctor(options: &Options) -> i32 {
    let started = Instant::now();
    let mut lines = Vec::new();
    let mut ok = true;
    let mut storage: Option<snapback4_core::store::Sizes> = None;
    let version = env!("CARGO_PKG_VERSION");
    let Some(project) = std::env::current_dir().ok().and_then(|dir| Project::locate(&dir)) else {
        println!("snapback4 {version}: no project here (no snapback/schema.q); `snapback4 init` starts one");
        return 1;
    };
    lines.push(format!("project   {}", project.root.display()));
    let (personas, native_jobs) = match project.compile() {
        Ok(bound) if bound.diagnostics.is_empty() => {
            lines.push(format!("schema    ok: {} tables, {} synced, {} operations", bound.schema.tables.len(), bound.schema.synced().count(), bound.programs.len()));
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
        lines.push(format!("native    {} declared: {}; {built}; {toolchain}", if native_jobs.len() == 1 { "job" } else { "jobs" }, native_jobs.join(", ")));
    }
    // Source diagnostics and persisted backend health are independent. Even
    // broken or destructive edits must leave the active generation usable.
    match project.open_store() {
        Ok(store) => {
            let generation = store.meta("generation").ok().flatten().unwrap_or_else(|| "unrecorded".into());
            lines.push(format!("store     {} at seq {}, generation {}", project.store_path().display(), store.seq().unwrap_or(0), generation));
            if let Ok(sizes) = store.sizes() {
                storage = Some(sizes);
                lines.push(format!("storage   rows {} ({} rows) · indexes {} · log {} ({} events, {:.1}× rows) · ops {} · file {}", human(sizes.rows), sizes.row_count, human(sizes.indexes), human(sizes.log), sizes.log_events, sizes.amplification(), human(sizes.ops), human(sizes.file)));
            }
            match snapback4_core::Engine::open(store) {
                Ok(engine) => {
                    for schedule in &engine.schema().schedules {
                        let last = engine.store().meta(&format!("schedule:{}", schedule.name)).ok().flatten();
                        lines.push(format!("schedule  {} every {}{} → {}; {}", schedule.name, human_period(schedule.every_ms), if schedule.offset_ms > 0 { format!(" at {:02}:{:02}", schedule.offset_ms / 3_600_000, schedule.offset_ms % 3_600_000 / 60_000) } else { String::new() }, schedule.target, match last { Some(at) => format!("last boundary {at}"), None => "not yet started (a running server starts it)".into() }));
                    }
                    if let Ok(runs) = engine.jobs(5) {
                        for run in runs {
                            lines.push(format!("job       {} {} {:?}: {} chunk{}, {} row{}{}", run.name, run.id, run.state, run.chunks, if run.chunks == 1 { "" } else { "s" }, run.rows_written, if run.rows_written == 1 { "" } else { "s" }, run.error.map(|e| format!(" — {e}")).unwrap_or_default()));
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
    lines.push(format!("types     {}", if project.generated_dir().join("api.ts").is_file() { "generated" } else { "not generated yet (`snapback4 check` writes them)" }));
    if !personas.is_empty() {
        lines.push(format!("personas  {}", personas.join(", ")));
    }
    if options.json {
        println!("{}", json!({ "ok": ok, "lines": lines, "storage": storage, "ms": started.elapsed().as_millis() }));
    } else {
        println!("snapback4 {version}");
        for line in lines {
            println!("  {line}");
        }
        println!("  {} in {:.1} ms", if ok { "ok" } else { "not ok" }, started.elapsed().as_secs_f64() * 1000.0);
    }
    if ok { 0 } else { 1 }
}

pub fn init(options: &Options) -> i32 {
    let dir = options.positionals.first().map(Path::new).unwrap_or_else(|| Path::new("."));
    let schema = dir.join("snapback").join("schema.q");
    if schema.exists() {
        eprintln!("{} already exists", schema.display());
        return 1;
    }
    if let Err(error) = std::fs::create_dir_all(schema.parent().unwrap()) {
        eprintln!("cannot create {}: {error}", schema.display());
        return 2;
    }
    std::fs::write(&schema, snapback4_lang::guide::TEMPLATE).expect("write template");
    let gitignore = dir.join(".gitignore");
    let existing = std::fs::read_to_string(&gitignore).unwrap_or_default();
    if !existing.contains(".snapback4/") {
        let _ = std::fs::write(&gitignore, format!("{existing}{}{GITIGNORE}", if existing.is_empty() || existing.ends_with('\n') { "" } else { "\n" }));
    }
    println!("init: wrote {} — next: `snapback4 check`, then `snapback4 dev`", schema.display());
    0
}

pub fn why(options: &Options) -> i32 {
    let Some(subject) = options.positionals.first() else {
        eprintln!("usage: snapback4 why <E_CODE | operation | table>");
        return 2;
    };
    if let Some(explanation) = snapback4_lang::guide::explain_code(subject) {
        println!("{explanation}");
        return 0;
    }
    let project = project_or_exit();
    let bound = compile_or_exit(&project, options.json);
    if let Some(program) = bound.programs.iter().find(|p| &p.program.name == subject) {
        println!("{} {}({})", program.program.kind.word(), program.program.name, program.args.iter().map(|(name, ty)| format!("{name}: {}", ty.name())).collect::<Vec<_>>().join(", "));
        println!("  returns {}", program.result.name());
        println!("{}", cost_report(&bound, &program.program));
        return 0;
    }
    if let Some(table) = bound.schema.tables.get(subject) {
        println!("table {subject}");
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
        for (name, index) in &table.indexes {
            println!("  {} {name}: {}", if index.unique { "unique" } else { "by" }, index.columns().join(", "));
        }
        return 0;
    }
    if subject.starts_with("E_") || subject.starts_with("N_") {
        // A guessed code: name the real ones.
        eprintln!("{subject} is not a refusal code. A unique clash, a cap, an immutable column or a text format is E_CONSTRAINT; a program's own `require .. else CODE` codes are the program's. The codes: {}", snapback4_lang::guide::codes().join(", "));
        return 1;
    }
    eprintln!("nothing named {subject}: not a refusal code, an operation, or a table");
    1
}

/// `test`: run every argument-free query as each persona against the store
/// (optionally loaded from a fixture) and print the meters beside the
/// ceilings, so a builder reads numbers instead of being refused on a bound.
pub fn test(options: &Options) -> i32 {
    let project = project_or_exit();
    let bound = compile_or_exit(&project, options.json);
    // A fixture runs against a fresh store in memory, so every run reads
    // the fixture and nothing else; without one, the project's dev store.
    let mut engine = if options.flags.contains_key("fixture") {
        match snapback4_core::Engine::memory(bound.schema.clone(), bound.programs.iter().map(|p| p.program.clone())) {
            Ok(engine) => engine,
            Err(error) => {
                eprintln!("cannot open a store: {error}");
                return 2;
            }
        }
    } else {
        match project.open_engine(&bound) {
            Ok(engine) => engine,
            Err(error) => {
                eprintln!("cannot open the store: {error}");
                return 2;
            }
        }
    };
    if let Some(fixture) = options.flags.get("fixture") {
        let started = Instant::now();
        let mut loaded = 0;
        for entry in std::fs::read_dir(fixture).into_iter().flatten().flatten() {
            let name = entry.file_name().to_string_lossy().to_string();
            let Some(table) = name.strip_suffix(".jsonl") else { continue };
            let Some(definition) = bound.schema.tables.get(table).cloned() else { continue };
            let text = std::fs::read_to_string(entry.path()).unwrap_or_default();
            let mut rows = Vec::new();
            for line in text.lines().filter(|l| !l.trim().is_empty()) {
                let json: Json = match serde_json::from_str(line) {
                    Ok(json) => json,
                    Err(error) => {
                        eprintln!("{name}: {error}");
                        return 1;
                    }
                };
                match wire::row_from_json(&definition, &json) {
                    Ok(row) => rows.push((table.to_owned(), row)),
                    Err(why) => {
                        eprintln!("{name}: {why}");
                        return 1;
                    }
                }
            }
            match engine.load(rows) {
                Ok(count) => loaded += count,
                Err(error) => {
                    eprintln!("{name}: {error}");
                    return 1;
                }
            }
        }
        println!("test: loaded {loaded} rows from {fixture} in {:.1} s", started.elapsed().as_secs_f64());
    }
    let personas: Vec<String> = match options.flags.get("as") {
        Some(persona) => vec![persona.clone()],
        None if bound.personas.is_empty() => vec!["alice".into()],
        None => bound.personas.clone(),
    };
    let ceilings = engine.ceilings();
    let mut failures = 0;
    println!("test: {:<28} {:>8} {:>8} {:>8} {:>8} {:>10}", "operation (persona)", "examined", "entries", "probes", "steps", "output B");
    println!("      {:<28} {:>8} {:>8} {:>8} {:>8} {:>10}", "ceilings", ceilings.examined, ceilings.index_entries, ceilings.rule_probes, ceilings.steps, ceilings.output_bytes);
    let mut skipped = Vec::new();
    for program in &bound.programs {
        if program.program.kind != ProgramKind::Query {
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
                    println!("      {:<28} {:>8} {:>8} {:>8} {:>8} {:>10}  {state} in {:.1} ms{shown}", format!("{} ({persona})", program.program.name), m.examined, m.index_entries, m.rule_probes, m.steps, m.output_bytes, started.elapsed().as_secs_f64() * 1000.0);
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
        ir::ArgType::List { .. } => "a list".into(),
        ir::ArgType::Json { .. } => "json".into(),
        ir::ArgType::Bytes { .. } | ir::ArgType::Image { .. } | ir::ArgType::Video { .. } => "bytes".into(),
        other => format!("{other:?}").to_lowercase(),
    }
}


mod releases;
pub use releases::{deploy, rollback, serve_release};

/// The native module as a process: the same `Device` the Expo and Exact2
/// hosts link, speaking one JSON request per line on stdin and one answer
/// per line on stdout, so a JavaScript client can be tested end to end
/// against the real module without a native build, and a host without a
/// linker can still run it.
pub fn device(options: &Options) -> i32 {
    let Some(path) = options.positionals.first() else {
        eprintln!("usage: snapback4 device <store.sqlite> [backend.json]");
        return 2;
    };
    let backend = match options.positionals.get(1) {
        Some(file) => match std::fs::read_to_string(file).map_err(|e| e.to_string()).and_then(|text| serde_json::from_str::<snapback4_device::native::Backend>(&text).map_err(|e| e.to_string())) {
            Ok(backend) => Some(backend),
            Err(error) => {
                eprintln!("device: {file}: {error}");
                return 2;
            }
        },
        None => None,
    };
    let mut device = match snapback4_device::native::Device::open(Path::new(path), backend) {
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
        let answer = match serde_json::from_str::<Json>(&line) {
            Ok(request) => snapback4_device::ffi::call(&mut device, &request),
            Err(error) => json!({ "denied": { "code": "E_INPUT", "family": "input", "message": format!("the request is JSON: {error}") } }),
        };
        if writeln!(stdout, "{answer}").and_then(|()| stdout.flush()).is_err() {
            break;
        }
    }
    0
}

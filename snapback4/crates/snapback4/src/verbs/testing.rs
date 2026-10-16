//! Saved-source fixture selection, business cases and the query sweep.
// @ref LLP 3000.011.003.000.000#9-wave-13-saved-version-proofs-day3-2026-10-16 — contemporary fixtures belong to the selected saved source.
use super::*;

/// `test`: run every argument-free query as each persona against the store
/// (optionally loaded from a fixture) and print the meters beside the
/// ceilings, so a builder reads numbers instead of being refused on a bound.
pub fn test(options: &Options) -> i32 {
    let project = match proof_source::project(options, "source") { Ok(project) => project, Err(e) => { eprintln!("test: {e}"); return 2; } };
    let sources = match proof_source::sources(&project, options, "source") { Ok(sources) => sources, Err(e) => { eprintln!("test: {e}"); return 2; } };
    let bound = compiled_or_exit(proof_source::compile(&sources, options, "source"), options.json);
    let mut defaults = options.clone();
    if !defaults.flags.contains_key("fixture") {
        let saved = options.flags.get("source").map(std::path::Path::new).map(|path| {
            if path.is_dir() { path.join("fixtures") }
            else if path.file_name().is_some_and(|name| name == "schema.q") { path.parent().unwrap().join("fixtures") }
            else { path.with_file_name(format!("{}-fixtures", path.file_stem().unwrap_or_default().to_string_lossy())) }
        });
        if let Some(fixture) = saved.filter(|path| path.is_dir()) {
            eprintln!("test: using {} (saved version's contemporary fixtures; override with --fixture <dir>)", fixture.display());
            defaults.flags.insert("fixture".into(), fixture.to_string_lossy().into_owned());
        } else if project.root.join("fixtures").is_dir() {
            let fixture = project.root.join("fixtures");
            if options.flags.contains_key("source") {
                defaults.flags.insert("saved-fixture-fallback".into(), String::new());
                eprintln!("test: no contemporary fixtures for saved source; validating only declared-table files in {}; pass --fixture <dir> for a complete contemporary case suite", fixture.display());
                if fixture.join(test_cases::FILE).is_file() { eprintln!("test: skipped {} — working cases may target another release; pass --fixture <dir> to run explicitly", fixture.join(test_cases::FILE).display()); }
            } else { eprintln!("test: using {} (default fixture directory; override with --fixture <dir>)", fixture.display()); }
            defaults.flags.insert("fixture".into(), fixture.to_string_lossy().into_owned());
        } else if options.flags.contains_key("source") {
            eprintln!("test: no saved or working fixtures; query sweep only; pass --fixture <dir> for business cases");
        }
    }
    let options = &defaults;
    // test applies dev's cast: a persona dev would refuse is not run as an ordinary viewer.
    // Residency measures any principal in the data (scale fixtures name thousands), so it notes instead.
    if let Some(why) = options.flags.get("as").and_then(|names| names.split(',').find_map(|name| test_cases::undeclared_persona(name, &bound.personas))) {
        if !options.flags.contains_key("residency") {
            eprintln!("test --as: {why}");
            return 1;
        }
        eprintln!("test --residency --as: measuring an undeclared principal; dev would refuse it as a persona");
    }
    let _owner = if options.flags.contains_key("fixture") || options.flags.contains_key("source") { None } else {
        match crate::store_owner::command(&project.store_path()) {
            Ok(owner) => Some(owner),
            Err(error) => { eprintln!("{error}"); return 1; }
        }
    };
    let fixture_now = snapback4_core::now_ms();
    let opened = match &_owner {
        Some(owner) => owner.open_engine(&bound, std::time::Duration::from_secs(5), fixture_now).map_err(|e| e.to_string()),
        None => test_fixture::engine_at(&project, &bound, options, fixture_now),
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
    let (mut passed, mut failed_cases) = (0, 0);
    if let Some(fixture) = options.flags.get("fixture").filter(|_| !options.flags.contains_key("saved-fixture-fallback")) {
        match test_cases::run(&mut engine, &bound, fixture, &sources, fixture_now) {
            Ok((p, f)) => { passed = p; failed_cases = f; }
            Err(error) => { eprintln!("{error}"); return 1; }
        }
    }
    let ceilings = engine.ceilings();
    let mut failures = 0;
    println!("test: {:<28} {:>8} {:>8} {:>8} {:>8} {:>10} {:>10}", "operation (persona)", "examined", "entries", "probes", "steps", "heap B", "output B");
    println!("      {:<28} {:>8} {:>8} {:>8} {:>8} {:>10} {:>10}", "ceilings", ceilings.examined, ceilings.index_entries, ceilings.rule_probes, ceilings.steps, ceilings.heap_bytes, ceilings.output_bytes);
    let mut skipped = Vec::new();
    let mut held_not_run = 0;
    let mut near = Vec::new();
    let (mut complete, mut capped, mut refused_derived, mut expected) = (0usize, 0usize, 0usize, 0usize);
    let explicit = options.flags.get("fixture").filter(|_| !options.flags.contains_key("saved-fixture-fallback")).map(|fixture| test_cases::explicit(fixture, &bound, fixture_now)).unwrap_or_default();
    for program in &bound.programs {
        if program.program.kind != ProgramKind::Query {
            continue;
        }
        // @ref LLP 3000.007#18.1 — a server fixture is not the device's held partition.
        if bound.schema.operations.get(&program.program.name).is_some_and(|fact| fact.held) {
            println!("      not run: {} is held (device only)", program.program.name);
            held_not_run += 1;
            continue;
        }
        for persona in &personas {
            let principal = if persona.contains(':') { persona.clone() } else { persona_principal(persona) };
            let name = &program.program.name;
            let cases: Vec<&test_cases::Explicit> = explicit.iter().filter(|case| case.op == *name && case.principal == principal).collect();
            // Arguments: the persona's own case for this query when it has
            // one (the builder's choice, run as written); otherwise derived
            // from the data: a reference is a row of its table, preferring
            // one whose answer is not empty (the first row is often another
            // persona's, hidden), a principal is the persona, a text is the
            // shortest that fits. What cannot be derived is named, never
            // skipped silently.
            // @ref LLP 3000.036#15.2 — wave 7: derived arguments tested nothing when the first row was hidden from the persona.
            let mut candidates: Vec<(BTreeMap<String, snapback4_core::Value>, Option<&str>)> = Vec::new();
            if let Some(case) = cases.iter().find(|case| case.args.is_some()) {
                let decoded: Option<BTreeMap<_, _>> = case.args.as_ref().and_then(Json::as_object).and_then(|fields| fields.iter().map(|(arg, value)| {
                    let kind = program.program.args.get(arg)?;
                    wire::from_json(kind, value).ok().map(|value| (arg.clone(), value))
                }).collect());
                if let Some(args) = decoded { candidates.push((args, Some(case.at.as_str()))); }
            }
            let mut missing = Vec::new();
            if candidates.is_empty() {
                let rows = program.program.args.values().filter_map(|kind| match kind { ir::ArgType::Ref { table } => engine.store().rows(table).ok().map(|rows| rows.len()), _ => None }).max().unwrap_or(1).clamp(1, DERIVED_ROWS);
                for at in 0..rows {
                    let mut args = BTreeMap::new();
                    for (arg, kind) in &program.program.args {
                        match sample_arg(&engine, kind, &principal, at) {
                            Some(value) => { args.insert(arg.clone(), value); }
                            None if at == 0 => missing.push(format!("{arg}: {}", arg_word(kind))),
                            None => {}
                        }
                    }
                    if !missing.is_empty() { break; }
                    candidates.push((args, None));
                }
            }
            if !missing.is_empty() {
                skipped.push(format!("{name} ({persona}): needs {}", missing.join(", ")));
                continue;
            }
            // The first answer with rows wins; else the first answer; else the first refusal.
            let mut chosen: Option<(usize, BTreeMap<String, snapback4_core::Value>, Option<&str>, Result<snapback4_core::QueryOutcome, snapback4_core::Refusal>, f64)> = None;
            let tried = candidates.len();
            for (args, source) in candidates {
                let started = Instant::now();
                let result = engine.query(name, Context::new(principal.clone(), args.clone()).at(fixture_now));
                let ms = started.elapsed().as_secs_f64() * 1000.0;
                let rank = match &result { Ok(outcome) if !empty_answer(&outcome.data) => 0, Ok(_) => 1, Err(_) => 2 };
                if chosen.as_ref().is_none_or(|(best, ..)| rank < *best) { chosen = Some((rank, args, source, result, ms)); }
                if rank == 0 || source.is_some() { break; }
            }
            let Some((rank, args, source, result, ms)) = chosen else { continue };
            let shown = if args.is_empty() { String::new() } else { format!(" {}", serde_json::to_string(&args.iter().map(|(k, v)| (k.clone(), wire::to_json(v))).collect::<serde_json::Map<_, _>>()).unwrap_or_default()) };
            let arguments = shown.clone();
            let shown = match source { Some(at) => format!("{shown} (from {at})"), None => shown };
            let derived = !args.is_empty() && source.is_none();
            let label = format!("{name} ({persona})");
            match result {
                Ok(outcome) => {
                    let m = outcome.metered;
                    let state = if outcome.complete { "complete" } else { "capped" };
                    if outcome.complete { complete += 1 } else { capped += 1 }
                    // @ref LLP 3000.007#20.22.1 — report approach to a ceiling on the fixture, separately from actual cuts.
                    if outcome.capped_at.is_none() && outcome.word_cut_at.is_none() {
                        if let Some(cost) = crate::serve::read_cost::near_ceiling(m, ceilings) { near.push(format!("{label} {cost}")); }
                    }
                    let empty = if derived && rank == 1 && tried > 1 { format!(" — empty for each of {tried} derived rows: give it yours in {}", test_cases::FILE) } else { String::new() };
                    println!("      {label:<28} {:>8} {:>8} {:>8} {:>8} {:>10} {:>10}  {state} in {ms:.1} ms{shown}{empty}", m.examined, m.index_entries, m.rule_probes, m.steps, m.heap_bytes, m.output_bytes);
                }
                // A refusal the persona's own case expects is what the builder
                // asked for: say so instead of suggesting a case that exists.
                Err(refusal) if cases.iter().any(|case| case.expect.as_deref() == Some(refusal.code.as_str())) => {
                    expected += 1;
                    let at = cases.iter().find(|case| case.expect.as_deref() == Some(refusal.code.as_str())).map(|case| case.at.as_str()).unwrap_or_default();
                    println!("      {label:<28} refused {} as expected ({at}){}", refusal.code, if source == Some(at) { arguments } else { shown });
                }
                Err(refusal) if refusal.family == "rule" => {
                    // A program's own `require` refusing this persona is
                    // information, not a failure: the persona is not in that
                    // group. The caller chose nothing on this pass, whether
                    // the arguments were derived or there are none (wave 5
                    // lane 059: an argument-free gate counted as denied).
                    // @ref LLP 3000.036#15.2 — the derived pass never fails on the program's own require.
                    refused_derived += 1;
                    if let Some(at) = source {
                        println!("      {label:<28} refused {} on your arguments{shown} — the case at {at} runs below", refusal.code);
                    } else if derived {
                        let rows = if tried > 1 { format!(" (each of {tried} rows)") } else { String::new() };
                        println!("      {label:<28} refused {} on derived arguments{shown}{rows} — give it yours in {}: {{\"op\":\"{name}\",\"as\":\"{persona}\",\"args\":{{..}}}}", refusal.code, test_cases::FILE);
                    } else {
                        println!("      {label:<28} refused {} by its own require (not a failure: {persona} is not admitted) — pin it in {}: {{\"op\":\"{name}\",\"as\":\"{persona}\",\"expect\":\"{}\"}}", refusal.code, test_cases::FILE, refusal.code);
                    }
                }
                Err(refusal) => {
                    failures += 1;
                    println!("      {label:<28} denied {}: {}{shown}", refusal.code, refusal.message);
                }
            }
        }
    }
    for line in near.iter().take(10) { println!("near ceiling: {line}"); }
    if near.len() > 10 { println!("near ceiling: {} more query/persona reads passed half a ceiling without a cut", near.len() - 10); }
    for line in &skipped {
        println!("      not run: {line} — add a row of that table to the fixture, or a case in {}", test_cases::FILE);
    }
    // One line a script or an agent can read: derived refusals and unrun
    // queries are not failures, but they are not coverage either.
    let verdict = if failures > 0 || failed_cases > 0 { "FAIL" } else if !skipped.is_empty() || held_not_run > 0 { "incomplete" } else { "pass" };
    // @ref LLP 3000.036.002#9 — derived probe refusals are expected exploration, not failed cases.
    println!("test: {complete} complete, {capped} capped, {expected} refused as your cases expect, {refused_derived} probe refusals on derived arguments (expected), {} not run, {failures} denied{} — {verdict}",
        skipped.len() + held_not_run, if passed + failed_cases > 0 { format!("; cases: {passed} passed, {failed_cases} failed") } else if options.flags.contains_key("fixture") { format!("; no {} (see snapback4 guide testing)", test_cases::FILE) } else { String::new() });
    if failures > 0 || failed_cases > 0 { 1 } else { 0 }
}

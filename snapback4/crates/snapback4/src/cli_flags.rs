//! Validate the complete command before any project, store or host work.
const SWITCHES: &[&str] = &["help", "repack", "json", "json-objects", "trace-empty", "latency", "reset", "values", "no-watch", "fresh", "memory", "replay", "hold-effects", "hold-schedules", "resume-clock", "cost", "residency", "fix", "verbose", "online", "expo", "web", "allow-destructive", "restore-dormant", "allow-feed-adoption", "i-understand-cleartext", "skip-existing", "sections", "adapt", "full", "smoke", "prime", "relaunch", "restart", "wait"];

fn allowed(verb: &str) -> &'static str {
    match verb {
        "init" | "new" => "online expo web template recipe port web-port skip-existing adapt prefix authors edges public-profiles public-posts public-follows public-reposts",
        "check" => "cost residency fix json verbose store fixture as emit-lean url release",
        "types" => "json",
        "dev" => "port bind no-watch fresh memory replay hold-effects hold-schedules clock-offset resume-clock trace-empty verbose i-understand-cleartext long-waits long-waits-per-principal claim-waits",
        "deploy" => "restore-dormant allow-feed-adoption allow-destructive",
        "rollback" => "to allow-feed-adoption allow-destructive",
        "prune" => "allow-destructive json",
        "releases" => "after items-after event json",
        "serve" => "clock-offset resume-clock now replay port bind worker i-understand-cleartext long-waits long-waits-per-principal claim-waits",
        "run" => "as port now json",
        "clock" => "port release",
        "reset" => "port seed clock release",
        "test" => "fixture as residency verbose json",
        "why" => "release values json instance store",
        "guide" => "full sections section find",
        "data" => "limit json",
        "sql" => "release limit json json-objects",
        "token" => "service days release json",
        "doctor" => "url latency reset json instance release",
        "witness" => "as url token restart runs query args artifacts timeout json build export smoke udid port bundle-id segment prime relaunch wait repack",
        _ => "",
    }
}

pub fn validate(args: &[String]) -> Result<(), String> {
    let verb = args.first().map(String::as_str).unwrap_or("");
    // Pipe-owned private commands have positional protocols, not public flags.
    if matches!(verb, "--internal-witness-process" | "--internal-worker-watchdog") { return Ok(()); }
    let mut iter = args.iter().skip(1).peekable();
    while let Some(arg) = iter.next() {
        if arg == "--" { break; }
        if arg == "-h" { continue; }
        let Some(flag) = arg.strip_prefix("--") else {
            if arg.starts_with('-') && !arg[1..].starts_with(|c: char| c.is_ascii_digit()) {
                return Err(format!("E_INPUT: {verb} takes no {arg}"));
            }
            continue;
        };
        let (name, inline) = flag.split_once('=').map_or((flag, None), |(name, value)| (name, Some(value)));
        if name != "help" && !allowed(verb).split_whitespace().any(|known| known == name) {
            return Err(format!("E_INPUT: {verb} takes no --{name}"));
        }
        if SWITCHES.contains(&name) {
            if inline.is_some() { return Err(format!("E_INPUT: {verb} --{name} takes no value")); }
        } else if inline.is_none() {
            // Retired spellings route to their existing no-work explanation,
            // even with a missing value; new unknown flags still refuse here.
            if matches!(verb, "init" | "new") && matches!(name, "recipe" | "prefix" | "authors" | "edges" | "public-profiles" | "public-posts" | "public-follows" | "public-reposts") {
                if iter.peek().is_some_and(|value| !value.starts_with("--")) { iter.next(); }
                continue;
            }
            let Some(value) = iter.next() else { return Err(format!("E_INPUT: {verb} --{name} needs a value")); };
            // Search text is literal, including leading dashes and punctuation.
            if value.starts_with("--") && !matches!(name, "find" | "section") {
                return Err(format!("E_INPUT: {verb} --{name} needs a value"));
            }
        }
    }
    Ok(())
}

pub fn switch(name: &str) -> bool { SWITCHES.contains(&name) }

//! Validate the complete command before any project, store or host work.
const SWITCHES: &[&str] = &["list", "help", "initialize", "environment-skip", "background", "if-present", "check", "engine-info", "json", "json-objects", "trace-empty", "latency", "reset", "values", "no-watch", "fresh", "memory", "replay", "hold-effects", "hold-schedules", "resume-clock", "cost", "residency", "fix", "verbose", "online", "expo", "web", "allow-destructive", "restore-dormant", "allow-feed-adoption", "i-understand-cleartext", "skip-existing", "sections", "adapt", "dry-run", "apply", "full", "smoke", "prime", "relaunch", "restart", "wait"];

fn allowed(verb: &str) -> &'static str {
    match verb {
        "init" | "new" => "online expo web template recipe port port-range web-port skip-existing adapt dry-run apply prefix authors edges public-profiles public-posts public-follows public-reposts",
        "check" => "cost residency fix json verbose store fixture as emit-lean url release",
        "device" => "engine-info",
        "types" => "json",
        "dev" => "port bind no-watch fresh memory replay hold-effects hold-schedules clock-offset resume-clock trace-empty verbose i-understand-cleartext long-waits long-waits-per-principal claim-waits",
        "deploy" => "schema check verbose json restore-dormant allow-feed-adoption allow-destructive",
        "rollback" => "verbose json check to allow-feed-adoption allow-destructive",
        "prune" => "allow-destructive json",
        "releases" => "after items-after event json",
        "serve" => "clock-offset resume-clock now replay port bind worker i-understand-cleartext long-waits long-waits-per-principal claim-waits",
        "run" => "as port now json release token-env",
        "clock" => "port release",
        "reset" => "port seed clock release",
        "test" => "source fixture as residency verbose json",
        "why" => "verbose release values json instance store",
        "guide" => "list full sections section find",
        "data" => "release limit json",
        "sql" => "release limit json json-objects",
        "token" => "service days release json",
        "doctor" => "url latency reset json instance release",
        "upgrade" => "",
        "witness" => "email password-env mutation initialize environment-skip background if-present as url token restart runs query args artifacts timeout json build export smoke udid port bundle-id segment prime relaunch wait repack app-project field value button port-range",
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
                return Err(if verb == "witness" { "E_INPUT: witness has an invalid flag; see guide witness".into() } else { format!("E_INPUT: {verb} takes no {arg}") });
            }
            continue;
        };
        let (name, inline) = flag.split_once('=').map_or((flag, None), |(name, value)| (name, Some(value)));
        if name != "help" && !allowed(verb).split_whitespace().any(|known| known == name) {
            if verb == "rollback" && name == "dry-run" { return Err("E_INPUT: rollback preview is --check; use rollback <dir> [--to N|latest] --check".into()); }
            // Witness arguments may contain bearer material even in a flag name.
            return Err(if verb == "witness" { "E_INPUT: witness has an unknown flag; see guide witness".into() } else { format!("E_INPUT: {verb} takes no --{name}") });
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
            if verb == "witness" && matches!(name, "repack" | "app-project") {
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

#[cfg(test)]
mod integration_tests {
    use super::*;
    #[test]
    fn wave9_web_flags_and_upgrade_keep_shared_validation() {
        let args = ["witness", "web", "dist", "--url", "http://127.0.0.1", "--as", "alice", "--email", "alice@example.test", "--password-env", "PRIVATE_PASSWORD", "--mutation", "add", "--args", "{}", "--timeout", "30", "--export", "dist"].map(String::from);
        assert!(validate(&args).is_ok());
        for verb in ["upgrade", "witness"] {
            assert!(validate(&[verb.into(), "--unknown-wave9".into()]).is_err());
        }
        assert!(validate(&["upgrade".into(), "0.4.25".into()]).is_ok());
        assert!(validate(&["witness".into(), "web".into(), "--password-env".into()]).is_err());
    }
}

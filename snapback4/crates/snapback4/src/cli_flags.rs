//! Validate the complete command before any project, store or host work.
// @ref LLP 3000.000.000.000.000#4-cli-surface-contracts — admission, every synopsis and flag help share this command table.
use std::sync::OnceLock;
#[derive(serde::Deserialize)]
struct Flag { name: String, value: String, #[serde(default)] retired: bool }
#[derive(serde::Deserialize)]
struct Command { verb: String, positional: String, flags: Vec<Flag>, #[serde(skip)] allowed: String }
fn commands() -> &'static [Command] {
    static TABLE: OnceLock<Vec<Command>> = OnceLock::new();
    TABLE.get_or_init(|| {
        let mut commands: Vec<Command> = serde_json::from_str(include_str!("../../../packages/snapback4/bin/cli-commands.json")).expect("embedded command table");
        for command in &mut commands { command.allowed = command.flags.iter().map(|flag|flag.name.as_str()).collect::<Vec<_>>().join(" "); }
        commands
    })
}
fn command(verb: &str) -> Option<&'static Command> { commands().iter().find(|command|command.verb==verb) }
pub(crate) fn allowed(verb: &str) -> &'static str { command(verb).map_or("", |command| command.allowed.as_str()) }

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
        if switch(name) {
            if inline.is_some() { return Err(format!("E_INPUT: {verb} --{name} takes no value")); }
        } else if inline.is_none() {
            // Retired spellings route to their existing no-work explanation,
            // even with a missing value; new unknown flags still refuse here.
            if retired(verb,name) {
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
    let limit=match verb {"deploy"|"rollback"|"prune"|"stop"=>Some(1),"releases"|"promote"=>Some(2),_=>None};
    if limit.is_some_and(|limit|crate::verbs::parse(args).positionals.len()>limit) {
        return Err(format!("E_INPUT: {verb} has extra positional arguments; see `{verb} --help`"));
    }
    let has = |name: &str| args.iter().skip(1).any(|arg| arg == &format!("--{name}") || arg.starts_with(&format!("--{name}=")));
    if verb == "check" {
        if (has("proof-scaffold") || has("proof-draft")) && ["audit", "emit-lean", "release"].iter().any(|f| has(f)) { return Err("E_INPUT: proof drafts require a current project check, not --audit, --emit-lean or --release".into()); }
        if has("proof-scaffold") && has("proof-draft") { return Err("E_INPUT: choose --proof-draft or --proof-scaffold".into()); }
        if has("ack-security")!=has("reason"){return Err("E_INPUT: --ack-security ID requires --reason TEXT".into());}
        if has("ack-security")&&["ack-notes","fix","store","release","emit-lean","audit"].iter().any(|f|has(f)){return Err("E_INPUT: individual security review cannot combine with --ack-notes, --fix, saved-store/release, --emit-lean or --audit".into());}
        if has("release") && !has("store") { return Err("E_INPUT: check --release requires --store <path>".into()); }
        if has("as") && !has("residency") { return Err("E_INPUT: check --as requires --residency".into()); }
        let incompatible = if has("emit-lean") { Some(("--emit-lean", &["cost","residency","fix","verbose","store","fixture","as","release","ack-notes","audit"][..])) }
            else if has("release") { Some(("--store --release", &["cost","residency","fix","fixture","as","ack-notes"][..])) } else { None };
        if let Some((mode,flags)) = incompatible {
            if let Some(flag) = flags.iter().find(|flag|has(flag)) { return Err(format!("E_INPUT: check {mode} does not accept --{flag}")); }
        }
    }
    if verb == "serve" && has("wait-stopped") && args.iter().any(|arg|arg.starts_with("--") && !matches!(arg.as_str(),"--wait-stopped"|"--help")) {
        return Err("E_INPUT: serve --wait-stopped takes only a deployment directory; it does not start or signal a server".into());
    }
    if verb == "rollback" && has("bridge") && !has("check") { return Err("E_INPUT: rollback --bridge requires --check; it writes a bridge starter without activating it".into()); }
    if verb == "check" && has("audit") && ["cost","residency","fix","store","fixture","as","release","emit-lean","ack-notes"].iter().any(|f|has(f)) { return Err("E_INPUT: check --audit takes only --json or --verbose".into()); }
    if verb == "run" && has("token-env") && !has("release") { return Err("E_INPUT: run --token-env requires --release".into()); }
    if verb == "why" && has("instance") && crate::verbs::parse(args).positionals.first().map(String::as_str) != Some("recent") { return Err("E_INPUT: why --instance requires why recent".into()); }
    if verb == "token" && has("port") && has("release") { return Err("E_INPUT: token --port selects dev and cannot combine with --release".into()); }
    if verb == "token" && has("quiet") && has("json") { return Err("E_INPUT: token takes either --quiet or --json".into()); }
    Ok(())
}

fn retired(verb: &str, name: &str) -> bool {
    command(verb).is_some_and(|command|command.flags.iter().any(|flag|flag.name==name && flag.retired))
}
pub fn switch(name: &str) -> bool { name=="help" || commands().iter().flat_map(|command|&command.flags).any(|flag|flag.name==name && flag.value.is_empty()) }

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
        assert!(validate(&["upgrade".into(), "--to".into(), "0.4.25".into(), "--json".into()]).is_ok());
        assert!(validate(&["witness".into(), "web".into(), "--password-env".into()]).is_err());
    }
}

fn value(verb: &str, name: &str) -> String {
    command(verb).and_then(|command|command.flags.iter().find(|flag|flag.name==name)).filter(|flag|!flag.value.is_empty()).map(|flag|format!(" {}",flag.value)).unwrap_or_default()
}

/// Generated from the same flag table used before dispatch and side effects.
pub(crate) fn help(verb: &str) -> String {
    let mut out = String::from("Flags (validated before any project or store work):\n");
    for name in allowed(verb).split_whitespace().chain(["help"]) {
        let value = value(verb, name);
        let description = match (verb, name) {
            ("check", "proof-draft") => " — opt into a compact one-scenario proof draft (created once)",
            ("check", "proof-scaffold") => " — opt into exhaustive editable operation/role/guard proof drafts",
            ("check", "review") => " — show advisory decisions, witnesses and notes; gates always print",
            ("check", "ack-security") => " — repeat this flag or comma-separate decision IDs; all share --reason and record atomically",
            ("deploy", "schema") => " — deploy a saved complete source; keep it outside snapback/",
            ("deploy", "staging") => " — classify a new disposable deployment as staging; existing production stores refuse",
            ("dev", "unsafe-dev-doors") => " — explicitly open unauthenticated local fixture/clock/persona doors for password-only apps",
            ("test", "source") => " — test a saved complete source; keep it outside snapback/",
            ("doctor", "repair-expiry-orphan") => " — offline recovery of one physically missing expiring parent, table:id; stop its host and back up first (guide expire)",
            ("clock", "no-drain") => " — pause background maintenance for a mutation deadline test; clock drain resumes it",
            ("clock", "allow-held") => " — explicitly accept already processed future schedule boundaries",
            ("clock", "expire-sessions") => " — age staging sessions with business time (default: preserve remaining lifetime)",
            ("clock", "each-boundary") => " — fire every crossed schedule window in chronological order (default: latest window only)",
            (_, "help") => " — print this verb's help (-h also works)",
            _ if retired(verb,name) => " — retired spelling; the command explains its replacement before work",
            ("doctor", "instance") => " — inspect one dev instance's health and refusals",
            ("doctor", "url") => " — inspect the backend at this URL",
            ("doctor", "latency") => " — measure request and stream latency",
            ("doctor", "reset") => " — reset latency observations before measuring",
            ("witness", "password-env") => " — environment variable holding the sign-in password",
            ("witness", "background") => " — run the native witness in the background; inspect witness status",
            ("witness", "if-present") => " — skip an absent native witness installation",
            ("witness", "environment-skip") => " — report an unavailable native environment as skipped",
            ("witness", "initialize") => " — initialize the witness installation",
            ("witness", "wait") => " — wait for the background witness to finish",
            (_, "explain" | "verbose") if matches!(verb,"deploy"|"rollback"|"releases"|"data"|"test"|"serve") => " — show the complete output; default verdict names the private detail file",
            (_, "json") => " — print machine-readable JSON on stdout",
            ("upgrade", "quiet") => " — print only per-project actions; suppress successful install/check/history output",
            (_, "fixture-only") => " — allow zero business cases for fixture loading and query probes",
            (_, "bridge") => " — with --check, write current source and this app's rollback checklist into a new directory",
            (_, "save-version") => " — save deployed sources, contemporary fixtures and immutable release label in a new directory",
            (_, "quiet") => " — print only the bearer token, with no successful stderr output",
            (_, "list") => " — list available guide cards",
            (_, "full") => " — print the whole card up to 18000 bytes; larger cards explain the limit and list sections",
            ("guide", "generic") => " — guide api: SDK-only signatures instead of this app's usage",
            (_, "sections") => " — print the card's numbered section index",
            (_, "section") => " — select a heading, topic or section number",
            (_, "find") => " — search every word (a|b or a OR b matches either)",
            (_, "as") => " — select a persona or principal for the operation/proof",
            ("dev" | "serve", "port") => " — backend port (0 chooses a free port; A-B tries an inclusive range)",
            ("init" | "new", "port") => " — backend port, 1–65535 (frontend defaults to the next port)",
            (_, "port") => " — running backend port, 1–65535",
            (_, "port-range") => " — inclusive range for backend and frontend ports",
            (_, "web-port") => " — frontend port, overriding the next-port default",
            (_, "bind") => " — listening IP address (default 127.0.0.1)",
            (_, "i-understand-cleartext") => " — explicitly allow a non-loopback HTTP listener",
            ("serve", "trusted-proxy") => " — proxy IPs/CIDRs whose X-Forwarded-For names the client for sign-in rate limits (or SNAPBACK4_TRUSTED_PROXY)",
            (_, "worker") => " — production worker entry path",
            (_, "long-waits") => " — held viewer request capacity (default 1024, max 4096)",
            (_, "long-waits-per-principal") => " — held viewer requests per principal (default 16)",
            (_, "claim-waits") => " — held worker claim capacity (default 32, max 1024)",
            (_, "clock-offset") => " — start dev or a classified staging clock at an offset, for example +25h",
            (_, "resume-clock") => " — resume the persisted development store's clock",
            (_, "now") => " — pin a local run's clock (milliseconds or +duration)",
            (_, "clock") => " — reset the development clock with --clock reset",
            (_, "seed") => " — reseed from a fixture directory or rows.json in the reset transaction",
            (_, "release") => " — release directory (check --store instead selects N or latest)",
            ("sql", "dormant") => " — inspect retained dormant rows and cells; requires --release",
            ("sql", "all-releases") => " — inspect active and retained records together; requires --release",
            (_, "store-url") => " — Postgres URL with explicit schema and ha=none; overrides SNAPBACK4_STORE_URL; passwords here are visible in process arguments, so prefer the environment",
            (_, "worker-state-dir") => " — absolute durable directory for release workers' own state (not the database: store.sqlite and releases live in the deployment directory); or SNAPBACK4_WORKER_STATE_DIR",
            ("deploy" | "serve", "store") => " — alias an existing SQLite store into the deployment; conflicts with a store URL",
            (_, "store") => " — select the SQLite store path for inspection or adoption checking",
            (_, "fixture") => " — fixture directory containing table.jsonl rows and test.cases.jsonl",
            (_, "source") => " — saved complete Quarry source outside snapback/",
            (_, "service") => " — service seat name whose bearer session to mint",
            (_, "days") => " — service bearer lifetime in days (default 365)",
            (_, "token-env") => " — environment variable containing the service bearer",
            (_, "verbose") => " — include complete diagnostic and execution details",
            (_, "values") => " — include stored values in the inspection",
            (_, "instance") => " — select one development instance's records",
            ("data", "all") => " — inspect every active row in one read snapshot",
            (_, "limit") => " — maximum inspected rows (default 50)",
            (_, "json-objects") => " — JSON inspection envelope with rows as objects",
            (_, "url") => " — backend URL to inspect or exercise",
            (_, "template") => " — reference template: social, or chat with --web/--expo",
            (_, "online") => " — generate a server-only client without a device",
            (_, "web") => " — generate a Vite and React web starter",
            (_, "expo") => " — generate an Expo starter",
            (_, "skip-existing") => " — keep existing files and generate only missing ones",
            (_, "day2") => " — opt in to saved-release sources, fixtures and day2:proof",
            (_, "production") => " — preview identity and service-seat roster provisioning; --adapt required, --apply writes",
            (_, "adapt") => " — preview fitting unmodified starter files to the current schema",
            (_, "dry-run") => " — preview the scaffold or adaptation without writing files",
            (_, "apply") => " — apply the starter adaptation plan",
            (_, "ack-notes") => " — explicitly record reviewed compiler notes in snapback/check-notes.json",
            (_, "cost") => " — print read/write plans and scale summary",
            (_, "residency") => " — report device-held data, measured with --fixture and --as",
            (_, "fix") => " — apply safe mechanical source repairs",
            (_, "emit-lean") => " — emit one Quarry file as a Lean model case",
            (_, "engine-info") => " — print this binary's device engine identity",
            (_, "no-watch") => " — keep serving the starting schema; restart to adopt edits",
            (_, "fresh") | (_, "memory") => " — use a private temporary store for this dev process",
            (_, "replay") => " — suppress effects and hold schedules while replaying",
            (_, "hold-effects") => " — keep effects queued and unclaimed",
            (_, "hold-schedules") => " — admit no scheduled runs",
            (_, "trace-empty") => " — record unknown empty reads in why recent",
            (_, "check") => " — preview adoption without activating the release",
            (_, "restore-dormant") => " — explicitly restore dormant names during deploy or rollback",
            (_, "allow-feed-adoption") => " — explicitly admit changed feed definitions",
            (_, "allow-destructive") => " — explicitly authorize prune; never bypass adoption",
            (_, "to") => " — select a target release (or exact package version for upgrade)",
            (_, "after") => " — page history after this event id",
            (_, "items-after") => " — page storage inspection after this item key",
            (_, "event") => " — inspect this release-history event id",
            (_, "email") => " — password account email for the browser proof",
            (_, "password-env") => " — environment variable holding the password",
            (_, "mutation") => " — mutation whose sent receipt proves the browser form",
            (_, "token") => " — bearer session for acquisition proof; keep it secret",
            (_, "restart") => " — prove a retained cold restart after acquisition",
            (_, "runs") => " — number of acquisition proof repetitions",
            (_, "query") => " — query to exercise after acquisition",
            (_, "args") => " — JSON arguments for the query or mutation",
            (_, "artifacts") => " — output directory for witness evidence",
            (_, "timeout") => " — witness deadline in seconds (default 120)",
            (_, "build") => " — native app project to build for the iOS witness",
            (_, "export") => " — static web export directory to exercise",
            (_, "smoke") => " — run the native smoke proof",
            (_, "udid") => " — dedicated simulator device identifier",
            (_, "bundle-id") => " — installed iOS app bundle identifier",
            (_, "segment") => " — named installed-app witness segment",
            (_, "prime") => " — prime the installed app before the cold proof",
            (_, "relaunch") => " — relaunch the app for the installed proof",
            (_, "field") => " — accessible field label for browser form input",
            (_, "value") => " — value to enter in the labelled browser field",
            (_, "base") => " — absolute URL directory for the offline shell, for example / or /chat/",
            (_, "button") => " — accessible button label that submits the proof form",
            _ => " — command option",
        };
        out.push_str(&format!("  --{name}{value}{description}\n"));
    }
    out.trim_end().to_owned()
}

#[cfg(test)]
mod projection_tests {
    #[test]
    fn every_validated_flag_is_in_its_generated_help() {
        for verb in ["init","new","audit","check","device","types","dev","deploy","promote","rollback","prune","releases","serve","run","clock","seed","reset","test","why","guide","data","sql","token","doctor","upgrade","witness"] {
            let page = super::help(verb);
            for name in super::allowed(verb).split_whitespace() {
                assert!(page.lines().any(|line|line.trim_start().starts_with(&format!("--{name}"))),"{verb}: {name}");
                let args = if super::switch(name) { vec![verb.into(), format!("--{name}")] } else { vec![verb.into(), format!("--{name}"), "value".into()] };
                let mut args = args;
                if verb == "check" && name == "ack-security" { args.extend(["--reason".into(), "spec rationale".into()]); }
                if verb == "check" && name == "reason" { args.extend(["--ack-security".into(), "value".into()]); }
                if verb == "check" && name == "as" { args.push("--residency".into()); }
                if verb == "check" && name == "release" { args.extend(["--store".into(), "value".into()]); }
                if verb == "test" && name == "verbose" { args.push("--residency".into()); }
                if verb == "run" && name == "token-env" { args.extend(["--release".into(), "value".into()]); }
                if verb == "why" && name == "instance" { args.insert(1, "recent".into()); }
                if verb == "rollback" && name == "bridge" { args.push("--check".into()); }
                assert!(super::validate(&args).is_ok(),"{args:?}");
                if super::retired(verb,name) { assert!(page.lines().find(|line|line.trim_start().starts_with(&format!("--{name} "))).unwrap().contains("retired spelling")); }
            }
        }
    }
}

/// One synopsis for top-level help, per-verb help and usage errors. Flags come
/// directly from the admission table, including value arity and retired forms.
pub(crate) const VERBS: &[&str] = &["init","new","audit","check","device","types","dev","deploy","promote","rollback","prune","releases","serve","serve-check","day2-check","stop","run","clock","seed","reset","test","why","guide","data","sql","token","doctor","upgrade","witness","web-shell"];
pub(crate) fn synopsis(verb: &str) -> String {
    let positional = command(verb).map(|command|command.positional.as_str()).filter(|position|!position.is_empty()).map(|position|format!(" {position}")).unwrap_or_default();
    let mut out = format!("snapback4 {verb}{positional}");
    for name in allowed(verb).split_whitespace().filter(|name| !retired(verb,name)) {
        let value = value(verb, name);
        out.push_str(&format!(" [--{name}{value}]"));
    }
    out
}
pub(crate) fn top_help() -> String {
    let mut out = String::from("snapback4 — the scale-to-zero backend with a partition on every device\n\n");
    for verb in VERBS { out.push_str(&format!("  {}\n      {}\n", synopsis(verb), match *verb {
        "init"=>"Create a schema or a web/Expo starter; init --adapt fits an existing starter.",
        "new"=>"Create a full reference app: --template social, or chat with --web/--expo.",
        "audit"=>"Report security intent, conditional exposure paths and grant writers.",
        "check"=>"Compile the schema, check store adoption, write client types and report readiness.",
        "device"=>"Run the native device JSON protocol over stdin/stdout.", "types"=>"Compile and write generated client types.",
        "dev"=>"Serve a development backend; print its URL on stdout, readiness and refusals on stderr.",
        "promote"=>"Create a new production deployment from a stopped staging snapshot; preserves accounts/data/assets/releases and requires sign-in again.",
        "deploy"=>"Capture and activate an immutable release; running serve adopts it.", "rollback"=>"Preview or activate an existing release; selecting the already-live release is an idempotent no-op (no history or migration changes).",
        "prune"=>"Preview or explicitly remove dormant release storage.", "releases"=>"Inspect database-authoritative release history and storage.",
        "serve"=>"Serve the active production release; bearer sessions only, behind a TLS proxy.",
        "serve-check"=>"Check an npm serve script through the packaged Node CLI; keep credential stdout private.",
        "day2-check"=>"Check authored day-two proofs and production release stages in one ordered loop (npm wrapper).",
        "stop"=>"Gracefully stop the retained server that owns a deployment directory.",
        "run"=>"Run one operation or system job locally or against a serving backend.",
        "clock"=>"Advance the development clock, sweep expiry and run due jobs.", "reset"=>"Empty a development backend and optionally reseed it atomically.",
        "test"=>"Load fixtures, run cases and sweep queries as their personas; --residency: acquisition report only; add --verbose to run queries and print meters.", "why"=>"Explain a diagnostic, operation, table, work id or recent refusal.",
        "guide"=>"List cards or read a card/alias; --sections indexes it, --section selects one.",
        "data"=>"Inspect stored rows as an administrator; bypasses read rules.", "sql"=>"Read-only administrative SQL inspection; bypasses read rules.",
        "token"=>"Mint a service seat's bearer; --quiet is token-only, --json returns metadata.",
        "doctor"=>"Inspect backend health or latency; --json returns a machine-readable report.",
        "upgrade"=>"Upgrade core and installed adapters together; --to permits an explicit downgrade.",
        "witness"=>"Prove browser writes, device acquisition or installed iOS behavior.", "web-shell"=>"Install an offline shell for a static web export (npm wrapper).", _=>"",
    })); }
    out.push_str("  snapback4 --version\n\nsnapback4 <verb> --help explains each flag, output and exit codes.");
    out
}

#[cfg(test)]
mod surface_tests {
    use super::*;
    #[test]
    fn every_help_and_usage_projects_the_same_synopsis() {
        let top = top_help();
        assert_eq!(commands().iter().map(|command|command.verb.as_str()).collect::<Vec<_>>(), VERBS);
        for verb in VERBS {
            let synopsis = synopsis(verb);
            assert!(top.lines().any(|line| line.trim() == synopsis), "{verb}");
            assert_eq!(crate::verb_help::page(verb).unwrap().lines().next(), Some(synopsis.as_str()), "{verb}");
            let actual = synopsis.split("[--").skip(1).map(|part|part.split([' ',']']).next().unwrap()).collect::<Vec<_>>();
            let expected = allowed(verb).split_whitespace().filter(|flag| !retired(verb,flag)).collect::<Vec<_>>();
            assert_eq!(actual, expected, "{verb}");
        }
        assert!(synopsis("deploy").contains("[--schema file.q]"));
        assert!(synopsis("init").contains("[--port-range A-B]"));
        assert!(synopsis("upgrade").contains("[--to version]"));
    }
    #[test]
    fn ignored_flags_refuse_before_any_work() {
        for args in [vec!["check","--url","notaurl"],vec!["check","--release","1"],vec!["types","--json"],vec!["doctor","--instance","x"],vec!["run","x","--token-env","SECRET"],vec!["why","E_INPUT","--json"],vec!["why","E_INPUT","--instance","x"],vec!["reset","--release","x"],vec!["serve","x","--resume-clock"],vec!["serve","x","--now","1"],vec!["serve","x","--replay"]] {
            assert!(validate(&args.iter().map(|s|s.to_string()).collect::<Vec<_>>()).unwrap_err().starts_with("E_INPUT:"), "{args:?}");
        }
        assert!(validate(&["why","--instance","x","recent"].map(String::from)).is_ok());
        for mode in ["--json","--verbose","--explain"] {assert!(validate(&["test",mode].map(String::from)).is_ok());}
        for suffix in [vec!["--as","alice"], vec!["--emit-lean","source.q","--cost"],vec!["--emit-lean","source.q","--store","db"],vec!["--store","db","--release","1","--fix"],vec!["--store","db","--release","1","--fixture","fixtures"]] {
            let args=std::iter::once("check").chain(suffix).map(String::from).collect::<Vec<_>>();
            assert!(validate(&args).unwrap_err().starts_with("E_INPUT:"),"{args:?}");
        }
    }
}

#[cfg(test)]
mod surface_parser_tests {
    #[test]
    fn every_flag_round_trips_through_options_with_its_declared_arity() {
        for command in super::commands() {
            for flag in &command.flags {
                let mut args = vec![command.verb.clone(), format!("--{}", flag.name)];
                if !flag.value.is_empty() { args.push("surf4-value".into()); }
                let parsed = crate::verbs::parse(&args);
                if flag.name == "json" { assert!(parsed.json); continue; }
                assert_eq!(parsed.flags.get(&flag.name).map(String::as_str), Some(if flag.value.is_empty() { "" } else { "surf4-value" }), "{} --{}", command.verb, flag.name);
                assert!(parsed.positionals.is_empty(), "{} --{}", command.verb, flag.name);
                assert_eq!(super::switch(&flag.name), flag.value.is_empty(), "{} --{}", command.verb, flag.name);
            }
        }
    }
}

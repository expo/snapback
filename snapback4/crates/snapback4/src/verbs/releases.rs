//! Immutable source releases with a database-authoritative activation pointer.
use super::*;
use crate::store_owner::Owner;
use std::path::{Path, PathBuf};
use std::io::Write;

fn directory(options: &Options) -> Result<PathBuf, String> {
    options.positionals.first().map(PathBuf::from).ok_or_else(|| "a deployment directory is required".into())
}

/// `dev` and `serve` hold this advisory lock for their lifetime. Activation refuses
/// while it is held, so a successful deploy or rollback cannot leave a live
/// process advertising old IR over a store that has moved generations.
pub(crate) fn deployment_lock(dir: &Path) -> Result<Owner, String> {
    crate::store_owner::command(&dir.join("store.sqlite"))
}
fn current(dir: &Path, owner: &Owner) -> Result<Option<u64>, String> {
    let database = dir.join("store.sqlite");
    if database.exists() {
        let store = owner.open_store(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
        if let Some(release) = store.meta("release").map_err(|e| e.to_string())? {
            return release.parse().map(Some).map_err(|_| "invalid release identity in store".into());
        }
    }
    // Compatibility with deployments made before the database owned this
    // pointer. The next activation records it transactionally.
    match std::fs::read_to_string(dir.join("current")) {
        Ok(text) => text.trim().parse().map(Some).map_err(|_| "invalid current release file".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot read current release: {e}")),
    }
}
fn bound_at(root: PathBuf) -> Result<snapback4_lang::Bound, String> {
    let bound = Project { root }.compile().map_err(|e| e.to_string())?;
    if !bound.diagnostics.is_empty() { return Err(bound.diagnostics.iter().map(ToString::to_string).collect::<Vec<_>>().join("\n")); }
    Ok(bound)
}
fn check_change(dir: &Path, previous: Option<u64>, bound: &snapback4_lang::Bound, options: &Options) -> Result<(), String> {
    if let Some(n) = previous {
        let old = bound_at(dir.join("releases").join(n.to_string()))?;
        let steps = snapback4_core::successor::classify(&old.schema, &bound.schema);
        for step in &steps { println!("  {:?}: {}", step.change, step.message); }
        if snapback4_core::successor::worst(&steps) == snapback4_core::successor::Change::Destructive && !options.flags.contains_key("allow-destructive") {
            return Err("this activation loses data; pass --allow-destructive to confirm".into());
        }
    }
    Ok(())
}
fn activate(dir: &Path, owner: &Owner, release: u64, previous: Option<u64>, bound: snapback4_lang::Bound, rollback: bool, allow_feed_adoption: bool) -> Result<(), String> {
    let pointer = dir.join("current");
    // Check required filesystem writes before changing the database. A
    // later crash can leave this copy stale; current() reads the DB first.
    if pointer.exists() && !pointer.is_file() { return Err("current must be a regular release pointer file".into()); }
    let staged = dir.join(format!(".current-{}-{release}", std::process::id()));
    let mut file = std::fs::OpenOptions::new().create_new(true).write(true).open(&staged).map_err(|e| e.to_string())?;
    writeln!(file, "{release}").and_then(|_| file.sync_all()).map_err(|e| e.to_string())?;
    let result = (|| {
        let mut ledger = std::fs::OpenOptions::new().create(true).append(true).open(dir.join("releases.jsonl")).map_err(|e| e.to_string())?;
        let prepared = json!({"at": snapback4_core::now_ms(), "release": release, "previous": previous, "rollback": rollback, "state": "prepared"});
        writeln!(ledger, "{prepared}").and_then(|_| ledger.sync_all()).map_err(|e| e.to_string())?;
        let store = owner.open_store(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
        let engine = snapback4_core::Engine::new_release_with_feed_adoption(store, bound.schema, bound.programs.into_iter().map(|p| p.program), release, previous, allow_feed_adoption).map_err(|e| e.to_string())?;
        snapback4_core::diagnostic!("snapback4: release {release} adopted as generation {}{}", engine.generation(), engine.store().adoption_report.summary());
        std::fs::rename(&staged, &pointer).map_err(|e| format!("release {release} activated in the database, but current copy could not be updated: {e}"))?;
        let activated = json!({"at": snapback4_core::now_ms(), "release": release, "previous": previous, "rollback": rollback, "generation": engine.generation(), "state": "activated"});
        writeln!(ledger, "{activated}").and_then(|_| ledger.sync_all()).map_err(|e| format!("release activated, but ledger completion failed: {e}"))?;
        Ok(())
    })();
    if staged.exists() { std::fs::remove_file(&staged).map_err(|e| format!("cannot remove staged pointer: {e}"))?; }
    result
}
fn report(verb: &str, result: Result<(), String>) -> i32 {
    // @ref LLP 3000#contended-read-serving — release completion owns no engine/lease; bound the final diagnostic drain.
    // The background writer must get a chance to emit adoption estimates before
    // this short-lived command exits. Broken/stalled output cannot hold exit.
    let _ = snapback4_core::diagnostics::drain(std::time::Duration::from_secs(3));
    match result { Ok(()) => 0, Err(error) => { eprintln!("{verb}: {error}"); 1 } }
}

pub fn deploy(options: &Options) -> i32 {
    report("deploy", (|| {
        let dir = directory(options)?;
        snapback4_core::private_fs::directory(&dir).map_err(|e| e.to_string())?;
        let _deployment = deployment_lock(&dir)?;
        let project = project_or_exit();
        let bound = compile_or_exit(&project, options.json);
        std::fs::create_dir_all(dir.join("releases")).map_err(|e| e.to_string())?;
        let previous = current(&dir, &_deployment)?;
        check_change(&dir, previous, &bound, options)?;
        let sources = project.sources().map_err(|e| e.to_string())?;
        let releases = dir.join("releases");
        let mut n = std::fs::read_dir(&releases).map_err(|e| e.to_string())?.map(|e| e.map_err(|e| e.to_string())).collect::<Result<Vec<_>, _>>()?.iter().filter_map(|e| e.file_name().to_str()?.parse::<u64>().ok()).max().unwrap_or(0);
        let final_dir = loop {
            n = n.checked_add(1).ok_or("release identity exhausted")?;
            let path = releases.join(n.to_string());
            match std::fs::create_dir(&path) {
                Ok(()) => break path,
                Err(e) if e.kind() == std::io::ErrorKind::AlreadyExists => continue,
                Err(e) => return Err(e.to_string()),
            }
        };
        // Reserve the number forever, then atomically fill its empty
        // directory with a complete staged source tree.
        let stage = releases.join(format!(".stage-{n}-{}", std::process::id()));
        std::fs::create_dir(&stage).map_err(|e| e.to_string())?;
        std::fs::create_dir(stage.join("snapback")).map_err(|e| e.to_string())?;
        for (name, text) in sources {
            let path = stage.join("snapback").join(name);
            if let Some(parent) = path.parent() { std::fs::create_dir_all(parent).map_err(|e| e.to_string())?; }
            std::fs::write(path, text).map_err(|e| e.to_string())?;
        }
        // A native job's module is built from the project and travels with
        // the release beside its source (LLP 3000.005).
        if let Some(built) = crate::native::build(&project, &bound).map_err(|p| p.to_string())? {
            let generated = stage.join("snapback").join("generated");
            std::fs::create_dir_all(&generated).map_err(|e| e.to_string())?;
            std::fs::copy(&built.path, generated.join("native.wasm")).map_err(|e| e.to_string())?;
        }
        crate::dev_worker::package(&project, &stage)?;
        let staged_bound = bound_at(stage.clone())?;
        if staged_bound.schema != bound.schema { return Err("staged source does not match the compiled schema".into()); }
        std::fs::rename(&stage, &final_dir).map_err(|e| e.to_string())?;
        activate(&dir, &_deployment, n, previous, staged_bound, false, options.flags.contains_key("allow-feed-adoption"))?;
        println!("deploy: release {n} is current in {} — `snapback4 serve {}` runs it", dir.display(), dir.display());
        Ok(())
    })())
}

pub fn rollback(options: &Options) -> i32 {
    report("rollback", (|| {
        let dir = directory(options)?;
        let _deployment = deployment_lock(&dir)?;
        let active = current(&dir, &_deployment)?.ok_or("no current release")?;
        let previous = (1..active).rev().find(|n| dir.join("releases").join(n.to_string()).join("snapback/schema.q").is_file()).ok_or("nothing to roll back to")?;
        let bound = bound_at(dir.join("releases").join(previous.to_string()))?;
        check_change(&dir, Some(active), &bound, options)?;
        activate(&dir, &_deployment, previous, Some(active), bound, true, options.flags.contains_key("allow-feed-adoption"))?;
        println!("rollback: release {previous} is current (was {active})");
        Ok(())
    })())
}

pub fn serve_release(options: &Options) -> Result<(), String> {
    let requested_port = crate::port_flag::parse("serve", options.flags.get("port").map(String::as_str))?;
    let bind = release_bind(options)?;
    let capacity = crate::host_limits::Capacity::from_options(&options.flags, |name| std::env::var(name).ok())?;
    let dir = directory(options)?;
    crate::host_limits::initialize();
    snapback4_core::private_fs::directory(&dir).map_err(|e| e.to_string())?;
    let owner = crate::store_owner::host(&dir.join("store.sqlite"))?;
    let current = current(&dir, &owner)?.ok_or("no current release; deploy first")?;
    let release = Project { root: dir.join("releases").join(current.to_string()) };
    snapback4_core::private_fs::directory(&release.data_dir()).map_err(|e| e.to_string())?;
    let link = release.store_path();
    // @ref LLP 3000.008.004#4-operational-completeness-on-the-supported-target — a copied release must attach its own restored database and assets.
    // This generated link belongs to the selected release. Reconcile legacy
    // absolute links while holding the deployment lock, including dangling
    // ones; never follow or overwrite an unexpected regular store file.
    #[cfg(unix)]
    {
        let target = Path::new("../../../store.sqlite");
        match std::fs::symlink_metadata(&link) {
            Ok(metadata) => {
                if !metadata.file_type().is_symlink() {
                    return Err(format!("release store path must be a symbolic link: {}", link.display()));
                }
                if std::fs::read_link(&link).map_err(|e| e.to_string())? != target {
                    std::fs::remove_file(&link).map_err(|e| e.to_string())?;
                    std::os::unix::fs::symlink(target, &link).map_err(|e| e.to_string())?;
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                std::os::unix::fs::symlink(target, &link).map_err(|e| e.to_string())?;
            }
            Err(error) => return Err(error.to_string()),
        }
    }
    #[cfg(not(unix))]
    return Err("serving shared releases requires a filesystem supporting symbolic links".into());
    let (port, listener) = crate::port_flag::listen("serve", requested_port, bind, None)?;
    let worker = options.flags.get("worker").map(|path| Path::new(path).canonicalize().map_err(|e| format!("--worker {path}: {e}"))).transpose()?;
    crate::serve::serve(release, port, crate::serve::Mode::Release { expected: current, worker, owner: std::sync::Arc::new(owner) }, &bind.to_string(), listener, capacity)
}

pub(crate) fn release_bind(options: &Options) -> Result<std::net::IpAddr, String> {
    let bind = options.flags.get("bind").map(String::as_str).unwrap_or("127.0.0.1");
    let address: std::net::IpAddr = bind.parse().map_err(|_| "--bind must be a literal IPv4 or IPv6 address".to_owned())?;
    if !address.is_loopback() {
        if !options.flags.contains_key("i-understand-cleartext") {
            return Err("non-loopback HTTP sends passwords and bearer tokens in cleartext; use a loopback listener behind a TLS proxy, or explicitly pass --i-understand-cleartext".into());
        }
        eprintln!("WARNING: listening on {address} over CLEARTEXT HTTP. Passwords, bearer tokens, schema and data have no transport protection. Expose only through a TLS proxy on a trusted private hop; see snapback4/README.md.");
    }
    Ok(address)
}

#[cfg(test)]
mod tests {
    #[test]
    fn release_diagnostic_fixture() {
        let Ok(outcome) = std::env::var("SB4_RELEASE_DIAGNOSTIC_FIXTURE") else { return; };
        snapback4_core::diagnostics::set_thread_start(|| std::thread::sleep(std::time::Duration::from_millis(200)));
        snapback4_core::diagnostic!("release completion estimate");
        let failed = outcome == "failure";
        assert_eq!(super::report("deploy", if failed { Err("release fixture failure".into()) } else { Ok(()) }), i32::from(failed));
    }

    #[test]
    fn release_completion_drains_a_delayed_writer_on_success_and_failure() {
        for outcome in ["success", "failure"] {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args(["--exact", "verbs::releases::tests::release_diagnostic_fixture", "--nocapture"])
                .env("SB4_RELEASE_DIAGNOSTIC_FIXTURE", outcome).output().unwrap();
            assert!(output.status.success(), "{output:?}");
            let stderr = String::from_utf8_lossy(&output.stderr);
            assert!(stderr.contains("release completion estimate"), "{stderr}");
            if outcome == "failure" { assert!(stderr.contains("release fixture failure"), "{stderr}"); }
        }
    }

    #[test]
    fn serving_defaults_loopback_and_requires_cleartext_acknowledgement() {
        let parse = |args: &[&str]| super::parse(&args.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>());
        assert!(super::release_bind(&parse(&["serve", "release"])).unwrap().is_loopback());
        assert!(super::release_bind(&parse(&["serve", "release", "--bind", "0.0.0.0"])).is_err());
        assert!(super::release_bind(&parse(&["serve", "release", "--bind", "::"])).is_err());
        assert!(super::release_bind(&parse(&["serve", "release", "--bind", "localhost"])).is_err());
        let options = parse(&["serve", "--i-understand-cleartext", "release", "--bind", "0.0.0.0"]);
        assert_eq!(options.positionals, ["release"]);
        assert!(super::release_bind(&options).unwrap().is_unspecified());
    }
}

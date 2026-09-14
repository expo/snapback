//! Immutable source releases with a database-authoritative activation pointer.
use super::*;
use std::fs::File;
use std::path::{Path, PathBuf};
use std::io::Write;

fn directory(options: &Options) -> Result<PathBuf, String> {
    options.positionals.first().map(PathBuf::from).ok_or_else(|| "a deployment directory is required".into())
}

/// `serve` holds this advisory lock for its lifetime. Activation refuses
/// while it is held, so a successful deploy or rollback cannot leave a live
/// process advertising old IR over a store that has moved generations.
fn deployment_lock(dir: &Path) -> Result<File, String> {
    std::fs::create_dir_all(dir).map_err(|e| format!("cannot create deployment directory: {e}"))?;
    let file = std::fs::OpenOptions::new().create(true).read(true).write(true).open(dir.join("serve.lock")).map_err(|e| format!("cannot open deployment lock: {e}"))?;
    file.try_lock().map_err(|error| match error {
        std::fs::TryLockError::WouldBlock => {
            "this deployment is live; stop its `snapback4 serve` process before deploy or rollback".into()
        }
        std::fs::TryLockError::Error(error) => format!("cannot lock deployment: {error}"),
    })?;
    Ok(file)
}
fn current(dir: &Path) -> Result<Option<u64>, String> {
    let database = dir.join("store.sqlite");
    if database.exists() {
        let store = snapback4_core::Store::open(&database).map_err(|e| e.to_string())?;
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
fn activate(dir: &Path, release: u64, previous: Option<u64>, bound: snapback4_lang::Bound, rollback: bool) -> Result<(), String> {
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
        let store = snapback4_core::Store::open(&dir.join("store.sqlite")).map_err(|e| e.to_string())?;
        let engine = snapback4_core::Engine::new_release(store, bound.schema, bound.programs.into_iter().map(|p| p.program), release, previous).map_err(|e| e.to_string())?;
        std::fs::rename(&staged, &pointer).map_err(|e| format!("release {release} activated in the database, but current copy could not be updated: {e}"))?;
        let activated = json!({"at": snapback4_core::now_ms(), "release": release, "previous": previous, "rollback": rollback, "generation": engine.generation(), "state": "activated"});
        writeln!(ledger, "{activated}").and_then(|_| ledger.sync_all()).map_err(|e| format!("release activated, but ledger completion failed: {e}"))?;
        Ok(())
    })();
    if staged.exists() { std::fs::remove_file(&staged).map_err(|e| format!("cannot remove staged pointer: {e}"))?; }
    result
}
fn report(verb: &str, result: Result<(), String>) -> i32 {
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
        let previous = current(&dir)?;
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
        let staged_bound = bound_at(stage.clone())?;
        if staged_bound.schema != bound.schema { return Err("staged source does not match the compiled schema".into()); }
        std::fs::rename(&stage, &final_dir).map_err(|e| e.to_string())?;
        activate(&dir, n, previous, staged_bound, false)?;
        println!("deploy: release {n} is current in {} — `snapback4 serve {}` runs it", dir.display(), dir.display());
        Ok(())
    })())
}

pub fn rollback(options: &Options) -> i32 {
    report("rollback", (|| {
        let dir = directory(options)?;
        let _deployment = deployment_lock(&dir)?;
        let active = current(&dir)?.ok_or("no current release")?;
        let previous = (1..active).rev().find(|n| dir.join("releases").join(n.to_string()).join("snapback/schema.q").is_file()).ok_or("nothing to roll back to")?;
        let bound = bound_at(dir.join("releases").join(previous.to_string()))?;
        check_change(&dir, Some(active), &bound, options)?;
        activate(&dir, previous, Some(active), bound, true)?;
        println!("rollback: release {previous} is current (was {active})");
        Ok(())
    })())
}

pub fn serve_release(options: &Options) -> Result<(), String> {
    let bind = release_bind(options)?;
    let dir = directory(options)?;
    snapback4_core::private_fs::directory(&dir).map_err(|e| e.to_string())?;
    let _deployment = deployment_lock(&dir)?;
    let current = current(&dir)?.ok_or("no current release; deploy first")?;
    let release = Project { root: dir.join("releases").join(current.to_string()) };
    snapback4_core::private_fs::directory(&release.data_dir()).map_err(|e| e.to_string())?;
    let link = release.store_path();
    if !link.exists() {
        #[cfg(unix)]
        std::os::unix::fs::symlink(std::fs::canonicalize(&dir).map_err(|e| e.to_string())?.join("store.sqlite"), &link).map_err(|e| e.to_string())?;
        #[cfg(not(unix))]
        return Err("serving shared releases requires a filesystem supporting symbolic links".into());
    }
    let port = options.flags.get("port").and_then(|p| p.parse().ok()).unwrap_or(4400);
    crate::serve::serve(release, port, crate::serve::Mode::Release { expected: current }, &bind.to_string())
}

fn release_bind(options: &Options) -> Result<std::net::IpAddr, String> {
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

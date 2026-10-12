//! Immutable source releases with a database-authoritative activation pointer.
use super::*;
use crate::store_owner::Owner;
use std::path::{Path, PathBuf};

fn directory(options: &Options) -> Result<PathBuf, String> {
    options
        .positionals
        .first()
        .map(PathBuf::from)
        .ok_or_else(|| "a deployment directory is required".into())
}

/// `dev` and `serve` hold the store-owner lock for their lifetime. Release
/// commands route to the admitted server when it owns this deployment.
pub(crate) fn deployment_lock(dir: &Path) -> Result<Owner, String> {
    crate::store_owner::command(&dir.join("store.sqlite"))
}
fn current(dir: &Path, owner: &Owner) -> Result<Option<u64>, String> {
    let database = dir.join("store.sqlite");
    if database.exists() {
        let store = owner
            .open_store(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        if let Some(release) = store.meta("release").map_err(|e| e.to_string())? {
            return release
                .parse()
                .map(Some)
                .map_err(|_| "invalid release identity in store".into());
        }
    }
    // Compatibility with deployments made before the database owned this
    // pointer. The next activation records it transactionally.
    match std::fs::read_to_string(dir.join("current")) {
        Ok(text) => text
            .trim()
            .parse()
            .map(Some)
            .map_err(|_| "invalid current release file".into()),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(format!("cannot read current release: {e}")),
    }
}
pub(super) fn bound_at(root: PathBuf) -> Result<snapback4_lang::Bound, String> {
    let project = Project { root };
    if project.sources().map_err(|e| e.to_string())?.is_empty() {
        return Err("release has no Quarry source; select a complete immutable release".into());
    }
    let bound = project.compile().map_err(|e| e.to_string())?;
    if !bound.diagnostics.is_empty() {
        return Err(bound
            .diagnostics
            .iter()
            .map(ToString::to_string)
            .collect::<Vec<_>>()
            .join("\n"));
    }
    Ok(bound)
}
fn check_change(
    dir: &Path,
    previous: Option<u64>,
    bound: &snapback4_lang::Bound,
    options: &Options,
) -> Result<(), String> {
    if let Some(n) = previous {
        let old = bound_at(dir.join("releases").join(n.to_string()))?;
        for step in snapback4_core::successor::classify(&old.schema, &bound.schema) {
            let message = step
                .message
                .replace("its rows are lost", "its rows become dormant")
                .replace("its values are lost", "its values become dormant");
            if options.flags.contains_key("verbose") || options.flags.contains_key("check") { println!(
                "  {:?}: {message}",
                if step.change == snapback4_core::successor::Change::Destructive {
                    "Retained"
                } else {
                    "Checked"
                }
            ); }
        }
        let mut hazards=std::collections::BTreeSet::new();
        for step in snapback4_core::successor::classify(&bound.schema,&old.schema) {
            if step.change==snapback4_core::successor::Change::Narrowing && step.path.contains(".columns.") {
                hazards.insert(step.path.replace("tables.","").replace(".columns.","."));
            }
        }
        for (name,current) in &old.schema.tables {
            let Some(candidate)=bound.schema.table(name) else {continue};
            for constraint in &current.constraints {
                if let snapback4_core::schema::Constraint::Text{field,min,format}=constraint {
                    if !candidate.columns.contains_key(field) {continue;}
                    let wanted=candidate.constraints.iter().find_map(|c|match c {
                        snapback4_core::schema::Constraint::Text{field:f,min,format} if f==field =>Some((*min,*format)),_=>None,
                    }).unwrap_or((0,None));
                    if wanted.0<*min || format.is_some() && wanted.1!=*format {hazards.insert(format!("{name}.{field}"));}
                }
            }
        }
        for path in hazards {
            eprintln!("WARNING rollback compatibility: {path} admits values the other release refuses; those rows become dormant when switching back");
        }
    }
    if options.flags.contains_key("allow-destructive") {
        eprintln!(
            "deploy/rollback retain storage; --allow-destructive does not bypass validation or prune. To drop dormant storage: snapback4 prune {} --allow-destructive",
            dir.display()
        );
    }
    Ok(())
}

fn command_lock(dir: &Path) -> Result<std::fs::File, String> {
    #[cfg(unix)]
    {
        let file = snapback4_core::private_fs::auxiliary_file(
            &dir.join("store.sqlite"),
            &dir.join(".release-command"),
            true,
            0,
        )
        .map_err(|e| e.to_string())?;
        file.lock().map_err(|e| e.to_string())?;
        Ok(file)
    }
    #[cfg(not(unix))]
    Err("release commands require Unix".into())
}
fn target(dir: &Path) -> Result<Option<Owner>, String> {
    match deployment_lock(dir) {
        Ok(owner) => Ok(Some(owner)),
        Err(error) if error.contains("E_STORE_BUSY") => Ok(None),
        Err(error) => Err(error),
    }
}
fn status(
    dir: &Path,
    owner: Option<&Owner>,
    after: u64,
    items_after: Option<String>,
    event: Option<u64>,
) -> Result<serde_json::Value, String> {
    match owner {
        Some(owner) => owner
            .open_store(std::time::Duration::from_secs(5))
            .and_then(|mut s| s.release_status(after, items_after.as_deref(), event))
            .map_err(|e| e.to_string()),
        None => crate::release_control::request(
            dir,
            crate::release_control::Command::Status {
                after,
                items_after,
                event,
            },
        ),
    }
}
fn activate(
    dir: &Path,
    owner: Option<&Owner>,
    release: u64,
    previous: Option<u64>,
    revision: u64,
    bound: snapback4_lang::Bound,
    rollback: bool,
    restore_dormant: bool,
    allow_feed_adoption: bool,
    options: &Options,
) -> Result<(), String> {
    let root = dir.join("releases").join(release.to_string());
    let digest = crate::release_files::digest(&root)?;
    if let Some(owner) = owner {
        let project = Project { root };
        let prepared = crate::native::prepare(&project, &bound).map_err(|e| e.to_string())?;
        crate::dev_worker::prepare_release(&project, &bound.schema)?;
        crate::release_files::link_store(&project.root)?;
        crate::release_files::durable(&project.root)?;
        let mut pointer = crate::release_files::Pointer::prepare(dir, release, previous, rollback)?;
        let activation = snapback4_core::engine::release::ReleaseActivation {
            release,
            expected_previous: previous,
            expected_revision: Some(revision),
            restore_dormant,
            native_digest: prepared.installed.as_ref().map(|m| m.digest.clone()),
            operation: if rollback { "rollback" } else { "deploy" }.into(),
        };
        let store = owner
            .open_store(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        let engine = snapback4_core::Engine::new_release_prepared(
            store,
            bound.schema,
            bound.programs.into_iter().map(|p| p.program),
            &activation,
            allow_feed_adoption,
        )
        .map_err(|e| e.to_string())?;
        pointer.finish(engine.generation())?;
        receipt(release,engine.generation(),&engine.store().adoption_report,options);

    } else {
        let result = crate::release_control::request(
            dir,
            crate::release_control::Command::Activate {
                release,
                expected_release: previous,
                expected_revision: revision,
                digest,
                rollback,
                restore_dormant,
                allow_feed_adoption,
            },
        )?;
        if options.json {println!("{}",result);} else {
            println!("release {release} is current as generation {}; {}",result["generation"],result["adoption"].as_str().unwrap_or("adopted"));
            if options.flags.contains_key("verbose") {println!("{}",result["details"].as_str().unwrap_or(""));}
        }
    }
    Ok(())
}
fn report(verb: &str, result: Result<(), String>) -> i32 {
    // @ref LLP 3000#contended-read-serving — release completion owns no engine/lease; bound the final diagnostic drain.
    // The background writer must get a chance to emit adoption estimates before
    // this short-lived command exits. Broken/stalled output cannot hold exit.
    let _ = snapback4_core::diagnostics::drain(std::time::Duration::from_secs(3));
    match result {
        Ok(()) => 0,
        Err(error) => {
            eprintln!("{verb}: {error}");
            1
        }
    }
}

pub fn deploy(options: &Options) -> i32 {
    report(
        "deploy",
        (|| {
            let dir = directory(options)?;
            snapback4_core::private_fs::directory(&dir).map_err(|e| e.to_string())?;
            let _command = command_lock(&dir)?;
            let _deployment = target(&dir)?;
            let project = project_or_exit();
            let bound = compile_or_exit(&project, options.json);
            std::fs::create_dir_all(dir.join("releases")).map_err(|e| e.to_string())?;
            let held = status(&dir, _deployment.as_ref(), 0, None, None)?;
            let previous = if let Some(owner) = _deployment.as_ref() {
                current(&dir, owner)?
            } else {
                held["release"].as_u64()
            };
            let revision = held["revision"].as_u64().unwrap_or(0);
            check_change(&dir, previous, &bound, options)?;
            let sources = project.sources().map_err(|e| e.to_string())?;
            let releases = dir.join("releases");
            let stage = releases.join(format!(".stage-{}", std::process::id()));
            if stage.exists() {std::fs::remove_dir_all(&stage).map_err(|e|e.to_string())?;}
            std::fs::create_dir(&stage).map_err(|e| e.to_string())?;
            std::fs::create_dir(stage.join("snapback")).map_err(|e| e.to_string())?;
            for (name,text) in sources {
                let path=stage.join("snapback").join(name);
                if let Some(parent)=path.parent(){std::fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
                std::fs::write(path,text).map_err(|e|e.to_string())?;
            }
            // A native job's module is built from the project and travels with
            // the release beside its source (LLP 3000.005).
            if let Some(built) =
                crate::native::build(&project, &bound).map_err(|p| p.to_string())?
            {
                let generated = stage.join("snapback").join("generated");
                std::fs::create_dir_all(&generated).map_err(|e| e.to_string())?;
                std::fs::copy(&built.path, generated.join("native.wasm"))
                    .map_err(|e| e.to_string())?;
            }
            crate::dev_worker::package(&project, &stage)?;
            if let Some(previous)=previous {
                if held["release"].as_u64()==Some(previous) && crate::release_files::digest(&stage)?==crate::release_files::digest(&releases.join(previous.to_string()))? {
                    std::fs::remove_dir_all(&stage).map_err(|e|e.to_string())?;
                    if options.json {println!("{}",serde_json::json!({"unchanged":true,"release":previous,"generation":held["generation"]}));}
                    else {println!("unchanged; release {previous} stays current as generation {}",held["generation"]);}
                    return Ok(());
                }
            }
            let mut n=std::fs::read_dir(&releases).map_err(|e|e.to_string())?.filter_map(Result::ok).filter_map(|e|e.file_name().to_str()?.parse::<u64>().ok()).max().unwrap_or(0);
            let final_dir=loop {
                n=n.checked_add(1).ok_or("release identity exhausted")?;
                let path=releases.join(n.to_string());
                match std::fs::create_dir(&path) {Ok(())=>break path,Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists=>continue,Err(e)=>return Err(e.to_string())}
            };
            let staged_bound = bound_at(stage.clone())?;
            if staged_bound.schema != bound.schema {
                return Err("staged source does not match the compiled schema".into());
            }
            crate::release_files::durable(&stage)?;
            std::fs::rename(&stage, &final_dir).map_err(|e| e.to_string())?;
            std::fs::File::open(&releases)
                .and_then(|f| f.sync_all())
                .map_err(|e| e.to_string())?;
            activate(
                &dir,
                _deployment.as_ref(),
                n,
                previous,
                revision,
                staged_bound,
                false,
                options.flags.contains_key("restore-dormant"),
                options.flags.contains_key("allow-feed-adoption"),
                options,
            )?;

            Ok(())
        })(),
    )
}

pub fn rollback(options: &Options) -> i32 {
    report(
        "rollback",
        (|| {
            let dir = directory(options)?;
            let _command = command_lock(&dir)?;
            let _deployment = target(&dir)?;
            let held = status(&dir, _deployment.as_ref(), 0, None, None)?;
            let active = if let Some(owner) = _deployment.as_ref() {
                current(&dir, owner)?
            } else {
                held["release"].as_u64()
            }
            .ok_or("no current release")?;
            let revision = held["revision"].as_u64().unwrap_or(0);
            let selected = options
                .flags
                .get("to")
                .map(|n| {
                    if n=="latest" {return latest(&dir).map_err(|_| "no complete latest release");}
                    n.parse::<u64>()
                        .ok()
                        .filter(|n| *n > 0)
                        .ok_or("--to requires a positive immutable release id")
                })
                .transpose()?;
            let previous = selected
                .or_else(|| {
                    (1..active).rev().find(|n| {
                        dir.join("releases")
                            .join(n.to_string())
                            .join("snapback/schema.q")
                            .is_file()
                    })
                })
                .ok_or("nothing to roll back to")?;
            let bound = bound_at(dir.join("releases").join(previous.to_string()))?;
            check_change(&dir, Some(active), &bound, options)?;
            if options.flags.contains_key("check") {
                return super::release_preview::preview(&dir.join("store.sqlite"),dir.join("releases").join(previous.to_string()),previous,options);
            }
            activate(
                &dir,
                _deployment.as_ref(),
                previous,
                Some(active),
                revision,
                bound,
                true,
                true,
                options.flags.contains_key("allow-feed-adoption"),
                options,
            )?;

            Ok(())
        })(),
    )
}

pub fn releases(options: &Options) -> i32 {
    report(
        "releases",
        (|| {
            let dir = directory(options)?;
            let after = options
                .flags
                .get("after")
                .map(|s| s.parse::<u64>().map_err(|_| "--after requires an event id"))
                .transpose()?
                .unwrap_or(0);
            let event = options
                .flags
                .get("event")
                .map(|s| s.parse::<u64>().map_err(|_| "--event requires an event id"))
                .transpose()?;
            // Read-only inspection needs no ownership handoff or source adoption.
            let mut store = snapback4_core::Store::open_read_only(&dir.join("store.sqlite"))
                .map_err(|e| e.to_string())?;
            let mut result = store
                .release_status(
                    after,
                    options.flags.get("items-after").map(String::as_str),
                    event,
                )
                .map_err(|e| e.to_string())?;
            result["latest"]=serde_json::json!(latest(&dir).ok());
            println!("{}", serde_json::to_string_pretty(&result).unwrap());
            Ok(())
        })(),
    )
}

pub fn prune(options: &Options) -> i32 {
    report(
        "prune",
        (|| {
            let dir = directory(options)?;
            let _command = command_lock(&dir)?;
            let owner = target(&dir)?;
            let held = status(&dir, owner.as_ref(), 0, None, None)?;
            let revision = held["revision"].as_u64().unwrap_or(0);
            let confirm = options.flags.contains_key("allow-destructive");
            let result = match owner.as_ref() {
                Some(owner) => owner
                    .open_store(std::time::Duration::from_secs(5))
                    .and_then(|mut s| s.prune_dormant(confirm, Some(revision)))
                    .map_err(|e| e.to_string())?,
                None => crate::release_control::request(
                    &dir,
                    crate::release_control::Command::Prune {
                        confirm,
                        expected_revision: revision,
                    },
                )?,
            };
            println!("{}", serde_json::to_string_pretty(&result).unwrap());
            // Live responses are bounded. Enumerate the committed audit set (or
            // current preview) to name every item, never silently omit a drop.
            if owner.is_none() {
                let mut after = result["items_after"].as_str().map(str::to_owned);
                while let Some(key) = after {
                    let page = status(&dir, None, 0, Some(key), result["event"].as_u64())?;
                    let items = page["items"].as_array().ok_or("invalid inventory reply")?;
                    if items.is_empty() {
                        break;
                    }
                    println!("{}", serde_json::to_string_pretty(items).unwrap());
                    after = page["items_after"].as_str().map(str::to_owned);
                }
            }
            if !confirm {
                println!(
                    "preview only; to permanently drop this dormant storage: snapback4 prune {} --allow-destructive",
                    dir.display()
                );
            }
            Ok(())
        })(),
    )
}

pub fn serve_release(options: &Options) -> Result<(), String> {
    let requested_port = crate::port_flag::parse("serve", options.flags.get("port").map(String::as_str))?;
    let bind = release_bind(options)?;
    let capacity = crate::host_limits::Capacity::from_options(&options.flags, |name| {
        std::env::var(name).ok()
    })?;
    let dir = directory(options)?;
    crate::host_limits::initialize();
    snapback4_core::private_fs::directory(&dir).map_err(|e| e.to_string())?;
    let owner = crate::store_owner::host(&dir.join("store.sqlite"))?;
    let current = current(&dir, &owner)?.ok_or("no current release; deploy first")?;
    let release = Project {
        root: dir.join("releases").join(current.to_string()),
    };
    crate::release_files::link_store(&release.root)?;
    let (port, listener) = crate::port_flag::listen("serve", requested_port, bind, None)?;
    let worker = options
        .flags
        .get("worker")
        .map(|path| {
            Path::new(path)
                .canonicalize()
                .map_err(|e| format!("--worker {path}: {e}"))
        })
        .transpose()?;
    crate::serve::serve(
        release,
        port,
        crate::serve::Mode::Release {
            expected: current,
            worker,
            owner: std::sync::Arc::new(owner),
        },
        &bind.to_string(),
        listener,
        capacity,
    )
}

pub(crate) fn release_bind(options: &Options) -> Result<std::net::IpAddr, String> {
    let bind = options
        .flags
        .get("bind")
        .map(String::as_str)
        .unwrap_or("127.0.0.1");
    let address: std::net::IpAddr = bind
        .parse()
        .map_err(|_| "--bind must be a literal IPv4 or IPv6 address".to_owned())?;
    if !address.is_loopback() {
        if !options.flags.contains_key("i-understand-cleartext") {
            return Err("non-loopback HTTP sends passwords and bearer tokens in cleartext; use a loopback listener behind a TLS proxy, or explicitly pass --i-understand-cleartext".into());
        }
        eprintln!(
            "WARNING: listening on {address} over CLEARTEXT HTTP. Passwords, bearer tokens, schema and data have no transport protection. Expose only through a TLS proxy on a trusted private hop; see snapback4/README.md."
        );
    }
    Ok(address)
}

#[cfg(test)]
mod tests {
    #[test]
    fn release_diagnostic_fixture() {
        let Ok(outcome) = std::env::var("SB4_RELEASE_DIAGNOSTIC_FIXTURE") else {
            return;
        };
        snapback4_core::diagnostics::set_thread_start(|| {
            std::thread::sleep(std::time::Duration::from_millis(200))
        });
        snapback4_core::diagnostic!("release completion estimate");
        let failed = outcome == "failure";
        assert_eq!(
            super::report(
                "deploy",
                if failed {
                    Err("release fixture failure".into())
                } else {
                    Ok(())
                }
            ),
            i32::from(failed)
        );
    }

    #[test]
    fn release_completion_drains_a_delayed_writer_on_success_and_failure() {
        for outcome in ["success", "failure"] {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--exact",
                    "verbs::releases::tests::release_diagnostic_fixture",
                    "--nocapture",
                ])
                .env("SB4_RELEASE_DIAGNOSTIC_FIXTURE", outcome)
                .output()
                .unwrap();
            assert!(output.status.success(), "{output:?}");
            let stderr = String::from_utf8_lossy(&output.stderr);
            assert!(stderr.contains("release completion estimate"), "{stderr}");
            if outcome == "failure" {
                assert!(stderr.contains("release fixture failure"), "{stderr}");
            }
        }
    }

    #[test]
    fn serving_defaults_loopback_and_requires_cleartext_acknowledgement() {
        let parse =
            |args: &[&str]| super::parse(&args.iter().map(|s| (*s).to_owned()).collect::<Vec<_>>());
        assert!(
            super::release_bind(&parse(&["serve", "release"]))
                .unwrap()
                .is_loopback()
        );
        assert!(super::release_bind(&parse(&["serve", "release", "--bind", "0.0.0.0"])).is_err());
        assert!(super::release_bind(&parse(&["serve", "release", "--bind", "::"])).is_err());
        assert!(super::release_bind(&parse(&["serve", "release", "--bind", "localhost"])).is_err());
        let options = parse(&[
            "serve",
            "--i-understand-cleartext",
            "release",
            "--bind",
            "0.0.0.0",
        ]);
        assert_eq!(options.positionals, ["release"]);
        assert!(super::release_bind(&options).unwrap().is_unspecified());
    }
}

fn receipt(release:u64,generation:u64,report:&snapback4_core::store::adoption_report::AdoptionReport,options:&Options){
    if options.json {println!("{}",serde_json::json!({"release":release,"generation":generation,"adoption":report.compact(),"details":report.summary()}));}
    else {println!("release {release} is current as generation {generation}; {}",report.compact());if options.flags.contains_key("verbose"){println!("{}",report.summary());}}
}
fn latest(dir:&Path)->Result<u64,String>{
    std::fs::read_dir(dir.join("releases")).map_err(|e|e.to_string())?.filter_map(Result::ok)
        .filter_map(|e|e.file_name().to_str()?.parse::<u64>().ok().filter(|_|bound_at(e.path()).is_ok()))
        .max().ok_or("no complete immutable releases".into())
}
pub(super) fn check_release(options:&Options)->i32 {
    report("check",(|| {
        let store=PathBuf::from(options.flags.get("store").ok_or("--store required")?);
        let dir=store.parent().ok_or("store has no deployment directory")?;
        let selected=options.flags.get("release").ok_or("--release required")?;
        let n=if selected=="latest"{latest(dir)?}else{selected.parse::<u64>().ok().filter(|n|*n>0).ok_or("--release requires N or latest")?};
        super::release_preview::preview(&store,dir.join("releases").join(n.to_string()),n,options)
    })())
}

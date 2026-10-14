//! Immutable source releases with a database-authoritative activation pointer.
use super::*;
use crate::store_owner::Owner;
use std::path::{Path, PathBuf};
struct Stage(PathBuf);
impl Drop for Stage {fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}

fn directory(options: &Options) -> Result<PathBuf, String> {
    options
        .positionals
        .first()
        .map(PathBuf::from)
        .ok_or_else(|| "a deployment directory is required".into())
}

// @ref LLP 3000.000.000#5.1 — deployment aliases share ownership, control and worker paths.
fn canonical_directory(options: &Options) -> Result<PathBuf, String> {
    let requested = directory(options)?;
    if !requested.exists() {
        snapback4_core::private_fs::directory(&requested).map_err(|e| e.to_string())?;
    }
    let dir = requested.canonicalize().map_err(|e| e.to_string())?;
    snapback4_core::private_fs::directory(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
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
    target_release: Option<u64>,
) -> Result<(), String> {
    if !options.flags.contains_key("check") && let Some(n) = previous {
        let old = bound_at(dir.join("releases").join(n.to_string()))?;
        let store = snapback4_core::Store::open_read_only(&dir.join("store.sqlite")).map_err(|e| e.to_string())?;
        let target_label = target_release.map(|n| format!("release {n}")).unwrap_or_else(|| "the new release".into());
        let lines = super::release_narration::compatibility(&store, &old.schema, &bound.schema, n, &target_label, target_release.is_none())?;
        for line in lines {
            eprintln!("{line}");
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
            println!("release {release} is current as generation {}; {}; running serve adopted the release",result["generation"],result["adoption"].as_str().unwrap_or("adopted"));
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
            let dir = canonical_directory(options)?;
            let _command = command_lock(&dir)?;
            let checking=options.flags.contains_key("check");
            let _deployment = if checking {None} else {target(&dir)?};
            if let Some(owner) = &_deployment { owner.report_reclaim(options.flags.contains_key("verbose")); }
            let project = super::proof_source::project(options, "schema")?;
            let sources = super::proof_source::sources(&project, options, "schema")?;
            let bound = compiled_or_exit(super::proof_source::compile(&sources, options, "schema"), options.json);
            std::fs::create_dir_all(dir.join("releases")).map_err(|e| e.to_string())?;
            let held = if checking {
                if dir.join("store.sqlite").exists() {snapback4_core::Store::open_read_only(&dir.join("store.sqlite")).and_then(|mut s|s.release_status(0,None,None)).map_err(|e|e.to_string())?}
                else {serde_json::json!({"release":null,"revision":0,"generation":1})}
            } else {status(&dir, _deployment.as_ref(), 0, None, None)?};
            let previous = if let Some(owner) = _deployment.as_ref() {
                current(&dir, owner)?
            } else {
                held["release"].as_u64()
            };
            let revision = held["revision"].as_u64().unwrap_or(0);
            check_change(&dir, previous, &bound, options, None)?;
            let releases = dir.join("releases").canonicalize().map_err(|e| e.to_string())?;
            let stage = releases.join(format!(".stage-{}", std::process::id()));
            if stage.exists() {std::fs::remove_dir_all(&stage).map_err(|e|e.to_string())?;}
            std::fs::create_dir(&stage).map_err(|e| e.to_string())?;
            let _cleanup=Stage(stage.clone());
            std::fs::create_dir(stage.join("snapback")).map_err(|e| e.to_string())?;
            for (name,text) in sources {
                let path=stage.join("snapback").join(name);
                if let Some(parent)=path.parent(){std::fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
                std::fs::write(path,text).map_err(|e|e.to_string())?;
            }
            crate::dev_worker::package(&project, &stage)?;
            // @ref LLP 3000.011.003.000.000#2 — saved schemas prepare companion types in a private snapshot, never in working generated/.
            let private = if options.flags.contains_key("schema") {
                Some(super::proof_source::Candidate::prepare(&project, &stage, &bound)?)
            } else { None };
            let build_project = private.as_ref().map(|candidate| &candidate.project).unwrap_or(&project);
            // A native job's module travels with the captured source.
            if let Some(built) =
                crate::native::build(build_project, &bound).map_err(|p| p.to_string())?
            {
                let generated = stage.join("snapback").join("generated");
                std::fs::create_dir_all(&generated).map_err(|e| e.to_string())?;
                std::fs::copy(&built.path, generated.join("native.wasm"))
                    .map_err(|e| e.to_string())?;
            }
            std::fs::write(stage.join("device-compatibility.json"), serde_json::to_vec_pretty(&snapback4_core::device_protocol::compatibility(&bound.schema.public_projection())).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
            if private.is_some() && project.server_source().is_some() {
                let source = build_project.server_source().ok_or("saved-source server snapshot is absent")?;
                std::fs::copy(&source, stage.join("snapback").join(source.file_name().unwrap())).map_err(|e| e.to_string())?;
                let generated = stage.join("snapback/generated");
                std::fs::create_dir_all(&generated).map_err(|e| e.to_string())?;
                for name in ["api.ts", "server.ts", "package.json"] {
                    std::fs::copy(build_project.generated_dir().join(name), generated.join(name)).map_err(|e| e.to_string())?;
                }
            }
            if let Some(previous)=previous {
                if held["release"].as_u64()==Some(previous) && crate::release_files::digest(&stage)?==crate::release_files::digest(&releases.join(previous.to_string()))? {
                    std::fs::remove_dir_all(&stage).map_err(|e|e.to_string())?;
                    if options.json {println!("{}",serde_json::json!({"unchanged":true,"release":previous,"generation":held["generation"]}));}
                    else {println!("unchanged; release {previous} stays current as generation {}",held["generation"]);}
                    return Ok(());
                }
            }
            let mut n=std::fs::read_dir(&releases).map_err(|e|e.to_string())?.filter_map(Result::ok).filter_map(|e|e.file_name().to_str()?.parse::<u64>().ok()).max().unwrap_or(0);
            let staged_bound = bound_at(stage.clone())?;
            if options.flags.contains_key("check") {
                let mut preview_options=options.clone();preview_options.flags.insert("deploy-direction".into(),String::new());
                let result=super::release_preview::preview(&dir.join("store.sqlite"),stage.clone(),n.checked_add(1).ok_or("release identity exhausted")?,&preview_options);
                let _=std::fs::remove_dir_all(&stage);
                return result;
            }
            let final_dir=loop {
                n=n.checked_add(1).ok_or("release identity exhausted")?;
                let path=releases.join(n.to_string());
                match std::fs::create_dir(&path) {Ok(())=>break path,Err(e) if e.kind()==std::io::ErrorKind::AlreadyExists=>continue,Err(e)=>return Err(e.to_string())}
            };
            // @ref LLP 3000.000.000#10-wave-10-release-lifecycle-amendment — only committed adoption makes a candidate selectable.
            std::fs::write(stage.join(".pending-adoption"), b"pending\n").map_err(|e|e.to_string())?;
            if staged_bound.schema != bound.schema {
                return Err("staged source does not match the compiled schema".into());
            }
            crate::release_files::durable(&stage)?;
            std::fs::rename(&stage, &final_dir).map_err(|e| e.to_string())?;
            std::fs::File::open(&releases)
                .and_then(|f| f.sync_all())
                .map_err(|e| e.to_string())?;
            let result=activate(
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
            );
            match result {
                Ok(()) => { if let Err(error)=std::fs::remove_file(final_dir.join(".pending-adoption")) {eprintln!("release {n} committed; pending-marker cleanup failed: {error}; history proves adoption");} }
                Err(error) => {
                    // Keep the source reserved even after a lost reply; committed history is authoritative.
                    let matching_latest=latest(&dir).ok().filter(|id|crate::release_files::digest(&final_dir).ok()==crate::release_files::digest(&releases.join(id.to_string())).ok());
                    let error=if error.contains("dormant names") && matching_latest.is_some() {
                        format!("E_ADOPT: source matches latest; use `snapback4 rollback {} --to latest` to reactivate it; alternatively `snapback4 deploy {} --restore-dormant`. {error}",dir.display(),dir.display())
                    } else {error};
                    if options.json && error.contains("dormant names") {
                        let mut inventory=Vec::new();let mut cursor=None;
                        loop {
                            let page=status(&dir,_deployment.as_ref(),0,cursor,None)?;
                            let items=page["items"].as_array().ok_or("invalid dormant inventory response")?;
                            if items.is_empty() {break;}
                            inventory.extend(items.iter().cloned());
                            cursor=items.last().and_then(|i|i["key"].as_str()).map(str::to_owned);
                            if cursor.is_none() {break;}
                        }
                        println!("{}",serde_json::json!({"ok":false,"code":"E_ADOPT","message":error,"dormant":inventory}));
                    }
                    return Err(error);
                }
            }
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
            if let Some(owner) = &_deployment { owner.report_reclaim(options.flags.contains_key("verbose")); }
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
                .or_else(|| held["previous_active"].as_u64())
                .ok_or("nothing to roll back to")?;
            selectable(&dir, previous)?;
            let bound = bound_at(dir.join("releases").join(previous.to_string()))?;
            check_change(&dir, Some(active), &bound, options, Some(previous))?;
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
            if let Some(selector)=options.positionals.get(1) {
                let n=if selector=="latest" {latest(&dir)?} else {selector.parse::<u64>().ok().filter(|n|*n>0).ok_or("releases selection requires N or latest")?};
                selectable(&dir,n)?;let root=dir.join("releases").join(n.to_string());bound_at(root.clone())?;
                result["selected"]=serde_json::json!({"release":n,"current":result["release"].as_u64()==Some(n),"digest":crate::release_files::digest(&root)?});
            }
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
    let dir = canonical_directory(options)?;
    crate::host_limits::initialize();
    let owner = crate::store_owner::host(&dir.join("store.sqlite"))?;
    owner.report_reclaim(options.flags.contains_key("verbose"));
    let current = current(&dir, &owner)?.ok_or("no current release; deploy first")?;
    let release = Project {
        root: dir.join("releases").join(current.to_string())
            .canonicalize().map_err(|e| e.to_string())?,
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
    #[cfg(unix)]
    #[test]
    fn deployment_startup_resolves_new_paths_and_existing_aliases() {
        use std::os::unix::fs::{symlink, PermissionsExt};
        let root = std::env::temp_dir().join(format!("sb4-canonical-release-{}-{}",
            std::process::id(), std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap().as_nanos()));
        std::fs::create_dir(&root).unwrap();
        struct Cleanup(std::path::PathBuf);
        impl Drop for Cleanup { fn drop(&mut self) { let _ = std::fs::remove_dir_all(&self.0); } }
        let _cleanup = Cleanup(root.clone());
        let options = |path: &std::path::Path| super::parse(&["deploy".into(), path.to_str().unwrap().into()]);
        let target = root.join("deployment");
        let canonical = super::canonical_directory(&options(&target)).unwrap();
        assert_eq!(canonical, target.canonicalize().unwrap());
        assert_eq!(std::fs::metadata(&canonical).unwrap().permissions().mode() & 0o777, 0o700);
        let alias = root.join("alias");
        symlink(&target, &alias).unwrap();
        assert_eq!(super::canonical_directory(&options(&alias)).unwrap(), canonical);
        let nested = alias.join("nested");
        assert_eq!(super::canonical_directory(&options(&nested)).unwrap(), canonical.join("nested"));
        let file = root.join("file"); std::fs::write(&file, "preserved").unwrap();
        assert!(super::canonical_directory(&options(&file)).is_err());
        assert_eq!(std::fs::read_to_string(file).unwrap(), "preserved");
    }

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
        .filter_map(|e|e.file_name().to_str()?.parse::<u64>().ok().filter(|n|selectable(dir,*n).is_ok()))
        .max().ok_or("no complete immutable releases".into())
}
pub(super) fn check_release(options:&Options)->i32 {
    report("check",(|| {
        let store=PathBuf::from(options.flags.get("store").ok_or("--store required")?);
        let dir=store.parent().ok_or("store has no deployment directory")?;
        let selected=options.flags.get("release").ok_or("--release required")?;
        let n=if selected=="latest"{latest(dir)?}else{selected.parse::<u64>().ok().filter(|n|*n>0).ok_or("--release requires N or latest")?};
        selectable(dir,n)?;
        super::release_preview::preview(&store,dir.join("releases").join(n.to_string()),n,options)
    })())
}

fn selectable(dir:&Path,release:u64)->Result<(),String> {
    let root=dir.join("releases").join(release.to_string());
    let store=snapback4_core::Store::open_read_only(&dir.join("store.sqlite")).map_err(|e|e.to_string())?;
    let history:bool=store.conn().query_row("SELECT EXISTS(SELECT 1 FROM sqlite_schema WHERE type='table' AND name='_release_events')",[],|r|r.get(0)).map_err(|e|e.to_string())?;
    if history || root.join(".pending-adoption").exists() {
        let committed=if history {store.conn().query_row("SELECT EXISTS(SELECT 1 FROM _release_events WHERE (release=?1 OR previous=?1) AND operation!='prune')",[i64::try_from(release).map_err(|_|"release identity exceeds SQLite range")?],|r|r.get::<_,bool>(0)).map_err(|e|e.to_string())?} else {false};
        if !committed {return Err(format!("release {release} did not complete adoption; select a successful release with --to latest"));}
    }
    bound_at(root).map(|_|())
}

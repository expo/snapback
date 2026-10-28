//! Immutable source releases with a database-authoritative activation pointer.
use super::*;
use crate::store_owner::Owner;
use std::path::{Path, PathBuf};
#[path = "staging.rs"]
mod staging;
struct Stage(PathBuf);
impl Drop for Stage {fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}

fn parent_predates_views(root:&Path)->bool {
    if root.join("rollback-views.json").exists(){return false;}
    std::fs::read(root.join("provenance.json")).ok().and_then(|bytes|serde_json::from_slice::<serde_json::Value>(&bytes).ok())
        .and_then(|v|v["cliVersion"].as_str().map(str::to_owned))
        .and_then(|v|v.split('.').map(str::parse::<u64>).collect::<Result<Vec<_>,_>>().ok())
        .is_some_and(|v|v.len()==3&&(v[0],v[1],v[2])<(0,4,39))
}

fn directory(options: &Options) -> Result<PathBuf, String> {
    options
        .positionals
        .first()
        .map(PathBuf::from)
        .ok_or_else(|| "a deployment directory is required".into())
}

// @ref LLP 3000.000.000#5.1 — deployment aliases share ownership, control and worker paths.
pub(super) fn canonical_directory(options: &Options) -> Result<PathBuf, String> {
    let requested = directory(options)?;
    if !requested.exists() {
        snapback4_core::private_fs::directory(&requested).map_err(|e| e.to_string())?;
    }
    let dir = requested.canonicalize().map_err(|e| e.to_string())?;
    snapback4_core::private_fs::directory(&dir).map_err(|e| e.to_string())?;
    Ok(dir)
}

// @ref LLP 3000.000.000.000.000#8 — validate before any writable ownership or command lock.
pub(crate) fn existing_deployment(requested: &Path) -> Result<PathBuf, String> {
    let missing = || format!("no current release in {}; run `snapback4 deploy {}` first", requested.display(), requested.display());
    if !requested.join("store.sqlite").is_file() { return Err(missing()); }
    let dir = requested.canonicalize().map_err(|e| e.to_string())?;
    inspect_current(&dir)?;
    Ok(dir)
}

// SQLite READONLY can create WAL sidecars. A stopped store's existing owner
// lock makes immutable inspection safe; a live host supplies its own status.
fn inspect_current(dir: &Path) -> Result<u64, String> {
    let database = dir.join("store.sqlite").canonicalize().map_err(|e| e.to_string())?;
    let missing = || format!("no current release in {}; run `snapback4 deploy {}` first", dir.display(), dir.display());
    let owner = match snapback4_core::private_fs::auxiliary_file(&database,
        &snapback4_core::private_fs::owner_path(&database), false, 0) {
        Ok(owner) => owner,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            // Relocated/legacy deployments may not yet have a sidecar beside
            // the resolved DB. Establish a complete current source first; only
            // a known deployment may let SQLite create its ordinary WAL files.
            return pointer_current(dir, &database);
        },
        Err(error) => return Err(format!("{}; existing ownership sidecar unavailable: {error}", missing())),
    };
    match owner.try_lock() {
        Ok(()) => {},
        Err(std::fs::TryLockError::WouldBlock) => {
            match crate::release_control::request(dir, crate::release_control::Command::Status {after:0, items_after:None, event:None}) {
                Ok(status) => return status["release"].as_u64().filter(|n|*n>0).ok_or_else(missing),
                Err(error) => {
                    // A killed host's watchdogs retain ownership during their
                    // bounded cleanup. Preserve serve's existing restart wait.
                    if !crate::store_owner::stopped_host(&database) {
                        // A second source directory may alias the same DB. Its
                        // source cannot control this host, but its token still
                        // belongs to the resolved database. Establish current
                        // source before permitting ordinary read-only WAL work.
                        return pointer_current(dir, &database).map_err(|_| format!("{}; {error}",missing()));
                    }
                    let deadline=std::time::Instant::now()+std::time::Duration::from_secs(5);
                    loop {
                        match owner.try_lock() {
                            Ok(()) => break,
                            Err(std::fs::TryLockError::WouldBlock) if std::time::Instant::now()<deadline => std::thread::sleep(std::time::Duration::from_millis(25)),
                            _ => return Err(format!("{}; {error}",missing())),
                        }
                    }
                }
            }
        },
        Err(error) => return Err(error.to_string()),
    }
    if !snapback4_core::private_fs::owner_is_named(&database, &owner) {
        return Err("store ownership changed during release inspection; retry".into());
    }
    #[cfg(unix)]
    let bytes = { use std::os::unix::ffi::OsStrExt; database.as_os_str().as_bytes() };
    #[cfg(not(unix))]
    let bytes = database.to_str().ok_or("invalid store path")?.as_bytes();
    let mut uri = String::from("file:");
    for byte in bytes {
        if byte.is_ascii_alphanumeric() || b"/._-".contains(byte) { uri.push(*byte as char); }
        else { uri.push_str(&format!("%{byte:02X}")); }
    }
    let mut wal = database.as_os_str().to_os_string(); wal.push("-wal"); let wal = PathBuf::from(wal);
    let mut shm = database.as_os_str().to_os_string(); shm.push("-shm"); let shm = PathBuf::from(shm);
    let has_wal = match std::fs::metadata(&wal) {
        Ok(meta) => meta.len() > 0,
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => false,
        Err(e) => return Err(e.to_string()),
    };
    if has_wal && !shm.is_file() { return Err("store has a WAL without its shared-memory sidecar; run deploy on this stopped deployment to recover it before inspection".into()); }
    // Immutable SQLite omits WAL reads: use it only for the checkpointed main
    // image. Existing WAL+SHM can be read normally under the same exclusion.
    uri.push_str(if has_wal { "?mode=ro" } else { "?mode=ro&immutable=1" });
    let inspection = snapback4_core::store_port::AnyInspection::open_uri(&uri).map_err(|(_, e)|e)?;
    let release = inspection.optional_release().map_err(|(_, e)|e)?;
    let release = match release {
        Some(value) => value,
        None => std::fs::read_to_string(dir.join("current")).map_err(|_| missing())?,
    };
    release.trim().parse::<u64>().ok().filter(|n|*n>0).ok_or_else(missing)
}

pub(super) fn bound_current(dir: &Path) -> Result<snapback4_lang::Bound, String> {
    let release = inspect_current(dir)?;
    bound_at(dir.join("releases").join(release.to_string()))
}

fn pointer_current(dir: &Path, database: &Path) -> Result<u64, String> {
    let missing = || format!("no current release in {}; deploy first", dir.display());
    let pointer = std::fs::read_to_string(dir.join("current")).map_err(|_| missing())?;
    let pointer = pointer.trim().parse::<u64>().ok().filter(|n|*n>0).ok_or_else(missing)?;
    bound_at(dir.join("releases").join(pointer.to_string()))?;
    let store = snapback4_core::store_port::AnyStore::open_read_only(database).map_err(|e|e.to_string())?;
    match store.release_value().map_err(|e|e.to_string())? {
        Some(value) => value.parse::<u64>().ok().filter(|n|*n>0).ok_or_else(missing),
        None => Ok(pointer),
    }
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
        if let Some(release) = store.release_value().map_err(|e| e.to_string())? {
            return release
                .parse()
                .map(Some)
                .map_err(|_| "invalid release identity in store".into());
        }
    }
    // Before persisted selection metadata, this file supplies source context
    // only. Deploy takes its activation predecessor from held store status.
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
    let sources=phase::measure("release.source_read", || project.sources()).map_err(|e| e.to_string())?;
    if sources.is_empty() {
        return Err("release has no Quarry source; select a complete immutable release".into());
    }
    let bound = super::release_compile::compile(&sources);
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
pub(super) fn check_change(
    dir: &Path,
    previous: Option<u64>,
    bound: &snapback4_lang::Bound,
    options: &Options,
    target_release: Option<u64>,
) -> Result<(), String> {
    if target_release.is_some() {if let Some(n)=previous {
        let current=Project{root:dir.join("releases").join(n.to_string())}.sources().map_err(|e|e.to_string())?;
        let target=Project{root:dir.join("releases").join(target_release.unwrap().to_string())}.sources().map_err(|e|e.to_string())?;
        snapback4_lang::release_bridge::exact_write_authority(&target,&current).map_err(|e|format!("E_ADOPT: {e}"))?;
        let latest=latest(dir)?;
        if latest!=n {let source=Project{root:dir.join("releases").join(latest.to_string())}.sources().map_err(|e|e.to_string())?;
            snapback4_lang::release_bridge::exact_write_authority(&target,&source).map_err(|e|format!("E_ADOPT: latest source {latest}: {e}"))?;
        }

    }}
    if !options.flags.contains_key("check") && options.flags.contains_key("verbose") && let Some(n) = previous {
        let old = bound_at(dir.join("releases").join(n.to_string()))?;
        let store = snapback4_core::store_port::AnyStore::open_read_only(&dir.join("store.sqlite")).map_err(|e| e.to_string())?;
        let target_label = target_release.map(|n| format!("release {n}")).unwrap_or_else(|| "the new release".into());
        let lines = super::release_narration::compatibility(&store, &old.schema, &bound.schema, n, &target_label, target_release.is_none())?;
        for line in lines {
            eprintln!("{line}");
        }
        if target_release.is_some() {
            for warning in snapback4_lang::client_contracts::compact(&snapback4_lang::client_contracts::compare(&old,bound,&format!("release {n}"))) {
                if snapback4_lang::client_contracts::is_note(&warning) {eprintln!("NOTE {warning}");}
                else {eprintln!("WARNING {warning}");}
            }
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

pub(super) fn command_lock(dir: &Path) -> Result<std::fs::File, String> {
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
fn activation_target(dir: &Path) -> Result<(Option<Owner>, serde_json::Value), String> {
    let started = std::time::Instant::now();
    let owner = match crate::store_owner::release_command(&dir.join("store.sqlite")) {
        Ok(owner) => Some(owner),
        Err(error) if error.contains("E_STORE_BUSY") => None,
        Err(error) => return Err(error),
    };
    match status(dir, owner.as_ref(), 0, None, None) {
        Ok(held) => Ok((owner, held)),
        // Status is read-only: a shutting-down control socket cannot have
        // admitted activation. Never repeat a deploy/rollback control request.
        Err(control_error) if owner.is_none() => {
            let remaining = std::time::Duration::from_secs(5).saturating_sub(started.elapsed());
            let owner = crate::store_owner::wait_command(&dir.join("store.sqlite"), remaining)
                .map_err(|error|format!("{control_error}; {error}"))?;
            let held = status(dir, Some(&owner), 0, None, None)?;
            Ok((Some(owner), held))
        }
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
    mut candidate: Option<&mut crate::release_files::Candidate>,
) -> Result<(), String> {
    let mut timing=phase::Sequence::new();
    let selection_error=|error:String|if error.contains("E_ADOPT") {format!("{error}; operation: {} to release {release} from release {}",if rollback{"rollback"}else{"deploy"},previous.map(|n|n.to_string()).unwrap_or_else(||"none".into()))}else{error};
    let root = dir.join("releases").join(release.to_string());
    validate_registered_view(dir,&root)?;
    let digest = crate::release_files::digest(&root)?;
    if let Some(owner) = owner {
        let project = Project { root };
        let prepared = crate::native::prepare(&project, &bound).map_err(|e| e.to_string())?;
        crate::dev_worker::prepare_release(&project, &bound.schema)?;
        crate::release_files::link_store(&project.root)?;
        crate::release_files::durable(&project.root)?;
        let mut pointer = crate::release_files::Pointer::prepare(dir, release, previous, rollback)?;
        let activation = snapback4_core::engine::release::ReleaseActivation {
            visibility:visibility_policy(&project.root)?.or_else(||options.flags.contains_key("visible-rollback").then(Default::default)),
            release,
            expected_previous: previous,
            expected_revision: Some(revision),
            restore_dormant,
            native_digest: prepared.installed.as_ref().map(|m| m.digest.clone()),
            operation: if rollback { "rollback" } else { "deploy" }.into(),
        };
        timing.step("deploy.activate.prepare_fsync");
        let store = owner
            .open_store(std::time::Duration::from_secs(5))
            .map_err(|e| e.to_string())?;
        timing.step("deploy.activate.store_open");
        let engine = snapback4_core::Engine::new_release_prepared(
            store,
            bound.schema,
            bound.programs.into_iter().map(|p| p.program),
            &activation,
            allow_feed_adoption,
        )
        .map_err(|e| selection_error(e.to_string()))?;
        timing.step("deploy.activate.adoption_backfills");
        pointer.finish(engine.generation())?;
        timing.step("deploy.activate.pointer_fsync");
        receipt(release,engine.generation(),engine.store().adoption_report(),options, &live_identity(dir, release)?);

    } else {
        let mut result = crate::release_control::request_observed(
            dir,
            crate::release_control::Command::Activate {
                activation_protocol:crate::release_control::ACTIVATION_PROTOCOL.into(),
                release,
                expected_release: previous,
                expected_revision: revision,
                digest,
                rollback,
                visible_rollback:options.flags.contains_key("visible-rollback"),
                registry_custody:true,
                restore_dormant,
                allow_feed_adoption,
            },
            |pending| { if let Some(candidate)=candidate.as_deref_mut() {candidate.pending=pending;} },
        ).map_err(|e|if e.contains("unknown field")&&(e.contains("activation_protocol")||e.contains("registry_custody")||e.contains("visible_rollback")){format!("E_RELEASE_RUNTIME: serving runtime predates release custody; restart serve with this CLI before switching; {e}")}else{selection_error(e)})?;
        if let Some(summary)=options.flags.get("security-summary"){result["security"]=serde_json::from_str(summary).unwrap_or_default();}
        if let Some(view)=options.flags.get("rollback-view"){result["rollbackView"]=serde_json::from_str(view).unwrap_or_default();}
        if let Some(preview)=options.flags.get("release-preview"){result["preview"]=serde_json::from_str(preview).unwrap_or_default();}
        if let Some(origin)=options.flags.get("source-release").and_then(|v|v.parse::<u64>().ok()){result["sourceRelease"]=origin.into();}
        result["live"]=live_identity(dir,release)?;
        crate::command_output::released(options.flags.get("output-verb").map(String::as_str).unwrap_or("deploy"),release,&result["generation"],&result["live"],result["adoption"].as_str().unwrap_or("adopted by running serve"));
        crate::command_output::evidence(&result);
        if options.json {println!("{}",result);} else {
            completed_verdict(options);
            print_live(&result["live"]);
            println!("release {release} is current as generation {}; {}; running serve adopted the release",result["generation"],result["adoption"].as_str().unwrap_or("adopted"));
            if let Some(origin)=options.flags.get("source-release"){println!("  retained source {origin} requalified as release {release} to register its current rollback views");}
            for fill in result["backfills"].as_array().into_iter().flatten().filter_map(|f|f.as_str()) {println!("  backfill: {fill}");}
            if options.flags.contains_key("verbose") {println!("{}",result["details"].as_str().unwrap_or(""));}
        }
        crate::command_output::backfills(&result["backfills"]);
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
            if verb!="deploy" {eprintln!("{verb} verdict: REFUSED");}
            eprintln!("{verb}: {error}");
            1
        }
    }
}

pub fn deploy(options: &Options) -> i32 {
    let _compilation_reuse = snapback4_lang::CompilationReuse::new();
    let _compile_scope=super::release_compile::Scope::new();
    let mut timing=phase::Sequence::new();
    match crate::store_config::StoreConfig::resolve(options) {
        Ok(Some(config)) => return report("deploy", super::configured_release::deploy(options, config)),
        Err(error) => return report("deploy", Err(error)),
        Ok(None) => {},
    }
    let mut security_summary=None;
    let mut activation_qualified=false;
    let mut security_sources=None;
    let mut failure_inventory=None;
    let mut failure_problems=None;
    let result=(|| {
            let dir = canonical_directory(options)?;
            crate::store_config::local_deployment(options, &dir)?;
            let _command = command_lock(&dir)?;
            let existed = dir.join("store.sqlite").exists();
            let checking=options.flags.contains_key("check");
            let (_deployment, held) = if checking { (None, None) } else { let (owner, held) = activation_target(&dir)?; (owner, Some(held)) };
            if let Some(owner) = &_deployment { owner.report_reclaim(options.flags.contains_key("verbose")); }
            timing.step("deploy.owner_store_status");
            let project = super::proof_source::project(options, "schema")?;
            let sources = super::proof_source::sources(&project, options, "schema")?;
            security_sources=Some((project.root.clone(),sources.clone()));
            let bound = phase::measure("deploy.bind", || super::proof_source::compile(&sources, options, "schema"));
            if !bound.diagnostics.is_empty(){
                failure_problems=Some(serde_json::json!({"problems":bound.diagnostics,"notes":bound.notes}));
                if !options.json{eprintln!("deploy verdict: REFUSED; compilation");super::report_diagnostics(&bound,false,false,true);}
                return Err("selected source does not compile".into())
            }
            let mut saved_version = super::saved_version::SavedVersion::prepare(&project,&sources,&bound,options,&dir)?;
            if options.flags.contains_key("staging") {
                staging::classify(&dir, _deployment.as_ref(), existed, checking)?;
            }
            let clock_notice=staging::clock_notice(&dir);
            std::fs::create_dir_all(dir.join("releases")).map_err(|e| e.to_string())?;
            let held = if checking {
                if dir.join("store.sqlite").exists() {snapback4_core::store_port::AnyStore::open_read_only(&dir.join("store.sqlite")).and_then(|mut s|s.release_status(0,None,None)).map_err(|e|e.to_string())?}
                else {serde_json::json!({"release":null,"revision":0,"generation":1})}
            } else {held.expect("live activation target status")};
            let previous = if let Some(release) = held["release"].as_u64() {
                Some(release)
            } else if let Some(owner) = _deployment.as_ref() {
                current(&dir, owner)?
            } else {
                held["release"].as_u64()
            };
            // @ref LLP 3000.000.000.003#1-idempotent-selection-and-repair — a legacy filesystem pointer is source context, not a persisted live predecessor.
            let activation_previous=held["release"].as_u64();
            timing.step("deploy.source_materialization");
            security_summary={
                let prior=previous.map(|n|bound_at(dir.join("releases").join(n.to_string()))).transpose()?;
                phase::measure("deploy.security", || super::security::release_loop(&project,&bound,&sources,prior.as_ref(),previous.map(|n|Project{root:dir.join("releases").join(n.to_string())}.sources()).transpose().map_err(|e|e.to_string())?.as_deref(),options))?
            };
            timing.step("deploy.security_envelope");
            let baseline=crate::client_compatibility::report(&project,&bound).map_err(|e|e.to_string())?.1;
            let mut options=options.clone();
            options.flags.insert("client-baseline-advice".into(),serde_json::to_string(&baseline).unwrap());
            if let Some(summary)=&security_summary {options.flags.insert("security-summary".into(),summary.clone());}
            let options=&options;
            let revision = held["revision"].as_u64().unwrap_or(0);
            check_change(&dir, previous, &bound, options, None)?;
            let releases = dir.join("releases").canonicalize().map_err(|e| e.to_string())?;
            let stage = releases.join(format!(".stage-{}", std::process::id()));
            if stage.exists() {std::fs::remove_dir_all(&stage).map_err(|e|e.to_string())?;}
            std::fs::create_dir(&stage).map_err(|e| e.to_string())?;
            let _cleanup=Stage(stage.clone());
            std::fs::create_dir(stage.join("snapback")).map_err(|e| e.to_string())?;
            let source_hash = {
                use sha2::{Digest, Sha256};
                let mut hash = Sha256::new();
                let mut ordered = sources.iter().collect::<Vec<_>>();
                ordered.sort_by(|a,b| a.0.cmp(&b.0));
                for (name,text) in ordered {
                    hash.update((name.len() as u64).to_le_bytes()); hash.update(name.as_bytes());
                    hash.update((text.len() as u64).to_le_bytes()); hash.update(text.as_bytes());
                }
                format!("{:x}", hash.finalize())
            };
            for (name,text) in sources {
                let path=stage.join("snapback").join(name);
                if let Some(parent)=path.parent(){std::fs::create_dir_all(parent).map_err(|e|e.to_string())?;}
                std::fs::write(path,text).map_err(|e|e.to_string())?;
            }
            crate::dev_worker::package(&project, &stage)?;
            // @ref LLP 3000.011.003.000.000#2 — saved schemas prepare companion types in a private snapshot, never in working generated/.
            let private = if options.flags.contains_key("schema") || crate::dev_worker::source(&project).is_some() {
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
            crate::dev_worker::package_entry(build_project, &stage)?;
            timing.step("deploy.stage_materialization");
            let staged_digest = crate::release_files::executable_digest(&stage)?;
            let mut matching = std::fs::read_dir(&releases).map_err(|e|e.to_string())?
                .filter_map(Result::ok).filter_map(|e| e.file_name().to_str()?.parse::<u64>().ok())
                .filter(|n| !super::rollback_views::is_view(&dir,*n) && selectable(&dir, *n).is_ok())
                .collect::<Vec<_>>();
            matching.sort_unstable_by(|a,b| b.cmp(a));
            let mut matched = None;let mut source_origin=None;let mut source_matches=Vec::new();
            for n in matching {
                if crate::release_files::executable_digest(&releases.join(n.to_string()))? == staged_digest {
                    matched.get_or_insert(n);source_origin=Some(n);source_matches.push(n);
                }
            }
            timing.step("deploy.retained_matching");
            let mut n=std::fs::read_dir(&releases).map_err(|e|e.to_string())?.filter_map(Result::ok).filter_map(|e|e.file_name().to_str()?.parse::<u64>().ok()).max().unwrap_or(0);
            let staged_bound=bound_at(stage.clone())?;
            let parent=n.checked_add(1).ok_or("release identity exhausted")?;
            // Match executable source independently of generated registry metadata.
            // Reactivation can restore dormant rows: qualify its complete
            // committed rollback registry before reusing a source identity.
            let views=super::rollback_views::prepare(&dir,&stage,&staged_bound,parent)?;
            // A historical duplicate may carry the wrong registry. Reuse an
            // already-qualified matching source/registry before minting anything.
            for candidate in source_matches {
                if !super::rollback_views::needs_registration(&dir,Some(candidate),&views)? {matched=Some(candidate);break;}
            }
            timing.step("deploy.rollback_registry");
            let register_views=super::rollback_views::needs_registration(&dir,matched,&views)?;
            if let Some(origin)=matched {check_change(&dir,previous,&bound,options,Some(origin))?;}
            if let Some(previous)=previous {
                if !checking && !register_views && matched==Some(previous) && held["release"].as_u64()==Some(previous) {
                    super::security::enforce_release(security_summary.as_ref(),options).map_err(|e|format!("{e}; adoption preflight: UNCHANGED; first failure: security gate"))?;
                    std::fs::remove_dir_all(&stage).map_err(|e|e.to_string())?;
                    if let Some(saved) = &mut saved_version { saved.finish(previous,&source_hash)?; }
                    if options.json {println!("{}",serde_json::json!({"unchanged":true,"release":previous,"generation":held["generation"],"live":live_identity(&dir,previous)?}));}
                    else {crate::command_output::released("deploy",previous,&held["generation"],&live_identity(&dir,previous)?,"unchanged; no adoption");println!("deploy verdict: UNCHANGED; {}",super::security::release_verdict(security_summary.as_ref()));print_live(&live_identity(&dir,previous)?);println!("unchanged; release {previous} stays current as generation {}",held["generation"]);if let Some(notice)=&clock_notice {crate::command_output::fact("clock",notice);eprintln!("{notice}");}}
                    return Ok(());
                }
            }
            if let Some(n) = matched.filter(|_|!register_views) {
                let mut preview_options=options.clone();
                if let Some(summary)=&security_summary {preview_options.flags.insert("security-summary".into(),summary.clone());}
                preview_options.flags.insert("enforce-security-after-adoption".into(),String::new());
                preview_options.flags.insert("deploy-direction".into(),String::new());
                preview_options.flags.insert("restore-dormant".into(),String::new());
                if !checking { preview_options.flags.insert("validation-only".into(),String::new()); }
                let details=super::release_preview::plan(&dir.join("store.sqlite"),releases.join(n.to_string()),n,&preview_options,_deployment.as_ref())?;
                if checking { return Ok(()); }
                activation_qualified=true;
                let mut with_details=options.clone();with_details.flags.insert("release-preview".into(),details.to_string());let options=&with_details;
            timing.step("deploy.preview");

                let selected = bound_at(releases.join(n.to_string()))?;
                activate(&dir,_deployment.as_ref(),n,activation_previous,revision,selected,false,true,options.flags.contains_key("allow-feed-adoption"),options,None)?;
                if let Some(saved)=&mut saved_version {saved.finish(n,&source_hash)?;}
                return Ok(());
            }
            let mut qualified_options=options.clone();
            if let Some(origin)=source_origin.filter(|_|register_views){qualified_options.flags.insert("source-release".into(),origin.to_string());qualified_options.flags.insert("restore-dormant".into(),String::new());}
            let options=&qualified_options;
            if options.flags.contains_key("check") {
                let mut preview_options=options.clone();
                if let Some(summary)=&security_summary {preview_options.flags.insert("security-summary".into(),summary.clone());}preview_options.flags.insert("enforce-security-after-adoption".into(),String::new());preview_options.flags.insert("deploy-direction".into(),String::new());
                let result=super::release_preview::preview(&dir.join("store.sqlite"),stage.clone(),n.checked_add(1).ok_or("release identity exhausted")?,&preview_options,None);
                let _=std::fs::remove_dir_all(&stage);
                return result;
            }
            timing.step("deploy.pre_preview");
            let mut validation=options.clone();
            validation.flags.insert("enforce-security-after-adoption".into(),String::new());
            validation.flags.insert("deploy-direction".into(),String::new());
            validation.flags.insert("validation-only".into(),String::new());
            let details=super::release_preview::plan(&dir.join("store.sqlite"),stage.clone(),n.checked_add(1).ok_or("release identity exhausted")?,&validation,_deployment.as_ref())?;
            activation_qualified=true;
            timing.step("deploy.preview");
            let mut with_details=options.clone();with_details.flags.insert("release-preview".into(),details.to_string());let options=&with_details;
            if staged_bound.schema != bound.schema { return Err("staged source does not match the compiled schema".into()); }
            n=n.checked_add(1).ok_or("release identity exhausted")?;
            let final_dir=releases.join(n.to_string());
            // @ref LLP 3000.000.000#10-wave-10-release-lifecycle-amendment — only committed adoption makes a candidate selectable.
            std::fs::write(stage.join(".pending-adoption"), b"pending\n").map_err(|e|e.to_string())?;
            if staged_bound.schema != bound.schema {
                return Err("staged source does not match the compiled schema".into());
            }
            // @ref LLP 3000.000.000.000.000#4-cli-surface-contracts — provenance is immutable metadata, excluded from executable identity so identical deploys stay no-ops.
            std::fs::write(stage.join("provenance.json"), format!("{}\n", serde_json::json!({
                "release": n, "sourceHash": source_hash, "cliVersion": env!("CARGO_PKG_VERSION"), "createdAt": snapback4_core::now_ms()
            }))).map_err(|e|e.to_string())?;
            let mut installed_views=super::rollback_views::install(&dir,&stage,n,&views)?;
            crate::release_files::durable(&stage)?;
            std::fs::rename(&stage, &final_dir).map_err(|e| e.to_string())?;
            let mut candidate=crate::release_files::Candidate::new(&dir,n);
            std::fs::File::open(&releases)
                .and_then(|f| f.sync_all())
                .map_err(|e| e.to_string())?;
            timing.step("deploy.release_write_fsync");
            let result=activate(
                &dir,
                _deployment.as_ref(),
                n,
                activation_previous,
                revision,
                staged_bound,
                false,
                options.flags.contains_key("restore-dormant"),
                options.flags.contains_key("allow-feed-adoption"),
                options,
                Some(&mut candidate),
            );
            timing.step("deploy.activation");
            installed_views.pending=candidate.pending;
            match result {
                Ok(()) => {
                    candidate.committed=true;
                    if let Err(error)=std::fs::remove_file(final_dir.join(".pending-adoption")) {eprintln!("release {n} committed; pending-marker cleanup failed: {error}; history proves adoption");}
                    if let Some(saved) = &mut saved_version {saved.finish(n,&source_hash).map_err(|e|format!("release {n} committed, but saving its snapshot failed: {e}; retry unchanged deploy with --save-version"))?;}
                }
                Err(error) => {
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
                        failure_inventory=Some(inventory);
                    }
                    return Err(error);
                }
            }
            if let Some(notice)=clock_notice {crate::command_output::fact("clock",&notice);eprintln!("{notice}");}
            Ok(())
        })();
    let result=result.map_err(|error:String|if error.contains("E_SECURITY_"){error}
        else if activation_qualified {format!("{error}; first failure: activation; adoption preflight and security gate passed")}
        else if failure_problems.is_some(){format!("{error}; first failure: compilation; adoption and security gate not run")}
        else{format!("{error}; first failure: adoption preflight; security gate not enforced")});
    timing.step("deploy.selection_completion");
    if result.is_ok()&&!options.flags.contains_key("check"){if let Some((root,sources))=&security_sources{super::security::remember_write_release(&Project{root:root.clone()},sources);}}
    timing.step("deploy.security_bookkeeping");
    if !options.json {
        if result.is_err() && failure_problems.is_none() {eprintln!("deploy verdict: REFUSED; {}",super::security::release_verdict(security_summary.as_ref()));}
        super::security::print_release(security_summary.as_ref());

    }
    if options.json {if let Err(error)=&result {println!("{}",serde_json::json!({"ok":false,"message":error,"dormant":failure_inventory,"compilation":failure_problems,"security":security_summary.as_ref().and_then(|s|serde_json::from_str::<serde_json::Value>(s).ok())}));}}
    timing.step("deploy.output");
    phase::measure("deploy.report_output", || report("deploy",result))
}

fn already_live(dir:&Path,active:u64,options:&Options)->Result<(),String>{
    let live=live_identity(dir,active)?;
    if options.json {println!("{}",serde_json::json!({"ok":true,"unchanged":true,"message":format!("release {active} is already live"),"release":active,"live":live,"rowShape":live["rowShape"]}));}
    else {println!("release {active} is already live");print_live(&live);}
    Ok(())
}

pub fn rollback(options: &Options) -> i32 {
    let _compile_scope=super::release_compile::Scope::new();
    report(
        "rollback",
        (|| {
            let dir = existing_deployment(&directory(options)?)?;
            let _command = command_lock(&dir)?;
            let (_deployment, held) = activation_target(&dir)?;
            // A source pointer alone cannot establish a live rollback predecessor.
            let active = held["release"].as_u64()
                .ok_or("no persisted live release; deploy its source once before rollback")?;

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
            // @ref LLP 3000.000.000.003#1-idempotent-selection-and-repair — do not re-enter migration preparation for a live id.
            if previous == active && !options.flags.contains_key("check")
                && (!options.flags.contains_key("exact") || !super::rollback_views::is_view(&dir,active)) {
                already_live(&dir,active,options)?;return Ok(());
            }
            let logical=super::rollback_views::metadata(&dir.join("releases").join(previous.to_string()))?.map(|v|v.target).unwrap_or(previous);
            let mut view=if options.flags.contains_key("exact"){None}else{super::rollback_views::resolve(&dir,logical)?};
            if view.as_ref().is_some_and(|view|view.release==active) && !options.flags.contains_key("check") {
                already_live(&dir,active,options)?;return Ok(());
            }
            if let Some(registered)=&view {
                if super::rollback_views::prefer_original(&dir,registered,options,_deployment.as_ref())? {view=None;}
            }
            let previous=view.as_ref().map(|v|v.release).unwrap_or(logical);
            if previous == active && !options.flags.contains_key("check") {
                already_live(&dir,active,options)?;return Ok(());
            }
            if let Some(view)=&view {
                if view.target!=logical {eprintln!("rollback source: release {logical} has the same executable digest as retained target {}",view.target);}
                if options.flags.contains_key("verbose") {eprintln!("rollback target: release {} via bridge {} (registered by release {})",view.target,view.release,view.parent);
                for reason in &view.hides {eprintln!("intentional rollback hiding: {reason}");}}
            }
            let mut selected_options=options.clone();
            selected_options.flags.insert("output-verb".into(),"rollback".into());
            if !options.flags.contains_key("exact"){selected_options.flags.insert("visible-rollback".into(),String::new());}
            if let Some(view)=&view{selected_options.flags.insert("rollback-view".into(),serde_json::to_string(view).unwrap());}
            let options=&selected_options;
            selectable(&dir, previous)?;
            let bound = bound_at(dir.join("releases").join(previous.to_string()))?;
            // @ref LLP 3000.036.004#191-deploy-rollback-and-release-inspection-dx12 — resolve now; default output leads with the outcome and live identity.
            let target_line=format!("resolved rollback target: release {previous} (current release {active})");
            if options.flags.contains_key("verbose") {if options.json {eprintln!("{target_line}");} else {println!("{target_line}");}}
            let legacy_refusal=|error:String| {
                if view.is_none() && !options.flags.contains_key("exact") && parent_predates_views(&dir.join("releases").join(active.to_string())) {
                    format!("{error}; this parent predates rollback views; deploy the current source with this CLI to register needed views, or explicitly select the historical workflow with `snapback4 rollback {} --to {logical} --exact` (preview its hiding with --check first)",dir.display())
                }else if view.as_ref().is_some_and(|v|!v.hides.is_empty()) {
                    format!("{error}; intentional hiding view unavailable; remove its `rollback hides` declaration and deploy the visible optional workflow; to request the original historical workflow, preview `snapback4 rollback {} --to {logical} --exact --check` before selecting it",dir.display())
                }else{error}
            };
            let mut bridge_options=options.clone();
            if let Some(path)=bridge_options.flags.remove("bridge") {
                super::release_bridge::write(Path::new(&path),&dir,active,previous,&[])?;
                eprintln!("bridge starter written to {path}; follow ROLLBACK-CHECKLIST.md before exact rollback");
            }
            let options=&bridge_options;
            check_change(&dir, Some(active), &bound, options, Some(previous)).map_err(&legacy_refusal)?;
            if options.flags.contains_key("check") {
                return super::release_preview::preview(&dir.join("store.sqlite"),dir.join("releases").join(previous.to_string()),previous,options,_deployment.as_ref()).map_err(&legacy_refusal);
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
                None,
            ).map_err(&legacy_refusal)?;

            Ok(())
        })(),
    )
}

pub fn releases(options: &Options) -> i32 {
    let _compile_scope=super::release_compile::Scope::new();
    report(
        "releases",
        (|| {
            let dir = existing_deployment(&directory(options)?)?;
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
            let mut store = snapback4_core::store_port::AnyStore::open_read_only(&dir.join("store.sqlite"))
                .map_err(|e| e.to_string())?;
            let retained = store.dormant_inventory(None, usize::MAX).map_err(|e| e.to_string())?;
            let mut result = store
                .release_status(
                    after,
                    options.flags.get("items-after").map(String::as_str),
                    event,
                )
                .map_err(|e| e.to_string())?;
            if result["release"].is_null() { result["release"]=serde_json::json!(inspect_current(&dir)?); }
            result["current"]=result["release"].clone();
            result["live"]=result["release"].as_u64().map(|n|live_identity(&dir,n)).transpose()?.unwrap_or(serde_json::Value::Null);
            result["rowShape"]=result["live"]["rowShape"].clone();
            result["latest"]=serde_json::json!(latest(&dir).ok());
            let mut views=Vec::new();for parent in ordinary_releases(&dir)?{views.extend(super::rollback_views::manifest(&dir.join("releases").join(parent.to_string()))?);}
            result["rollbackViews"]=serde_json::to_value(views).unwrap();
            if let Some(selector)=options.positionals.get(1) {
                let n=if selector=="latest" {latest(&dir)?} else if selector=="current" {result["release"].as_u64().ok_or("no current release")?} else {selector.parse::<u64>().ok().filter(|n|*n>0).ok_or("releases selection requires N, latest or current")?};
                selectable(&dir,n)?;let root=dir.join("releases").join(n.to_string());bound_at(root.clone())?;
                result["selected"]=serde_json::json!({"release":n,"current":result["release"].as_u64()==Some(n),"digest":crate::release_files::digest(&root)?});
            }
            crate::command_output::summary(format!("releases: current {}; latest {}; generation {}; {} events on page; {} dormant rows retained",result["current"],result["latest"],result["generation"],result["events"].as_array().map_or(0,Vec::len),super::sql::dormant_rows(&retained)));
            crate::command_output::evidence(&result);
            crate::command_output::state(result.clone());
            if result["live"]["exact"] == false {crate::command_output::fact("source",format!("live: rollback view of release {}, registered by {}",result["live"]["target"],result["live"]["parent"]));}
            if result["rowShape"]["matchesTarget"]==false {crate::command_output::fact("row shape",crate::output_facts::row_shape(&result["rowShape"]));}
            if let Some(selected) = result.get("selected") {crate::command_output::fact("selection",format!("selected: {selected}"));}
            if options.json {println!("{}", serde_json::to_string_pretty(&result).unwrap());}
            else {
                println!("releases verdict: READY; current {}; latest {}; generation {}",result["current"],result["latest"],result["generation"]);
                print_live(&result["live"]);
                println!("{} events; {} dormant items on this page; next: releases --json for full evidence and paging; --review for details",result["events"].as_array().map_or(0,Vec::len),result["items"].as_array().map_or(0,Vec::len));
                if let Some(selected)=result.get("selected") {println!("selected: {selected}");}
                if options.flags.contains_key("review")||options.flags.contains_key("verbose") {println!("{}",serde_json::to_string_pretty(&result).unwrap());}
            }
            super::sql::dormant_notice(super::sql::dormant_rows(&retained), "use `snapback4 sql 'SELECT …' --release <dir> --dormant` to inspect them");
            Ok(())
        })(),
    )
}

pub fn prune(options: &Options) -> i32 {
    report(
        "prune",
        (|| {
            let dir = existing_deployment(&directory(options)?)?;
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
    if let Some(config) = crate::store_config::StoreConfig::resolve(options)? { return super::configured_release::serve(options, config); }
    let requested = directory(options)?;
    if requested.exists() { crate::store_config::local_deployment(options, &requested)?; }
    if options.flags.contains_key("wait-stopped") {
        let dir = directory(options)?;
        crate::store_owner::wait_released(&dir.join("store.sqlite"), std::time::Duration::from_secs(5))?;
        println!("store released: {}", dir.display());
        return Ok(());
    }
    let requested_port = crate::port_flag::parse("serve", options.flags.get("port").map(String::as_str))?;
    let bind = release_bind(options)?;
    let capacity = crate::host_limits::Capacity::from_options(&options.flags, |name| {
        std::env::var(name).ok()
    })?;
    let dir = existing_deployment(&directory(options)?)?;
    let _early_output=crate::serve_output::Early;
    crate::host_limits::initialize_with(crate::serve_output::early);
    let owner = crate::store_owner::host(&dir.join("store.sqlite"))?;
    let clock_offset = options.flags.get("clock-offset").map(|text| crate::dev_clock::offset(text).map_err(|e| e.to_string())).transpose()?.unwrap_or(0);
    if options.flags.contains_key("clock-offset") {
        let store = owner.open_store(std::time::Duration::from_secs(5)).map_err(|e| e.to_string())?;
        if store.deployment_environment().map_err(|e|e.to_string())?.as_deref() != Some("staging") { return Err(crate::dev_clock::release().to_string()); }
    }
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
            clock_offset,
            expected: current,
            worker,
            owner: std::sync::Arc::new(owner),
        },
        &bind.to_string(),
        listener,
        capacity,
    )
}

/// Ask the current retained owner to stop through its private same-owner
/// control socket, then wait until the store lock proves cleanup completed.
pub fn stop_release(options: &Options) -> i32 {
    let result = (|| {
        if crate::store_config::StoreConfig::resolve(options)?.is_some() {
            return Err("E_STORE_UNSUPPORTED: stop is outside the admitted store profile".into());
        }
        let dir = directory(options)?.canonicalize().map_err(|e|e.to_string())?;
        let store = dir.join("store.sqlite").canonicalize().map_err(|e|e.to_string())?;
        snapback4_core::private_fs::database_metadata(&store).map_err(|e|e.to_string())?
            .ok_or("no existing store.sqlite in the requested directory")?;
        match crate::release_control::request(&dir, crate::release_control::Command::Stop) {
            Ok(_) => {
                crate::store_owner::wait_released(&dir.join("store.sqlite"), std::time::Duration::from_secs(10))?;
                println!("store stopped: {}", dir.display());
                Ok(())
            }
            Err(control) => match crate::store_owner::wait_released(&dir.join("store.sqlite"), std::time::Duration::ZERO) {
                Ok(()) => {
                    println!("store already stopped: {}", dir.display());
                    Ok(())
                }
                Err(_) => Err(control),
            },
        }
    })();
    match result {
        Ok(()) => 0,
        Err(error) => { eprintln!("stop: {error}"); 1 }
    }
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

fn completed_verdict(options:&Options) {
    if let Some(preview)=options.flags.get("release-preview").and_then(|s|serde_json::from_str::<serde_json::Value>(s).ok()) {crate::command_output::preview_decisions(&preview);}
    println!("{} verdict: READY / completed; {}",options.flags.get("output-verb").map(String::as_str).unwrap_or("deploy"),super::security::release_verdict(options.flags.get("security-summary")));
}
fn receipt(release:u64,generation:u64,report:&snapback4_core::store_port::report::AdoptionReport,options:&Options,live:&serde_json::Value){
    crate::command_output::released(options.flags.get("output-verb").map(String::as_str).unwrap_or("deploy"),release,&generation,live,&report.compact());
    crate::command_output::evidence(&serde_json::json!({"release":release,"generation":generation,"live":live,"adoption":report.summary(),"backfills":report.backfills,"preview":options.flags.get("release-preview").and_then(|s|serde_json::from_str::<serde_json::Value>(s).ok())}));
    if options.json {println!("{}",serde_json::json!({"live":live,"sourceRelease":options.flags.get("source-release").and_then(|s|s.parse::<u64>().ok()),"release":release,"generation":generation,"adoption":report.compact(),"details":report.summary(),"backfills":report.backfills,"security":options.flags.get("security-summary").and_then(|s|serde_json::from_str::<serde_json::Value>(s).ok()),"rollbackView":options.flags.get("rollback-view").and_then(|s|serde_json::from_str::<serde_json::Value>(s).ok()),"preview":options.flags.get("release-preview").and_then(|s|serde_json::from_str::<serde_json::Value>(s).ok())}));}
    else {completed_verdict(options);print_live(live);println!("release {release} is current as generation {generation}; {}",report.compact());if let Some(origin)=options.flags.get("source-release"){println!("  retained source {origin} requalified as release {release} to register its current rollback views");}for fill in &report.backfills {println!("  backfill: {fill}");}if options.flags.contains_key("verbose"){println!("{}",report.summary());}}
    crate::command_output::backfills(&serde_json::json!(report.backfills));
}
pub(super) fn latest(dir:&Path)->Result<u64,String>{
    std::fs::read_dir(dir.join("releases")).map_err(|e|e.to_string())?.filter_map(Result::ok)
        .filter_map(|e|e.file_name().to_str()?.parse::<u64>().ok().filter(|n|!super::rollback_views::is_view(dir,*n)&&selectable(dir,*n).is_ok()))
        .max().ok_or("no complete immutable releases".into())
}
pub(super) fn check_release(options:&Options)->i32 {
    let _compile_scope=super::release_compile::Scope::new();
    report("check",(|| {
        let store=PathBuf::from(options.flags.get("store").ok_or("--store required")?);
        let dir=store.parent().ok_or("store has no deployment directory")?;
        let selected=options.flags.get("release").ok_or("--release required")?;
        let n=if selected=="latest"{latest(dir)?}else{selected.parse::<u64>().ok().filter(|n|*n>0).ok_or("--release requires N or latest")?};
        selectable(dir,n)?;
        super::release_preview::preview(&store,dir.join("releases").join(n.to_string()),n,options,None)
    })())
}

pub(super) fn selectable(dir:&Path,release:u64)->Result<(),String> {
    let root=dir.join("releases").join(release.to_string());
    if let Some(view)=super::rollback_views::metadata(&root)? {super::rollback_views::verify(dir,&view)?;return bound_at(root).map(|_|());}
    let store=snapback4_core::store_port::AnyStore::open_read_only(&dir.join("store.sqlite")).map_err(|e|e.to_string())?;
    let history:bool=store.has_release_history()?;
    if history || root.join(".pending-adoption").exists() {
        let committed=if history {store.release_adopted(i64::try_from(release).map_err(|_|"release identity exceeds SQLite range")?)?} else {false};
        if !committed {return Err(format!("release {release} did not complete adoption; select a successful release with --to latest"));}
    }
    bound_at(root).map(|_|())
}

pub(super) fn ordinary_releases(dir:&Path)->Result<Vec<u64>,String>{
    let mut ids=std::fs::read_dir(dir.join("releases")).map_err(|e|e.to_string())?.filter_map(Result::ok).filter_map(|e|e.file_name().to_str()?.parse::<u64>().ok()).filter(|n|!super::rollback_views::is_view(dir,*n)&&selectable(dir,*n).is_ok()).collect::<Vec<_>>();ids.sort_unstable();Ok(ids)
}

pub(crate) fn visibility_policy(root:&Path)->Result<Option<snapback4_core::engine::release::VisibilityPolicy>,String>{
    let Some(view)=super::rollback_views::metadata(root)? else{return Ok(None)};
    let mut hides=Vec::new();for text in view.hides {
        let(table,tail)=text.split_once(" where ").ok_or("invalid rollback hiding declaration")?;
        let(column,reason)=tail.split_once(" = null because ").ok_or("invalid rollback null policy")?;
        if reason.trim().is_empty(){return Err("rollback hiding reason is empty".into())}
        hides.push(snapback4_core::engine::release::HiddenNull{table:table.into(),column:column.into(),reason:reason.into()});
    }
    Ok(Some(snapback4_core::engine::release::VisibilityPolicy{hides}))
}

pub(crate) fn validate_registered_view(dir:&Path,root:&Path)->Result<(),String>{
    if let Some(view)=super::rollback_views::metadata(root)?{
        if root.file_name().and_then(|n|n.to_str()).and_then(|n|n.parse::<u64>().ok())!=Some(view.release){return Err("rollback view directory identity differs from its manifest".into())}
        super::rollback_views::verify(dir,&view)?;
    }Ok(())
}

// @ref LLP 3000.000.000#21-wave-27-release-semantics-rel — workflow source and selected identity are separate facts.
fn live_identity(dir:&Path,release:u64)->Result<serde_json::Value,String>{
    let view=super::rollback_views::metadata(&dir.join("releases").join(release.to_string()))?;
    let mut identity=match view {
        Some(view)=>serde_json::json!({"release":release,"source":view.target,"parent":view.parent,"view":release,"target":view.target,"exact":false}),
        None=>serde_json::json!({"release":release,"source":release,"view":null,"target":release,"exact":true}),
    };
    identity["rowShape"]=super::release_shape::at(dir,release)?;
    Ok(identity)
}
fn print_live(live:&serde_json::Value){
    if live["exact"]==true {println!("live: release {} = exact source {}",live["release"],live["source"]);}
    else {println!("live: release {} = rollback view of release {} (registered by release {}); still runs the registered workflow and current guards",live["release"],live["target"],live["parent"]);
        println!("  view retains the registered workflow and guards; --exact selects original release {}",live["target"]);
        // Short output discloses changes and retained extraction children;
        // a preserved shape is already available in the complete JSON record.
        if live["rowShape"]["matchesTarget"]!=true || live["rowShape"]["children"].as_array().is_some_and(|children|!children.is_empty()) {
            super::release_shape::print(&live["rowShape"]);
        }
    }
}

#[cfg(test)]
mod rel_version_tests {
    #[test]
    fn legacy_view_advice_uses_creator_version_instead_of_manifest_absence() {
        let dir=std::env::temp_dir().join(format!("rel-view-version-{}-{}",std::process::id(),snapback4_core::now_ms()));
        std::fs::create_dir(&dir).unwrap();
        for (version,expected) in [("0.4.38",true),("0.4.39",false),("0.4.40",false),("0.5.0",false),("unknown",false)] {
            std::fs::write(dir.join("provenance.json"),serde_json::to_vec(&serde_json::json!({"cliVersion":version})).unwrap()).unwrap();
            assert_eq!(super::parent_predates_views(&dir),expected,"{version}");
        }
        std::fs::remove_dir_all(dir).unwrap();
    }
}

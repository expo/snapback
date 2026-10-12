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
            if !options.json && (options.flags.contains_key("verbose") || options.flags.contains_key("check")) { println!(
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
            std::fs::write(stage.join("device-compatibility.json"), serde_json::to_vec_pretty(&snapback4_core::device_protocol::compatibility(&bound.schema.public_projection())).map_err(|e| e.to_string())?).map_err(|e| e.to_string())?;
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


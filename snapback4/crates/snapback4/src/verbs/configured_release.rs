//! Minimal public release lifecycle over the resolved store configuration.
// @ref LLP 3000.009.001.000#initial-http-profile-and-public-release-bootstrap — immutable local source, persisted selection, acquired ownership.
use super::*;
use crate::store_config::StoreConfig;
use std::{path::Path, sync::Arc};

pub(super) fn deploy(options: &Options, config: StoreConfig) -> Result<(), String> {
    for flag in [
        "check",
        "staging",
        "save-version",
        "allow-destructive",
        "allow-feed-adoption",
    ] {
        if options.flags.contains_key(flag) {
            return Err(format!(
                "E_STORE_UNSUPPORTED: release-{flag} is outside the admitted store profile"
            ));
        }
    }
    let project = super::proof_source::project(options, "schema")?;
    let sources = super::proof_source::sources(&project, options, "schema")?;
    let bound = compiled_or_exit(
        super::proof_source::compile(&sources, options, "schema"),
        options.json,
    );
    if crate::dev_worker::source(&project).is_some()
        || !crate::dev_worker::declared(&project)?.is_empty()
    {
        return Err("E_STORE_UNSUPPORTED: workers are outside the admitted store profile".into());
    }
    // Validate profile before creating a schema, release tree or durable activation.
    let dir = super::releases::canonical_directory(options)?;
    if dir.join("store.sqlite").exists() {
        return Err("E_STORE_CONFIG: deployment already selects a local store".into());
    }
    let _command = super::releases::command_lock(&dir)?;
    let mut state = config.probe_for_deploy(&dir)?;
    if let Some(state) = &state {
        if dir.join("store-binding.json").is_file() {
            config.validate_binding(&dir, state)?;
        } else {
            config.recover(&dir, state)?;
        }
    }
    let prior = state
        .as_ref()
        .and_then(|s| s.release)
        .map(|n| super::releases::bound_at(dir.join("releases").join(n.to_string())))
        .transpose()?;
    let security_summary=super::security::release_loop(&project, &bound, &sources, prior.as_ref(), state.as_ref().and_then(|s|s.release).map(|n|Project{root:dir.join("releases").join(n.to_string())}.sources()).transpose().map_err(|e|e.to_string())?.as_deref(), options)?;
    super::security::print_release(security_summary.as_ref());
    super::security::enforce_release(security_summary.as_ref(),options)?;
    let programs = bound
        .programs
        .iter()
        .map(|p| (p.program.name.clone(), p.program.clone()))
        .collect();
    if state.is_none() {
        // The intent is durable before the bootstrap transaction. Creating its
        // handle makes no database writes; Engine admission precedes bootstrap.
        let id = config.pending(&dir, true)?;
        let store = config.create(&id)?;
        store
            .admit(&bound.schema, &programs)
            .map_err(crate::store_config::redact)?;
        // Bootstrap establishes the logical identity and initial generation only.
        // Selection/history below always run under a positive acquired token.
        let bootstrap = snapback4_core::Engine::new_at(
            store,
            bound.schema.clone(),
            bound.programs.iter().map(|p| p.program.clone()),
            snapback4_core::now_ms(),
        )
        .map_err(crate::store_config::redact)?;
        let observed = bootstrap
            .store()
            .store_identity()
            .map_err(crate::store_config::redact)?
            .ok_or("store identity absent")?;
        if observed != id {
            return Err("E_STORE_CONFIG: bootstrap identity differs from pending intent; restore the original store and retry deploy".into());
        }
        drop(bootstrap);
        state = config.probe()?;
        config.recover(&dir, state.as_ref().ok_or("bootstrap did not establish store identity")?)?;
    }
    let state = state.ok_or("bootstrap did not establish store identity")?;
    let owner = config.acquire(&state.store_id)?;
    let store = owner.open().map_err(crate::store_config::redact)?;
    store
        .admit(&bound.schema, &programs)
        .map_err(crate::store_config::redact)?;
    let previous = store
        .release_value()
        .map_err(crate::store_config::redact)?
        .map(|r| r.parse::<u64>().map_err(|_| "invalid persisted release"))
        .transpose()?;
    if let Some(n) = previous {
        let old = super::releases::bound_at(dir.join("releases").join(n.to_string()))?;
        if old.schema == bound.schema
            && old
                .programs
                .iter()
                .map(|p| &p.program)
                .eq(bound.programs.iter().map(|p| &p.program))
        {
            if options.json {
                println!(
                    "{}",
                    serde_json::json!({"unchanged":true,"release":n,"generation":state.generation,"store_id":state.store_id})
                );
            } else {
                crate::command_output::summary(format!("deploy: unchanged; release {n}, generation {}",state.generation));
                println!(
                    "unchanged; release {n} stays current as generation {}",
                    state.generation
                );
            }
            super::security::remember_write_release(&project,&sources);
            return Ok(());
        }
    }
    let release_root = dir.join("releases");
    snapback4_core::private_fs::directory(&release_root).map_err(|e| e.to_string())?;
    let n = std::fs::read_dir(&release_root)
        .map_err(|e| e.to_string())?
        .filter_map(Result::ok)
        .filter_map(|e| e.file_name().to_str()?.parse::<u64>().ok())
        .max()
        .unwrap_or(0)
        .checked_add(1)
        .ok_or("release identity exhausted")?;
    let root = release_root.join(n.to_string());
    snapback4_core::private_fs::directory(&root.join("snapback")).map_err(|e| e.to_string())?;
    for (name, text) in &sources {
        std::fs::write(root.join("snapback").join(name), text).map_err(|e| e.to_string())?;
    }
    let staged = super::releases::bound_at(root.clone())?;
    if staged.schema != bound.schema {
        return Err("staged release differs".into());
    }
    config.record(&root, &state.store_id)?;
    crate::release_files::durable(&root)?;
    std::fs::File::open(&release_root)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    std::fs::File::open(&dir)
        .and_then(|f| f.sync_all())
        .map_err(|e| e.to_string())?;
    let mut pointer = crate::release_files::Pointer::prepare(&dir, n, previous, false)?;
    let activation = snapback4_core::engine::release::ReleaseActivation {
        release: n,
        expected_previous: previous,
        expected_revision: Some(state.revision),
        restore_dormant: options.flags.contains_key("restore-dormant"),
        native_digest: None,
        operation: "deploy".into(),
        // Postgres admits same-schema deployment; rollback/evolution remain S10-owned refusals.
        visibility: None,
    };
    let result = snapback4_core::Engine::new_release_prepared(
        store,
        staged.schema,
        staged.programs.into_iter().map(|p| p.program),
        &activation,
        false,
    );
    let engine = match result {
        Ok(engine) => engine,
        Err(error) => {
            if matches!(error, snapback4_core::RuntimeError::CommitOutcomeUnknown(_)) {
                if let Ok(Some(observed)) = config.probe() {
                    if observed.store_id == state.store_id && observed.release == Some(n) {
                        // @ref LLP 3000.009.001.000#5.1 — reconcile from the persisted selection snapshot without reopening the sticky G6 writer epoch.
                        let generation = observed.generation;
                        pointer.finish(generation)?;
                        crate::command_output::summary(format!("deploy: release {n} current, generation {generation}; uncertain commit reconciled from persisted selection"));
                        if options.json {
                            println!(
                                "{}",
                                serde_json::json!({"release":n,"generation":generation,"store_id":state.store_id,"resolvedUnknownCommit":true})
                            );
                        } else {
                            println!(
                                "release {n} is current as generation {}; resolved unknown COMMIT from persisted activation",
                                generation
                            );
                        }
                        super::security::remember_write_release(&project,&sources);
                        return Ok(());
                    }
                }
            }
            // Unknown COMMIT keeps exact source. No activation retry or source cleanup
            // occurs until persisted selection/history can establish the outcome.
            if !crate::store_config::retain_candidate(&error) {
                let _ = std::fs::remove_dir_all(&root);
            }
            return Err(crate::store_config::redact(error));
        }
    };
    let store_id = engine
        .store()
        .store_identity()
        .map_err(crate::store_config::redact)?
        .ok_or("store identity absent")?;
    config.record(&dir, &store_id)?;
    pointer.finish(engine.generation())?;
    super::security::remember_write_release(&project,&sources);
    crate::command_output::summary(format!("deploy: release {n} current, generation {}",engine.generation()));
    if options.json {
        println!(
            "{}",
            serde_json::json!({"release":n,"generation":engine.generation(),"store_id":store_id})
        );
    } else {
        println!(
            "release {n} is current as generation {}",
            engine.generation()
        );
    }
    Ok(())
}

pub(super) fn serve(options: &Options, config: StoreConfig) -> Result<(), String> {
    if options
        .flags
        .keys()
        .any(|f| matches!(f.as_str(), "worker" | "clock-offset" | "wait-stopped"))
    {
        return Err("E_STORE_UNSUPPORTED: worker/clock/barrier options are outside the admitted store profile".into());
    }
    let requested = options
        .positionals
        .first()
        .ok_or("deployment directory required")?;
    let dir = Path::new(requested)
        .canonicalize()
        .map_err(|e| e.to_string())?;
    let state = config.probe()?.ok_or("no store; deploy first")?;
    config.validate_binding(&dir, &state)?;
    let owner = Arc::new(config.acquire(&state.store_id)?);
    // Re-read selection after acquisition: a concurrent deploy may have won first.
    let store = owner.open().map_err(crate::store_config::redact)?;
    let current = store
        .release_value()
        .map_err(crate::store_config::redact)?
        .and_then(|r| r.parse::<u64>().ok())
        .ok_or("no selected release")?;
    let root = dir
        .join("releases")
        .join(current.to_string())
        .canonicalize()
        .map_err(|_| "selected immutable release source is missing")?;
    let state = owner.config.probe()?.ok_or("store disappeared")?;
    owner.config.validate_binding(&root, &state)?;
    let project = Project { root };
    let bound = super::releases::bound_at(project.root.clone())?;
    if crate::dev_worker::source(&project).is_some()
        || !crate::dev_worker::declared(&project)?.is_empty()
    {
        return Err("E_STORE_UNSUPPORTED: workers are outside the admitted store profile".into());
    }
    let _engine = project
        .open_release_engine(store, &bound, current, snapback4_core::now_ms())
        .map_err(crate::store_config::redact)?;
    owner.worker_state(_engine.store())?;
    drop(_engine);
    let bind = super::releases::release_bind(options)?;
    let requested_port =
        crate::port_flag::parse("serve", options.flags.get("port").map(String::as_str))?;
    let capacity = crate::host_limits::Capacity::from_options(&options.flags, |name| {
        std::env::var(name).ok()
    })?;
    // Ownership, source and state validation all precede binding the listener.
    let (port, listener) = crate::port_flag::listen("serve", requested_port, bind, None)?;
    crate::serve::serve(
        project,
        port,
        crate::serve::Mode::ConfiguredRelease {
            expected: current,
            owner,
        },
        &bind.to_string(),
        listener,
        capacity,
    )
}

pub(super) fn doctor(options: &Options, config: StoreConfig) -> Result<(), String> {
    let state = config.probe()?.ok_or("no deployed store")?;
    if let Some(dir) = options.flags.get("release") {
        config.validate_binding(Path::new(dir), &state)?;
    }
    let (tier,warnings)=config.diagnostics()?;
    eprintln!("snapback4: {tier}");
    for warning in &warnings { eprintln!("{warning}"); }
    println!(
        "{}",
        serde_json::json!({"backend":"postgres", "store":state, "binding":config.binding, "profile":"initial-http", "ha":"none", "certifiedChanges":true, "readCacheTier":tier, "warnings":warnings, "commitMode":if config.early_lock_release {"early-lock-release"} else {"synchronous"}})
    );
    Ok(())
}

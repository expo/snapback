//! Owner-mediated release publication in the running HTTP process.
use super::*;
use crate::release_control::Command;
#[cfg(unix)]
use crate::release_control::Listener;
use snapback4_core::engine::release::ReleaseActivation;

#[cfg(unix)]
pub(super) fn start(
    shared: Arc<Shared>,
    dir: std::path::PathBuf,
) -> Result<std::thread::JoinHandle<()>, String> {
    let store = shared
        .owner
        .as_ref()
        .ok_or("release control requires a persisted owner")?
        .path()
        .map_err(|e| e.to_string())?;
    let listener = Listener::bind(&dir, store)?;
    crate::lifecycle::managed_cleanup();
    crate::lifecycle::background("release-control", move || {
        listener.run(|command| apply(&shared, &dir, command))
    })
}

// @ref LLP 3000.000.000#5-hot-activation-and-ownership — only assignments and committed rebind follow the database commit.
pub(super) fn apply(
    shared: &Shared,
    dir: &std::path::Path,
    command: Command,
) -> Result<Json, String> {
    match command {
        Command::Status {
            after,
            items_after,
            event,
        } => lock(&shared.engine)
            .store_mut()
            .release_status(after, items_after.as_deref(), event)
            .map_err(|e| e.to_string()),
        Command::Prune {
            confirm,
            expected_revision,
        } => {
            let mut result = lock(&shared.engine)
                .store_mut()
                .prune_dormant(confirm, Some(expected_revision))
                .map_err(|e| e.to_string())?;
            if let Some(items) = result["items"].as_array_mut() {
                items.truncate(16);
            }
            result["items_after"] = result["items"]
                .as_array()
                .and_then(|items| items.last())
                .map(|i| i["key"].clone())
                .unwrap_or(Json::Null);
            Ok(result)
        }
        Command::Activate {
            release,
            expected_release,
            expected_revision,
            digest,
            rollback,
            restore_dormant,
            allow_feed_adoption,
        } => {
            if release == 0 {
                return Err("release id must be positive".into());
            }
            let project = Project {
                root: dir.join("releases").join(release.to_string()),
            };
            if !std::fs::symlink_metadata(&project.root)
                .is_ok_and(|m| m.is_dir() && !m.file_type().is_symlink())
            {
                return Err(format!(
                    "release {release} is not an immutable release directory"
                ));
            }
            if crate::release_files::digest(&project.root)? != digest {
                return Err("staged release content changed; redeploy its exact source".into());
            }
            if project.sources().map_err(|e| e.to_string())?.is_empty() {
                return Err(format!(
                    "release {release} has no Quarry source; select a complete immutable release"
                ));
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
            let prepared = crate::native::prepare(&project, &bound).map_err(|e| e.to_string())?;
            crate::dev_worker::prepare_release(&project, &bound.schema)?;
            crate::release_files::link_store(&project.root)?;
            if crate::release_files::digest(&project.root)? != digest {
                return Err("release artifacts changed during preparation; retry after inspecting immutable source".into());
            }
            crate::release_files::durable(&project.root)?;
            let mut pointer =
                crate::release_files::Pointer::prepare(dir, release, expected_release, rollback)?;
            let options = ReleaseActivation {
                release,
                expected_previous: expected_release,
                expected_revision: Some(expected_revision),
                restore_dormant,
                native_digest: prepared.installed.as_ref().map(|m| m.digest.clone()),
                operation: if rollback { "rollback" } else { "deploy" }.into(),
            };
            let _requests=shared.release_requests.write();
            let mut engine = lock(&shared.engine);
            lock(&shared.readers).begin_adoption(&bound);
            let generation = match engine.adopt_release(
                bound.schema.clone(),
                bound.programs.iter().map(|p| p.program.clone()),
                &options,
                allow_feed_adoption,
            ) {
                Ok(generation) => generation,
                Err(error) => {
                    lock(&shared.readers).finish_adoption();
                    return Err(error.to_string());
                }
            };
            #[cfg(test)]
            test_work(&shared.release_committed);
            engine.set_prepared_native(prepared.module);
            engine.set_presence(Some(shared.presence.clone()));
            shared.refresh_time_audience_clock(&engine, shared.now());
            lock(&shared.readers).replace(&engine, &bound.refusal_sites);
            {
                let mut active = lock(&shared.bound);
                let mut advertised = lock(&shared.generation);
                let mut native = lock(&shared.native);
                shared.latency.adopt(&bound);
                *active = bound;
                *advertised = generation;
                *native = prepared.installed;
                let mut root = lock(&shared.release_root);
                *root = Some(project.root);
                shared.worker_revision.fetch_add(1, Ordering::Release);
            }
            crate::lifecycle::generation(generation);
            shared.publish_engine(&engine);
            // Completion I/O can fail, but never abandons the new runtime.
            pointer.finish(generation)?;
            snapback4_core::diagnostic!(
                "snapback4 serve: release {release} activated without restart as generation {generation}"
            );
            Ok(
                json!({"release":release,"generation":generation,"revision":expected_revision+1,"hot":true,"adoption":engine.store().adoption_report.compact(),"details":engine.store().adoption_report.summary()}),
            )
        }
    }
}

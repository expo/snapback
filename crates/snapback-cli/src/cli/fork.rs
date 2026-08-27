use super::*;

fn fork_root(app_root: &Path, requested: Option<PathBuf>) -> anyhow::Result<PathBuf> {
    let requested = requested.unwrap_or_else(|| app_root.join(".snapback/forks"));
    std::fs::create_dir_all(&requested)
        .with_context(|| format!("failed to create fork root {}", requested.display()))?;
    std::fs::canonicalize(&requested)
        .with_context(|| format!("failed to resolve fork root {}", requested.display()))
}

pub(crate) fn parse_fork_ttl(raw: &str) -> anyhow::Result<u64> {
    let (number, multiplier) = if let Some(value) = raw.strip_suffix("ms") {
        (value, 1_u64)
    } else if let Some(value) = raw.strip_suffix('s') {
        (value, 1_000)
    } else if let Some(value) = raw.strip_suffix('m') {
        (value, 60_000)
    } else if let Some(value) = raw.strip_suffix('h') {
        (value, 3_600_000)
    } else if let Some(value) = raw.strip_suffix('d') {
        (value, 86_400_000)
    } else {
        anyhow::bail!("SNAPBACK_FORK_TTL_INVALID: use a finite duration such as 30m or 2h");
    };
    let amount = number
        .parse::<u64>()
        .context("SNAPBACK_FORK_TTL_INVALID: duration amount is not an integer")?;
    let ttl = amount
        .checked_mul(multiplier)
        .context("SNAPBACK_FORK_TTL_INVALID: duration is too large")?;
    anyhow::ensure!(
        ttl > 0,
        "SNAPBACK_FORK_TTL_INVALID: duration must be positive"
    );
    Ok(ttl)
}

pub(crate) fn now_ms() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|elapsed| {
            elapsed
                .as_millis()
                .min(crate::manifest::PORTABLE_TIMESTAMP_MAX_MS.into()) as u64
        })
        .unwrap_or(0)
}

pub(crate) async fn wait_for_derived_fork_expiry(
    database: Option<PathBuf>,
    lineage: Option<crate::instance_fork::DerivedForkLineageV1>,
) -> (crate::instance_fork::DerivedForkLineageV1, u64) {
    let Some(lineage) = lineage else {
        return std::future::pending().await;
    };
    let Some(mut expires_at_ms) = lineage.expires_at_ms else {
        return std::future::pending().await;
    };
    loop {
        let observed_at_ms = now_ms();
        if observed_at_ms >= expires_at_ms {
            // A completed `fork renew` moves the database lineage, which is
            // the expiry authority — the boot-time copy is only a schedule.
            // Mid-renewal reads (sentinel window, carrier rewrite) fail
            // transiently, so retry briefly before accepting expiry.
            let mut renewed_to = None;
            if let Some(database) = database.as_deref() {
                for _ in 0..40 {
                    match crate::instance_fork::refreshed_lineage(database) {
                        Ok(Some(current))
                            if current
                                .expires_at_ms
                                .is_some_and(|expiry| expiry > observed_at_ms) =>
                        {
                            renewed_to = current.expires_at_ms;
                            break;
                        }
                        Ok(_) => break,
                        Err(_) => {
                            tokio::time::sleep(std::time::Duration::from_millis(250)).await;
                        }
                    }
                }
            }
            match renewed_to {
                Some(new_expiry) => {
                    eprintln!(
                        "SNAPBACK_FORK_SERVER_RENEWAL_OBSERVED: expiry watchdog refreshed \
                         {expires_at_ms} -> {new_expiry}"
                    );
                    expires_at_ms = new_expiry;
                    continue;
                }
                None => return (lineage, observed_at_ms),
            }
        }
        let delay_ms = expires_at_ms.saturating_sub(observed_at_ms).clamp(1, 1_000);
        tokio::time::sleep(std::time::Duration::from_millis(delay_ms)).await;
    }
}

fn source_from_path(path: &Path) -> anyhow::Result<(PathBuf, String, String)> {
    let mut prefix = [0_u8; 16];
    let looks_sqlite = std::fs::File::open(path)
        .and_then(|mut file| file.read_exact(&mut prefix))
        .is_ok()
        && &prefix == b"SQLite format 3\0";
    if !looks_sqlite
        && let Ok(value) = read_trusted_json_file(path)
        && let Ok(descriptor) = HostReadyDescriptor::validate(&value)
    {
        verify_owned_fork_target(&descriptor, &fetch_health(&descriptor.server_url))
            .map_err(|diagnostic| anyhow::anyhow!("{}: {}", diagnostic.code, diagnostic.message))?;
        let database = descriptor
            .database
            .path
            .as_deref()
            .map(PathBuf::from)
            .context("SNAPBACK_FORK_SOURCE_INVALID: in-memory servers cannot be forked")?;
        let database = std::fs::canonicalize(&database).with_context(|| {
            format!(
                "SNAPBACK_FORK_SOURCE_INVALID: cannot resolve {}",
                database.display()
            )
        })?;
        // The ready descriptor records bind-time identity and may predate a
        // later manifest load. The snapshot's persisted schema is the fork's
        // actual logical-app identity.
        let app_id = crate::instance_fork::stored_app_id(&database)?;
        return Ok((database, app_id, descriptor.startup_id));
    }
    let database = std::fs::canonicalize(path).with_context(|| {
        format!(
            "SNAPBACK_FORK_SOURCE_INVALID: cannot resolve {}",
            path.display()
        )
    })?;
    anyhow::ensure!(
        database.is_file(),
        "SNAPBACK_FORK_SOURCE_INVALID: source is not a file"
    );
    let app_id = crate::instance_fork::stored_app_id(&database)?;
    let parent_instance_id = crate::instance_fork::source_parent_instance_id(&database)?;
    Ok((database, app_id, parent_instance_id))
}

fn fork_envelope(
    operation: &str,
    app_id: String,
    app_root: Option<&Path>,
    server_url: Option<String>,
    data: Value,
) -> HostOpsResult {
    fork_envelope_with_diagnostics(operation, app_id, app_root, server_url, data, Vec::new())
}

fn fork_envelope_with_diagnostics(
    operation: &str,
    app_id: String,
    app_root: Option<&Path>,
    server_url: Option<String>,
    data: Value,
    diagnostics: Vec<crate::diagnostic::Diagnostic>,
) -> HostOpsResult {
    HostOpsResult {
        schema_version: SNAPBACK_SCHEMA_VERSION.to_owned(),
        result_kind: HOST_OPS_RESULT_KIND.to_owned(),
        request_id: crate::ids::mint_time_ordered(crate::ids::Kind::HostOperation),
        operation: operation.to_owned(),
        ok: true,
        target: crate::host_ops::HostOpsTarget {
            app_id,
            app_root: app_root.map(|path| path.display().to_string()),
            target_profile: "local-dev-sqlite-ibex".to_owned(),
            server_url,
        },
        authority: None,
        artifacts: HostOpsArtifacts::default(),
        data,
        diagnostics,
        next: Vec::new(),
        secret_read_tables: Vec::new(),
        secret_read_rows: 0,
        secret_read_query: false,
        secret_read_provenance_complete: true,
    }
}

/// The honest asset-custody fact for one fork directory: a fork of an
/// asset-bearing parent carries a digest-verified private blob tree from the
/// same cut; a fork of an asset-free parent simply has none.
fn fork_asset_custody(destination: &Path) -> &'static str {
    let blobs = destination.join("assets").join("blobs");
    match std::fs::read_dir(&blobs) {
        Ok(mut entries) => {
            if entries.next().is_some() {
                "fork-private-same-cut"
            } else {
                "no-assets"
            }
        }
        Err(_) => "no-assets",
    }
}

pub(crate) fn fork_secret_disposition(with_secrets: bool, database: &Path) -> &'static str {
    if crate::config::ConfigStore::path_for_database(database).is_file() {
        "copied-explicitly"
    } else if with_secrets {
        "copy-requested-source-absent"
    } else {
        "scrubbed"
    }
}

fn managed_fork_secret_disposition(
    target: &crate::instance_fork::ManagedForkTargetV1,
) -> &'static str {
    match target.receipt.custody.get("sidecar:*.config.json").copied() {
        Some(crate::instance_fork::CustodyDisposition::Copy)
            if crate::config::ConfigStore::path_for_database(&target.database).is_file() =>
        {
            "copied-explicitly"
        }
        Some(crate::instance_fork::CustodyDisposition::Copy) => "copy-requested-source-absent",
        _ => "scrubbed",
    }
}

#[derive(Default)]
struct ForkProjectionScalars {
    url: Option<String>,
    fork_id: Option<String>,
    database_path: Option<String>,
    ready_path: Option<String>,
    admin_token_path: Option<String>,
}

fn print_fork_projection(
    format: ForkOutputFormat,
    envelope: &HostOpsResult,
    scalars: &ForkProjectionScalars,
) -> anyhow::Result<()> {
    if format == ForkOutputFormat::Json {
        print_envelope(&serde_json::to_value(envelope)?);
        return Ok(());
    }
    let value = match format {
        ForkOutputFormat::Json => unreachable!(),
        ForkOutputFormat::Url => scalars.url.as_deref(),
        ForkOutputFormat::ForkId => scalars.fork_id.as_deref(),
        ForkOutputFormat::DatabasePath => scalars.database_path.as_deref(),
        ForkOutputFormat::ReadyPath => scalars.ready_path.as_deref(),
        ForkOutputFormat::AdminTokenPath => scalars.admin_token_path.as_deref(),
    };
    let value = value.context(
        "SNAPBACK_FORK_PROJECTION_UNAVAILABLE: requested scalar is not available for this fork",
    )?;
    println!("{value}");
    Ok(())
}

fn resolve_fork_destination(root: &Path, requested: PathBuf) -> anyhow::Result<PathBuf> {
    let destination = if requested.is_absolute() {
        requested
    } else {
        root.join(requested)
    };
    let parent = destination
        .parent()
        .context("SNAPBACK_FORK_PATH_INVALID: fork destination has no parent")?;
    anyhow::ensure!(
        std::fs::canonicalize(parent)? == root,
        "SNAPBACK_FORK_PATH_INVALID: destination must be a direct child of the fork root"
    );
    anyhow::ensure!(
        destination.file_name().is_some(),
        "SNAPBACK_FORK_PATH_INVALID: destination must have a direct-child name"
    );
    Ok(destination)
}

#[derive(Debug, Default)]
pub(crate) struct ForkReapOutcome {
    reaped: Vec<String>,
    cleared_stale_registry: Vec<String>,
}

/// Reap every expired fork and complete any partial cleanup, tolerating
/// concurrent lifecycle actors: an entry that disappears mid-sweep was
/// cleaned up by its other owner, and a registry entry whose directory is
/// already gone is stale bookkeeping to clear, never a reason to wedge the
/// remaining forks' cleanup (LLP 0185 Phase 3 item 5).
fn reap_managed_forks(
    root: &Path,
    expected: &crate::instance_fork::ExpectedForkAppV1,
    now_ms: u64,
) -> anyhow::Result<ForkReapOutcome> {
    let mut outcome = ForkReapOutcome::default();
    for fork_id in crate::instance_fork::managed_registry_ids(root)? {
        // Holding the cleanup lock across bind → stop → drop means a
        // concurrent drop/reap either finished before we bound (observed as
        // NOT_FOUND) or waits until we finish — never a torn mid-teardown.
        let lock = crate::instance_fork::lock_cleanup(root, &fork_id)?;
        match crate::instance_fork::managed_target(root, &fork_id, expected) {
            Ok(target) => {
                let expired = target
                    .entry
                    .lineage
                    .expires_at_ms
                    .is_some_and(|expires| expires <= now_ms);
                if !expired {
                    // Release the flock but retain its inode while the fork
                    // remains live. Unlinking a lock with queued waiters can
                    // split later actors across old and newly-created inodes.
                    continue;
                }
                if let Some(ready) = target.ready_file.as_deref() {
                    let _ = quiet_stop_fork(ready, &target.database)?;
                }
                crate::instance_fork::drop_managed_locked(root, &fork_id, expected)?;
                outcome.reaped.push(fork_id);
                lock.dispose();
            }
            Err(error) if error.diagnostic.code == "SNAPBACK_FORK_NOT_FOUND" => {
                lock.dispose();
            }
            Err(error)
                if matches!(
                    error.diagnostic.code.as_str(),
                    crate::instance_fork::APP_BINDING_REQUIRED_CODE
                        | crate::instance_fork::APP_BINDING_MISMATCH_CODE
                ) =>
            {
                // A shared explicit root can contain other apps' entries.
                // They are invisible and ineligible to this app's sweep.
                // Keep the live fork's stable lock inode for its owner.
            }
            Err(error) if error.diagnostic.code == "SNAPBACK_FORK_REGISTRY_STALE" => {
                crate::instance_fork::clear_stale_registry_entry_locked(root, &fork_id, expected)?;
                outcome.cleared_stale_registry.push(fork_id);
                lock.dispose();
            }
            Err(error) => return Err(error.into()),
        }
    }
    outcome.reaped.sort();
    outcome.cleared_stale_registry.sort();
    Ok(outcome)
}

pub(crate) fn automatic_reap_before_create(
    root: &Path,
    expected: &crate::instance_fork::ExpectedForkAppV1,
    observed_at_ms: u64,
) -> anyhow::Result<ForkReapOutcome> {
    reap_managed_forks(root, expected, observed_at_ms).map_err(|error| {
        anyhow::Error::new(
            crate::diagnostic::SnapbackError::error(
                "SNAPBACK_FORK_EXPIRED_REAP_FAILED",
                "instanceFork",
                "create refused: expired managed fork(s) were present and could not all be swept",
            )
            .with_details(json!({
                "observedAtMs": observed_at_ms,
                "cause": error.to_string(),
            })),
        )
    })
}

fn fork_process_health(
    target: &crate::instance_fork::ManagedForkTargetV1,
) -> (Value, Vec<crate::diagnostic::Diagnostic>, Option<String>) {
    let Some(ready_file) = target.ready_file.as_deref() else {
        return (
            json!({
                "status": "not-recorded",
                "responding": false,
                "pid": null,
                "checkedAtMs": now_ms(),
            }),
            Vec::new(),
            None,
        );
    };
    if !ready_file.is_file() {
        return (
            json!({
                "status": "stale-ready-file",
                "responding": false,
                "pid": null,
                "checkedAtMs": now_ms(),
            }),
            vec![
                crate::diagnostic::Diagnostic::warning(
                    "SNAPBACK_FORK_REGISTRY_STALE",
                    "instanceFork",
                    "registry records a ready file that no longer exists",
                )
                .with_details(json!({ "readyFile": ready_file })),
            ],
            None,
        );
    }
    let descriptor = match read_trusted_json_file(ready_file)
        .ok()
        .and_then(|value| HostReadyDescriptor::validate(&value).ok())
    {
        Some(descriptor) => descriptor,
        None => {
            return (
                json!({
                    "status": "unverifiable",
                    "responding": false,
                    "pid": null,
                    "checkedAtMs": now_ms(),
                }),
                vec![
                    crate::diagnostic::Diagnostic::warning(
                        "SNAPBACK_FORK_READY_INVALID",
                        "instanceFork",
                        "recorded fork readiness descriptor is missing or malformed",
                    )
                    .with_details(json!({ "readyFile": ready_file })),
                ],
                None,
            );
        }
    };
    if let Err(error) = verify_fork_ready_database(&descriptor, &target.database) {
        return (
            json!({
                "status": "unverifiable",
                "responding": false,
                "pid": descriptor.pid,
                "checkedAtMs": now_ms(),
            }),
            vec![
                crate::diagnostic::Diagnostic::warning(
                    "SNAPBACK_FORK_READY_INVALID",
                    "instanceFork",
                    "recorded readiness descriptor is not bound to the fork database",
                )
                .with_details(json!({ "reason": error.to_string() })),
            ],
            None,
        );
    }
    let health = fetch_health(&descriptor.server_url);
    if verify_live_descriptor_identity(&descriptor, &health, "fork.inspect").is_ok() {
        return (
            json!({
                "status": "responding",
                "responding": true,
                "pid": descriptor.pid,
                "checkedAtMs": now_ms(),
                "serverUrl": descriptor.server_url,
            }),
            Vec::new(),
            Some(descriptor.server_url),
        );
    }
    match process_is_proven_gone(descriptor.pid) {
        Ok(true) => (
            json!({
                "status": "stopped",
                "responding": false,
                "pid": descriptor.pid,
                "checkedAtMs": now_ms(),
                "serverUrl": descriptor.server_url,
            }),
            vec![
                crate::diagnostic::Diagnostic::warning(
                    "SNAPBACK_FORK_REGISTRY_STALE",
                    "instanceFork",
                    "fork process is gone but its recorded ready descriptor remains",
                )
                .with_details(json!({ "pid": descriptor.pid })),
            ],
            Some(descriptor.server_url),
        ),
        Ok(false) | Err(_) => (
            json!({
                "status": "unverifiable",
                "responding": false,
                "pid": descriptor.pid,
                "checkedAtMs": now_ms(),
                "serverUrl": descriptor.server_url,
            }),
            vec![
                crate::diagnostic::Diagnostic::warning(
                    "SNAPBACK_FORK_STOP_UNVERIFIED",
                    "instanceFork",
                    "fork PID may still be live, but its process identity cannot be verified",
                )
                .with_details(json!({ "pid": descriptor.pid })),
            ],
            Some(descriptor.server_url),
        ),
    }
}

#[cfg(unix)]
pub(crate) fn process_is_proven_gone(pid: u32) -> anyhow::Result<bool> {
    if unsafe { libc::kill(pid as i32, 0) } == 0 {
        return Ok(false);
    }
    match std::io::Error::last_os_error().raw_os_error() {
        Some(libc::ESRCH) => Ok(true),
        Some(libc::EPERM) => Ok(false),
        other => anyhow::bail!(
            "SNAPBACK_FORK_STOP_UNVERIFIED: cannot determine whether pid {pid} exists (errno {other:?})"
        ),
    }
}

#[cfg(not(unix))]
pub(crate) fn process_is_proven_gone(_pid: u32) -> anyhow::Result<bool> {
    Ok(false)
}

fn verify_fork_ready_database(
    descriptor: &HostReadyDescriptor,
    expected_database: &Path,
) -> anyhow::Result<()> {
    let declared = descriptor
        .database
        .path
        .as_deref()
        .map(Path::new)
        .context("SNAPBACK_FORK_READY_INVALID: fork descriptor has no database path")?;
    let declared = std::fs::canonicalize(declared)
        .context("SNAPBACK_FORK_READY_INVALID: fork descriptor database path cannot be resolved")?;
    anyhow::ensure!(
        declared == expected_database,
        "SNAPBACK_FORK_READY_INVALID: fork descriptor names a different database"
    );
    Ok(())
}

fn remove_ready_after_process_gone(ready_file: &Path) -> anyhow::Result<()> {
    match std::fs::remove_file(ready_file) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error)
            .context("SNAPBACK_FORK_READY_INVALID: failed to remove proven-stale ready file"),
    }
}

pub(crate) fn quiet_stop_fork(
    ready_file: &Path,
    expected_database: &Path,
) -> anyhow::Result<Option<u32>> {
    if !ready_file.exists() {
        anyhow::bail!(
            "SNAPBACK_FORK_STOP_UNVERIFIED: readiness descriptor is missing, so process absence cannot be proved"
        );
    }
    let value = read_trusted_json_file(ready_file)?;
    let descriptor = HostReadyDescriptor::validate(&value).map_err(|problems| {
        anyhow::anyhow!("SNAPBACK_FORK_READY_INVALID: {}", problems.join("; "))
    })?;
    verify_fork_ready_database(&descriptor, expected_database)?;
    if let Err(diagnostic) =
        verify_owned_fork_target(&descriptor, &fetch_health(&descriptor.server_url))
    {
        if process_is_proven_gone(descriptor.pid)? {
            remove_ready_after_process_gone(ready_file)?;
            return Ok(None);
        }
        anyhow::bail!(
            "SNAPBACK_FORK_STOP_UNVERIFIED: pid {} may still exist; {}: {}",
            descriptor.pid,
            diagnostic.code,
            diagnostic.message
        );
    }
    let signalled = std::process::Command::new("kill")
        .arg(descriptor.pid.to_string())
        .status()
        .context("failed to signal fork server")?
        .success();
    if !signalled {
        // The server can exit between identity verification and the signal
        // (self-shutdown at expiry, or a concurrent stop). Losing that race
        // is a completed stop, not a failure.
        if process_is_proven_gone(descriptor.pid)? {
            remove_ready_after_process_gone(ready_file)?;
            return Ok(None);
        }
        anyhow::bail!("SNAPBACK_FORK_STOP_FAILED: fork server did not accept SIGTERM");
    }
    for _ in 0..40 {
        if fetch_health(&descriptor.server_url).is_err() {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(50));
    }
    for _ in 0..200 {
        if process_is_proven_gone(descriptor.pid)? {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(25));
    }
    anyhow::ensure!(
        process_is_proven_gone(descriptor.pid)?,
        "SNAPBACK_FORK_STOP_TIMEOUT: fork server process did not exit"
    );
    remove_ready_after_process_gone(ready_file)?;
    Ok(Some(descriptor.pid))
}

#[cfg(unix)]
fn detached_child_descriptor_ceiling() -> i32 {
    let observed = ["/proc/self/fd", "/dev/fd"]
        .into_iter()
        .find_map(|directory| std::fs::read_dir(directory).ok())
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| entry.file_name().to_str()?.parse::<i32>().ok())
        .max();
    if let Some(maximum) = observed {
        return maximum.saturating_add(1).max(3);
    }

    let mut limit = std::mem::MaybeUninit::<libc::rlimit>::uninit();
    if unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, limit.as_mut_ptr()) } == 0 {
        let current = unsafe { limit.assume_init() }.rlim_cur;
        return current.min(65_536) as i32;
    }
    1_024
}

#[cfg(unix)]
pub(crate) fn configure_detached_child(command: &mut std::process::Command) {
    use std::os::unix::process::CommandExt as _;

    let descriptor_ceiling = detached_child_descriptor_ceiling();
    // @ref LLP 0158#lifecycle-and-gc — the detached server outlives the
    // short create CLI, so it must not also prolong arbitrary caller-owned
    // pipes or locks that happened to cross the CLI's own exec boundary.
    unsafe {
        command.pre_exec(move || {
            for descriptor in 3..descriptor_ceiling {
                loop {
                    if libc::fcntl(descriptor, libc::F_SETFD, libc::FD_CLOEXEC) == 0 {
                        break;
                    }
                    let error = std::io::Error::last_os_error();
                    match error.raw_os_error() {
                        Some(libc::EBADF) => break,
                        Some(libc::EINTR) => continue,
                        _ => return Err(error),
                    }
                }
            }
            if libc::setsid() == -1 {
                return Err(std::io::Error::last_os_error());
            }
            Ok(())
        });
    }
}

pub(crate) async fn fork_command(command: ForkCommand) -> anyhow::Result<()> {
    fork_command_with_clock(command, now_ms).await
}

async fn fork_command_with_clock<F>(command: ForkCommand, clock: F) -> anyhow::Result<()>
where
    F: Fn() -> u64,
{
    // @ref LLP 0158#implementation-path-local-v1-explored-2026-08-03 —
    // F0b is a finite-TTL, non-promotable derived deployment with an
    // explicit secret opt-in, inert workers, and fail-closed egress.
    match command {
        ForkCommand::Create {
            from,
            ttl,
            with_secrets,
            app_root,
            fork_root: requested_root,
            destination,
            ready_file,
            retain_base,
            max_forks,
            max_fork_bytes,
            max_total_bytes,
            format,
        } => {
            let app_root = std::fs::canonicalize(&app_root).with_context(|| {
                format!("SNAPBACK_FORK_APP_ROOT_INVALID: {}", app_root.display())
            })?;
            let root = fork_root(&app_root, requested_root)?;
            let created_at_ms = clock();
            let source = from.unwrap_or_else(|| app_root.join(".snapback/dev.sqlite3"));
            let (source_database, app_id, parent_instance_id) = source_from_path(&source)?;
            let expected_app = crate::instance_fork::ensure_expected_app(&app_root, &app_id)?;
            let automatically_reaped =
                automatic_reap_before_create(&root, &expected_app, created_at_ms)?;
            let limits = crate::instance_fork::ForkResourceLimits {
                max_forks,
                max_fork_bytes,
                max_total_bytes,
            };
            // @ref LLP 0158#open-questions — the root-wide admission lock
            // linearizes the observed quota cut through registry intent and
            // publication even when multiple worktrees share --fork-root.
            let admission = crate::instance_fork::admit_creation(
                &root,
                &source_database,
                &limits,
                retain_base,
            )?;
            let resource_usage = admission.usage();
            let ttl_ms = parse_fork_ttl(&ttl)?;
            let expires_at_ms = created_at_ms
                .checked_add(ttl_ms)
                .context("SNAPBACK_FORK_TTL_INVALID: expiry exceeds the portable clock")?;
            anyhow::ensure!(
                expires_at_ms <= crate::manifest::PORTABLE_TIMESTAMP_MAX_MS,
                "SNAPBACK_FORK_TTL_INVALID: expiry exceeds the portable clock"
            );
            let destination = resolve_fork_destination(
                &root,
                destination.unwrap_or_else(|| PathBuf::from(format!("fork-{}", Uuid::now_v7()))),
            )?;
            let receipt = startup_blocking(|| {
                crate::instance_fork::publish_managed_with_base(
                    &source_database,
                    &destination,
                    &expected_app,
                    &parent_instance_id,
                    created_at_ms,
                    expires_at_ms,
                    with_secrets,
                    retain_base,
                )
            })?;
            // Registry intent and the authoritative rename are now durable;
            // later creators will observe this fork in their admission cut.
            drop(admission);
            let destination = std::fs::canonicalize(&destination).context(
                "SNAPBACK_FORK_PATH_INVALID: published destination could not be resolved",
            )?;
            let database = destination.join(&receipt.database_file);
            let generated = app_root.join("snapback/generated");
            let generated_schema = generated.join("schema.manifest.json");
            let generated_functions = generated.join("functions.manifest.json");
            let startup_artifacts = if generated_schema.is_file() && generated_functions.is_file() {
                // @ref LLP 0058#cold-startup-artifact-carrier — a settled
                // Sessions deployment must receive its exact schema/function
                // pair before listener bind. Keep the carrier inside the
                // fork-private tree so exact drop/reap owns it with the rest
                // of the derived deployment.
                let schema = serde_json::from_value(
                    read_json_file(&generated_schema).with_context(|| {
                        format!(
                            "SNAPBACK_FORK_LOAD_FAILED: could not read {}",
                            generated_schema.display()
                        )
                    })?,
                )
                .with_context(|| {
                    format!(
                        "SNAPBACK_FORK_LOAD_FAILED: {} is not a schema manifest",
                        generated_schema.display()
                    )
                })?;
                let functions = serde_json::from_value(
                    read_json_file(&generated_functions).with_context(|| {
                        format!(
                            "SNAPBACK_FORK_LOAD_FAILED: could not read {}",
                            generated_functions.display()
                        )
                    })?,
                )
                .with_context(|| {
                    format!(
                        "SNAPBACK_FORK_LOAD_FAILED: {} is not a functions manifest",
                        generated_functions.display()
                    )
                })?;
                let carrier = crate::auth::mode::StartupArtifacts {
                    format_version: crate::auth::mode::STARTUP_ARTIFACT_FORMAT_VERSION,
                    schema,
                    functions,
                    seed: None,
                };
                let path = destination.join("fork-startup-artifacts.json");
                let bytes = serde_json::to_vec(&carrier)?;
                crate::secure_file::write_new_owner_only(&path, &bytes).with_context(|| {
                    format!(
                        "SNAPBACK_FORK_BOOT_FAILED: could not write {}",
                        path.display()
                    )
                })?;
                crate::secure_file::sync_parent(&path).with_context(|| {
                    format!(
                        "SNAPBACK_FORK_BOOT_FAILED: could not sync {}",
                        destination.display()
                    )
                })?;
                Some(path)
            } else {
                None
            };
            let ready_file = match ready_file {
                Some(path) if path.is_absolute() => path,
                Some(path) => destination.join(path),
                None => destination.join("fork.ready.json"),
            };
            let ready_parent = ready_file
                .parent()
                .context("SNAPBACK_FORK_READY_INVALID: ready file has no parent")?;
            anyhow::ensure!(
                std::fs::canonicalize(ready_parent)? == destination,
                "SNAPBACK_FORK_READY_INVALID: ready file must be a direct child of the fork directory"
            );
            let log_path = destination.join("fork-runtime.log");
            let log = std::fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(&log_path)?;
            let error_log = log.try_clone()?;
            let mut launch = std::process::Command::new(std::env::current_exe()?);
            launch
                .arg("start")
                .arg("--db")
                .arg(&database)
                .arg("--port")
                .arg("0")
                .arg("--ready-file")
                .arg(&ready_file)
                .arg("--cron-disabled")
                .current_dir(&app_root)
                .env("SNAPBACK_JOBS_DISABLED", "1")
                .env("SNAPBACK_ASSET_RUNNER_DISABLED", "1")
                .env_remove("SNAPBACK_ADMIN_TOKEN")
                .stdout(std::process::Stdio::from(log))
                .stderr(std::process::Stdio::from(error_log));
            if let Some(path) = startup_artifacts.as_deref() {
                launch
                    .arg("--startup-artifacts")
                    .arg(path)
                    .arg("--derived-fork-arm-writer-coverage");
            }
            #[cfg(unix)]
            {
                // The fork server outlives this short CLI projection. A new
                // session prevents terminal/launcher teardown from killing
                // the derived deployment immediately after readiness, while
                // the descriptor sweep prevents it from retaining caller
                // capture pipes after the CLI has exited.
                configure_detached_child(&mut launch);
            }
            let mut child = launch
                .spawn()
                .context("SNAPBACK_FORK_BOOT_FAILED: could not spawn fork server")?;
            let deadline = std::time::Instant::now() + std::time::Duration::from_secs(20);
            while !ready_file.exists() {
                if let Some(status) = child.try_wait()? {
                    if startup_artifacts.is_some()
                        && std::fs::read_to_string(&log_path)
                            .is_ok_and(|log| log.contains("SNAPBACK_FORK_LOAD_FAILED:"))
                    {
                        anyhow::bail!(
                            "SNAPBACK_FORK_LOAD_FAILED: generated startup artifacts were refused; see {}",
                            log_path.display()
                        );
                    }
                    anyhow::bail!(
                        "SNAPBACK_FORK_BOOT_FAILED: server exited with {status}; see {}",
                        log_path.display()
                    );
                }
                if std::time::Instant::now() >= deadline {
                    let _ = child.kill();
                    anyhow::bail!(
                        "SNAPBACK_FORK_BOOT_TIMEOUT: no ready descriptor; see {}",
                        log_path.display()
                    );
                }
                tokio::time::sleep(std::time::Duration::from_millis(50)).await;
            }
            let ready_value = read_trusted_json_file(&ready_file)?;
            let descriptor = HostReadyDescriptor::validate(&ready_value).map_err(|problems| {
                anyhow::anyhow!("SNAPBACK_FORK_READY_INVALID: {}", problems.join("; "))
            })?;
            anyhow::ensure!(
                descriptor.pid == child.id(),
                "SNAPBACK_FORK_READY_INVALID: ready descriptor was not written by the spawned fork process"
            );
            verify_fork_ready_database(&descriptor, &database)?;
            verify_live_descriptor_identity(
                &descriptor,
                &fetch_health(&descriptor.server_url),
                "fork.create",
            )
            .map_err(|diagnostic| anyhow::anyhow!("{}: {}", diagnostic.code, diagnostic.message))?;
            let writer_coverage_receipt = if startup_artifacts.is_some() {
                match startup_blocking(|| {
                    crate::instance_fork::verified_derived_fork_app_row_coverage(&database)
                }) {
                    Ok(Some(receipt)) => Some(receipt),
                    Ok(None) => {
                        let _ = quiet_stop_fork(&ready_file, &database);
                        anyhow::bail!(
                            "SNAPBACK_FORK_WRITER_COVERAGE_INVALID: complete startup returned without fork-point coverage evidence"
                        );
                    }
                    Err(error) => {
                        let _ = quiet_stop_fork(&ready_file, &database);
                        return Err(error.into());
                    }
                }
            } else {
                None
            };
            let declared_admin = descriptor
                .admin_token_file
                .as_deref()
                .map(PathBuf::from)
                .context("SNAPBACK_FORK_READY_INVALID: fork has no minted admin-token path")?;
            anyhow::ensure!(
                declared_admin == crate::admin::admin_token_sibling(&database),
                "SNAPBACK_FORK_READY_INVALID: admin-token path is not the fork database sibling"
            );
            let minted_admin =
                String::from_utf8(crate::secure_file::read_owner_only(&declared_admin)?)?
                    .trim()
                    .to_owned();
            let target = TargetArgs {
                url: None,
                ready_file: Some(ready_file.clone()),
                token: Some(minted_admin),
                impersonation_capability_stdin: false,
            };
            // A complete pair was already admitted atomically at cold start.
            // Preserve the historical partial-manifest dev path only when no
            // complete startup carrier was available. This post-bind path is
            // deliberately unarmed and therefore cannot claim whole-window
            // authorizer-backed coverage.
            if startup_artifacts.is_none() {
                for (operation, key, path) in [
                    ("schema.load", "schema", generated_schema),
                    ("functions.load", "functions", generated_functions),
                ] {
                    if path.is_file() {
                        let mut request = json!({ "operation": operation });
                        request[key] = match read_json_file(&path) {
                            Ok(manifest) => manifest,
                            Err(error) => {
                                let _ = quiet_stop_fork(&ready_file, &database);
                                anyhow::bail!("SNAPBACK_FORK_LOAD_FAILED: {error:#}");
                            }
                        };
                        let response = match post_host_op(&target, request) {
                            Ok(response) => response,
                            Err(error) => {
                                let _ = quiet_stop_fork(&ready_file, &database);
                                anyhow::bail!("SNAPBACK_FORK_LOAD_FAILED: {error:#}");
                            }
                        };
                        if !response.get("ok").and_then(Value::as_bool).unwrap_or(false) {
                            let _ = quiet_stop_fork(&ready_file, &database);
                            anyhow::bail!("SNAPBACK_FORK_LOAD_FAILED: {response}");
                        }
                    }
                }
            }
            let entry = crate::instance_fork::record_managed_runtime(
                &root,
                &receipt.lineage.fork_id,
                &ready_file,
                &expected_app,
            )?;
            let envelope = fork_envelope(
                "fork.create",
                app_id,
                Some(&app_root),
                Some(descriptor.server_url.clone()),
                json!({
                    "receipt": receipt,
                    "writerCoverageReceipt": writer_coverage_receipt,
                    "registry": entry,
                    "database": database,
                    "readyFile": ready_file,
                    "runtimeLog": log_path,
                    "workerPolicy": {
                        "cron": "disabled",
                        "jobs": "disabled",
                        "assets": "disabled"
                    },
                    "egressPolicy": "deny-all-v1",
                    "assetCustody": fork_asset_custody(&destination),
                    "secrets": fork_secret_disposition(with_secrets, &database),
                    "automaticReap": {
                        "observedAtMs": created_at_ms,
                        "reapedForkIds": automatically_reaped.reaped,
                        "clearedStaleRegistryIds": automatically_reaped.cleared_stale_registry,
                    },
                    "resourceAdmission": {
                        "usage": resource_usage,
                        "limits": {
                            "maxForks": limits.max_forks,
                            "maxForkBytes": limits.max_fork_bytes,
                            "maxTotalBytes": limits.max_total_bytes,
                        },
                    },
                }),
            );
            let scalars = ForkProjectionScalars {
                url: Some(descriptor.server_url),
                fork_id: Some(receipt.lineage.fork_id.clone()),
                database_path: Some(database.display().to_string()),
                ready_path: Some(ready_file.display().to_string()),
                admin_token_path: Some(declared_admin.display().to_string()),
            };
            print_fork_projection(format, &envelope, &scalars)
        }
        ForkCommand::List {
            app_root,
            fork_root: requested_root,
        } => {
            let app_root = std::fs::canonicalize(app_root)?;
            let expected_app = crate::instance_fork::load_expected_app(&app_root)?;
            let root = fork_root(&app_root, requested_root)?;
            // One stale or corrupt registry entry must not hide every other
            // fork from the operator; bind what proves out and surface the
            // rest as diagnostics (LLP 0185 Phase 3 item 5).
            let mut entries = Vec::new();
            let mut unbound = Vec::new();
            let mut diagnostics = Vec::new();
            for fork_id in crate::instance_fork::managed_registry_ids(&root)? {
                match crate::instance_fork::managed_target(&root, &fork_id, &expected_app) {
                    Ok(target) => entries.push(target.entry),
                    Err(error) if error.diagnostic.code == "SNAPBACK_FORK_NOT_FOUND" => {}
                    Err(error)
                        if error.diagnostic.code
                            == crate::instance_fork::APP_BINDING_MISMATCH_CODE =>
                    {
                        // Shared roots are allowed, but another app root's
                        // entries are not part of this list projection.
                    }
                    Err(error)
                        if error.diagnostic.code
                            == crate::instance_fork::APP_BINDING_REQUIRED_CODE =>
                    {
                        return Err(error.into());
                    }
                    Err(error) => {
                        let code = error.diagnostic.code.clone();
                        unbound.push(json!({ "forkId": fork_id, "code": code }));
                        diagnostics.push(
                            crate::diagnostic::Diagnostic::warning(
                                error.diagnostic.code,
                                "instanceFork",
                                "registry entry could not be bound to local fork evidence",
                            )
                            .with_details(json!({ "forkId": fork_id })),
                        );
                    }
                }
            }
            entries.sort_by(|left, right| left.lineage.fork_id.cmp(&right.lineage.fork_id));
            let app_id = expected_app.app_id().to_owned();
            let resource_usage = json!({
                "forkCount": entries.len() + unbound.len(),
                "totalBytes": crate::instance_fork::directory_tree_bytes(&root)?,
                "defaultLimits": {
                    "maxForks": crate::instance_fork::MANAGED_FORK_MAX_COUNT,
                    "maxForkBytes": crate::instance_fork::MANAGED_FORK_MAX_FORK_BYTES,
                    "maxTotalBytes": crate::instance_fork::MANAGED_FORK_MAX_TOTAL_BYTES,
                    "maxLifetimeMs": crate::instance_fork::MANAGED_FORK_MAX_LIFETIME_MS,
                    "maxDiffRows": crate::instance_fork::FORK_DIFF_MAX_ROWS,
                },
            });
            let envelope = fork_envelope_with_diagnostics(
                "fork.list",
                app_id,
                Some(&app_root),
                None,
                json!({
                    "forkRoot": root,
                    "forks": entries,
                    "unboundRegistry": unbound,
                    "resourceUsage": resource_usage,
                }),
                diagnostics,
            );
            print_envelope(&serde_json::to_value(envelope)?);
            Ok(())
        }
        ForkCommand::Inspect {
            fork_id,
            app_root,
            fork_root: requested_root,
            format,
        } => {
            let app_root = std::fs::canonicalize(app_root)?;
            let expected_app = crate::instance_fork::load_expected_app(&app_root)?;
            let root = fork_root(&app_root, requested_root)?;
            let target = crate::instance_fork::managed_target(&root, &fork_id, &expected_app)?;
            let (process_health, mut diagnostics, server_url) = fork_process_health(&target);
            let diff_database = target.database.clone();
            let diff_summary =
                match startup_blocking(|| crate::instance_fork::diff_receipt(&diff_database)) {
                    Ok(receipt) => json!({
                        "schemaVersion": "snapback.fork-diff-summary.v1",
                        "available": true,
                        "journalRowCount": receipt.rows.len(),
                        "tableCounts": receipt.table_counts,
                        "observedHeadVersion": receipt.observed_head_version,
                        "coverage": receipt.coverage,
                        "omissions": receipt.omissions,
                    }),
                    Err(error) => {
                        diagnostics.push(error.diagnostic);
                        json!({
                            "schemaVersion": "snapback.fork-diff-summary.v1",
                            "available": false,
                        })
                    }
                };
            let ready_path = target
                .ready_file
                .as_deref()
                .map(|path| path.display().to_string());
            let admin_token_path = crate::admin::admin_token_sibling(&target.database);
            let status = json!({
                "schemaVersion": "snapback.fork-status.v1",
                "forkId": target.entry.lineage.fork_id,
                "parentInstanceId": target.entry.lineage.parent_instance_id,
                "parentIdentityKind": "recorded-source-provenance",
                "appId": target.entry.lineage.app_id,
                "forkPointVersion": target.entry.lineage.fork_point_version,
                "createdAtMs": target.entry.lineage.created_at_ms,
                "expiresAtMs": target.entry.lineage.expires_at_ms,
                "processHealth": process_health,
                "databasePath": target.database,
                "readyPath": target.ready_file,
                "adminTokenPath": admin_token_path,
                "secretDisposition": managed_fork_secret_disposition(&target),
                "workerPosture": {
                    "cron": "inert",
                    "jobs": "inert",
                    "assets": "inert",
                },
                "egressPosture": "deny-all-v1",
                "assetCustody": fork_asset_custody(&target.destination),
                "diffSummary": diff_summary,
            });
            let envelope = fork_envelope_with_diagnostics(
                "fork.inspect",
                target.entry.lineage.app_id.clone(),
                Some(&app_root),
                server_url.clone(),
                json!({ "status": status }),
                diagnostics,
            );
            let scalars = ForkProjectionScalars {
                url: server_url,
                fork_id: Some(fork_id),
                database_path: Some(target.database.display().to_string()),
                ready_path,
                admin_token_path: Some(admin_token_path.display().to_string()),
            };
            print_fork_projection(format, &envelope, &scalars)
        }
        ForkCommand::Diff {
            fork_id,
            app_root,
            fork_root: requested_root,
            out,
            max_rows,
            net,
        } => {
            let app_root = std::fs::canonicalize(app_root)?;
            let expected_app = crate::instance_fork::load_expected_app(&app_root)?;
            let root = fork_root(&app_root, requested_root)?;
            let target = crate::instance_fork::managed_target(&root, &fork_id, &expected_app)?;
            let receipt = if net {
                let receipt = startup_blocking(|| {
                    crate::instance_fork::net_diff_receipt(&target.database, max_rows)
                })?;
                serde_json::to_value(receipt)?
            } else {
                let receipt = startup_blocking(|| {
                    crate::instance_fork::diff_receipt_bounded(&target.database, max_rows)
                })?;
                serde_json::to_value(receipt)?
            };
            if let Some(path) = out.as_ref() {
                std::fs::write(path, serde_json::to_vec_pretty(&receipt)?)?;
            }
            let envelope = fork_envelope(
                "fork.diff",
                target.entry.lineage.app_id,
                Some(&app_root),
                None,
                json!({ "receipt": receipt, "writtenTo": out }),
            );
            print_envelope(&serde_json::to_value(envelope)?);
            Ok(())
        }
        ForkCommand::Drop {
            fork_id,
            app_root,
            fork_root: requested_root,
        } => {
            let app_root = std::fs::canonicalize(app_root)?;
            let expected_app = crate::instance_fork::load_expected_app(&app_root)?;
            let root = fork_root(&app_root, requested_root)?;
            let lock = crate::instance_fork::lock_cleanup(&root, &fork_id)?;
            let target = crate::instance_fork::managed_target(&root, &fork_id, &expected_app)?;
            let stopped_pid = target
                .ready_file
                .as_deref()
                .map(|ready| quiet_stop_fork(ready, &target.database))
                .transpose()?
                .flatten();
            crate::instance_fork::drop_managed_locked(&root, &fork_id, &expected_app)?;
            lock.dispose();
            let envelope = fork_envelope(
                "fork.drop",
                target.entry.lineage.app_id,
                Some(&app_root),
                None,
                json!({ "forkId": fork_id, "stoppedPid": stopped_pid, "dropped": true }),
            );
            print_envelope(&serde_json::to_value(envelope)?);
            Ok(())
        }
        ForkCommand::Renew {
            fork_id,
            ttl,
            app_root,
            fork_root: requested_root,
        } => {
            let app_root = std::fs::canonicalize(app_root)?;
            let expected_app = crate::instance_fork::load_expected_app(&app_root)?;
            let root = fork_root(&app_root, requested_root)?;
            let ttl_ms = parse_fork_ttl(&ttl)?;
            let renewed_at_ms = clock();
            let receipt = startup_blocking(|| {
                crate::instance_fork::renew_managed(
                    &root,
                    &fork_id,
                    &expected_app,
                    renewed_at_ms,
                    ttl_ms,
                )
            })?;
            let entry = crate::instance_fork::managed_entry(&root, &fork_id, &expected_app)?;
            let envelope = fork_envelope(
                "fork.renew",
                entry.lineage.app_id.clone(),
                Some(&app_root),
                None,
                json!({ "receipt": receipt, "registry": entry }),
            );
            print_envelope(&serde_json::to_value(envelope)?);
            Ok(())
        }
        ForkCommand::Reap {
            now_ms,
            app_root,
            fork_root: requested_root,
        } => {
            let app_root = std::fs::canonicalize(app_root)?;
            let expected_app = crate::instance_fork::load_expected_app(&app_root)?;
            let root = fork_root(&app_root, requested_root)?;
            anyhow::ensure!(
                now_ms <= crate::manifest::PORTABLE_TIMESTAMP_MAX_MS,
                "SNAPBACK_FORK_REAP_CLOCK_INVALID: reap clock exceeds the portable timestamp range"
            );
            let outcome = reap_managed_forks(&root, &expected_app, now_ms)?;
            let receipt = crate::instance_fork::ForkReapReceiptV1 {
                schema_version: "snapback.fork-reap.v1".to_owned(),
                now_ms,
                reaped_fork_ids: outcome.reaped,
            };
            let envelope = fork_envelope(
                "fork.reap",
                expected_app.app_id().to_owned(),
                Some(&app_root),
                None,
                json!({
                    "receipt": receipt,
                    "clearedStaleRegistryIds": outcome.cleared_stale_registry,
                }),
            );
            print_envelope(&serde_json::to_value(envelope)?);
            Ok(())
        }
        ForkCommand::Recover {
            destination,
            app_root,
            fork_root: requested_root,
        } => {
            let app_root = std::fs::canonicalize(app_root)?;
            let expected_app = crate::instance_fork::load_expected_app(&app_root)?;
            let root = fork_root(&app_root, requested_root)?;
            let destination = resolve_fork_destination(&root, destination)?;
            let was_partial = destination
                .join(crate::instance_fork::STAGING_SENTINEL)
                .is_file();
            let recover_root = root.clone();
            let recover_destination = destination.clone();
            startup_blocking(|| {
                crate::instance_fork::recover_bound(
                    &recover_root,
                    &recover_destination,
                    &expected_app,
                )
            })?;

            let receipt = if destination.is_dir() {
                serde_json::from_slice::<crate::instance_fork::ForkMintReceiptV1>(
                    &std::fs::read(destination.join(crate::instance_fork::MINT_RECEIPT_FILE))
                        .context(
                            "SNAPBACK_FORK_EVIDENCE_INCOMPLETE: recovered destination has no mint receipt",
                        )?,
                )
                .context("SNAPBACK_FORK_RECEIPT_INVALID: recovered mint receipt is malformed")?
                .into()
            } else {
                None
            };
            let registry = receipt.as_ref().and_then(|receipt| {
                crate::instance_fork::managed_entry(&root, &receipt.lineage.fork_id, &expected_app)
                    .ok()
            });
            let disposition = match (was_partial, destination.exists()) {
                (true, true) => "published-recovered",
                (false, true) => "already-published",
                (_, false) => "unpublished-staging-reaped-or-absent",
            };
            let app_id = receipt
                .as_ref()
                .map(|receipt| receipt.lineage.app_id.clone())
                .unwrap_or_else(|| "unknown".to_owned());
            let fork_id = receipt
                .as_ref()
                .map(|receipt| receipt.lineage.fork_id.clone());
            let envelope = fork_envelope(
                "fork.recover",
                app_id,
                Some(&app_root),
                None,
                json!({
                    "forkRoot": root,
                    "destination": destination,
                    "disposition": disposition,
                    "forkId": fork_id,
                    "registry": registry,
                }),
            );
            print_envelope(&serde_json::to_value(envelope)?);
            Ok(())
        }
    }
}

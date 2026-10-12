//! Host startup; request scheduling remains in serve.rs.
use super::*;
pub fn serve(
    project: Project,
    port: u16,
    mut mode: Mode,
    bind: &str,
    inherited: Option<std::net::TcpListener>,
    capacity: crate::host_limits::Capacity,
) -> Result<(), String> {
    crate::host_limits::initialize();
    let capacity = capacity.fit()?;
    crate::host_limits::install(capacity);
    let mut source_stamp = project.sources_stamp();
    let bound = project.compile().map_err(|e| e.to_string())?;
    if !bound.diagnostics.is_empty() {
        let verbose = !matches!(mode, Mode::Dev { verbose: false, .. });
        let (reports, hidden) = crate::verbs::problem_reports(&bound, true, verbose);
        let shown = reports.len();
        for report in reports {
            snapback4_core::diagnostic!("{report}");
        }
        if hidden > 0 {
            snapback4_core::diagnostic!(
                "snapback4 dev: {hidden} redundant cascade diagnostic(s) hidden; use --verbose to show them"
            );
        }
        return Err(format!(
            "{shown} problem{} in snapback/",
            if shown == 1 { "" } else { "s" }
        ));
    }
    let dev = matches!(mode, Mode::Dev { .. });
    // @ref LLP 3000.007#20.2 — replay suppresses new effects and holds schedule admission; ordinary holds keep their separate meanings.
    let replay = matches!(mode, Mode::Dev { replay: true, .. });
    let hold_effects = matches!(
        mode,
        Mode::Dev {
            hold_effects: true,
            ..
        }
    );
    let hold_schedules = replay
        || matches!(
            mode,
            Mode::Dev {
                hold_schedules: true,
                ..
            }
        );
    let clock = crate::dev_clock::Clock::new(
        dev,
        match mode {
            Mode::Dev { clock_offset, .. } => clock_offset,
            _ => 0,
        },
    )
    .map_err(|e| e.to_string())?;
    let generated = if dev {
        Some(project.write_generated(&bound).map_err(|e| e.to_string())?)
    } else {
        None
    };
    if dev {
        project.check_server_at(&mut source_stamp)?;
    }
    // @ref LLP 3000.007#20.2 — only the owning host may replace replay/schedule policy; deployment shares the same lock.
    // Release startup already owns this lock before selecting its source.
    let mut host_lock = if matches!(mode, Mode::Dev { fresh: false, .. }) {
        Some(crate::store_owner::host(&project.store_path())?)
    } else {
        None
    };
    // A busy port is a failed start, not permission to change the stopped host's policy.
    let server =
        crate::witness_socket::server(bind, port, inherited, capacity.connections(), || {
            crate::listen_refusal::in_use(bind, port, if dev { "dev" } else { "serve" })
        })?;
    let address = server
        .server_addr()
        .to_ip()
        .ok_or("HTTP listener has no IP address")?;
    if let Some(file) = &mut host_lock {
        crate::store_owner::announce(file, address)?;
    }
    if let Mode::Release { owner, .. } = &mut mode {
        // @ref LLP 3000.019#3.4 — publish through the acquired handle, including a release database symlink.
        crate::store_owner::announce(
            Arc::get_mut(owner).ok_or("release owner already shared")?,
            address,
        )?;
    }
    let host_owner = match &mode {
        Mode::Release { owner, .. } => Some(owner.clone()),
        _ => host_lock.take().map(Arc::new),
    };
    // `--fresh` has private, disposable storage and the same WAL readers as dev.
    let fresh = if matches!(mode, Mode::Dev { fresh: true, .. }) {
        Some(query_readers::FreshDirectory::new()?)
    } else {
        None
    };
    let mut engine = match &mode {
        Mode::Dev { fresh: true, .. } => Engine::new_at(
            fresh.as_ref().unwrap().store().map_err(|e| e.to_string())?,
            bound.schema.clone(),
            bound.programs.iter().map(|p| p.program.clone()),
            clock.now(),
        ),
        Mode::Dev { .. } => adoption::open(host_owner.as_deref().unwrap(), &bound, &clock),
        Mode::Release { expected, .. } => host_owner
            .as_ref()
            .unwrap()
            .open_store(Duration::from_secs(5))
            .and_then(|store| project.open_release_engine(store, &bound, *expected, clock.now())),
    }
    .map_err(|e| e.to_string())?;
    adoption::report(&engine);
    if dev {
        match crate::dev_clock_store::ahead(&engine, clock.now()) {
            Ok(Some(note)) => snapback4_core::diagnostic!("{note}"),
            Ok(None) => {}
            Err(error) => {
                snapback4_core::diagnostic!("clock     store-ahead inspection unavailable: {error}")
            }
        }
        for line in crate::dev_clock_store::held_schedules(&engine, clock.now()) {
            snapback4_core::diagnostic!("{line}");
        }
    }
    crate::dev_worker::clear_child_session(engine.store()).map_err(|e| e.to_string())?;
    // A native job's module (LLP 3000.005): built by `check`, in `dev` also
    // here so a fresh clone serves without a separate step.
    if dev {
        crate::native::build(&project, &bound).map_err(|p| p.to_string())?;
    }
    if dev {
        crate::dev_replay::effects(&engine, replay).map_err(|e| e.to_string())?;
        crate::dev_replay::schedules(&mut engine, hold_schedules, clock.now())
            .map_err(|e| e.to_string())?;
    }
    if !hold_schedules {
        engine
            .fire_schedules(clock.now())
            .map_err(|e| e.to_string())?;
    }
    let installed = crate::native::install(&mut engine, &project).map_err(|p| p.to_string())?;
    let clock = Arc::new(Mutex::new(clock));
    let presence = Arc::new(Live::new(clock.clone()));
    engine.set_presence(Some(presence.clone()));
    let seq = engine.seq().map_err(|e| e.to_string())?;
    let generation: u64 = engine.generation();
    let adoption = Mutex::new(adoption::Status::new(
        engine
            .store()
            .meta("store_id")
            .map_err(|e| e.to_string())?
            .unwrap_or_default(),
    ));
    let readers = Mutex::new(QueryReaders::new(&engine, &bound.refusal_sites));
    let shared = Arc::new(Shared {
        #[cfg(test)]
        release_committed: Mutex::new(None),
        #[cfg(test)]
        worker_prepare: Mutex::new(None),
        following: Mutex::new(
            snapback4_core::engine::following_history::Reader::new().map_err(|e| e.to_string())?,
        ),
        project: project.root.canonicalize().map_err(|e| e.to_string())?,
        release_root: Mutex::new((!dev).then(|| project.root.clone())),
        temporary: matches!(mode, Mode::Dev { fresh: true, .. }),
        refusals: if dev {
            dev_refusals::Recent::start(
                &project.root,
                &engine
                    .store()
                    .meta("store_id")
                    .map_err(|e| e.to_string())?
                    .unwrap_or_default(),
                address,
                matches!(
                    mode,
                    Mode::Dev {
                        trace_empty: true,
                        ..
                    }
                ),
                matches!(mode, Mode::Dev { verbose: true, .. }),
            )?
        } else {
            Default::default()
        },
        latency: Arc::new(latency::Registry::new(&bound)),
        ephemeral: ephemeral::hub(&engine),
        ephemeral_rate: ephemeral::Rate::default(),
        wake: Mutex::new(ephemeral::Wake::new(&engine)),
        polls: Condvar::new(),
        adoption,
        clock,
        maintenance: FairMutex::gate(maintenance::State::default()),
        engine: FairMutex::new(engine),
        readers,
        read_cuts: Mutex::new(read_cost::ReadCuts::default()),
        bound: Mutex::new(bound),
        generation: Mutex::new(generation),
        worker_revision: AtomicUsize::new(0),
        committed: Condvar::new(),
        seq: Mutex::new(seq),
        personas: dev,
        hold_effects,
        hold_schedules,
        entropy: Mutex::new(snapback4_core::ids::seed()),
        presence,
        long_waits: long_waits::LongWaits::new(&capacity),
        change_answers: Mutex::default(),
        asset_transfers: AssetTransfers::default(),
        native: Mutex::new(installed),
        auth: crate::auth::Admission::default(),
        uploads: AtomicUsize::new(0),
        route_verification: routes::Verification::default(),
        owner: host_owner.clone(),
        #[cfg(test)]
        auth_work: Mutex::new(None),
        #[cfg(test)]
        request_work: Mutex::new(None),
        #[cfg(test)]
        upload_work: Mutex::new(None),
        #[cfg(test)]
        effect_wait: Mutex::new(None),
        #[cfg(test)]
        poll_wait: Mutex::new(None),
        #[cfg(test)]
        query_wait: Mutex::new(None),
        #[cfg(test)]
        reader_open: Mutex::new(None),
        #[cfg(test)]
        changes_refresh: Mutex::new(None),
        #[cfg(test)]
        mutation_wait: Mutex::new(None),
    });
    shared.install_ephemeral_wake();
    if dev {
        crate::lifecycle::managed_cleanup();
    }
    let server = Arc::new(server);
    let address = server.server_addr();
    let worker_url = format!("http://{address}")
        .replace("0.0.0.0", "127.0.0.1")
        .replace("[::]", "[::1]");
    let worker = match &mode {
        Mode::Dev { .. } => {
            crate::dev_worker::DevWorker::start(&project, shared.clone(), worker_url.clone())?
        }
        Mode::Release {
            worker: Some(source),
            ..
        } => Some(crate::dev_worker::DevWorker::start_source(
            &project,
            shared.clone(),
            worker_url.clone(),
            source.clone(),
            true,
        )?),
        _ => None,
    };
    let mut background = Vec::new();
    #[cfg(unix)]
    if !dev {
        let dir = host_owner
            .as_ref()
            .unwrap()
            .path()
            .map_err(|e| e.to_string())?
            .parent()
            .ok_or("deployment parent")?
            .to_owned();
        background.push(("release-control", release::start(shared.clone(), dir)?));
    }
    crate::lifecycle::generation(generation);
    // The URL is stdout's first line; lifecycle and redacted worker logs use stderr.
    snapback4_core::diagnostic_stdout!("http://{address}");
    // @ref LLP 3000.011.004.000#6 — one tagged readiness line a script can match in merged stdout+stderr.
    let wrapper = crate::supervisor::pid()
        .map(|pid| format!(" wrapperPid={pid}"))
        .unwrap_or_default();
    snapback4_core::diagnostic!(
        "SNAPBACK4_READY verb={} generation={generation} url=http://{address} pid={}{wrapper}",
        if dev { "dev" } else { "serve" },
        std::process::id()
    );
    let wrapper = crate::supervisor::pid()
        .map(|pid| format!(", wrapper pid {pid}"))
        .unwrap_or_default();
    match &generated {
        // The PID lets a script that spawned `dev` (perhaps through npx) prove it owns the server it polls.
        Some(generated) => snapback4_core::diagnostic!(
            "snapback4 dev: http://{address}  pid {}{wrapper}  (schema: snapback/, types: {})",
            std::process::id(),
            generated.display()
        ),
        None => snapback4_core::diagnostic!(
            "snapback4 serve: http://{address}  pid {}{wrapper}  (release {}, generation {generation}, tokens only)",
            std::process::id(),
            project.root.display()
        ),
    }
    if dev {
        match mode {
            Mode::Dev { fresh: true, .. } => {
                snapback4_core::diagnostic!("store: temporary — discarded on exit")
            }
            _ => snapback4_core::diagnostic!("store: {}", project.store_path().display()),
        }
    }
    if dev {
        snapback4_core::diagnostic!(
            "snapback4 dev: development only — admits loopback personas and an unauthenticated /seed; deploy with snapback4 deploy + snapback4 serve, which refuse both."
        );
    }
    if replay {
        snapback4_core::diagnostic!(
            "snapback4 dev: replay on — new effects suppressed; schedules held"
        );
    }
    if let Mode::Dev { watch: false, .. } = mode {
        dev_doors::pin(&shared.project, source_stamp);
        snapback4_core::diagnostic!(
            "snapback4 dev: --no-watch — schema edits are not re-adopted; restart dev (or drop --no-watch) to serve a changed snapback/"
        );
    }
    if let Mode::Dev {
        watch: true,
        verbose,
        ..
    } = mode
    {
        let shared = shared.clone();
        let project = Project {
            root: project.root.clone(),
        };
        background.push((
            "watcher",
            crate::lifecycle::background("watcher", move || {
                watch_sources(project, shared, source_stamp, verbose)
            })?,
        ));
    }
    {
        let shared = shared.clone();
        background.push((
            "maintenance",
            crate::lifecycle::background("maintenance", move || maintain(shared))?,
        ));
    }
    {
        let shared = shared.clone();
        background.push((
            "bulk-maintenance",
            crate::lifecycle::background("bulk-maintenance", move || maintenance::bulk(shared))?,
        ));
    }
    if dev {
        snapback4_core::diagnostic!(
            "snapback4 dev: loopback identity attempts have no per-peer or per-email minute limits; Argon2 slots: {} on this host; connection/worker caps still apply",
            shared.auth.kdf_slots(true)
        );
    }
    let worker =
        crate::dev_worker::Supervisor::start(project, shared.clone(), worker_url, dev, worker)?;
    // @ref LLP 3000#contended-read-serving — dev and serve drain startup banners before accepting work, bounded for stalled output.
    let _ = snapback4_core::diagnostics::drain(Duration::from_secs(3));
    serve_requests(
        server,
        shared,
        worker,
        background,
        crate::lifecycle::stopping,
        capacity,
    )
}

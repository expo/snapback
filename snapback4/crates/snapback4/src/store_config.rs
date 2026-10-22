//! The only host boundary that selects a storage adapter.
// @ref LLP 3000.009.001.000#backend-selection-and-the-host — deployment secrets stay in configuration.
use crate::verbs::Options;
use snapback4_core::{
    RuntimeError,
    store_port::{AnyStore, DeploymentState, LeasePolicy, StoreLease},
};
use std::{
    path::{Path, PathBuf},
    sync::{Arc, Mutex, mpsc},
    time::{Duration, Instant},
};

#[derive(Clone)]
pub(crate) struct StoreConfig {
    connection: String,
    namespace: String,
    pub binding: String,
    pub state_directory: PathBuf,
}
fn input(message: &str) -> String {
    format!("E_STORE_CONFIG: {message}")
}
pub(crate) fn selected(options: &Options) -> bool {
    options.flags.contains_key("store-url") || std::env::var_os("SNAPBACK4_STORE_URL").is_some()
}
impl StoreConfig {
    pub fn resolve(options: &Options) -> Result<Option<Self>, String> {
        let url = match options.flags.get("store-url") {
            Some(value) => Some(value.clone()),
            None => match std::env::var("SNAPBACK4_STORE_URL") {
                Ok(value) => Some(value),
                Err(std::env::VarError::NotPresent) => None,
                Err(_) => return Err(input("SNAPBACK4_STORE_URL must be UTF-8")),
            },
        };
        let Some(url) = url else {
            return Ok(None);
        };
        if options.flags.contains_key("store") {
            return Err(input(
                "--store and --store-url/SNAPBACK4_STORE_URL conflict",
            ));
        }
        let (base, query) = url
            .split_once('?')
            .ok_or_else(|| input("store URL requires explicit ?schema=NAME&ha=none"))?;
        if !base.starts_with("postgres://") && !base.starts_with("postgresql://") {
            return Err(input("store URL must use postgres://"));
        }
        let mut namespace = None;
        let mut ha = None;
        let mut parameters = Vec::new();
        for part in query.split('&') {
            let (key, value) = part
                .split_once('=')
                .ok_or_else(|| input("invalid store URL parameter"))?;
            if !key.bytes().all(|b| b.is_ascii_lowercase() || b == b'_') {
                return Err(input(
                    "store URL parameter names must be plain lowercase ASCII",
                ));
            }
            match key {
                "schema" if namespace.is_none() => namespace = Some(value.to_owned()),
                "ha" if ha.is_none() => ha = Some(value),
                "schema" | "ha" => return Err(input("duplicate store URL setting")),
                "options" | "application_name" => {
                    return Err(input(
                        "session options and application_name are owned by the store",
                    ));
                }
                _ => parameters.push(part),
            }
        }
        let namespace = namespace
            .filter(|n| !n.is_empty())
            .ok_or_else(|| input("store URL requires an explicit schema"))?;
        let ha = ha.ok_or_else(|| input("store URL requires an explicit HA mode"))?;
        if ha != "none" {
            return Err("E_STORE_UNSUPPORTED: ha-continuity requires provider qualification; this profile admits ha=none".into());
        }
        let connection = format!("{base}?{}", parameters.join("&"));
        let binding = AnyStore::postgres_binding(&connection, &namespace).map_err(redact)?;
        let state_directory = options
            .flags
            .get("worker-state-dir")
            .cloned()
            .or_else(|| std::env::var("SNAPBACK4_WORKER_STATE_DIR").ok())
            .map(PathBuf::from)
            .unwrap_or_default();
        Ok(Some(Self {
            connection,
            namespace,
            binding,
            state_directory,
        }))
    }
    pub fn probe(&self) -> Result<Option<DeploymentState>, String> {
        AnyStore::postgres_deployment(&self.connection, &self.namespace).map_err(redact)
    }
    pub fn probe_for_deploy(&self, dir: &Path) -> Result<Option<DeploymentState>, String> {
        self.probe().or_else(|error| {
            if !dir.join("store-binding.json").is_file() {
                let id = self.pending(dir, false)?;
                // Probe reads only three relations. Diagnose missing/malformed
                // probe relations through the complete recovery validator too.
                self.check_bootstrap(&id)?;
                return Err(input("bootstrap deployment probe differs from validated state; restore the original complete store and intent, then retry deploy"));
            }
            Err(error)
        })
    }
    pub fn create(&self, id: &str) -> Result<AnyStore, String> {
        AnyStore::create_postgres_with_id(&self.connection, &self.namespace, id).map_err(redact)
    }
    pub fn pending(&self, dir: &Path, create: bool) -> Result<String, String> {
        if create && dir.join("store-binding.json").is_file() {
            return Err(input("bound store is missing; restore its original store URL/database before retrying deploy"));
        }
        let path = dir.join("store-pending.json");
        if path.exists() {
            let record: Binding = serde_json::from_slice(&std::fs::read(&path)
                .map_err(|_| input("cannot read pending bootstrap intent; restore the original intent, then retry deploy"))?)
                .map_err(|_| input("invalid pending bootstrap intent; restore the original intent, then retry deploy"))?;
            if record.binding != self.binding {
                return Err(input("pending bootstrap namespace/socket target differs; restore the original store URL and intent, then retry deploy"));
            }
            if record.store_id.len() != 32 || !record.store_id.bytes().all(|c| c.is_ascii_hexdigit()) {
                return Err(input("invalid pending bootstrap identity; restore the original intent, then retry deploy"));
            }
            // A prior attempt may have failed syncing the directory after its
            // rename. Re-establish durability before trusting an existing intent.
            std::fs::File::open(&path).and_then(|f| f.sync_all())
                .and_then(|_| std::fs::File::open(dir)?.sync_all()).map_err(|e| e.to_string())?;
            return Ok(record.store_id);
        }
        if !create {
            return Err(input("pending bootstrap intent is missing; restore the original intent from the failed deployment, then retry deploy; do not adopt an unrelated store"));
        }
        let id = format!("{:016x}{:016x}", snapback4_core::ids::seed(), snapback4_core::ids::seed());
        self.write_record(dir, "store-pending.json", &id)?;
        Ok(id)
    }
    pub fn recover(&self, dir: &Path, state: &DeploymentState) -> Result<(), String> {
        if state.release.is_some() || state.generation != 1 || state.revision != 0 || state.token != 0 {
            return Err(input("deployment store binding is missing for a selected or previously owned store; restore its original binding before retrying deploy"));
        }
        let id = self.pending(dir, false)?;
        if state.store_id != id {
            return Err(input("pending bootstrap store id differs from the connected store; restore the original store at the recorded socket/namespace and retry deploy"));
        }
        self.check_bootstrap(&id)?;
        // Publish only the validated typed fields. Never promote raw intent
        // bytes: ignored JSON fields may contain credentials. Keep the intent
        // until the sanitized binding and its directory are durable.
        self.write_record(dir, "store-binding.json", &id)?;
        std::fs::remove_file(dir.join("store-pending.json"))
            .and_then(|_| std::fs::File::open(dir)?.sync_all()).map_err(|e| e.to_string())
    }
    fn check_bootstrap(&self, id: &str) -> Result<(), String> {
        AnyStore::validate_postgres_bootstrap(&self.connection, &self.namespace, id)
            .map_err(|e| input(&format!("pending bootstrap validation failed: {}; restore the original complete bootstrap and intent, then retry deploy", redact(e))))
    }
    pub fn acquire(&self, store_id: &str) -> Result<OwnedStore, String> {
        let holder = format!("{:04x}", snapback4_core::ids::seed() as u16);
        let lease = StoreLease::connect(
            &self.connection,
            &self.namespace,
            store_id,
            &holder,
            LeasePolicy::default(),
        )
        .map_err(redact)?;
        self.acquire_connected(lease)
    }
    fn acquire_connected(&self, lease: StoreLease) -> Result<OwnedStore, String> {
        let lease = Arc::new(Mutex::new(lease));
        // Install cleanup before any further fallible startup, including renewal
        // and spawning either thread. Serving disarms release only at admission.
        let mut owner = OwnedStore {
            config: self.clone(),
            lease: lease.clone(),
            stop: None,
            thread: None,
            watchdog: None,
            finished: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            release_on_drop: std::sync::atomic::AtomicBool::new(true),
        };
        let acquired = lease.lock().unwrap_or_else(|p| p.into_inner()).acquire().map_err(redact)?;
        if acquired.is_none() {
            return Err(
                "E_STORE_OWNERSHIP: another owner holds an unexpired lease; retry after expiry"
                    .into(),
            );
        }
        if !lease.lock().unwrap_or_else(|p| p.into_inner()).renew().map_err(redact)? {
            return Err("E_STORE_OWNERSHIP: acquisition expired before startup".into());
        }
        let renew = lease.clone();
        let last_renewed = Arc::new(Mutex::new(Instant::now()));
        let renewed = last_renewed.clone();
        let watchdog_finished = owner.finished.clone();
        let (stop, receive) = mpsc::channel();
        owner.stop = Some(stop);
        owner.thread = Some(std::thread::Builder::new().name("store-lease".into()).spawn(move || {
            while receive.recv_timeout(Duration::from_millis(500)) == Err(mpsc::RecvTimeoutError::Timeout) {
                if !renew.lock().unwrap_or_else(|p| p.into_inner()).renew().unwrap_or(false) {
                    // Exit the process on the first uncertain/lost renewal. The fence orders
                    // in-flight COMMIT before takeover; no listener or producer survives.
                    eprintln!("E_STORE_OWNERSHIP: lease renewal lost; stopping all admission and exiting");
                    std::process::exit(1);
                }
                *renewed.lock().unwrap_or_else(|p|p.into_inner()) = Instant::now();
            }
        }).map_err(|_| input("cannot start lease renewal"))?);
        owner.watchdog = Some(std::thread::Builder::new().name("store-lease-deadline".into()).spawn(move || {
            while !watchdog_finished.load(std::sync::atomic::Ordering::Acquire) {
                if last_renewed.lock().unwrap_or_else(|p|p.into_inner()).elapsed() >= Duration::from_secs(3) {
                    eprintln!("E_STORE_OWNERSHIP: lease renewal deadline lost; stopping all admission and exiting");
                    std::process::exit(1);
                }
                std::thread::sleep(Duration::from_millis(50));
            }
        }).map_err(|_|input("cannot start lease deadline watchdog"))?);
        Ok(owner)
    }
    pub fn validate_binding(&self, dir: &Path, state: &DeploymentState) -> Result<(), String> {
        let record: Binding = serde_json::from_slice(
            &std::fs::read(dir.join("store-binding.json"))
                .map_err(|_| input("deployment store binding is missing"))?,
        )
        .map_err(|_| input("invalid deployment store binding"))?;
        if record.store_id != state.store_id || record.binding != self.binding {
            return Err(input(
                "deployment store identity or configuration binding differs",
            ));
        }
        Ok(())
    }
    pub fn record(&self, dir: &Path, store_id: &str) -> Result<(), String> {
        let path = dir.join("store-binding.json");
        if path.exists() {
            let record: Binding =
                serde_json::from_slice(&std::fs::read(&path).map_err(|e| e.to_string())?)
                    .map_err(|_| input("invalid deployment binding"))?;
            if record.store_id != store_id || record.binding != self.binding {
                return Err(input("existing deployment binding differs"));
            }
            return Ok(());
        }
        self.write_record(dir, "store-binding.json", store_id)
    }
    fn write_record(&self, dir: &Path, filename: &str, store_id: &str) -> Result<(), String> {
        let path = dir.join(filename);
        let record = serde_json::to_vec_pretty(&Binding {
            store_id: store_id.into(),
            binding: self.binding.clone(),
        })
        .unwrap();
        // Never leave a partial record that prevents recovery of a bootstrap.
        let temporary = dir.join(format!(".store-binding-{:016x}", snapback4_core::ids::seed()));
        let mut file = snapback4_core::private_fs::file(&temporary, true)
            .map_err(|e| e.to_string())?;
        use std::io::Write;
        let result = file.write_all(&record)
            .and_then(|_| file.sync_all())
            .and_then(|_| std::fs::rename(&temporary, &path))
            .and_then(|_| std::fs::File::open(dir)?.sync_all());
        let _ = std::fs::remove_file(temporary);
        result.map_err(|e| e.to_string())
    }
}
#[derive(serde::Serialize, serde::Deserialize)]
struct Binding {
    store_id: String,
    binding: String,
}

pub(crate) struct OwnedStore {
    pub config: StoreConfig,
    lease: Arc<Mutex<StoreLease>>,
    stop: Option<mpsc::Sender<()>>,
    thread: Option<std::thread::JoinHandle<()>>,
    release_on_drop: std::sync::atomic::AtomicBool,
    finished: Arc<std::sync::atomic::AtomicBool>,
    watchdog: Option<std::thread::JoinHandle<()>>,
}
impl OwnedStore {
    pub fn serving(&self) {
        // Once admission starts, in-flight work must drain behind the token
        // fence; leave the lease to expire rather than releasing on host drop.
        self.release_on_drop.store(false, std::sync::atomic::Ordering::Release);
    }
    pub fn open(&self) -> Result<AnyStore, RuntimeError> {
        AnyStore::open_postgres_owned(
            &self.config.connection,
            &self.config.namespace,
            &self.lease.lock().unwrap_or_else(|p| p.into_inner()),
        )
    }
    pub fn worker_state(&self, store: &AnyStore) -> Result<PathBuf, String> {
        let path = store
            .worker_ledger_path(Some(&self.config.state_directory))
            .map_err(redact)?;
        snapback4_core::private_fs::directory(&self.config.state_directory)
            .map_err(|e| e.to_string())?;
        Ok(path)
    }
}
impl Drop for OwnedStore {
    fn drop(&mut self) {
        self.finished
            .store(true, std::sync::atomic::Ordering::Release);
        self.stop.take();
        if let Some(watchdog) = self.watchdog.take() {
            let _ = watchdog.join();
        }
        if let Some(thread) = self.thread.take() {
            let _ = thread.join();
        }
        if self.release_on_drop.load(std::sync::atomic::Ordering::Acquire) {
            let _ = self
                .lease
                .lock()
                .unwrap_or_else(|p| p.into_inner())
                .release();
        }
    }
}
// RuntimeError's Display and refusal serialization share driver-text redaction.
pub(crate) fn redact(error: RuntimeError) -> String {
    error.to_string()
}

/// Keep the existing SQLite path selector and deployment aliases in configuration.
pub(crate) fn local_deployment(options: &Options, dir: &Path) -> Result<(), String> {
    if dir.join("store-binding.json").exists() || dir.join("store-pending.json").exists() {
        return Err(input(
            "this deployment requires its store URL from configuration",
        ));
    }
    let Some(path) = options.flags.get("store") else {
        return Ok(());
    };
    let requested = PathBuf::from(path);
    let requested = if requested.is_absolute() {
        requested
    } else {
        std::env::current_dir()
            .map_err(|e| e.to_string())?
            .join(requested)
    };
    if !requested.exists() {
        return Err(input(
            "--store requires an existing SQLite store path; omit it for a new deployment",
        ));
    }
    let requested = requested.canonicalize().map_err(|e| e.to_string())?;
    let local = dir.join("store.sqlite");
    if local.exists() {
        if local.canonicalize().map_err(|e| e.to_string())? != requested {
            return Err(input("deployment already binds a different SQLite path"));
        }
    } else {
        #[cfg(unix)]
        std::os::unix::fs::symlink(&requested, &local).map_err(|e| e.to_string())?;
        #[cfg(not(unix))]
        return Err(input("SQLite deployment aliases require Unix"));
    }
    Ok(())
}

pub(crate) fn retain_candidate(error: &RuntimeError) -> bool {
    matches!(
        error,
        RuntimeError::Postgres(_) | RuntimeError::CommitOutcomeUnknown(_)
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    #[ignore = "requires private Postgres; scripts/test-postgres.sh"]
    fn postgres_startup_renewal_error_releases_committed_claim() {
        let connection = std::env::var("SNAPBACK4_EVAL_POSTGRES").expect("private cluster required");
        let namespace = format!("sb4_eval_startup_{:x}", snapback4_core::ids::seed());
        let source = "table notes:\n  n: int\n  public\n  insert <- allow\n  online only\nquery peek():\n  return 1\n";
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty());
        let engine = snapback4_core::Engine::new(
            AnyStore::create_postgres(&connection, &namespace).unwrap(),
            bound.schema,
            bound.programs.into_iter().map(|p| p.program),
        ).unwrap();
        let id = engine.store().store_identity().unwrap().unwrap();
        drop(engine);
        let config = StoreConfig {
            binding: AnyStore::postgres_binding(&connection, &namespace).unwrap(),
            connection: connection.clone(), namespace: namespace.clone(), state_directory: PathBuf::new(),
        };
        let command = |statement: &str| {
            let result = std::process::Command::new("psql")
                .args([&connection, "-v", "ON_ERROR_STOP=1", "-Atc", statement]).output().unwrap();
            assert!(result.status.success(), "{}", String::from_utf8_lossy(&result.stderr));
            String::from_utf8(result.stdout).unwrap()
        };
        let lease = StoreLease::connect(&connection, &namespace, &id, "abcd", LeasePolicy::default()).unwrap();
        // Grok's injection: shape verification has finished; only renewal fails.
        command(&format!(r#"CREATE FUNCTION {namespace}.fail_renewal() RETURNS trigger LANGUAGE plpgsql AS $$
            BEGIN IF NEW.token=OLD.token AND NEW.lease_until>OLD.lease_until THEN
              RAISE EXCEPTION 'private-password renewal failure'; END IF; RETURN NEW; END $$;
            CREATE TRIGGER fail_renewal BEFORE UPDATE ON {namespace}._owner FOR EACH ROW
            EXECUTE FUNCTION {namespace}.fail_renewal();"#));
        let error = config.acquire_connected(lease).err().expect("renewal must fail");
        assert!(error.contains("E_STORE") && !error.contains("private-password"), "{error}");
        assert_eq!(command(&format!("SELECT token,lease_until='-infinity'::timestamptz FROM {namespace}._owner")).trim(), "1|t");
        command(&format!("DROP TRIGGER fail_renewal ON {namespace}._owner; DROP FUNCTION {namespace}.fail_renewal()"));
        // No expiry wait: this is the same startup acquisition used by serve.
        let restarted = config.acquire(&id).unwrap();
        assert_eq!(restarted.lease.lock().unwrap().token(), Some(2));
        drop(restarted);
    }
}

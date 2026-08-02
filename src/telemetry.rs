//! Loss-tolerant local telemetry storage.
//!
//! The store is a sibling SQLite database, never an attachment or table in the
//! app database. Producers enqueue bounded records; one event-armed worker
//! flushes batches and performs rollup/retention maintenance on that sibling
//! connection only.
//!
//! @ref LLP 0154#d1--telemetry-store-a-sibling-sqlite-database-generation-bound —
//!   generation-bound sibling storage and visibility views are the durable
//!   read boundary.
//! @ref LLP 0154#d3--write-path-buffered-batched-priority-aware-event-driven —
//!   producers never touch SQLite and failures retain reserved capacity.
//! @ref LLP 0154#d4--maintenance-rides-the-flush-path-no-cron — retention and
//!   rollups are post-flush work, never a periodic app-database job.

use crate::diagnostic::{DiagnosticSeverity, SnapbackError, SnapbackResult};
use crate::ids::{self, Kind as IdKind};
use rusqlite::{Connection, OpenFlags, OptionalExtension, Transaction, params, params_from_iter};
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value, json};
use std::collections::{BTreeMap, BTreeSet, VecDeque};
use std::fs::{self, OpenOptions};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Condvar, Mutex, RwLock};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

const DAY_MS: i64 = 86_400_000;
const HOUR_MS: i64 = 3_600_000;
const CLASS_REGISTRY_FOUNDATION_VERSION: u32 = 1;
const DETAILS_MAX_BYTES: usize = 8 * 1024;
const NAME_MAX_BYTES: usize = 3_000;
const CORRELATION_MAX_BYTES: usize = 512;
const CODE_MAX_BYTES: usize = 256;
const LARGE_SWEEP_ROWS: usize = 1_000;
const FILE_CAP_FIXED_RESERVE_BYTES: u64 = 128 * 1024;

pub const DEFAULT_MAX_DAYS: u32 = 7;
pub const MAX_MAX_DAYS: u32 = 365;
pub const DEFAULT_BUFFER_CAPACITY: usize = 4_096;
pub const DEFAULT_PRIORITY_RESERVE: usize = 512;
pub const DEFAULT_BATCH_SIZE: usize = 256;
pub const DEFAULT_MAX_AGE_MS: u64 = 3_000;
pub const DEFAULT_FILE_SIZE_CAP_BYTES: u64 = 256 * 1024 * 1024;
pub const DEFAULT_HOURLY_DAYS: u32 = 90;
pub const DEFAULT_DAILY_DAYS: u32 = 730;
pub const DEFAULT_TOP_NAMES_PER_HOUR: usize = 200;
pub const DEFAULT_ROLLUP_ROW_CAP: usize = 1_000_000;
pub const DEFAULT_SWEEP_INTERVAL_MS: u64 = 6 * 60 * 60 * 1_000;

/// Trusted identity of the app/environment that owns one telemetry sibling.
/// These values are never accepted from an event payload and are never
/// truncated: rows inherit them from `telemetry_meta` only when exported.
///
/// @ref LLP 0154#d1--telemetry-store-a-sibling-sqlite-database-generation-bound —
///   one store binding supplies app/environment identity for every row.
#[derive(Clone, Debug, Eq, PartialEq)]
pub(crate) struct TelemetryStoreIdentity {
    pub(crate) app_id: String,
    pub(crate) environment_id: String,
}

impl TelemetryStoreIdentity {
    pub(crate) fn new(
        app_id: impl Into<String>,
        environment_id: impl Into<String>,
    ) -> SnapbackResult<Self> {
        let identity = Self {
            app_id: app_id.into(),
            environment_id: environment_id.into(),
        };
        if identity.app_id.trim().is_empty() || identity.environment_id.trim().is_empty() {
            return Err(SnapbackError::error(
                "SNAPBACK_TELEMETRY_IDENTITY_INVALID",
                "telemetry",
                "telemetry store identity requires non-empty app and environment values",
            ));
        }
        Ok(identity)
    }

}

fn default_max_days() -> u32 {
    DEFAULT_MAX_DAYS
}
fn default_min_level() -> DiagnosticSeverity {
    DiagnosticSeverity::Info
}
fn default_buffer_capacity() -> usize {
    DEFAULT_BUFFER_CAPACITY
}
fn default_priority_reserve() -> usize {
    DEFAULT_PRIORITY_RESERVE
}
fn default_batch_size() -> usize {
    DEFAULT_BATCH_SIZE
}
fn default_max_age_ms() -> u64 {
    DEFAULT_MAX_AGE_MS
}
fn default_file_size_cap_bytes() -> u64 {
    DEFAULT_FILE_SIZE_CAP_BYTES
}
fn default_hourly_days() -> u32 {
    DEFAULT_HOURLY_DAYS
}
fn default_daily_days() -> u32 {
    DEFAULT_DAILY_DAYS
}
fn default_top_names_per_hour() -> usize {
    DEFAULT_TOP_NAMES_PER_HOUR
}
fn default_rollup_row_cap() -> usize {
    DEFAULT_ROLLUP_ROW_CAP
}
fn default_sweep_interval_ms() -> u64 {
    DEFAULT_SWEEP_INTERVAL_MS
}

/// Deployment-owned telemetry knobs persisted in the existing config sibling.
/// Bounds are resource-safety limits, not commercial entitlements.
#[derive(Clone, Debug, Deserialize, PartialEq, Serialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TelemetryConfig {
    #[serde(default = "default_max_days")]
    pub max_days: u32,
    #[serde(default = "default_min_level")]
    pub min_level: DiagnosticSeverity,
    #[serde(default = "default_buffer_capacity")]
    pub buffer_capacity: usize,
    #[serde(default = "default_priority_reserve")]
    pub priority_reserve: usize,
    #[serde(default = "default_batch_size")]
    pub batch_size: usize,
    #[serde(default = "default_max_age_ms")]
    pub max_age_ms: u64,
    #[serde(default = "default_file_size_cap_bytes")]
    pub file_size_cap_bytes: u64,
    #[serde(default = "default_hourly_days")]
    pub hourly_days: u32,
    #[serde(default = "default_daily_days")]
    pub daily_days: u32,
    #[serde(default = "default_top_names_per_hour")]
    pub top_names_per_hour: usize,
    #[serde(default = "default_rollup_row_cap")]
    pub rollup_row_cap: usize,
    #[serde(default = "default_sweep_interval_ms")]
    pub sweep_interval_ms: u64,
}

impl Default for TelemetryConfig {
    fn default() -> Self {
        Self {
            max_days: default_max_days(),
            min_level: default_min_level(),
            buffer_capacity: default_buffer_capacity(),
            priority_reserve: default_priority_reserve(),
            batch_size: default_batch_size(),
            max_age_ms: default_max_age_ms(),
            file_size_cap_bytes: default_file_size_cap_bytes(),
            hourly_days: default_hourly_days(),
            daily_days: default_daily_days(),
            top_names_per_hour: default_top_names_per_hour(),
            rollup_row_cap: default_rollup_row_cap(),
            sweep_interval_ms: default_sweep_interval_ms(),
        }
    }
}

impl TelemetryConfig {
    pub fn validate(&self) -> SnapbackResult<()> {
        let valid = self.max_days <= MAX_MAX_DAYS
            && self.buffer_capacity > 0
            && self.buffer_capacity <= 1_000_000
            && self.priority_reserve > 0
            && self.priority_reserve < self.buffer_capacity
            && self.batch_size > 0
            && self.batch_size <= 1_024
            && self.max_age_ms > 0
            && self.max_age_ms <= 60_000
            && self.file_size_cap_bytes >= 1024 * 1024
            && self.file_size_cap_bytes <= 16 * 1024 * 1024 * 1024
            && self.hourly_days > 0
            && self.daily_days >= self.hourly_days
            && self.daily_days <= 3_650
            && self.top_names_per_hour > 0
            && self.top_names_per_hour <= 10_000
            && self.rollup_row_cap > 0
            && self.rollup_row_cap <= 10_000_000
            && self.sweep_interval_ms > 0;
        if valid {
            return Ok(());
        }
        Err(SnapbackError::error(
            "SNAPBACK_TELEMETRY_CONFIG_INVALID",
            "telemetry",
            "telemetry configuration is outside the local resource-safety envelope",
        ))
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Priority {
    Normal,
    Reserved,
}

impl Priority {
    fn as_str(self) -> &'static str {
        match self {
            Self::Normal => "normal",
            Self::Reserved => "reserved",
        }
    }
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub enum Phase {
    Point,
    Admission,
    Terminal,
    Joined,
}

impl Phase {
    fn as_str(self) -> &'static str {
        match self {
            Self::Point => "point",
            Self::Admission => "admission",
            Self::Terminal => "terminal",
            Self::Joined => "joined",
        }
    }
}

#[derive(Clone, Debug)]
struct Event {
    sequence: u64,
    observation: String,
    phase: Phase,
    generation: String,
    class_v: u32,
    ts_ms: i64,
    kind: String,
    name: String,
    status: Option<i64>,
    duration_ms: Option<f64>,
    code: Option<String>,
    correlation: Option<String>,
    // @ref LLP 0154#d2--the-observation-span-classification-registry-and-phase-1-kinds —
    //   release is exact first-class identity captured at admission, not a
    //   capped detail or an export-time ambient value.
    release: Option<String>,
    details: Option<Value>,
    priority: Priority,
    enqueued_at: Instant,
}

#[derive(Debug)]
pub struct ObservationSpan {
    telemetry: Telemetry,
    observation: Option<String>,
    generation: String,
    ts_ms: i64,
    started: Instant,
    kind: String,
    name: String,
    correlation: Option<String>,
    release: Option<String>,
    details: Option<Value>,
    long_lived: bool,
    active: bool,
}

impl ObservationSpan {
    pub fn finish(mut self, status: Option<i64>, code: Option<&str>, details: Option<Value>) {
        if !self.active {
            return;
        }
        self.active = false;
        let Some(observation) = self.observation.clone() else {
            return;
        };
        let phase = if self.long_lived {
            Phase::Terminal
        } else {
            Phase::Joined
        };
        let priority = if phase == Phase::Terminal
            || code.is_some()
            || status.is_some_and(|value| value >= 500)
        {
            Priority::Reserved
        } else {
            Priority::Normal
        };
        self.telemetry.enqueue_bound(Event {
            sequence: 0,
            observation,
            phase,
            generation: self.generation.clone(),
            class_v: CLASS_REGISTRY_FOUNDATION_VERSION,
            ts_ms: self.ts_ms,
            kind: self.kind.clone(),
            name: self.name.clone(),
            status,
            duration_ms: Some(self.started.elapsed().as_secs_f64() * 1000.0),
            code: code.map(|value| cap(value, CODE_MAX_BYTES)),
            correlation: self.correlation.clone(),
            release: self.release.clone(),
            details: scrub_details(details).or_else(|| self.details.clone()),
            priority,
            enqueued_at: Instant::now(),
        });
    }
}

impl Drop for ObservationSpan {
    fn drop(&mut self) {
        if !self.active {
            return;
        }
        self.active = false;
        let Some(observation) = self.observation.clone() else {
            return;
        };
        self.telemetry.enqueue_bound(Event {
            sequence: 0,
            observation,
            phase: if self.long_lived {
                Phase::Terminal
            } else {
                Phase::Joined
            },
            generation: self.generation.clone(),
            class_v: CLASS_REGISTRY_FOUNDATION_VERSION,
            ts_ms: self.ts_ms,
            kind: self.kind.clone(),
            name: self.name.clone(),
            status: Some(499),
            duration_ms: Some(self.started.elapsed().as_secs_f64() * 1000.0),
            code: None,
            correlation: self.correlation.clone(),
            release: self.release.clone(),
            details: scrub_details(Some(json!({ "cause": "cancelled" })))
                .or_else(|| self.details.clone()),
            priority: Priority::Reserved,
            enqueued_at: Instant::now(),
        });
    }
}

#[derive(Clone, Debug, Default, PartialEq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BufferDiagnostics {
    pub depth: usize,
    pub normal_depth: usize,
    pub reserved_depth: usize,
    pub drops_since_boot: BTreeMap<String, u64>,
    pub last_flush_watermark: Option<i64>,
}

#[derive(Default)]
struct Buffer {
    normal: VecDeque<Event>,
    reserved: VecDeque<Event>,
    next_sequence: u64,
    current_generation: String,
    accepting: bool,
    generation_fenced: bool,
    config_fenced: bool,
    shutdown: bool,
    drops_since_boot: BTreeMap<String, u64>,
    pending_drop_counters: BTreeMap<String, u64>,
    pending_drop_since: Option<Instant>,
    last_flush_watermark: Option<i64>,
}

impl Buffer {
    fn len(&self) -> usize {
        self.normal.len() + self.reserved.len()
    }

    fn oldest(&self) -> Option<Instant> {
        self.normal
            .front()
            .map(|event| event.enqueued_at)
            .into_iter()
            .chain(self.reserved.front().map(|event| event.enqueued_at))
            .chain(self.pending_drop_since)
            .min()
    }

    fn has_work(&self) -> bool {
        self.len() > 0 || !self.pending_drop_counters.is_empty()
    }

    fn count_drop(&mut self, event: &Event, reason: &str) {
        let key = format!("{}:{}:{reason}", event.kind, event.priority.as_str());
        *self.drops_since_boot.entry(key.clone()).or_default() += 1;
        *self.pending_drop_counters.entry(key).or_default() += 1;
        self.pending_drop_since.get_or_insert_with(Instant::now);
    }

    fn take_drop_counters(&mut self) -> BTreeMap<String, u64> {
        self.pending_drop_since = None;
        std::mem::take(&mut self.pending_drop_counters)
    }

    fn restore_drop_counters(&mut self, counters: BTreeMap<String, u64>) {
        if counters.is_empty() {
            return;
        }
        self.pending_drop_since.get_or_insert_with(Instant::now);
        for (key, count) in counters {
            *self.pending_drop_counters.entry(key).or_default() += count;
        }
    }

    fn drain_batch(&mut self, maximum: usize) -> Vec<Event> {
        let mut events = Vec::with_capacity(maximum.min(self.len()));
        while events.len() < maximum {
            let take_reserved = match (self.normal.front(), self.reserved.front()) {
                (Some(normal), Some(reserved)) => reserved.sequence < normal.sequence,
                (None, Some(_)) => true,
                (Some(_), None) => false,
                (None, None) => break,
            };
            events.push(if take_reserved {
                self.reserved.pop_front().expect("reserved front exists")
            } else {
                self.normal.pop_front().expect("normal front exists")
            });
        }
        events
    }
}

struct Shared {
    buffer: Mutex<Buffer>,
    wake: Condvar,
    store: Mutex<Store>,
    flush_gate: Mutex<()>,
    config: RwLock<TelemetryConfig>,
    release: RwLock<Option<String>>,
    worker_started: AtomicBool,
    worker_handle: Mutex<Option<std::thread::JoinHandle<()>>>,
    shutdown_flush_failed: AtomicBool,
    boot_maintenance_pending: AtomicBool,
    ready_recorded: AtomicBool,
}

#[derive(Default)]
struct FlushOutcome {
    watermark: Option<i64>,
    cap_drops: BTreeMap<String, u64>,
    replacement_generation: Option<String>,
}

struct Producer {
    shared: Arc<Shared>,
}

impl Drop for Producer {
    fn drop(&mut self) {
        let config = self
            .shared
            .config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let panicking = std::thread::panicking();
        let release = self
            .shared
            .release
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let mut graceful_admitted = false;
        {
            let mut buffer = self
                .shared
                .buffer
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            // @ref LLP 0154#d2--the-observation-span-classification-registry-and-phase-1-kinds —
            //   final producer ownership is the graceful-process boundary;
            //   its allowlisted marker drains before the durable clean bit.
            if !panicking
                && config.max_days > 0
                && buffer.accepting
                && let Ok(observation) = ids::mint(IdKind::Observation)
            {
                let generation = buffer.current_generation.clone();
                let event = Event {
                    sequence: 0,
                    observation,
                    phase: Phase::Point,
                    generation,
                    class_v: CLASS_REGISTRY_FOUNDATION_VERSION,
                    ts_ms: wall_now_ms(),
                    kind: "lifecycle".to_owned(),
                    name: "graceful_shutdown".to_owned(),
                    status: Some(200),
                    duration_ms: None,
                    code: None,
                    correlation: None,
                    release,
                    details: None,
                    priority: Priority::Reserved,
                    enqueued_at: Instant::now(),
                };
                enqueue_locked(&mut buffer, &config, event);
                graceful_admitted = true;
            }
            buffer.shutdown = true;
        }
        self.shared.wake.notify_all();
        if let Some(handle) = self
            .shared
            .worker_handle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .take()
        {
            let _ = handle.join();
        }
        // No worker is created for an otherwise idle producer. Drain its
        // graceful marker synchronously; a failed drain deliberately leaves
        // the durable ownership bit unclean for the next boot to detect.
        let mut drained = true;
        loop {
            let has_work = self
                .shared
                .buffer
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .has_work();
            if !has_work {
                break;
            }
            if flush_shared(&self.shared, false).is_err() {
                drained = false;
                break;
            }
        }
        if drained
            && !panicking
            && !self.shared.shutdown_flush_failed.load(Ordering::Acquire)
            && (config.max_days == 0 || graceful_admitted)
        {
            let _ = self
                .shared
                .store
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .mark_clean_shutdown(wall_now_ms());
        }
    }
}

/// Cloneable fire-and-forget producer. The worker owns no producer handle, so
/// the final clone's drop is a real graceful-drain signal.
#[derive(Clone)]
pub struct Telemetry {
    producer: Arc<Producer>,
}

impl std::fmt::Debug for Telemetry {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("Telemetry")
            .field("diagnostics", &self.diagnostics())
            .finish()
    }
}

impl Telemetry {
    pub fn in_memory(app_db_incarnation: &str, config: TelemetryConfig) -> SnapbackResult<Self> {
        Self::from_store(
            Store::memory_unbound(app_db_incarnation, config.clone())?,
            config,
        )
    }

    pub(crate) fn in_memory_with_identity(
        app_db_incarnation: &str,
        identity: TelemetryStoreIdentity,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        Self::from_store(
            Store::memory_with_identity(app_db_incarnation, identity, config.clone())?,
            config,
        )
    }

    pub fn open_for_database(
        database_path: &Path,
        app_db_incarnation: &str,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        let path = telemetry_path(database_path);
        Self::from_store(
            Store::open_unbound(path, app_db_incarnation, config.clone())?,
            config,
        )
    }

    pub(crate) fn open_for_database_with_identity(
        database_path: &Path,
        app_db_incarnation: &str,
        identity: TelemetryStoreIdentity,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        let path = telemetry_path(database_path);
        Self::from_store(
            Store::open_with_identity(path, app_db_incarnation, identity, config.clone())?,
            config,
        )
    }

    fn from_store(store: Store, config: TelemetryConfig) -> SnapbackResult<Self> {
        config.validate()?;
        let generation = store.generation.clone();
        let unclean_predecessor = store.unclean_predecessor;
        let enabled = config.max_days > 0;
        let shared = Arc::new(Shared {
            buffer: Mutex::new(Buffer {
                current_generation: generation,
                accepting: config.max_days > 0,
                ..Buffer::default()
            }),
            wake: Condvar::new(),
            store: Mutex::new(store),
            flush_gate: Mutex::new(()),
            config: RwLock::new(config),
            release: RwLock::new(None),
            worker_started: AtomicBool::new(false),
            worker_handle: Mutex::new(None),
            shutdown_flush_failed: AtomicBool::new(false),
            boot_maintenance_pending: AtomicBool::new(true),
            ready_recorded: AtomicBool::new(false),
        });
        let telemetry = Self {
            producer: Arc::new(Producer { shared }),
        };
        if unclean_predecessor && enabled {
            telemetry.point(
                "lifecycle",
                "detected_unclean_predecessor",
                Some(200),
                None,
                None,
                None,
                Priority::Reserved,
            );
        }
        Ok(telemetry)
    }

    pub fn path_for_database(database_path: &Path) -> PathBuf {
        telemetry_path(database_path)
    }

    pub fn start_span(
        &self,
        kind: &str,
        name: &str,
        correlation: Option<&str>,
        details: Option<Value>,
        long_lived: bool,
    ) -> ObservationSpan {
        // Telemetry is loss-tolerant: an unavailable OS CSPRNG drops this
        // observation instead of weakening LLP 0154's random-body identity
        // contract or failing an application operation.
        let observation = ids::mint(IdKind::Observation).ok();
        let ts_ms = wall_now_ms();
        let details = scrub_details(details);
        let release = self.current_release();
        let admission = (long_lived && observation.is_some()).then(|| Event {
            sequence: 0,
            observation: observation
                .clone()
                .expect("checked telemetry observation identity"),
            phase: Phase::Admission,
            generation: String::new(),
            class_v: CLASS_REGISTRY_FOUNDATION_VERSION,
            ts_ms,
            kind: cap(kind, 64),
            name: cap(name, NAME_MAX_BYTES),
            status: None,
            duration_ms: None,
            code: None,
            correlation: correlation.map(|value| cap(value, CORRELATION_MAX_BYTES)),
            release: release.clone(),
            details: details.clone(),
            // D3 reserves capacity for failures and terminal outcomes. A
            // long-lived admission is successful high-volume evidence until
            // its terminal says otherwise, so it must compete in Normal.
            priority: Priority::Normal,
            enqueued_at: Instant::now(),
        });
        let generation = self.admit_span(admission);
        let active = generation.is_some() && observation.is_some();
        ObservationSpan {
            telemetry: self.clone(),
            observation,
            generation: generation.unwrap_or_default(),
            ts_ms,
            started: Instant::now(),
            kind: cap(kind, 64),
            name: cap(name, NAME_MAX_BYTES),
            correlation: correlation.map(|value| cap(value, CORRELATION_MAX_BYTES)),
            release,
            details: if long_lived { None } else { details },
            long_lived,
            active,
        }
    }

    pub fn point(
        &self,
        kind: &str,
        name: &str,
        status: Option<i64>,
        code: Option<&str>,
        correlation: Option<&str>,
        details: Option<Value>,
        priority: Priority,
    ) {
        let Ok(observation) = ids::mint(IdKind::Observation) else {
            return;
        };
        self.enqueue_current(Event {
            sequence: 0,
            observation,
            phase: Phase::Point,
            generation: String::new(),
            class_v: CLASS_REGISTRY_FOUNDATION_VERSION,
            ts_ms: wall_now_ms(),
            kind: cap(kind, 64),
            name: cap(name, NAME_MAX_BYTES),
            status,
            duration_ms: None,
            code: code.map(|value| cap(value, CODE_MAX_BYTES)),
            correlation: correlation.map(|value| cap(value, CORRELATION_MAX_BYTES)),
            release: self.current_release(),
            details: scrub_details(details),
            priority,
            enqueued_at: Instant::now(),
        });
    }

    /// Publish the release identity used by subsequent admissions. Spans keep
    /// the exact release captured at admission even if activation changes
    /// while they are in flight.
    pub(crate) fn set_release(&self, release: Option<&str>) {
        *self
            .producer
            .shared
            .release
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = release.map(str::to_owned);
    }

    fn current_release(&self) -> Option<String> {
        self.producer
            .shared
            .release
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone()
    }

    /// Publish process readiness once at the authoritative surface cut. Both
    /// listener bind and direct-Service poll readiness share this authority.
    pub(crate) fn record_process_ready(&self) {
        if self
            .producer
            .shared
            .ready_recorded
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_ok()
        {
            self.point(
                "lifecycle",
                "process_ready",
                Some(200),
                None,
                None,
                None,
                Priority::Reserved,
            );
        }
    }

    /// Capture the existing `runtime.log` host call. The allowlist stores only
    /// level and capped authored output; Phase 1 has no subject or IP field.
    pub fn runtime_log(&self, level: &str, message: &Value, correlation: Option<&str>) {
        let config = self
            .producer
            .shared
            .config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let severity = log_severity(level);
        if severity_rank(severity) < severity_rank(config.min_level) {
            return;
        }
        self.point(
            "log",
            level,
            None,
            None,
            correlation,
            Some(json!({ "level": level, "message": message })),
            Priority::Normal,
        );
    }

    /// Record an unattached diagnostic at the emission boundary. Phase 1
    /// admits only Warning+ diagnostics, further narrowed by `min_level`;
    /// informational diagnostics remain available through the existing
    /// recent-diagnostics ring without entering telemetry.
    pub(crate) fn standalone_diagnostic(&self, code: &str, severity: &DiagnosticSeverity) {
        let config = self
            .producer
            .shared
            .config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let threshold =
            severity_rank(config.min_level.clone()).max(severity_rank(DiagnosticSeverity::Warning));
        if severity_rank(severity.clone()) < threshold {
            return;
        }
        drop(config);
        let failure = matches!(
            severity,
            DiagnosticSeverity::Error | DiagnosticSeverity::Fatal
        );
        self.point(
            "diagnostic",
            code,
            Some(if failure { 500 } else { 200 }),
            Some(code),
            None,
            Some(json!({ "severity": severity })),
            Priority::Reserved,
        );
    }

    /// Admit a span and capture its generation at the same buffer-lock
    /// linearization point. A reset can therefore occur entirely before or
    /// after admission, never between the generation read and admission.
    fn admit_span(&self, mut admission: Option<Event>) -> Option<String> {
        let shared = &self.producer.shared;
        let config = shared
            .config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut buffer = shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if !buffer.accepting || config.max_days == 0 || buffer.shutdown {
            return None;
        }
        let generation = buffer.current_generation.clone();
        let should_wake = admission.as_mut().is_some_and(|event| {
            event.generation = generation.clone();
            enqueue_locked(&mut buffer, &config, event.clone())
        });
        drop(buffer);
        drop(config);
        if admission.is_some() {
            self.ensure_worker();
            if should_wake {
                shared.wake.notify_one();
            }
        }
        Some(generation)
    }

    fn enqueue_current(&self, event: Event) {
        self.enqueue(event, true);
    }

    fn enqueue_bound(&self, event: Event) {
        self.enqueue(event, false);
    }

    fn enqueue(&self, mut event: Event, bind_current_generation: bool) {
        let shared = &self.producer.shared;
        let config = shared
            .config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let mut buffer = shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if config.max_days == 0 || buffer.shutdown {
            return;
        }
        if !buffer.accepting {
            let reason = if buffer.generation_fenced {
                "generationFence"
            } else if buffer.config_fenced {
                "configTransition"
            } else {
                "admissionClosed"
            };
            buffer.count_drop(&event, reason);
            drop(buffer);
            drop(config);
            self.ensure_worker();
            shared.wake.notify_one();
            return;
        }
        if bind_current_generation {
            event.generation = buffer.current_generation.clone();
        }
        let should_wake = enqueue_locked(&mut buffer, &config, event);
        drop(buffer);
        drop(config);
        self.ensure_worker();
        if should_wake {
            shared.wake.notify_one();
        }
    }

    fn ensure_worker(&self) {
        let shared = self.producer.shared.clone();
        if shared
            .worker_started
            .compare_exchange(false, true, Ordering::AcqRel, Ordering::Acquire)
            .is_err()
        {
            return;
        }
        let worker_shared = shared.clone();
        let spawn = std::thread::Builder::new()
            .name("snapback-telemetry".to_owned())
            .spawn(move || worker(worker_shared));
        let Ok(handle) = spawn else {
            self.producer
                .shared
                .worker_started
                .store(false, Ordering::Release);
            let mut buffer = self
                .producer
                .shared
                .buffer
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            let drained = buffer.drain_batch(usize::MAX);
            for event in drained {
                buffer.count_drop(&event, "workerUnavailable");
            }
            return;
        };
        *shared
            .worker_handle
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some(handle);
    }

    /// Reset/restore phase 1: stop admission and discard everything not yet
    /// handed to the flusher. A concurrently flushing old-generation batch may
    /// still commit; the visibility view makes it harmless.
    pub fn begin_generation_transition(&self) {
        let mut buffer = self
            .producer
            .shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        buffer.generation_fenced = true;
        buffer.accepting = false;
        let drained = buffer.drain_batch(usize::MAX);
        for event in drained {
            buffer.count_drop(&event, "generationFence");
        }
        let has_drop_counters = !buffer.pending_drop_counters.is_empty();
        drop(buffer);
        if has_drop_counters {
            self.ensure_worker();
            self.producer.shared.wake.notify_one();
        }
    }

    /// Reset/restore phase 2: durably bind a freshly minted generation to the
    /// committed app incarnation before producer admission reopens.
    pub fn finish_generation_transition(&self, app_db_incarnation: &str) -> SnapbackResult<()> {
        let identity = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .identity
            .clone();
        self.finish_generation_transition_inner(app_db_incarnation, identity)
    }

    pub(crate) fn finish_generation_transition_with_identity(
        &self,
        app_db_incarnation: &str,
        identity: TelemetryStoreIdentity,
    ) -> SnapbackResult<()> {
        self.finish_generation_transition_inner(app_db_incarnation, Some(identity))
    }

    fn finish_generation_transition_inner(
        &self,
        app_db_incarnation: &str,
        identity: Option<TelemetryStoreIdentity>,
    ) -> SnapbackResult<()> {
        let generation = {
            let mut store = self
                .producer
                .shared
                .store
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            store.rebind_with_optional_identity(app_db_incarnation, identity, wall_now_ms())?;
            store.generation.clone()
        };
        let enabled = self
            .producer
            .shared
            .config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .max_days
            > 0;
        let mut buffer = self
            .producer
            .shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        buffer.current_generation = generation;
        buffer.generation_fenced = false;
        buffer.accepting = enabled && !buffer.config_fenced;
        Ok(())
    }

    pub fn cancel_generation_transition(&self) {
        let enabled = self
            .producer
            .shared
            .config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .max_days
            > 0;
        let mut buffer = self
            .producer
            .shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        buffer.generation_fenced = false;
        buffer.accepting = enabled && !buffer.config_fenced;
    }

    pub fn update_config(&self, config: TelemetryConfig) -> SnapbackResult<()> {
        config.validate()?;
        let had_drops = {
            let mut buffer = self
                .producer
                .shared
                .buffer
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            buffer.config_fenced = true;
            buffer.accepting = false;
            let drained = buffer.drain_batch(usize::MAX);
            for event in drained {
                buffer.count_drop(&event, "configTransition");
            }
            !buffer.pending_drop_counters.is_empty()
        };
        if had_drops {
            self.ensure_worker();
            self.producer.shared.wake.notify_one();
        }
        let old_enabled = self
            .producer
            .shared
            .config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .max_days
            > 0;
        let replacement_generation = {
            let mut store = self
                .producer
                .shared
                .store
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Err(error) = store.update_config(config.clone(), wall_now_ms()) {
                let mut buffer = self
                    .producer
                    .shared
                    .buffer
                    .lock()
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                buffer.config_fenced = false;
                buffer.accepting = old_enabled && !buffer.generation_fenced;
                self.producer.shared.wake.notify_all();
                return Err(error);
            }
            store.replacement_generation.take()
        };
        *self
            .producer
            .shared
            .config
            .write()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = config.clone();
        let mut buffer = self
            .producer
            .shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        if let Some(generation) = replacement_generation {
            buffer.current_generation = generation;
        }
        buffer.config_fenced = false;
        buffer.accepting = config.max_days > 0 && !buffer.generation_fenced;
        drop(buffer);
        self.producer.shared.wake.notify_all();
        Ok(())
    }

    #[cfg(test)]
    pub(crate) fn fail_next_config_update_for_test(&self) {
        self.producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .fail_update_config = true;
    }

    pub fn force_flush(&self) -> SnapbackResult<()> {
        let mut force_maintenance = true;
        loop {
            flush_shared(&self.producer.shared, force_maintenance)?;
            force_maintenance = false;
            let has_work = self
                .producer
                .shared
                .buffer
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .has_work();
            if !has_work {
                return Ok(());
            }
        }
    }

    pub fn diagnostics(&self) -> BufferDiagnostics {
        let buffer = self
            .producer
            .shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        BufferDiagnostics {
            depth: buffer.len(),
            normal_depth: buffer.normal.len(),
            reserved_depth: buffer.reserved.len(),
            drops_since_boot: buffer.drops_since_boot.clone(),
            last_flush_watermark: buffer.last_flush_watermark,
        }
    }

    #[cfg(test)]
    pub(crate) fn event_count_for_test(&self, kind: &str, name: &str, phase: &str) -> i64 {
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store
            .ensure_connection(wall_now_ms())
            .expect("open telemetry store for test query");
        connection
            .query_row(
                "SELECT count(*) FROM telemetry_events_visible WHERE kind=?1 AND name=?2 AND phase=?3",
                params![kind, name, phase],
                |row| row.get(0),
            )
            .expect("query telemetry event count")
    }

    #[cfg(test)]
    pub(crate) fn event_outcomes_for_test(
        &self,
        kind: &str,
        name: &str,
        phase: &str,
    ) -> Vec<(Option<i64>, Option<String>)> {
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store
            .ensure_connection(wall_now_ms())
            .expect("open telemetry store for test outcome query");
        connection
            .prepare(
                "SELECT status,code FROM telemetry_events_visible WHERE kind=?1 AND name=?2 AND phase=?3 ORDER BY id",
            )
            .expect("prepare telemetry outcome query")
            .query_map(params![kind, name, phase], |row| Ok((row.get(0)?, row.get(1)?)))
            .expect("query telemetry outcomes")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect telemetry outcomes")
    }

    #[cfg(test)]
    pub(crate) fn event_details_for_test(&self, kind: &str, name: &str) -> Vec<Option<Value>> {
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store
            .ensure_connection(wall_now_ms())
            .expect("open telemetry store for test details query");
        connection
            .prepare(
                "SELECT details FROM telemetry_events_visible WHERE kind=?1 AND name=?2 ORDER BY id",
            )
            .expect("prepare telemetry details query")
            .query_map(params![kind, name], |row| row.get::<_, Option<String>>(0))
            .expect("query telemetry details")
            .map(|details| {
                details.map(|details| {
                    details
                        .map(|details| serde_json::from_str(&details).expect("telemetry details JSON"))
                })
            })
            .collect::<Result<Vec<_>, _>>()
            .expect("collect telemetry details")
    }

    #[cfg(test)]
    pub(crate) fn event_releases_for_test(&self, kind: &str, name: &str) -> Vec<Option<String>> {
        let mut store = self
            .producer
            .shared
            .store
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let connection = store
            .ensure_connection(wall_now_ms())
            .expect("open telemetry store for test release query");
        connection
            .prepare(
                "SELECT release FROM telemetry_events_visible WHERE kind=?1 AND name=?2 ORDER BY id",
            )
            .expect("prepare telemetry release query")
            .query_map(params![kind, name], |row| row.get(0))
            .expect("query telemetry releases")
            .collect::<Result<Vec<_>, _>>()
            .expect("collect telemetry releases")
    }
}

fn enqueue_locked(buffer: &mut Buffer, config: &TelemetryConfig, mut event: Event) -> bool {
    buffer.next_sequence = buffer.next_sequence.saturating_add(1);
    event.sequence = buffer.next_sequence;
    let normal_limit = config
        .buffer_capacity
        .saturating_sub(config.priority_reserve);
    match event.priority {
        Priority::Normal => {
            if buffer.len() >= config.buffer_capacity && buffer.normal.is_empty() {
                buffer.count_drop(&event, "reservedProtectedDropIncoming");
                return true;
            }
            if buffer.normal.len() >= normal_limit || buffer.len() >= config.buffer_capacity {
                if let Some(dropped) = buffer.normal.pop_front() {
                    buffer.count_drop(&dropped, "bufferFullDropOldest");
                }
            }
            buffer.normal.push_back(event);
        }
        Priority::Reserved => {
            if buffer.len() >= config.buffer_capacity {
                if let Some(dropped) = buffer.normal.pop_front() {
                    buffer.count_drop(&dropped, "priorityDisplacedNormal");
                } else if let Some(dropped) = buffer.reserved.pop_front() {
                    buffer.count_drop(&dropped, "reservedFullDropOldest");
                }
            }
            buffer.reserved.push_back(event);
        }
    }
    buffer.len() >= config.batch_size || buffer.len() == 1
}

fn worker(shared: Arc<Shared>) {
    loop {
        let config = shared
            .config
            .read()
            .unwrap_or_else(|poisoned| poisoned.into_inner())
            .clone();
        let mut buffer = shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        while buffer.len() < config.batch_size && !buffer.shutdown {
            let Some(oldest) = buffer.oldest() else {
                buffer = shared
                    .wake
                    .wait(buffer)
                    .unwrap_or_else(|poisoned| poisoned.into_inner());
                continue;
            };
            let age = oldest.elapsed();
            let maximum = Duration::from_millis(config.max_age_ms);
            if age >= maximum {
                break;
            }
            let waited = shared
                .wake
                .wait_timeout(buffer, maximum - age)
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            buffer = waited.0;
        }
        let shutdown = buffer.shutdown;
        let has_work = buffer.has_work();
        drop(buffer);
        if has_work && flush_shared(&shared, false).is_err() && shutdown {
            shared.shutdown_flush_failed.store(true, Ordering::Release);
            break;
        }
        if shutdown {
            let remaining = shared
                .buffer
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner())
                .has_work();
            if !remaining {
                break;
            }
        }
    }
}

fn flush_shared(shared: &Arc<Shared>, force_maintenance: bool) -> SnapbackResult<()> {
    // Serialize drain + commit, not just SQLite access. `force_flush` can then
    // observe an actually empty producer rather than an empty buffer whose
    // batch is still in flight on another worker.
    let _flush = shared
        .flush_gate
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    let config = shared
        .config
        .read()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .clone();
    let (events, counters) = {
        let mut buffer = shared
            .buffer
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let events = buffer.drain_batch(config.batch_size.max(1));
        let counters = buffer.take_drop_counters();
        (events, counters)
    };
    if events.is_empty() && counters.is_empty() && !force_maintenance {
        return Ok(());
    }
    let boot_maintenance =
        config.max_days > 0 && shared.boot_maintenance_pending.load(Ordering::Acquire);
    let result = shared
        .store
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .flush(
            events.clone(),
            counters.clone(),
            wall_now_ms(),
            force_maintenance || boot_maintenance,
        );
    match result {
        Ok(outcome) => {
            if boot_maintenance {
                shared
                    .boot_maintenance_pending
                    .store(false, Ordering::Release);
            }
            let mut buffer = shared
                .buffer
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            if let Some(generation) = outcome.replacement_generation {
                buffer.current_generation = generation.clone();
                for event in std::mem::take(&mut buffer.normal) {
                    if event.generation == generation {
                        buffer.normal.push_back(event);
                    } else {
                        buffer.count_drop(&event, "storeReplaced");
                    }
                }
                for event in std::mem::take(&mut buffer.reserved) {
                    if event.generation == generation {
                        buffer.reserved.push_back(event);
                    } else {
                        buffer.count_drop(&event, "storeReplaced");
                    }
                }
                if buffer.shutdown {
                    shared.shutdown_flush_failed.store(true, Ordering::Release);
                }
            }
            if let Some(watermark) = outcome.watermark {
                buffer.last_flush_watermark = Some(
                    buffer
                        .last_flush_watermark
                        .map_or(watermark, |previous| previous.max(watermark)),
                );
            }
            for (key, count) in outcome.cap_drops {
                *buffer.drops_since_boot.entry(key).or_default() += count;
            }
            Ok(())
        }
        Err(error) => {
            let mut buffer = shared
                .buffer
                .lock()
                .unwrap_or_else(|poisoned| poisoned.into_inner());
            for event in events {
                buffer.count_drop(&event, "flushFailed");
            }
            buffer.restore_drop_counters(counters);
            Err(error)
        }
    }
}

fn telemetry_path(database_path: &Path) -> PathBuf {
    let mut name = database_path
        .file_name()
        .map(|value| value.to_string_lossy().into_owned())
        .unwrap_or_else(|| "snapback".to_owned());
    name.push_str(".telemetry");
    database_path.with_file_name(name)
}

fn wall_now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .min(i64::MAX as u128) as i64
}

fn cap(value: &str, maximum: usize) -> String {
    if value.len() <= maximum {
        return value.to_owned();
    }
    let mut end = maximum;
    while !value.is_char_boundary(end) {
        end -= 1;
    }
    value[..end].to_owned()
}

fn scrub_details(details: Option<Value>) -> Option<Value> {
    let Value::Object(input) = details? else {
        return None;
    };
    let allowed = BTreeSet::from([
        "attempt",
        "cause",
        "level",
        "message",
        "method",
        "rawPath",
        "referer",
        "severity",
        "trigger",
        "userAgent",
    ]);
    let mut output = Map::new();
    for (key, mut value) in input {
        if !allowed.contains(key.as_str()) {
            continue;
        }
        cap_json_strings(
            &mut value,
            if key == "rawPath" {
                NAME_MAX_BYTES
            } else {
                2_000
            },
        );
        if key == "rawPath"
            && let Some(path) = value.as_str()
        {
            value = Value::String(path.split('?').next().unwrap_or(path).to_owned());
        }
        output.insert(key, value);
    }
    let mut value = Value::Object(output);
    while serde_json::to_vec(&value).map_or(0, |bytes| bytes.len()) > DETAILS_MAX_BYTES {
        let Value::Object(map) = &mut value else {
            break;
        };
        let Some(last) = map.keys().next_back().cloned() else {
            break;
        };
        map.remove(&last);
    }
    Some(value)
}

fn cap_json_strings(value: &mut Value, maximum: usize) {
    match value {
        Value::String(text) => *text = cap(text, maximum),
        Value::Array(values) => {
            for value in values {
                cap_json_strings(value, maximum);
            }
        }
        Value::Object(values) => {
            for value in values.values_mut() {
                cap_json_strings(value, maximum);
            }
        }
        _ => {}
    }
}

fn log_severity(level: &str) -> DiagnosticSeverity {
    match level {
        "warn" | "warning" => DiagnosticSeverity::Warning,
        "error" => DiagnosticSeverity::Error,
        "fatal" => DiagnosticSeverity::Fatal,
        _ => DiagnosticSeverity::Info,
    }
}

fn severity_rank(severity: DiagnosticSeverity) -> u8 {
    match severity {
        DiagnosticSeverity::Info => 0,
        DiagnosticSeverity::Warning => 1,
        DiagnosticSeverity::Error => 2,
        DiagnosticSeverity::Fatal => 3,
    }
}

struct Store {
    path: Option<PathBuf>,
    path_identity: Option<TelemetryFileIdentity>,
    conn: Option<Connection>,
    generation: String,
    app_db_incarnation: String,
    identity: Option<TelemetryStoreIdentity>,
    config: TelemetryConfig,
    unclean_predecessor: bool,
    replacement_generation: Option<String>,
    #[cfg(test)]
    fail_before_commit: bool,
    #[cfg(test)]
    fail_rebind: bool,
    #[cfg(test)]
    fail_update_config: bool,
    #[cfg(test)]
    force_file_cap_estimator_miss: bool,
    #[cfg(test)]
    fail_postcommit_cap_recovery: bool,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum TelemetryFileIdentity {
    #[cfg(unix)]
    Unix { device: u64, inode: u64 },
    #[cfg(not(unix))]
    Present,
}

impl Store {
    #[cfg(test)]
    fn memory(app_db_incarnation: &str, config: TelemetryConfig) -> SnapbackResult<Self> {
        Self::memory_unbound(app_db_incarnation, config)
    }

    fn memory_unbound(app_db_incarnation: &str, config: TelemetryConfig) -> SnapbackResult<Self> {
        Self::memory_inner(app_db_incarnation, None, config)
    }

    fn memory_with_identity(
        app_db_incarnation: &str,
        identity: TelemetryStoreIdentity,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        Self::memory_inner(app_db_incarnation, Some(identity), config)
    }

    fn memory_inner(
        app_db_incarnation: &str,
        identity: Option<TelemetryStoreIdentity>,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        config.validate()?;
        let conn = Connection::open_in_memory()?;
        configure_connection(&conn)?;
        create_schema(&conn)?;
        let generation = ids::mint(IdKind::Generation)?;
        initialize_meta(
            &conn,
            &generation,
            app_db_incarnation,
            identity.as_ref(),
            &config,
            wall_now_ms(),
        )?;
        Ok(Self {
            path: None,
            path_identity: None,
            conn: Some(conn),
            generation,
            app_db_incarnation: app_db_incarnation.to_owned(),
            identity,
            config,
            unclean_predecessor: false,
            replacement_generation: None,
            #[cfg(test)]
            fail_before_commit: false,
            #[cfg(test)]
            fail_rebind: false,
            #[cfg(test)]
            fail_update_config: false,
            #[cfg(test)]
            force_file_cap_estimator_miss: false,
            #[cfg(test)]
            fail_postcommit_cap_recovery: false,
        })
    }

    #[cfg(test)]
    fn open(
        path: PathBuf,
        app_db_incarnation: &str,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        Self::open_unbound(path, app_db_incarnation, config)
    }

    fn open_unbound(
        path: PathBuf,
        app_db_incarnation: &str,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        Self::open_inner(path, app_db_incarnation, None, config)
    }

    fn open_with_identity(
        path: PathBuf,
        app_db_incarnation: &str,
        identity: TelemetryStoreIdentity,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        Self::open_inner(path, app_db_incarnation, Some(identity), config)
    }

    fn open_inner(
        path: PathBuf,
        app_db_incarnation: &str,
        identity: Option<TelemetryStoreIdentity>,
        config: TelemetryConfig,
    ) -> SnapbackResult<Self> {
        config.validate()?;
        let mut store = Self {
            path: Some(path.clone()),
            path_identity: None,
            conn: None,
            generation: ids::mint(IdKind::Generation)?,
            app_db_incarnation: app_db_incarnation.to_owned(),
            identity,
            config,
            unclean_predecessor: false,
            replacement_generation: None,
            #[cfg(test)]
            fail_before_commit: false,
            #[cfg(test)]
            fail_rebind: false,
            #[cfg(test)]
            fail_update_config: false,
            #[cfg(test)]
            force_file_cap_estimator_miss: false,
            #[cfg(test)]
            fail_postcommit_cap_recovery: false,
        };
        if path.exists() {
            let conn = open_owner_only(&path)?;
            configure_connection(&conn)?;
            create_schema(&conn)?;
            store.path_identity = telemetry_file_identity(&path)?;
            store.conn = Some(conn);
            store.bind_existing_or_initialize(wall_now_ms())?;
        }
        Ok(store)
    }

    fn ensure_connection(&mut self, now_ms: i64) -> SnapbackResult<&mut Connection> {
        if self.conn.is_some()
            && let Some(path) = self.path.as_ref()
            && telemetry_file_identity(path)? != self.path_identity
        {
            // The operator may delete or atomically replace the sibling at
            // any time. Never keep writing an unlinked SQLite inode: release
            // the old connection and bind a fresh store on the next write.
            self.conn.take();
            self.path_identity = None;
            self.generation = ids::mint(IdKind::Generation)?;
            let conn = open_owner_only(path)?;
            configure_connection(&conn)?;
            create_schema(&conn)?;
            self.path_identity = telemetry_file_identity(path)?;
            self.conn = Some(conn);
            self.bind_replacement(now_ms)?;
            self.replacement_generation = Some(self.generation.clone());
        }
        if self.conn.is_none() {
            let conn = match &self.path {
                Some(path) => open_owner_only(path)?,
                None => Connection::open_in_memory()?,
            };
            configure_connection(&conn)?;
            create_schema(&conn)?;
            initialize_meta(
                &conn,
                &self.generation,
                &self.app_db_incarnation,
                self.identity.as_ref(),
                &self.config,
                now_ms,
            )?;
            if let Some(path) = self.path.as_ref() {
                self.path_identity = telemetry_file_identity(path)?;
            }
            self.conn = Some(conn);
        }
        Ok(self.conn.as_mut().expect("connection initialized"))
    }

    fn bind_existing_or_initialize(&mut self, now_ms: i64) -> SnapbackResult<()> {
        let config = self.config.clone();
        let current_generation = self.generation.clone();
        let current_incarnation = self.app_db_incarnation.clone();
        let current_identity = self.identity.clone();
        let conn = self.conn.as_mut().expect("existing telemetry connection");
        let row: Option<(String, String, Option<String>, Option<String>, i64, i64)> = conn
            .query_row(
                "SELECT generation, app_db_incarnation, app_id, environment, observation_clock_ms, clean_shutdown FROM telemetry_meta WHERE singleton = 1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?, row.get(4)?, row.get(5)?)),
            )
            .optional()?;
        match row {
            None => initialize_meta(
                conn,
                &current_generation,
                &current_incarnation,
                current_identity.as_ref(),
                &config,
                now_ms,
            )?,
            Some((generation, incarnation, app_id, environment, high_water, clean_shutdown))
                if incarnation == current_incarnation
                    && match current_identity.as_ref() {
                        Some(identity) => {
                            app_id.as_deref() == Some(identity.app_id.as_str())
                                && environment.as_deref()
                                    == Some(identity.environment_id.as_str())
                        }
                        None => app_id.is_none() && environment.is_none(),
                    } =>
            {
                self.generation = generation;
                self.unclean_predecessor = clean_shutdown == 0;
                let clock = now_ms.max(high_water.saturating_add(1));
                advance_boundary(conn, &config, clock)?;
            }
            Some((
                _generation,
                _incarnation,
                _stored_app_id,
                _stored_environment,
                high_water,
                clean_shutdown,
            )) => {
                self.unclean_predecessor = clean_shutdown == 0;
                let generation = ids::mint(IdKind::Generation)?;
                let clock = now_ms.max(high_water.saturating_add(1));
                let app_id = current_identity
                    .as_ref()
                    .map(|identity| identity.app_id.as_str());
                let environment = current_identity
                    .as_ref()
                    .map(|identity| identity.environment_id.as_str());
                conn.execute(
                    "UPDATE telemetry_meta SET generation=?1, app_db_incarnation=?2, app_id=?3, environment=?4, max_days_mirror=?5, observation_clock_ms=?6, retention_floor=max(retention_floor, ?7), rollup_watermark_id=0, last_sweep_ms=0, aggregate_floor_hourly=0, aggregate_floor_daily=0 WHERE singleton=1",
                    params![generation, current_incarnation, app_id, environment, config.max_days, clock, boundary_for(&config, clock)],
                )?;
                self.generation = generation;
            }
        }
        // Claim this boot after reading the predecessor's final disposition.
        // A process death leaves zero behind; only a fully drained final
        // producer is allowed to publish one.
        conn.execute(
            "UPDATE telemetry_meta SET clean_shutdown=0 WHERE singleton=1",
            [],
        )?;
        Ok(())
    }

    fn bind_replacement(&mut self, now_ms: i64) -> SnapbackResult<()> {
        let generation = self.generation.clone();
        let incarnation = self.app_db_incarnation.clone();
        let identity = self.identity.clone();
        let config = self.config.clone();
        let conn = self.conn.as_mut().expect("replacement connection");
        let row: Option<(i64, Option<String>, Option<String>)> = conn
            .query_row(
                "SELECT observation_clock_ms,app_id,environment FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        if let Some((high_water, _stored_app_id, _stored_environment)) = row {
            let clock = now_ms.max(high_water.saturating_add(1));
            let app_id = identity.as_ref().map(|identity| identity.app_id.as_str());
            let environment = identity
                .as_ref()
                .map(|identity| identity.environment_id.as_str());
            conn.execute(
                "UPDATE telemetry_meta SET generation=?1, app_db_incarnation=?2, app_id=?3, environment=?4, max_days_mirror=?5, observation_clock_ms=?6, retention_floor=max(retention_floor,?7), rollup_watermark_id=0, last_sweep_ms=0, aggregate_floor_hourly=0, aggregate_floor_daily=0, clean_shutdown=0 WHERE singleton=1",
                params![generation, incarnation, app_id, environment, config.max_days, clock, boundary_for(&config, clock)],
            )?;
        } else {
            initialize_meta(
                conn,
                &generation,
                &incarnation,
                identity.as_ref(),
                &config,
                now_ms,
            )?;
        }
        Ok(())
    }

    /// Compose the store-scoped identity into one export record at the egress
    /// boundary. The eventual streaming exporter calls this while holding the
    /// same Store owner used for its visibility-view snapshot; event payloads
    /// cannot supply or override either identity field.
    ///
    /// @ref LLP 0154#d9--export-not-retention — exports are self-describing,
    ///   with app/environment read from the sibling's pinned meta authority.
    #[allow(dead_code)] // Consumed by the obs-03 streaming exporter lane.
    fn stamp_export_record(
        &mut self,
        record: &mut Map<String, Value>,
        now_ms: i64,
    ) -> SnapbackResult<()> {
        let (app_id, environment): (Option<String>, Option<String>) =
            self.ensure_connection(now_ms)?.query_row(
                "SELECT app_id,environment FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )?;
        let (Some(app_id), Some(environment)) = (app_id, environment) else {
            return Err(SnapbackError::error(
                "SNAPBACK_TELEMETRY_IDENTITY_UNBOUND",
                "telemetry",
                "telemetry export requires a trusted app/environment store binding",
            ));
        };
        let identity = TelemetryStoreIdentity::new(app_id, environment)?;
        record.insert("appId".to_owned(), Value::String(identity.app_id));
        record.insert(
            "environment".to_owned(),
            Value::String(identity.environment_id),
        );
        Ok(())
    }

    fn mark_clean_shutdown(&mut self, now_ms: i64) -> SnapbackResult<()> {
        // max_days=0 is a true off switch: do not create a telemetry sibling
        // merely to record the absence of telemetry. An existing sibling can
        // still close its already-claimed ownership bit.
        if self.conn.is_none() && self.path.as_ref().is_some_and(|path| !path.exists()) {
            return Ok(());
        }
        self.ensure_connection(now_ms)?.execute(
            "UPDATE telemetry_meta SET clean_shutdown=1 WHERE singleton=1",
            [],
        )?;
        Ok(())
    }

    #[cfg(test)]
    fn rebind(&mut self, app_db_incarnation: &str, now_ms: i64) -> SnapbackResult<()> {
        self.rebind_with_optional_identity(app_db_incarnation, self.identity.clone(), now_ms)
    }

    fn rebind_with_identity(
        &mut self,
        app_db_incarnation: &str,
        identity: TelemetryStoreIdentity,
        now_ms: i64,
    ) -> SnapbackResult<()> {
        self.rebind_with_optional_identity(app_db_incarnation, Some(identity), now_ms)
    }

    fn rebind_with_optional_identity(
        &mut self,
        app_db_incarnation: &str,
        identity: Option<TelemetryStoreIdentity>,
        now_ms: i64,
    ) -> SnapbackResult<()> {
        let generation = ids::mint(IdKind::Generation)?;
        let incarnation = app_db_incarnation.to_owned();
        let config = self.config.clone();
        if self.conn.is_none() && self.path.as_ref().is_some_and(|path| !path.exists()) {
            self.generation = generation;
            self.app_db_incarnation = incarnation;
            self.identity = identity;
            return Ok(());
        }
        #[cfg(test)]
        let fail_rebind = self.fail_rebind;
        let conn = self.ensure_connection(now_ms)?;
        let previous_clock: i64 = conn.query_row(
            "SELECT observation_clock_ms FROM telemetry_meta WHERE singleton=1",
            [],
            |row| row.get(0),
        )?;
        let clock = now_ms.max(previous_clock.saturating_add(1));
        #[cfg(test)]
        if fail_rebind {
            return Err(SnapbackError::error(
                "SNAPBACK_TELEMETRY_TEST_REBIND_FAILED",
                "telemetry",
                "injected telemetry rebind failure",
            ));
        }
        let app_id = identity.as_ref().map(|identity| identity.app_id.as_str());
        let environment = identity
            .as_ref()
            .map(|identity| identity.environment_id.as_str());
        conn.execute(
            "UPDATE telemetry_meta SET generation=?1, app_db_incarnation=?2, app_id=?3, environment=?4, max_days_mirror=?5, observation_clock_ms=?6, retention_floor=max(retention_floor, ?7), rollup_watermark_id=0, last_sweep_ms=0, aggregate_floor_hourly=0, aggregate_floor_daily=0 WHERE singleton=1",
            params![generation, incarnation, app_id, environment, config.max_days, clock, boundary_for(&config, clock)],
        )?;
        self.generation = generation;
        self.app_db_incarnation = incarnation;
        self.identity = identity;
        self.replacement_generation = None;
        Ok(())
    }

    fn update_config(&mut self, config: TelemetryConfig, now_ms: i64) -> SnapbackResult<()> {
        config.validate()?;
        if self.conn.is_none() && self.path.as_ref().is_some_and(|path| !path.exists()) {
            self.config = config;
            return Ok(());
        }
        #[cfg(test)]
        let fail_update_config = std::mem::take(&mut self.fail_update_config);
        let conn = self.ensure_connection(now_ms)?;
        let high_water: i64 = conn.query_row(
            "SELECT observation_clock_ms FROM telemetry_meta WHERE singleton=1",
            [],
            |row| row.get(0),
        )?;
        let clock = now_ms.max(high_water);
        let floor = if config.max_days == 0 {
            clock
        } else {
            boundary_for(&config, clock)
        };
        #[cfg(test)]
        if fail_update_config {
            return Err(SnapbackError::error(
                "SNAPBACK_TELEMETRY_TEST_CONFIG_FAILED",
                "telemetry",
                "injected telemetry config failure",
            ));
        }
        conn.execute(
            "UPDATE telemetry_meta SET max_days_mirror=?1, retention_floor=max(retention_floor, ?2), observation_clock_ms=?3, hourly_days=?4, daily_days=?5 WHERE singleton=1",
            params![config.max_days, floor, clock, config.hourly_days, config.daily_days],
        )?;
        self.config = config;
        Ok(())
    }

    fn flush(
        &mut self,
        events: Vec<Event>,
        mut drops: BTreeMap<String, u64>,
        now_ms: i64,
        force_maintenance: bool,
    ) -> SnapbackResult<FlushOutcome> {
        let config = self.config.clone();
        if config.max_days == 0 && events.is_empty() && drops.is_empty() {
            return Ok(FlushOutcome::default());
        }
        let path = self.path.clone();
        #[cfg(test)]
        let fail_before_commit = self.fail_before_commit;
        #[cfg(test)]
        let force_file_cap_estimator_miss = self.force_file_cap_estimator_miss;
        #[cfg(not(test))]
        let force_file_cap_estimator_miss = false;
        #[cfg(test)]
        let fail_postcommit_cap_recovery = self.fail_postcommit_cap_recovery;
        #[cfg(not(test))]
        let fail_postcommit_cap_recovery = false;
        self.ensure_connection(now_ms)?;
        let replacement_generation = self.replacement_generation.take();
        let mut replacement_drops = BTreeMap::new();
        let events = if replacement_generation.is_some() {
            for event in &events {
                let key = format!("{}:{}:storeReplaced", event.kind, event.priority.as_str());
                *replacement_drops.entry(key).or_default() += 1;
            }
            Vec::new()
        } else {
            events
        };
        let conn = self.conn.as_mut().expect("connection initialized");
        let mut committed_cap_drops = replacement_drops.clone();
        let (events, cap_pressure) = if force_file_cap_estimator_miss {
            (events, false)
        } else if let Some(path) = path.as_ref() {
            select_events_under_file_cap(
                conn,
                path,
                config.file_size_cap_bytes,
                events,
                &mut committed_cap_drops,
            )?
        } else {
            (events, false)
        };
        merge_counter_maps(&mut drops, &committed_cap_drops);
        let tx = conn.transaction()?;
        let high_water: i64 = tx.query_row(
            "SELECT observation_clock_ms FROM telemetry_meta WHERE singleton=1",
            [],
            |row| row.get(0),
        )?;
        let stamp = now_ms.max(high_water.saturating_add(1));
        advance_boundary_tx(&tx, &config, stamp)?;

        let mut inserted = false;
        if !events.is_empty() && config.max_days > 0 {
            insert_batch(&tx, &events, stamp)?;
            inserted = true;
        }
        merge_drop_counters(&tx, &drops)?;

        let last_sweep: i64 = tx.query_row(
            "SELECT last_sweep_ms FROM telemetry_meta WHERE singleton=1",
            [],
            |row| row.get(0),
        )?;
        let crossed_hour = hour_start(last_sweep) != hour_start(stamp);
        let swept = if force_maintenance
            || cap_pressure
            || last_sweep == 0
            || stamp.saturating_sub(last_sweep) >= config.sweep_interval_ms as i64
            || crossed_hour
        {
            maintain(&tx, &config, stamp)?
        } else {
            0
        };
        #[cfg(test)]
        if fail_before_commit {
            return Err(SnapbackError::error(
                "SNAPBACK_TELEMETRY_TEST_FLUSH_FAILED",
                "telemetry",
                "injected failure before telemetry flush commit",
            ));
        }
        tx.commit()?;
        if swept >= LARGE_SWEEP_ROWS {
            // Large retention/compaction sweeps can strand many WAL frames.
            // Checkpoint and refresh planner statistics only after the sweep
            // transaction commits; there is no timer or second worker.
            let _ = conn.execute_batch("PRAGMA optimize; PRAGMA wal_checkpoint(TRUNCATE);");
        }
        if let Some(path) = path.as_ref()
            && (cap_pressure || telemetry_file_bytes(path) > config.file_size_cap_bytes)
        {
            let _ = conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);");
            let recovery_drops =
                enforce_physical_file_cap(conn, path, &config, stamp, fail_postcommit_cap_recovery);
            merge_counter_maps(&mut committed_cap_drops, &recovery_drops);
        }
        Ok(FlushOutcome {
            watermark: inserted.then_some(stamp),
            cap_drops: committed_cap_drops,
            replacement_generation,
        })
    }
}

fn telemetry_file_identity(path: &Path) -> SnapbackResult<Option<TelemetryFileIdentity>> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(telemetry_io(path, "stat", error)),
    };
    if !metadata.file_type().is_file() {
        return Err(telemetry_io(
            path,
            "validate",
            std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "telemetry store must be a regular file, not a symlink or special file",
            ),
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt as _;
        // SAFETY: geteuid has no preconditions and reads process identity.
        let effective_uid = unsafe { libc::geteuid() };
        if metadata.uid() != effective_uid || metadata.nlink() != 1 {
            return Err(telemetry_io(
                path,
                "validate",
                std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    format!(
                        "telemetry store must be owned by uid {effective_uid} and have exactly one hard link"
                    ),
                ),
            ));
        }
        Ok(Some(TelemetryFileIdentity::Unix {
            device: metadata.dev(),
            inode: metadata.ino(),
        }))
    }
    #[cfg(not(unix))]
    {
        let _ = metadata;
        Ok(Some(TelemetryFileIdentity::Present))
    }
}

fn open_owner_only(path: &Path) -> SnapbackResult<Connection> {
    let missing = match fs::symlink_metadata(path) {
        Ok(_) => false,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => true,
        Err(error) => return Err(telemetry_io(path, "stat", error)),
    };
    if missing {
        let mut options = OpenOptions::new();
        options.read(true).write(true).create_new(true);
        #[cfg(unix)]
        {
            use std::os::unix::fs::OpenOptionsExt as _;
            options.mode(0o600);
            options.custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC);
        }
        match options.open(path) {
            Ok(file) => drop(file),
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(telemetry_io(path, "create", error)),
        }
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::{MetadataExt as _, OpenOptionsExt as _};
        let file = OpenOptions::new()
            .read(true)
            .write(true)
            .custom_flags(libc::O_NOFOLLOW | libc::O_CLOEXEC)
            .open(path)
            .map_err(|error| telemetry_io(path, "open", error))?;
        if file
            .metadata()
            .map_err(|error| telemetry_io(path, "stat", error))?
            .nlink()
            != 1
        {
            return Err(telemetry_io(
                path,
                "validate",
                std::io::Error::new(
                    std::io::ErrorKind::PermissionDenied,
                    "telemetry store must have exactly one hard link",
                ),
            ));
        }
        crate::secure_file::validate_and_repair_owner_only(&file)
            .map_err(|error| telemetry_io(path, "validate", error))?;
    }
    let before = telemetry_file_identity(path)?.ok_or_else(|| {
        telemetry_io(
            path,
            "open",
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "telemetry store disappeared before SQLite open",
            ),
        )
    })?;
    let sqlite_path =
        fs::canonicalize(path).map_err(|error| telemetry_io(path, "canonicalize", error))?;
    let connection = Connection::open_with_flags(
        &sqlite_path,
        OpenFlags::default() | OpenFlags::SQLITE_OPEN_NOFOLLOW,
    )?;
    let after = telemetry_file_identity(path)?.ok_or_else(|| {
        telemetry_io(
            path,
            "open",
            std::io::Error::new(
                std::io::ErrorKind::NotFound,
                "telemetry store disappeared during SQLite open",
            ),
        )
    })?;
    if before != after {
        return Err(telemetry_io(
            path,
            "open",
            std::io::Error::new(
                std::io::ErrorKind::PermissionDenied,
                "telemetry store path changed during SQLite open",
            ),
        ));
    }
    Ok(connection)
}

fn telemetry_io(path: &Path, operation: &str, error: std::io::Error) -> SnapbackError {
    SnapbackError::error(
        "SNAPBACK_TELEMETRY_STORE_IO",
        "telemetry",
        format!("telemetry store {operation} failed for {}", path.display()),
    )
    .with_details(json!({ "error": error.to_string() }))
}

fn configure_connection(conn: &Connection) -> SnapbackResult<()> {
    conn.busy_timeout(Duration::from_secs(5))?;
    conn.execute_batch(
        "PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;",
    )?;
    Ok(())
}

fn create_schema(conn: &Connection) -> SnapbackResult<()> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS telemetry_meta (
          singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
          generation TEXT NOT NULL,
          app_db_incarnation TEXT NOT NULL,
          app_id TEXT,
          environment TEXT,
          max_days_mirror INTEGER NOT NULL,
          retention_floor INTEGER NOT NULL,
          observation_clock_ms INTEGER NOT NULL,
          aggregate_floor_hourly INTEGER NOT NULL,
          aggregate_floor_daily INTEGER NOT NULL,
          rollup_watermark_id INTEGER NOT NULL,
          last_sweep_ms INTEGER NOT NULL,
          drop_counters_lifetime TEXT NOT NULL,
          hourly_days INTEGER NOT NULL,
          daily_days INTEGER NOT NULL,
          clean_shutdown INTEGER NOT NULL DEFAULT 1 CHECK (clean_shutdown IN (0, 1))
        );
        CREATE TABLE IF NOT EXISTS telemetry_events (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          observation TEXT NOT NULL,
          phase TEXT NOT NULL,
          generation TEXT NOT NULL,
          class_v INTEGER NOT NULL,
          ts_ms INTEGER NOT NULL,
          recorded_ts_ms INTEGER NOT NULL,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          status INTEGER,
          duration_ms REAL,
          subject TEXT CHECK (subject IS NULL),
          code TEXT,
          correlation TEXT,
          release TEXT,
          details TEXT
        );
        CREATE INDEX IF NOT EXISTS telemetry_events_order
          ON telemetry_events(generation, recorded_ts_ms, id);
        CREATE TABLE IF NOT EXISTS telemetry_rollup_hourly (
          generation TEXT NOT NULL,
          bucket_start_ms INTEGER NOT NULL,
          bucket_end_ms INTEGER NOT NULL,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          count INTEGER NOT NULL,
          error_count INTEGER NOT NULL,
          latency_histogram TEXT NOT NULL,
          coverage_start_ms INTEGER NOT NULL,
          coverage_end_ms INTEGER NOT NULL,
          watermark_id INTEGER NOT NULL,
          finalized INTEGER NOT NULL,
          folded_count INTEGER NOT NULL,
          PRIMARY KEY(generation, bucket_start_ms, kind, name)
        );
        CREATE TABLE IF NOT EXISTS telemetry_rollup_daily (
          generation TEXT NOT NULL,
          bucket_start_ms INTEGER NOT NULL,
          bucket_end_ms INTEGER NOT NULL,
          kind TEXT NOT NULL,
          name TEXT NOT NULL,
          count INTEGER NOT NULL,
          error_count INTEGER NOT NULL,
          latency_histogram TEXT NOT NULL,
          coverage_start_ms INTEGER NOT NULL,
          coverage_end_ms INTEGER NOT NULL,
          watermark_id INTEGER NOT NULL,
          folded_count INTEGER NOT NULL,
          PRIMARY KEY(generation, bucket_start_ms, kind, name)
        );
        DROP VIEW IF EXISTS telemetry_events_visible;
        CREATE VIEW telemetry_events_visible AS
          SELECT e.* FROM telemetry_events e, telemetry_meta m
          WHERE m.singleton=1
            AND m.max_days_mirror > 0
            AND e.generation=m.generation
            AND e.recorded_ts_ms > max(
              m.observation_clock_ms - m.max_days_mirror * 86400000,
              m.retention_floor
            );
        DROP VIEW IF EXISTS telemetry_rollup_visible;
        CREATE VIEW telemetry_rollup_visible AS
          SELECT 'hourly' AS tier, h.generation, h.bucket_start_ms, h.bucket_end_ms,
                 h.kind, h.name, h.count, h.error_count, h.latency_histogram,
                 h.coverage_start_ms, h.coverage_end_ms, h.watermark_id,
                 h.folded_count
          FROM telemetry_rollup_hourly h, telemetry_meta m
          WHERE m.singleton=1 AND m.max_days_mirror > 0
            AND h.generation=m.generation
            AND h.bucket_end_ms > max(
              m.aggregate_floor_hourly,
              m.observation_clock_ms - m.hourly_days * 86400000
            )
          UNION ALL
          SELECT 'daily', d.generation, d.bucket_start_ms, d.bucket_end_ms,
                 d.kind, d.name, d.count, d.error_count, d.latency_histogram,
                 d.coverage_start_ms, d.coverage_end_ms, d.watermark_id,
                 d.folded_count
          FROM telemetry_rollup_daily d, telemetry_meta m
          WHERE m.singleton=1 AND m.max_days_mirror > 0
            AND d.generation=m.generation
            AND d.bucket_end_ms > max(
              m.aggregate_floor_daily,
              m.observation_clock_ms - m.daily_days * 86400000
            );
        ",
    )?;
    let meta_columns = conn
        .prepare("PRAGMA table_info(telemetry_meta)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<BTreeSet<_>, _>>()?;
    if !meta_columns.contains("clean_shutdown") {
        // Existing stores predate crash ownership. Defaulting their first
        // observation to clean avoids fabricating an unclean predecessor at
        // upgrade; this boot immediately claims the bit afterward.
        conn.execute(
            "ALTER TABLE telemetry_meta ADD COLUMN clean_shutdown INTEGER NOT NULL DEFAULT 1 CHECK (clean_shutdown IN (0, 1))",
            [],
        )?;
    }
    // @ref LLP 0154#d1--telemetry-store-a-sibling-sqlite-database-generation-bound —
    //   identity is pinned once in meta, never copied from an event payload.
    //   NULL migration values force an explicitly identified boot down its
    //   generation-rotating rebind path, so legacy rows cannot be relabeled.
    if !meta_columns.contains("app_id") {
        conn.execute("ALTER TABLE telemetry_meta ADD COLUMN app_id TEXT", [])?;
    }
    if !meta_columns.contains("environment") {
        conn.execute("ALTER TABLE telemetry_meta ADD COLUMN environment TEXT", [])?;
    }
    let event_columns = conn
        .prepare("PRAGMA table_info(telemetry_events)")?
        .query_map([], |row| row.get::<_, String>(1))?
        .collect::<Result<BTreeSet<_>, _>>()?;
    if !event_columns.contains("release") {
        conn.execute("ALTER TABLE telemetry_events ADD COLUMN release TEXT", [])?;
    }
    Ok(())
}

fn initialize_meta(
    conn: &Connection,
    generation: &str,
    incarnation: &str,
    identity: Option<&TelemetryStoreIdentity>,
    config: &TelemetryConfig,
    now_ms: i64,
) -> SnapbackResult<()> {
    let floor = if config.max_days == 0 {
        now_ms
    } else {
        boundary_for(config, now_ms)
    };
    conn.execute(
        "INSERT OR IGNORE INTO telemetry_meta(singleton,generation,app_db_incarnation,app_id,environment,max_days_mirror,retention_floor,observation_clock_ms,aggregate_floor_hourly,aggregate_floor_daily,rollup_watermark_id,last_sweep_ms,drop_counters_lifetime,hourly_days,daily_days,clean_shutdown) VALUES(1,?1,?2,?3,?4,?5,?6,?7,0,0,0,0,'{}',?8,?9,0)",
        params![generation, incarnation, identity.map(|identity| identity.app_id.as_str()), identity.map(|identity| identity.environment_id.as_str()), config.max_days, floor, now_ms, config.hourly_days, config.daily_days],
    )?;
    Ok(())
}

fn advance_boundary(conn: &Connection, config: &TelemetryConfig, clock: i64) -> SnapbackResult<()> {
    let floor = if config.max_days == 0 {
        clock
    } else {
        boundary_for(config, clock)
    };
    conn.execute(
        "UPDATE telemetry_meta SET observation_clock_ms=?1,max_days_mirror=?2,retention_floor=max(retention_floor,?3),hourly_days=?4,daily_days=?5 WHERE singleton=1",
        params![clock, config.max_days, floor, config.hourly_days, config.daily_days],
    )?;
    Ok(())
}

fn advance_boundary_tx(
    tx: &Transaction<'_>,
    config: &TelemetryConfig,
    clock: i64,
) -> SnapbackResult<()> {
    let floor = if config.max_days == 0 {
        clock
    } else {
        boundary_for(config, clock)
    };
    tx.execute(
        "UPDATE telemetry_meta SET observation_clock_ms=?1,max_days_mirror=?2,retention_floor=max(retention_floor,?3),hourly_days=?4,daily_days=?5 WHERE singleton=1",
        params![clock, config.max_days, floor, config.hourly_days, config.daily_days],
    )?;
    Ok(())
}

fn boundary_for(config: &TelemetryConfig, clock: i64) -> i64 {
    clock.saturating_sub(i64::from(config.max_days).saturating_mul(DAY_MS))
}

fn insert_batch(tx: &Transaction<'_>, events: &[Event], stamp: i64) -> SnapbackResult<()> {
    let mut sql = String::from(
        "INSERT INTO telemetry_events(observation,phase,generation,class_v,ts_ms,recorded_ts_ms,kind,name,status,duration_ms,subject,code,correlation,release,details) VALUES ",
    );
    let mut values = Vec::<rusqlite::types::Value>::with_capacity(events.len() * 14);
    for (index, event) in events.iter().enumerate() {
        if index > 0 {
            sql.push(',');
        }
        sql.push_str("(?,?,?,?,?,?,?,?,?,?,NULL,?,?,?,?)");
        values.extend([
            event.observation.clone().into(),
            event.phase.as_str().to_owned().into(),
            event.generation.clone().into(),
            i64::from(event.class_v).into(),
            event.ts_ms.into(),
            stamp.into(),
            event.kind.clone().into(),
            event.name.clone().into(),
            event.status.into(),
            event.duration_ms.into(),
            event.code.clone().into(),
            event.correlation.clone().into(),
            event.release.clone().into(),
            event
                .details
                .as_ref()
                .and_then(|value| serde_json::to_string(value).ok())
                .into(),
        ]);
    }
    tx.execute(&sql, params_from_iter(values))?;
    Ok(())
}

fn merge_drop_counters(
    tx: &Transaction<'_>,
    increments: &BTreeMap<String, u64>,
) -> SnapbackResult<()> {
    if increments.is_empty() {
        return Ok(());
    }
    let encoded: String = tx.query_row(
        "SELECT drop_counters_lifetime FROM telemetry_meta WHERE singleton=1",
        [],
        |row| row.get(0),
    )?;
    let mut counters: BTreeMap<String, u64> = serde_json::from_str(&encoded).unwrap_or_default();
    for (key, count) in increments {
        *counters.entry(key.clone()).or_default() = counters
            .get(key)
            .copied()
            .unwrap_or_default()
            .saturating_add(*count);
    }
    tx.execute(
        "UPDATE telemetry_meta SET drop_counters_lifetime=?1 WHERE singleton=1",
        params![serde_json::to_string(&counters).expect("drop counters serialize")],
    )?;
    Ok(())
}

fn merge_counter_maps(target: &mut BTreeMap<String, u64>, increments: &BTreeMap<String, u64>) {
    for (key, count) in increments {
        let entry = target.entry(key.clone()).or_default();
        *entry = entry.saturating_add(*count);
    }
}

#[derive(Clone, Debug, Default)]
struct Aggregate {
    count: u64,
    errors: u64,
    histogram: [u64; 17],
    coverage_start: i64,
    coverage_end: i64,
    watermark: i64,
    folded: u64,
}

fn histogram_index(duration_ms: f64) -> usize {
    if !duration_ms.is_finite() || duration_ms < 0.0 {
        return 16;
    }
    let mut bound = 1.0;
    for index in 0..16 {
        if duration_ms <= bound {
            return index;
        }
        bound *= 2.0;
    }
    16
}

fn hour_start(timestamp: i64) -> i64 {
    timestamp.div_euclid(HOUR_MS) * HOUR_MS
}

fn day_start(timestamp: i64) -> i64 {
    timestamp.div_euclid(DAY_MS) * DAY_MS
}

fn maintain(tx: &Transaction<'_>, config: &TelemetryConfig, clock: i64) -> SnapbackResult<usize> {
    let (generation, watermark): (String, i64) = tx.query_row(
        "SELECT generation,rollup_watermark_id FROM telemetry_meta WHERE singleton=1",
        [],
        |row| Ok((row.get(0)?, row.get(1)?)),
    )?;
    let rows = {
        let mut statement = tx.prepare(
            "SELECT id,recorded_ts_ms,phase,kind,name,status,duration_ms,code FROM telemetry_events WHERE generation=?1 AND id>?2 ORDER BY id",
        )?;
        statement
            .query_map(params![generation, watermark], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<i64>>(5)?,
                    row.get::<_, Option<f64>>(6)?,
                    row.get::<_, Option<String>>(7)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    let maximum_id = rows.last().map(|row| row.0).unwrap_or(watermark);
    let mut aggregates: BTreeMap<(i64, String, String), Aggregate> = BTreeMap::new();
    for (id, recorded, phase, kind, name, status, duration, code) in rows {
        let counted = matches!(phase.as_str(), "point" | "joined" | "terminal");
        if !counted {
            continue;
        }
        let key = (hour_start(recorded), kind, name);
        let entry = aggregates.entry(key).or_insert_with(|| Aggregate {
            coverage_start: recorded,
            coverage_end: recorded,
            ..Aggregate::default()
        });
        entry.count += 1;
        entry.errors += u64::from(code.is_some() || status.is_some_and(|value| value >= 500));
        if let Some(duration) = duration {
            entry.histogram[histogram_index(duration)] += 1;
        }
        entry.coverage_start = entry.coverage_start.min(recorded);
        entry.coverage_end = entry.coverage_end.max(recorded);
        entry.watermark = entry.watermark.max(id);
    }
    for ((bucket, kind, name), aggregate) in aggregates {
        upsert_hourly(tx, &generation, bucket, &kind, &name, aggregate, clock)?;
    }
    tx.execute(
        "UPDATE telemetry_meta SET rollup_watermark_id=?1 WHERE singleton=1",
        params![maximum_id],
    )?;
    tx.execute(
        "UPDATE telemetry_rollup_hourly SET finalized=1 WHERE generation=?1 AND bucket_end_ms<=?2",
        params![generation, hour_start(clock)],
    )?;
    fold_finalized_heavy_hitters(tx, &generation, config.top_names_per_hour, clock)?;

    let mut swept = compact_hourly(tx, &generation, config, clock)?;
    swept = swept.saturating_add(evict_daily_horizon(tx, &generation, config, clock)?);
    swept = swept.saturating_add(tx.execute(
        "DELETE FROM telemetry_rollup_hourly WHERE generation<>?1",
        params![generation],
    )?);
    swept = swept.saturating_add(tx.execute(
        "DELETE FROM telemetry_rollup_daily WHERE generation<>?1",
        params![generation],
    )?);
    swept = swept.saturating_add(enforce_rollup_cap(tx, &generation, config.rollup_row_cap)?);

    let boundary = boundary_for(config, clock);
    swept = swept.saturating_add(tx.execute(
        "DELETE FROM telemetry_events WHERE generation<>?2 OR (generation=?2 AND id<=?1 AND recorded_ts_ms<=?3)",
        params![maximum_id, generation, boundary],
    )?);
    tx.execute(
        "UPDATE telemetry_meta SET retention_floor=max(retention_floor,?1),last_sweep_ms=?2 WHERE singleton=1",
        params![boundary, clock],
    )?;
    Ok(swept)
}

fn fold_finalized_heavy_hitters(
    tx: &Transaction<'_>,
    generation: &str,
    maximum: usize,
    clock: i64,
) -> SnapbackResult<()> {
    let groups = {
        let mut statement = tx.prepare(
            "SELECT DISTINCT bucket_start_ms,kind FROM telemetry_rollup_hourly WHERE generation=?1 AND finalized=1",
        )?;
        statement
            .query_map(params![generation], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, String>(1)?))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    for (bucket, kind) in groups {
        let rows = {
            let mut statement = tx.prepare(
                "SELECT name,count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,folded_count FROM telemetry_rollup_hourly WHERE generation=?1 AND bucket_start_ms=?2 AND kind=?3 AND name<>'_other' ORDER BY count DESC,name",
            )?;
            statement
                .query_map(params![generation, bucket, kind], |row| {
                    Ok((
                        row.get::<_, String>(0)?,
                        Aggregate {
                            count: row.get::<_, i64>(1)? as u64,
                            errors: row.get::<_, i64>(2)? as u64,
                            histogram: decode_histogram(&row.get::<_, String>(3)?),
                            coverage_start: row.get(4)?,
                            coverage_end: row.get(5)?,
                            watermark: row.get(6)?,
                            folded: row.get::<_, i64>(7)? as u64,
                        },
                    ))
                })?
                .collect::<Result<Vec<_>, _>>()?
        };
        if rows.len() <= maximum {
            continue;
        }
        let mut folded = Aggregate::default();
        let mut initialized = false;
        for (name, aggregate) in rows.into_iter().skip(maximum) {
            tx.execute(
                "DELETE FROM telemetry_rollup_hourly WHERE generation=?1 AND bucket_start_ms=?2 AND kind=?3 AND name=?4",
                params![generation, bucket, kind, name],
            )?;
            merge_aggregate(&mut folded, &aggregate, &mut initialized);
            folded.folded = folded.folded.saturating_add(aggregate.count);
        }
        if initialized {
            upsert_hourly(tx, generation, bucket, &kind, "_other", folded, clock)?;
        }
    }
    Ok(())
}

fn merge_aggregate(target: &mut Aggregate, source: &Aggregate, initialized: &mut bool) {
    target.count = target.count.saturating_add(source.count);
    target.errors = target.errors.saturating_add(source.errors);
    target.folded = target.folded.saturating_add(source.folded);
    for (target, source) in target.histogram.iter_mut().zip(source.histogram) {
        *target = target.saturating_add(source);
    }
    if !*initialized {
        target.coverage_start = source.coverage_start;
        target.coverage_end = source.coverage_end;
        *initialized = true;
    } else {
        target.coverage_start = target.coverage_start.min(source.coverage_start);
        target.coverage_end = target.coverage_end.max(source.coverage_end);
    }
    target.watermark = target.watermark.max(source.watermark);
}

fn decode_histogram(encoded: &str) -> [u64; 17] {
    serde_json::from_str::<Vec<u64>>(encoded)
        .ok()
        .filter(|values| values.len() == 17)
        .map(|values| core::array::from_fn(|index| values[index]))
        .unwrap_or([0; 17])
}

fn upsert_hourly(
    tx: &Transaction<'_>,
    generation: &str,
    bucket: i64,
    kind: &str,
    name: &str,
    mut aggregate: Aggregate,
    clock: i64,
) -> SnapbackResult<()> {
    let existing: Option<(i64, i64, String, i64, i64, i64, i64)> = tx
        .query_row(
            "SELECT count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,folded_count FROM telemetry_rollup_hourly WHERE generation=?1 AND bucket_start_ms=?2 AND kind=?3 AND name=?4",
            params![generation, bucket, kind, name],
            |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?)),
        )
        .optional()?;
    if let Some((count, errors, histogram, start, end, watermark, folded)) = existing {
        aggregate.count += count as u64;
        aggregate.errors += errors as u64;
        aggregate.folded += folded as u64;
        for (target, value) in aggregate
            .histogram
            .iter_mut()
            .zip(decode_histogram(&histogram))
        {
            *target += value;
        }
        aggregate.coverage_start = aggregate.coverage_start.min(start);
        aggregate.coverage_end = aggregate.coverage_end.max(end);
        aggregate.watermark = aggregate.watermark.max(watermark);
    }
    tx.execute(
        "INSERT OR REPLACE INTO telemetry_rollup_hourly(generation,bucket_start_ms,bucket_end_ms,kind,name,count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,finalized,folded_count) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
        params![generation,bucket,bucket.saturating_add(HOUR_MS),kind,name,aggregate.count,aggregate.errors,serde_json::to_string(&aggregate.histogram.as_slice()).expect("histogram serializes"),aggregate.coverage_start,aggregate.coverage_end,aggregate.watermark,i64::from(bucket.saturating_add(HOUR_MS)<=hour_start(clock)),aggregate.folded],
    )?;
    Ok(())
}

fn compact_hourly(
    tx: &Transaction<'_>,
    generation: &str,
    config: &TelemetryConfig,
    clock: i64,
) -> SnapbackResult<usize> {
    let cutoff = clock.saturating_sub(i64::from(config.hourly_days) * DAY_MS);
    let rows = {
        let mut statement = tx.prepare("SELECT bucket_start_ms,bucket_end_ms,kind,name,count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,folded_count FROM telemetry_rollup_hourly WHERE generation=?1 AND bucket_end_ms<=?2 ORDER BY bucket_start_ms")?;
        statement
            .query_map(params![generation, cutoff], |row| {
                Ok((
                    row.get::<_, i64>(0)?,
                    row.get::<_, i64>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, i64>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, i64>(7)?,
                    row.get::<_, i64>(8)?,
                    row.get::<_, i64>(9)?,
                    row.get::<_, i64>(10)?,
                ))
            })?
            .collect::<Result<Vec<_>, _>>()?
    };
    let mut daily: BTreeMap<(i64, String, String), Aggregate> = BTreeMap::new();
    let mut hourly_floor = None;
    for (start, end, kind, name, count, errors, hist, start_cov, end_cov, watermark, folded) in rows
    {
        hourly_floor = Some(hourly_floor.unwrap_or(0_i64).max(end));
        let entry = daily
            .entry((day_start(start), kind, name))
            .or_insert_with(|| Aggregate {
                coverage_start: start_cov,
                coverage_end: end_cov,
                ..Aggregate::default()
            });
        entry.count += count as u64;
        entry.errors += errors as u64;
        entry.folded += folded as u64;
        for (target, value) in entry.histogram.iter_mut().zip(decode_histogram(&hist)) {
            *target += value;
        }
        entry.coverage_start = entry.coverage_start.min(start_cov);
        entry.coverage_end = entry.coverage_end.max(end_cov);
        entry.watermark = entry.watermark.max(watermark);
    }
    for ((day, kind, name), aggregate) in daily {
        upsert_daily(tx, generation, day, &kind, &name, aggregate)?;
    }
    let mut swept = 0;
    if let Some(floor) = hourly_floor {
        swept = tx.execute(
            "DELETE FROM telemetry_rollup_hourly WHERE generation=?1 AND bucket_end_ms<=?2",
            params![generation, floor],
        )?;
        tx.execute("UPDATE telemetry_meta SET aggregate_floor_hourly=max(aggregate_floor_hourly,?1) WHERE singleton=1",params![floor])?;
    }
    Ok(swept)
}

fn upsert_daily(
    tx: &Transaction<'_>,
    generation: &str,
    bucket: i64,
    kind: &str,
    name: &str,
    mut aggregate: Aggregate,
) -> SnapbackResult<()> {
    let existing: Option<(i64,i64,String,i64,i64,i64,i64)> = tx.query_row(
        "SELECT count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,folded_count FROM telemetry_rollup_daily WHERE generation=?1 AND bucket_start_ms=?2 AND kind=?3 AND name=?4",
        params![generation,bucket,kind,name],
        |row| Ok((row.get(0)?,row.get(1)?,row.get(2)?,row.get(3)?,row.get(4)?,row.get(5)?,row.get(6)?)),
    ).optional()?;
    if let Some((count, errors, hist, start, end, watermark, folded)) = existing {
        aggregate.count += count as u64;
        aggregate.errors += errors as u64;
        aggregate.folded += folded as u64;
        for (target, value) in aggregate.histogram.iter_mut().zip(decode_histogram(&hist)) {
            *target += value;
        }
        aggregate.coverage_start = aggregate.coverage_start.min(start);
        aggregate.coverage_end = aggregate.coverage_end.max(end);
        aggregate.watermark = aggregate.watermark.max(watermark);
    }
    tx.execute("INSERT OR REPLACE INTO telemetry_rollup_daily(generation,bucket_start_ms,bucket_end_ms,kind,name,count,error_count,latency_histogram,coverage_start_ms,coverage_end_ms,watermark_id,folded_count) VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12)",
        params![generation,bucket,bucket.saturating_add(DAY_MS),kind,name,aggregate.count,aggregate.errors,serde_json::to_string(&aggregate.histogram.as_slice()).expect("histogram serializes"),aggregate.coverage_start,aggregate.coverage_end,aggregate.watermark,aggregate.folded])?;
    Ok(())
}

fn evict_daily_horizon(
    tx: &Transaction<'_>,
    generation: &str,
    config: &TelemetryConfig,
    clock: i64,
) -> SnapbackResult<usize> {
    let cutoff = clock.saturating_sub(i64::from(config.daily_days) * DAY_MS);
    let floor:Option<i64>=tx.query_row("SELECT max(bucket_end_ms) FROM telemetry_rollup_daily WHERE generation=?1 AND bucket_end_ms<=?2",params![generation,cutoff],|row|row.get(0))?;
    let mut swept = 0;
    if let Some(floor) = floor {
        swept = tx.execute(
            "DELETE FROM telemetry_rollup_daily WHERE generation=?1 AND bucket_end_ms<=?2",
            params![generation, floor],
        )?;
        tx.execute("UPDATE telemetry_meta SET aggregate_floor_daily=max(aggregate_floor_daily,?1) WHERE singleton=1",params![floor])?;
    }
    Ok(swept)
}

fn enforce_rollup_cap(tx: &Transaction<'_>, generation: &str, cap: usize) -> SnapbackResult<usize> {
    let mut swept = 0usize;
    loop {
        let count:i64=tx.query_row("SELECT (SELECT count(*) FROM telemetry_rollup_hourly WHERE generation=?1)+(SELECT count(*) FROM telemetry_rollup_daily WHERE generation=?1)",params![generation],|row|row.get(0))?;
        if count <= cap as i64 {
            break;
        }
        let oldest:Option<(String,i64,i64)>=tx.query_row(
            "SELECT tier,bucket_start_ms,bucket_end_ms FROM (SELECT 'hourly' tier,bucket_start_ms,bucket_end_ms FROM telemetry_rollup_hourly WHERE generation=?1 UNION ALL SELECT 'daily',bucket_start_ms,bucket_end_ms FROM telemetry_rollup_daily WHERE generation=?1) ORDER BY bucket_start_ms,tier LIMIT 1",
            params![generation],|row|Ok((row.get(0)?,row.get(1)?,row.get(2)?))).optional()?;
        let Some((tier, start, end)) = oldest else {
            break;
        };
        let (table, floor_column) = if tier == "hourly" {
            ("telemetry_rollup_hourly", "aggregate_floor_hourly")
        } else {
            ("telemetry_rollup_daily", "aggregate_floor_daily")
        };
        swept = swept.saturating_add(tx.execute(
            &format!("DELETE FROM {table} WHERE generation=?1 AND bucket_start_ms=?2"),
            params![generation, start],
        )?);
        tx.execute(
            &format!(
                "UPDATE telemetry_meta SET {floor_column}=max({floor_column},?1) WHERE singleton=1"
            ),
            params![end],
        )?;
    }
    Ok(swept)
}

fn event_storage_upper_bound(event: &Event) -> u64 {
    let payload = event
        .observation
        .len()
        .saturating_add(event.generation.len())
        .saturating_add(event.kind.len())
        .saturating_add(event.name.len())
        .saturating_add(event.code.as_ref().map_or(0, String::len))
        .saturating_add(event.correlation.as_ref().map_or(0, String::len))
        .saturating_add(
            event
                .details
                .as_ref()
                .and_then(|value| serde_json::to_vec(value).ok())
                .map_or(0, |value| value.len()),
        )
        .saturating_add(512) as u64;
    payload
        .saturating_add(4_095)
        .div_ceil(4_096)
        .saturating_mul(4_096)
        .saturating_add(8_192)
}

fn select_events_under_file_cap(
    conn: &Connection,
    path: &Path,
    cap: u64,
    events: Vec<Event>,
    drops: &mut BTreeMap<String, u64>,
) -> SnapbackResult<(Vec<Event>, bool)> {
    let estimate = events.iter().fold(0_u64, |total, event| {
        total.saturating_add(event_storage_upper_bound(event))
    });
    let mut physical = telemetry_file_bytes(path);
    if physical
        .saturating_add(FILE_CAP_FIXED_RESERVE_BYTES)
        .saturating_add(estimate)
        <= cap
    {
        return Ok((events, false));
    }

    conn.execute_batch("PRAGMA wal_checkpoint(TRUNCATE);")?;
    physical = telemetry_file_bytes(path);
    let mut available = cap.saturating_sub(physical.saturating_add(FILE_CAP_FIXED_RESERVE_BYTES));
    let mut candidates = events.into_iter().enumerate().collect::<Vec<_>>();
    candidates.sort_by(|(left_index, left), (right_index, right)| {
        let left_rank = u8::from(left.priority == Priority::Reserved);
        let right_rank = u8::from(right.priority == Priority::Reserved);
        right_rank
            .cmp(&left_rank)
            .then_with(|| right_index.cmp(left_index))
    });
    let mut retained = Vec::new();
    for (index, event) in candidates {
        let bytes = event_storage_upper_bound(&event);
        if bytes <= available {
            available -= bytes;
            retained.push((index, event));
        } else {
            let key = format!("{}:{}:fileCap", event.kind, event.priority.as_str());
            *drops.entry(key).or_default() += 1;
        }
    }
    retained.sort_by_key(|(index, _)| *index);
    Ok((retained.into_iter().map(|(_, event)| event).collect(), true))
}

fn enforce_physical_file_cap(
    conn: &mut Connection,
    path: &Path,
    config: &TelemetryConfig,
    clock: i64,
    fail_injected: bool,
) -> BTreeMap<String, u64> {
    let mut committed_drops = BTreeMap::new();
    while telemetry_file_bytes(path) > config.file_size_cap_bytes {
        if fail_injected {
            merge_counter_maps(&mut committed_drops, &record_postcommit_cap_failure(conn));
            break;
        }
        let step = match file_cap_recovery_step(conn, config, clock) {
            Ok(step) => step,
            Err(_) => {
                merge_counter_maps(&mut committed_drops, &record_postcommit_cap_failure(conn));
                break;
            }
        };
        merge_counter_maps(&mut committed_drops, &step);
        if conn
            .execute_batch("VACUUM; PRAGMA optimize; PRAGMA wal_checkpoint(TRUNCATE);")
            .is_err()
        {
            merge_counter_maps(&mut committed_drops, &record_postcommit_cap_failure(conn));
            break;
        }
    }
    committed_drops
}

fn file_cap_recovery_step(
    conn: &mut Connection,
    config: &TelemetryConfig,
    clock: i64,
) -> SnapbackResult<BTreeMap<String, u64>> {
    let tx = conn.transaction()?;
    // This is deliberately unconditional. The physical post-check is the
    // estimator-miss path, so the preflight may not have armed maintenance;
    // every raw interval must cross the rollup watermark before deletion.
    maintain(&tx, config, clock)?;
    let generation: String = tx.query_row(
        "SELECT generation FROM telemetry_meta WHERE singleton=1",
        [],
        |row| row.get(0),
    )?;
    let oldest_raw: Option<i64> = tx.query_row(
        "SELECT min(recorded_ts_ms) FROM telemetry_events WHERE generation=?1",
        params![generation],
        |row| row.get(0),
    )?;
    let mut cap_drops = BTreeMap::new();
    let swept = if let Some(oldest) = oldest_raw {
        let interval_end = hour_start(oldest).saturating_add(HOUR_MS);
        {
            let mut statement = tx.prepare(
                "SELECT kind,count(*) FROM telemetry_events WHERE generation=?1 AND recorded_ts_ms<=?2 GROUP BY kind",
            )?;
            for row in statement.query_map(params![generation, interval_end], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })? {
                let (kind, count) = row?;
                cap_drops.insert(
                    format!("{kind}:unknown:fileCapIntervalEvicted"),
                    count.max(0) as u64,
                );
            }
        }
        let swept = tx.execute(
            "DELETE FROM telemetry_events WHERE generation=?1 AND recorded_ts_ms<=?2",
            params![generation, interval_end],
        )?;
        tx.execute(
            "UPDATE telemetry_meta SET retention_floor=max(retention_floor,?1) WHERE singleton=1",
            params![interval_end],
        )?;
        swept
    } else {
        let oldest: Option<(String, i64, i64)> = tx
            .query_row(
                "SELECT tier,bucket_start_ms,bucket_end_ms FROM (SELECT 'hourly' tier,bucket_start_ms,bucket_end_ms FROM telemetry_rollup_hourly WHERE generation=?1 UNION ALL SELECT 'daily',bucket_start_ms,bucket_end_ms FROM telemetry_rollup_daily WHERE generation=?1) ORDER BY bucket_start_ms,tier LIMIT 1",
                params![generation],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .optional()?;
        let Some((tier, start, end)) = oldest else {
            return Err(SnapbackError::error(
                "SNAPBACK_TELEMETRY_FILE_CAP_UNSATISFIABLE",
                "telemetry",
                "telemetry schema and metadata exceed the configured file cap",
            ));
        };
        let (table, floor) = if tier == "hourly" {
            ("telemetry_rollup_hourly", "aggregate_floor_hourly")
        } else {
            ("telemetry_rollup_daily", "aggregate_floor_daily")
        };
        {
            let mut statement = tx.prepare(&format!(
                "SELECT kind,sum(count) FROM {table} WHERE generation=?1 AND bucket_start_ms=?2 GROUP BY kind"
            ))?;
            for row in statement.query_map(params![generation, start], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?))
            })? {
                let (kind, count) = row?;
                cap_drops.insert(
                    format!("{kind}:unknown:fileCapIntervalEvicted"),
                    count.max(0) as u64,
                );
            }
        }
        let swept = tx.execute(
            &format!("DELETE FROM {table} WHERE generation=?1 AND bucket_start_ms=?2"),
            params![generation, start],
        )?;
        tx.execute(
            &format!("UPDATE telemetry_meta SET {floor}=max({floor},?1) WHERE singleton=1"),
            params![end],
        )?;
        swept
    };
    if swept == 0 {
        return Err(SnapbackError::error(
            "SNAPBACK_TELEMETRY_FILE_CAP_UNSATISFIABLE",
            "telemetry",
            "telemetry could not shed a whole retained interval under file-cap pressure",
        ));
    }
    merge_drop_counters(&tx, &cap_drops)?;
    tx.execute(
        "UPDATE telemetry_meta SET last_sweep_ms=max(last_sweep_ms,?1) WHERE singleton=1",
        params![clock],
    )?;
    tx.commit()?;
    Ok(cap_drops)
}

fn record_postcommit_cap_failure(conn: &mut Connection) -> BTreeMap<String, u64> {
    let counters = BTreeMap::from([("telemetry:reserved:fileCapMaintenanceFailed".to_owned(), 1)]);
    if let Ok(tx) = conn.transaction()
        && merge_drop_counters(&tx, &counters).is_ok()
    {
        let _ = tx.commit();
    }
    counters
}

fn telemetry_file_bytes(path: &Path) -> u64 {
    [
        path.to_path_buf(),
        PathBuf::from(format!("{}-wal", path.display())),
        PathBuf::from(format!("{}-shm", path.display())),
    ]
    .iter()
    .filter_map(|path| fs::metadata(path).ok())
    .map(|metadata| metadata.len())
    .sum()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config() -> TelemetryConfig {
        TelemetryConfig {
            batch_size: 64,
            max_age_ms: 60_000,
            ..TelemetryConfig::default()
        }
    }

    fn identity(
        app_id: impl Into<String>,
        environment: impl Into<String>,
    ) -> TelemetryStoreIdentity {
        TelemetryStoreIdentity::new(app_id, environment).unwrap()
    }

    fn joined(generation: &str, kind: &str, sequence: u64) -> Event {
        Event {
            sequence,
            observation: ids::mint(IdKind::Observation).expect("test CSPRNG"),
            phase: Phase::Joined,
            generation: generation.to_owned(),
            class_v: 1,
            ts_ms: 1_000,
            kind: kind.to_owned(),
            name: "fixture".to_owned(),
            status: Some(200),
            duration_ms: Some(4.0),
            code: None,
            correlation: None,
            release: None,
            details: None,
            priority: Priority::Normal,
            enqueued_at: Instant::now(),
        }
    }

    fn joined_named(generation: &str, kind: &str, name: &str, sequence: u64) -> Event {
        let mut event = joined(generation, kind, sequence);
        event.name = name.to_owned();
        event
    }

    #[test]
    fn release_is_first_class_exact_and_admission_bound() {
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity("app-release", "preview-release"),
            config(),
        )
        .unwrap();
        telemetry.point(
            "lifecycle",
            "before_activation",
            Some(200),
            None,
            None,
            None,
            Priority::Reserved,
        );

        let predecessor = "release-a".repeat(1_024);
        let successor = "release-b".repeat(1_024);
        telemetry.set_release(Some(&predecessor));
        let span = telemetry.start_span(
            "live_subscribe",
            "release_capture",
            None,
            Some(json!({ "release": "payload-spoof", "cause": "fixture" })),
            true,
        );
        telemetry.set_release(Some(&successor));
        span.finish(
            Some(200),
            None,
            Some(json!({ "release": "terminal-spoof", "cause": "completed" })),
        );
        telemetry.point(
            "lifecycle",
            "after_activation",
            Some(200),
            None,
            None,
            Some(json!({ "release": "point-spoof" })),
            Priority::Reserved,
        );
        telemetry.force_flush().unwrap();

        let store = telemetry.producer.shared.store.lock().unwrap();
        let conn = store.conn.as_ref().unwrap();
        let before: Option<String> = conn
            .query_row(
                "SELECT release FROM telemetry_events WHERE name='before_activation'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(before, None, "pre-activation rows carry NULL release");
        let span_rows = conn
            .prepare(
                "SELECT phase,release,details FROM telemetry_events WHERE name='release_capture' ORDER BY id",
            )
            .unwrap()
            .query_map([], |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, Option<String>>(2)?,
                ))
            })
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(span_rows.len(), 2);
        assert!(
            span_rows
                .iter()
                .all(|(_, release, _)| release.as_deref() == Some(predecessor.as_str())),
            "both admission and terminal retain the exact admission release"
        );
        for (_, _, details) in span_rows {
            let details: Value = serde_json::from_str(details.as_deref().unwrap()).unwrap();
            assert!(details.get("release").is_none());
        }
        let (release, details): (Option<String>, Option<String>) = conn
            .query_row(
                "SELECT release,details FROM telemetry_events WHERE name='after_activation'",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(release.as_deref(), Some(successor.as_str()));
        let details: Value = serde_json::from_str(details.as_deref().unwrap()).unwrap();
        assert!(details.get("release").is_none());
    }

    #[test]
    fn meta_identity_is_exact_store_scoped_and_stamped_only_at_export() {
        let app_id = "app-identity".repeat(1_024);
        let environment = "environment-identity".repeat(1_024);
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity(app_id.clone(), environment.clone()),
            config(),
        )
        .unwrap();
        telemetry.point(
            "function_run",
            "identity_fixture",
            Some(200),
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();

        let mut store = telemetry.producer.shared.store.lock().unwrap();
        let conn = store.conn.as_ref().unwrap();
        let durable: (String, String) = conn
            .query_row(
                "SELECT app_id,environment FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(durable, (app_id.clone(), environment.clone()));
        let event_columns = conn
            .prepare("PRAGMA table_info(telemetry_events)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<BTreeSet<_>, _>>()
            .unwrap();
        assert!(!event_columns.contains("app_id"));
        assert!(!event_columns.contains("environment"));

        let mut record = json!({
            "observation": "obs_fixture",
            "appId": "payload-spoof",
            "environment": "payload-spoof"
        })
        .as_object()
        .unwrap()
        .clone();
        store
            .stamp_export_record(&mut record, wall_now_ms())
            .unwrap();
        assert_eq!(record["appId"], app_id);
        assert_eq!(record["environment"], environment);
    }

    #[test]
    fn unbound_store_never_fabricates_export_identity() {
        let telemetry =
            Telemetry::in_memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let mut record = Map::new();
        let error = telemetry
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .stamp_export_record(&mut record, wall_now_ms())
            .expect_err("missing production environment source fails closed");
        assert_eq!(error.diagnostic.code, "SNAPBACK_TELEMETRY_IDENTITY_UNBOUND");
        assert!(record.get("appId").is_none());
        assert!(record.get("environment").is_none());
    }

    #[test]
    fn explicit_store_identity_rejects_empty_axes() {
        for (app_id, environment) in [("", "preview"), ("app", ""), ("   ", "preview")] {
            let error = TelemetryStoreIdentity::new(app_id, environment)
                .expect_err("an empty identity axis is not a trusted store binding");
            assert_eq!(error.diagnostic.code, "SNAPBACK_TELEMETRY_IDENTITY_INVALID");
        }
    }

    #[test]
    fn corrupt_pinned_identity_cannot_become_a_self_describing_export() {
        let telemetry = Telemetry::in_memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            identity("app", "preview"),
            config(),
        )
        .unwrap();
        let mut store = telemetry.producer.shared.store.lock().unwrap();
        for (app_id, environment) in [("", "preview"), ("app", "   ")] {
            store
                .conn
                .as_ref()
                .unwrap()
                .execute(
                    "UPDATE telemetry_meta SET app_id=?1,environment=?2 WHERE singleton=1",
                    params![app_id, environment],
                )
                .unwrap();
            let mut record = Map::new();
            let error = store
                .stamp_export_record(&mut record, wall_now_ms())
                .expect_err("corrupt pinned identity fails closed at egress");
            assert_eq!(error.diagnostic.code, "SNAPBACK_TELEMETRY_IDENTITY_INVALID");
            assert!(record.get("appId").is_none());
            assert!(record.get("environment").is_none());
        }
    }

    #[test]
    fn priority_buffer_sheds_normal_oldest_before_reserved() {
        let telemetry = Telemetry::in_memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                buffer_capacity: 4,
                priority_reserve: 2,
                batch_size: 64,
                ..config()
            },
        )
        .unwrap();
        telemetry.point("log", "one", None, None, None, None, Priority::Normal);
        telemetry.point("log", "two", None, None, None, None, Priority::Normal);
        telemetry.point("log", "three", None, None, None, None, Priority::Normal);
        telemetry.point(
            "diagnostic",
            "failure",
            Some(500),
            Some("E"),
            None,
            None,
            Priority::Reserved,
        );
        let diagnostics = telemetry.diagnostics();
        assert_eq!(diagnostics.normal_depth, 2);
        assert_eq!(diagnostics.reserved_depth, 1);
        assert_eq!(diagnostics.drops_since_boot.values().sum::<u64>(), 1);
    }

    #[test]
    fn long_lived_admissions_cannot_consume_or_evict_failure_reserve() {
        let telemetry = Telemetry::in_memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                buffer_capacity: 4,
                priority_reserve: 2,
                batch_size: 64,
                ..config()
            },
        )
        .unwrap();
        for name in ["failure-one", "failure-two"] {
            telemetry.point(
                "diagnostic",
                name,
                Some(500),
                Some("SNAPBACK_TEST_FAILURE"),
                None,
                None,
                Priority::Reserved,
            );
        }
        let spans = (0..8)
            .map(|index| {
                telemetry.start_span("ws_connect", &format!("socket-{index}"), None, None, true)
            })
            .collect::<Vec<_>>();

        let diagnostics = telemetry.diagnostics();
        assert_eq!(diagnostics.depth, 4);
        assert_eq!(diagnostics.normal_depth, 2);
        assert_eq!(diagnostics.reserved_depth, 2);
        assert_eq!(diagnostics.drops_since_boot.values().sum::<u64>(), 6);
        let buffer = telemetry.producer.shared.buffer.lock().unwrap();
        assert_eq!(
            buffer
                .reserved
                .iter()
                .map(|event| event.name.as_str())
                .collect::<Vec<_>>(),
            ["failure-one", "failure-two"],
            "admission pressure cannot consume or evict failure reserve"
        );
        assert!(
            buffer
                .normal
                .iter()
                .all(|event| event.phase == Phase::Admission),
            "long-lived admissions remain in the normal class"
        );
        drop(buffer);
        for span in spans {
            span.finish(Some(200), None, None);
        }
    }

    #[test]
    fn reserved_saturation_never_allows_normal_to_exceed_total_capacity() {
        let telemetry = Telemetry::in_memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                buffer_capacity: 4,
                priority_reserve: 2,
                batch_size: 64,
                ..config()
            },
        )
        .unwrap();
        for name in ["a", "b", "c", "d"] {
            telemetry.point(
                "diagnostic",
                name,
                Some(500),
                Some("E"),
                None,
                None,
                Priority::Reserved,
            );
        }
        telemetry.point("log", "late", None, None, None, None, Priority::Normal);
        let diagnostics = telemetry.diagnostics();
        assert_eq!(diagnostics.depth, 4);
        assert_eq!(diagnostics.reserved_depth, 4);
        assert_eq!(diagnostics.normal_depth, 0);
        assert_eq!(diagnostics.drops_since_boot.values().sum::<u64>(), 1);
    }

    #[test]
    fn current_admission_stamps_generation_at_the_enqueue_linearization_point() {
        let telemetry = Telemetry::in_memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                batch_size: 64,
                ..config()
            },
        )
        .unwrap();
        let predecessor = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        telemetry.begin_generation_transition();
        telemetry
            .finish_generation_transition_with_identity(
                "01900000-0000-7000-8000-000000000002",
                identity("generation-app", "generation-environment"),
            )
            .unwrap();
        let successor = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();

        // Model a producer that prepared an event before the rotation but did
        // not reach the admission lock until afterward. Current-generation
        // admissions must be rebound at that lock, never retain the stale tag.
        telemetry.enqueue_current(joined(&predecessor, "function_run", 1));
        let admitted_generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .normal
            .front()
            .unwrap()
            .generation
            .clone();
        assert_ne!(predecessor, successor);
        assert_eq!(admitted_generation, successor);
    }

    #[test]
    fn force_flush_and_shutdown_drain_more_than_one_batch() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let telemetry_path = Telemetry::path_for_database(&app_path);
        let config = TelemetryConfig {
            buffer_capacity: 16,
            priority_reserve: 2,
            batch_size: 2,
            max_age_ms: 60_000,
            ..TelemetryConfig::default()
        };
        let telemetry = Telemetry::open_for_database(
            &app_path,
            "01900000-0000-7000-8000-000000000001",
            config.clone(),
        )
        .unwrap();
        let generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        {
            let mut buffer = telemetry.producer.shared.buffer.lock().unwrap();
            for sequence in 1..=5 {
                enqueue_locked(
                    &mut buffer,
                    &config,
                    joined(&generation, "function_run", sequence),
                );
            }
        }
        telemetry.force_flush().unwrap();
        let count: i64 = telemetry
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT count(*) FROM telemetry_events", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 5, "force_flush must drain every queued batch");

        {
            let mut buffer = telemetry.producer.shared.buffer.lock().unwrap();
            for sequence in 6..=10 {
                enqueue_locked(
                    &mut buffer,
                    &config,
                    joined(&generation, "function_run", sequence),
                );
            }
        }
        telemetry.ensure_worker();
        drop(telemetry);

        let conn = Connection::open(telemetry_path).unwrap();
        let count: i64 = conn
            .query_row("SELECT count(*) FROM telemetry_events", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(
            count, 11,
            "final producer drop drains work plus graceful shutdown"
        );
        let clean: i64 = conn
            .query_row(
                "SELECT clean_shutdown FROM telemetry_meta WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(clean, 1, "clean publishes only after the drain commits");
    }

    #[test]
    fn successful_long_lived_terminal_uses_reserved_capacity() {
        let telemetry = Telemetry::in_memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                buffer_capacity: 4,
                priority_reserve: 2,
                batch_size: 64,
                max_age_ms: 60_000,
                ..config()
            },
        )
        .unwrap();
        let span = telemetry.start_span("live_subscribe", "query", None, None, true);
        for name in ["one", "two", "three"] {
            telemetry.point("log", name, None, None, None, None, Priority::Normal);
        }
        span.finish(Some(200), None, Some(json!({ "cause": "unsubscribed" })));
        let buffer = telemetry.producer.shared.buffer.lock().unwrap();
        assert!(
            buffer
                .reserved
                .iter()
                .any(|event| event.phase == Phase::Terminal && event.status == Some(200)),
            "successful terminal survives normal-pressure shedding"
        );
    }

    #[test]
    fn dropped_short_span_records_one_reserved_cancellation() {
        let telemetry = Telemetry::in_memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                batch_size: 64,
                max_age_ms: 60_000,
                ..config()
            },
        )
        .unwrap();
        let span = telemetry.start_span("http_request", "/cancelled", None, None, false);
        drop(span);
        let buffer = telemetry.producer.shared.buffer.lock().unwrap();
        let cancelled = buffer
            .reserved
            .iter()
            .filter(|event| {
                event.phase == Phase::Joined
                    && event.status == Some(499)
                    && event.name == "/cancelled"
            })
            .collect::<Vec<_>>();
        assert_eq!(cancelled.len(), 1);
        assert_eq!(cancelled[0].code, None);
        assert_eq!(cancelled[0].details.as_ref().unwrap()["cause"], "cancelled");
    }

    #[test]
    fn bound_terminals_rejected_during_fences_are_counted() {
        let telemetry = Telemetry::in_memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                batch_size: 64,
                max_age_ms: 60_000,
                ..config()
            },
        )
        .unwrap();
        let generation_span =
            telemetry.start_span("live_subscribe", "generation", None, None, true);
        telemetry.begin_generation_transition();
        generation_span.finish(Some(200), None, Some(json!({ "cause": "reset" })));

        telemetry.cancel_generation_transition();
        let config_span = telemetry.start_span("ws_connect", "config", None, None, true);
        {
            let mut buffer = telemetry.producer.shared.buffer.lock().unwrap();
            buffer.config_fenced = true;
            buffer.accepting = false;
        }
        config_span.finish(Some(200), None, Some(json!({ "cause": "disconnected" })));

        let diagnostics = telemetry.diagnostics();
        assert_eq!(
            diagnostics
                .drops_since_boot
                .get("live_subscribe:reserved:generationFence"),
            Some(&1),
            "the late terminal is counted against reserved capacity"
        );
        assert_eq!(
            diagnostics
                .drops_since_boot
                .get("live_subscribe:normal:generationFence"),
            Some(&1),
            "the drained admission is counted against normal capacity"
        );
        assert_eq!(
            diagnostics
                .drops_since_boot
                .get("ws_connect:reserved:configTransition"),
            Some(&1)
        );
    }

    #[test]
    fn disabled_force_flush_preserves_first_enabled_boot_maintenance() {
        let mut disabled = config();
        disabled.max_days = 0;
        let telemetry =
            Telemetry::in_memory("01900000-0000-7000-8000-000000000001", disabled.clone()).unwrap();
        telemetry.force_flush().unwrap();
        assert!(
            telemetry
                .producer
                .shared
                .boot_maintenance_pending
                .load(Ordering::Acquire),
            "the whole-subsystem off switch cannot consume boot maintenance"
        );
        disabled.max_days = 7;
        telemetry.update_config(disabled).unwrap();
        telemetry.point(
            "log",
            "first_enabled",
            None,
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();
        assert!(
            !telemetry
                .producer
                .shared
                .boot_maintenance_pending
                .load(Ordering::Acquire),
            "the first enabled flush consumes boot maintenance"
        );
    }

    #[test]
    fn clean_and_unclean_boot_ownership_and_disabled_mode_are_exact() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let telemetry_path = Telemetry::path_for_database(&app_path);
        let incarnation = "01900000-0000-7000-8000-000000000001";

        let clean = Telemetry::open_for_database(&app_path, incarnation, config()).unwrap();
        drop(clean);
        let reopened = Telemetry::open_for_database(&app_path, incarnation, config()).unwrap();
        reopened.force_flush().unwrap();
        let clean_detection: i64 = reopened
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM telemetry_events WHERE name='detected_unclean_predecessor'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(clean_detection, 0, "a clean predecessor is not accused");
        drop(reopened);

        Connection::open(&telemetry_path)
            .unwrap()
            .execute(
                "UPDATE telemetry_meta SET clean_shutdown=0 WHERE singleton=1",
                [],
            )
            .unwrap();
        let crashed = Telemetry::open_for_database(&app_path, incarnation, config()).unwrap();
        crashed.force_flush().unwrap();
        let crash_detection: i64 = crashed
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM telemetry_events WHERE name='detected_unclean_predecessor'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(crash_detection, 1, "the next boot records one crash marker");
        drop(crashed);

        let disabled_app = dir.path().join("disabled.sqlite3");
        let disabled_path = Telemetry::path_for_database(&disabled_app);
        let disabled = Telemetry::open_for_database(
            &disabled_app,
            incarnation,
            TelemetryConfig {
                max_days: 0,
                ..config()
            },
        )
        .unwrap();
        drop(disabled);
        assert!(
            !disabled_path.exists(),
            "max_days=0 does not create persistence solely for boot ownership"
        );
    }

    #[test]
    fn legacy_store_migration_adds_identity_and_release_without_relabeling_rows() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("legacy.sqlite3");
        let telemetry_path = Telemetry::path_for_database(&app_path);
        let predecessor_generation = ids::mint(IdKind::Generation).unwrap();
        let incarnation = "01900000-0000-7000-8000-000000000001";
        let now = wall_now_ms();
        let conn = Connection::open(&telemetry_path).unwrap();
        conn.execute_batch(
            "CREATE TABLE telemetry_meta (
               singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
               generation TEXT NOT NULL,
               app_db_incarnation TEXT NOT NULL,
               max_days_mirror INTEGER NOT NULL,
               retention_floor INTEGER NOT NULL,
               observation_clock_ms INTEGER NOT NULL,
               aggregate_floor_hourly INTEGER NOT NULL,
               aggregate_floor_daily INTEGER NOT NULL,
               rollup_watermark_id INTEGER NOT NULL,
               last_sweep_ms INTEGER NOT NULL,
               drop_counters_lifetime TEXT NOT NULL,
               hourly_days INTEGER NOT NULL,
               daily_days INTEGER NOT NULL,
               clean_shutdown INTEGER NOT NULL DEFAULT 1 CHECK (clean_shutdown IN (0, 1))
             );
             CREATE TABLE telemetry_events (
               id INTEGER PRIMARY KEY AUTOINCREMENT,
               observation TEXT NOT NULL,
               phase TEXT NOT NULL,
               generation TEXT NOT NULL,
               class_v INTEGER NOT NULL,
               ts_ms INTEGER NOT NULL,
               recorded_ts_ms INTEGER NOT NULL,
               kind TEXT NOT NULL,
               name TEXT NOT NULL,
               status INTEGER,
               duration_ms REAL,
               subject TEXT CHECK (subject IS NULL),
               code TEXT,
               correlation TEXT,
               details TEXT
             );",
        )
        .unwrap();
        conn.execute(
            "INSERT INTO telemetry_meta(singleton,generation,app_db_incarnation,max_days_mirror,retention_floor,observation_clock_ms,aggregate_floor_hourly,aggregate_floor_daily,rollup_watermark_id,last_sweep_ms,drop_counters_lifetime,hourly_days,daily_days,clean_shutdown) VALUES(1,?1,?2,7,0,?3,0,0,0,0,'{}',90,730,1)",
            params![predecessor_generation, incarnation, now],
        )
        .unwrap();
        conn.execute(
            "INSERT INTO telemetry_events(observation,phase,generation,class_v,ts_ms,recorded_ts_ms,kind,name,status,duration_ms,subject,code,correlation,details) VALUES(?1,'joined',?2,1,?3,?3,'function_run','legacy',200,1.0,NULL,NULL,NULL,NULL)",
            params![ids::mint(IdKind::Observation).unwrap(), predecessor_generation, now],
        )
        .unwrap();
        drop(conn);

        let app_id = "migration-app".repeat(512);
        let environment = "migration-environment".repeat(512);
        let telemetry = Telemetry::open_for_database_with_identity(
            &app_path,
            incarnation,
            identity(app_id.clone(), environment.clone()),
            config(),
        )
        .unwrap();
        let store = telemetry.producer.shared.store.lock().unwrap();
        let conn = store.conn.as_ref().unwrap();
        let meta_columns = conn
            .prepare("PRAGMA table_info(telemetry_meta)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<BTreeSet<_>, _>>()
            .unwrap();
        assert!(meta_columns.contains("app_id"));
        assert!(meta_columns.contains("environment"));
        let event_columns = conn
            .prepare("PRAGMA table_info(telemetry_events)")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(1))
            .unwrap()
            .collect::<Result<BTreeSet<_>, _>>()
            .unwrap();
        assert!(event_columns.contains("release"));
        let (generation, durable_app, durable_environment): (String, String, String) = conn
            .query_row(
                "SELECT generation,app_id,environment FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_ne!(generation, predecessor_generation);
        assert_eq!((durable_app, durable_environment), (app_id, environment));
        let (release, visible): (Option<String>, i64) = conn
            .query_row(
                "SELECT
                   (SELECT release FROM telemetry_events WHERE name='legacy'),
                   (SELECT count(*) FROM telemetry_events_visible WHERE name='legacy')",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(release, None, "pre-column rows migrate as NULL release");
        assert_eq!(
            visible, 0,
            "identity-less predecessor rows are hidden, never relabeled"
        );
    }

    #[test]
    fn failed_shutdown_drain_never_marks_the_predecessor_clean() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let telemetry_path = Telemetry::path_for_database(&app_path);
        let telemetry = Telemetry::open_for_database(
            &app_path,
            "01900000-0000-7000-8000-000000000001",
            config(),
        )
        .unwrap();
        telemetry
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .fail_before_commit = true;
        drop(telemetry);
        let conn = Connection::open(telemetry_path).unwrap();
        let clean: i64 = conn
            .query_row(
                "SELECT clean_shutdown FROM telemetry_meta WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(clean, 0, "failed graceful flush remains detectably unclean");
        let graceful: i64 = conn
            .query_row(
                "SELECT count(*) FROM telemetry_events WHERE name='graceful_shutdown'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(graceful, 0, "a rolled-back marker cannot authorize clean");
    }

    #[test]
    fn deleting_live_sibling_regenerates_on_the_next_write() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let telemetry_path = Telemetry::path_for_database(&app_path);
        let telemetry = Telemetry::open_for_database(
            &app_path,
            "01900000-0000-7000-8000-000000000001",
            config(),
        )
        .unwrap();
        let predecessor_generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        telemetry.point(
            "log",
            "before_delete",
            None,
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();
        for path in [
            telemetry_path.clone(),
            PathBuf::from(format!("{}-wal", telemetry_path.display())),
            PathBuf::from(format!("{}-shm", telemetry_path.display())),
        ] {
            match fs::remove_file(path) {
                Ok(()) => {}
                Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
                Err(error) => panic!("remove telemetry sibling: {error}"),
            }
        }
        telemetry.point(
            "log",
            "delete_detection_batch",
            None,
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();
        telemetry.point(
            "log",
            "after_delete",
            None,
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();
        let successor_generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        assert_ne!(predecessor_generation, successor_generation);
        assert!(
            telemetry_path.exists(),
            "the next write recreates the sibling"
        );
        let conn = Connection::open(&telemetry_path).unwrap();
        let (detection_rows, visible, durable_generation, lifetime): (i64, i64, String, String) =
            conn.query_row(
                "SELECT
                    (SELECT count(*) FROM telemetry_events WHERE name='delete_detection_batch'),
                    (SELECT count(*) FROM telemetry_events_visible WHERE name='after_delete'),
                    generation,
                    drop_counters_lifetime
                 FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            detection_rows, 0,
            "the replacement-detection batch is dropped"
        );
        assert_eq!(visible, 1, "the regenerated write is durably visible");
        assert_eq!(durable_generation, successor_generation);
        let key = "log:normal:storeReplaced";
        assert_eq!(telemetry.diagnostics().drops_since_boot.get(key), Some(&1));
        let lifetime: BTreeMap<String, u64> = serde_json::from_str(&lifetime).unwrap();
        assert_eq!(lifetime.get(key), Some(&1));
    }

    #[cfg(unix)]
    #[test]
    fn telemetry_store_refuses_symlink_to_app_database_without_mutating_it() {
        use std::os::unix::fs::{MetadataExt as _, symlink};

        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let telemetry_path = Telemetry::path_for_database(&app_path);
        let app = Connection::open(&app_path).unwrap();
        app.execute_batch(
            "CREATE TABLE app_only(value TEXT); INSERT INTO app_only VALUES('safe');",
        )
        .unwrap();
        drop(app);
        let mode_before = fs::metadata(&app_path).unwrap().mode();
        symlink(&app_path, &telemetry_path).unwrap();

        assert!(
            Telemetry::open_for_database(
                &app_path,
                "01900000-0000-7000-8000-000000000001",
                config(),
            )
            .is_err()
        );
        let app = Connection::open(&app_path).unwrap();
        let value: String = app
            .query_row("SELECT value FROM app_only", [], |row| row.get(0))
            .unwrap();
        let telemetry_tables: i64 = app
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name LIKE 'telemetry_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(value, "safe");
        assert_eq!(telemetry_tables, 0);
        assert_eq!(fs::metadata(&app_path).unwrap().mode(), mode_before);
    }

    #[cfg(unix)]
    #[test]
    fn telemetry_store_refuses_hardlink_to_app_database_without_mutating_it() {
        use std::os::unix::fs::MetadataExt as _;

        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let telemetry_path = Telemetry::path_for_database(&app_path);
        let app = Connection::open(&app_path).unwrap();
        app.execute_batch(
            "CREATE TABLE app_only(value TEXT); INSERT INTO app_only VALUES('safe');",
        )
        .unwrap();
        drop(app);
        let mode_before = fs::metadata(&app_path).unwrap().mode();
        fs::hard_link(&app_path, &telemetry_path).unwrap();

        assert!(
            Telemetry::open_for_database(
                &app_path,
                "01900000-0000-7000-8000-000000000001",
                config(),
            )
            .is_err()
        );
        let app = Connection::open(&app_path).unwrap();
        let value: String = app
            .query_row("SELECT value FROM app_only", [], |row| row.get(0))
            .unwrap();
        let telemetry_tables: i64 = app
            .query_row(
                "SELECT count(*) FROM sqlite_master WHERE name LIKE 'telemetry_%'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(value, "safe");
        assert_eq!(telemetry_tables, 0);
        assert_eq!(fs::metadata(&app_path).unwrap().mode(), mode_before);
    }

    #[test]
    fn replacing_live_sibling_mints_fresh_generation_for_later_flushes() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let replacement_app = dir.path().join("replacement.sqlite3");
        let telemetry_path = Telemetry::path_for_database(&app_path);
        let replacement_path = Telemetry::path_for_database(&replacement_app);
        let incarnation = "01900000-0000-7000-8000-000000000001";
        let telemetry = Telemetry::open_for_database(&app_path, incarnation, config()).unwrap();
        let predecessor_generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        telemetry.point("log", "seed", None, None, None, None, Priority::Normal);
        telemetry.force_flush().unwrap();

        let replacement =
            Telemetry::open_for_database(&replacement_app, incarnation, config()).unwrap();
        replacement.point(
            "log",
            "replacement_seed",
            None,
            None,
            None,
            None,
            Priority::Normal,
        );
        replacement.force_flush().unwrap();
        drop(replacement);
        fs::rename(&replacement_path, &telemetry_path).unwrap();

        telemetry.point(
            "log",
            "replacement_detection_batch",
            None,
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();
        let successor_generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        assert_ne!(predecessor_generation, successor_generation);
        telemetry.point(
            "log",
            "after_replace_one",
            None,
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();
        telemetry.point(
            "log",
            "after_replace_two",
            None,
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();

        let conn = Connection::open(&telemetry_path).unwrap();
        let (detection_rows, visible, durable_generation, lifetime):
            (i64, i64, String, String) = conn
            .query_row(
                "SELECT
                    (SELECT count(*) FROM telemetry_events WHERE name='replacement_detection_batch'),
                    (SELECT count(*) FROM telemetry_events_visible WHERE name IN ('after_replace_one','after_replace_two')),
                    generation,
                    drop_counters_lifetime
                 FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?, row.get(3)?)),
            )
            .unwrap();
        assert_eq!(
            detection_rows, 0,
            "the replacement-detection batch is dropped"
        );
        assert_eq!(visible, 2, "later batches retain the rebound generation");
        assert_eq!(durable_generation, successor_generation);
        let key = "log:normal:storeReplaced";
        assert_eq!(telemetry.diagnostics().drops_since_boot.get(key), Some(&1));
        let lifetime: BTreeMap<String, u64> = serde_json::from_str(&lifetime).unwrap();
        assert_eq!(lifetime.get(key), Some(&1));
        let replacement_visible: i64 = conn
            .query_row(
                "SELECT count(*) FROM telemetry_events_visible WHERE name='replacement_seed'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(replacement_visible, 0, "replacement rows stay invisible");
    }

    #[test]
    fn panic_drop_preserves_unclean_boot_detection() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let incarnation = "01900000-0000-7000-8000-000000000001";
        let panic = std::panic::catch_unwind({
            let app_path = app_path.clone();
            move || {
                let telemetry =
                    Telemetry::open_for_database(&app_path, incarnation, config()).unwrap();
                telemetry.point(
                    "log",
                    "panic_probe",
                    None,
                    None,
                    None,
                    None,
                    Priority::Normal,
                );
                telemetry.force_flush().unwrap();
                panic!("simulated process panic");
            }
        });
        assert!(panic.is_err());
        let reopened = Telemetry::open_for_database(&app_path, incarnation, config()).unwrap();
        reopened.force_flush().unwrap();
        let detected: i64 = reopened
            .producer
            .shared
            .store
            .lock()
            .unwrap()
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM telemetry_events WHERE name='detected_unclean_predecessor'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(detected, 1);
    }

    #[test]
    fn drop_counters_alone_arm_the_worker_and_persist() {
        let telemetry = Telemetry::in_memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                batch_size: 64,
                max_age_ms: 1,
                ..TelemetryConfig::default()
            },
        )
        .unwrap();
        let generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        {
            let mut buffer = telemetry.producer.shared.buffer.lock().unwrap();
            buffer.count_drop(&joined(&generation, "function_run", 1), "generationFence");
        }
        telemetry.ensure_worker();
        telemetry.producer.shared.wake.notify_one();

        let deadline = Instant::now() + Duration::from_secs(1);
        loop {
            let encoded: String = telemetry
                .producer
                .shared
                .store
                .lock()
                .unwrap()
                .conn
                .as_ref()
                .unwrap()
                .query_row(
                    "SELECT drop_counters_lifetime FROM telemetry_meta WHERE singleton=1",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            let counters: BTreeMap<String, u64> = serde_json::from_str(&encoded).unwrap();
            if counters.values().sum::<u64>() == 1 {
                break;
            }
            assert!(Instant::now() < deadline, "drop-only work never flushed");
            std::thread::yield_now();
        }
    }

    #[test]
    fn rebind_and_config_failures_leave_memory_and_meta_consistent() {
        let mut store = Store::memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let original_generation = store.generation.clone();
        let original_incarnation = store.app_db_incarnation.clone();
        let original_config = store.config.clone();
        store.fail_rebind = true;
        assert!(
            store
                .rebind("01900000-0000-7000-8000-000000000002", wall_now_ms())
                .is_err()
        );
        let durable_binding: (String, String) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT generation,app_db_incarnation FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();
        assert_eq!(store.generation, original_generation);
        assert_eq!(store.app_db_incarnation, original_incarnation);
        assert_eq!(durable_binding, (original_generation, original_incarnation));

        store.fail_rebind = false;
        store.fail_update_config = true;
        let mut replacement = original_config.clone();
        replacement.max_days = 30;
        assert!(store.update_config(replacement, wall_now_ms()).is_err());
        let durable_max_days: u32 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT max_days_mirror FROM telemetry_meta WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(store.config, original_config);
        assert_eq!(durable_max_days, original_config.max_days);
    }

    #[test]
    fn config_disable_transition_drops_predecessor_work_without_resurrection() {
        let enabled = TelemetryConfig {
            batch_size: 64,
            max_age_ms: 60_000,
            ..TelemetryConfig::default()
        };
        let telemetry =
            Telemetry::in_memory("01900000-0000-7000-8000-000000000001", enabled.clone()).unwrap();
        let generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        {
            let mut buffer = telemetry.producer.shared.buffer.lock().unwrap();
            enqueue_locked(&mut buffer, &enabled, joined(&generation, "pre_disable", 1));
        }

        telemetry
            .update_config(TelemetryConfig {
                max_days: 0,
                ..enabled.clone()
            })
            .unwrap();
        telemetry.point(
            "function_run",
            "while_disabled",
            Some(200),
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.update_config(enabled).unwrap();
        telemetry.point(
            "function_run",
            "after_reenable",
            Some(200),
            None,
            None,
            None,
            Priority::Normal,
        );
        telemetry.force_flush().unwrap();

        let store = telemetry.producer.shared.store.lock().unwrap();
        let names = store
            .conn
            .as_ref()
            .unwrap()
            .prepare("SELECT name FROM telemetry_events_visible ORDER BY id")
            .unwrap()
            .query_map([], |row| row.get::<_, String>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(names, vec!["after_reenable"]);
    }

    #[test]
    fn flush_is_atomic_when_commit_fails() {
        let mut store = Store::memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        store.fail_before_commit = true;
        assert!(
            store
                .flush(
                    vec![joined(&generation, "function_run", 1)],
                    BTreeMap::new(),
                    2_000,
                    false
                )
                .is_err()
        );
        let count: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT count(*) FROM telemetry_events", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(count, 0);
    }

    #[test]
    fn retention_floor_prevents_decrease_raise_and_disable_resurrection() {
        let mut store = Store::memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        let day = DAY_MS;
        let base: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT observation_clock_ms FROM telemetry_meta",
                [],
                |row| row.get(0),
            )
            .unwrap();
        store
            .flush(
                vec![joined(&generation, "function_run", 1)],
                BTreeMap::new(),
                base + day,
                false,
            )
            .unwrap();
        store
            .update_config(
                TelemetryConfig {
                    max_days: 1,
                    ..config()
                },
                base + 10 * day,
            )
            .unwrap();
        store
            .update_config(
                TelemetryConfig {
                    max_days: 7,
                    ..config()
                },
                base + 10 * day,
            )
            .unwrap();
        let visible: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT count(*) FROM telemetry_events_visible", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(
            visible, 0,
            "raising retention cannot resurrect a hidden raw row"
        );
        store
            .update_config(
                TelemetryConfig {
                    max_days: 0,
                    ..config()
                },
                base + 10 * day,
            )
            .unwrap();
        store
            .update_config(
                TelemetryConfig {
                    max_days: 7,
                    ..config()
                },
                base + 5 * day,
            )
            .unwrap();
        let visible: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT count(*) FROM telemetry_events_visible", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(
            visible, 0,
            "disable/re-enable under rollback cannot resurrect raw rows"
        );
    }

    #[test]
    fn generation_rebind_hides_in_flight_predecessor_rows() {
        let mut store = Store::memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let predecessor = store.generation.clone();
        store
            .rebind("01900000-0000-7000-8000-000000000002", 2_000)
            .unwrap();
        let clock: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT observation_clock_ms FROM telemetry_meta",
                [],
                |row| row.get(0),
            )
            .unwrap();
        store
            .conn
            .as_ref()
            .unwrap()
            .execute("UPDATE telemetry_meta SET last_sweep_ms=?1", params![clock])
            .unwrap();
        store
            .flush(
                vec![joined(&predecessor, "function_run", 1)],
                BTreeMap::new(),
                clock + 1,
                false,
            )
            .unwrap();
        let visible: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT count(*) FROM telemetry_events_visible", [], |row| {
                row.get(0)
            })
            .unwrap();
        let total: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT count(*) FROM telemetry_events", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(total, 1);
        assert_eq!(visible, 0);
    }

    #[test]
    fn explicit_rebind_rotates_generation_and_replaces_identity_atomically() {
        let predecessor_identity = identity("app-before", "environment-before");
        let successor_identity =
            identity("app-after".repeat(1_024), "environment-after".repeat(1_024));
        let mut store = Store::memory_with_identity(
            "01900000-0000-7000-8000-000000000001",
            predecessor_identity,
            config(),
        )
        .unwrap();
        let predecessor_generation = store.generation.clone();
        store
            .flush(
                vec![joined(&predecessor_generation, "function_run", 1)],
                BTreeMap::new(),
                wall_now_ms(),
                false,
            )
            .unwrap();
        store
            .rebind_with_identity(
                "01900000-0000-7000-8000-000000000002",
                successor_identity.clone(),
                wall_now_ms(),
            )
            .unwrap();
        assert_ne!(store.generation, predecessor_generation);
        assert_eq!(store.identity.as_ref(), Some(&successor_identity));
        let durable: (String, String, String) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT generation,app_id,environment FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(durable.0, store.generation);
        assert_eq!(durable.1, successor_identity.app_id);
        assert_eq!(durable.2, successor_identity.environment_id);
        let visible: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT count(*) FROM telemetry_events_visible", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert_eq!(visible, 0, "predecessor rows stay generation-hidden");
    }

    #[test]
    fn maintenance_rolls_before_retention_and_views_are_generation_scoped() {
        let mut store = Store::memory("01900000-0000-7000-8000-000000000001", config()).unwrap();
        let generation = store.generation.clone();
        store
            .flush(
                vec![joined(&generation, "function_run", 1)],
                BTreeMap::new(),
                10 * DAY_MS,
                true,
            )
            .unwrap();
        let watermark: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT rollup_watermark_id FROM telemetry_meta",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let rollups: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row("SELECT count(*) FROM telemetry_rollup_visible", [], |row| {
                row.get(0)
            })
            .unwrap();
        assert!(watermark > 0);
        assert_eq!(rollups, 1);
    }

    #[test]
    fn finalized_hour_top_names_reconcile_across_multiple_flushes() {
        let mut store = Store::memory(
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                top_names_per_hour: 2,
                ..config()
            },
        )
        .unwrap();
        let generation = store.generation.clone();
        let base: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT observation_clock_ms FROM telemetry_meta",
                [],
                |row| row.get(0),
            )
            .unwrap();
        store
            .flush(
                vec![
                    joined_named(&generation, "function_run", "alpha", 1),
                    joined_named(&generation, "function_run", "bravo", 2),
                ],
                BTreeMap::new(),
                base + 1,
                true,
            )
            .unwrap();
        store
            .flush(
                vec![
                    joined_named(&generation, "function_run", "charlie", 3),
                    joined_named(&generation, "function_run", "delta", 4),
                ],
                BTreeMap::new(),
                base + 2,
                true,
            )
            .unwrap();
        let before_finalization: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM telemetry_rollup_hourly WHERE generation=?1 AND kind='function_run'",
                params![generation],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(before_finalization, 4);

        store
            .flush(
                Vec::new(),
                BTreeMap::new(),
                hour_start(base).saturating_add(HOUR_MS + 1),
                true,
            )
            .unwrap();
        let (rows, total, folded): (i64, i64, i64) = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT count(*),sum(count),sum(CASE WHEN name='_other' THEN folded_count ELSE 0 END) FROM telemetry_rollup_hourly WHERE generation=?1 AND kind='function_run'",
                params![generation],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(rows, 3, "two names plus the additive _other row");
        assert_eq!(total, 4);
        assert_eq!(folded, 2);
    }

    #[test]
    fn large_sweep_truncates_wal_after_commit() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("telemetry.sqlite3");
        let mut store = Store::open(
            path.clone(),
            "01900000-0000-7000-8000-000000000001",
            config(),
        )
        .unwrap();
        let generation = store.generation.clone();
        let base = wall_now_ms();
        let events = (0..LARGE_SWEEP_ROWS)
            .map(|sequence| joined(&generation, "function_run", sequence as u64))
            .collect();
        store.flush(events, BTreeMap::new(), base, true).unwrap();
        store
            .flush(
                Vec::new(),
                BTreeMap::new(),
                base + i64::from(DEFAULT_MAX_DAYS + 1) * DAY_MS,
                true,
            )
            .unwrap();
        let wal = PathBuf::from(format!("{}-wal", path.display()));
        assert_eq!(fs::metadata(wal).map_or(0, |metadata| metadata.len()), 0);
    }

    #[test]
    fn file_cap_sheds_one_batch_without_physical_overshoot() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("telemetry.sqlite3");
        let cap = 1024 * 1024;
        let mut store = Store::open(
            path.clone(),
            "01900000-0000-7000-8000-000000000001",
            TelemetryConfig {
                file_size_cap_bytes: cap,
                ..config()
            },
        )
        .unwrap();
        let generation = store.generation.clone();
        let mut events = (0..20)
            .map(|sequence| {
                let mut event = joined_named(&generation, "reserved_fixture", "reserved", sequence);
                event.priority = Priority::Reserved;
                event
            })
            .collect::<Vec<_>>();
        events.extend((20..320).map(|sequence| {
            let mut event = joined_named(&generation, "normal_fixture", "normal", sequence);
            event.details = Some(json!({ "message": "x".repeat(6_000) }));
            event
        }));
        store
            .flush(events, BTreeMap::new(), wall_now_ms(), true)
            .unwrap();

        let bytes = telemetry_file_bytes(&path);
        let conn = store.conn.as_ref().unwrap();
        let reserved: i64 = conn
            .query_row(
                "SELECT count(*) FROM telemetry_events WHERE kind='reserved_fixture'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let encoded: String = conn
            .query_row(
                "SELECT drop_counters_lifetime FROM telemetry_meta WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let drops: BTreeMap<String, u64> = serde_json::from_str(&encoded).unwrap();
        assert!(bytes <= cap, "{bytes} physical bytes exceeded {cap}");
        assert_eq!(reserved, 20, "reserved events are selected before normal");
        assert!(drops.values().sum::<u64>() > 0);
    }

    #[test]
    fn estimator_miss_rolls_before_raw_interval_eviction() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let telemetry_path = Telemetry::path_for_database(&app_path);
        let cap = 1024 * 1024;
        let config = TelemetryConfig {
            buffer_capacity: 400,
            priority_reserve: 20,
            batch_size: 400,
            file_size_cap_bytes: cap,
            ..config()
        };
        let telemetry = Telemetry::open_for_database(
            &app_path,
            "01900000-0000-7000-8000-000000000001",
            config.clone(),
        )
        .unwrap();
        let generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();

        // Prime last_sweep so the tested flush reaches the physical-cap
        // fallback without the ordinary flush transaction doing maintenance.
        {
            let mut buffer = telemetry.producer.shared.buffer.lock().unwrap();
            enqueue_locked(
                &mut buffer,
                &config,
                joined_named(&generation, "seed_fixture", "seed", 0),
            );
        }
        flush_shared(&telemetry.producer.shared, false).unwrap();
        let prior_watermark = telemetry.diagnostics().last_flush_watermark;
        {
            let mut store = telemetry.producer.shared.store.lock().unwrap();
            let high_water: i64 = store
                .conn
                .as_ref()
                .unwrap()
                .query_row(
                    "SELECT observation_clock_ms FROM telemetry_meta WHERE singleton=1",
                    [],
                    |row| row.get(0),
                )
                .unwrap();
            let next_hour = hour_start(high_water).saturating_add(HOUR_MS + 1_000);
            store
                .conn
                .as_ref()
                .unwrap()
                .execute(
                    "UPDATE telemetry_meta SET observation_clock_ms=?1,last_sweep_ms=?1 WHERE singleton=1",
                    params![next_hour],
                )
                .unwrap();
            store.force_file_cap_estimator_miss = true;
        }
        {
            let mut buffer = telemetry.producer.shared.buffer.lock().unwrap();
            for sequence in 1..=300 {
                let mut event =
                    joined_named(&generation, "normal_fixture", "estimator_miss", sequence);
                event.details = Some(json!({ "message": "x".repeat(6_000) }));
                enqueue_locked(&mut buffer, &config, event);
            }
        }

        flush_shared(&telemetry.producer.shared, false).unwrap();

        let diagnostics = telemetry.diagnostics();
        let fallback_key = "normal_fixture:unknown:fileCapIntervalEvicted";
        assert_eq!(diagnostics.drops_since_boot.get(fallback_key), Some(&300));
        assert!(
            diagnostics
                .drops_since_boot
                .keys()
                .all(|key| !key.ends_with(":fileCap") && !key.ends_with(":flushFailed")),
            "estimator-miss recovery must not be reported as preflight shedding or flush failure"
        );
        assert!(diagnostics.last_flush_watermark >= prior_watermark);

        let conn = Connection::open(&telemetry_path).unwrap();
        let rolled: i64 = conn
            .query_row(
                "SELECT coalesce(sum(count),0) FROM telemetry_rollup_hourly WHERE generation=?1 AND kind='normal_fixture'",
                params![generation],
                |row| row.get(0),
            )
            .unwrap();
        let raw: i64 = conn
            .query_row(
                "SELECT count(*) FROM telemetry_events WHERE generation=?1 AND kind='normal_fixture'",
                params![generation],
                |row| row.get(0),
            )
            .unwrap();
        let (floor, watermark, encoded): (i64, i64, String) = conn
            .query_row(
                "SELECT retention_floor,rollup_watermark_id,drop_counters_lifetime FROM telemetry_meta WHERE singleton=1",
                [],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        let lifetime: BTreeMap<String, u64> = serde_json::from_str(&encoded).unwrap();
        assert_eq!(rolled, 300, "raw rows must be rolled before cap eviction");
        assert_eq!(raw, 0, "the fallback evicts a complete raw interval");
        assert!(floor > 0, "whole-interval eviction advances the raw floor");
        assert!(
            watermark >= 301,
            "rollup watermark covers every committed row"
        );
        assert_eq!(lifetime.get(fallback_key), Some(&300));
        assert!(telemetry_file_bytes(&telemetry_path) <= cap);

        flush_shared(&telemetry.producer.shared, true).unwrap();
        assert_eq!(
            telemetry.diagnostics().last_flush_watermark,
            diagnostics.last_flush_watermark,
            "maintenance-only commits must not clear the last event watermark"
        );
    }

    #[test]
    fn file_cap_interval_eviction_counts_and_deletes_the_strict_floor_boundary() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("telemetry.sqlite3");
        let config = config();
        let mut store =
            Store::open(path, "01900000-0000-7000-8000-000000000001", config.clone()).unwrap();
        let generation = store.generation.clone();
        let boundary = hour_start(wall_now_ms()).saturating_add(HOUR_MS);
        store
            .flush(
                (0..3)
                    .map(|sequence| joined(&generation, "boundary_fixture", sequence))
                    .collect(),
                BTreeMap::new(),
                boundary.saturating_add(2),
                false,
            )
            .unwrap();
        let conn = store.conn.as_mut().unwrap();
        let ids = conn
            .prepare("SELECT id FROM telemetry_events WHERE generation=?1 ORDER BY id LIMIT 3")
            .unwrap()
            .query_map(params![generation], |row| row.get::<_, i64>(0))
            .unwrap()
            .collect::<Result<Vec<_>, _>>()
            .unwrap();
        assert_eq!(ids.len(), 3);
        for (id, recorded) in ids.into_iter().zip([
            boundary.saturating_sub(1),
            boundary,
            boundary.saturating_add(1),
        ]) {
            conn.execute(
                "UPDATE telemetry_events SET recorded_ts_ms=?1 WHERE id=?2",
                params![recorded, id],
            )
            .unwrap();
        }

        let drops = file_cap_recovery_step(conn, &config, boundary.saturating_add(2)).unwrap();
        assert_eq!(
            drops.get("boundary_fixture:unknown:fileCapIntervalEvicted"),
            Some(&2),
            "the row exactly at the strict floor is counted as evicted"
        );
        let (raw, visible, floor): (i64, i64, i64) = conn
            .query_row(
                "SELECT
                   (SELECT count(*) FROM telemetry_events WHERE generation=?1 AND kind='boundary_fixture'),
                   (SELECT count(*) FROM telemetry_events_visible WHERE kind='boundary_fixture'),
                   retention_floor
                 FROM telemetry_meta WHERE singleton=1",
                params![generation],
                |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
            )
            .unwrap();
        assert_eq!(floor, boundary);
        assert_eq!(raw, 1, "only the row strictly above the floor remains");
        assert_eq!(
            visible, 1,
            "physical deletion matches strict view visibility"
        );
        let surviving_recorded: i64 = conn
            .query_row(
                "SELECT recorded_ts_ms FROM telemetry_events WHERE generation=?1 AND kind='boundary_fixture'",
                params![generation],
                |row| row.get(0),
            )
            .unwrap();
        assert_eq!(surviving_recorded, boundary.saturating_add(1));
    }

    #[test]
    fn postcommit_cap_recovery_failure_is_not_a_flush_failure() {
        let dir = tempfile::tempdir().unwrap();
        let app_path = dir.path().join("app.sqlite3");
        let config = TelemetryConfig {
            buffer_capacity: 400,
            priority_reserve: 20,
            batch_size: 400,
            file_size_cap_bytes: 1024 * 1024,
            ..config()
        };
        let telemetry = Telemetry::open_for_database(
            &app_path,
            "01900000-0000-7000-8000-000000000001",
            config.clone(),
        )
        .unwrap();
        let generation = telemetry
            .producer
            .shared
            .buffer
            .lock()
            .unwrap()
            .current_generation
            .clone();
        {
            let mut store = telemetry.producer.shared.store.lock().unwrap();
            store.force_file_cap_estimator_miss = true;
            store.fail_postcommit_cap_recovery = true;
        }
        {
            let mut buffer = telemetry.producer.shared.buffer.lock().unwrap();
            for sequence in 1..=300 {
                let mut event = joined_named(
                    &generation,
                    "normal_fixture",
                    "postcommit_failure",
                    sequence,
                );
                event.details = Some(json!({ "message": "x".repeat(6_000) }));
                enqueue_locked(&mut buffer, &config, event);
            }
        }

        flush_shared(&telemetry.producer.shared, false).unwrap();

        let diagnostics = telemetry.diagnostics();
        let failure_key = "telemetry:reserved:fileCapMaintenanceFailed";
        assert_eq!(diagnostics.drops_since_boot.get(failure_key), Some(&1));
        assert!(
            diagnostics
                .drops_since_boot
                .keys()
                .all(|key| !key.ends_with(":flushFailed")),
            "a postcommit cap recovery error must not reclassify committed events"
        );
        let store = telemetry.producer.shared.store.lock().unwrap();
        let committed: i64 = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT count(*) FROM telemetry_events WHERE generation=?1 AND kind='normal_fixture'",
                params![generation],
                |row| row.get(0),
            )
            .unwrap();
        let encoded: String = store
            .conn
            .as_ref()
            .unwrap()
            .query_row(
                "SELECT drop_counters_lifetime FROM telemetry_meta WHERE singleton=1",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let lifetime: BTreeMap<String, u64> = serde_json::from_str(&encoded).unwrap();
        assert_eq!(
            committed, 300,
            "the original flush committed before recovery"
        );
        assert_eq!(lifetime.get(failure_key), Some(&1));
        assert!(
            lifetime.keys().all(|key| !key.ends_with(":flushFailed")),
            "lifetime accounting must not contain a false precommit failure"
        );
    }

    #[test]
    fn identifier_prefixes_are_registered_and_minted() {
        assert_eq!(IdKind::Observation.prefix(), "obs");
        assert_eq!(IdKind::Generation.prefix(), "gen");
        assert!(ids::mint(IdKind::Observation).unwrap().starts_with("obs_"));
        assert!(ids::mint(IdKind::Generation).unwrap().starts_with("gen_"));
    }

    #[test]
    fn standalone_diagnostics_apply_warning_floor_and_configured_minimum() {
        let mut policy = config();
        policy.min_level = DiagnosticSeverity::Error;
        policy.buffer_capacity = 4;
        policy.priority_reserve = 2;
        policy.batch_size = 64;
        policy.max_age_ms = 60_000;
        let telemetry =
            Telemetry::in_memory("01900000-0000-7000-8000-000000000001", policy.clone()).unwrap();

        telemetry.standalone_diagnostic("INFO_SUPPRESSED", &DiagnosticSeverity::Info);
        telemetry.standalone_diagnostic("WARNING_SUPPRESSED", &DiagnosticSeverity::Warning);
        telemetry.standalone_diagnostic("ERROR_RECORDED", &DiagnosticSeverity::Error);
        telemetry.force_flush().unwrap();

        let recorded = || {
            let store = telemetry.producer.shared.store.lock().unwrap();
            store
                .conn
                .as_ref()
                .unwrap()
                .prepare(
                    "SELECT name,code FROM telemetry_events_visible WHERE kind='diagnostic' ORDER BY id",
                )
                .unwrap()
                .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
                .unwrap()
                .collect::<Result<Vec<_>, _>>()
                .unwrap()
        };
        assert_eq!(
            recorded(),
            vec![("ERROR_RECORDED".to_owned(), "ERROR_RECORDED".to_owned())]
        );

        policy.min_level = DiagnosticSeverity::Info;
        telemetry.update_config(policy).unwrap();
        telemetry.standalone_diagnostic("INFO_STILL_SUPPRESSED", &DiagnosticSeverity::Info);
        telemetry.standalone_diagnostic("WARNING_RECORDED", &DiagnosticSeverity::Warning);
        for name in ["pressure_one", "pressure_two", "pressure_three"] {
            telemetry.point("log", name, None, None, None, None, Priority::Normal);
        }
        telemetry.force_flush().unwrap();
        assert_eq!(
            recorded(),
            vec![
                ("ERROR_RECORDED".to_owned(), "ERROR_RECORDED".to_owned()),
                ("WARNING_RECORDED".to_owned(), "WARNING_RECORDED".to_owned()),
            ],
            "Warning is reserved with its stable code under normal pressure"
        );
    }
}

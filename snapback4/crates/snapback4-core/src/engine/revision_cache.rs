//! Exact revision reuse: fresh validation (G5), a read grant (G6), or an owned SQLite stream.
// @ref LLP 3000.009.001.000.002#4.1 — immutable snapshot results reuse only at exactly their fill revision.
use super::{Context, DeliveryManifest, Engine, QueryOutcome};
use crate::{Refusal, identity::facts::SessionFacts};
use sha2::{Digest, Sha256};
use std::{
    collections::{BTreeMap, BTreeSet},
    sync::{
        Arc, Mutex, OnceLock,
        atomic::{AtomicU64, AtomicUsize, Ordering},
    },
};

const PROCESS_BYTES: usize = 512 << 20;
static PROCESS_USED: AtomicUsize = AtomicUsize::new(0);
type Key = [u8; 32];

/// Hard limits include bookkeeping, candidate references and reserved fills.
// @ref LLP 3000.009.001.000.002#4.5 — entry/byte/fill/per-principal bounds and process-wide retention accounting.
#[derive(Clone, Copy, Debug)]
pub struct Limits {
    pub bytes: usize,
    pub entries: usize,
    pub per_principal: usize,
    pub fills: usize,
    pub entry_bytes: usize,
}
impl Default for Limits {
    fn default() -> Self {
        Self {
            bytes: 448 << 20,
            entries: 32768,
            per_principal: 128,
            fills: 32,
            entry_bytes: 512 << 10,
        }
    }
}
#[derive(Clone, Copy, Debug, Default, serde::Serialize)]
pub struct Stats {
    pub hits: u64,
    pub g6_hits: u64,
    pub sqlite_hits: u64,
    pub g6_hit_stall_ns: u64,
    pub g6_stalled_hits: u64,
    pub g6_max_hit_stall_ns: u64,
    pub gate: super::postgres::read_grant::GateStats,
    pub misses: u64,
    pub mismatches: u64,
    pub evictions: u64,
    pub entries: usize,
    pub bytes: usize,
    pub fills: usize,
    pub process_bytes: usize,
}

struct Budget {
    used: AtomicUsize,
    fills: AtomicUsize,
    limit: usize,
}
struct Reservation {
    budget: Arc<Budget>,
    bytes: usize,
    encoded_data: Option<Box<serde_json::value::RawValue>>,
}
impl Drop for Reservation {
    fn drop(&mut self) {
        self.budget.used.fetch_sub(self.bytes, Ordering::AcqRel);
        PROCESS_USED.fetch_sub(self.bytes, Ordering::AcqRel);
    }
}
impl Budget {
    fn reserve(self: &Arc<Self>, bytes: usize) -> Option<Reservation> {
        self.used
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                n.checked_add(bytes).filter(|v| *v <= self.limit)
            })
            .ok()?;
        if PROCESS_USED
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                n.checked_add(bytes).filter(|v| *v <= PROCESS_BYTES)
            })
            .is_err()
        {
            self.used.fetch_sub(bytes, Ordering::AcqRel);
            return None;
        }
        Some(Reservation {
            budget: self.clone(),
            bytes,
            encoded_data: None,
        })
    }
}
/// Host-only retention accounting; it is deliberately absent from wire/value equality.
#[derive(Clone, Default)]
pub struct Lifetime(Option<Arc<Reservation>>);
impl Lifetime {
    /// Same Plain wire representation, charged to the retained entry budget.
    pub fn encoded_data(&self) -> Option<&serde_json::value::RawValue> {
        self.0.as_ref()?.encoded_data.as_deref()
    }
}
impl std::fmt::Debug for Lifetime {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str("CacheLifetime")
    }
}
impl PartialEq for Lifetime {
    fn eq(&self, _: &Self) -> bool {
        true
    }
}
impl Eq for Lifetime {}

type Stamp = super::postgres::read_grant::Published;
impl Stamp {
    fn of(f: &SessionFacts) -> Option<Self> {
        let revision = f.revision.filter(|r| *r >= 0)?;
        if !crate::identity::facts::ordinary(f) || f.sessions.len() != 1 {
            return None;
        }
        let generation = f.backend_generation?;
        if f.store_generation.as_deref()?.parse::<i64>().ok()? != generation {
            return None;
        }
        Some(Self {
            revision,
            head: f.head,
            store: f.store_id.clone()?,
            generation,
            schema: f.schema_hash.clone()?,
            code: f.activation_hash.clone()?,
        })
    }
}
struct Entry {
    stamp: Stamp,
    outcome: QueryOutcome,
    facts: SessionFacts,
    epoch: Option<String>,
    lifetime: Lifetime,
    owner: Key,
}
struct Slot {
    entry: Arc<Entry>,
    tick: u64,
}
#[derive(Default)]
struct State {
    clock: u64,
    entries: BTreeMap<Key, Slot>,
    lru: BTreeSet<(u64, Key)>,
    owners: BTreeMap<Key, usize>,
    probation: BTreeMap<Key, u64>,
    probation_lru: BTreeSet<(u64, Key)>,
}
impl State {
    fn evict(&mut self) -> bool {
        let Some((_, key)) = self.lru.pop_first() else {
            return false;
        };
        if let Some(slot) = self.entries.remove(&key) {
            let n = self.owners.get_mut(&slot.entry.owner).unwrap();
            *n -= 1;
            if *n == 0 {
                self.owners.remove(&slot.entry.owner);
            }
        }
        true
    }
    fn remove(&mut self, key: &Key) {
        if let Some(slot) = self.entries.remove(key) {
            self.lru.remove(&(slot.tick, *key));
            let n = self.owners.get_mut(&slot.entry.owner).unwrap();
            *n -= 1;
            if *n == 0 {
                self.owners.remove(&slot.entry.owner);
            }
        }
    }
}
pub(crate) struct Cache {
    limits: Limits,
    budget: Arc<Budget>,
    bookkeeping: OnceLock<Option<Reservation>>,
    state: Mutex<State>,
    code: OnceLock<(String, String)>,
    grant: OnceLock<Arc<super::postgres::read_grant::Grant>>,
    retired_grant: std::sync::atomic::AtomicBool,
    g6_hits: AtomicU64,
    sqlite_hits: AtomicU64,
    g6_hit_stall_ns: AtomicU64,
    g6_stalled_hits: AtomicU64,
    g6_max_hit_stall_ns: AtomicU64,
    hits: AtomicU64,
    misses: AtomicU64,
    mismatches: AtomicU64,
    evictions: AtomicU64,
    diagnostics: OnceLock<()>,
}
impl Default for Cache {
    fn default() -> Self {
        Self::new(Limits::default())
    }
}
impl Cache {
    fn new(limits: Limits) -> Self {
        let limits = Limits {
            bytes: limits.bytes.min(448 << 20),
            entries: limits.entries.min(32768),
            per_principal: limits.per_principal.min(128),
            fills: limits.fills.min(32),
            entry_bytes: limits.entry_bytes.min(512 << 10),
        };
        let budget = Arc::new(Budget {
            used: AtomicUsize::new(0),
            fills: AtomicUsize::new(0),
            limit: limits.bytes,
        });
        // Conservative reservation covers both bounded maps/trees, owner counts,
        // keys, Arc/control blocks and allocator overhead, even at sparse occupancy.
        Self {
            limits,
            budget,
            bookkeeping: OnceLock::new(),
            state: Default::default(),
            code: OnceLock::new(),
            grant: OnceLock::new(),
            retired_grant: std::sync::atomic::AtomicBool::new(false),
            g6_hits: AtomicU64::new(0),
            sqlite_hits: AtomicU64::new(0),
            g6_hit_stall_ns: AtomicU64::new(0),
            g6_stalled_hits: AtomicU64::new(0),
            g6_max_hit_stall_ns: AtomicU64::new(0),
            hits: AtomicU64::new(0),
            misses: AtomicU64::new(0),
            mismatches: AtomicU64::new(0),
            evictions: AtomicU64::new(0),
            diagnostics: OnceLock::new(),
        }
    }
    fn lookup(self: &Arc<Self>, key: Key) -> (Option<Arc<Entry>>, bool) {
        self.diagnostics.get_or_init(|| {
            // Operator-local count tracing for capacity experiments. No keys,
            // credentials, results or authority facts enter this optional log.
            if let Some(path) = std::env::var_os("SNAPBACK4_READ_CACHE_METRICS") {
                let Some(diagnostic_memory) = self.budget.reserve(128 << 10) else {
                    return;
                };
                let weak = Arc::downgrade(self);
                let _ = std::thread::Builder::new()
                    .name("read-cache-metrics".into())
                    .stack_size(64 << 10)
                    .spawn(move || {
                        use std::io::Write;
                        let _diagnostic_memory = diagnostic_memory;
                        let Ok(mut file) = std::fs::OpenOptions::new()
                            .create(true)
                            .append(true)
                            .open(path)
                        else {
                            return;
                        };
                        loop {
                            let Some(cache) = weak.upgrade() else {
                                break;
                            };
                            let at = std::time::SystemTime::now()
                                .duration_since(std::time::UNIX_EPOCH)
                                .unwrap_or_default()
                                .as_secs_f64();
                            let record = serde_json::json!({"time":at,"stats":cache.stats()});
                            if serde_json::to_writer(&mut file, &record).is_err()
                                || file.write_all(b"\n").is_err()
                                || file.flush().is_err()
                            {
                                break;
                            }
                            drop(cache);
                            std::thread::sleep(std::time::Duration::from_millis(250));
                        }
                    });
            }
        });
        if self.limits.entries == 0
            || self
                .bookkeeping
                .get_or_init(|| {
                    self.budget.reserve(
                        self.limits
                            .entries
                            .saturating_mul(1024)
                            .saturating_add(4096),
                    )
                })
                .is_none()
        {
            return (None, false);
        }
        let Ok(mut s) = self.state.try_lock() else {
            return (None, false);
        };
        s.clock = s.clock.wrapping_add(1);
        let tick = s.clock;
        if let Some(slot) = s.entries.get_mut(&key) {
            let old = slot.tick;
            slot.tick = tick;
            let entry = slot.entry.clone();
            s.lru.remove(&(old, key));
            s.lru.insert((tick, key));
            return (Some(entry), false);
        }
        // Two observations admit a fill. A one-shot scan cannot evict established
        // payloads; its separate probation directory has a hard count/byte bound.
        if let Some(old) = s.probation.remove(&key) {
            s.probation_lru.remove(&(old, key));
            return (None, true);
        }
        while s.probation.len() >= self.limits.entries {
            if let Some((_, old)) = s.probation_lru.pop_first() {
                s.probation.remove(&old);
            } else {
                break;
            }
        }
        s.probation.insert(key, tick);
        s.probation_lru.insert((tick, key));
        (None, false)
    }
    fn fill(self: &Arc<Self>, owner: Key) -> Option<Fill> {
        if self.limits.entry_bytes == 0 || self.limits.per_principal == 0 {
            return None;
        }
        let mut s = self.state.try_lock().ok()?;
        if s.owners.get(&owner).copied().unwrap_or(0) >= self.limits.per_principal {
            return None;
        }
        self.budget
            .fills
            .fetch_update(Ordering::AcqRel, Ordering::Acquire, |n| {
                (n < self.limits.fills).then_some(n + 1)
            })
            .ok()?;
        loop {
            if let Some(reservation) = self.budget.reserve(self.limits.entry_bytes) {
                return Some(Fill {
                    cache: self.clone(),
                    reservation: Some(reservation),
                });
            }
            if !s.evict() {
                self.budget.fills.fetch_sub(1, Ordering::AcqRel);
                return None;
            }
            self.evictions.fetch_add(1, Ordering::Relaxed);
        }
    }
    pub(crate) fn stats(&self) -> Stats {
        Stats {
            hits: self.hits.load(Ordering::Relaxed),
            g6_hits: self.g6_hits.load(Ordering::Relaxed),
            sqlite_hits: self.sqlite_hits.load(Ordering::Relaxed),
            g6_hit_stall_ns: self.g6_hit_stall_ns.load(Ordering::Relaxed),
            g6_stalled_hits: self.g6_stalled_hits.load(Ordering::Relaxed),
            g6_max_hit_stall_ns: self.g6_max_hit_stall_ns.load(Ordering::Relaxed),
            gate: self.grant.get().map_or(Default::default(), |g| g.stats()),
            misses: self.misses.load(Ordering::Relaxed),
            mismatches: self.mismatches.load(Ordering::Relaxed),
            evictions: self.evictions.load(Ordering::Relaxed),
            entries: self.state.lock().map_or(0, |s| s.entries.len()),
            bytes: self.budget.used.load(Ordering::Acquire),
            fills: self.budget.fills.load(Ordering::Acquire),
            process_bytes: PROCESS_USED.load(Ordering::Acquire),
        }
    }
}
struct Fill {
    cache: Arc<Cache>,
    reservation: Option<Reservation>,
}
impl Drop for Fill {
    fn drop(&mut self) {
        self.cache.budget.fills.fetch_sub(1, Ordering::AcqRel);
    }
}
impl Fill {
    fn install(
        mut self,
        key: Key,
        owner: Key,
        stamp: Stamp,
        outcome: &QueryOutcome,
        facts: SessionFacts,
        epoch: Option<String>,
    ) -> Lifetime {
        if !outcome.complete
            || outcome.unavailable
            || outcome.pending_opening.is_some()
            || outcome.ephemeral.is_some()
            || outcome.next_expiry.is_some()
            || outcome.decoration_expiry.is_some()
            || outcome.search_rows.is_some()
            || outcome.search_scopes.is_some()
            || outcome.delivery.as_ref().is_some_and(
                |m| !matches!(m,super::delivery::Manifest::Bindings(v) if v.is_empty()),
            )
        {
            return Lifetime::default();
        }
        // Row trees are shared by Arc, so charge their complete retained backing
        // allocations and provenance, rather than only the cheap result clone.
        let Some(metadata_bytes) = outcome.data.cache_metadata_bytes() else {
            return Lifetime::default();
        };
        let fact_bytes = facts
            .sessions
            .iter()
            .map(|s| {
                s.principal.capacity()
                    + s.family.capacity()
                    + s.kind.capacity()
                    + s.digest.capacity()
                    + 256
            })
            .sum::<usize>()
            + [
                &facts.worker_family,
                &facts.worker_revision,
                &facts.family_revision,
                &facts.store_generation,
                &facts.store_id,
                &facts.schema_hash,
                &facts.activation_hash,
                &facts.device_generation,
            ]
            .iter()
            .map(|s| s.as_ref().map_or(0, |s| s.capacity() + 64))
            .sum::<usize>()
            + epoch.as_ref().map_or(0, |e| e.capacity() + 64)
            + 1024;
        let bytes = fact_bytes
            .saturating_add(outcome.data.retained_heap_bytes() as usize)
            .saturating_mul(3)
            .saturating_add(metadata_bytes)
            .saturating_add(outcome.next.as_ref().map_or(0, String::capacity))
            .saturating_add(
                outcome
                    .tables
                    .iter()
                    .map(|s| s.capacity() + 128)
                    .sum::<usize>(),
            )
            .saturating_add(
                stamp.store.capacity() + stamp.schema.capacity() + stamp.code.capacity() + 2048,
            );
        let reserved = self.reservation.as_ref().unwrap().bytes;
        let Some(available) = reserved.checked_sub(bytes.saturating_add(128)) else {
            return Lifetime::default();
        };
        let Some(encoded) = encode_data(&outcome.data, available) else {
            return Lifetime::default();
        };
        let bytes = bytes
            .saturating_add(encoded.get().len())
            .saturating_add(128);
        let reservation = self.reservation.as_mut().unwrap();
        let Ok(mut s) = self.cache.state.try_lock() else {
            return Lifetime::default();
        };
        if s.entries.contains_key(&key)
            || s.owners.get(&owner).copied().unwrap_or(0) >= self.cache.limits.per_principal
        {
            return Lifetime::default();
        }
        while s.entries.len() >= self.cache.limits.entries {
            if !s.evict() {
                return Lifetime::default();
            }
            self.cache.evictions.fetch_add(1, Ordering::Relaxed);
        }
        reservation.encoded_data = Some(encoded);
        let excess = reservation.bytes - bytes;
        reservation.bytes = bytes;
        reservation.budget.used.fetch_sub(excess, Ordering::AcqRel);
        PROCESS_USED.fetch_sub(excess, Ordering::AcqRel);
        let lifetime = Lifetime(Some(Arc::new(self.reservation.take().unwrap())));
        let entry = Arc::new(Entry {
            facts,
            epoch,
            stamp,
            outcome: outcome.clone(),
            lifetime: lifetime.clone(),
            owner,
        });
        s.clock = s.clock.wrapping_add(1);
        let tick = s.clock;
        s.entries.insert(key, Slot { entry, tick });
        s.lru.insert((tick, key));
        *s.owners.entry(owner).or_default() += 1;
        lifetime
    }
}

// JSON escaping can expand a small value. Bound the temporary encoding by
// the already-held fill reservation, before allocating or retaining its bytes.
fn encode_data(data: &crate::Value, limit: usize) -> Option<Box<serde_json::value::RawValue>> {
    struct Limited {
        data: Vec<u8>,
        limit: usize,
    }
    impl std::io::Write for Limited {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            let n = self
                .data
                .len()
                .checked_add(bytes.len())
                .filter(|n| *n <= self.limit)
                .ok_or_else(|| std::io::Error::other("cache encoding exceeds fill reservation"))?;
            if n > self.data.capacity() {
                self.data
                    .try_reserve_exact(n - self.data.len())
                    .map_err(std::io::Error::other)?;
            }
            self.data.extend_from_slice(bytes);
            Ok(bytes.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }
    let mut buffer = Limited {
        data: Vec::with_capacity(limit.min(4096)),
        limit,
    };
    serde_json::to_writer(&mut buffer, &crate::wire::Plain(data)).ok()?;
    serde_json::value::RawValue::from_string(String::from_utf8(buffer.data).ok()?).ok()
}

struct Hasher(Sha256);
impl std::io::Write for Hasher {
    fn write(&mut self, b: &[u8]) -> std::io::Result<usize> {
        self.0.update(b);
        Ok(b.len())
    }
    fn flush(&mut self) -> std::io::Result<()> {
        Ok(())
    }
}
fn hash(value: &impl serde::Serialize) -> Option<Key> {
    let mut h = Hasher(Sha256::new());
    serde_json::to_writer(&mut h, value).ok()?;
    Some(h.0.finalize().into())
}

// Internal row/map values can carry provenance and delivery backing which their
// ordinary serde image omits. Their requests keep the ordinary path until an
// identity/retention proof admits those additional input dependencies.
fn scalar_arguments(value: &crate::Value) -> bool {
    match value {
        crate::Value::Row(_) | crate::Value::Map(_) => false,
        crate::Value::Array(items) => items.iter().all(scalar_arguments),
        _ => true,
    }
}

impl Engine {
    pub fn set_revision_cache_limits(&mut self, limits: Limits) {
        self.revision_cache = Arc::new(Cache::new(limits));
    }
    pub(super) fn reset_revision_cache(&mut self) {
        self.revision_cache = Arc::new(Cache::new(self.revision_cache.limits));
    }
    pub fn revision_cache_stats(&self) -> Stats {
        self.revision_cache.stats()
    }

    fn cache_key(
        &self,
        name: &str,
        c: &Context,
        retained: Option<&[String]>,
        manifest: DeliveryManifest,
        digest: &str,
    ) -> Option<(Key, Key)> {
        #[cfg(feature = "server-search")]
        let retained_order = c.search_retained_order.is_some();
        #[cfg(not(feature = "server-search"))]
        let retained_order = false;
        // Owned SQLite validates a stable complete local commit interval.
        if !c.revision_cache
            || !(matches!(self.store, crate::store_port::AnyStore::Postgres(_)) || self.store.sqlite_cache_scope().is_some())
            || digest.contains('\0')
            || !c.args.values().all(scalar_arguments)
            || retained.is_some()
            || c.retained_search
            || retained_order
            || c.read_spent.is_some()
            || c.read_time.is_some()
            || c.refusal_trace.is_some()
            || c.fixture_trace.is_some()
            || !c.new_ids.is_empty()
            || c.replay_id_range.as_ref().is_some_and(|range| !range.is_empty())
            || c.delivery_fingerprint.is_some()
            || !matches!(
                c.request_credential_kind.as_deref()?,
                "guest" | "user" | "member" | "account" | "oidc" | "service"
            )
        {
            return None;
        }
        #[cfg(feature = "native")]
        if self.native.is_some() {
            return None;
        }
        #[cfg(feature = "evaluation-support")]
        if self.evaluation_precharge != crate::meter::Metered::default() {
            return None;
        }
        let p = self.programs.get(name)?;
        if p.native
            || p.kind != crate::ir::ProgramKind::Query
            || p.read_time_granularity_ms.is_some()
            || !self.schema.delivery.is_empty()
        {
            return None;
        }
        super::server_query_allowed(&self.schema, name).ok()?;
        // Canonicalize a copy: ambiguous aliases may be consumed even by a refused validation.
        let mut canonical_args = c.args.clone();
        super::validate::validate_inputs(&self.schema, p, &mut canonical_args).ok()?;
        let (schema, code) = self.revision_cache.code.get_or_init(|| {
            (
                self.schema.hash(),
                crate::activation::activation_hash(
                    &self.schema,
                    &self.programs,
                    self.code_native_digest.as_deref(),
                ),
            )
        });
        let key = hash(&(
            &self.store_id,
            self.generation,
            schema,
            code,
            name,
            &canonical_args,
            &c.viewer,
            &c.kind,
            &c.request_credential_kind,
            digest,
            manifest == DeliveryManifest::Build,
            c.row_provenance,
            &self.ceilings,
        ))?;
        Some((key, hash(&c.viewer)?))
    }

    // @ref LLP 3000.009.001.000.002#4.3 — a hit authenticates at its validated revision; a fill borrows the ordinary query cut.
    pub(super) fn query_cached_request(
        &mut self,
        name: &str,
        context: Context,
        retained: Option<&[String]>,
        manifest: DeliveryManifest,
        digest: &str,
        snapshot: &mut dyn FnMut(&crate::store_port::ReadSnapshot<'_>, u64) -> Result<(), Refusal>,
    ) -> (
        Result<QueryOutcome, Refusal>,
        Option<u64>,
        Option<Vec<String>>,
    ) {
        let cache = self.revision_cache.clone();
        let grant = self.store.read_grant();
        if let Some(g) = &grant {
            let _ = cache.grant.set(g.clone());
            if (g.revoked.load(Ordering::Acquire) || g.uncertain.load(Ordering::Acquire))
                && !cache.retired_grant.swap(true, Ordering::AcqRel)
            {
                *cache.state.lock().unwrap_or_else(|p| p.into_inner()) = State::default();
            }
        }
        let uncertain = grant
            .as_ref()
            .is_some_and(|g| g.uncertain.load(Ordering::Acquire));
        let key = if uncertain {
            None
        } else {
            self.cache_key(name, &context, retained, manifest, digest)
        };
        let (candidate, admit) = key
            .map(|(key, _)| cache.lookup(key))
            .unwrap_or((None, false));
        if let Some(entry) = candidate {
            // @ref LLP 3000.009.001.000.002#sqlite-local-hits — an exclusive flock survives pauses; a stable complete revision certifies the frozen authority facts.
            if self.store.sqlite_cache_revision() == Some(entry.stamp.revision) {
                let checked = (|| {
                    let tx = self.store.cached_authority_snapshot(digest, entry.facts.clone())?;
                    snapshot(&tx, entry.stamp.head)?;
                    tx.rollback()?;
                    let mut outcome = entry.outcome.clone();
                    outcome.cache_lifetime = entry.lifetime.clone();
                    outcome.seq = entry.stamp.head;
                    Ok::<_, Refusal>(outcome)
                })();
                // A failed check is not a verdict: it takes ordinary validation.
                if let Ok(outcome) = checked
                    && self.store.sqlite_cache_revision() == Some(entry.stamp.revision)
                {
                    cache.hits.fetch_add(1, Ordering::Relaxed);
                    cache.sqlite_hits.fetch_add(1, Ordering::Relaxed);
                    return (Ok(outcome), Some(entry.stamp.head), None);
                }
            }
            let mut locally_changed = false;
            // @ref LLP 3000.009.001.000.002#4.3 — one gate read captures grant/epoch, fresh authority, revision and response identity.
            if let Some(grant) = &grant
                && let Some((state, stall)) = grant.read()
            {
                // Recheck the suspend-aware deadline synchronously at the actual
                // read point, after lock waits and before resolving authority.
                if let Some(epoch) = grant.live(&state)
                    && entry.epoch.as_deref() == Some(epoch)
                    && state.published.as_ref() == Some(&entry.stamp)
                {
                    let result = (|| {
                        let tx = self
                            .store
                            .cached_authority_snapshot(digest, entry.facts.clone())?;
                        snapshot(&tx, entry.stamp.head)?;
                        tx.rollback()?;
                        if grant.live(&state) != Some(epoch) {
                            return Ok(None);
                        }
                        let mut outcome = entry.outcome.clone();
                        outcome.cache_lifetime = entry.lifetime.clone();
                        outcome.seq = entry.stamp.head;
                        // @ref LLP 3000.009.001.000.000.002#3.8 — zero-flight hits open the certified publication through D too.
                        if let Some(d)=self.store.durability() {
                            return d.bind_publication(entry.stamp.revision,entry.stamp.head,outcome)
                                .map(|bound|bound.open().map_err(|e|e.refusal())).transpose();
                        }
                        Ok::<_, Refusal>(Some(outcome))
                    })();
                    match result {
                        Ok(Some(outcome)) => {
                            let seq = outcome.seq;
                            cache.hits.fetch_add(1, Ordering::Relaxed);
                            cache.g6_hits.fetch_add(1, Ordering::Relaxed);
                            if stall > 0 {
                                cache.g6_stalled_hits.fetch_add(1, Ordering::Relaxed);
                                cache.g6_hit_stall_ns.fetch_add(stall, Ordering::Relaxed);
                                cache
                                    .g6_max_hit_stall_ns
                                    .fetch_max(stall, Ordering::Relaxed);
                            }
                            return (Ok(outcome), Some(seq), None);
                        }
                        Err(error) => return (Err(error), None, None),
                        Ok(None) => (),
                    }
                }
                // A local revision mismatch is already proof of a miss. Avoid a
                // redundant G5 validation statement; ordinary miss flights stay intact.
                if state.published.as_ref() != Some(&entry.stamp) {
                    locally_changed = true;
                }
            }
            let checked = if locally_changed
                || grant
                    .as_ref()
                    .is_some_and(|g| g.uncertain.load(Ordering::Acquire))
            {
                Ok(None)
            } else {
                (|| {
                    let Some(tx) = self.store.result_validation_snapshot(digest)? else {
                        return Ok(None);
                    };
                    let current = tx.result_cache_facts().and_then(Stamp::of);
                    if current.as_ref() != Some(&entry.stamp) {
                        tx.rollback()?;
                        return Ok(None);
                    }
                    snapshot(&tx, entry.stamp.head)?;
                    tx.rollback()?;
                    let mut outcome = entry.outcome.clone();
                    outcome.cache_lifetime = entry.lifetime.clone();
                    outcome.seq = entry.stamp.head;
                    Ok::<_, Refusal>(Some(outcome))
                })()
            };
            match checked {
                Ok(Some(outcome)) => {
                    cache.hits.fetch_add(1, Ordering::Relaxed);
                    let seq = outcome.seq;
                    return (Ok(outcome), Some(seq), None);
                }
                Err(error) => return (Err(error), None, None),
                Ok(None) => {
                    cache.mismatches.fetch_add(1, Ordering::Relaxed);
                    if let Some((key, _)) = key {
                        if let Ok(mut s) = cache.state.try_lock() {
                            s.remove(&key);
                        }
                    }
                }
            }
        }
        if key.is_some() {
            cache.misses.fetch_add(1, Ordering::Relaxed);
        }
        // @ref LLP 3000.009.001.000.002#4.5 — sampled time, lifetimes, ephemeral state and delivery actions bypass reuse.
        // Existing composed closure proves the admitted pure fragment, including
        // transitive rule reads and global lifetime exclusion. No second evaluator.
        let eligible = admit
            && self.programs.get(name).is_some_and(|p| {
                super::postgres::read_closure::Closure::new(&self.schema, p, &context).is_some()
            });
        let fill = if eligible {
            key.and_then(|(_, owner)| cache.fill(owner))
        } else {
            None
        };
        let fill_epoch = grant.as_ref().and_then(|g| {
            g.state
                .try_read()
                .ok()
                .and_then(|s| g.live(&s).map(str::to_owned))
        });
        let mut stamp = None;
        let mut fill_facts = None;
        let mut borrow = |tx: &crate::store_port::ReadSnapshot<'_>, seq| {
            snapshot(tx, seq)?;
            stamp = tx.result_cache_facts().and_then(Stamp::of);
            fill_facts = tx.result_cache_facts().cloned();
            Ok(())
        };
        let (mut cut, mut current) = (None, None);
        let mut result = self.query_reading(
            name,
            context,
            &mut cut,
            retained,
            &mut current,
            manifest,
            false,
            Some(&mut borrow),
            Some(digest),
        );
        if let (Some(fill), Some((key, owner)), Some(stamp), Ok(outcome)) =
            (fill, key, stamp, &mut result)
        {
            let expected = cache.code.get().unwrap();
            if stamp.store == self.store_id
                && stamp.generation == self.generation as i64
                && stamp.schema == expected.0
                && stamp.code == expected.1
                && stamp.head == outcome.seq
            {
                // These ordinary index cursors contain positions/prefix/generation,
                // never fill seq. Other opaque cursor forms remain ineligible.
                let cursor = outcome
                    .next
                    .as_ref()
                    .is_none_or(|c| crate::cursor::decode_cursor(&self.schema, c).is_ok());
                if cursor {
                    outcome.cache_lifetime =
                        fill.install(key, owner, stamp, outcome, fill_facts.unwrap(), fill_epoch);
                }
            }
        }
        (result, cut, current)
    }
}

#[cfg(test)]
#[path = "revision_cache_tests.rs"]
mod tests;

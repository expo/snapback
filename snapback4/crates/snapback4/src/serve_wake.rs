//! Wake by audience: the interest a held change poll registers, the stamps a
//! publication sets on the waiters it concerns, the viewer-projected answer,
//! and the host-owned opening alarm.
//! @ref LLP 3000.041#41-w1-a-publication-contract-and-the-server-answers-by-audience — the publication contract.
use super::*;
use snapback4_core::engine::PublicationRecord;
use snapback4_core::partition::{PUBLIC, partition_of};
use snapback4_core::schema::Audience;
use std::collections::{BTreeMap, BTreeSet};

/// At most this many names in `tables=` or in the echoed `interest`; past it
/// the interest is `*` and the client treats the body's evidence as unknown.
pub(super) const INTEREST_BOUND: usize = 256;
const NAME_BOUND: usize = 128;

/// What one held poll is interested in, derived once at entry.
#[derive(Clone, Debug)]
pub(super) struct Interest {
    pub principal: String,
    /// The viewer's own partition, the public one and its current groups.
    pub partitions: BTreeSet<String>,
    /// Online-only tables the client declared with `tables=`.
    pub declared: BTreeSet<String>,
    /// The synced tables the viewer currently holds partitions of, united
    /// with `declared`: what the projected body is cut to.
    pub tables: BTreeSet<String>,
    /// Every visible table, for the evidence bits over the outside set.
    pub visible: BTreeSet<String>,
    /// `tables` exceeded the bound: the client cannot classify.
    pub overflowed: bool,
}

impl Interest {
    /// `interest=1` opts a poll in; `tables=` names online-only tables.
    pub fn declared(params: &BTreeMap<String, String>) -> Option<BTreeSet<String>> {
        if !params.get("interest").is_some_and(|value| value == "1") { return None; }
        let declared = params.get("tables").map(|list| list.split(',').filter(|name| !name.is_empty() && name.len() <= NAME_BOUND).take(INTEREST_BOUND).map(str::to_owned).collect()).unwrap_or_default();
        Some(declared)
    }

    /// The interest once the engine has said which partitions the viewer holds.
    pub fn derive(principal: &str, declared: BTreeSet<String>, partitions: BTreeSet<String>, schema: &snapback4_core::Schema) -> Self {
        let visible: BTreeSet<String> = schema.visible_tables().map(|(name, _)| name.clone()).collect();
        let mut tables: BTreeSet<String> = declared.iter().filter(|name| visible.contains(*name)).cloned().collect();
        for (name, _, sync) in schema.synced() {
            let held = match &sync.audience {
                Audience::Public | Audience::Column(_) => true,
                Audience::Target { .. } => { let prefix = format!("g:{name}:"); partitions.iter().any(|p| p.starts_with(&prefix)) }
            };
            if held { tables.insert(name.to_owned()); }
        }
        let overflowed = tables.len() > INTEREST_BOUND;
        Self { principal: principal.to_owned(), partitions, declared, tables, visible, overflowed }
    }

    /// Whether a publication concerns this waiter (LLP 3000.041 §4.1, the wake rule).
    pub fn woken_by(&self, record: &PublicationRecord) -> bool {
        record.global
            || record.partitions.values().any(|changed| changed.iter().any(|p| self.partitions.contains(p)))
            || record.tables.iter().any(|t| self.declared.contains(t))
            || record.presence.as_ref().is_none_or(|principals| principals.contains(&self.principal))
    }
}

/// The held polls that declared interest, each with the publication sequence
/// that last concerned it. Lives inside the wake mutex: registration and the
/// wake predicate share one lock, so no publication is lost between them.
#[derive(Default)]
pub(super) struct Waiters { next: u64, held: BTreeMap<u64, (Interest, u64)> }

impl Waiters {
    pub fn register(&mut self, interest: Interest, stamp: u64) -> u64 {
        let id = self.next;
        self.next = self.next.wrapping_add(1);
        self.held.insert(id, (interest, stamp));
        id
    }
    pub fn forget(&mut self, id: u64) { self.held.remove(&id); }
    pub fn stamp(&self, id: u64) -> Option<u64> { self.held.get(&id).map(|(_, stamp)| *stamp) }
    /// Stamp every waiter the record concerns; returns how many.
    pub fn publish(&mut self, record: &PublicationRecord, stamp: u64) -> usize {
        let mut woken = 0;
        for (interest, held) in self.held.values_mut() {
            if interest.woken_by(record) { *held = stamp; woken += 1; }
        }
        woken
    }
    pub fn wake_all(&mut self, stamp: u64) { for (_, held) in self.held.values_mut() { *held = stamp; } }
    #[cfg(test)]
    pub fn len(&self) -> usize { self.held.len() }
}

/// A record that wakes everyone: identity or generation changed, the
/// sequence regressed, or the interval could not be read.
pub(super) fn global_record() -> PublicationRecord { PublicationRecord { global: true, ..Default::default() } }

/// The per-viewer projection of a shared answer (LLP 3000.041 §4.1, "the
/// body is projected per viewer"): tables and evidence cut to the viewer's
/// interest, with one aggregate bit per evidence field for everything
/// outside it, and the changed groups the viewer holds per table.
pub(super) fn project(interest: &Interest, tables: &[String], preserved: &Option<Vec<String>>, changes: &Json, partitions: &Option<BTreeMap<String, BTreeSet<String>>>) -> Json {
    let own = partition_of(&interest.principal);
    let kept: Vec<&String> = tables.iter().filter(|t| interest.tables.contains(*t)).collect();
    let projected_tables: Vec<String> = kept.iter().map(|t| (*t).clone()).collect();
    let partitions_json = match partitions {
        None => json!("*"),
        Some(changed) => {
            let mut out = serde_json::Map::new();
            for table in &kept {
                let Some(touched) = changed.get(*table) else { continue };
                let prefix = format!("g:{table}:");
                let groups: Vec<Json> = touched.iter().filter(|p| interest.partitions.contains(*p) && p.starts_with(&prefix))
                    .filter_map(|p| serde_json::from_str::<Vec<snapback4_core::Value>>(&p[prefix.len()..]).ok())
                    .map(|group| Json::Array(group.iter().map(snapback4_core::wire::to_json).collect())).collect();
                let entry = json!({
                    "own": touched.contains(&own),
                    "public": touched.contains(PUBLIC),
                    "groups": groups,
                });
                out.insert((*table).clone(), entry);
            }
            Json::Object(out)
        }
    };
    let (preserved_json, preserved_others) = match preserved {
        None => (Json::Null, Json::Null),
        Some(list) => {
            let set: BTreeSet<&String> = list.iter().collect();
            let inside: Vec<&String> = list.iter().filter(|t| interest.tables.contains(*t)).collect();
            let others = interest.visible.iter().filter(|t| !interest.tables.contains(*t)).all(|t| set.contains(t));
            (json!(inside), json!(others))
        }
    };
    let changes_json = match changes {
        Json::Object(interval) => {
            let writes = interval.get("writes").and_then(Json::as_object);
            let inside: serde_json::Map<String, Json> = writes.map(|w| w.iter().filter(|(t, _)| interest.tables.contains(*t)).map(|(t, v)| (t.clone(), v.clone())).collect()).unwrap_or_default();
            let others = writes.is_some_and(|w| w.keys().any(|t| !interest.tables.contains(t)));
            json!({"after": interval.get("after").cloned().unwrap_or(Json::Null), "through": interval.get("through").cloned().unwrap_or(Json::Null), "writes": inside, "others": others})
        }
        _ => Json::Null,
    };
    let interest_json = if interest.overflowed { json!("*") } else { json!(interest.tables) };
    json!({
        "interest": interest_json,
        "tables": projected_tables,
        "partitions": partitions_json,
        "preserved": preserved_json,
        "preservedOthers": preserved_others,
        "changes": changes_json,
    })
}

/// The host-owned opening alarm: one thread keeps the ledger's earliest
/// `not before` opening as its deadline, re-reading it after every durable
/// publication, after every fire (including one that opened nothing) and on
/// every clock jump; it advances one due row at a time, as a poll's deadline
/// did, and re-arms with zero delay while rows remain due.
/// @ref LLP 3000.041#41-w1-a-publication-contract-and-the-server-answers-by-audience — "the alarm becomes host-owned".
#[derive(Default)]
pub(crate) struct Alarm { state: Mutex<AlarmState>, cv: Condvar }
#[derive(Default)]
struct AlarmState { rearmed: u64, stopped: bool }

impl Alarm {
    /// The ledger, the clock or the store identity changed: read the deadline again.
    pub fn rearm(&self) { let mut state = lock(&self.state); state.rearmed = state.rearmed.wrapping_add(1); drop(state); self.cv.notify_all(); }
    pub fn stop(&self) { lock(&self.state).stopped = true; self.cv.notify_all(); }
}

/// Idle polls cost nothing here: the thread sleeps until the next opening or
/// the next re-arm, and exits once the host is gone.
pub(super) fn spawn_alarm(shared: &Arc<Shared>) -> std::thread::JoinHandle<()> {
    let weak = Arc::downgrade(shared);
    std::thread::Builder::new().name("openings".into()).spawn(move || loop {
        let Some(shared) = weak.upgrade() else { return };
        // Publish every due opening, one row per advance, as a poll did.
        let mut rounds = 0usize;
        while let Ok(Some(at)) = shared.next_time_audience() {
            if !shared.time_audience_delay(at).is_zero() { break; }
            let before = lock(&shared.seq).clone();
            if shared.advance_time_audiences().is_err() { break; }
            rounds += 1;
            // A stale entry publishes nothing and is consumed; a bounded
            // backlog yields the engine between rows so requests are served.
            if *lock(&shared.seq) == before && rounds > 1_024 { break; }
            if rounds % 16 == 0 { std::thread::yield_now(); }
        }
        let wait = match shared.next_time_audience() {
            Ok(Some(at)) => shared.time_audience_delay(at).min(Duration::from_secs(60)),
            _ => Duration::from_secs(1),
        };
        let mut state = lock(&shared.alarm.state);
        if state.stopped { return; }
        let armed = state.rearmed;
        let deadline = Instant::now() + wait;
        while state.rearmed == armed && !state.stopped {
            let left = deadline.saturating_duration_since(Instant::now());
            if left.is_zero() { break; }
            let (next, _) = shared.alarm.cv.wait_timeout(state, left).unwrap_or_else(|e| e.into_inner());
            state = next;
        }
        if state.stopped { return; }
        drop(state);
        drop(shared);
    }).expect("openings alarm thread")
}

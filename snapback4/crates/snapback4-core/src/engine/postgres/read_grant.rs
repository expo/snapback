//! CPU-only reads require both a persisted foreign-writer barrier and a local
//! publication barrier. Clock bounds are an explicit deployment contract.
// @ref LLP 3000.009.001.000.002#4.2 — suspend-aware grants; never infer a clock bound from an empirical margin.
use crate::RuntimeError;
use std::{
    sync::{
        RwLock, RwLockReadGuard, Mutex, Condvar, Arc,
        atomic::{AtomicBool, AtomicU64, Ordering},
    },
    time::Duration,
};

#[derive(Clone, Copy, Debug)]
pub struct ReadClockBounds {
    /// Maximum relative database-clock rate, in excess of CLOCK_BOOTTIME.
    pub rate_ppm: u32,
    /// Maximum cumulative forward adjustment during one grant, including HA.
    pub forward_jump: Duration,
}
impl ReadClockBounds {
    pub(crate) fn window(self, lease: Duration) -> Result<Duration, RuntimeError> {
        let left = lease
            .checked_sub(self.forward_jump)
            .ok_or_else(clock_error)?;
        // Integer division rounds DOWN. A further millisecond covers timestamp
        // rounding; neither this margin nor measurements establish the bounds.
        let nanos = left.as_nanos() * 1_000_000 / (1_000_000 + self.rate_ppm as u128);
        let window = Duration::from_nanos(u64::try_from(nanos).map_err(|_| clock_error())?)
            .checked_sub(Duration::from_millis(1))
            .ok_or_else(clock_error)?;
        if window.is_zero() || self.rate_ppm > 1_000_000 || boottime().is_none() {
            return Err(clock_error());
        }
        Ok(window)
    }
}
fn clock_error() -> RuntimeError {
    RuntimeError::StoreOwnership("read grants require Linux CLOCK_BOOTTIME and explicit rate/jump bounds smaller than the lease; otherwise use G5".into())
}
pub(crate) fn boottime() -> Option<Duration> {
    #[cfg(target_os = "linux")]
    {
        let t = rustix::time::clock_gettime(rustix::time::ClockId::Boottime);
        if t.tv_sec < 0 || !(0..1_000_000_000).contains(&t.tv_nsec) {
            return None;
        }
        Some(Duration::new(t.tv_sec as u64, t.tv_nsec as u32))
    }
    #[cfg(not(target_os = "linux"))]
    {
        None
    }
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct Published {
    pub revision: i64,
    pub head: u64,
    pub store: String,
    pub generation: i64,
    pub schema: String,
    pub code: String,
}
pub(super) const PUBLICATION: &str = "SELECT h.revision,h.seq,b.generation,(SELECT value FROM _meta WHERE key='store_id'),(SELECT value FROM _meta WHERE key='schema_hash'),(SELECT value FROM _meta WHERE key='activation_hash') FROM _head h CROSS JOIN _backend b WHERE h.singleton AND b.singleton";
impl Published {
    pub(super) fn row(r: &super::flight::Row) -> Result<Self, RuntimeError> {
        Self::row_at(r, 0)
    }
    pub(super) fn row_at(r: &super::flight::Row, offset: usize) -> Result<Self, RuntimeError> {
        Ok(Self {
            revision: r.try_get(offset)?,
            head: u64::try_from(r.try_get::<_, i64>(offset + 1)?).map_err(|_| clock_error())?,
            generation: r.try_get(offset + 2)?,
            store: r.try_get(offset + 3)?,
            schema: r.try_get(offset + 4)?,
            code: r.try_get(offset + 5)?,
        })
    }
}
#[derive(Default)]
pub(crate) struct State {
    pub epoch: Option<String>,
    pub published: Option<Published>,
    pub inflight: usize,
}
#[derive(Default)]
pub(crate) struct Grant {
    pub state: RwLock<State>,
    pub configured: AtomicBool,
    pub opened: AtomicBool,
    pub revoked: AtomicBool,
    pub uncertain: AtomicBool,
    pub until: AtomicU64,
    #[cfg(test)]
    pub closing: AtomicU64,
    closed_at: AtomicU64,
    closed_ns: AtomicU64,
    waits: AtomicU64,
    wait_ns: AtomicU64,
    max_wait_ns: AtomicU64,
    changed: (Mutex<u64>, Condvar),
}
#[derive(Clone, Copy, Debug, Default, serde::Serialize)]
pub struct GateStats {
    pub closed_ns: u64,
    pub hit_waits: u64,
    pub hit_stall_ns: u64,
    pub max_hit_stall_ns: u64,
    pub uncertain: bool,
    pub revoked: bool,
}
impl Grant {
    pub fn stats(&self) -> GateStats {
        let closed = self.closed_at.load(Ordering::Acquire);
        let ongoing = if closed == 0 {
            0
        } else {
            boottime().map_or(0, |n| (n.as_nanos() as u64).saturating_sub(closed))
        };
        GateStats {
            closed_ns: self
                .closed_ns
                .load(Ordering::Relaxed)
                .saturating_add(ongoing),
            hit_waits: self.waits.load(Ordering::Relaxed),
            hit_stall_ns: self.wait_ns.load(Ordering::Relaxed),
            max_hit_stall_ns: self.max_wait_ns.load(Ordering::Relaxed),
            uncertain: self.uncertain.load(Ordering::Acquire),
            revoked: self.revoked.load(Ordering::Acquire),
        }
    }
    pub fn revoke(&self) {
        self.revoked.store(true, Ordering::Release);
        self.until.store(0, Ordering::Release);
    }
    pub fn drain(&self) {
        self.revoke();
        drop(self.state.write().unwrap_or_else(|p| p.into_inner()));
    }
    pub fn deadline(&self) -> Option<Duration> {
        let n = self.until.load(Ordering::Acquire);
        (n > 0).then_some(Duration::from_nanos(n))
    }
    pub fn live<'a>(&self, s: &'a State) -> Option<&'a str> {
        if self.revoked.load(Ordering::Acquire) || self.uncertain.load(Ordering::Acquire) {
            return None;
        }
        if boottime()? >= self.deadline()? {
            self.revoke();
            return None;
        }
        s.epoch.as_deref()
    }
    pub fn read(&self) -> Option<(RwLockReadGuard<'_, State>, u64)> {
        if !self.configured.load(Ordering::Acquire)
            || self.revoked.load(Ordering::Acquire)
            || self.uncertain.load(Ordering::Acquire)
        {
            return None;
        }
        // @ref LLP 3000.009.001.000.000.002#3.6 — wait without the read guard so ordered resolution can acquire the write lock.
        const HIT_WAIT: Duration = Duration::from_millis(1);
        let start = std::time::Instant::now();
        let mut waited = false;
        loop {
            match self.state.try_read() {
                Ok(s) if s.inflight == 0 => {
                    self.live(&s)?;
                    let ns = if waited {start.elapsed().as_nanos().min(u64::MAX as u128) as u64} else {0};
                    if waited { self.record_wait(ns); }
                    return Some((s, ns));
                }
                Err(std::sync::TryLockError::Poisoned(_)) => return None,
                _ => {} // drop the read guard before waiting
            }
            waited = true;
            let remaining = HIT_WAIT.saturating_sub(start.elapsed());
            if remaining.is_zero() || self.revoked.load(Ordering::Acquire) || self.uncertain.load(Ordering::Acquire) {
                self.record_wait(start.elapsed().as_nanos().min(u64::MAX as u128) as u64);
                return None;
            }
            let version = self.changed.0.lock().unwrap_or_else(|p|p.into_inner());
            let _ = self.changed.1.wait_timeout(version, remaining.min(Duration::from_micros(100)));
        }
    }
    fn record_wait(&self, ns:u64) {
        self.waits.fetch_add(1, Ordering::Relaxed);
        self.wait_ns.fetch_add(ns, Ordering::Relaxed);
        self.max_wait_ns.fetch_max(ns, Ordering::Relaxed);
    }
    pub(crate) fn begin_flight(self: &Arc<Self>) -> Result<FlightGuard, RuntimeError> {
        #[cfg(test)]
        self.closing.fetch_add(1,Ordering::SeqCst);
        let mut state=self.state.write().map_err(|_|clock_error())?;
        #[cfg(test)]
        self.closing.fetch_sub(1,Ordering::SeqCst);
        if self.uncertain.load(Ordering::Acquire) {return Err(clock_error());}
        if state.inflight==0 {self.closed_at.store(boottime().map_or(1,|n|n.as_nanos() as u64),Ordering::Release);}
        state.inflight+=1;
        Ok(FlightGuard {grant:self.clone(),resolved:false})
    }
    // @ref LLP 3000.009.001.000.000.002#3.6 — an unacknowledged preparation rollback or panic is sticky even before a final-flight guard exists.
    pub(crate) fn close_uncertain(&self) {
        let mut state = self.state.write().unwrap_or_else(|p| p.into_inner());
        self.uncertain.store(true, Ordering::Release);
        self.until.store(0, Ordering::Release);
        state.epoch = None;
        state.published = None;
        let _ = self.closed_at.compare_exchange(0, boottime().map_or(1, |n| n.as_nanos() as u64), Ordering::AcqRel, Ordering::Acquire);
        *self.changed.0.lock().unwrap_or_else(|p|p.into_inner()) += 1;
        self.changed.1.notify_all();
    }
    fn resolve_flight(&self, published:Option<Published>, unknown:bool) {
        let mut state=self.state.write().unwrap_or_else(|p|p.into_inner());
        assert!(state.inflight>0);
        state.inflight-=1;
        if unknown {
            self.uncertain.store(true,Ordering::Release);
            self.until.store(0,Ordering::Release);
            state.epoch=None;state.published=None;
        } else if !self.uncertain.load(Ordering::Acquire) {
            if let Some(published)=published {state.published=Some(published);}
        }
        if state.inflight==0 && !self.uncertain.load(Ordering::Acquire) {
            let start=self.closed_at.swap(0,Ordering::AcqRel);
            self.closed_ns.fetch_add(boottime().map_or(0,|n|(n.as_nanos() as u64).saturating_sub(start)),Ordering::Relaxed);
        }
        *self.changed.0.lock().unwrap_or_else(|p|p.into_inner())+=1;
        self.changed.1.notify_all();
    }
    // @ref LLP 3000.009.001.000.002#4.1 — close before COMMIT, install only after confirmation; uncertainty is sticky.
    pub fn commit(
        &self,
        published: Published,
        commit: impl FnOnce() -> Result<(), RuntimeError>,
    ) -> Result<(), RuntimeError> {
        if !self.configured.load(Ordering::Acquire) {
            return commit();
        }
        let mut s = self.state.write().map_err(|_| clock_error())?;
        if self.uncertain.load(Ordering::Acquire) {
            return Err(RuntimeError::StoreOwnership(
                "unknown COMMIT requires fenced reconciliation and a fresh process/cache epoch"
                    .into(),
            ));
        }
        let start = boottime().map_or(1, |n| n.as_nanos() as u64);
        self.closed_at.store(start, Ordering::Release);
        // A panic after dispatch must not silently reopen old evidence.
        struct PanicCloses<'a>(&'a Grant);
        impl Drop for PanicCloses<'_> {
            fn drop(&mut self) {
                if std::thread::panicking() {
                    self.0.uncertain.store(true, Ordering::Release);
                }
            }
        }
        let _panic = PanicCloses(self);
        let result = commit();
        match &result {
            Ok(()) => {
                s.published = Some(published);
                self.uncertain.store(false, Ordering::Release);
            }
            Err(RuntimeError::CommitOutcomeUnknown(_)) => {
                self.uncertain.store(true, Ordering::Release);
                self.until.store(0, Ordering::Release);
                s.epoch = None;
                s.published = None;
            }
            Err(_) => {
                self.uncertain.store(false, Ordering::Release);
            }
        }
        if !self.uncertain.load(Ordering::Acquire) {
            self.closed_ns.fetch_add(
                boottime().map_or(0, |n| (n.as_nanos() as u64).saturating_sub(start)),
                Ordering::Relaxed,
            );
            self.closed_at.store(0, Ordering::Release);
        }
        result
    }
}

pub(crate) struct FlightGuard { grant: Arc<Grant>, resolved: bool }
impl FlightGuard {
    pub(crate) fn close_uncertain(&self) { self.grant.close_uncertain(); }
    pub(crate) fn resolve(mut self, published:Option<Published>, unknown:bool) {
        self.grant.resolve_flight(published,unknown);self.resolved=true;
    }
}
impl Drop for FlightGuard {
    fn drop(&mut self) { if !self.resolved { self.grant.resolve_flight(None,true); } }
}

pub(super) const CREATE: &str = "CREATE TABLE IF NOT EXISTS _read_grant (singleton BOOLEAN PRIMARY KEY, store_id TEXT COLLATE \"C\" NOT NULL, holder TEXT COLLATE \"C\" NOT NULL, token BIGINT NOT NULL, epoch TEXT COLLATE \"C\" NOT NULL, valid_until TIMESTAMPTZ NOT NULL)";

pub(super) fn verify(tx: &super::store::Tx<'_>) -> Result<(), RuntimeError> {
    super::shape::verify(
        tx,
        "_read_grant",
        &[
            ("singleton", "boolean", true, false),
            ("store_id", "text", true, true),
            ("holder", "text", true, true),
            ("token", "bigint", true, false),
            ("epoch", "text", true, true),
            ("valid_until", "timestamp with time zone", true, false),
        ],
        &["singleton"],
        "E_STORE_OWNERSHIP",
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn conservative_suspend_aware_clock_window() {
        let b = ReadClockBounds {
            rate_ppm: 1000,
            forward_jump: Duration::from_millis(250),
        };
        #[cfg(target_os = "linux")]
        {
            let w = b.window(Duration::from_secs(3)).unwrap();
            assert!(w < Duration::from_millis(2747));
            assert!(w > Duration::from_millis(2740));
            assert!(boottime().unwrap() > Duration::ZERO);
        }
        assert!(b.window(Duration::from_millis(200)).is_err());
    }
}

#[cfg(test)]
mod pipeline_tests {
    use super::*;
    #[test]
    fn g72_count_is_visible_off_guard_and_unknown_stays_closed() {
        let grant=Arc::new(Grant::default());grant.configured.store(true,Ordering::Release);
        grant.until.store((boottime().unwrap_or_default()+Duration::from_secs(10)).as_nanos() as u64,Ordering::Release);
        let publication=Published{revision:0,head:0,store:"s".into(),generation:1,schema:"h".into(),code:"c".into()};
        {let mut s=grant.state.write().unwrap();s.epoch=Some("e".into());s.published=Some(publication.clone());}
        #[cfg(target_os="linux")]
        assert!(grant.read().is_some());
        let first=grant.begin_flight().unwrap();let second=grant.begin_flight().unwrap();
        assert_eq!(grant.state.read().unwrap().inflight,2);let start=std::time::Instant::now();assert!(grant.read().is_none());assert!(start.elapsed()<Duration::from_millis(100));
        first.resolve(Some(Published{revision:1,head:1,..publication}),false);assert!(grant.read().is_none());
        // resolve must acquire the write lock: read's bounded wait cannot retain its guard.
        second.resolve(None,true);assert!(grant.read().is_none());let state=grant.state.read().unwrap();assert_eq!(state.inflight,0);assert!(state.epoch.is_none()&&state.published.is_none());drop(state);assert!(grant.begin_flight().is_err());
    }
}

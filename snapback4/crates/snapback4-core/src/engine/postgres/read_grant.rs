//! CPU-only reads require both a persisted foreign-writer barrier and a local
//! publication barrier. Clock bounds are an explicit deployment contract.
// @ref LLP 3000.009.001.000.002#4.2 — suspend-aware grants; never infer a clock bound from an empirical margin.
use crate::RuntimeError;
use std::{
    sync::{
        RwLock, RwLockReadGuard,
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
        Ok(Self {
            revision: r.try_get(0)?,
            head: u64::try_from(r.try_get::<_, i64>(1)?).map_err(|_| clock_error())?,
            generation: r.try_get(2)?,
            store: r.try_get(3)?,
            schema: r.try_get(4)?,
            code: r.try_get(5)?,
        })
    }
}
#[derive(Default)]
pub(crate) struct State {
    pub epoch: Option<String>,
    pub published: Option<Published>,
}
#[derive(Default)]
pub(crate) struct Grant {
    pub state: RwLock<State>,
    pub configured: AtomicBool,
    pub opened: AtomicBool,
    pub revoked: AtomicBool,
    pub uncertain: AtomicBool,
    pub until: AtomicU64,
    closed_at: AtomicU64,
    closed_ns: AtomicU64,
    waits: AtomicU64,
    wait_ns: AtomicU64,
    max_wait_ns: AtomicU64,
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
        let mut waited = 0;
        let read = match self.state.try_read() {
            Ok(s) => s,
            Err(std::sync::TryLockError::WouldBlock) => {
                let start = std::time::Instant::now();
                let s = loop {
                    if start.elapsed() >= Duration::from_secs(1)
                        || self.revoked.load(Ordering::Acquire)
                        || self.uncertain.load(Ordering::Acquire)
                    {
                        let ns = start.elapsed().as_nanos().min(u64::MAX as u128) as u64;
                        self.waits.fetch_add(1, Ordering::Relaxed);
                        self.wait_ns.fetch_add(ns, Ordering::Relaxed);
                        self.max_wait_ns.fetch_max(ns, Ordering::Relaxed);
                        return None;
                    }
                    match self.state.try_read() {
                        Ok(s) => break s,
                        Err(std::sync::TryLockError::Poisoned(_)) => return None,
                        Err(_) => std::thread::sleep(Duration::from_micros(100)),
                    }
                };
                let ns = start.elapsed().as_nanos().min(u64::MAX as u128) as u64;
                self.waits.fetch_add(1, Ordering::Relaxed);
                self.wait_ns.fetch_add(ns, Ordering::Relaxed);
                self.max_wait_ns.fetch_max(ns, Ordering::Relaxed);
                waited = ns;
                s
            }
            Err(_) => return None,
        };
        self.live(&read)?;
        Some((read, waited))
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

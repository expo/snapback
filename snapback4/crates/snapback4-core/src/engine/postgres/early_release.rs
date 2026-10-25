//! Arm E's release lock. A snapshot identity is read inside the snapshot;
//! neither a numeric revision nor drainage is a durability certificate.
// @ref LLP 3000.009.001.000.000.002#3.8 — all outputs open under the same release rule.
use super::{group_commit::Head, read_grant::Grant, store::Store};
use crate::RuntimeError;
use std::sync::{Arc, Condvar, Mutex, Weak};
use std::time::{Duration, Instant};

pub(super) const SNAPSHOT: &str = "SELECT seq,revision,attempt,pg_catalog.pg_postmaster_start_time()::text FROM _head WHERE singleton";
pub(super) const HOLD: Duration = Duration::from_millis(250);
const CREATE: &str = "CREATE TABLE IF NOT EXISTS _durable (token BIGINT NOT NULL, slot BIGINT NOT NULL, n BIGINT NOT NULL, PRIMARY KEY(token,slot))";

#[derive(Clone, Debug)]
pub(crate) struct Snapshot {
    pub revision: i64,
    pub seq: i64,
    pub attempt: (u64, u64),
    pub postmaster: String,
}
pub(super) fn attempt(value: &str) -> Result<(u64, u64), RuntimeError> {
    let (token, counter) = value.split_once(':').ok_or_else(retry)?;
    Ok((
        token.parse().map_err(|_| retry())?,
        counter.parse().map_err(|_| retry())?,
    ))
}
impl Snapshot {
    pub(super) fn text(row: &postgres::SimpleQueryRow) -> Result<Self, RuntimeError> {
        Ok(Self {
            seq: row.get(0).ok_or_else(retry)?.parse().map_err(|_| retry())?,
            revision: row.get(1).ok_or_else(retry)?.parse().map_err(|_| retry())?,
            attempt: attempt(row.get(2).ok_or_else(retry)?)?,
            postmaster: row.get(3).ok_or_else(retry)?.into(),
        })
    }
}
fn retry() -> RuntimeError {
    RuntimeError::Store(
        "durability history changed or reader hold expired; retry with a fresh snapshot".into(),
    )
}
struct State {
    epoch: u64,
    floor: (u64, u64),
    point: Option<Snapshot>,
    broken: bool,
}
pub(crate) struct Durability {
    state: Mutex<State>,
    changed: Condvar,
    grant: Option<Weak<Grant>>,
}
impl Durability {
    pub(super) fn new(grant: Option<&Arc<Grant>>) -> Arc<Self> {
        Arc::new(Self {
            state: Mutex::new(State {
                epoch: 1,
                floor: (u64::MAX, u64::MAX),
                point: None,
                broken: true,
            }),
            changed: Condvar::new(),
            grant: grant.map(Arc::downgrade),
        })
    }
    pub(crate) fn epoch(&self) -> u64 {
        self.state.lock().unwrap_or_else(|p| p.into_inner()).epoch
    }
    pub(crate) fn broken(&self) -> bool {
        self.state.lock().unwrap_or_else(|p| p.into_inner()).broken
    }
    // A bump shares the output-release lock. Unopened values retain their old
    // snapshot attempt and cannot be rescued by reuse of their numeric revision.
    pub(crate) fn break_history(&self) {
        let mut s = self.state.lock().unwrap_or_else(|p| p.into_inner());
        s.epoch = s.epoch.checked_add(1).expect("recovery epoch exhausted");
        s.broken = true;
        self.changed.notify_all();
        drop(s);
        if let Some(g) = self.grant.as_ref().and_then(Weak::upgrade) {
            g.close_uncertain();
        }
    }
    fn covers(s: &State, h: &Snapshot) -> bool {
        !s.broken
            && h.attempt >= s.floor
            && s.point.as_ref().is_some_and(|d| {
                d.postmaster == h.postmaster && d.revision >= h.revision && d.seq >= h.seq
            })
    }
    pub(crate) fn release_batch(&self, epoch: u64, head: &Head) -> Result<(), RuntimeError> {
        let s = self.state.lock().unwrap_or_else(|p| p.into_inner());
        // This batch's own marker already confirmed in epoch. Use exactly
        // the reader predicate under the same release lock for caller output.
        let head = Snapshot {
            seq: head.seq,
            revision: head.revision,
            attempt: attempt(&head.attempt)?,
            postmaster: s
                .point
                .as_ref()
                .map(|d| d.postmaster.clone())
                .unwrap_or_default(),
        };
        if s.epoch == epoch && Self::covers(&s, &head) {
            Ok(())
        } else {
            Err(RuntimeError::CommitOutcomeUnknown(
                "batch belongs to a discarded durability history".into(),
            ))
        }
    }
    // A zero-flight G6 hit names the exact installed publication. Its data
    // was already certified; bind it to that same certified head and open it
    // through the ordinary release predicate rather than bypassing D.
    pub(crate) fn bind_publication<T>(
        self: &Arc<Self>,
        revision: i64,
        seq: u64,
        value: T,
    ) -> Option<Bound<T>> {
        let state = self.state.lock().unwrap_or_else(|p| p.into_inner());
        let head = state.point.as_ref()?;
        if head.revision != revision
            || u64::try_from(head.seq).ok() != Some(seq)
            || !Self::covers(&state, head)
        {
            return None;
        }
        Some(self.bind(head.clone(), value))
    }
    pub(crate) fn bind<T>(self: &Arc<Self>, snapshot: Snapshot, value: T) -> Bound<T> {
        Bound {
            gate: self.clone(),
            snapshot,
            value,
        }
    }
    pub(crate) fn wait(&self, h: &Snapshot) -> Result<(), RuntimeError> {
        let until = Instant::now() + HOLD;
        let mut s = self.state.lock().unwrap_or_else(|p| p.into_inner());
        let epoch = s.epoch;
        loop {
            if Self::covers(&s, h) {
                return Ok(());
            }
            if s.epoch != epoch || s.broken || h.attempt < s.floor {
                return Err(retry());
            }
            if s.point
                .as_ref()
                .is_some_and(|d| d.postmaster != h.postmaster)
            {
                drop(s);
                self.break_history();
                return Err(retry());
            }
            let remaining = until.saturating_duration_since(Instant::now());
            if remaining.is_zero() {
                return Err(retry());
            }
            s = self
                .changed
                .wait_timeout(s, remaining)
                .unwrap_or_else(|p| p.into_inner())
                .0;
        }
    }
    pub(super) fn certify(
        &self,
        epoch: u64,
        head: Snapshot,
        recovery: bool,
    ) -> Result<(), RuntimeError> {
        let mut s = self.state.lock().unwrap_or_else(|p| p.into_inner());
        if s.epoch != epoch
            || (!recovery
                && (s.broken
                    || head.attempt < s.floor
                    || s.point
                        .as_ref()
                        .is_some_and(|d| d.postmaster != head.postmaster)))
        {
            return Err(RuntimeError::CommitOutcomeUnknown(
                "certificate belongs to a discarded recovery epoch".into(),
            ));
        }
        if recovery {
            s.floor = head.attempt;
            s.point = None;
            s.broken = false;
        }
        if s.point
            .as_ref()
            .is_none_or(|d| head.revision >= d.revision && head.seq >= d.seq)
        {
            s.point = Some(head);
        }
        self.changed.notify_all();
        Ok(())
    }
}
/// Row transport never exposes an E snapshot without opening this envelope.
/// Keeping the payload private makes the release check a construction rule.
pub(crate) struct Bound<T> {
    gate: Arc<Durability>,
    snapshot: Snapshot,
    value: T,
}
impl<T> Bound<T> {
    pub(crate) fn open(self) -> Result<T, RuntimeError> {
        self.gate.wait(&self.snapshot)?;
        Ok(self.value)
    }
}

impl Store {
    pub(crate) fn enable_early_release(&mut self) -> Result<(), RuntimeError> {
        if self.early_release.is_some() {
            return Ok(());
        }
        if !self.unified || self.read_only {
            return Err(RuntimeError::StoreUnsupported {
                family: "early-lock-release",
            });
        }
        self.early_release = Some(Durability::new(self.read_grant.as_ref()));
        self.recover_early_release()
    }
    // @ref LLP 3000.009.001.000.000.002#3.9 — only a fenced synchronous write can seed D after drainage.
    pub(crate) fn recover_early_release(&mut self) -> Result<(), RuntimeError> {
        let Some(gate) = self.early_release.clone() else {
            return Ok(());
        };
        let epoch = gate.epoch();
        let result = (|| {
            let tx = self.recovery_transaction()?;
            tx.query(
                "SELECT seq,revision,attempt FROM _head WHERE singleton FOR UPDATE",
                &[],
            )?;
            super::group_commit::initialize(&tx)?;
            tx.batch(CREATE)?;
            super::shape::verify(
                &tx,
                "_durable",
                &[
                    ("token", "bigint", true, false),
                    ("slot", "bigint", true, false),
                    ("n", "bigint", true, false),
                ],
                &["token", "slot"],
                "SNAPBACK_ACTIVATION_SCHEMA",
            )?;
            let token = tx
                .attempt
                .borrow()
                .split_once(':')
                .unwrap()
                .0
                .parse::<i64>()
                .map_err(|_| retry())?;
            // Insert only: a previous owner's marker can still hold its row.
            tx.execute("DELETE FROM _durable WHERE (token,slot) IN (SELECT token,slot FROM _durable WHERE token<$1 FOR UPDATE SKIP LOCKED)",&[&token])?;
            tx.execute(
                "INSERT INTO _durable(token,slot,n) VALUES($1,0,0),($1,1,0) ON CONFLICT DO NOTHING",
                &[&token],
            )?;
            tx.execute_one(
                "UPDATE _head SET attempt=$1 WHERE singleton",
                &[&*tx.attempt.borrow()],
            )?;
            let row = tx.query(SNAPSHOT, &[])?.remove(0);
            let h = Snapshot {
                seq: row.try_get(0)?,
                revision: row.try_get(1)?,
                attempt: attempt(row.try_get(2)?)?,
                postmaster: row.try_get(3)?,
            };
            // Do not advance revision/public seq for recovery. Bypass ordinary
            // commit's member revision bookkeeping, but retain the owner fence.
            let mut inner = tx.inner.into_inner();
            inner.flush(tx.calls)?;
            inner.done = true;
            inner.client.commit_synchronous(tx.commit_warning)?;
            gate.certify(epoch, h, true)
        })();
        if result.is_err() {
            gate.break_history();
        }
        result
    }
}

pub(super) fn head_snapshot(
    head: &Head,
    attempt_value: &str,
    postmaster: String,
) -> Result<Snapshot, RuntimeError> {
    Ok(Snapshot {
        seq: head.seq,
        revision: head.revision,
        attempt: attempt(attempt_value)?,
        postmaster,
    })
}

// @ref LLP 3000.009.001.000.000.002#3.8 — a synchronous barrier samples its post-write head in the COMMIT message, preserving idle N=1's budget.
pub(super) fn commit_synchronous_head(
    client: &mut postgres::Client,
    warning: &std::sync::atomic::AtomicBool,
) -> Result<Snapshot, RuntimeError> {
    use postgres::SimpleQueryMessage as M;
    use std::sync::atomic::Ordering;
    warning.store(false, Ordering::SeqCst);
    // Application and tail validation have finished. This read supplies only
    // the durability certificate; its decode can fail after COMMIT, so every
    // missing/error result remains unknown and cannot authorize a rerun.
    let result = client.simple_query(&format!("{SNAPSHOT}; COMMIT"));
    let warned = warning.swap(false, Ordering::SeqCst);
    if let Ok(messages) = result {
        let counts = messages
            .iter()
            .filter_map(|m| {
                if let M::CommandComplete(n) = m {
                    Some(*n)
                } else {
                    None
                }
            })
            .collect::<Vec<_>>();
        let rows = messages
            .iter()
            .filter_map(|m| if let M::Row(r) = m { Some(r) } else { None })
            .collect::<Vec<_>>();
        if !warned && counts == [1, 0] && rows.len() == 1 {
            return Snapshot::text(rows[0]).map_err(|_| {
                RuntimeError::CommitOutcomeUnknown(
                    "synchronous head certificate cannot be decoded after COMMIT".into(),
                )
            });
        }
    } else if !client.is_closed() {
        // A failed head SELECT may have left the transaction aborted before
        // COMMIT. Clear it before fenced recovery; drainage alone proves no D.
        let _ = client.batch_execute("ROLLBACK");
    }
    Err(RuntimeError::CommitOutcomeUnknown(
        "synchronous head / COMMIT confirmation unavailable".into(),
    ))
}

// This driver consumes through ReadyForQuery before returning. Success plus the
// exact ordered command counts witnesses both COMMITs and UPDATE 1; an error
// discards that certificate even when a COMMIT had already succeeded.
// @ref LLP 3000.009.001.000.000.002#4.1 — status, never an error-code guess, decides whether data aborted.
pub(super) fn commit_marker(
    client: &mut postgres::Client,
    warning: &std::sync::atomic::AtomicBool,
    token: i64,
    slot: i64,
    xid: &str,
) -> Result<(String, String), RuntimeError> {
    use postgres::SimpleQueryMessage as M;
    use std::sync::atomic::Ordering;
    // All interpolated values originate as integers or pg_current_xact_id().
    let xid = xid.parse::<u64>().map_err(|_| retry())?;
    warning.store(false, Ordering::SeqCst);
    let sql = format!(
        "SET LOCAL synchronous_commit=off; COMMIT; BEGIN; SET LOCAL synchronous_commit=on; UPDATE _durable SET n=n+1 WHERE token={token} AND slot={slot} RETURNING pg_catalog.pg_current_wal_insert_lsn()::text,pg_catalog.pg_postmaster_start_time()::text; COMMIT; SELECT pg_catalog.pg_current_wal_flush_lsn()::text,pg_catalog.pg_xact_status('{xid}'::xid8)"
    );
    let result = client.simple_query(&sql);
    let warned = warning.swap(false, Ordering::SeqCst);
    match result {
        Ok(messages) if !warned => {
            let counts = messages
                .iter()
                .filter_map(|m| {
                    if let M::CommandComplete(n) = m {
                        Some(*n)
                    } else {
                        None
                    }
                })
                .collect::<Vec<_>>();
            let rows = messages
                .iter()
                .filter_map(|m| if let M::Row(r) = m { Some(r) } else { None })
                .collect::<Vec<_>>();
            if counts != [0, 0, 0, 0, 1, 0, 1]
                || rows.len() != 2
                || rows[1].get(1) != Some("committed")
            {
                return Err(RuntimeError::CommitOutcomeUnknown(
                    "missing UPDATE 1 / marker COMMIT / data committed certificate".into(),
                ));
            }
            // The insert position sampled by the marker is an upper bound on
            // this batch's commit LSN, and precedes the marker's commit record.
            #[cfg(any(debug_assertions, test, feature = "test-support"))]
            assert_flushed(rows[0].get(0).unwrap(), rows[1].get(0).unwrap())?;
            Ok((
                rows[0].get(0).ok_or_else(retry)?.into(),
                rows[0].get(1).ok_or_else(retry)?.into(),
            ))
        }
        Err(_error) => {
            // An acknowledged ROLLBACK drains a possible aborted marker or data
            // transaction. A committed data xid is always unknown, including a
            // 23xxx/40001 marker error after COMMIT. Never replay that batch.
            if !client.is_closed() && client.batch_execute("ROLLBACK").is_ok() {
                let status = client.query_one(
                    "SELECT pg_catalog.pg_xact_status($1::text::xid8)",
                    &[&xid.to_string()],
                );
                if !warned
                    && status
                        .ok()
                        .is_some_and(|r| r.get::<_, Option<&str>>(0) == Some("aborted"))
                {
                    return Err(RuntimeError::Store("E_DATA_TRANSACTION_ABORTED: xid status is aborted after acknowledged drainage".into()));
                }
            }
            Err(RuntimeError::CommitOutcomeUnknown(
                "data or marker confirmation unavailable".into(),
            ))
        }
        _ => Err(RuntimeError::CommitOutcomeUnknown(
            "marker synchronous wait was cancelled".into(),
        )),
    }
}
fn lsn(value: &str) -> Result<u64, RuntimeError> {
    let (hi, lo) = value.split_once('/').ok_or_else(retry)?;
    Ok((u64::from_str_radix(hi, 16).map_err(|_| retry())? << 32)
        | u64::from_str_radix(lo, 16).map_err(|_| retry())?)
}

#[cfg(any(debug_assertions, test, feature = "test-support"))]
pub(super) fn assert_flushed(commit_upper_bound: &str, flush: &str) -> Result<(), RuntimeError> {
    assert!(
        lsn(commit_upper_bound)? <= lsn(flush)?,
        "E acknowledgement exceeds WAL flush position"
    );
    Ok(())
}

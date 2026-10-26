//! Store-level ownership. Lease traffic never enters the committer stream.
// @ref LLP 3000.009.001.000#5.1 — key-share is the first writer lock; token changes require FOR UPDATE.
// @ref LLP 3000.009.001.000#5.2 — W11's no-op lease claim precedes every termination.
use super::{
    Handle, shape,
    store::{self, Tx},
};
use crate::RuntimeError;
use postgres::{Client, Config, NoTls, Transaction, error::SqlState};
use std::{
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    thread,
    time::Duration,
};

const LEASE_STATEMENT_TIMEOUT: Duration = Duration::from_secs(5);
const TIMEOUT_MARGIN: Duration = Duration::from_secs(1);

#[derive(Clone, Debug)]
pub struct LeasePolicy {
    pub lease: Duration,
    pub claim_timeout: Duration,
    pub fence_timeout: Duration,
    pub fence_attempts: u32,
}
impl Default for LeasePolicy {
    fn default() -> Self {
        Self {
            lease: Duration::from_secs(3),
            claim_timeout: Duration::from_millis(100),
            fence_timeout: Duration::from_millis(200),
            fence_attempts: 20,
        }
    }
}
impl LeasePolicy {
    fn validate(&self) -> Result<(), RuntimeError> {
        if self.lease.is_zero()
            || self.lease > Duration::from_secs(86400)
            || self.claim_timeout.as_millis() == 0
            || self.claim_timeout > LEASE_STATEMENT_TIMEOUT - TIMEOUT_MARGIN
            || self.fence_timeout.as_millis() == 0
            || self.fence_timeout > LEASE_STATEMENT_TIMEOUT - TIMEOUT_MARGIN
            || self.fence_attempts == 0
            || self.fence_attempts > 100
        {
            return Err(RuntimeError::StoreOwnership(
                "invalid bounded lease policy".into(),
            ));
        }
        Ok(())
    }
}

#[derive(Clone)]
pub(super) struct Fence {
    pub store_id: String,
    pub holder: String,
    pub token: i64,
}
impl Fence {
    // @ref LLP 3000.009.001.000.002#3.3 — failure raises before later commands, whose snapshots follow the owner/head lock grants.
    pub(super) fn raising_command(fence: Option<&Self>) -> Result<String, RuntimeError> {
        let (token, identity) = match fence {
            Some(f) => {
                f.tag()?;
                (f.token, format!(" OR current_store IS NULL OR current_store OPERATOR(pg_catalog.<>) {}", super::literal::encode(&super::literal::Datum::Text(f.store_id.clone()), &postgres::types::Type::TEXT)?))
            }
            None => (0, String::new()),
        };
        Ok(format!("DO $sb4_owner$ DECLARE current_store pg_catalog.text; current_token pg_catalog.int8; BEGIN SELECT store_id,token INTO current_store,current_token FROM _owner WHERE singleton FOR KEY SHARE; IF NOT FOUND OR current_token IS NULL OR current_token OPERATOR(pg_catalog.<>) {token}::pg_catalog.int8{identity} THEN RAISE EXCEPTION 'stale owner token or logical store identity' USING ERRCODE='S4002'; END IF; END $sb4_owner$;"))
    }
    pub(super) fn tag(&self) -> Result<String, RuntimeError> {
        let hex =
            |text: &str, len| text.len() == len && text.bytes().all(|c| c.is_ascii_hexdigit());
        if !hex(&self.store_id, 32) || !hex(&self.holder, 4) || self.token < 0 {
            return Err(RuntimeError::StoreOwnership(
                "tag requires a 32-hex store id, 4-hex holder and nonnegative token".into(),
            ));
        }
        let tag = format!("sb:{}:{}:{}", self.store_id, self.holder, self.token);
        if tag.len() > 63 {
            return Err(RuntimeError::StoreOwnership(
                "connection tag exceeds 63 bytes".into(),
            ));
        }
        Ok(tag)
    }
}

/// Owns its dedicated lease connection. The caller schedules renewal and must
/// stop admitting writes on loss. Dropping does not silently release a lease.
pub struct StoreLease {
    client: Client,
    config: Config,
    namespace: String,
    fence: Fence,
    policy: LeasePolicy,
    warning: Arc<AtomicBool>,
    held: bool,
    // A failed renewal revokes write authority, but does not erase the token
    // needed for best-effort startup cleanup (including an unknown claim COMMIT).
    claimed: bool,
    pub(crate) read_grant: Arc<super::read_grant::Grant>,
    read_clock: Option<(super::read_grant::ReadClockBounds, String)>,
    prune_evidence: bool,
}
#[derive(Debug, PartialEq, Eq)]
pub struct LeaseAcquisition {
    pub token: i64,
    pub terminated: Vec<i32>,
}

pub(super) fn connect(mut config: Config) -> Result<(Client, Arc<AtomicBool>), RuntimeError> {
    if config.get_connect_timeout().is_none() {
        config.connect_timeout(Duration::from_secs(5));
    }
    let warning = Arc::new(AtomicBool::new(false));
    let seen = warning.clone();
    config.notice_callback(move |notice| {
        // SQLSTATE is stable across lc_messages; localized warning text
        // must never turn a cancelled synchronous wait into acknowledgement.
        if notice.code() == &SqlState::QUERY_CANCELED {
            seen.store(true, Ordering::SeqCst);
        }
    });
    #[cfg(any(test, feature = "test-support"))]
    crate::round_trips::postgres(1); // startup through ReadyForQuery
    // The pinned tokio-postgres transport underneath synchronous postgres sets
    // TCP_NODELAY before startup too; the pipeline TCP socket witness covers both.
    let mut client = config.connect(NoTls)?;
    super::literal::configure(&mut client)?;
    #[cfg(any(test, feature = "test-support"))]
    crate::round_trips::postgres(3); // settings batch + verify prepare/execute
    // @ref LLP 3000.009.001.000#8 — every serving/lease/reader connection needs session affinity.
    #[cfg(any(test, feature = "test-support"))]
    crate::round_trips::postgres(2); // implicit prepare + execute
    let first = client.query_one("SELECT pg_backend_pid(),current_setting('application_name'),current_setting('server_version_num')::int", &[])?;
    #[cfg(any(test, feature = "test-support"))]
    crate::round_trips::postgres(2);
    let second = client.query_one("SELECT pg_backend_pid(),current_setting('application_name')", &[])?;
    if first.get::<_, i32>(0) != second.get::<_, i32>(0) || first.get::<_, String>(1) != second.get::<_, String>(1) {
        return Err(RuntimeError::StoreUnsupported { family: "transaction-pooling" });
    }
    if !(160000..180000).contains(&first.get::<_, i32>(2)) { return Err(RuntimeError::StoreUnsupported { family: "postgres-version" }); }
    Ok((client, warning))
}

// @ref LLP 3000.009.001.000#5.4.1 — COMMIT has no adapter timeout or cancellation; loss of acknowledgement is unknown.
// PG16 must not execute a SET for PG17's new setting. The conditional stays
// in the certificate message and has the same command tag on both versions.
pub(super) const CERTIFICATE_SETTINGS: &str = "SET LOCAL synchronous_commit=on; SET LOCAL statement_timeout=0; SET LOCAL lock_timeout=0; DO $sb4_timeout$ BEGIN IF pg_catalog.current_setting('server_version_num')::int >= 170000 THEN SET LOCAL transaction_timeout=0; END IF; END $sb4_timeout$;";

pub(super) fn commit(mut tx: Transaction<'_>, warning: &AtomicBool) -> Result<(), RuntimeError> {
    tx.batch_execute(CERTIFICATE_SETTINGS)?;
    warning.store(false, Ordering::SeqCst);
    commit_result(tx.commit(), warning)
}
pub(super) fn commit_prepared(client: &mut Client, warning: &AtomicBool) -> Result<(), RuntimeError> {
    warning.store(false, Ordering::SeqCst);
    commit_result(client.batch_execute("COMMIT"), warning)
}

// @ref LLP 3000.009.001.000#5.4.1 — certificate waits, including recovery, cannot inherit session cancellation timeouts.
pub(super) fn commit_synchronous(client: &mut Client, warning: &AtomicBool) -> Result<(), RuntimeError> {
    warning.store(false, Ordering::SeqCst);
    commit_result(client.batch_execute(&format!("{CERTIFICATE_SETTINGS} COMMIT")), warning)
}

fn commit_result(result: Result<(), postgres::Error>, warning: &AtomicBool) -> Result<(), RuntimeError> {
    if warning.swap(false, Ordering::SeqCst) {
        return Err(RuntimeError::CommitOutcomeUnknown(
            "COMMIT returned a cancellation warning".into(),
        ));
    }
    result.map_err(|error| {
        // Explicit abort replies establish rollback. Transport loss, backend
        // termination and other unclassified COMMIT failures do not.
        if error.code().is_some_and(|code| {
            matches!(code.code(), "40001" | "40P01") || code.code().starts_with("23")
        }) {
            RuntimeError::Postgres(error)
        } else {
            RuntimeError::CommitOutcomeUnknown(error.to_string())
        }
    })
}

fn verify(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    shape::verify(
        tx,
        "_owner",
        &[
            ("singleton", "boolean", true, false),
            ("store_id", "text", true, true),
            ("holder", "text", true, true),
            ("token", "bigint", true, false),
            ("lease_until", "timestamp with time zone", true, false),
        ],
        &["singleton"],
        "E_STORE_OWNERSHIP",
    )
}

pub(super) fn install(tx: &Tx<'_>, id: &str) -> Result<(), RuntimeError> {
    verify(tx)?;
    tx.batch("CREATE TABLE IF NOT EXISTS _owner (singleton BOOLEAN PRIMARY KEY, store_id TEXT COLLATE \"C\" NOT NULL, holder TEXT COLLATE \"C\" NOT NULL, token BIGINT NOT NULL, lease_until TIMESTAMPTZ NOT NULL)")?;
    tx.execute(
        "INSERT INTO _owner VALUES (true,$1,'0000',0,'-infinity') ON CONFLICT DO NOTHING",
        &[&id],
    )?;
    check_record(tx, id)
}

// @ref LLP 3000.009.001.000#3.4 — the retained evaluator must not share a unified owner's namespace.
pub(super) fn isolate_evaluator(tx: &Tx<'_>) -> Result<(), RuntimeError> {
    // Retain this shared session lock for the evaluator connection's lifetime.
    // Legacy owner installation takes the exclusive transaction counterpart,
    // so an already-open evaluator cannot be adopted underneath an in-flight
    // write. Connection drop releases the guard, including failed opens.
    tx.query("SELECT pg_advisory_lock_shared(hashtextextended('sb4-owner-bootstrap:' || current_schema(),0))", &[])?;
    if tx.query("SELECT to_regclass('_owner') IS NOT NULL", &[])?[0].get::<_, bool>(0) {
        return Err(RuntimeError::StoreOwnership(
            "the evaluator requires a separate namespace from the unified owner (including token zero)".into(),
        ));
    }
    Ok(())
}

fn check_record(tx: &Tx<'_>, id: &str) -> Result<(), RuntimeError> {
    let rows = tx.query("SELECT singleton,store_id,holder,token FROM _owner", &[])?;
    if rows.len() != 1
        || !rows[0].get::<_, bool>(0)
        || rows[0].get::<_, &str>(1) != id
        || rows[0].get::<_, i64>(3) < 0
    {
        return Err(RuntimeError::StoreOwnership(
            "invalid owner singleton or store identity".into(),
        ));
    }
    Fence {
        store_id: id.into(),
        holder: rows[0].get(2),
        token: rows[0].get(3),
    }
    .tag()?;
    Ok(())
}

pub(super) fn verify_record(tx: &Tx<'_>, id: &str) -> Result<(), RuntimeError> {
    verify(tx)?;
    check_record(tx, id)?;
    if tx.meta("store_id")?.as_deref() != Some(id) {
        return Err(RuntimeError::StoreOwnership("bootstrap metadata identity differs from pending intent".into()));
    }
    Ok(())
}

impl Handle {
    pub(crate) fn open_owned(
        connection: &str,
        namespace: &str,
        lease: &StoreLease,
    ) -> Result<Self, RuntimeError> {
        if !lease.held || namespace != lease.namespace {
            return Err(RuntimeError::StoreOwnership(
                "lease is not held for this namespace".into(),
            ));
        }
        lease.read_grant.opened.store(true,Ordering::Release);
        let handle=Self::connect_owned(connection.parse()?, namespace, Some(lease.fence.clone()))?;
        handle.store.borrow_mut().read_grant=Some(lease.read_grant.clone());
        Ok(handle)
    }
}

impl StoreLease {
    pub fn connect(
        connection: &str,
        namespace: &str,
        store_id: &str,
        holder: &str,
        policy: LeasePolicy,
    ) -> Result<Self, RuntimeError> {
        policy.validate()?;
        let quoted = store::namespace(namespace)?;
        let fence = Fence {
            store_id: store_id.into(),
            holder: holder.into(),
            token: 0,
        };
        fence.tag()?;
        let config: Config = connection.parse()?;
        let (mut client, warning) = connect(config.clone())?;
        client.batch_execute(&format!("SET search_path = {quoted}, pg_catalog; SET statement_timeout='5s'; SET lock_timeout='5s'"))?;
        // Verify the owner relation before any conditional UPDATE can invoke
        // database-owned rules/triggers or weaken its immediate singleton key.
        let mut checked = store::Store::new(client);
        let tx = checked.opening_transaction()?;
        verify(&tx)?;
        super::read_grant::verify(&tx)?;
        check_record(&tx, store_id)?;
        if tx.meta("store_id")?.as_deref() != Some(store_id) {
            return Err(RuntimeError::StoreOwnership(
                "lease metadata store identity mismatch".into(),
            ));
        }
        tx.rollback()?;
        super::checks::load(&mut checked)?;
        let prune_evidence=checked.check_functions.borrow().is_some();
        let client = checked.client.into_sync();
        Ok(Self {
            client,
            config,
            namespace: namespace.into(),
            fence,
            policy,
            warning,
            held: false,
            claimed: false,
            read_grant: Default::default(),
            read_clock: None,
            prune_evidence,
        })
    }
    pub fn lease_duration(&self) -> Duration { self.policy.lease }
    pub fn token(&self) -> Option<i64> {
        self.held.then_some(self.fence.token)
    }
    pub fn store_id(&self) -> &str {
        &self.fence.store_id
    }
    /// Poll then claim on the database clock. None always means no termination.
    pub fn acquire(&mut self) -> Result<Option<LeaseAcquisition>, RuntimeError> {
        let row = self.client.query_one("SELECT token,lease_until < clock_timestamp() FROM _owner WHERE singleton AND store_id=$1", &[&self.fence.store_id])?;
        if !row.get::<_, bool>(1) {
            return Ok(None);
        }
        #[cfg(test)]
        test_hooks::run(test_hooks::Point::AfterPoll);
        self.claim(row.get(0))
    }
    fn claim(&mut self, observed: i64) -> Result<Option<LeaseAcquisition>, RuntimeError> {
        self.held = false;
        self.claimed = false;
        let token = observed
            .checked_add(1)
            .filter(|token| *token > 0)
            .ok_or_else(|| {
                RuntimeError::StoreOwnership("owner token exhausted or invalid".into())
            })?;
        let mut tx = self.client.transaction()?;
        tx.batch_execute(&format!(
            "SET LOCAL lock_timeout = {}",
            self.policy.claim_timeout.as_millis()
        ))?;
        match tx.query_opt("UPDATE _owner SET lease_until=lease_until WHERE singleton AND store_id=$1 AND token=$2 AND lease_until < clock_timestamp() RETURNING token", &[&self.fence.store_id, &observed]) {
            Ok(Some(_)) => (),
            Ok(None) => return Ok(None),
            Err(e) if matches!(e.code(), Some(&SqlState::LOCK_NOT_AVAILABLE | &SqlState::QUERY_CANCELED)) => return Ok(None),
            Err(e) => return Err(e.into()),
        }
        // @ref LLP 3000.009.001.000.002#4.2 — a short writer lease or old G5 owner cannot bypass an outstanding read epoch.
        let grant_exists=tx.query_one("SELECT to_regclass('_read_grant') IS NOT NULL",&[])?.get::<_,bool>(0);
        if grant_exists && tx.query_opt("SELECT epoch FROM _read_grant WHERE singleton AND valid_until >= clock_timestamp()",&[])?.is_some() { return Ok(None); }
        #[cfg(test)]
        test_hooks::run(test_hooks::Point::AfterClaim);
        // The watcher may now signal blockers. No statement timeout may cancel
        // this phase after a signal; each fence wait retains its lock timeout
        // and the finite retry count. COMMIT has its separate unknown outcome.
        tx.batch_execute("SET LOCAL statement_timeout = 0")?;
        let pid: i32 = tx.query_one("SELECT pg_backend_pid()", &[])?.get(0);
        let mut watcher = Watcher::start(
            self.config.clone(),
            pid,
            self.fence.store_id.clone(),
            observed,
        )?;
        tx.batch_execute(&format!(
            "SET LOCAL lock_timeout = {}",
            self.policy.fence_timeout.as_millis()
        ))?;
        let mut locked = false;
        for _ in 0..self.policy.fence_attempts {
            tx.batch_execute("SAVEPOINT owner_fence")?;
            match tx.query_one("SELECT token FROM _owner WHERE singleton FOR UPDATE", &[]) {
                Ok(row) => {
                    locked = row.get::<_, i64>(0) == observed;
                    break;
                }
                Err(e) if e.code() == Some(&SqlState::LOCK_NOT_AVAILABLE) => {
                    tx.batch_execute(
                        "ROLLBACK TO SAVEPOINT owner_fence; RELEASE SAVEPOINT owner_fence",
                    )?;
                    #[cfg(test)]
                    test_hooks::run(test_hooks::Point::AfterFenceRollback);
                    if watcher.failed.load(Ordering::SeqCst) {
                        break;
                    }
                }
                Err(e) => return Err(e.into()),
            }
        }
        let mut terminated = watcher.finish()?;
        if !locked {
            return Err(RuntimeError::StoreOwnership(
                "bounded takeover could not acquire owner fence".into(),
            ));
        }
        let next = Fence {
            token,
            ..self.fence.clone()
        };
        let tag = next.tag()?;
        tx.execute("UPDATE _owner SET token=$1,holder=$2,lease_until=clock_timestamp()+make_interval(secs=>$3) WHERE singleton", &[&token,&next.holder,&self.policy.lease.as_secs_f64()])?;
        tx.execute("SELECT set_config('application_name',$1,false)", &[&tag])?;
        let outcome = commit(tx, &self.warning);
        // A known rollback owns nothing, even if a successor reuses this token.
        // An unknown COMMIT may have installed our claim: retain its identity
        // for conditional cleanup, but never grant local write authority.
        self.claimed = outcome.is_ok()
            || matches!(&outcome, Err(RuntimeError::CommitOutcomeUnknown(_)));
        if self.claimed {
            self.fence = next;
        }
        outcome?;
        self.held = true;
        // Hygiene is after COMMIT. A late sweep is still bounded by the old token.
        terminated.extend(terminate(
            &mut self.client,
            None,
            &self.fence.store_id,
            observed,
        )?);
        Ok(Some(LeaseAcquisition { token, terminated }))
    }
    /// Startup only, before opening/exposing any engine. All later handles share
    /// this gate. The deployment is responsible for the declared clock/HA bounds.
    pub fn enable_read_grant(&mut self, bounds: super::read_grant::ReadClockBounds) -> Result<(),RuntimeError> {
        use super::read_grant::{boottime, Published, PUBLICATION, CREATE};
        if !self.held || self.read_grant.opened.load(Ordering::Acquire) || self.read_grant.configured.load(Ordering::Acquire) {return Err(RuntimeError::StoreOwnership("read grant needs a fresh acquired owner before engine admission".into()));}
        let window=bounds.window(self.policy.lease)?;
        let started=boottime().ok_or_else(||RuntimeError::StoreOwnership("read grant clock unavailable".into()))?;
        let epoch=format!("{:016x}{:016x}",crate::ids::seed(),crate::ids::seed());
        let mut tx=self.client.transaction()?;
        let rows=tx.execute("UPDATE _owner SET lease_until=lease_until WHERE singleton AND store_id=$1 AND holder=$2 AND token=$3 AND lease_until>clock_timestamp()",&[&self.fence.store_id,&self.fence.holder,&self.fence.token])?;
        if rows!=1 {return Err(RuntimeError::StoreOwnership("read grant owner expired".into()));}
        tx.batch_execute(CREATE)?;
        // An unexpired old epoch may never be shortened, including by accidental
        // repeat installation with the same owner identity.
        if tx.query_opt("SELECT epoch FROM _read_grant WHERE singleton AND valid_until>=clock_timestamp()",&[])?.is_some() {return Err(RuntimeError::StoreOwnership("outstanding read epoch must expire or drain".into()));}
        tx.execute("INSERT INTO _read_grant VALUES(true,$1,$2,$3,$4,clock_timestamp()+make_interval(secs=>$5)) ON CONFLICT(singleton) DO UPDATE SET store_id=EXCLUDED.store_id,holder=EXCLUDED.holder,token=EXCLUDED.token,epoch=EXCLUDED.epoch,valid_until=EXCLUDED.valid_until",&[&self.fence.store_id,&self.fence.holder,&self.fence.token,&epoch,&self.policy.lease.as_secs_f64()])?;
        // @ref LLP 3000.009.001.000.002#6 — doctor reports the owner's declared bounds, not its own environment.
        // Advisory diagnostics only, bound to this epoch. This is lease traffic,
        // never authority or a durable compatibility marker for older writers.
        let notice=serde_json::json!({"epoch":epoch,"rate_ppm":bounds.rate_ppm,"forward_jump_ms":bounds.forward_jump.as_millis()}).to_string();
        tx.execute("INSERT INTO _meta(key,value) VALUES('read_grant_clock',$1) ON CONFLICT(key) DO UPDATE SET value=EXCLUDED.value",&[&notice])?;
        let row=super::flight::Row::Bind(tx.query_one(PUBLICATION,&[])?);
        let published=Published::row(&row)?;
        commit(tx,&self.warning)?;
        if boottime().is_none_or(|n|n>=started+window) {self.read_grant.revoke();return Err(RuntimeError::StoreOwnership("late grant installation cannot open an epoch".into()));}
        let mut s=self.read_grant.state.write().unwrap_or_else(|p|p.into_inner());
        s.epoch=Some(epoch.clone());self.read_grant.until.store((started+window).as_nanos() as u64,Ordering::Release);s.published=Some(published);
        self.read_clock=Some((bounds,epoch));
        self.read_grant.configured.store(true,Ordering::Release);
        Ok(())
    }
    pub fn renew(&mut self) -> Result<bool, RuntimeError> {
        if !self.held {
            return Ok(false);
        }
        let started=super::read_grant::boottime();
        let grant_deadline=self.read_grant.deadline().filter(|_|!self.read_grant.revoked.load(Ordering::Acquire) && !self.read_grant.uncertain.load(Ordering::Acquire));
        let renewing=self.read_clock.clone().filter(|_|grant_deadline.is_some());
        let result = (|| {
            let mut tx = self.client.transaction()?;
            let rows = tx.execute("UPDATE _owner SET lease_until=clock_timestamp()+make_interval(secs=>$1) WHERE singleton AND store_id=$2 AND token=$3 AND holder=$4", &[&self.policy.lease.as_secs_f64(), &self.fence.store_id, &self.fence.token, &self.fence.holder])?;
            if let Some((_,epoch))=&renewing {
                let grants=tx.execute("UPDATE _read_grant SET valid_until=clock_timestamp()+make_interval(secs=>$1) WHERE singleton AND store_id=$2 AND token=$3 AND holder=$4 AND epoch=$5 AND valid_until>clock_timestamp()",&[&self.policy.lease.as_secs_f64(),&self.fence.store_id,&self.fence.token,&self.fence.holder,epoch])?;
                if rows!=1 || grants!=1 {return Err(RuntimeError::StoreOwnership("read grant renewal lost its exact epoch".into()));}
            }
            // A legacy store is upgraded by Engine::open after this lease was
            // connected. Observe that committed marker on the next renewal.
            if rows==1 && !self.prune_evidence {
                self.prune_evidence=tx.query_one("SELECT EXISTS(SELECT 1 FROM _meta WHERE key='flight_checks_v1' AND value IN ('1','digests'))", &[])?.get(0);
            }
            if rows==1 && self.prune_evidence {
                // Lease maintenance is outside the ordered batch critical path.
                // Skip a busy head; never delay renewal behind a writer.
                tx.execute(super::change_evidence::PRUNE, &[])?;
            }
            commit(tx, &self.warning)?;
            Ok::<_, RuntimeError>(rows)
        })();
        if !matches!(result, Ok(1)) {
            self.held = false;
        }
        if let (Some((bounds,_)),Some(start),Some(old))=(renewing,started,grant_deadline) {
            let window=bounds.window(self.policy.lease)?;
            if matches!(result,Ok(1)) && !self.read_grant.revoked.load(Ordering::Acquire) && !self.read_grant.uncertain.load(Ordering::Acquire) && super::read_grant::boottime().is_some_and(|n|n<old && n<start+window) {
                let _=self.read_grant.until.compare_exchange(old.as_nanos() as u64,(start+window).as_nanos() as u64,Ordering::AcqRel,Ordering::Acquire);
            } else {self.read_grant.revoke();}
        } else if self.read_clock.is_some() { self.read_grant.revoke(); }
        Ok(result? == 1)
    }
    pub fn release(&mut self) -> Result<bool, RuntimeError> {
        if !self.claimed {
            return Ok(false);
        }
        // Acknowledged cache-stop/drain precedes shortening the persisted epoch.
        self.read_grant.drain();
        self.held = false;
        let mut tx = self.client.transaction()?;
        let rows = tx.execute("UPDATE _owner SET lease_until='-infinity' WHERE singleton AND store_id=$1 AND token=$2 AND holder=$3", &[&self.fence.store_id,&self.fence.token,&self.fence.holder])?;
        if let Some((_,epoch))=&self.read_clock {
            tx.execute("UPDATE _read_grant SET valid_until='-infinity' WHERE singleton AND store_id=$1 AND token=$2 AND holder=$3 AND epoch=$4",&[&self.fence.store_id,&self.fence.token,&self.fence.holder,epoch])?;
        }
        commit(tx, &self.warning)?;
        self.claimed = false;
        Ok(rows == 1)
    }
}

fn tag_token(tag: &str, id: &str) -> Option<i64> {
    let mut parts = tag.split(':');
    if parts.next()? != "sb" || parts.next()? != id {
        return None;
    }
    let holder = parts.next()?;
    if holder.len() != 4 || !holder.bytes().all(|c| c.is_ascii_hexdigit()) {
        return None;
    }
    let token = parts.next()?.parse::<i64>().ok()?;
    (parts.next().is_none() && token >= 0).then_some(token)
}
pub(super) fn terminate(
    client: &mut Client,
    waiter: Option<i32>,
    id: &str,
    observed: i64,
) -> Result<Vec<i32>, RuntimeError> {
    let rows = client.query("SELECT pid,COALESCE(application_name,''),COALESCE(usename=current_user,false) FROM pg_stat_activity WHERE datname=current_database() AND pid<>pg_backend_pid() AND ($1::int IS NULL OR pid=ANY(pg_blocking_pids($1)))", &[&waiter])?;
    // Classify the complete snapshot before the first irreversible signal.
    // A mixed set must refuse without killing its eligible members.
    let mut eligible = Vec::new();
    for row in rows {
        let pid: i32 = row.get(0);
        let tag: String = row.get(1);
        if row.get::<_, bool>(2) && tag_token(&tag, id).is_some_and(|token| token <= observed) {
            eligible.push((pid, tag));
        } else if waiter.is_some() {
            return Err(RuntimeError::StoreOwnership(
                "takeover blocked by an unowned or newer-token session".into(),
            ));
        }
    }
    let mut killed = Vec::new();
    for (pid, tag) in eligible {
        // Recheck identity in the termination statement, including the token in
        // the exact tag, rather than signalling a previously enumerated PID.
        let rows = client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE pid=$1 AND application_name=$2 AND usename=current_user AND datname=current_database()", &[&pid,&tag])?;
        if rows.first().is_some_and(|row| row.get::<_, bool>(0)) {
            killed.push(pid);
        }
    }
    Ok(killed)
}
struct Watcher {
    done: Arc<AtomicBool>,
    failed: Arc<AtomicBool>,
    thread: Option<thread::JoinHandle<Result<Vec<i32>, RuntimeError>>>,
}
impl Watcher {
    fn start(config: Config, pid: i32, id: String, observed: i64) -> Result<Self, RuntimeError> {
        let (mut client, _) = connect(config)?;
        client.batch_execute("SET statement_timeout='500ms'; SET lock_timeout='500ms'")?;
        let done = Arc::new(AtomicBool::new(false));
        let stop = done.clone();
        let failed = Arc::new(AtomicBool::new(false));
        let error = failed.clone();
        #[cfg(test)]
        let before_watch = test_hooks::take(test_hooks::Point::BeforeWatch);
        let thread = thread::spawn(move || {
            #[cfg(test)]
            if let Some(hook) = before_watch {
                hook();
            }
            let mut killed = Vec::new();
            while !stop.load(Ordering::SeqCst) {
                match terminate(&mut client, Some(pid), &id, observed) {
                    Ok(pids) => killed.extend(pids),
                    Err(e) => {
                        error.store(true, Ordering::SeqCst);
                        return Err(e);
                    }
                }
                thread::park_timeout(Duration::from_millis(10));
            }
            Ok(killed)
        });
        Ok(Self {
            done,
            failed,
            thread: Some(thread),
        })
    }
    fn finish(&mut self) -> Result<Vec<i32>, RuntimeError> {
        self.done.store(true, Ordering::SeqCst);
        let thread = self.thread.take().expect("watcher joined once");
        thread.thread().unpark();
        thread
            .join()
            .map_err(|_| RuntimeError::StoreOwnership("blocker watcher panicked".into()))?
    }
}
impl Drop for Watcher {
    fn drop(&mut self) {
        if self.thread.is_some() {
            let _ = self.finish();
        }
    }
}

#[cfg(test)]
#[path = "tests/ownership.rs"]
mod tests;

// Hooks are local to the invoking test thread; only BeforeWatch is explicitly
// transferred to that claim's watcher. No timing switch reaches production.
#[cfg(test)]
pub(crate) mod test_hooks {
    use std::cell::RefCell;
    #[derive(Clone, Copy, PartialEq, Eq)]
    pub(crate) enum Point {
        AfterPoll,
        AfterClaim,
        AfterFenceRollback,
        BeforeWatch,
        AfterBootstrapLock,
    }
    type Hook = Box<dyn FnOnce() + Send>;
    thread_local! { static HOOKS: RefCell<Vec<(Point, Hook)>> = RefCell::new(Vec::new()); }
    pub(crate) fn set(point: Point, hook: impl FnOnce() + Send + 'static) {
        HOOKS.with(|hooks| hooks.borrow_mut().push((point, Box::new(hook))));
    }
    pub(in crate::engine::postgres) fn take(point: Point) -> Option<Hook> {
        HOOKS.with(|hooks| {
            let mut hooks = hooks.borrow_mut();
            hooks
                .iter()
                .position(|(p, _)| *p == point)
                .map(|i| hooks.remove(i).1)
        })
    }
    pub(in crate::engine::postgres) fn run(point: Point) {
        if let Some(hook) = take(point) {
            hook();
        }
    }
}

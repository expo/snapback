//! Reader-only extended-protocol transport. Each query ends in its own Sync;
//! the writer continues to use the synchronous driver and ordered flights.
// @ref LLP 3000.009.001.000.002#12-panel-disposition-round-4 — bounded independent snapshots, errors and backpressure.
use crate::RuntimeError;
use futures_util::TryStreamExt;
use postgres::{
    Row, SimpleQueryMessage, Statement,
    types::{ToSql, Type},
};
use std::collections::VecDeque;
use std::sync::{
    Arc, Condvar, Mutex, OnceLock,
    atomic::{AtomicUsize, Ordering},
};
use tokio::sync::{OwnedRwLockWriteGuard, RwLock, Semaphore};

const CONNECTIONS: usize = 30;
const CONSTRUCTORS: usize = 4;
fn runtime() -> &'static tokio::runtime::Runtime {
    static RUNTIME: OnceLock<tokio::runtime::Runtime> = OnceLock::new();
    RUNTIME.get_or_init(|| {
        tokio::runtime::Builder::new_multi_thread()
            .worker_threads(1)
            .thread_name("sb4-pg-reader")
            .enable_all()
            .build()
            .expect("Postgres reader runtime")
    })
}

pub(crate) struct Pool {
    durability: Mutex<Option<Arc<super::early_release::Durability>>>,
    config: tokio_postgres::Config,
    setup: String,
    slots: Mutex<Slots>,
    available: Condvar,
    next: AtomicUsize,
    depth: usize,
}
#[derive(Default)]
struct Slots {
    ready: Vec<Arc<Slot>>,
    opening: usize,
    writers: usize,
}
pub(crate) struct Slot {
    client: tokio_postgres::Client,
    // Fallbacks own the connection from their first command through rollback.
    // Independent statements borrow it concurrently, bounded by depth.
    custody: Arc<RwLock<()>>,
    permits: Semaphore,
    prepared: tokio::sync::Mutex<VecDeque<(String, Statement)>>,
}
// Like the driver's Statement::drop, release session state without adding a
// request wait. Exclusive custody keeps cleanup outside every read snapshot.
pub(super) struct PreparedName {
    slot: Arc<Slot>,
    name: String,
}
impl Drop for PreparedName {
    fn drop(&mut self) {
        if self.slot.client.is_closed() {
            return;
        }
        let slot = self.slot.clone();
        let command = format!("DEALLOCATE \"{}\"", self.name.replace('"', "\"\""));
        runtime().spawn(async move {
            let _custody = slot.custody.write().await;
            // A failed/closed connection discards all its prepared state too.
            let _ = slot.client.batch_execute(&command).await;
        });
    }
}
impl Pool {
    pub fn new(
        config: &postgres::Config,
        namespace: &str,
        tag: Option<String>,
    ) -> Result<Arc<Self>, RuntimeError> {
        let depth = match std::env::var("SNAPBACK4_POSTGRES_PIPELINE_DEPTH") {
            Ok(value) => value
                .parse::<usize>()
                .ok()
                .filter(|n| (1..=8).contains(n))
                .ok_or_else(|| {
                    RuntimeError::Input("SNAPBACK4_POSTGRES_PIPELINE_DEPTH must be 1..8".into())
                })?,
            Err(std::env::VarError::NotPresent) => 4,
            Err(_) => {
                return Err(RuntimeError::Input(
                    "invalid Postgres pipeline depth".into(),
                ));
            }
        };
        Self::with_depth(config, namespace, tag, depth)
    }
    fn with_depth(
        config: &postgres::Config,
        namespace: &str,
        tag: Option<String>,
        depth: usize,
    ) -> Result<Arc<Self>, RuntimeError> {
        let mut c = tokio_postgres::Config::new();
        if let Some(v) = config.get_user() {
            c.user(v);
        }
        if let Some(v) = config.get_password() {
            c.password(v);
        }
        if let Some(v) = config.get_dbname() {
            c.dbname(v);
        }
        if let Some(v) = config.get_options() {
            c.options(v);
        }
        if let Some(v) = tag.as_deref().or(config.get_application_name()) {
            c.application_name(v);
        }
        for host in config.get_hosts() {
            match host {
                postgres::config::Host::Tcp(v) => {
                    c.host(v);
                }
                #[cfg(unix)]
                postgres::config::Host::Unix(v) => {
                    c.host_path(v);
                }
            }
        }
        for v in config.get_hostaddrs() {
            c.hostaddr(*v);
        }
        for v in config.get_ports() {
            c.port(*v);
        }
        c.ssl_mode(config.get_ssl_mode())
            .ssl_negotiation(config.get_ssl_negotiation())
            .channel_binding(config.get_channel_binding())
            .target_session_attrs(config.get_target_session_attrs())
            .load_balance_hosts(config.get_load_balance_hosts())
            .keepalives(config.get_keepalives())
            .keepalives_idle(config.get_keepalives_idle())
            .connect_timeout(
                config
                    .get_connect_timeout()
                    .copied()
                    .unwrap_or(std::time::Duration::from_secs(5)),
            );
        if let Some(v) = config.get_tcp_user_timeout() {
            c.tcp_user_timeout(*v);
        }
        if let Some(v) = config.get_keepalives_interval() {
            c.keepalives_interval(v);
        }
        if let Some(v) = config.get_keepalives_retries() {
            c.keepalives_retries(v);
        }
        let quoted = super::store::namespace(namespace)?;
        Ok(Arc::new(Self {
            durability:Mutex::new(None),
            config: c,
            setup: format!(
                "SET search_path={quoted},pg_catalog,pg_temp; SET statement_timeout='5s'; SET lock_timeout='5s'; SET default_transaction_read_only=on; SET client_encoding='UTF8'; SET extra_float_digits=3; SET bytea_output='hex'; SET array_nulls=on; SET plan_cache_mode=force_generic_plan"
            ),
            slots: Mutex::new(Slots::default()),
            available: Condvar::new(),
            next: AtomicUsize::new(0),
            depth,
        }))
    }
    pub(crate) fn set_durability(&self,gate:Option<Arc<super::early_release::Durability>>) {
        *self.durability.lock().unwrap_or_else(|p|p.into_inner())=gate;
    }
    pub(crate) fn reserve_writer(&self) -> Result<(), RuntimeError> {
        let mut slots = self.slots.lock().unwrap_or_else(|p|p.into_inner());
        if slots.writers == 1 { return Ok(()); }
        if slots.ready.len() + slots.opening >= CONNECTIONS {
            return Err(RuntimeError::Store("no reader slot available for pipeline writer".into()));
        }
        slots.writers = 1;
        Ok(())
    }
    fn slot(&self) -> Result<Arc<Slot>, RuntimeError> {
        self.slot_with(|| {})
    }
    // @ref LLP 3000.009.001.000.002#4.1 — reserve bounded construction, then qualify without owning the global slots mutex.
    fn slot_with(&self, constructing: impl FnOnce()) -> Result<Arc<Slot>, RuntimeError> {
        let mut slots = self.slots.lock().unwrap_or_else(|e| e.into_inner());
        loop {
            // Reservations count toward the physical cap, including failures.
            slots.ready.retain(|s| !s.client.is_closed());
            if slots.ready.len() + slots.opening + slots.writers < CONNECTIONS && slots.opening < CONSTRUCTORS {
                slots.opening += 1;
                break;
            }
            if !slots.ready.is_empty() {
                return Ok(slots.ready[self.next.fetch_add(1, Ordering::Relaxed) % slots.ready.len()].clone());
            }
            slots = self.available.wait(slots).unwrap_or_else(|p| p.into_inner());
        }
        drop(slots);
        // Return reservations and notify waiters even if construction panics.
        struct Reservation<'a>(&'a Pool);
        impl Drop for Reservation<'_> {
            fn drop(&mut self) {
                self.0.slots.lock().unwrap_or_else(|p| p.into_inner()).opening -= 1;
                self.0.available.notify_all();
            }
        }
        let reservation = Reservation(self);
        constructing();
        let durability=self.durability.lock().unwrap_or_else(|p|p.into_inner()).clone();
        let result = runtime().block_on(async {
                // tokio-postgres connect_socket sets TCP_NODELAY before startup,
                // exactly as the synchronous postgres wrapper does for writers.
                let (client, connection) = self.config.connect(tokio_postgres::NoTls).await?;
                runtime().spawn(async move {
                    if connection.await.is_err() && let Some(gate)=durability {gate.break_history();}
                });
                client.batch_execute(&self.setup).await?;
                let a = client.query_one("SELECT pg_backend_pid(),current_setting('application_name'),current_setting('server_version_num')::int,current_setting('client_encoding'),current_setting('extra_float_digits'),current_setting('bytea_output')", &[]).await?;
                let b = client.query_one("SELECT pg_backend_pid(),current_setting('application_name')", &[]).await?;
                if a.get::<_,i32>(0) != b.get::<_,i32>(0) || a.get::<_,String>(1) != b.get::<_,String>(1) {
                    return Err(RuntimeError::StoreUnsupported { family: "transaction-pooling" });
                }
                if !(160000..180000).contains(&a.get::<_,i32>(2)) { return Err(RuntimeError::StoreUnsupported { family: "postgres-version" }); }
                if a.get::<_,&str>(3) != "UTF8" || a.get::<_,&str>(4) != "3" || a.get::<_,&str>(5) != "hex" {
                    return Err(RuntimeError::Store("Postgres reader settings were not pinned".into()));
                }
                Ok(Arc::new(Slot { client, custody: Arc::new(RwLock::new(())), permits: Semaphore::new(self.depth), prepared: tokio::sync::Mutex::new(VecDeque::new()) }))
            });
        if let Ok(slot) = &result {
            self.slots.lock().unwrap_or_else(|p| p.into_inner()).ready.push(slot.clone());
            #[cfg(any(test, feature = "test-support"))]
            crate::round_trips::postgres(6);
        }
        drop(reservation);
        result
    }
}

/// Logical handles have separate statement/answer caches. Only transport and
/// connection custody are shared. No authority or result survives a request.
pub(crate) enum Connection {
    Sync(postgres::Client),
    Writer(super::writer_driver::Driver),
    Reader {
        slot: Arc<Slot>,
        _pool: Arc<Pool>,
        session: bool,
        lease: Option<OwnedRwLockWriteGuard<()>>,
    },
}
impl std::ops::Deref for Connection {
    type Target = postgres::Client;
    fn deref(&self) -> &Self::Target {
        match self {
            Self::Sync(c) => c,
            _ => panic!("synchronous-only Postgres operation on a reader"),
        }
    }
}
impl std::ops::DerefMut for Connection {
    fn deref_mut(&mut self) -> &mut Self::Target {
        match self {
            Self::Sync(c) => c,
            _ => panic!("synchronous-only Postgres operation on a reader"),
        }
    }
}
impl Connection {
    pub fn reader(pool: Arc<Pool>) -> Result<Self, RuntimeError> {
        Ok(Self::Reader {
            slot: pool.slot()?,
            _pool: pool,
            session: false,
            lease: None,
        })
    }
    pub fn into_sync(self) -> postgres::Client {
        match self {
            Self::Sync(c) => c,
            _ => panic!("writer expected"),
        }
    }
    pub(super) fn prepared_cleanup(&self, name: &str) -> Option<PreparedName> {
        match self {
            Self::Reader { slot, .. } => Some(PreparedName {
                slot: slot.clone(),
                name: name.into(),
            }),
            Self::Sync(_) | Self::Writer(_) => None,
        }
    }
    pub(super) fn is_closed(&self) -> bool {
        match self {
            Self::Sync(c) => c.is_closed(),
            Self::Writer(c) => c.is_closed(),
            Self::Reader { slot, .. } => slot.client.is_closed(),
        }
    }
    // Only called before a new transaction/request. An in-flight query is
    // never replayed; its original future still receives the transport error.
    pub(super) fn refresh_closed(&mut self) -> Result<bool, RuntimeError> {
        let pool = match self {
            Self::Reader { slot, _pool, .. } if slot.client.is_closed() => _pool.clone(),
            _ => return Ok(false),
        };
        let replacement = Self::reader(pool)?;
        *self = replacement;
        Ok(true)
    }
    pub(crate) fn writer_thread(&mut self) {
        if matches!(self, Self::Writer(_)) {return;}
        // The caller supplies a temporary disconnected holder through an Option
        // conversion; no reference into the old client survives this move.
        let old=std::mem::replace(self, Self::Writer(super::writer_driver::Driver::empty()));
        *self=match old {Self::Sync(client)=>Self::Writer(super::writer_driver::Driver::new(client)),other=>other};
    }
    pub fn is_reader(&self) -> bool {
        matches!(self, Self::Reader { .. })
    }
    pub fn begin(&mut self) {
        if let Self::Reader { session, .. } = self {
            *session = true;
        }
    }
    pub fn finish(&mut self) {
        if let Self::Reader { session, lease, .. } = self {
            *session = false;
            *lease = None;
        }
    }
    fn lock(&mut self) -> Option<OwnedRwLockWriteGuard<()>> {
        match self {
            Self::Sync(_) | Self::Writer(_) => None,
            Self::Reader {
                slot,
                session,
                lease,
                ..
            } => {
                if lease.is_some() {
                    return None;
                }
                let guard = runtime().block_on(slot.custody.clone().write_owned());
                if *session {
                    *lease = Some(guard);
                    None
                } else {
                    Some(guard)
                }
            }
        }
    }
    pub fn prepare(&mut self, sql: &str) -> Result<Statement, postgres::Error> {
        let _guard = self.lock();
        match self {
            Self::Sync(c) => c.prepare(sql),
            Self::Writer(c) => c.prepare(sql),
            Self::Reader { slot, .. } => runtime().block_on(slot.client.prepare(sql)),
        }
    }
    pub fn query<T: ?Sized + tokio_postgres::ToStatement + super::writer_driver::Source>(
        &mut self,
        sql: &T,
        params: &[&(dyn ToSql + Sync)],
    ) -> Result<Vec<Row>, postgres::Error> {
        let _guard = self.lock();
        match self {
            Self::Sync(c) => c.query(sql, params),
            Self::Writer(c) => c.query(sql, params),
            Self::Reader { slot, .. } => runtime().block_on(slot.client.query(sql, params)),
        }
    }
    pub fn query_one<T: ?Sized + tokio_postgres::ToStatement + super::writer_driver::Source>(
        &mut self,
        sql: &T,
        params: &[&(dyn ToSql + Sync)],
    ) -> Result<Row, postgres::Error> {
        let _guard = self.lock();
        match self {
            Self::Sync(c) => c.query_one(sql, params),
            Self::Writer(c) => c.query_one(sql, params),
            Self::Reader { slot, .. } => runtime().block_on(slot.client.query_one(sql, params)),
        }
    }
    pub fn query_opt<T: ?Sized + tokio_postgres::ToStatement + super::writer_driver::Source>(
        &mut self,
        sql: &T,
        params: &[&(dyn ToSql + Sync)],
    ) -> Result<Option<Row>, postgres::Error> {
        let _guard = self.lock();
        match self {
            Self::Sync(c) => c.query_opt(sql, params),
            Self::Writer(c) => c.query_opt(sql, params),
            Self::Reader { slot, .. } => runtime().block_on(slot.client.query_opt(sql, params)),
        }
    }
    pub fn execute<T: ?Sized + tokio_postgres::ToStatement + super::writer_driver::Source>(
        &mut self,
        sql: &T,
        params: &[&(dyn ToSql + Sync)],
    ) -> Result<u64, postgres::Error> {
        let _guard = self.lock();
        match self {
            Self::Sync(c) => c.execute(sql, params),
            Self::Writer(c) => c.execute(sql, params),
            Self::Reader { slot, .. } => runtime().block_on(slot.client.execute(sql, params)),
        }
    }
    pub fn simple_query(&mut self, sql: &str) -> Result<Vec<SimpleQueryMessage>, postgres::Error> {
        let _guard = self.lock();
        match self {
            Self::Sync(c) => c.simple_query(sql),
            Self::Writer(c) => c.simple_query(sql),
            Self::Reader { slot, .. } => runtime().block_on(slot.client.simple_query(sql)),
        }
    }
    pub fn batch_execute(&mut self, sql: &str) -> Result<(), postgres::Error> {
        let _guard = self.lock();
        match self {
            Self::Sync(c) => c.batch_execute(sql),
            Self::Writer(c) => c.batch_execute(sql),
            Self::Reader { slot, .. } => runtime().block_on(slot.client.batch_execute(sql)),
        }
    }
    pub fn commit_prepared(
        &mut self,
        warning: &Arc<std::sync::atomic::AtomicBool>,
    ) -> Result<(), RuntimeError> {
        match self {
            Self::Sync(c) => super::ownership::commit_prepared(c, warning),
            Self::Writer(c) => {let warning=warning.clone();c.call(move|c|super::ownership::commit_prepared(c,&warning))},
            Self::Reader { slot, .. } => {
                runtime().block_on(slot.client.batch_execute("COMMIT"))?;
                Ok(())
            }
        }
    }
    pub(super) fn commit_synchronous(&mut self,warning:&Arc<std::sync::atomic::AtomicBool>)->Result<(),RuntimeError> {
        // Recovery is a certificate transaction: disable session timeouts in
        // the same message as its uncancellable synchronous COMMIT.
        let warning=warning.clone();
        match self {
            Self::Sync(c)=>super::ownership::commit_synchronous(c,&warning),
            Self::Writer(c)=>c.call(move|c|super::ownership::commit_synchronous(c,&warning)),
            _=>Err(RuntimeError::Store("reader cannot certify a synchronous write".into())),
        }
    }
    pub(super) fn commit_synchronous_head(&mut self,warning:&Arc<std::sync::atomic::AtomicBool>)->Result<super::early_release::Snapshot,RuntimeError> {
        let warning=warning.clone();
        match self {
            Self::Sync(c)=>super::early_release::commit_synchronous_head(c,&warning),
            Self::Writer(c)=>c.call(move|c|super::early_release::commit_synchronous_head(c,&warning)),
            _=>Err(RuntimeError::Store("reader cannot certify a synchronous write".into())),
        }
    }
    pub(super) fn commit_early(&mut self,warning:&Arc<std::sync::atomic::AtomicBool>,token:i64,slot:i64,xid:String)->Result<(String,String),RuntimeError> {
        let warning=warning.clone();
        match self {
            Self::Sync(c)=>super::early_release::commit_marker(c,&warning,token,slot,&xid),
            Self::Writer(c)=>c.call(move|c|super::early_release::commit_marker(c,&warning,token,slot,&xid)),
            _=>Err(RuntimeError::Store("reader cannot commit an early-release batch".into())),
        }
    }
    pub(crate) fn terminate_tagged(&mut self,id:&str,token:i64)->Result<Vec<i32>,RuntimeError> {
        match self {Self::Sync(c)=>super::ownership::terminate(c,None,id,token),Self::Writer(c)=>{let id=id.to_owned();c.call(move|c|super::ownership::terminate(c,None,&id,token))},_=>Err(RuntimeError::StoreOwnership("reader cannot fence writers".into()))}
    }
    pub(crate) fn close_writer(&mut self) {let old=std::mem::replace(self,Self::Writer(super::writer_driver::Driver::empty()));drop(old);}
    pub fn configure(&mut self) -> Result<(), RuntimeError> {
        match self {Self::Sync(c)=>super::literal::configure(c)?,Self::Writer(c)=>c.call(super::literal::configure)?,_=>{}}

        Ok(())
    }
    pub fn fold<T>(
        &mut self,
        statement: &Statement,
        params: &[&(dyn ToSql + Sync)],
        mut total: T,
        mut fold: impl FnMut(T, super::flight::Row) -> Result<T, RuntimeError>,
    ) -> Result<T, RuntimeError> {
        let _guard = self.lock();
        match self {
            Self::Sync(c) => {
                use postgres::fallible_iterator::FallibleIterator;
                let mut rows = c.query_raw(statement, params.iter().copied())?;
                while let Some(row) = rows.next()? {
                    total = fold(total, super::flight::Row::Bind(row))?;
                }
                Ok(total)
            }
            Self::Writer(c) => {
                for row in c.stream(statement, params) {
                    match row? {Some(row)=>total=fold(total,super::flight::Row::Bind(row))?,None=>return Ok(total)}
                }
                Err(RuntimeError::Store("writer row stream lost its terminal result".into()))
            }
            Self::Reader { slot, .. } => runtime().block_on(async {
                let rows = slot
                    .client
                    .query_raw(statement, params.iter().copied())
                    .await?;
                let mut rows = std::pin::pin!(rows);
                while let Some(row) = rows.try_next().await? {
                    total = fold(total, super::flight::Row::Bind(row))?;
                }
                Ok(total)
            }),
        }
    }
    /// Parse+Bind+Execute+Sync in one flight. There is no BEGIN and no grouping
    /// transaction: PostgreSQL takes a new snapshot for each statement. Binary
    /// Bind output uses the same FromSql path as the ordinary driver.
    // @ref LLP 3000.009.001.000.002#22-read-ceilings — retain code only; every Bind/Execute/Sync gets a fresh statement snapshot.
    pub fn independent_cached(
        &self,
        sql: &str,
        params: &[(&(dyn ToSql + Sync), Type)],
        prepared_flight: impl Fn(),
    ) -> Result<Vec<super::flight::Row>, RuntimeError> {
        let Self::Reader { slot, lease, .. } = self else {
            return Err(RuntimeError::Store("pipeline requires a reader".into()));
        };
        if lease.is_some() {
            return Err(RuntimeError::Store("pipeline after snapshot started".into()));
        }
        runtime().block_on(async {
            let _permit = slot.permits.acquire().await
                .map_err(|_| RuntimeError::Store("Postgres pipeline stopped".into()))?;
            let _custody = slot.custody.read().await;
            let statement = {
                let mut cache = slot.prepared.lock().await;
                let hit = cache.iter().position(|(source, statement)| source == sql
                    && statement.params().len() == params.len()
                    && statement.params().iter().zip(params).all(|(a, (_, b))| a == b));
                if let Some(at) = hit {
                    let entry = cache.remove(at).unwrap();
                    let statement = entry.1.clone();
                    cache.push_back(entry);
                    statement
                } else {
                    // The cold preparation is outside the data statement's
                    // snapshot and counted separately. Never replay a Bind.
                    let types: Vec<_> = params.iter().map(|(_, ty)| ty.clone()).collect();
                    prepared_flight();
                    let statement = slot.client.prepare_typed(sql, &types).await?;
                    const PREPARED_STATEMENTS: usize = 32;
                    if cache.len() == PREPARED_STATEMENTS { cache.pop_front(); }
                    cache.push_back((sql.to_owned(), statement.clone()));
                    statement
                }
            };
            let values: Vec<_> = params.iter().map(|(value, _)| *value).collect();
            Ok(slot.client.query(&statement, &values).await?.into_iter()
                .map(super::flight::Row::Bind).collect())
        })
    }

    pub fn independent(
        &self,
        sql: &str,
        params: &[(&(dyn ToSql + Sync), Type)],
    ) -> Result<Vec<super::flight::Row>, RuntimeError> {
        let Self::Reader { slot, lease, .. } = self else {
            return Err(RuntimeError::Store("pipeline requires a reader".into()));
        };
        if lease.is_some() {
            return Err(RuntimeError::Store(
                "pipeline after snapshot started".into(),
            ));
        }
        runtime().block_on(async {
            let _permit = slot
                .permits
                .acquire()
                .await
                .map_err(|_| RuntimeError::Store("Postgres pipeline stopped".into()))?;
            let _custody = slot.custody.read().await;
            // New sockets are pinned, and applications cannot issue SET through
            // this seam. Binary results do not depend on textual float/bytea GUCs.
            Ok(slot
                .client
                .query_typed(sql, params)
                .await?
                .into_iter()
                .map(super::flight::Row::Bind)
                .collect())
        })
    }
}

#[cfg(test)]
#[path = "pipeline_tests.rs"]
mod tests;

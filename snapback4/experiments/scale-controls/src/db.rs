use crate::proxy::Proxy;
use anyhow::{Context, Result};
use hdrhistogram::Histogram;
use serde_json::json;
use std::{
    fs,
    ops::Deref,
    os::unix::fs::PermissionsExt,
    sync::Mutex,
    time::{Duration, Instant},
};
use tokio::sync::{OwnedSemaphorePermit, Semaphore};
use tokio_postgres::{Client, NoTls, Statement};

// @ref LLP 3000.009.001.002#4-controls — one SQL statement, including membership authorization
const SQL: [&str; 5] = [
    "SELECT to_jsonb(m) FROM messages m JOIN memberships a ON a.room=m.room AND a.principal=$2 WHERE m.id=$1",
    "SELECT (SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.at DESC,p.id DESC),'[]') FROM (SELECT * FROM messages WHERE room=$1 ORDER BY at DESC,id DESC LIMIT 20) p) WHERE EXISTS (SELECT 1 FROM memberships WHERE room=$1 AND principal=$2)",
    "SELECT coalesce(jsonb_agg(to_jsonb(p) ORDER BY p.room),'[]') FROM (SELECT m.room,r.total,greatest(0,r.total-m.last_read) unread FROM memberships m JOIN rooms r ON r.id=m.room WHERE m.principal=$1 AND m.room<1024 ORDER BY m.room LIMIT 32) p",
    "UPDATE counters c SET n=n+1 WHERE c.id=$1 AND (c.owner_id=$2 OR (c.owner_id IS NULL AND EXISTS (SELECT 1 FROM memberships a WHERE a.room=c.room AND a.principal=$2))) RETURNING jsonb_build_object('id',id,'n',n)",
    "INSERT INTO messages(room,sender,at,body) SELECT $1,$2,(extract(epoch from clock_timestamp())*1000)::bigint,$3 WHERE EXISTS (SELECT 1 FROM memberships WHERE room=$1 AND principal=$2) RETURNING to_jsonb(messages)",
];

pub async fn connect(index: usize, delay_us: u64, app: &str) -> Result<Client> {
    let path = std::env::var("SCALE_PASSWORD_FILE").context("set SCALE_PASSWORD_FILE")?;
    anyhow::ensure!(
        fs::metadata(&path)?.permissions().mode() & 0o777 == 0o600,
        "password file must be mode 600"
    );
    let password = fs::read_to_string(path)?;
    let ports = std::env::var("SCALE_TUNNEL_PORTS").context("set SCALE_TUNNEL_PORTS")?;
    let port: u16 = ports
        .split(',')
        .nth(index)
        .context("one unique SSH tunnel per connection is required")?
        .parse()?;
    let port = if delay_us == 0 {
        port
    } else {
        Proxy::start(
            ([127, 0, 0, 1], port).into(),
            Duration::from_nanos(delay_us * 500),
        )
        .port
    };
    let mut config = tokio_postgres::Config::new();
    config
        .host("127.0.0.1")
        .port(port)
        .user("scale_app")
        .password(password.trim())
        .dbname(&std::env::var("SCALE_DATABASE")?)
        .application_name(app)
        .connect_timeout(Duration::from_secs(15));
    let (client, connection) = config
        .connect(NoTls)
        .await
        .context("database connection failed")?;
    tokio::spawn(async move {
        let _ = connection.await;
    });
    client
        .batch_execute("SET statement_timeout='5s'; SET lock_timeout='5s';")
        .await?;
    Ok(client)
}

pub struct Db {
    pub client: Client,
    pub st: Vec<Statement>,
}
pub struct Pool {
    available: Mutex<Vec<Db>>,
    permits: std::sync::Arc<Semaphore>,
}
pub struct Lease<'a> {
    db: Option<Db>,
    pool: &'a Pool,
    _permit: OwnedSemaphorePermit,
}
impl Deref for Lease<'_> {
    type Target = Db;
    fn deref(&self) -> &Db {
        self.db.as_ref().unwrap()
    }
}
impl Drop for Lease<'_> {
    fn drop(&mut self) {
        self.pool
            .available
            .lock()
            .unwrap()
            .push(self.db.take().unwrap());
    }
}
impl Pool {
    pub async fn new(size: usize, delay: u64) -> Result<Self> {
        let mut dbs = Vec::new();
        // Bounded startup parallelism avoids SSH MaxStartups pressure.
        for base in (0..size).step_by(8) {
            let mut tasks = Vec::new();
            for i in base..size.min(base + 8) {
                tasks.push(tokio::spawn(async move {
                    // Tunnel 0 is the independent observer/admin connection.
                    let client = connect(i + 1, delay, "sb4scale_raw").await?;
                    let mut st = Vec::new();
                    for sql in SQL {
                        st.push(client.prepare(sql).await?);
                    }
                    Ok::<_, anyhow::Error>(Db { client, st })
                }));
            }
            for task in tasks {
                dbs.push(task.await??);
            }
        }
        Ok(Self {
            available: Mutex::new(dbs),
            permits: std::sync::Arc::new(Semaphore::new(size)),
        })
    }
    pub async fn take(&self) -> Lease<'_> {
        let permit = self.permits.clone().acquire_owned().await.unwrap();
        let db = self.available.lock().unwrap().pop().unwrap();
        Lease {
            db: Some(db),
            pool: self,
            _permit: permit,
        }
    }
}

pub async fn ping(delay: u64, count: usize) -> Result<()> {
    anyhow::ensure!(count > 0, "count must be positive");
    let client = connect(1, delay, "sb4scale_ping").await?;
    let st = client.prepare("SELECT 1::bigint").await?;
    let mut hist = Histogram::<u64>::new(3)?;
    for i in 0..count + 200 {
        let start = Instant::now();
        let value: i64 = client.query_one(&st, &[]).await?.get(0);
        anyhow::ensure!(value == 1, "ping result mismatch");
        if i >= 200 {
            hist.record(start.elapsed().as_nanos().max(1) as u64)?;
        }
    }
    println!(
        "{}",
        json!({"count":count,"added_rtt_us":delay,"p50_us":hist.value_at_quantile(0.5) as f64/1000.,"p99_us":hist.value_at_quantile(0.99) as f64/1000.,"p999_us":hist.value_at_quantile(0.999) as f64/1000.})
    );
    Ok(())
}

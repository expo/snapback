mod auth;
mod convex;
mod db;
mod load;
mod supabase;
// Same per-chunk, per-direction delay implementation used by S0.
#[path = "../../postgres-commit-path/src/proxy.rs"]
#[allow(dead_code)]
#[rustfmt::skip]
mod proxy;

use clap::{Parser, Subcommand};
use serde::{Deserialize, Serialize};
use serde_json::{Value, json};
use std::{net::SocketAddr, sync::Arc};

#[derive(Parser)]
struct Args {
    #[command(subcommand)]
    command: Command,
}
#[derive(Subcommand)]
enum Command {
    Serve {
        #[arg(long, default_value = "127.0.0.1:58080")]
        listen: SocketAddr,
        #[arg(long, default_value_t = 32)]
        pool: usize,
        /// Added RTT; split equally between directions by the S0 proxy.
        #[arg(long, default_value_t = 0)]
        delay_us: u64,
        /// Historical trusted-principal control only: skip token verification.
        #[arg(long)]
        no_token: bool,
    },
    Load(load::Options),
    /// Give each physical PostgREST connection its own independent SSH stream.
    Dispatch {
        #[arg(long, default_value_t = 0)]
        delay_us: u64,
    },
    Ping {
        #[arg(long, default_value_t = 0)]
        delay_us: u64,
        #[arg(long, default_value_t = 3000)]
        count: usize,
    },
}

#[derive(Clone, Serialize, Deserialize, Debug)]
pub struct Operation {
    pub workload: String,
    #[serde(default)]
    pub principal: i64,
    #[serde(default)]
    pub room: i64,
    #[serde(default)]
    pub message: i64,
    #[serde(default)]
    pub counter: i64,
    #[serde(default)]
    pub body: String,
}

struct Service {
    pool: db::Pool,
    auth: Option<auth::Verifier>,
}

async fn op(
    axum::extract::State(service): axum::extract::State<Arc<Service>>,
    headers: axum::http::HeaderMap,
    axum::Json(mut op): axum::Json<Operation>,
) -> Result<axum::Json<Value>, (axum::http::StatusCode, &'static str)> {
    use axum::http::StatusCode;
    if let Some(auth) = &service.auth {
        op.principal = auth
            .principal(&headers)
            .ok_or((StatusCode::UNAUTHORIZED, "invalid or missing token"))?;
    }
    if op.principal < 0 || op.body.len() > 4000 {
        return Err((StatusCode::BAD_REQUEST, "invalid input"));
    }
    let conn = service.pool.take().await;
    let (index, params): (usize, Vec<&(dyn tokio_postgres::types::ToSql + Sync)>) =
        match op.workload.as_str() {
            "W1" => (0, vec![&op.message, &op.principal]),
            "W2" => (1, vec![&op.room, &op.principal]),
            "W3" => (2, vec![&op.principal]),
            "W4" | "W5" => (3, vec![&op.counter, &op.principal]),
            "post" => (4, vec![&op.room, &op.principal, &op.body]),
            _ => return Err((StatusCode::BAD_REQUEST, "unknown workload")),
        };
    match conn.client.query_opt(&conn.st[index], &params).await {
        Ok(Some(row)) => Ok(axum::Json(json!({"data": row.get::<_, Value>(0)}))),
        Ok(None) => Err((StatusCode::NOT_FOUND, "not found or not authorized")),
        Err(_) => Err((StatusCode::INTERNAL_SERVER_ERROR, "database error")),
    }
}

#[tokio::main(worker_threads = 4)]
async fn main() -> anyhow::Result<()> {
    match Args::parse().command {
        Command::Serve {
            listen,
            pool,
            delay_us,
            no_token,
        } => {
            anyhow::ensure!((1..=256).contains(&pool), "pool must be 1..256");
            let pool_size = pool;
            let auth = if no_token {
                None
            } else {
                Some(auth::Verifier::from_env()?)
            };
            let service = Arc::new(Service {
                pool: db::Pool::new(pool, delay_us).await?,
                auth,
            });
            let app = axum::Router::new()
                .route("/op", axum::routing::post(op))
                .route("/health", axum::routing::get(|| async { "ready" }))
                .with_state(service);
            let listener = tokio::net::TcpListener::bind(listen).await?;
            println!(
                "{}",
                json!({"ready":true,"pid":std::process::id(),"pool":pool_size,"delay_us":delay_us,"listen":listen.to_string(),"token_verification":if no_token {"none (trusted principal)"} else {"HS256 per request"}})
            );
            axum::serve(listener, app).await?;
        }
        Command::Load(options) => load::run(options).await?,
        Command::Dispatch { delay_us } => supabase::dispatch(delay_us).await?,
        Command::Ping { delay_us, count } => db::ping(delay_us, count).await?,
    }
    Ok(())
}

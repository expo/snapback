use crate::admin::{AppState, ServerContext};
use crate::local::LocalSnapback;
use crate::server;
use clap::Parser;
use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;
use tokio::net::TcpListener;
use tokio::sync::Mutex;

#[derive(Debug, Parser)]
#[command(about = "Run the Snapback local development server")]
pub struct Args {
    #[arg(long, default_value = "127.0.0.1")]
    pub host: String,

    #[arg(long, default_value_t = 4287)]
    pub port: u16,

    #[arg(long, default_value = ".snapback/dev.sqlite3")]
    pub db: PathBuf,

    #[arg(long)]
    pub memory: bool,
}

pub async fn run_from_env() -> anyhow::Result<()> {
    run(Args::parse()).await
}

pub async fn run(args: Args) -> anyhow::Result<()> {
    let snapback = if args.memory {
        LocalSnapback::memory()?
    } else {
        if let Some(parent) = args.db.parent() {
            std::fs::create_dir_all(parent)?;
        }
        LocalSnapback::open(&args.db)?
    };

    let state = Arc::new(Mutex::new(snapback));
    let addr: SocketAddr = format!("{}:{}", args.host, args.port).parse()?;
    let listener = TcpListener::bind(addr).await?;
    let local_addr = listener.local_addr()?;

    // @ref LLP 0017#serving-model — capture the bound address so the admin API
    // reports host/port/uptime and gates by loopback vs non-loopback.
    let loopback = local_addr.ip().is_loopback();
    let server_context =
        ServerContext::new(local_addr.ip().to_string(), local_addr.port(), loopback);
    let token_configured = server_context.admin_token.is_some();
    let app = server::app(AppState::new(state, server_context));

    println!("snapback listening on http://{local_addr}");
    println!("admin console: http://{local_addr}/_snapback/admin");
    if !args.memory {
        println!("sqlite database: {}", args.db.display());
    }
    // @ref LLP 0017#security-defaults — be explicit about how admin is gated.
    if !loopback && !token_configured {
        println!(
            "admin: DISABLED on this non-loopback bind — set SNAPBACK_ADMIN_TOKEN to enable it"
        );
    } else if token_configured {
        println!("admin: writes require SNAPBACK_ADMIN_TOKEN");
    } else {
        println!("admin: open on loopback (set SNAPBACK_ADMIN_TOKEN to require it for writes)");
    }

    axum::serve(listener, app).await?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::Args;
    use clap::Parser;
    use std::path::PathBuf;

    #[test]
    fn no_argument_defaults_start_local_dev_server() {
        let args = Args::parse_from(["snapback"]);
        assert_eq!(args.host, "127.0.0.1");
        assert_eq!(args.port, 4287);
        assert_eq!(args.db, PathBuf::from(".snapback/dev.sqlite3"));
        assert!(!args.memory);
    }

    #[test]
    fn port_and_storage_can_be_overridden() {
        let args = Args::parse_from([
            "snapback",
            "--host",
            "0.0.0.0",
            "--port",
            "9000",
            "--db",
            "tmp/dev.sqlite3",
            "--memory",
        ]);
        assert_eq!(args.host, "0.0.0.0");
        assert_eq!(args.port, 9000);
        assert_eq!(args.db, PathBuf::from("tmp/dev.sqlite3"));
        assert!(args.memory);
    }
}

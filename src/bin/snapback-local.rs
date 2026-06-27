#[tokio::main]
async fn main() -> anyhow::Result<()> {
    snapback::cli::run_from_env().await
}

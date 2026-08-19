const SNAPBACK_WORKER_STACK_BYTES: usize = 8 * 1024 * 1024;

fn main() -> anyhow::Result<()> {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(SNAPBACK_WORKER_STACK_BYTES)
        .build()?;
    runtime.block_on(run())
}

async fn run() -> anyhow::Result<()> {
    snapback_cli::cli::run_from_env().await
}

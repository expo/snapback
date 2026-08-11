const SNAPBACK_WORKER_STACK_BYTES: usize = 8 * 1024 * 1024;

fn main() {
    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .thread_stack_size(SNAPBACK_WORKER_STACK_BYTES)
        .build()
        .expect("Snapback Tokio runtime must initialize");
    runtime.block_on(run());
}

async fn run() {
    if let Err(error) = snapback::cli::run_from_env().await {
        let (exit_code, envelope) = snapback::cli::project_cli_failure(&error);
        if snapback::cli::json_mode_requested() {
            println!(
                "{}",
                serde_json::to_string_pretty(&envelope).unwrap_or_else(|_| envelope.to_string())
            );
        } else if let Some(snapback_error) = error
            .downcast_ref::<snapback::diagnostic::SnapbackError>()
            .filter(|error| error.diagnostic.code == "SNAPBACK_READY_DESCRIPTOR_REQUIRED")
        {
            eprintln!(
                "{}",
                serde_json::json!({
                    "ok": false,
                    "diagnostics": [&snapback_error.diagnostic],
                })
            );
        } else {
            eprintln!("Error: {error:#}");
        }
        std::process::exit(exit_code);
    }
}

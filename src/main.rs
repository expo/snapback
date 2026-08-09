#[tokio::main]
async fn main() {
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

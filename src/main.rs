#[tokio::main]
async fn main() {
    if let Err(error) = snapback::cli::run_from_env().await {
        if let Some(snapback_error) = error
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
        std::process::exit(1);
    }
}

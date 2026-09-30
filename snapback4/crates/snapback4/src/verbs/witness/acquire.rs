//! Run the packaged SDK witness with this exact native device binary.
use std::{path::PathBuf, process::Command};

pub(super) fn run(args: &[String]) -> i32 {
    let execute = || -> Result<i32, String> {
        let binary = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut candidates = Vec::<PathBuf>::new();
        if let Some(path) = std::env::var_os("SNAPBACK4_ACQUIRE_HELPER") { candidates.push(path.into()); }
        // Installed platform package beside the client, then source checkout.
        for ancestor in binary.ancestors().skip(1) {
            candidates.push(ancestor.join("snapback4/bin/witness-acquire.js"));
            candidates.push(ancestor.join("packages/snapback4/bin/witness-acquire.js"));
        }
        let helper = candidates.into_iter().find(|p| p.is_file())
            .ok_or("install the matching snapback4 client package to run witness acquire")?;
        let mut command = Command::new(crate::project::node());
        command.arg(helper).args(args).env("SNAPBACK4_BIN", binary);
        #[cfg(unix)] {
            use std::os::unix::process::CommandExt;
            Err(command.exec().to_string())
        }
        #[cfg(not(unix))] {
            command.status().map(|s| s.code().unwrap_or(1)).map_err(|e| e.to_string())
        }
    };
    match execute() { Ok(code) => code, Err(e) => { eprintln!("E_WITNESS_PROCESS: {e}"); 1 } }
}

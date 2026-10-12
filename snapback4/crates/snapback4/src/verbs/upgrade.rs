//! Upgrade is package-manager work, run by the matching installed client helper.
use std::{path::PathBuf, process::Command};
pub fn run(args: &[String]) -> i32 {
    let execute = || -> Result<i32, String> {
        let binary = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut candidates = Vec::<PathBuf>::new();
        if let Some(path) = std::env::var_os("SNAPBACK4_UPGRADE_HELPER") { candidates.push(path.into()); }
        for ancestor in binary.ancestors().skip(1) {
            candidates.push(ancestor.join("snapback4/bin/upgrade.js"));
            candidates.push(ancestor.join("packages/snapback4/bin/upgrade.js"));
        }
        let helper = candidates.into_iter().find(|p| p.is_file()).ok_or("install the matching snapback4 package to run upgrade")?;
        Command::new(crate::project::node()).arg(helper).args(args).status().map(|s| s.code().unwrap_or(1)).map_err(|e| e.to_string())
    };
    match execute() { Ok(code) => code, Err(e) => { eprintln!("E_UPGRADE: {e}"); 1 } }
}

//! Run the packaged web witness with this exact native device binary.
use std::{path::PathBuf, process::Command};

pub(super) fn run(args: &[String]) -> i32 {
    let execute = || -> Result<i32, String> {
        let binary = std::env::current_exe().map_err(|e| e.to_string())?;
        let mut candidates = Vec::<PathBuf>::new();
        if let Some(path) = std::env::var_os("SNAPBACK4_WEB_HELPER") { candidates.push(path.into()); }
        // Installed platform package beside the client, then source checkout.
        for ancestor in binary.ancestors().skip(1) {
            candidates.push(ancestor.join("snapback4/bin/witness-web.js"));
            candidates.push(ancestor.join("packages/snapback4/bin/witness-web.js"));
        }
        let helper = candidates.into_iter().find(|p| p.is_file())
            .ok_or("install the matching snapback4 client package to run witness web")?;
        let mut command = Command::new(crate::project::node());
        command.arg(helper).args(args).env("SNAPBACK4_BIN", binary);
        if !args.iter().any(|arg| arg == "--help") {
            if let Some(project) = std::env::current_dir().ok().and_then(|cwd| crate::project::Project::locate(&cwd)) {
                let bound = project.compile().map_err(|e| e.to_string())?;
                if !bound.diagnostics.is_empty() { return Err("schema does not compile; run snapback4 check".into()); }
                let plan: Vec<_> = bound.programs.iter().filter(|p| p.program.kind == snapback4_core::ir::ProgramKind::Mutation && !bound.schema.operations.get(&p.program.name).is_some_and(|facts| facts.ephemeral))
                    .map(|p| serde_json::json!({ "name": p.program.name, "args": p.program.args.iter().map(|(name, kind)| (name.clone(), sample(kind))).collect::<std::collections::BTreeMap<_, _>>() })).collect();
                command.env("SNAPBACK4_WEB_PLAN", serde_json::to_string(&plan).unwrap());
            }
        }
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

fn sample(kind: &snapback4_core::ir::ArgType) -> serde_json::Value {
    use snapback4_core::ir::ArgType;
    use serde_json::{Value, json};
    match kind {
        ArgType::Optional(_) | ArgType::Cursor => Value::Null,
        ArgType::Text { min, max, format } => json!(match format {
            Some(snapback4_core::schema::TextFormat::Url) => "https://example.test/".to_owned(),
            Some(snapback4_core::schema::TextFormat::Handle) => "a".repeat((*min).max(3).min(*max) as usize),
            Some(snapback4_core::schema::TextFormat::Email) => "a@example.test".to_owned(),
            None => "a".repeat((*min).max(1).min(*max) as usize),
        }),
        ArgType::Bool => json!(false),
        ArgType::Int | ArgType::Time => json!(0),
        ArgType::IntRange { min, max } => json!(0i64.clamp(*min, *max)),
        ArgType::Enum { variants } => json!(variants.first()),
        ArgType::Principal => json!({ "witnessViewer": true }),
        _ => json!({ "witnessArgumentRequired": true }),
    }
}

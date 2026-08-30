//! `snapback2 doctor`: prove the binary can certify programs, in one process, and
//! report how long that took. Boot-to-ready is a product number (rules/RULES.md).

use crate::client;
use crate::owner;
use crate::project::CompilerWorker;
use snapback2_core::{Ceilings, Checker, spike_schema};
use std::fs;
use std::path::PathBuf;
use std::process::ExitCode;
use std::time::{Instant, SystemTime, UNIX_EPOCH};

pub fn run(json: bool) -> ExitCode {
    let started = Instant::now();
    let schema = spike_schema();
    let checker = Checker::new(&schema, Ceilings::default());
    let programs = [
        snapback2_core::thread_program(20),
        snapback2_core::send_program(true),
        snapback2_core::mark_read_program(),
        snapback2_core::inbox_program(true),
        snapback2_core::start_dm_program(),
        snapback2_core::board_view_program(),
        snapback2_core::board_summary_program(),
        snapback2_core::ledger_program(),
        snapback2_core::add_expense_program(),
        snapback2_core::ancestors_program(),
        snapback2_core::delete_message_program(),
    ];
    let mut certified = 0usize;
    let mut refused = Vec::new();
    for program in &programs {
        match checker.check(program) {
            Ok(_) => certified += 1,
            Err(e) => refused.push(format!("{}: {}", program.name, e.code)),
        }
    }
    let effects = effects_description();
    let compiler_started = Instant::now();
    let compiler = compiler_proof();
    let compiler_ms = compiler_started.elapsed().as_secs_f64() * 1000.0;
    let compiler_ok = compiler.is_ok();
    let (compiler_path, compiler_error) = match compiler {
        Ok(path) => (Some(path), None),
        Err(error) => (None, Some(error)),
    };
    let owner = owner_state();
    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    let ok = refused.is_empty() && compiler_ok;
    if json {
        println!(
            "{}",
            serde_json::json!({
                "ok": ok,
                "version": super::VERSION,
                "certified": certified,
                "refused": refused,
                "compiler": {
                    "found": compiler_path,
                    "answered": compiler_ok,
                    "ms": compiler_ms,
                    "error": compiler_error,
                },
                "effects": effects,
                "owner": owner,
                "elapsedMs": elapsed_ms,
            })
        );
    } else {
        println!(
            "snapback2 {} · certified {certified}/{} programs · {elapsed_ms:.2} ms",
            super::VERSION,
            programs.len()
        );
        for r in &refused {
            println!("  refused {r}");
        }
        if let Some(path) = compiler_path {
            println!(
                "compiler: {} · answered in {compiler_ms:.2} ms",
                path.display()
            );
        } else {
            println!("compiler: refused {}", compiler_error.unwrap_or_default());
        }
        println!("effects: {effects}");
        if let Some(owner) = owner {
            println!("owner: {owner}");
        } else {
            println!("owner: not running");
        }
    }
    if ok {
        ExitCode::SUCCESS
    } else {
        ExitCode::FAILURE
    }
}

fn compiler_proof() -> Result<PathBuf, String> {
    let root = std::env::temp_dir().join(format!(
        "snapback2-doctor-{}-{}",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos()
    ));
    let authored = root.join("snapback");
    fs::create_dir_all(&authored).map_err(|error| error.to_string())?;
    fs::write(
        authored.join("schema.ts"),
        "import { schema } from 'snapback2'; export default schema({ auth: { password: true, guests: false }, tables: {} });\n",
    )
    .map_err(|error| error.to_string())?;
    let result = (|| {
        let mut worker = CompilerWorker::spawn()
            .map_err(|error| format!("{}: {}", error.code, error.message))?;
        let path = worker.path.clone();
        worker.answers_compile(&root).map_err(|errors| {
            errors
                .into_iter()
                .map(|error| format!("{}: {}", error.code, error.message))
                .collect::<Vec<_>>()
                .join("; ")
        })?;
        Ok(path)
    })();
    let _ = fs::remove_dir_all(root);
    result
}

fn owner_state() -> Option<String> {
    let root = crate::project::locate_root(None).ok()?;
    let info = owner::read_owner(&root)?;
    let response = client::control(&info, "GET", "/control/status", serde_json::json!({})).ok()?;
    (response.status == 200).then(|| response.body.to_string())
}

#[cfg(feature = "effects")]
fn effects_description() -> &'static str {
    snapback2_effects::describe()
}

#[cfg(not(feature = "effects"))]
fn effects_description() -> &'static str {
    "not built (feature `effects`)"
}

//! `snapback2 doctor`: prove the binary can certify programs, in one process, and
//! report how long that took. Boot-to-ready is a product number (rules/RULES.md).

use snapback2_core::{spike_schema, Ceilings, Checker};
use std::process::ExitCode;
use std::time::Instant;

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
    let elapsed_ms = started.elapsed().as_secs_f64() * 1000.0;
    let ok = refused.is_empty();
    if json {
        println!(
            "{{\"ok\":{ok},\"version\":\"{}\",\"certified\":{certified},\"refused\":{},\"effects\":\"{effects}\",\"elapsedMs\":{elapsed_ms:.3}}}",
            super::VERSION,
            serde_json::to_string(&refused).unwrap_or_else(|_| "[]".into()),
        );
    } else {
        println!(
            "snapback2 {} · certified {certified}/{} programs · effects: {effects} · {elapsed_ms:.2} ms",
            super::VERSION,
            programs.len()
        );
        for r in &refused {
            println!("  refused {r}");
        }
    }
    if ok { ExitCode::SUCCESS } else { ExitCode::FAILURE }
}

#[cfg(feature = "effects")]
fn effects_description() -> &'static str {
    snapback2_effects::describe()
}

#[cfg(not(feature = "effects"))]
fn effects_description() -> &'static str {
    "not built (feature `effects`)"
}

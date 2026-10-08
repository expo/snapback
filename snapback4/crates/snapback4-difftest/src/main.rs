use snapback4_difftest::{campaign, oracle::Verdict, shrink};
use std::path::PathBuf;
fn main() {
    match command() {
        Ok(failed) => {
            if failed {
                std::process::exit(1)
            }
        }
        Err(e) => {
            eprintln!("{e}");
            std::process::exit(2)
        }
    }
}
fn command() -> Result<bool, String> {
    let args = std::env::args().skip(1).collect::<Vec<_>>();
    match args.first().map(String::as_str) {
        Some("run" | "run-stores" | "run-devices" | "run-lean") => {
            let mut seed = 0;
            let mut workers = 1;
            let mut cases = 1;
            let mut out = None;
            let mut seconds = None;
            let mut i = 1;
            while i < args.len() {
                let value = args.get(i + 1).ok_or("missing option value")?;
                match args[i].as_str() {
                    "--seed" => seed = value.parse().map_err(|_| "invalid seed")?,
                    "--workers" => workers = value.parse().map_err(|_| "invalid workers")?,
                    "--cases" => cases = value.parse().map_err(|_| "invalid cases")?,
                    "--seconds" => { let n: f64 = value.parse().map_err(|_| "invalid seconds")?; if !n.is_finite() || n <= 0.0 { return Err("--seconds must be finite and positive".into()); } seconds = Some(n); },
                    "--out" => out = Some(PathBuf::from(value)),
                    _ => return Err(format!("unknown option {}", args[i])),
                };
                i += 2;
            }
            if cases == 0 {return Err("--cases must be positive".into());}
            let report = campaign::parallel_command(seed, cases, workers, &out.ok_or("--out is required")?, &std::env::current_exe().map_err(|e|e.to_string())?, &args[0], seconds)?;
            println!("{}", serde_json::to_string_pretty(&report).unwrap());
            Ok(report.failed())
        }
        Some("replay") if args.len() == 2 => match shrink::replay(&PathBuf::from(&args[1]))? {
            Verdict::Pass => {
                println!("pass");
                Ok(false)
            }
            Verdict::Unsupported(reason) => {
                println!("unsupported: {reason}");
                Ok(false)
            }
            Verdict::Named(outcome) => {
                println!("named: {outcome}");
                Ok(false)
            }
            Verdict::Disagree(f) => {
                println!("{}", serde_json::to_string_pretty(&f).unwrap());
                Ok(true)
            }
        },
        _ => Err(
            "usage: snapback4-difftest run|run-stores|run-devices|run-lean --seed <u64> --cases <n> --out <dir> [--workers <n>] [--seconds <n> (stores, devices and lean)] | replay <dir>"
                .into(),
        ),
    }
}

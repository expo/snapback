//! Private JSON-lines data owner. HTTP and compilation belong to the Node owner.
// @ref LLP 2000#13-first-implementation-choices — one SQLite owner, only certified operations on the public route.
mod project;
mod protocol;

use protocol::{Fault, Owner};
use serde_json::{Value as Json, json};
use snapback3_core::{Runtime, Store};
use std::{
    env, fs,
    io::{self, BufRead, Read, Write},
    path::PathBuf,
    process::ExitCode,
};

fn start() -> Result<(), Fault> {
    let args: Vec<String> = env::args().skip(1).collect();
    let flag = |name: &str| args.iter().any(|arg| arg == name);
    let path = |name: &str| {
        args.iter()
            .position(|arg| arg == name)
            .and_then(|i| args.get(i + 1))
            .map(PathBuf::from)
    };
    let project_path =
        path("--project").ok_or_else(|| Fault::input("--project <artifact.json> is required"))?;
    let project_json = serde_json::from_slice(&fs::read(project_path).map_err(Fault::internal)?)
        .map_err(Fault::input)?;
    let generation = project::certify(project_json)?;
    if flag("--check") {
        println!(
            "{}",
            json!({"ok":true,"generation":generation.program_hash(),
            "schemaHash":generation.schema().hash(),"operations":generation.programs().len()})
        );
        return Ok(());
    }
    let database =
        path("--database").ok_or_else(|| Fault::input("--database <path> is required"))?;
    if let Some(parent) = database.parent().filter(|p| !p.as_os_str().is_empty()) {
        fs::create_dir_all(parent).map_err(Fault::internal)?;
    }
    let store = Store::open(&database).map_err(Fault::runtime)?;
    let mut runtime = Runtime::open(store, generation).map_err(Fault::internal)?;
    if let Some(seed_path) = path("--seed") {
        // A restart must never replay an upsert seed over user changes. A failed
        // atomic seed leaves seq zero and can be retried safely on the next boot.
        if runtime.store().commit_seq().map_err(Fault::runtime)? == 0 {
            let mut bytes = Vec::new();
            fs::File::open(seed_path)
                .map_err(Fault::internal)?
                .take(64 * 1024 * 1024 + 1)
                .read_to_end(&mut bytes)
                .map_err(Fault::internal)?;
            if bytes.len() > 64 * 1024 * 1024 {
                return Err(Fault::input(
                    "an administrative seed may contain at most 64 MiB",
                ));
            }
            let seed: Json = serde_json::from_slice(&bytes).map_err(Fault::input)?;
            project::seed(&mut runtime, &seed)?;
        }
    }
    let mut owner = Owner {
        runtime,
        development: flag("--dev"),
    };
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let line = line.map_err(Fault::internal)?;
        if line.trim().is_empty() {
            continue;
        }
        let frame = if line.len() > 8 * 1024 * 1024 {
            json!({"id":null,"error":Fault::input("worker frame exceeds 8 MiB")})
        } else {
            match serde_json::from_str::<Json>(&line) {
                Ok(request) => {
                    let id = request.get("id").cloned().unwrap_or(Json::Null);
                    let result = request
                        .get("method")
                        .and_then(Json::as_str)
                        .ok_or_else(|| Fault::input("method is required"))
                        .and_then(|method| {
                            owner.call(method, request.get("params").unwrap_or(&json!({})))
                        });
                    match result {
                        Ok(result) => json!({"id":id,"result":result}),
                        Err(error) => json!({"id":id,"error":error}),
                    }
                }
                Err(error) => json!({"id":null,"error":Fault::input(error)}),
            }
        };
        serde_json::to_writer(&mut stdout, &frame).map_err(Fault::internal)?;
        stdout.write_all(b"\n").map_err(Fault::internal)?;
        stdout.flush().map_err(Fault::internal)?;
    }
    Ok(())
}

fn main() -> ExitCode {
    match start() {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            eprintln!("{}", json!({"ok":false,"error":error}));
            ExitCode::FAILURE
        }
    }
}

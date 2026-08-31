//! 200 ms authored-source polling and hot successor application.
// @ref LLP 1002#5-the-owner — refused successors keep the last generation serving.

use crate::project::{CompilerWorker, write_build_cache};
use crate::protocol::Refusal;
use crate::writer::{Action, OwnerHandle};
use serde_json::{Value as Json, json};
use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::thread;
use std::time::{Duration, UNIX_EPOCH};

pub fn spawn(
    mut compiler: CompilerWorker,
    root: PathBuf,
    handle: OwnerHandle,
    stop: Arc<AtomicBool>,
) -> thread::JoinHandle<()> {
    thread::Builder::new()
        .name("snapback2-watch".to_owned())
        .spawn(move || {
            let mut known = fingerprint(&root.join("snapback"));
            while !stop.load(Ordering::SeqCst) {
                thread::sleep(Duration::from_millis(200));
                let next = fingerprint(&root.join("snapback"));
                if next == known {
                    continue;
                }
                known = next;
                let _ = handle.call(Action::Applying {
                    generation: "pending".to_owned(),
                });
                match compiler.compile(&root) {
                    Ok(compiled) => {
                        let generation = compiled.generation.hash();
                        if let Err(errors) = compiler.journeys(&root) {
                            refuse(&handle, &root, generation, errors);
                            continue;
                        }
                        let seed = match compiler.seed(&root) {
                            Ok(seed) => seed,
                            Err(errors) => {
                                refuse(&handle, &root, generation, errors);
                                continue;
                            }
                        };
                        if let Err(error) = write_build_cache(&root, &compiled) {
                            refuse(&handle, &root, generation, vec![error]);
                            continue;
                        }
                        let project = compiled.project.clone();
                        match handle.call(Action::Apply {
                            compiled,
                            migration: None,
                            seed: Some(seed),
                        }) {
                            Ok(report) => {
                                log(
                                    &root,
                                    json!({
                                    "successor": "applied",
                                    "generation": generation,
                                    "report": report,
                                    }),
                                );
                            }
                            Err(error) => {
                                if error.code == "E_SUCCESSOR_DESTRUCTIVE" {
                                    write_migration(&root, &generation, &project, &error);
                                }
                                refuse(&handle, &root, generation, vec![error]);
                            }
                        }
                    }
                    Err(errors) => {
                        let generation = handle
                            .call(Action::Status)
                            .ok()
                            .and_then(|status| {
                                status
                                    .get("generation")
                                    .and_then(Json::as_str)
                                    .map(ToOwned::to_owned)
                            })
                            .unwrap_or_else(|| "unknown".to_owned());
                        refuse(&handle, &root, generation, errors);
                    }
                }
            }
        })
        .expect("spawn source watcher")
}

fn refuse(handle: &OwnerHandle, root: &Path, generation: String, errors: Vec<Refusal>) {
    let refusals = if errors.is_empty() {
        vec![Refusal::owner(
            "E_OWNER_WATCH",
            "watch rebuild failed without a refusal",
            "rerun snapback2 check",
        )]
    } else {
        errors
    };
    for error in &refusals {
        log(root, json!({ "successor": "refused", "refusal": error }));
    }
    let _ = handle.call(Action::Refused {
        refusals,
        generation,
    });
}

fn write_migration(
    root: &Path,
    generation: &str,
    project: &snapback2_core::ProjectJson,
    refusal: &Refusal,
) {
    let plan = refusal
        .detail
        .get("plan")
        .cloned()
        .unwrap_or_else(|| json!({ "drops": [] }));
    let path = root
        .join(".snapback")
        .join(format!("migration-{generation}.json"));
    let bytes = serde_json::to_vec_pretty(&json!({
        "generation": generation,
        "project": project,
        "plan": plan,
    }))
    .unwrap_or_default();
    if let Err(error) = fs::write(&path, bytes) {
        log(
            root,
            json!({ "migrationWriteError": error.to_string(), "path": path }),
        );
    } else {
        log(root, json!({ "migration": path }));
    }
}

fn fingerprint(root: &Path) -> BTreeMap<PathBuf, (u128, u64)> {
    let mut files = Vec::new();
    collect_ts(root, &mut files);
    files
        .into_iter()
        .filter_map(|path| {
            let metadata = fs::metadata(&path).ok()?;
            let modified = metadata
                .modified()
                .ok()?
                .duration_since(UNIX_EPOCH)
                .ok()?
                .as_nanos();
            Some((path, (modified, metadata.len())))
        })
        .collect()
}

fn collect_ts(root: &Path, output: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_ts(&path, output);
        } else if path.extension().is_some_and(|extension| extension == "ts") {
            output.push(path);
        }
    }
}

pub fn log(root: &Path, value: Json) {
    let path = root.join(".snapback/log.jsonl");
    match OpenOptions::new().create(true).append(true).open(&path) {
        Ok(mut file) => {
            if let Err(error) = writeln!(file, "{value}") {
                eprintln!(
                    "{}",
                    json!({ "logError": error.to_string(), "path": path, "event": value })
                );
            }
        }
        Err(error) => {
            eprintln!(
                "{}",
                json!({ "logError": error.to_string(), "path": path, "event": value })
            );
        }
    }
}

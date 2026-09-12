//! 200 ms authored-source polling and hot successor application.
// @ref LLP 1002#5-the-owner — refused successors keep the last generation serving.

use crate::project::{SharedCompiler, lock_compiler, stage_build_cache};
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
    compiler: SharedCompiler,
    root: PathBuf,
    handle: OwnerHandle,
    stop: Arc<AtomicBool>,
) -> thread::JoinHandle<()> {
    lock_compiler(&compiler).cancel_on(stop.clone());
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
                // Hold the shared worker only while it compiles; the writer call below
                // must not wait behind an ad hoc compilation and vice versa.
                let mut worker = lock_compiler(&compiler);
                match worker.compile(&root) {
                    Ok(compiled) => {
                        let generation = compiled.generation.hash();
                        if let Err(errors) = worker.journeys(&root) {
                            drop(worker);
                            refuse(&handle, &root, generation, errors);
                            continue;
                        }
                        let seed = match worker.seed(&root) {
                            Ok(seed) => seed,
                            Err(errors) => {
                                drop(worker);
                                refuse(&handle, &root, generation, errors);
                                continue;
                            }
                        };
                        drop(worker);
                        let project = compiled.project.clone();
                        let cache = match stage_build_cache(&root, &compiled) {
                            Ok(cache) => cache,
                            Err(error) => {
                                refuse(&handle, &root, generation, vec![error]);
                                continue;
                            }
                        };
                        match handle.call(Action::Apply {
                            compiled: compiled.clone(),
                            migration: None,
                            seed: Some(seed),
                            cache: Some(cache),
                        }) {
                            Ok(_) => {}
                            Err(mut error) => {
                                if error.code == "E_OWNER_STATE"
                                    && error.detail.get("applied") == Some(&Json::Bool(true))
                                {
                                    log(
                                        &root,
                                        json!({
                                            "successor": "applied",
                                            "generation": generation,
                                            "ownerStateError": error,
                                        }),
                                    );
                                    continue;
                                }
                                if error.code == "E_SUCCESSOR_DESTRUCTIVE" {
                                    write_migration(&root, &generation, &project, &mut error);
                                }
                                refuse(&handle, &root, generation, vec![error]);
                            }
                        }
                    }
                    Err(errors) => {
                        drop(worker);
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
    refusal: &mut Refusal,
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
        refusal.rewrite = Some(format!(
            "cannot write {}: {error}; fix the path and save the sources again; the owner still serves the previous generation",
            path.display(),
        ));
        log(
            root,
            json!({ "migrationWriteError": error.to_string(), "path": path }),
        );
    } else {
        // @ref LLP 1002#5-the-owner — offer an executable repair only after its plan exists.
        let quote = |path: &Path| format!("'{}'", path.to_string_lossy().replace('\'', "'\\''"));
        let command = format!(
            "snapback2 dev --project {} --apply-migration {}",
            quote(root),
            quote(&path),
        );
        refusal.rewrite = Some(format!(
            "check validates sources; the owner still serves the previous generation. Review {}, then apply with: {command}. Inspect the active generation with snapback2 dev --status --project {}",
            path.display(),
            quote(root),
        ));
        refusal.guide = "E_SUCCESSOR_DESTRUCTIVE".to_owned();
        refusal
            .detail
            .insert("migrationFile".to_owned(), json!(path));
        refusal
            .detail
            .insert("applyCommand".to_owned(), json!(command));
        log(root, json!({ "migration": path }));
    }
}

fn fingerprint(root: &Path) -> BTreeMap<PathBuf, (u128, u64)> {
    let mut files = Vec::new();
    collect_authored_sources(root, &mut files);
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

fn collect_authored_sources(root: &Path, output: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let Ok(kind) = entry.file_type() else {
            continue;
        };
        if kind.is_dir() {
            collect_authored_sources(&path, output);
        } else if kind.is_file()
            && path
                .extension()
                .is_some_and(|extension| extension == "ts" || extension == "q")
        {
            output.push(path);
        }
    }
}

// @ref LLP 1021#1-the-lifecycle-is-in-the-log — every writer reports file failures in owner status.
static LOG_ERRORS: std::sync::Mutex<BTreeMap<PathBuf, String>> =
    std::sync::Mutex::new(BTreeMap::new());

pub fn log_status(root: &Path) -> String {
    LOG_ERRORS
        .lock()
        .unwrap_or_else(|e| e.into_inner())
        .get(root)
        .map(|reason| format!("unavailable({reason})"))
        .unwrap_or_else(|| "available".to_owned())
}

pub fn log(root: &Path, value: Json) {
    // Serialize whole lines across the writer, watcher, and signal monitor.
    let mut errors = LOG_ERRORS.lock().unwrap_or_else(|e| e.into_inner());
    let path = root.join(".snapback/log.jsonl");
    let result = OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .and_then(|mut file| file.write_all(format!("{value}\n").as_bytes()));
    match result {
        Ok(()) => {
            errors.remove(root);
        }
        Err(error) => {
            errors.insert(root.to_owned(), error.to_string());
            eprintln!(
                "{}",
                json!({ "logError": error.to_string(), "path": path, "event": value })
            );
        }
    }
}

#[cfg(all(test, unix))]
#[test]
fn source_walk_does_not_follow_symlink_cycles_or_linked_files() {
    use std::os::unix::fs::symlink;
    let root = std::env::temp_dir().join(format!("s2-watch-cycle-{}", std::process::id()));
    fs::create_dir_all(root.join("nested")).unwrap();
    fs::write(root.join("schema.q"), "table t").unwrap();
    fs::write(root.join("nested/effect.ts"), "export {}").unwrap();
    symlink("..", root.join("nested/cycle")).unwrap();
    symlink("schema.q", root.join("linked.q")).unwrap();
    let found = fingerprint(&root);
    assert_eq!(found.len(), 2);
    assert!(found.contains_key(&root.join("schema.q")));
    fs::remove_dir_all(root).unwrap();
}

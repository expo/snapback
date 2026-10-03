//! @ref LLP 3000.030#15 — wrapper custody spans atomic publication and inventory verification.
use super::*;
use std::os::{fd::FromRawFd, unix::fs::{MetadataExt, PermissionsExt}};

// Node opens the file and passes a duplicate as fd 3. flock belongs to that
// shared open-file description: closing this duplicate does NOT unlock Node's
// descriptor. Only the last close (including SIGKILL) releases custody.
fn inherited_lease() -> Result<File> {
    if unsafe { libc::fcntl(3, libc::F_GETFD) } < 0 { return Err(error("E_WITNESS_PROCESS", "missing wrapper export lease descriptor")); }
    let file = unsafe { File::from_raw_fd(3) };
    file.try_lock().map_err(|e| error("E_WITNESS_PROCESS", e))?;
    Ok(file)
}
pub(super) fn lease_command(args: &[String]) -> i32 {
    status((|| {
        let _lease = inherited_lease()?;
        if args.len() != 1 { return Err(error("E_WITNESS_INPUT", "export-lease requires its run directory")); }
        recovery::begin_wrapper(Path::new(&args[0]))
    })())
}
fn status(result: Result<()>) -> i32 {
    match result { Ok(()) => 0, Err(e) => { eprintln!("{e}"); 1 } }
}

fn files(root: &Path) -> Result<Value> {
    fn walk(root: &Path, relative: &Path, rows: &mut Vec<Value>) -> Result<()> {
        let mut entries = fs::read_dir(root.join(relative)).map_err(|e| error("E_WITNESS_PROOF", e))?
            .collect::<std::io::Result<Vec<_>>>().map_err(|e| error("E_WITNESS_PROOF", e))?;
        entries.sort_by_key(|e| e.file_name());
        for entry in entries {
            let rel = relative.join(entry.file_name());
            let meta = fs::symlink_metadata(entry.path()).map_err(|e| error("E_WITNESS_PROOF", e))?;
            let mut row = json!({ "path": rel, "mode": meta.permissions().mode() & 0o777 });
            if meta.is_dir() {
                row["type"] = json!("directory"); rows.push(row); walk(root, &rel, rows)?;
            } else if meta.is_file() {
                let actual = artifact(&entry.path())?;
                row["type"] = json!("file"); row["bytes"] = actual["bytes"].clone(); row["sha256"] = actual["sha256"].clone(); rows.push(row);
            } else {
                // Expo's export has no links. Never verify bytes through a link
                // that another publisher or cleanup could mutate independently.
                return Err(error("E_WITNESS_PROOF", "export contains a link or unsupported file type"));
            }
        }
        Ok(())
    }
    let mut rows = Vec::new(); walk(root, Path::new(""), &mut rows)?; Ok(json!(rows))
}
fn verify(root: &Path, expected: &Value) -> Result<()> {
    if !expected.is_array() || &files(root)? != expected { return Err(error("E_WITNESS_PROOF", "published export inventory differs from the proved paths, sizes or hashes")); }
    Ok(())
}
fn exchange(source: &Path, target: &Path) -> Result<()> {
    use std::ffi::CString;
    use std::os::unix::ffi::OsStrExt;
    let source = CString::new(source.as_os_str().as_bytes()).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    let target = CString::new(target.as_os_str().as_bytes()).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    #[cfg(target_os = "macos")]
    unsafe {
        if libc::renamex_np(source.as_ptr(), target.as_ptr(), libc::RENAME_EXCL) == 0 { return Ok(()); }
        if libc::renamex_np(source.as_ptr(), target.as_ptr(), libc::RENAME_SWAP) == 0 { return Ok(()); }
    }
    // Portable custody regressions use the same atomic operation on Linux;
    // automatic native smoke itself still requires macOS.
    #[cfg(target_os = "linux")]
    unsafe {
        if libc::renameat2(libc::AT_FDCWD, source.as_ptr(), libc::AT_FDCWD, target.as_ptr(), libc::RENAME_NOREPLACE) == 0 { return Ok(()); }
        if libc::renameat2(libc::AT_FDCWD, source.as_ptr(), libc::AT_FDCWD, target.as_ptr(), libc::RENAME_EXCHANGE) == 0 { return Ok(()); }
    }
    Err(error("E_WITNESS_ARTIFACT", std::io::Error::last_os_error()))
}

// Durable intent precedes the namespace switch. Both the run marker (retention)
// and destination marker (next publisher) survive abrupt process termination.
fn inode(path: &Path) -> Result<Value> {
    match fs::symlink_metadata(path) {
        Ok(meta) if meta.is_dir() => Ok(json!([meta.dev(), meta.ino()])),
        Ok(_) => Err(error("E_WITNESS_ARTIFACT", "publication path is not a directory")),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(Value::Null),
        Err(e) => Err(error("E_WITNESS_ARTIFACT", e)),
    }
}
fn save(path: &Path, value: &Value) -> Result<()> {
    let temp = path.with_extension("json.tmp");
    let mut file = File::create(&temp).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    file.write_all(&serde_json::to_vec(value).unwrap()).and_then(|_| file.sync_all()).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    fs::rename(temp, path).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    File::open(path.parent().unwrap()).and_then(|f| f.sync_all()).map_err(|e| error("E_WITNESS_ARTIFACT", e))
}
fn rollback(pending: &Value, source: &Path, target: &Path) -> Result<()> {
    let at_source = inode(source)?; let at_target = inode(target)?;
    if at_source == pending["new"] && at_target == pending["old"] { return Ok(()); }
    if at_target == pending["new"] && at_source == pending["old"] {
        return exchange(target, source);
    }
    Err(error("E_WITNESS_ARTIFACT", format!("interrupted publication identity changed; preserve {} and {} for recovery", source.display(), target.display())))
}
fn clear_pending(marker: &Path, source: &Path) -> Result<()> {
    // Clear the destination first; reconciliation below finishes a stranded run
    // marker. The reverse order could leave a pointer to an already pruned run.
    recovery::remove(marker)?;
    #[cfg(test)] tests::pause(source.parent().unwrap(), "destination-cleared");
    recovery::remove(&source.parent().unwrap().join("publication-pending.json"))
}
fn lock_path(target: &Path) -> Result<PathBuf> {
    Ok(target.parent().ok_or_else(|| error("E_WITNESS_INPUT", "missing export parent"))?.join("artifacts/native-smoke/publication.lock"))
}

// Caller holds both run and export leases. A missing (or newer) destination
// intent means this run never switched, or finished commit/rollback before its
// final marker unlink. Do not inspect/roll back the visible target: a subsequent
// publisher may already own it. Only this run's new tree can remain privately.
pub(super) fn reconcile_orphan(dir: &Path) -> Result<bool> {
    let marker = dir.join("publication-pending.json");
    if !marker.exists() { return Ok(true); }
    let pending: Value = serde_json::from_slice(&fs::read(&marker).map_err(|e| error("E_WITNESS_ARTIFACT", e))?).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    let source = Path::new(pending["source"].as_str().ok_or_else(|| error("E_WITNESS_ARTIFACT", "invalid interrupted publication source"))?);
    let target = Path::new(pending["target"].as_str().ok_or_else(|| error("E_WITNESS_ARTIFACT", "invalid interrupted publication target"))?);
    if source.parent() != Some(dir) || pending["new"].is_null() {
        return Err(error("E_WITNESS_ARTIFACT", "interrupted publication source differs; preserve run for recovery"));
    }
    let lock_path = lock_path(target)?;
    // Never wait with the run/export leases held: a publisher may own the
    // destination lock, and an in-process pruning callback can run under it.
    let Ok(_destination) = preparation::lease(&lock_path) else { return Ok(false); };
    let destination = lock_path.with_file_name("publication-pending.json");
    match fs::read(&destination) {
        Ok(bytes) => {
            let current: Value = serde_json::from_slice(&bytes).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
            if current == pending { return Ok(false); }
            if current["source"] == pending["source"] { return Err(error("E_WITNESS_ARTIFACT", "interrupted publication intents disagree; preserve run for recovery")); }
        }
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => {}
        Err(e) => return Err(error("E_WITNESS_ARTIFACT", e)),
    }
    let remaining = inode(&source)?;
    if !remaining.is_null() && remaining != pending["new"] {
        return Err(error("E_WITNESS_ARTIFACT", "orphan publication identity changed; preserve private tree for recovery"));
    }
    // Idempotent even if killed during recursive removal or after it. Absent
    // source is also the normal verified-commit case, with its receipt retained.
    recovery::remove(&source)?;
    #[cfg(test)] tests::pause(dir, "orphan-removed");
    recovery::remove(&marker)?;
    eprintln!("witness: reconciled orphan publication marker at {}", dir.display());
    Ok(true)
}
fn recover_pending(marker: &Path, target: &Path) -> Result<()> {
    if !marker.exists() { return Ok(()); }
    let pending: Value = serde_json::from_slice(&fs::read(marker).map_err(|e| error("E_WITNESS_ARTIFACT", e))?).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    let source = Path::new(pending["source"].as_str().ok_or_else(|| error("E_WITNESS_ARTIFACT", "invalid interrupted publication source"))?);
    if pending["target"].as_str() != target.to_str() || pending["new"].is_null() { return Err(error("E_WITNESS_ARTIFACT", "interrupted publication targets differ; manual recovery required")); }
    let dir = source.parent().ok_or_else(|| error("E_WITNESS_ARTIFACT", "invalid interrupted publication directory"))?;
    let _custody = preparation::lease(&dir.join("export.lock")).map_err(|_| error("E_WITNESS_PROCESS", format!("interrupted publication still has wrapper custody; preserved {}", source.display())))?;
    let receipt: Value = fs::read(dir.join("publication.json")).ok().and_then(|bytes| serde_json::from_slice(&bytes).ok()).unwrap_or(Value::Null);
    if receipt["transaction"] == pending && inode(target)? == pending["new"] {
        recovery::remove(source)?;
    } else {
        rollback(&pending, source, target)?;
        eprintln!("witness: restored previous export after interrupted publication at {}", source.display());
    }
    clear_pending(marker, source)
}
fn publish(source: &Path, target: &Path, expected: &Value, proof_hash: &Value, after_exchange: impl FnOnce()) -> Result<()> {
    // Serializes recovery, publication, receipt and displaced-tree removal.
    // Never unlink this lock: waiters must share the same inode.
    let lock_path = lock_path(target)?;
    fs::create_dir_all(lock_path.parent().unwrap()).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    let lock = OpenOptions::new().read(true).write(true).create(true).truncate(false)
        .open(&lock_path).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    lock.lock().map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    let marker = lock_path.with_file_name("publication-pending.json");
    recover_pending(&marker, target)?;
    verify(source, expected)?;
    let dir = source.parent().unwrap();
    let pending = json!({ "source": source, "target": target, "new": inode(source)?, "old": inode(target)? });
    recovery::remove(&dir.join("publication.json"))?;
    save(&dir.join("publication-pending.json"), &pending)?;
    #[cfg(test)] tests::pause(dir, "run-intent-saved");
    save(&marker, &pending)?;
    let result = (|| {
        exchange(source, target)?;
        after_exchange();
        verify(target, expected)?;
        save(&dir.join("publication.json"), &json!({ "verifiedAt": now(), "source": source, "target": target, "proofSha256": proof_hash, "files": expected, "transaction": pending }))
    })();
    if let Err(e) = result {
        rollback(&pending, source, target)?;
        clear_pending(&marker, source)?;
        return Err(e);
    }
    recovery::remove(source)?;
    clear_pending(&marker, source)
}
pub(super) fn command(args: &[String]) -> i32 {
    status((|| {
        if args.len() != 2 && !(args.len() == 3 && args[2] == "--environment-skip") {
            return Err(error("E_WITNESS_INPUT", "export-publish requires private and visible export directories"));
        }
        let source = Path::new(&args[0]); let target = Path::new(&args[1]);
        let dir = source.parent().ok_or_else(|| error("E_WITNESS_INPUT", "missing run directory"))?;
        let custody = inherited_lease()?;
        let held = custody.metadata().map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        let named = fs::metadata(dir.join("export.lock")).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        if held.dev() != named.dev() || held.ino() != named.ino() { return Err(error("E_WITNESS_PROCESS", "wrapper lease does not own this export")); }
        let (expected, proof_hash) = if args.len() == 3 {
            (files(source)?, Value::Null)
        } else {
            let proof_path = dir.join("proof.json");
            let receipt: Value = serde_json::from_slice(&fs::read(dir.join("smoke-ios-run.json")).map_err(|e| error("E_WITNESS_PROOF", e))?).map_err(|e| error("E_WITNESS_PROOF", e))?;
            let proof: Value = serde_json::from_slice(&fs::read(&proof_path).map_err(|e| error("E_WITNESS_PROOF", e))?).map_err(|e| error("E_WITNESS_PROOF", e))?;
            let hash = artifact(&proof_path)?["sha256"].clone();
            if receipt["exitStatus"] != 0 || receipt["proof"]["sha256"] != hash { return Err(error("E_WITNESS_PROOF", "export proof differs from the successful smoke receipt")); }
            (proof["exported"]["inventory"]["files"].clone(), hash)
        };
        publish(source, target, &expected, &proof_hash, || {})?;
        Ok(())
    })())
}

#[cfg(test)]
mod tests {
    use super::*;
    pub(super) fn pause(dir: &Path, point: &str) {
        if std::env::var("SB4_PUBLICATION_PAUSE").as_deref() != Ok(point) { return; }
        fs::write(dir.join(format!("paused-{point}")), point).unwrap();
        loop { sleep(Duration::from_secs(1)); }
    }
    fn fixture(label: &str) -> (PathBuf, PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("sb4-publish-{label}-{}-{}", std::process::id(), now()));
        let dir = root.join("runs/1-123"); let source = dir.join("export");
        fs::create_dir_all(&source).unwrap(); fs::create_dir(root.join("dist")).unwrap();
        fs::write(root.join("dist/old"), "old export").unwrap();
        fs::write(source.join("bundle"), "proved bundle").unwrap();
        fs::write(dir.join("live.json"), serde_json::to_vec(&json!({ "owner": null, "wrapper": recovery::identity(std::process::id()), "children": {} })).unwrap()).unwrap();
        for i in 2..=6 {
            let newer = root.join(format!("runs/{i}-123")); fs::create_dir_all(&newer).unwrap();
            fs::write(newer.join("finished.json"), "{}").unwrap();
        }
        (root, dir, source)
    }
    #[test]
    fn witness_pruning_cannot_delete_through_an_export_during_atomic_publication() {
        let (root, dir, source) = fixture("race");
        // Match the review's large tree and exercise both sides of exchange.
        for i in 0..10_000 { fs::write(source.join(format!("asset-{i}")), "pixels").unwrap(); }
        let expected = files(&source).unwrap();
        let _lease = preparation::lease(&dir.join("export.lock")).unwrap();
        let journal = fs::read(dir.join("live.json")).unwrap();
        recovery::cleanup(&root.join("runs"), None).unwrap();
        publish(&source, &root.join("dist"), &expected, &Value::Null, || {
            recovery::cleanup(&root.join("runs"), None).unwrap();
            assert_eq!(fs::read(dir.join("live.json")).unwrap(), journal);
            assert!(!dir.join("finished.json").exists());
            assert_eq!(fs::read_dir(root.join("dist")).unwrap().count(), 10_001);
        }).unwrap();
        verify(&root.join("dist"), &expected).unwrap();
        assert!(!source.exists()); fs::remove_dir_all(root).unwrap();
    }
    #[test]
    fn witness_publication_detects_tampering_before_and_after_exchange() {
        for phase in ["before", "after"] {
            for change in ["hash", "size", "path", "extra"] {
                let (root, dir, source) = fixture(&format!("{phase}-{change}"));
                let _lease = preparation::lease(&dir.join("export.lock")).unwrap();
                let expected = files(&source).unwrap();
                let tamper = |where_: &Path| match change {
                    "hash" => fs::write(where_.join("bundle"), "PROVED BUNDLE").unwrap(),
                    "size" => fs::write(where_.join("bundle"), "short").unwrap(),
                    "path" => fs::rename(where_.join("bundle"), where_.join("renamed")).unwrap(),
                    _ => fs::write(where_.join("extra"), "added").unwrap(),
                };
                if phase == "before" { tamper(&source); }
                let result = publish(&source, &root.join("dist"), &expected, &Value::Null, || { if phase == "after" { tamper(&root.join("dist")); } });
                assert!(result.unwrap_err().starts_with("E_WITNESS_PROOF:"));
                assert_eq!(fs::read_to_string(root.join("dist/old")).unwrap(), "old export");
                fs::remove_dir_all(root).unwrap();
            }
        }
    }
    // A subprocess test fixture pauses at the actual post-exchange boundary.
    // No pause switch or test hook is reachable from the shipped CLI.
    #[test]
    fn witness_publication_process_fixture() {
        let Ok(root) = std::env::var("SB4_PUBLICATION_FIXTURE") else { return; };
        let root = PathBuf::from(root);
        let label = std::env::var("SB4_PUBLICATION_RUN").unwrap();
        let dir = root.join("runs").join(&label); let source = dir.join("export");
        let action = std::env::var("SB4_PUBLICATION_ACTION").unwrap_or_default();
        if action == "cleanup" { recovery::cleanup(&root.join("runs"), None).unwrap(); return; }
        let _lease = preparation::lease(&dir.join("export.lock")).unwrap();
        let record = json!({ "owner": null, "wrapper": recovery::identity(std::process::id()), "children": {} });
        fs::write(dir.join("live.json"), serde_json::to_vec(&record).unwrap()).unwrap();
        let expected: Value = serde_json::from_slice(&fs::read(dir.join("expected.json")).unwrap()).unwrap();
        fs::write(dir.join("ready"), "ready").unwrap();
        let result = publish(&source, &root.join("dist"), &expected, &Value::Null, || {
            fs::write(dir.join("exchanged"), "exchanged").unwrap();
            if action == "rollback" { fs::write(root.join("dist/bundle"), "rejected bytes").unwrap(); }
            if label == "1-123" && action.is_empty() { loop { sleep(Duration::from_secs(1)); } }
        });
        if action == "rollback" { assert!(result.is_err()); } else { result.unwrap(); }
        fs::write(dir.join("verified"), "verified").unwrap();
    }
    #[test]
    fn witness_two_wrappers_killed_after_exchange_leave_only_survivors_verified_export() {
        let (root, dir, source) = fixture("killed");
        // Don't make the survivor a completed retention fixture.
        let survivor = root.join("runs/9-123"); fs::create_dir_all(survivor.join("export")).unwrap();
        fs::write(survivor.join("export/survivor-only"), "survivor bytes").unwrap();
        for d in [&dir, &survivor] { fs::write(d.join("expected.json"), serde_json::to_vec(&files(&d.join("export")).unwrap()).unwrap()).unwrap(); }
        let start = |label: &str| Owned::spawn(Command::new(std::env::current_exe().unwrap())
            .args(["--exact", "verbs::witness::publication::tests::witness_publication_process_fixture", "--nocapture"])
            .env("SB4_PUBLICATION_FIXTURE", &root).env("SB4_PUBLICATION_RUN", label)
            .stdout(Stdio::null()).stderr(Stdio::inherit())).unwrap();
        let await_file = |file: &Path| {
            let end = Instant::now() + Duration::from_secs(15);
            while !file.exists() && Instant::now() < end { sleep(Duration::from_millis(10)); }
            assert!(file.exists(), "missing {}", file.display());
        };
        let mut killed = start("1-123"); await_file(&dir.join("exchanged"));
        let mut live = start("9-123"); await_file(&survivor.join("ready"));
        assert!(!survivor.join("exchanged").exists(), "second publisher must wait for verification lock");
        recovery::cleanup(&root.join("runs"), None).unwrap();
        assert!(!dir.join("finished.json").exists());
        killed.stop(libc::SIGKILL).unwrap();
        // Recovery races the now-unblocked survivor. Neither a failed writer's
        // swapped old tree nor the currently visible dist is shared custody.
        recovery::cleanup(&root.join("runs"), Some(&dir)).unwrap();
        await_file(&survivor.join("verified"));
        assert!(live.0.wait().unwrap().success());
        recovery::cleanup(&root.join("runs"), Some(&dir)).unwrap();
        assert!(dir.join("finished.json").exists());
        assert!(!dir.join("publication-pending.json").exists());
        let _ = source;
        let expected: Value = serde_json::from_slice(&fs::read(survivor.join("expected.json")).unwrap()).unwrap();
        verify(&root.join("dist"), &expected).unwrap();
        assert_eq!(fs::read_dir(root.join("dist")).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn witness_orphan_markers_recover_after_repeated_sigkill_and_retain_then_prune() {
        for action in ["commit", "rollback", "intent"] {
            for absent in [false, true] {
                let (root, dir, source) = fixture(&format!("orphan-{action}-{absent}"));
                if absent { fs::remove_dir_all(root.join("dist")).unwrap(); }
                fs::write(dir.join("expected.json"), serde_json::to_vec(&files(&source).unwrap()).unwrap()).unwrap();
                let start = |operation: &str, point: &str| Owned::spawn(Command::new(std::env::current_exe().unwrap())
                    .args(["--exact", "verbs::witness::publication::tests::witness_publication_process_fixture", "--nocapture"])
                    .env("SB4_PUBLICATION_FIXTURE", &root).env("SB4_PUBLICATION_RUN", "1-123")
                    .env("SB4_PUBLICATION_ACTION", operation).env("SB4_PUBLICATION_PAUSE", point)
                    .stdout(Stdio::null()).stderr(Stdio::inherit())).unwrap();
                let kill_at = |operation: &str, point: &str| {
                    let paused = dir.join(format!("paused-{point}"));
                    recovery::remove(&paused).unwrap();
                    let mut child = start(operation, point);
                    let end = Instant::now() + Duration::from_secs(15);
                    while !paused.exists() && Instant::now() < end { sleep(Duration::from_millis(10)); }
                    assert!(paused.exists(), "{action}/{absent}: missing {point}");
                    child.stop(libc::SIGKILL).unwrap();
                };
                kill_at(action, if action == "intent" { "run-intent-saved" } else { "destination-cleared" });
                assert!(dir.join("publication-pending.json").exists());
                assert!(!root.join("artifacts/native-smoke/publication-pending.json").exists());
                if action == "commit" {
                    assert_eq!(fs::read_to_string(root.join("dist/bundle")).unwrap(), "proved bundle");
                    assert!(dir.join("publication.json").exists()); assert!(!source.exists());
                } else {
                    assert_eq!(root.join("dist").exists(), !absent);
                    if !absent { assert_eq!(fs::read_to_string(root.join("dist/old")).unwrap(), "old export"); }
                    assert!(source.exists()); assert!(!dir.join("publication.json").exists());
                }
                // A later publisher can replace dist before orphan reconciliation.
                // Recovery must not roll that successful export back.
                let later = root.join("runs/9-123"); fs::create_dir_all(later.join("export")).unwrap();
                fs::write(later.join("export/later"), "later verified export").unwrap();
                {
                    let _lease = preparation::lease(&later.join("export.lock")).unwrap();
                    publish(&later.join("export"), &root.join("dist"), &files(&later.join("export")).unwrap(), &Value::Null, || {}).unwrap();
                }
                // Exercise both recovery paths: unfinished and prematurely finished.
                if absent { fs::write(dir.join("finished.json"), "{}").unwrap(); }
                for _ in 0..2 {
                    kill_at("cleanup", "orphan-removed");
                    assert!(dir.join("publication-pending.json").exists());
                    assert!(!source.exists());
                    assert_eq!(fs::read_to_string(root.join("dist/later")).unwrap(), "later verified export");
                }
                recovery::cleanup(&root.join("runs"), None).unwrap();
                recovery::cleanup(&root.join("runs"), None).unwrap();
                assert!(dir.join("finished.json").exists());
                assert!(dir.join("retention.json").exists());
                assert!(!dir.join("publication-pending.json").exists());
                assert!(!source.exists());
                assert_eq!(dir.join("publication.json.gz").exists(), action == "commit");
                for i in 10..=40 {
                    let newer = root.join(format!("runs/{i}-123")); fs::create_dir_all(&newer).unwrap();
                    fs::write(newer.join("finished.json"), "{}").unwrap();
                }
                recovery::cleanup(&root.join("runs"), None).unwrap();
                assert!(!dir.exists(), "orphan is eligible for ordinary oldest-run pruning");
                assert_eq!(fs::read_to_string(root.join("dist/later")).unwrap(), "later verified export");
                eprintln!("orphan SIGKILL control passed: {action}, destination initially absent={absent}");
                fs::remove_dir_all(root).unwrap();
            }
        }
    }

    #[test]
    fn witness_orphan_reconciliation_requires_all_leases_and_preserves_changed_identity() {
        let (root, dir, source) = fixture("orphan-locks");
        let target = root.join("dist");
        let pending = json!({ "source": source, "target": target, "new": inode(&source).unwrap(), "old": inode(&target).unwrap() });
        save(&dir.join("publication-pending.json"), &pending).unwrap();
        for path in [dir.join("run.lock"), dir.join("export.lock"), lock_path(&target).unwrap()] {
            let held = preparation::lease(&path).unwrap();
            recovery::cleanup(&root.join("runs"), None).unwrap();
            assert!(source.exists()); assert!(dir.join("publication-pending.json").exists());
            drop(held);
        }
        let destination = lock_path(&target).unwrap().with_file_name("publication-pending.json");
        save(&destination, &pending).unwrap();
        recovery::cleanup(&root.join("runs"), None).unwrap();
        assert!(source.exists()); assert!(dir.join("publication-pending.json").exists());
        // A different run's outstanding destination intent must survive intact.
        let different = json!({ "source": root.join("runs/99-123/export"), "target": target, "new": [1, 2] });
        save(&destination, &different).unwrap();
        fs::rename(&source, dir.join("saved-new")).unwrap();
        fs::create_dir(&source).unwrap();
        assert!(recovery::cleanup(&root.join("runs"), None).unwrap_err().contains("identity changed"));
        assert!(dir.join("publication-pending.json").exists());
        fs::remove_dir(&source).unwrap(); fs::rename(dir.join("saved-new"), &source).unwrap();
        recovery::cleanup(&root.join("runs"), None).unwrap();
        assert!(!source.exists()); assert!(!dir.join("publication-pending.json").exists());
        assert_eq!(serde_json::from_slice::<Value>(&fs::read(destination).unwrap()).unwrap(), different);
        assert_eq!(fs::read_to_string(target.join("old")).unwrap(), "old export");
        fs::remove_dir_all(root).unwrap();
    }
}

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

fn publish(source: &Path, target: &Path, expected: &Value, after_exchange: impl FnOnce()) -> Result<()> {
    // Serializes publishers through verification and displaced-tree removal.
    // Never unlink this lock: waiters must share the same inode.
    let lock_path = target.parent().ok_or_else(|| error("E_WITNESS_INPUT", "missing export parent"))?.join("artifacts/native-smoke/publication.lock");
    fs::create_dir_all(lock_path.parent().unwrap()).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    let lock = OpenOptions::new().read(true).write(true).create(true).truncate(false)
        .open(lock_path).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    lock.lock().map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
    verify(source, expected)?;
    exchange(source, target)?;
    after_exchange();
    verify(target, expected)?;
    recovery::remove(source)?;
    Ok(())
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
        publish(source, target, &expected, || {})?;
        fs::write(dir.join("publication.json"), serde_json::to_vec_pretty(&json!({ "verifiedAt": now(), "target": target, "proofSha256": proof_hash, "files": expected })).unwrap()).map_err(|e| error("E_WITNESS_ARTIFACT", e))?;
        Ok(())
    })())
}

#[cfg(test)]
mod tests {
    use super::*;
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
        publish(&source, &root.join("dist"), &expected, || {
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
                let result = publish(&source, &root.join("dist"), &expected, || { if phase == "after" { tamper(&root.join("dist")); } });
                assert!(result.unwrap_err().starts_with("E_WITNESS_PROOF:"));
                if phase == "before" { assert!(root.join("dist/old").exists()); }
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
        let _lease = preparation::lease(&dir.join("export.lock")).unwrap();
        let record = json!({ "owner": null, "wrapper": recovery::identity(std::process::id()), "children": {} });
        fs::write(dir.join("live.json"), serde_json::to_vec(&record).unwrap()).unwrap();
        let expected: Value = serde_json::from_slice(&fs::read(dir.join("expected.json")).unwrap()).unwrap();
        fs::write(dir.join("ready"), "ready").unwrap();
        publish(&source, &root.join("dist"), &expected, || {
            fs::write(dir.join("exchanged"), "exchanged").unwrap();
            if label == "1-123" { loop { sleep(Duration::from_secs(1)); } }
        }).unwrap();
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
        assert!(dir.join("finished.json").exists());
        assert!(!source.exists());
        let expected: Value = serde_json::from_slice(&fs::read(survivor.join("expected.json")).unwrap()).unwrap();
        verify(&root.join("dist"), &expected).unwrap();
        assert_eq!(fs::read_dir(root.join("dist")).unwrap().count(), 1);
        fs::remove_dir_all(root).unwrap();
    }
}

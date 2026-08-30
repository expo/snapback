#![allow(dead_code)]

use serde_json::Value as Json;
use std::collections::hash_map::DefaultHasher;
use std::fs::{self, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};
use std::sync::atomic::{AtomicU64, Ordering};
use std::thread;
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

pub struct Project {
    pub path: PathBuf,
}

impl Project {
    pub fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let path = std::env::temp_dir().join(format!(
            "snapback2-b2-test-{}-{stamp}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed),
        ));
        fs::create_dir_all(&path).expect("create temporary project");
        Self { path }
    }

    pub fn init(&self, template: &str, client: &str) -> Output {
        command()
            .args([
                "init",
                self.path.to_str().unwrap(),
                "--template",
                template,
                "--client",
                client,
                "--json",
            ])
            .output()
            .expect("run init")
    }

    pub fn run(&self, args: &[&str]) -> Output {
        let mut command = command();
        command.args(args).arg("--project").arg(&self.path);
        command.output().expect("run snapback2")
    }

    pub fn latest_receipt(&self) -> Json {
        let mut receipts = fs::read_dir(self.path.join(".snapback/receipts"))
            .expect("receipt directory")
            .filter_map(Result::ok)
            .map(|entry| entry.path())
            .filter(|path| path.extension().and_then(|value| value.to_str()) == Some("json"))
            .collect::<Vec<_>>();
        receipts.sort();
        serde_json::from_slice(&fs::read(receipts.last().expect("receipt")).expect("read receipt"))
            .expect("parse receipt")
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

pub struct OwnerGuard<'a> {
    project: &'a Project,
}

impl<'a> OwnerGuard<'a> {
    pub fn start(project: &'a Project) -> Self {
        let output = project.run(&["dev"]);
        assert!(
            output.status.success()
                && String::from_utf8_lossy(&output.stdout).contains("SNAPBACK_URL="),
            "dev failed: {}{}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        );
        Self { project }
    }
}

impl Drop for OwnerGuard<'_> {
    fn drop(&mut self) {
        let _ = self.project.run(&["dev", "--stop", "--json"]);
    }
}

pub fn json_stdout(output: &Output) -> Json {
    serde_json::from_slice(&output.stdout).unwrap_or_else(|error| {
        panic!(
            "invalid JSON stdout: {error}: {}\nstderr: {}",
            String::from_utf8_lossy(&output.stdout),
            String::from_utf8_lossy(&output.stderr)
        )
    })
}

pub fn snapshot(root: &Path) -> Vec<(PathBuf, Vec<u8>)> {
    fn walk(root: &Path, path: &Path, output: &mut Vec<(PathBuf, Vec<u8>)>) {
        let mut entries = fs::read_dir(path)
            .expect("read snapshot directory")
            .filter_map(Result::ok)
            .collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            if entry.path().is_dir() {
                walk(root, &entry.path(), output);
            } else {
                output.push((
                    entry.path().strip_prefix(root).unwrap().to_path_buf(),
                    fs::read(entry.path()).expect("snapshot file"),
                ));
            }
        }
    }
    let mut output = Vec::new();
    walk(root, root, &mut output);
    output
}

fn command() -> Command {
    ensure_package();
    let root = workspace();
    let dist = root.join("packages/snapback2/dist");
    let mut command = Command::new(env!("CARGO_BIN_EXE_snapback2"));
    command
        .env("SNAPBACK2_COMPILER", dist.join("compiler.mjs"))
        .env("SNAPBACK2_GUIDE", dist.join("guide"))
        .env("SNAPBACK2_TEMPLATES", dist.join("templates"))
        .env("SNAPBACK2_TEST_RUNNER", dist.join("test-runner.mjs"));
    command
}

fn ensure_package() {
    let root = workspace();
    let target = root.join("target");
    fs::create_dir_all(&target).expect("target directory");
    let marker = target.join("b2-package-build.marker");
    let lock = target.join("b2-package-build.lock");
    let fingerprint = package_fingerprint(&root);
    let ready = || {
        fs::read_to_string(&marker).ok().as_deref() == Some(&fingerprint)
            && root
                .join("packages/snapback2/dist/test-runner.mjs")
                .is_file()
            && root
                .join("packages/snapback2/dist/templates/chat/snapback/schema.ts")
                .is_file()
    };
    if ready() {
        return;
    }
    let started = Instant::now();
    loop {
        match OpenOptions::new().write(true).create_new(true).open(&lock) {
            Ok(mut file) => {
                let _ = writeln!(file, "{}", std::process::id());
                if !ready() {
                    let output = Command::new("node")
                        .arg("build.mjs")
                        .current_dir(root.join("packages/snapback2"))
                        .output()
                        .expect("build package");
                    assert!(
                        output.status.success(),
                        "package build failed: {}{}",
                        String::from_utf8_lossy(&output.stdout),
                        String::from_utf8_lossy(&output.stderr)
                    );
                    fs::write(&marker, &fingerprint).expect("write package marker");
                }
                let _ = fs::remove_file(&lock);
                return;
            }
            Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                assert!(
                    started.elapsed() < Duration::from_secs(30),
                    "timed out waiting for package build lock"
                );
                thread::sleep(Duration::from_millis(25));
                if ready() {
                    return;
                }
            }
            Err(error) => panic!("cannot create package build lock: {error}"),
        }
    }
}

fn package_fingerprint(root: &Path) -> String {
    fn hash_tree(path: &Path, hasher: &mut DefaultHasher) {
        let mut entries = fs::read_dir(path)
            .into_iter()
            .flatten()
            .filter_map(Result::ok)
            .filter(|entry| entry.file_name() != "dist")
            .collect::<Vec<_>>();
        entries.sort_by_key(|entry| entry.file_name());
        for entry in entries {
            entry.path().hash(hasher);
            if entry.path().is_dir() {
                hash_tree(&entry.path(), hasher);
            } else if let Ok(metadata) = entry.metadata() {
                metadata.len().hash(hasher);
                metadata.modified().ok().hash(hasher);
            }
        }
    }
    let mut hasher = DefaultHasher::new();
    hash_tree(&root.join("packages/snapback2"), &mut hasher);
    hash_tree(&root.join("packages/compiler/src"), &mut hasher);
    format!("{:016x}", hasher.finish())
}

fn workspace() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

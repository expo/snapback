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
    package: PathBuf,
}

impl Project {
    pub fn new() -> Self {
        static NEXT: AtomicU64 = AtomicU64::new(0);
        let stamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_nanos();
        let base = std::env::temp_dir().join(format!(
            "snapback2-b2-test-{}-{stamp}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed),
        ));
        let path = base.join("project");
        let package = base.join("package");
        fs::create_dir_all(&path).expect("create temporary project");
        copy_package_fixture(&package);
        let package = package
            .canonicalize()
            .expect("canonicalize isolated package fixture");
        Self { path, package }
    }

    pub fn init(&self, template: &str, client: &str) -> Output {
        self.command()
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

    pub fn replace_backend_with_built_template(&self, template: &str) {
        let backend = self.path.join("snapback");
        fs::remove_dir_all(&backend).expect("remove initialized backend");
        copy_tree(
            &self
                .package
                .join("dist/templates")
                .join(template)
                .join("snapback"),
            &backend,
        );
    }

    pub fn run(&self, args: &[&str]) -> Output {
        let mut command = self.command();
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

    pub fn package_snapshot_root(&self) -> &Path {
        &self.package
    }

    pub fn package_consumer_paths(&self) -> Vec<(&'static str, PathBuf)> {
        package_consumer_paths(&self.package)
    }

    pub fn package_dist_snapshots(&self) -> (Vec<(PathBuf, Vec<u8>)>, Vec<(PathBuf, Vec<u8>)>) {
        package_dist_snapshots(&self.package)
    }

    fn command(&self) -> Command {
        package_command(&self.package)
    }
}

impl Drop for Project {
    fn drop(&mut self) {
        if let Some(base) = self.path.parent() {
            let _ = fs::remove_dir_all(base);
        }
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

fn package_command(package: &Path) -> Command {
    let mut command = Command::new(env!("CARGO_BIN_EXE_snapback2"));
    for (name, path) in package_consumer_paths(package) {
        command.env(name, path);
    }
    command
}

fn package_consumer_paths(package: &Path) -> Vec<(&'static str, PathBuf)> {
    let dist = package.join("dist");
    vec![
        ("SNAPBACK2_COMPILER", dist.join("compiler.mjs")),
        ("SNAPBACK2_GUIDE", dist.join("guide")),
        ("SNAPBACK2_TEMPLATES", dist.join("templates")),
        ("SNAPBACK2_TEST_RUNNER", dist.join("test-runner.mjs")),
    ]
}

pub fn shared_package_dist() -> PathBuf {
    workspace()
        .canonicalize()
        .expect("canonicalize workspace")
        .join("packages/snapback2/dist")
}

pub fn package_dist_snapshots(
    package: &Path,
) -> (Vec<(PathBuf, Vec<u8>)>, Vec<(PathBuf, Vec<u8>)>) {
    let root = workspace();
    let _lock = PackageLock::acquire(&root);
    let shared = snapshot(&root.join("packages/snapback2/dist"));
    let private = snapshot(&package.join("dist"));
    (shared, private)
}

fn ensure_package() {
    let root = workspace();
    let target = root.join("target");
    fs::create_dir_all(&target).expect("target directory");
    let marker = target.join("b2-package-build.marker");
    let fingerprint = package_fingerprint(&root);
    let ready = || {
        fs::read_to_string(&marker).ok().as_deref() == Some(&fingerprint)
            && root.join("packages/snapback2/dist/compiler.mjs").is_file()
            && root
                .join("packages/snapback2/dist/compiler-core.mjs")
                .is_file()
            && root
                .join("packages/snapback2/dist/compiler-lib.d.ts")
                .is_file()
            && root.join("packages/snapback2/dist/index.d.ts").is_file()
            && root.join("packages/snapback2/dist/client.d.ts").is_file()
            && root.join("packages/snapback2/dist/test.d.ts").is_file()
            && root
                .join("packages/snapback2/dist/guide/grammar.md")
                .is_file()
            && root
                .join("packages/snapback2/dist/test-runner.mjs")
                .is_file()
            && root
                .join("packages/snapback2/dist/templates/chat/snapback/schema.q")
                .is_file()
    };
    if ready() {
        return;
    }
    let _lock = PackageLock::acquire(&root);
    if ready() {
        return;
    }
    let output = Command::new("node")
        .arg("build.mjs")
        .env("SNAPBACK2_PACKAGE_BUILD_LOCK_HELD", "1")
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
    assert!(
        ready(),
        "package build did not produce the complete test fixture"
    );
}

pub fn isolated_compiler(target: &Path) -> PathBuf {
    ensure_package();
    let root = workspace();
    let _lock = PackageLock::acquire(&root);
    let dist = root.join("packages/snapback2/dist");
    let isolated_dist = target.join("dist");
    // Declarations and runners resolve sibling dist leaves, so the package is one fixture unit.
    copy_tree(&dist, &isolated_dist);
    link_typescript(target, &root);
    isolated_dist.join("compiler.mjs")
}

fn copy_package_fixture(target: &Path) {
    ensure_package();
    let root = workspace();
    let _lock = PackageLock::acquire(&root);
    let dist = root.join("packages/snapback2/dist");
    let isolated_dist = target.join("dist");
    // Snapshot while the publisher is excluded; commands never read the mutable shared dist.
    copy_tree(&dist, &isolated_dist);
    link_typescript(target, &root);
}

fn link_typescript(target: &Path, root: &Path) {
    let modules = target.join("node_modules");
    fs::create_dir_all(&modules).expect("create isolated package node_modules");
    let source = root.join("packages/snapback2/node_modules/typescript");
    let destination = modules.join("typescript");
    #[cfg(unix)]
    std::os::unix::fs::symlink(source, destination).expect("link isolated TypeScript dependency");
    #[cfg(windows)]
    std::os::windows::fs::symlink_dir(source, destination)
        .expect("link isolated TypeScript dependency");
}

fn copy_tree(source: &Path, target: &Path) {
    fs::create_dir_all(target).expect("create isolated package directory");
    let mut entries = fs::read_dir(source)
        .expect("read package fixture directory")
        .collect::<Result<Vec<_>, _>>()
        .expect("read package fixture entry");
    entries.sort_by_key(|entry| entry.file_name());
    for entry in entries {
        let destination = target.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &destination);
        } else {
            fs::copy(entry.path(), destination).expect("copy package fixture file");
        }
    }
}

struct PackageLock {
    path: PathBuf,
}

impl PackageLock {
    fn acquire(root: &Path) -> Self {
        let path = root.join("target/b2-package-build.lock");
        let started = Instant::now();
        loop {
            match OpenOptions::new().write(true).create_new(true).open(&path) {
                Ok(mut file) => {
                    let _ = writeln!(file, "{}", std::process::id());
                    return Self { path };
                }
                Err(error) if error.kind() == std::io::ErrorKind::AlreadyExists => {
                    assert!(
                        started.elapsed() < Duration::from_secs(30),
                        "timed out waiting for package build lock"
                    );
                    thread::sleep(Duration::from_millis(25));
                }
                Err(error) => panic!("cannot create package build lock: {error}"),
            }
        }
    }
}

impl Drop for PackageLock {
    fn drop(&mut self) {
        fs::remove_file(&self.path).expect("remove package build lock");
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
    hash_tree(&root.join("packages/compiler/fixtures"), &mut hasher);
    format!("{:016x}", hasher.finish())
}

fn workspace() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../..")
}

//! Native jobs on disk (LLP 3000.005): `snapback/native/` is the app's
//! crate; `check` builds it to `snapback/generated/native.wasm` and writes
//! the schema's Rust types beside it; every verb that opens an engine
//! installs the module and checks the declared jobs against it.

use crate::project::Project;
use snapback4_core::Engine;
use snapback4_lang::Bound;
use std::path::PathBuf;
use std::process::Command;
use std::time::Instant;

/// A refusal in the diagnostic's shape: code, message, the line to paste.
pub struct Problem {
    pub code: &'static str,
    pub message: String,
    pub rewrite: String,
}

impl std::fmt::Display for Problem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "{}: {}\n  rewrite: {}\n  guide: native", self.code, self.message, self.rewrite)
    }
}

const TARGET: &str = "wasm32-unknown-unknown";

/// What `check` says about the native module once built.
pub struct Built {
    pub path: PathBuf,
    pub bytes: u64,
    pub jobs: Vec<String>,
    pub ms: u128,
}

/// Whether the schema declares any native job.
pub fn declared(bound: &Bound) -> Vec<String> {
    bound.programs.iter().filter(|p| p.program.native).map(|p| p.program.name.clone()).collect()
}

/// Write the schema's Rust types and build the module, when the schema
/// declares a native job. `Ok(None)` when it declares none.
pub fn build(project: &Project, bound: &Bound) -> Result<Option<Built>, Problem> {
    let jobs = declared(bound);
    if jobs.is_empty() {
        return Ok(None);
    }
    let started = Instant::now();
    let manifest = project.native_manifest();
    if !manifest.is_file() {
        return Err(Problem { code: "E_NATIVE", message: format!("{} declared native but there is no {}", list("job", &jobs), manifest.display()), rewrite: "snapback4 guide native  -- the crate's shape; then `snapback4 check` builds it".into() });
    }
    let generated = project.generated_dir();
    std::fs::create_dir_all(&generated).map_err(|e| Problem { code: "E_NATIVE_BUILD", message: format!("cannot create {}: {e}", generated.display()), rewrite: "check the directory's permissions".into() })?;
    let types = project.native_types();
    let text = snapback4_lang::emit::rust(bound);
    if std::fs::read_to_string(&types).ok().as_deref() != Some(text.as_str()) {
        std::fs::write(&types, text).map_err(|e| Problem { code: "E_NATIVE_BUILD", message: format!("cannot write {}: {e}", types.display()), rewrite: "check the directory's permissions".into() })?;
    }
    let target_dir = generated.join("native-target");
    let output = Command::new("cargo")
        .args(["build", "--release", "--quiet", "--target", TARGET, "--manifest-path"])
        .arg(&manifest)
        .arg("--target-dir")
        .arg(&target_dir)
        .env_remove("CARGO_TARGET_DIR")
        .output();
    let output = match output {
        Ok(output) => output,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(Problem { code: "E_NATIVE_TOOLCHAIN", message: "cargo is not on PATH; a native job is Rust compiled to wasm".into(), rewrite: format!("curl https://sh.rustup.rs -sSf | sh   -- then: rustup target add {TARGET}") });
        }
        Err(error) => return Err(Problem { code: "E_NATIVE_TOOLCHAIN", message: format!("cannot run cargo: {error}"), rewrite: "install rustup (https://rustup.rs)".into() }),
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        if stderr.contains("target may not be installed") || stderr.contains("can't find crate for `core`") || stderr.contains("can't find crate for `std`") {
            return Err(Problem { code: "E_NATIVE_TOOLCHAIN", message: format!("the {TARGET} target is not installed"), rewrite: format!("rustup target add {TARGET}") });
        }
        let tail: Vec<&str> = stderr.lines().rev().take(40).collect::<Vec<_>>().into_iter().rev().collect();
        return Err(Problem { code: "E_NATIVE_BUILD", message: format!("cargo build failed in {}:\n{}", project.native_dir().display(), tail.join("\n")), rewrite: format!("cd {} && cargo build --release --target {TARGET}", project.native_dir().display()) });
    }
    let built_dir = target_dir.join(TARGET).join("release");
    let mut candidates: Vec<PathBuf> = std::fs::read_dir(&built_dir).map(|entries| entries.flatten().map(|e| e.path()).filter(|p| p.extension().is_some_and(|x| x == "wasm")).collect()).unwrap_or_default();
    candidates.sort();
    let Some(built) = candidates.pop() else {
        return Err(Problem { code: "E_NATIVE_BUILD", message: format!("cargo built nothing under {}; the crate needs `crate-type = [\"cdylib\"]`", built_dir.display()), rewrite: "[lib]\ncrate-type = [\"cdylib\"]".into() });
    };
    let bytes = std::fs::read(&built).map_err(|e| Problem { code: "E_NATIVE_BUILD", message: format!("cannot read {}: {e}", built.display()), rewrite: "run `snapback4 check` again".into() })?;
    let path = project.native_module();
    if std::fs::read(&path).ok().as_deref() != Some(bytes.as_slice()) {
        std::fs::write(&path, &bytes).map_err(|e| Problem { code: "E_NATIVE_BUILD", message: format!("cannot write {}: {e}", path.display()), rewrite: "check the directory's permissions".into() })?;
    }
    let module = snapback4_core::engine::native::Module::compile(&bytes).map_err(|e| Problem { code: "E_NATIVE", message: e.to_string(), rewrite: "snapback4_native::jobs! { .. } names the jobs the module implements".into() })?;
    let implemented = module.jobs().to_vec();
    if let Some(missing) = jobs.iter().find(|job| !implemented.contains(job)) {
        return Err(Problem { code: "E_NATIVE", message: format!("job {missing} is declared native but the module implements {}", if implemented.is_empty() { "no jobs".to_owned() } else { format!("only {}", implemented.join(", ")) }), rewrite: format!("snapback4_native::jobs! {{ {} }}  -- in snapback/native/src/lib.rs, with fn {missing}(ctx: &Ctx, chunk: &Chunk) -> Result<Next>", jobs.join(", ")) });
    }
    Ok(Some(Built { path, bytes: bytes.len() as u64, jobs: implemented, ms: started.elapsed().as_millis() }))
}

/// Install the built module into an engine whose schema declares native
/// jobs; refuse when it is missing or does not implement a declared job.
pub fn install(engine: &mut Engine, project: &Project) -> Result<Vec<String>, Problem> {
    let jobs = engine.declared_native_jobs();
    if jobs.is_empty() {
        return Ok(Vec::new());
    }
    let path = project.native_module();
    let bytes = std::fs::read(&path).map_err(|_| Problem { code: "E_NATIVE", message: format!("{} declared native but {} is not built", list("job", &jobs), path.display()), rewrite: "snapback4 check  -- builds snapback/native into it".into() })?;
    let implemented = engine.install_native(&bytes).map_err(|e| Problem { code: "E_NATIVE", message: e.to_string(), rewrite: "snapback4 check".into() })?;
    if let Some(missing) = jobs.iter().find(|job| !implemented.contains(job)) {
        return Err(Problem { code: "E_NATIVE", message: format!("job {missing} is declared native but the module implements {}", if implemented.is_empty() { "no jobs".to_owned() } else { format!("only {}", implemented.join(", ")) }), rewrite: format!("snapback4_native::jobs! {{ {} }}  -- then `snapback4 check`", jobs.join(", ")) });
    }
    Ok(implemented)
}

/// Whether the toolchain a native job needs is present: `cargo`, and the
/// wasm target. For `doctor`.
pub fn toolchain() -> Result<String, String> {
    let cargo = Command::new("cargo").arg("--version").output().map_err(|_| "cargo is not on PATH (https://rustup.rs)".to_owned())?;
    if !cargo.status.success() {
        return Err("cargo --version failed".into());
    }
    let version = String::from_utf8_lossy(&cargo.stdout).trim().to_owned();
    let targets = Command::new("rustup").args(["target", "list", "--installed"]).output();
    match targets {
        Ok(output) if String::from_utf8_lossy(&output.stdout).lines().any(|line| line.trim() == TARGET) => Ok(version),
        Ok(_) => Err(format!("{version}; the {TARGET} target is not installed: rustup target add {TARGET}")),
        Err(_) => Ok(format!("{version} (rustup not found; the {TARGET} target is assumed)")),
    }
}

fn list(noun: &str, names: &[String]) -> String {
    format!("{noun}{} {}", if names.len() == 1 { "" } else { "s" }, names.join(", "))
}

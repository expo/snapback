//! Native jobs on disk (LLP 3000.005): `snapback/native/` is the app's
//! crate; `check` builds it to `snapback/generated/native.wasm` and writes
//! the schema's Rust types beside it; every verb that opens an engine
//! installs the module and checks the declared jobs against it.

use crate::project::Project;
use snapback4_core::Engine;
use snapback4_lang::Bound;
use std::collections::BTreeSet;
use std::path::PathBuf;
use std::process::Command;
use std::time::Instant;

/// A refusal in the diagnostic's shape: code, message, the line to paste.
#[derive(Debug)]
pub struct Problem {
    pub code: &'static str,
    pub message: String,
    pub rewrite: String,
}

impl std::fmt::Display for Problem {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(
            f,
            "{}: {}\n  rewrite: {}\n  guide: native",
            self.code, self.message, self.rewrite
        )
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

/// The native programs the schema declares: jobs and reads.
pub fn declared(bound: &Bound) -> Vec<String> {
    bound
        .programs
        .iter()
        .filter(|p| p.program.native)
        .map(|p| p.program.name.clone())
        .collect()
}

fn declared_of(bound: &Bound, kind: snapback4_core::ProgramKind) -> Vec<String> {
    bound
        .programs
        .iter()
        .filter(|p| p.program.native && p.program.kind == kind)
        .map(|p| p.program.name.clone())
        .collect()
}

/// The module as the server serves it (`GET /native.wasm`) and names it in
/// `GET /schema`: its bytes, their digest, what it implements.
#[derive(Clone, Debug)]
pub struct Installed {
    pub bytes: Vec<u8>,
    pub digest: String,
    pub jobs: Vec<String>,
    pub reads: Vec<String>,
}

pub(crate) struct Prepared {
    pub module: Option<std::sync::Arc<snapback4_core::engine::native::Module>>,
    pub installed: Option<Installed>,
}

// @ref LLP 3000.000.000#5-hot-activation-and-ownership — compile and validate exact module bytes before committing a release.
pub(crate) fn prepare(project: &Project, bound: &Bound) -> Result<Prepared, Problem> {
    let jobs = declared_of(bound, snapback4_core::ProgramKind::Job);
    let reads = declared_of(bound, snapback4_core::ProgramKind::Query);
    if jobs.is_empty() && reads.is_empty() {
        return Ok(Prepared {
            module: None,
            installed: None,
        });
    }
    let path = project.native_module();
    snapback4_core::private_fs::existing_file(&path).map_err(|e| Problem {
        code: "E_NATIVE",
        message: format!("{}: {e}", path.display()),
        rewrite: "snapback4 check, then deploy the built native module".into(),
    })?;
    let bytes = std::fs::read(&path).map_err(|e| Problem {
        code: "E_NATIVE",
        message: e.to_string(),
        rewrite: "snapback4 check".into(),
    })?;
    let module = snapback4_core::engine::native::Module::compile(&bytes).map_err(|e| Problem {
        code: "E_NATIVE",
        message: e.to_string(),
        rewrite: "snapback4 check".into(),
    })?;
    check_implemented(&jobs, &reads, &module)?;
    let installed = Installed {
        digest: digest(&bytes),
        jobs: module.jobs().to_vec(),
        reads: module.reads().to_vec(),
        bytes,
    };
    Ok(Prepared {
        module: Some(std::sync::Arc::new(module)),
        installed: Some(installed),
    })
}

pub fn digest(bytes: &[u8]) -> String {
    use sha2::Digest;
    let hash = sha2::Sha256::digest(bytes);
    hash.iter().map(|b| format!("{b:02x}")).collect()
}

/// Every declared native job is one the module implements, and every
/// declared native read likewise; the message names the first that is not.
fn check_implemented(
    declared_jobs: &[String],
    declared_reads: &[String],
    module: &snapback4_core::engine::native::Module,
) -> Result<(), Problem> {
    let rewrite = format!(
        "snapback4_native::module! {{ jobs: [{}], reads: [{}] }}  -- in snapback/native/src/lib.rs",
        declared_jobs.join(", "),
        declared_reads.join(", ")
    );
    if let Some(missing) = declared_jobs
        .iter()
        .find(|job| !module.jobs().contains(job))
    {
        return Err(Problem {
            code: "E_NATIVE",
            message: format!(
                "job {missing} is declared native but the module implements {}",
                if module.jobs().is_empty() {
                    "no jobs".to_owned()
                } else {
                    format!("only {}", module.jobs().join(", "))
                }
            ),
            rewrite: format!(
                "{rewrite}, with fn {missing}(ctx: &Ctx, chunk: &Chunk) -> Result<Next>"
            ),
        });
    }
    if let Some(missing) = declared_reads
        .iter()
        .find(|read| !module.reads().contains(read))
    {
        return Err(Problem {
            code: "E_NATIVE",
            message: format!(
                "query {missing} is declared native but the module implements {}",
                if module.reads().is_empty() {
                    "no reads".to_owned()
                } else {
                    format!("only the reads {}", module.reads().join(", "))
                }
            ),
            rewrite: format!(
                "{rewrite}, with fn {missing}(ctx: &Ctx, args: &Json) -> Result<Json>"
            ),
        });
    }
    Ok(())
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
        return Err(Problem {
            code: "E_NATIVE",
            message: format!(
                "{} declared native but there is no {}",
                list("job", &jobs),
                manifest.display()
            ),
            rewrite:
                "snapback4 guide native  -- the crate's shape; then `snapback4 check` builds it"
                    .into(),
        });
    }
    let generated = project.generated_dir();
    std::fs::create_dir_all(&generated).map_err(|e| Problem {
        code: "E_NATIVE_BUILD",
        message: format!("cannot create {}: {e}", generated.display()),
        rewrite: "check the directory's permissions".into(),
    })?;
    let types = project.native_types();
    let text = snapback4_lang::emit::rust(bound);
    if std::fs::read_to_string(&types).ok().as_deref() != Some(text.as_str()) {
        std::fs::write(&types, text).map_err(|e| Problem {
            code: "E_NATIVE_BUILD",
            message: format!("cannot write {}: {e}", types.display()),
            rewrite: "check the directory's permissions".into(),
        })?;
    }
    let target_dir = generated.join("native-target");
    let output = Command::new("cargo")
        .args([
            "build",
            "--release",
            "--quiet",
            "--message-format=json-render-diagnostics",
            "--target",
            TARGET,
            "--manifest-path",
        ])
        .arg(&manifest)
        .arg("--target-dir")
        .arg(&target_dir)
        .env_remove("CARGO_TARGET_DIR")
        .output();
    let output = match output {
        Ok(output) => output,
        Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
            return Err(Problem {
                code: "E_NATIVE_TOOLCHAIN",
                message: "cargo is not on PATH; a native job is Rust compiled to wasm".into(),
                rewrite: format!(
                    "curl https://sh.rustup.rs -sSf | sh   -- then: rustup target add {TARGET}"
                ),
            });
        }
        Err(error) => {
            return Err(Problem {
                code: "E_NATIVE_TOOLCHAIN",
                message: format!("cannot run cargo: {error}"),
                rewrite: "install rustup (https://rustup.rs)".into(),
            });
        }
    };
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr);
        let stdout = String::from_utf8_lossy(&output.stdout);
        let rendered = stdout
            .lines()
            .filter_map(|line| serde_json::from_str::<serde_json::Value>(line).ok())
            .filter(|message| message["reason"] == "compiler-message")
            .filter_map(|message| message["message"]["rendered"].as_str().map(str::to_owned))
            .collect::<Vec<_>>()
            .join("\n");
        let details = format!("{rendered}\n{stderr}");
        if details.contains("target may not be installed")
            || details.contains("can't find crate for `core`")
            || details.contains("can't find crate for `std`")
        {
            return Err(Problem {
                code: "E_NATIVE_TOOLCHAIN",
                message: format!("the {TARGET} target is not installed"),
                rewrite: format!("rustup target add {TARGET}"),
            });
        }
        let tail: Vec<&str> = details
            .lines()
            .rev()
            .take(40)
            .collect::<Vec<_>>()
            .into_iter()
            .rev()
            .collect();
        return Err(Problem {
            code: "E_NATIVE_BUILD",
            message: format!(
                "cargo build failed in {}:\n{}",
                project.native_dir().display(),
                tail.join("\n")
            ),
            rewrite: format!(
                "cd {} && cargo build --release --target {TARGET}",
                project.native_dir().display()
            ),
        });
    }
    let stdout = String::from_utf8_lossy(&output.stdout);
    let built = current_cdylib_artifact(&stdout, &manifest)?;
    let bytes = std::fs::read(&built).map_err(|e| Problem {
        code: "E_NATIVE_BUILD",
        message: format!("cannot read {}: {e}", built.display()),
        rewrite: "run `snapback4 check` again".into(),
    })?;
    // Validate the candidate while the previously served module is still in place.
    let module = snapback4_core::engine::native::Module::compile(&bytes).map_err(|e| Problem {
        code: "E_NATIVE",
        message: e.to_string(),
        rewrite:
            "snapback4_native::module! { jobs: [..], reads: [..] } names what the module implements"
                .into(),
    })?;
    check_implemented(
        &declared_of(bound, snapback4_core::ProgramKind::Job),
        &declared_of(bound, snapback4_core::ProgramKind::Query),
        &module,
    )?;
    let path = project.native_module();
    if std::fs::read(&path).ok().as_deref() != Some(bytes.as_slice()) {
        let staged = path.with_extension(format!("wasm.tmp-{}", std::process::id()));
        std::fs::write(&staged, &bytes)
            .and_then(|()| std::fs::rename(&staged, &path))
            .map_err(|e| {
                let _ = std::fs::remove_file(&staged);
                Problem {
                    code: "E_NATIVE_BUILD",
                    message: format!("cannot replace {}: {e}", path.display()),
                    rewrite: "check the directory's permissions".into(),
                }
            })?;
    }
    let mut implemented = module.jobs().to_vec();
    implemented.extend(module.reads().iter().cloned());
    Ok(Some(Built {
        path,
        bytes: bytes.len() as u64,
        jobs: implemented,
        ms: started.elapsed().as_millis(),
    }))
}

/// Select only the cdylib emitted for this app manifest. The target directory
/// may retain wasm files from old package names and dependencies.
fn current_cdylib_artifact(output: &str, manifest: &std::path::Path) -> Result<PathBuf, Problem> {
    let wanted = std::fs::canonicalize(manifest).unwrap_or_else(|_| manifest.to_path_buf());
    let mut candidates = BTreeSet::new();
    for line in output.lines().filter(|line| !line.trim().is_empty()) {
        let Ok(message) = serde_json::from_str::<serde_json::Value>(line) else {
            continue;
        };
        let cdylib = ["kind", "crate_types"].into_iter().any(|field| {
            message["target"][field]
                .as_array()
                .is_some_and(|kinds| kinds.iter().any(|kind| kind == "cdylib"))
        });
        if message["reason"] != "compiler-artifact" || !cdylib {
            continue;
        }
        let Some(reported_manifest) = message["manifest_path"].as_str() else {
            continue;
        };
        let reported = PathBuf::from(reported_manifest);
        if std::fs::canonicalize(&reported).unwrap_or(reported) != wanted {
            continue;
        }
        for filename in message["filenames"]
            .as_array()
            .into_iter()
            .flatten()
            .filter_map(|value| value.as_str())
        {
            let path = PathBuf::from(filename);
            if path
                .extension()
                .is_some_and(|extension| extension == "wasm")
            {
                candidates.insert(path);
            }
        }
    }
    match candidates.len() {
        1 => Ok(candidates.pop_first().expect("one candidate")),
        0 => Err(Problem {
            code: "E_NATIVE_BUILD",
            message: format!(
                "cargo did not report one wasm cdylib for {}; the crate needs `crate-type = [\"cdylib\"]`",
                manifest.display()
            ),
            rewrite: "[lib]\ncrate-type = [\"cdylib\"]".into(),
        }),
        count => Err(Problem {
            code: "E_NATIVE_BUILD",
            message: format!(
                "cargo reported {count} wasm cdylibs for {}; the app native crate must build exactly one",
                manifest.display()
            ),
            rewrite: "keep one `[lib]` target with `crate-type = [\"cdylib\"]`".into(),
        }),
    }
}

/// Install the built module into an engine whose schema declares native
/// programs; refuse when it is missing or does not implement one. `None`
/// when the schema declares none.
pub fn install(engine: &mut Engine, project: &Project) -> Result<Option<Installed>, Problem> {
    let jobs = engine.declared_native_jobs();
    let reads = engine.declared_native_reads();
    if jobs.is_empty() && reads.is_empty() {
        return Ok(None);
    }
    let mut declared = jobs.clone();
    declared.extend(reads.iter().cloned());
    let path = project.native_module();
    let bytes = std::fs::read(&path).map_err(|_| Problem {
        code: "E_NATIVE",
        message: format!(
            "{} declared native but {} is not built",
            list("program", &declared),
            path.display()
        ),
        rewrite: "snapback4 check  -- builds snapback/native into it".into(),
    })?;
    if let Some(expected) = engine
        .store()
        .meta("release_native_digest")
        .map_err(|e| Problem {
            code: "E_NATIVE",
            message: e.to_string(),
            rewrite: "restore the deployment store".into(),
        })?
    {
        if expected != digest(&bytes) {
            return Err(Problem {
                code: "E_NATIVE",
                message: "release native module differs from its activated execution digest".into(),
                rewrite:
                    "deploy the source as a new release; do not edit immutable release artifacts"
                        .into(),
            });
        }
    }
    engine.install_native(&bytes).map_err(|e| Problem {
        code: "E_NATIVE",
        message: e.to_string(),
        rewrite: "snapback4 check".into(),
    })?;
    let module = engine.native_module().expect("just installed");
    check_implemented(&jobs, &reads, module)?;
    Ok(Some(Installed {
        digest: digest(&bytes),
        jobs: module.jobs().to_vec(),
        reads: module.reads().to_vec(),
        bytes,
    }))
}

/// Whether the toolchain a native job needs is present: `cargo`, and the
/// wasm target. For `doctor`.
pub fn toolchain() -> Result<String, String> {
    let cargo = Command::new("cargo")
        .arg("--version")
        .output()
        .map_err(|_| "cargo is not on PATH (https://rustup.rs)".to_owned())?;
    if !cargo.status.success() {
        return Err("cargo --version failed".into());
    }
    let version = String::from_utf8_lossy(&cargo.stdout).trim().to_owned();
    let targets = Command::new("rustup")
        .args(["target", "list", "--installed"])
        .output();
    match targets {
        Ok(output)
            if String::from_utf8_lossy(&output.stdout)
                .lines()
                .any(|line| line.trim() == TARGET) =>
        {
            Ok(version)
        }
        Ok(_) => Err(format!(
            "{version}; the {TARGET} target is not installed: rustup target add {TARGET}"
        )),
        Err(_) => Ok(format!(
            "{version} (rustup not found; the {TARGET} target is assumed)"
        )),
    }
}

fn list(noun: &str, names: &[String]) -> String {
    format!(
        "{noun}{} {}",
        if names.len() == 1 { "" } else { "s" },
        names.join(", ")
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn artifact(manifest: &str, name: &str, filename: &str) -> String {
        serde_json::json!({ "reason": "compiler-artifact", "manifest_path": manifest, "target": { "name": name, "kind": ["cdylib"] }, "filenames": [filename] }).to_string()
    }

    #[test]
    fn cargo_messages_select_the_current_cdylib_over_a_later_stale_name() {
        let manifest = PathBuf::from("/app/snapback/native/Cargo.toml");
        let output = [
            artifact(
                "/dependency/Cargo.toml",
                "zzz_dependency",
                "/target/zzz_dependency.wasm",
            ),
            artifact("/old/Cargo.toml", "zzz_old", "/target/zzz_old.wasm"),
            artifact(
                manifest.to_str().unwrap(),
                "aaa_new",
                "/target/aaa_new.wasm",
            ),
        ]
        .join("\n");
        assert_eq!(
            current_cdylib_artifact(&output, &manifest).unwrap(),
            PathBuf::from("/target/aaa_new.wasm")
        );
    }

    #[test]
    fn cargo_messages_refuse_missing_or_ambiguous_app_cdylibs() {
        let manifest = PathBuf::from("/app/Cargo.toml");
        assert!(
            current_cdylib_artifact("", &manifest)
                .unwrap_err()
                .message
                .contains("did not report one")
        );
        let output = [
            artifact("/app/Cargo.toml", "one", "/target/one.wasm"),
            artifact("/app/Cargo.toml", "two", "/target/two.wasm"),
        ]
        .join("\n");
        assert!(
            current_cdylib_artifact(&output, &manifest)
                .unwrap_err()
                .message
                .contains("reported 2")
        );
    }
}

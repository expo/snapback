//! Bounded, short-lived `snapback2-media` child process protocol.

use crate::protocol::Refusal;
use serde::{Deserialize, Serialize};
use serde_json::Value as Json;
use snapback2_core::{ArgType, ColumnType, Generation, ProjectJson};
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, ExitStatus, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(unix)]
use std::os::unix::process::CommandExt;

pub const MEDIA_HELPER_TIMEOUT: Duration = Duration::from_secs(30);
pub const MEDIA_HELPER_RSS_BYTES: u64 = 512 * 1024 * 1024;
const MAX_HELPER_STDOUT: usize = 64 * 1024;

#[derive(Clone, Debug, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum MediaFormat {
    Jpeg,
    Png,
    Webp,
    Heic,
}

impl MediaFormat {
    pub fn content_type(&self) -> &'static str {
        match self {
            Self::Jpeg | Self::Heic => "image/jpeg",
            Self::Png => "image/png",
            Self::Webp => "image/webp",
        }
    }
}

#[allow(dead_code)]
#[derive(Clone, Debug, Deserialize)]
pub struct ProbeResult {
    pub format: MediaFormat,
    pub width: u32,
    pub height: u32,
    pub orientation: u8,
}

#[derive(Clone, Debug, Deserialize)]
pub struct RenderResult {
    pub format: MediaFormat,
    pub width: u32,
    pub height: u32,
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct Capabilities {
    pub images: bool,
    pub heic: bool,
}

#[derive(Deserialize)]
struct HelperRefusal {
    code: String,
    detail: String,
}

pub fn locate() -> Result<PathBuf, Refusal> {
    let path = if let Some(path) = std::env::var_os("SNAPBACK2_MEDIA") {
        PathBuf::from(path)
    } else {
        let executable = std::env::current_exe().map_err(|error| {
            unavailable(format!("cannot locate the snapback2 executable: {error}"))
        })?;
        executable
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .join(if cfg!(windows) {
                "snapback2-media.exe"
            } else {
                "snapback2-media"
            })
    };
    if path.is_file() {
        Ok(path)
    } else {
        Err(unavailable(format!(
            "the media helper was not found at {}",
            path.display()
        )))
    }
}

pub fn capabilities() -> Result<Capabilities, Refusal> {
    decode(run(&["capabilities".to_owned()], None)?)
}

pub fn require_for_generation(generation: &Generation) -> Result<(), Refusal> {
    if !generation_needs_images(generation) {
        return Ok(());
    }
    let capabilities = capabilities()?;
    if !capabilities.images {
        return Err(unavailable(
            "the media helper was built without image decode support",
        ));
    }
    Ok(())
}

pub fn require_for_cached_project(root: &Path) -> Result<Option<Capabilities>, Refusal> {
    let path = root.join(".snapback/build/project.json");
    let Ok(bytes) = fs::read(&path) else {
        return Ok(None);
    };
    let project: ProjectJson = serde_json::from_slice(&bytes).map_err(|error| {
        unavailable(format!(
            "cannot inspect cached project {}: {error}",
            path.display()
        ))
    })?;
    if !project
        .schema
        .tables
        .values()
        .flat_map(|table| table.columns.values())
        .any(column_needs_images)
        && !project
            .programs
            .iter()
            .flat_map(|program| program.args.values())
            .any(arg_needs_images)
    {
        return Ok(None);
    }
    let capabilities = capabilities()?;
    if !capabilities.images {
        return Err(unavailable(
            "the cached project declares image values but the helper has no image codec",
        ));
    }
    Ok(Some(capabilities))
}

#[allow(dead_code)]
pub fn probe(source: &Path) -> Result<ProbeResult, Refusal> {
    decode(run(
        &["probe".to_owned(), source.to_string_lossy().into_owned()],
        None,
    )?)
}

pub fn normalize_heic(source: &Path, destination: &Path) -> Result<RenderResult, Refusal> {
    decode(run(
        &[
            "heic".to_owned(),
            source.to_string_lossy().into_owned(),
            destination.to_string_lossy().into_owned(),
        ],
        Some(destination),
    )?)
}

pub fn render(source: &Path, destination: &Path, width: u32) -> Result<RenderResult, Refusal> {
    decode(run(
        &[
            "render".to_owned(),
            source.to_string_lossy().into_owned(),
            destination.to_string_lossy().into_owned(),
            "--width".to_owned(),
            width.to_string(),
        ],
        Some(destination),
    )?)
}

fn decode<T: for<'de> Deserialize<'de>>(value: Json) -> Result<T, Refusal> {
    serde_json::from_value(value).map_err(|error| {
        asset_type(format!(
            "the media helper returned an invalid success result: {error}"
        ))
    })
}

// @ref LLP 1006#14a-codecs-live-in-a-separate-executable-the-type-does-not —
// decoder jobs have a cleared environment, their own process group, a wall clock,
// a memory ceiling where the host exposes one, bounded stdout, and group termination.
fn run(args: &[String], destination: Option<&Path>) -> Result<Json, Refusal> {
    run_with_timeout(args, destination, MEDIA_HELPER_TIMEOUT)
}

fn run_with_timeout(
    args: &[String],
    destination: Option<&Path>,
    timeout: Duration,
) -> Result<Json, Refusal> {
    let helper = locate()?;
    run_helper_with_timeout(&helper, args, destination, timeout)
}

fn run_helper_with_timeout(
    helper: &Path,
    args: &[String],
    destination: Option<&Path>,
    timeout: Duration,
) -> Result<Json, Refusal> {
    run_helper_with_limits(
        helper,
        args,
        destination,
        timeout,
        MEDIA_HELPER_RSS_BYTES,
        MEDIA_HELPER_RSS_BYTES,
    )
}

fn run_helper_with_limits(
    helper: &Path,
    args: &[String],
    destination: Option<&Path>,
    timeout: Duration,
    rss_ceiling: u64,
    rlimit_ceiling: u64,
) -> Result<Json, Refusal> {
    let _cleanup = destination.map(HelperTemporaryCleanup::new);
    let mut command = Command::new(helper);
    command
        .args(args)
        .env_clear()
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::null());
    #[cfg(unix)]
    unsafe {
        command.pre_exec(move || {
            if libc::setpgid(0, 0) != 0 {
                return Err(std::io::Error::last_os_error());
            }
            set_memory_limit(rlimit_ceiling)?;
            Ok(())
        });
    }
    let mut child = command.spawn().map_err(|error| {
        unavailable(format!(
            "cannot spawn media helper {}: {error}",
            helper.display()
        ))
    })?;
    let pid = child.id();
    let group = ProcessGroupGuard { pid };
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| asset_type("the media helper started without a readable stdout protocol"))?;
    let (reader_tx, reader_rx) = mpsc::sync_channel(1);
    thread::Builder::new()
        .name("snapback2-media-stdout".to_owned())
        .spawn(move || {
            let mut bytes = Vec::new();
            let result = stdout
                .take((MAX_HELPER_STDOUT + 1) as u64)
                .read_to_end(&mut bytes)
                .map(|_| bytes);
            let _ = reader_tx.send(result);
        })
        .map_err(|error| asset_type(format!("cannot read media helper output: {error}")))?;

    let started = Instant::now();
    // The macOS RSS watchdog samples only the direct helper; this is accepted
    // because the helper is our own static binary and does not fork.
    let status = loop {
        if child_rss(pid).is_some_and(|rss| rss > rss_ceiling) {
            group.terminate();
            let _ = child.kill();
            let _ = child.wait();
            return Err(too_large(format!(
                "media helper exceeded its {rss_ceiling} byte resident-memory ceiling"
            )));
        }
        match child.try_wait() {
            Ok(Some(status)) => break status,
            Ok(None) if started.elapsed() < timeout => thread::sleep(Duration::from_millis(10)),
            Ok(None) => {
                group.terminate();
                let _ = child.kill();
                let _ = child.wait();
                return Err(asset_type(format!(
                    "media helper exceeded its {}ms wall-clock ceiling",
                    timeout.as_millis()
                )));
            }
            Err(error) => {
                group.terminate();
                let _ = child.kill();
                let _ = child.wait();
                return Err(asset_type(format!(
                    "cannot observe media helper completion: {error}"
                )));
            }
        }
    };
    // The direct helper can exit while a descendant keeps its stdout pipe.
    // Kill the whole group on the success path too, then keep the original
    // wall-clock deadline while waiting for the bounded protocol drain.
    group.terminate();
    let remaining = timeout.saturating_sub(started.elapsed());
    let bytes = reader_rx
        .recv_timeout(remaining)
        .map_err(|_| {
            asset_type(format!(
                "media helper exceeded its {}ms wall-clock ceiling while draining output",
                timeout.as_millis()
            ))
        })?
        .map_err(|error| asset_type(format!("cannot read media helper output: {error}")))?;
    interpret(status, bytes)
}

struct ProcessGroupGuard {
    pid: u32,
}

impl ProcessGroupGuard {
    fn terminate(&self) {
        terminate_process_group(self.pid);
    }
}

impl Drop for ProcessGroupGuard {
    fn drop(&mut self) {
        self.terminate();
    }
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn timeout_kills_the_process_group_and_parent_cleans_helper_temporaries() {
        let root = std::env::temp_dir().join(format!(
            "snapback2-media-timeout-{}-{}",
            std::process::id(),
            crate::writer_util::unix_millis()
        ));
        fs::create_dir_all(&root).unwrap();
        let helper = root.join("hanging-helper");
        let destination = root.join("output.jpg");
        let legacy_temporary = root.join(format!(
            ".output.jpg.snapback2-media-{}-0.tmp",
            std::process::id()
        ));
        let temporary = root.join(format!(".snapback2-media-{}-0.tmp", std::process::id()));
        fs::write(
            &helper,
            format!(
                "#!/bin/sh\nprintf x > '{}'\nprintf x > '{}'\n/bin/sleep 60 &\nwait\n",
                temporary.display(),
                legacy_temporary.display()
            ),
        )
        .unwrap();
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
        let refusal =
            run_helper_with_timeout(&helper, &[], Some(&destination), Duration::from_millis(500))
                .unwrap_err();
        assert_eq!(refusal.code, "E_ASSET_TYPE", "{}", refusal.message);
        assert!(refusal.message.contains("wall-clock ceiling"));
        assert!(!temporary.exists());
        assert!(!legacy_temporary.exists());
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn successful_parent_cannot_leave_a_descendant_holding_stdout() {
        let root = std::env::temp_dir().join(format!(
            "snapback2-media-drain-{}-{}",
            std::process::id(),
            crate::writer_util::unix_millis()
        ));
        fs::create_dir_all(&root).unwrap();
        let helper = root.join("exiting-helper");
        let pidfile = root.join("descendant.pid");
        fs::write(
            &helper,
            format!(
                "#!/bin/sh\n/bin/sleep 60 &\nprintf %s $! > '{}'\nprintf '{{}}\\n'\nexit 0\n",
                pidfile.display()
            ),
        )
        .unwrap();
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
        let started = Instant::now();
        assert_eq!(
            run_helper_with_timeout(&helper, &[], None, Duration::from_secs(5)).unwrap(),
            serde_json::json!({})
        );
        assert!(started.elapsed() < Duration::from_secs(5));
        let descendant = fs::read_to_string(&pidfile)
            .unwrap()
            .parse::<i32>()
            .unwrap();
        for _ in 0..50 {
            if unsafe { libc::kill(descendant, 0) } != 0 {
                fs::remove_dir_all(root).unwrap();
                return;
            }
            thread::sleep(Duration::from_millis(10));
        }
        panic!("stdout-holding descendant {descendant} survived successful-parent cleanup");
    }

    #[test]
    fn escaped_descendant_holding_stdout_obeys_the_output_drain_deadline() {
        let root = std::env::temp_dir().join(format!(
            "snapback2-media-escaped-drain-{}-{}",
            std::process::id(),
            crate::writer_util::unix_millis()
        ));
        fs::create_dir_all(&root).unwrap();
        let helper = root.join("escaped-descendant-helper");
        let pidfile = root.join("escaped.pid");
        fs::write(
            &helper,
            format!(
                "#!/usr/bin/python3\nimport os,time\npid=os.fork()\nif pid == 0:\n os.setsid()\n f=open(\"{}\",\"w\")\n f.write(str(os.getpid()))\n f.flush()\n os.fsync(f.fileno())\n time.sleep(60)\nelse:\n while not os.path.exists(\"{}\"):\n  time.sleep(0.01)\n print('{{}}', flush=True)\n os._exit(0)\n",
                pidfile.display(), pidfile.display()
            ),
        )
        .unwrap();
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
        let started = Instant::now();
        let refusal =
            run_helper_with_timeout(&helper, &[], None, Duration::from_secs(2)).unwrap_err();
        assert!(started.elapsed() < Duration::from_secs(4));
        assert_eq!(refusal.code, "E_ASSET_TYPE", "{}", refusal.message);
        assert!(
            refusal.message.contains("while draining output"),
            "{}",
            refusal.message
        );
        let escaped = fs::read_to_string(&pidfile)
            .unwrap()
            .parse::<i32>()
            .unwrap();
        unsafe {
            libc::kill(escaped, libc::SIGKILL);
        }
        fs::remove_dir_all(root).unwrap();
    }

    #[test]
    fn parent_rss_watchdog_kills_an_over_ceiling_helper() {
        let root = std::env::temp_dir().join(format!(
            "snapback2-media-rss-{}-{}",
            std::process::id(),
            crate::writer_util::unix_millis()
        ));
        fs::create_dir_all(&root).unwrap();
        let helper = root.join("memory-helper");
        fs::write(
            &helper,
            "#!/usr/bin/python3\nvalue = bytearray(96 * 1024 * 1024)\nimport time\ntime.sleep(60)\n",
        )
        .unwrap();
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
        let refusal = run_helper_with_limits(
            &helper,
            &[],
            None,
            Duration::from_secs(5),
            32 * 1024 * 1024,
            256 * 1024 * 1024,
        )
        .unwrap_err();
        assert_eq!(refusal.code, "E_ASSET_TOO_LARGE", "{}", refusal.message);
        assert!(refusal.message.contains("resident-memory ceiling"));
        fs::remove_dir_all(root).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_unhonored_rlimits_fall_back_without_blocking_spawn() {
        let root = std::env::temp_dir().join(format!(
            "snapback2-media-rlimit-{}-{}",
            std::process::id(),
            crate::writer_util::unix_millis()
        ));
        fs::create_dir_all(&root).unwrap();
        let helper = root.join("rlimit-helper");
        fs::write(
            &helper,
            "#!/bin/sh\nprintf '{\"data\":\"%s\",\"virtual\":\"%s\"}\\n' \"$(ulimit -d)\" \"$(ulimit -v)\"\n",
        )
        .unwrap();
        fs::set_permissions(&helper, fs::Permissions::from_mode(0o700)).unwrap();
        let result = run_helper_with_limits(
            &helper,
            &[],
            None,
            Duration::from_secs(5),
            MEDIA_HELPER_RSS_BYTES,
            64 * 1024 * 1024,
        )
        .unwrap();
        assert_eq!(result["data"], "unlimited");
        assert_eq!(result["virtual"], "unlimited");
        fs::remove_dir_all(root).unwrap();
    }
}

fn interpret(status: ExitStatus, bytes: Vec<u8>) -> Result<Json, Refusal> {
    if bytes.len() > MAX_HELPER_STDOUT {
        return Err(asset_type(format!(
            "media helper output exceeds the {MAX_HELPER_STDOUT} byte protocol ceiling"
        )));
    }
    let text = std::str::from_utf8(&bytes)
        .map_err(|_| asset_type("media helper output is not UTF-8 JSON"))?;
    let line = text.trim();
    if line.is_empty() || line.lines().count() != 1 {
        return Err(asset_type(
            "media helper must return exactly one bounded JSON line",
        ));
    }
    if status.success() {
        serde_json::from_str(line)
            .map_err(|error| asset_type(format!("invalid media helper JSON: {error}")))
    } else if status.code() == Some(2) {
        let refusal: HelperRefusal = serde_json::from_str(line)
            .map_err(|error| asset_type(format!("invalid media helper refusal JSON: {error}")))?;
        match refusal.code.as_str() {
            "E_ASSET_TYPE" => Err(asset_type(refusal.detail)),
            "E_ASSET_TOO_LARGE" => Err(too_large(refusal.detail)),
            _ => Err(asset_type(format!(
                "media helper returned unsupported refusal {}: {}",
                refusal.code, refusal.detail
            ))),
        }
    } else {
        Err(asset_type(format!(
            "media helper crashed with status {status}"
        )))
    }
}

struct HelperTemporaryCleanup {
    directory: PathBuf,
    prefix: String,
    legacy_prefix: String,
}

impl HelperTemporaryCleanup {
    fn new(destination: &Path) -> Self {
        let directory = destination
            .parent()
            .unwrap_or_else(|| Path::new("."))
            .to_path_buf();
        let base = destination
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("output");
        Self {
            directory,
            prefix: ".snapback2-media-".to_owned(),
            legacy_prefix: format!(".{base}.snapback2-media-"),
        }
    }
}

impl Drop for HelperTemporaryCleanup {
    fn drop(&mut self) {
        let Ok(entries) = fs::read_dir(&self.directory) else {
            return;
        };
        for entry in entries.flatten() {
            let name = entry.file_name();
            let name = name.to_string_lossy();
            if (name.starts_with(&self.prefix) || name.starts_with(&self.legacy_prefix))
                && name.ends_with(".tmp")
            {
                let _ = fs::remove_file(entry.path());
            }
        }
    }
}

fn generation_needs_images(generation: &Generation) -> bool {
    generation
        .schema()
        .tables
        .values()
        .flat_map(|table| table.columns.values())
        .any(column_needs_images)
        || generation
            .programs()
            .values()
            .flat_map(|(program, _)| program.args.values())
            .any(arg_needs_images)
}

fn column_needs_images(kind: &ColumnType) -> bool {
    match kind {
        ColumnType::Image { .. } => true,
        ColumnType::Optional(inner) | ColumnType::List { of: inner, .. } => {
            column_needs_images(inner)
        }
        _ => false,
    }
}

fn arg_needs_images(kind: &ArgType) -> bool {
    match kind {
        ArgType::Image { .. } => true,
        ArgType::Optional(inner) => arg_needs_images(inner),
        ArgType::List {
            of: Some(inner), ..
        } => arg_needs_images(inner),
        _ => false,
    }
}

#[cfg(unix)]
unsafe fn set_memory_limit(bytes: u64) -> std::io::Result<()> {
    let limit = libc::rlimit {
        rlim_cur: bytes as libc::rlim_t,
        rlim_max: bytes as libc::rlim_t,
    };
    #[cfg(target_os = "macos")]
    {
        // RLIMIT_AS can report success and still prevent dyld from starting a
        // normal helper on Darwin 25. RLIMIT_DATA returns EINVAL on this host.
        // Attempt the narrower limit where honored; the parent RSS watchdog
        // is the enforceable macOS ceiling.
        let _ = unsafe { libc::setrlimit(libc::RLIMIT_DATA, &limit) };
        Ok(())
    }
    #[cfg(not(target_os = "macos"))]
    {
        let mut installed = false;
        let mut last_error = None;
        for resource in [libc::RLIMIT_AS, libc::RLIMIT_DATA] {
            if unsafe { libc::setrlimit(resource, &limit) } == 0 {
                installed = true;
            } else {
                last_error = Some(std::io::Error::last_os_error());
            }
        }
        installed.then_some(()).ok_or_else(|| {
            last_error.unwrap_or_else(|| std::io::Error::other("no memory rlimit is available"))
        })
    }
}

#[cfg(target_os = "macos")]
fn child_rss(pid: u32) -> Option<u64> {
    let pid = i32::try_from(pid).ok()?;
    let mut usage = std::mem::MaybeUninit::<libc::rusage_info_v2>::zeroed();
    let result = unsafe {
        libc::proc_pid_rusage(
            pid,
            libc::RUSAGE_INFO_V2,
            usage.as_mut_ptr().cast::<libc::rusage_info_t>(),
        )
    };
    (result == 0).then(|| unsafe { usage.assume_init().ri_resident_size })
}

#[cfg(target_os = "linux")]
fn child_rss(pid: u32) -> Option<u64> {
    let status = fs::read_to_string(format!("/proc/{pid}/status")).ok()?;
    let kb = status
        .lines()
        .find_map(|line| line.strip_prefix("VmRSS:"))?
        .split_whitespace()
        .next()?
        .parse::<u64>()
        .ok()?;
    Some(kb.saturating_mul(1024))
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn child_rss(_pid: u32) -> Option<u64> {
    None
}

#[cfg(not(unix))]
fn terminate_process_group(_pid: u32) {}

#[cfg(unix)]
fn terminate_process_group(pid: u32) {
    if let Ok(pid) = i32::try_from(pid) {
        unsafe {
            libc::kill(-pid, libc::SIGKILL);
        }
    }
}

fn unavailable(message: impl Into<String>) -> Refusal {
    Refusal::new(
        "E_ASSET_NOT_READY",
        "input",
        message,
        "install the sibling snapback2-media helper with image codecs or set SNAPBACK2_MEDIA in tests",
        "assets/helper",
    )
}

fn asset_type(message: impl Into<String>) -> Refusal {
    Refusal::new(
        "E_ASSET_TYPE",
        "input",
        message,
        "upload a supported image whose decoder finishes within the safety ceilings",
        "assets/helper",
    )
}

fn too_large(message: impl Into<String>) -> Refusal {
    Refusal::new(
        "E_ASSET_TOO_LARGE",
        "input",
        message,
        "upload an image within the fixed decode-safety ceilings",
        "assets/helper",
    )
}

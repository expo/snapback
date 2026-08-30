use super::*;

pub(super) fn run_with_stdin(binary: &str, args: &[&str], input: &Value) -> std::process::Output {
    let mut child = Command::new(binary)
        .args(args)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .spawn()
        .unwrap();
    child
        .stdin
        .take()
        .unwrap()
        .write_all(serde_json::to_string(input).unwrap().as_bytes())
        .unwrap();
    child.wait_with_output().unwrap()
}

pub(super) struct ChildGuard {
    child: Child,
    stdout: BufReader<std::process::ChildStdout>,
}

impl ChildGuard {
    pub(super) fn spawn(binary: &str, compiler: &Path, root: &Path) -> Self {
        Self::spawn_with(binary, compiler, root, false)
    }

    pub(super) fn spawn_with(binary: &str, compiler: &Path, root: &Path, serve: bool) -> Self {
        let mut command = Command::new(binary);
        command
            .args(["dev", "--project"])
            .arg(root)
            .arg("--foreground")
            .env("SNAPBACK2_COMPILER", compiler)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if serve {
            command.arg("--serve");
        }
        let mut child = command.spawn().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Self { child, stdout }
    }

    pub(super) fn ready_line(&mut self) -> String {
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        line
    }

    pub(super) fn wait(&mut self) {
        let started = Instant::now();
        while started.elapsed() < Duration::from_secs(5) {
            if let Some(status) = self.child.try_wait().unwrap() {
                assert!(status.success(), "owner exited {status}");
                return;
            }
            thread::sleep(Duration::from_millis(25));
        }
        panic!("owner did not stop");
    }
}

impl Drop for ChildGuard {
    fn drop(&mut self) {
        if self.child.try_wait().ok().flatten().is_none() {
            let _ = self.child.kill();
            let _ = self.child.wait();
        }
    }
}

#[cfg(unix)]
pub(super) struct DetachedOwnerGuard {
    pub(super) pid: u32,
}

#[cfg(unix)]
impl Drop for DetachedOwnerGuard {
    fn drop(&mut self) {
        if self.pid != 0 && process_alive(self.pid) {
            let _ = Command::new("kill").arg(self.pid.to_string()).status();
        }
    }
}

#[cfg(unix)]
pub(super) fn process_alive(pid: u32) -> bool {
    if pid == 0 || pid > i32::MAX as u32 {
        return false;
    }
    unsafe extern "C" {
        fn kill(pid: i32, signal: i32) -> i32;
    }
    // SAFETY: signal 0 performs a liveness check and does not deliver a signal.
    unsafe { kill(pid as i32, 0) == 0 }
}

pub(super) fn wait_for<T>(timeout: Duration, mut check: impl FnMut() -> Option<T>) -> T {
    let started = Instant::now();
    while started.elapsed() < timeout {
        if let Some(value) = check() {
            return value;
        }
        thread::sleep(Duration::from_millis(100));
    }
    panic!("condition did not become true in {timeout:?}");
}

#[cfg(not(feature = "hermes"))]
pub(super) fn seed_effect_row(
    root: &Path,
    binary: &str,
    compiler: &Path,
    result: Option<Value>,
) -> u64 {
    let checked = Command::new(binary)
        .args(["check", "--project"])
        .arg(root)
        .env("SNAPBACK2_COMPILER", compiler)
        .output()
        .unwrap();
    assert!(
        checked.status.success(),
        "{} {}",
        String::from_utf8_lossy(&checked.stdout),
        String::from_utf8_lossy(&checked.stderr)
    );
    let mut project: ProjectJson =
        serde_json::from_slice(&fs::read(root.join(".snapback/build/project.json")).unwrap())
            .unwrap();
    project.programs.push(Program {
        name: "__test.emitEffect".to_owned(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::new(),
        read_time_granularity_ms: None,
        body: vec![Stmt::Emit {
            effect: "notifications.notify".to_owned(),
            payload: Expr::Literal(snapback2_core::Value::Null),
        }],
    });
    let generation = Generation::certify(&project, Ceilings::default()).unwrap();
    let mut runtime = Runtime::open(
        Store::open(&root.join(".snapback/store.sqlite")).unwrap(),
        generation,
    )
    .unwrap();
    let mut context = CoreContext::mutation(
        snapback2_core::Actor::persona("test").unwrap(),
        BTreeMap::new(),
    );
    context.now = Some(1);
    context.new_ids = VecDeque::from(["seeded-outbox".to_owned()]);
    let execution = runtime.execute("__test.emitEffect", context).unwrap();
    if let Some(result) = result {
        runtime
            .store()
            .outbox_claim_next(1, &["notifications.notify".to_owned()])
            .unwrap()
            .expect("seeded outbox claim");
        runtime
            .store()
            .outbox_settle("seeded-outbox", "then_pending", Some(&result), None, None)
            .unwrap();
    }
    execution.seq
}

#[cfg(not(feature = "hermes"))]
pub(super) fn stop_owner(port: u16, secret: &str, owner: &mut ChildGuard, cause: &str) {
    let stopped = request(
        port,
        "POST",
        "/control/stop",
        &[("X-Snapback-Control", secret)],
        json!({ "cause": cause }),
    );
    assert_eq!(stopped.status, 200, "{}", stopped.body);
    owner.wait();
}

pub(super) fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/compiler/fixtures/chat")
}

pub(super) fn compiler() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/snapback2/dist/compiler.mjs")
}

pub(super) fn write_worker(root: &Path, name: &str, source: &str) -> PathBuf {
    let path = root.join(name);
    fs::write(&path, source).unwrap();
    path
}

pub(super) fn temp_root() -> PathBuf {
    static NEXT_ROOT: AtomicU64 = AtomicU64::new(0);
    let path = std::env::temp_dir().join(format!(
        "snapback2-owner-test-{}-{}-{}",
        std::process::id(),
        NEXT_ROOT.fetch_add(1, Ordering::Relaxed),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&path).unwrap();
    path
}

pub(super) fn copy_tree(from: &Path, to: &Path) {
    fs::create_dir_all(to).unwrap();
    for entry in fs::read_dir(from).unwrap().flatten() {
        let destination = to.join(entry.file_name());
        if entry.path().is_dir() {
            copy_tree(&entry.path(), &destination);
        } else {
            fs::copy(entry.path(), destination).unwrap();
        }
    }
}

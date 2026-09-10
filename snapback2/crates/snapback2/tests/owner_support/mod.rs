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
        Self::spawn_with_user(binary, compiler, root, serve, None)
    }

    pub(super) fn spawn_with_user(
        binary: &str,
        compiler: &Path,
        root: &Path,
        serve: bool,
        user: Option<&str>,
    ) -> Self {
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
        if let Some(user) = user {
            command.env("USER", user);
        }
        let mut child = command.spawn().unwrap();
        let stdout = BufReader::new(child.stdout.take().unwrap());
        Self { child, stdout }
    }

    pub(super) fn ready_line(&mut self) -> String {
        let mut line = String::new();
        self.stdout.read_line(&mut line).unwrap();
        if line.is_empty() {
            let mut error = String::new();
            self.child
                .stderr
                .as_mut()
                .unwrap()
                .read_to_string(&mut error)
                .unwrap();
            panic!("owner exited before ready: {error}");
        }
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
    seed_effect_rows(root, binary, compiler, &[("seeded-outbox", result)])[0]
}

/// Emits one `delivery.notify` per id, each in its own commit, without an
/// owner. A row given a result is then claimed and settled `then_pending`,
/// exactly as the runner leaves a row whose provider answered; one without
/// stays `queued`. Returns each emission's seq, in order.
#[cfg(not(feature = "hermes"))]
pub(super) fn seed_effect_rows(
    root: &Path,
    binary: &str,
    compiler: &Path,
    rows: &[(&str, Option<Value>)],
) -> Vec<u64> {
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
            effect: "delivery.notify".to_owned(),
            payload: Expr::Literal(snapback2_core::Value::Null),
        }],
    });
    let generation = Generation::certify(&project, Ceilings::default()).unwrap();
    let mut runtime = Runtime::open(
        Store::open(&root.join(".snapback/store.sqlite")).unwrap(),
        generation,
    )
    .unwrap();
    rows.iter()
        .map(|(id, result)| {
            let mut context = CoreContext::mutation(
                snapback2_core::Actor::persona("test").unwrap(),
                BTreeMap::new(),
            );
            context.now = Some(1);
            context.new_ids = VecDeque::from([(*id).to_owned()]);
            let execution = runtime.execute("__test.emitEffect", context).unwrap();
            if let Some(result) = result {
                let claimed = runtime
                    .store()
                    .outbox_claim_next(1, &["delivery.notify".to_owned()])
                    .unwrap()
                    .claimed
                    .expect("seeded outbox claim");
                assert_eq!(claimed.id, *id, "the claim must take the row just emitted");
                runtime
                    .store()
                    .outbox_settle(id, "then_pending", Some(result), None, None)
                    .unwrap();
            }
            execution.seq
        })
        .collect()
}

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

/// Seeds 405 outbox rows across two seqs without an owner: 404 rows in `state`
/// and one `sent` row whose result exceeds the 16 KiB cap. The ungated paging
/// test passes `failed`, which no engine can claim mid-test; the engine-none
/// settle test passes `queued`. `check` writes the project; `Store::open` lays
/// the schema the owner will adopt at boot.
pub(super) fn seed_paged_outbox(root: &Path, binary: &str, compiler: &Path, state: &str) {
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
    let store = root.join(".snapback/store.sqlite");
    drop(snapback2_core::Store::open(&store).unwrap());
    let conn = rusqlite::Connection::open(&store).unwrap();
    for i in 0..405 {
        conn.execute(
            "INSERT INTO _outbox (id,seq,effect,payload,state,attempts,next_at,created_at,updated_at,result)
             VALUES (?1,?2,'delivery.notify','\"Null\"',?3,0,0,0,0,?4)",
            rusqlite::params![
                format!("paged-{i:04}"),
                1 + i / 203,
                if i == 404 { "sent" } else { state },
                if i == 404 {
                    Some(json!("x".repeat(17000)).to_string())
                } else {
                    None
                }
            ],
        )
        .unwrap();
    }
}

pub(super) fn fixture() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR")).join("../../packages/compiler/fixtures/quarry-chat")
}

pub(super) fn compiler(root: &Path) -> PathBuf {
    super::common::isolated_compiler(&root.join(".test-package"))
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

use rusqlite::{Connection, TransactionBehavior, params};
use snapback::auth::crypto::OsRandom;
use snapback::auth::invalidation::{
    LiveInvalidationIssuer, ObligationRegistry, QueryNamespace, ScopeId,
};
use snapback::auth::keyring::AuthKeyringStore;
use snapback::auth::provider::{AuthProvider, AuthProviderProfile};
use snapback::local::LocalSnapback;
use snapback_kernel::storage::{LocalDatabase, ServingDatabase};
use std::fs;
use std::io::Write as _;
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};

const BOOT_SEQUENCE_META_KEY: &str = "auth_invalidation_boot_sequence_v1";
const BOOT_ISSUANCE_META_KEY: &str = "auth_invalidation_boot_issuance_v1";

fn durable_boot_state(path: &Path) -> (String, String) {
    let connection = Connection::open(path).expect("open dependent readback connection");
    let sequence = connection
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key = ?1",
            [BOOT_SEQUENCE_META_KEY],
            |row| row.get(0),
        )
        .expect("durable invalidation boot sequence");
    let issuance = connection
        .query_row(
            "SELECT value FROM _snapback_meta WHERE key = ?1",
            [BOOT_ISSUANCE_META_KEY],
            |row| row.get(0),
        )
        .expect("durable invalidation boot issuance");
    (sequence, issuance)
}

fn durable_boot_epoch(path: &Path) -> (u64, String, String) {
    Connection::open(path)
        .expect("open boot epoch readback connection")
        .query_row(
            "SELECT boot_sequence, database_open_owner_id, authorization_incarnation
             FROM _snapback_auth_invalidation_boot_epoch_v1 WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("durable monotone invalidation boot epoch")
}

fn durable_boot_reservation(path: &Path) -> (u64, String, String) {
    Connection::open(path)
        .expect("open boot reservation readback connection")
        .query_row(
            "SELECT boot_sequence, database_open_owner_id, authorization_incarnation
             FROM _snapback_auth_invalidation_boot_reservation_v1 WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .expect("durable authentic invalidation boot reservation")
}

fn assert_boot_projection_matches_epoch(path: &Path) {
    let (sequence, issuance) = durable_boot_state(path);
    let issuance: serde_json::Value =
        serde_json::from_str(&issuance).expect("canonical durable issuance JSON");
    let epoch = durable_boot_epoch(path);
    let reservation = durable_boot_reservation(path);
    assert_eq!(
        sequence.parse::<u64>().expect("canonical sequence"),
        epoch.0
    );
    assert_eq!(issuance["bootSequence"], epoch.0);
    assert_eq!(issuance["databaseOpenOwnerId"], epoch.1);
    assert_eq!(issuance["authorizationIncarnation"], epoch.2);
    assert_eq!(reservation, epoch);
}

fn invalidation_provider() -> AuthProvider {
    let keyring = Arc::new(AuthKeyringStore::in_memory());
    keyring
        .load_or_mint_initial(1, &OsRandom)
        .expect("mint invalidation protocol key");
    AuthProvider::new(AuthProviderProfile::Test, keyring).expect("construct invalidation provider")
}

fn live_issuer_at_path(path: &Path) -> LiveInvalidationIssuer {
    let local = LocalDatabase::open(path).expect("open low-level dependent database");
    let mut database = ServingDatabase::adopt(local).expect("adopt low-level serving database");
    let reservation = database
        .reserve_invalidation_boot_issuer()
        .expect("reserve dependent boot issuer");
    let participant = database
        .take_authorization_commit_participant()
        .expect("take dependent authorization participant");
    database
        .bind_authorization_commit_participant(&participant)
        .expect("bind dependent authorization participant");
    let view = database
        .authorization_expectation_view_for_participant_install(&participant)
        .expect("derive dependent authorization expectation");
    invalidation_provider()
        .authenticate_invalidation_boot_issuer(
            reservation,
            view,
            "local-dev-sqlite-ibex",
            "q43-dependent",
        )
        .expect("authenticate dependent boot issuer")
}

fn subscription_scope(
    issuer_id: snapback::auth::invalidation::IssuerId,
    scope_sequence: u64,
    subscription_id: &str,
) -> ScopeId {
    ScopeId::Subscription {
        issuer_id,
        namespace: QueryNamespace {
            client_store_id: "q43-client".to_owned(),
            query_key: "q43-query".to_owned(),
            query_instance_id: 1,
        },
        scope_sequence,
        connection_generation: 1,
        subscription_id: subscription_id.to_owned(),
    }
}

fn write_boot_state(path: &Path, state: &(String, String)) {
    fs::write(path, format!("{}\n{}", state.0, state.1)).expect("write cross-process boot state");
}

fn read_boot_state(path: &Path) -> (String, String) {
    let encoded = fs::read_to_string(path).expect("read cross-process boot state");
    let (sequence, issuance) = encoded
        .split_once('\n')
        .expect("cross-process boot state separator");
    (sequence.to_owned(), issuance.to_owned())
}

fn wait_for_file(path: &Path, child: Option<&mut std::process::Child>) {
    let deadline = Instant::now() + Duration::from_secs(20);
    let mut child = child;
    while !path.exists() {
        if let Some(process) = child.as_deref_mut()
            && let Some(status) = process.try_wait().expect("poll cross-process actor")
        {
            panic!(
                "cross-process actor exited before {}: {status}",
                path.display()
            );
        }
        assert!(
            Instant::now() < deadline,
            "timed out waiting for {}",
            path.display()
        );
        thread::sleep(Duration::from_millis(10));
    }
}

fn run_successor(database: &Path, coordination: &Path) -> std::process::Output {
    let executable = std::env::current_exe().expect("resolve dependent-crate test executable");
    let ready = coordination.join("unused-holder-ready");
    let successor_done = coordination.join("successor-done");
    let successor_state = coordination.join("successor-state");
    Command::new(executable)
        .args([
            "--ignored",
            "--exact",
            "auth_invalidation_boot_cross_process_actor",
            "--nocapture",
        ])
        .env("SNAPBACK_Q43_ACTOR", "successor")
        .env("SNAPBACK_Q43_DATABASE", database)
        .env("SNAPBACK_Q43_READY", ready)
        .env("SNAPBACK_Q43_SUCCESSOR_DONE", successor_done)
        .env("SNAPBACK_Q43_SUCCESSOR_STATE", successor_state)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output()
        .expect("run successor process")
}

fn assert_successor_succeeded(output: &std::process::Output) {
    assert!(
        output.status.success(),
        "successor process failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
}

fn assert_retired(error: &snapback::diagnostic::SnapbackError) {
    assert_eq!(
        error.diagnostic.code,
        "SNAPBACK_AUTH_INVALIDATION_ISSUER_RETIRED"
    );
    assert_eq!(
        error.diagnostic.message,
        "authorization invalidation issuer was retired by a newer durable boot issuance"
    );
}

// @ref LLP 0303#move-semantics-protect-the-handle-not-the-fact — this
// dependent crate calls the complete producer twice, observes the durable
// refusal, and reads back the exact record that made the replay lose.
#[test]
fn second_full_install_is_durably_refused_while_first_registry_remains_live() {
    let directory = tempfile::tempdir().expect("temporary dependent database");
    let path = directory.path().join("q43.sqlite3");
    let mut snapback = LocalSnapback::open(&path).expect("open local engine");
    let provider = invalidation_provider();

    let first = snapback
        .install_authenticated_auth_invalidation(&provider, None)
        .expect("install the first complete issuer/registry path");
    let before = durable_boot_state(&path);
    assert_eq!(before.0, "1");
    assert_boot_projection_matches_epoch(&path);
    let issuance: serde_json::Value =
        serde_json::from_str(&before.1).expect("canonical durable issuance JSON");
    assert_eq!(issuance["bootSequence"], 1);
    assert_eq!(
        issuance["authorizationIncarnation"],
        first
            .authorization_expectation()
            .expect("first authorization")
            .incarnation
    );
    assert!(
        issuance["databaseOpenOwnerId"]
            .as_str()
            .is_some_and(|owner| !owner.is_empty())
    );

    let refused = match snapback.install_authenticated_auth_invalidation(&provider, None) {
        Ok(_) => panic!("a second producer call in one database lifetime must lose durably"),
        Err(error) => error,
    };
    assert_eq!(
        refused.diagnostic.code,
        "SNAPBACK_AUTH_INVALIDATION_BOOT_ALREADY_ACTIVE"
    );
    assert_eq!(
        refused.diagnostic.message,
        "authorization invalidation boot issuer is already active for this database lifetime"
    );

    let after = durable_boot_state(&path);
    assert_eq!(
        after, before,
        "refusal must not mutate either durable record"
    );
    assert_boot_projection_matches_epoch(&path);

    let still_live = first
        .prepare_connection()
        .expect("the first registry remains the only live identifier issuer");
    assert_eq!(still_live.issuer_id.boot_sequence, 1);
    assert_eq!(still_live.connection_generation, 1);
    assert!(still_live.issuer_retirement.is_none());
    assert_eq!(
        snapback
            .auth_invalidation_expectation_for_test()
            .expect("engine retained its first registry"),
        still_live.authorization
    );
}

// @ref LLP 0303#enumerate-the-siblings-or-the-review-will —
// external callers can still construct ScopeId wire values, but fresh registry
// creation, registration, retirement, and the installed signer all revalidate
// the same durable issuer immediately around their mutation/signing effect.
#[test]
fn retired_boot_refuses_fresh_and_existing_registry_mutations_across_processes() {
    let fresh_directory = tempfile::tempdir().expect("fresh-registry directory");
    let fresh_database = fresh_directory.path().join("fresh.sqlite3");
    let fresh_issuer = live_issuer_at_path(&fresh_database);
    let successor = run_successor(&fresh_database, fresh_directory.path());
    assert_successor_succeeded(&successor);
    let successor_rows = durable_boot_state(&fresh_database);
    assert_eq!(successor_rows.0, "2");
    let error = match ObligationRegistry::new(fresh_issuer) {
        Ok(_) => panic!("fresh registry constructed from a retired boot issuer"),
        Err(error) => error,
    };
    assert_retired(&error);
    assert_eq!(durable_boot_state(&fresh_database), successor_rows);
    assert_boot_projection_matches_epoch(&fresh_database);
    println!(
        "REGISTRY_FRESH_REFUSED code={} durable_sequence={}",
        error.diagnostic.code, successor_rows.0
    );

    let mutation_directory = tempfile::tempdir().expect("registry-mutation directory");
    let mutation_database = mutation_directory.path().join("mutations.sqlite3");
    let live = live_issuer_at_path(&mutation_database);
    let namespace = QueryNamespace {
        client_store_id: "q43-client".to_owned(),
        query_key: "q43-query".to_owned(),
        query_instance_id: 1,
    };
    let mut registry = ObligationRegistry::new(live).expect("construct boot-1 registry");
    let issuer_id = registry
        .installed_issuer()
        .authenticated()
        .issuer_id
        .clone();
    let first = subscription_scope(issuer_id.clone(), 1, "first");
    registry
        .register_live_scope(first.clone(), "owner-first")
        .expect("register boot-1 scope before retirement");

    let successor = run_successor(&mutation_database, mutation_directory.path());
    assert_successor_succeeded(&successor);
    let successor_rows = durable_boot_state(&mutation_database);
    let crafted = subscription_scope(issuer_id, 2, "crafted-after-retirement");
    let cause_allocation = registry
        .reserve_cause_sequence()
        .expect_err("retired registry must not allocate a cause sequence");
    assert_retired(&cause_allocation);
    assert_eq!(durable_boot_state(&mutation_database), successor_rows);

    let registration = registry
        .register_live_scope(crafted, "owner-crafted")
        .expect_err("public ScopeId construction must not bypass retirement");
    assert_retired(&registration);
    assert_eq!(durable_boot_state(&mutation_database), successor_rows);

    let retirement = registry
        .retire_scope(&first)
        .expect_err("retired registry must not retire an existing scope");
    assert_retired(&retirement);
    assert_eq!(durable_boot_state(&mutation_database), successor_rows);

    let signing = registry
        .installed_issuer()
        .authenticate_scope_retirement(namespace, 1)
        .expect_err("installed signer must not sign for a retired boot");
    assert_retired(&signing);
    assert_eq!(durable_boot_state(&mutation_database), successor_rows);
    assert_boot_projection_matches_epoch(&mutation_database);
    println!(
        "REGISTRY_MUTATIONS_REFUSED cause={} register={} retire={} signer={} durable_sequence={}",
        cause_allocation.diagnostic.code,
        registration.diagnostic.code,
        retirement.diagnostic.code,
        signing.diagnostic.code,
        successor_rows.0
    );
}

// @ref LLP 0303#a-durable-record-is-checked-at-acquisition-a-live-handle-outlives-it
// — this ignored helper is launched as two distinct OS processes so process A
// keeps an installed sequence-1 issuer across process B's durable sequence-2
// installation and then exercises A's point-of-use currentness check.
#[test]
#[ignore = "cross-process helper launched by the parent regression"]
fn auth_invalidation_boot_cross_process_actor() {
    let role = std::env::var("SNAPBACK_Q43_ACTOR").expect("cross-process actor role");
    let database = std::env::var_os("SNAPBACK_Q43_DATABASE")
        .map(std::path::PathBuf::from)
        .expect("cross-process database path");
    let ready = std::env::var_os("SNAPBACK_Q43_READY")
        .map(std::path::PathBuf::from)
        .expect("cross-process ready path");
    let successor_done = std::env::var_os("SNAPBACK_Q43_SUCCESSOR_DONE")
        .map(std::path::PathBuf::from)
        .expect("cross-process successor-done path");
    let successor_state = std::env::var_os("SNAPBACK_Q43_SUCCESSOR_STATE")
        .map(std::path::PathBuf::from)
        .expect("cross-process successor-state path");

    match role.as_str() {
        "holder" => {
            let mut snapback = LocalSnapback::open(&database).expect("process A opens database");
            let issuer = snapback
                .install_authenticated_auth_invalidation(&invalidation_provider(), None)
                .expect("process A installs boot sequence 1");
            let first_connection = issuer
                .prepare_connection()
                .expect("process A issues its initial connection");
            println!(
                "FULL_HOLDING sequence={} connection_generation={}",
                first_connection.issuer_id.boot_sequence, first_connection.connection_generation
            );
            std::io::stdout()
                .flush()
                .expect("flush process A holding line");
            fs::write(&ready, b"ready").expect("publish process A readiness");

            wait_for_file(&successor_done, None);
            let installed_by_b = read_boot_state(&successor_state);
            assert_eq!(
                durable_boot_state(&database),
                installed_by_b,
                "process A must observe process B's exact durable boot state before issuing"
            );
            assert_boot_projection_matches_epoch(&database);

            let refused = match issuer.prepare_connection() {
                Ok(connection) => panic!(
                    "FULL_STILL_LIVE sequence={} connection_generation={}",
                    connection.issuer_id.boot_sequence, connection.connection_generation
                ),
                Err(error) => error,
            };
            println!(
                "FULL_REFUSED code={} message={}",
                refused.diagnostic.code, refused.diagnostic.message
            );
            assert_eq!(
                refused.diagnostic.code,
                "SNAPBACK_AUTH_INVALIDATION_ISSUER_RETIRED"
            );
            assert_eq!(
                refused.diagnostic.message,
                "authorization invalidation issuer was retired by a newer durable boot issuance"
            );
            assert_eq!(
                durable_boot_state(&database),
                installed_by_b,
                "process A's refused issuance must not change either durable boot row"
            );
            assert_boot_projection_matches_epoch(&database);
            println!(
                "FULL_STILL_DURABLE sequence={} issuer_sequence={}",
                installed_by_b.0,
                serde_json::from_str::<serde_json::Value>(&installed_by_b.1)
                    .expect("process B issuance JSON")["bootSequence"]
            );
        }
        "successor" => {
            let mut snapback = LocalSnapback::open(&database).expect("process B opens database");
            let issuer = snapback
                .install_authenticated_auth_invalidation(&invalidation_provider(), None)
                .expect("process B installs boot sequence 2");
            let connection = issuer
                .prepare_connection()
                .expect("process B issues from boot sequence 2");
            let state = durable_boot_state(&database);
            assert_eq!(state.0, "2");
            assert_eq!(
                serde_json::from_str::<serde_json::Value>(&state.1)
                    .expect("process B issuance JSON")["bootSequence"],
                2
            );
            assert_boot_projection_matches_epoch(&database);
            write_boot_state(&successor_state, &state);
            println!(
                "FULL_ISSUED sequence={} issuer_sequence={} connection_generation={}",
                state.0, connection.issuer_id.boot_sequence, connection.connection_generation
            );
            std::io::stdout()
                .flush()
                .expect("flush process B issued line");
            fs::write(&successor_done, b"done").expect("publish process B completion");
        }
        "timed_successor" => {
            let release = std::env::var_os("SNAPBACK_Q43_RELEASE")
                .map(std::path::PathBuf::from)
                .expect("timed successor release path");
            // Open the genuine successor before taking the synthetic blocker,
            // then queue its production reservation path behind that blocker.
            // Process A queues later, so release lets B commit the authentic
            // reservation/epoch before A's point-of-use transaction reads.
            let mut snapback =
                LocalSnapback::open(&database).expect("process B opens genuine successor database");
            let mut blocker = Connection::open(&database).expect("process B opens writer blocker");
            blocker
                .execute_batch("PRAGMA busy_timeout = 5000;")
                .expect("configure process B writer blocker");
            let tx = blocker
                .transaction_with_behavior(TransactionBehavior::Immediate)
                .expect("process B takes singleton writer");
            let installer = thread::spawn(move || {
                snapback
                    .install_authenticated_auth_invalidation(&invalidation_provider(), None)
                    .expect("process B installs an authentic boot-2 reservation")
            });
            // Give the production reservation call a deterministic head start
            // into SQLite's busy wait before publishing readiness to process A.
            thread::sleep(Duration::from_millis(50));
            fs::write(&ready, b"writer-held").expect("publish process B writer lock");
            wait_for_file(&release, None);
            tx.commit().expect("release process B writer blocker");
            let issuer = installer
                .join()
                .expect("join authentic process B installer");
            let connection = issuer
                .prepare_connection()
                .expect("process B issues from authentic boot sequence 2");
            let state = durable_boot_state(&database);
            assert_eq!(state.0, "2");
            write_boot_state(&successor_state, &state);
            assert_boot_projection_matches_epoch(&database);
            println!(
                "TOCTOU_SUCCESSOR sequence={} epoch_sequence={} connection_generation={}",
                state.0,
                durable_boot_epoch(&database).0,
                connection.connection_generation
            );
            std::io::stdout()
                .flush()
                .expect("flush timed successor line");
            fs::write(&successor_done, b"done").expect("publish timed successor completion");
        }
        _ => panic!("unknown cross-process actor role: {role}"),
    }
}

#[test]
fn retired_boot_issuer_is_refused_at_point_of_use_across_processes() {
    let directory = tempfile::tempdir().expect("temporary cross-process directory");
    let database = directory.path().join("q43-cross-process.sqlite3");
    let ready = directory.path().join("holder-ready");
    let successor_done = directory.path().join("successor-done");
    let successor_state = directory.path().join("successor-state");
    let executable = std::env::current_exe().expect("resolve dependent-crate test executable");
    let actor = |role: &str| {
        let mut command = Command::new(&executable);
        command
            .args([
                "--ignored",
                "--exact",
                "auth_invalidation_boot_cross_process_actor",
                "--nocapture",
            ])
            .env("SNAPBACK_Q43_ACTOR", role)
            .env("SNAPBACK_Q43_DATABASE", &database)
            .env("SNAPBACK_Q43_READY", &ready)
            .env("SNAPBACK_Q43_SUCCESSOR_DONE", &successor_done)
            .env("SNAPBACK_Q43_SUCCESSOR_STATE", &successor_state)
            .stdin(Stdio::null())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        command
    };

    let mut holder = actor("holder").spawn().expect("launch process A");
    wait_for_file(&ready, Some(&mut holder));
    let successor = actor("successor")
        .output()
        .expect("run process B to completion");
    assert!(
        successor.status.success(),
        "process B failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&successor.stdout),
        String::from_utf8_lossy(&successor.stderr)
    );
    let holder = holder
        .wait_with_output()
        .expect("run process A through retired issuance");
    assert!(
        holder.status.success(),
        "process A failed:\nstdout:\n{}\nstderr:\n{}",
        String::from_utf8_lossy(&holder.stdout),
        String::from_utf8_lossy(&holder.stderr)
    );

    let holder_stdout = String::from_utf8(holder.stdout).expect("process A UTF-8 output");
    let successor_stdout = String::from_utf8(successor.stdout).expect("process B UTF-8 output");
    print!("{holder_stdout}{successor_stdout}");
    assert!(holder_stdout.contains("FULL_HOLDING sequence=1 connection_generation=1"));
    assert!(holder_stdout.contains(
        "FULL_REFUSED code=SNAPBACK_AUTH_INVALIDATION_ISSUER_RETIRED message=authorization invalidation issuer was retired by a newer durable boot issuance"
    ));
    assert!(holder_stdout.contains("FULL_STILL_DURABLE sequence=2 issuer_sequence=2"));
    assert!(!holder_stdout.contains("FULL_STILL_LIVE"));
    assert!(
        successor_stdout
            .contains("FULL_ISSUED sequence=2 issuer_sequence=2 connection_generation=1")
    );
    assert_eq!(
        durable_boot_state(&database),
        read_boot_state(&successor_state),
        "the final durable rows must remain exactly as process B installed them"
    );
    assert_boot_projection_matches_epoch(&database);
}

// A deferred reader can coexist with process B's RESERVED writer lock and
// would observe boot 1. BEGIN IMMEDIATE instead queues process A behind B, so
// B's committed boot 2 is the fact read, compared, and applied around A's
// attempted allocation.
#[test]
fn point_of_use_check_serializes_the_durable_read_decision_and_allocation() {
    let directory = tempfile::tempdir().expect("timed TOCTOU directory");
    let database = directory.path().join("timed-toctou.sqlite3");
    let ready = directory.path().join("writer-ready");
    let release = directory.path().join("writer-release");
    let successor_done = directory.path().join("writer-done");
    let successor_state = directory.path().join("writer-state");
    let mut snapback = LocalSnapback::open(&database).expect("process A opens database");
    let issuer = snapback
        .install_authenticated_auth_invalidation(&invalidation_provider(), None)
        .expect("process A installs boot 1");
    let first = issuer
        .prepare_connection()
        .expect("process A allocates generation 1");
    assert_eq!(first.connection_generation, 1);

    let executable = std::env::current_exe().expect("resolve dependent-crate test executable");
    let mut successor = Command::new(executable)
        .args([
            "--ignored",
            "--exact",
            "auth_invalidation_boot_cross_process_actor",
            "--nocapture",
        ])
        .env("SNAPBACK_Q43_ACTOR", "timed_successor")
        .env("SNAPBACK_Q43_DATABASE", &database)
        .env("SNAPBACK_Q43_READY", &ready)
        .env("SNAPBACK_Q43_RELEASE", &release)
        .env("SNAPBACK_Q43_SUCCESSOR_DONE", &successor_done)
        .env("SNAPBACK_Q43_SUCCESSOR_STATE", &successor_state)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("launch timed process B");
    wait_for_file(&ready, Some(&mut successor));

    let release_path = release.clone();
    let releaser = thread::spawn(move || {
        thread::sleep(Duration::from_millis(250));
        fs::write(release_path, b"commit").expect("release process B commit");
    });
    let started = Instant::now();
    let refused = issuer
        .prepare_connection()
        .expect_err("process A must read B's committed successor before allocating");
    let elapsed = started.elapsed();
    releaser.join().expect("join timed writer release");
    let successor = successor
        .wait_with_output()
        .expect("run timed process B to completion");
    assert_successor_succeeded(&successor);
    assert_retired(&refused);
    assert!(
        elapsed >= Duration::from_millis(200),
        "process A did not queue behind process B's immediate transaction: {elapsed:?}"
    );
    let installed_by_b = read_boot_state(&successor_state);
    assert_eq!(durable_boot_state(&database), installed_by_b);
    assert_boot_projection_matches_epoch(&database);
    println!(
        "TOCTOU_CALL refused={} durable_sequence={} epoch_sequence={} elapsed_ms={}",
        refused.diagnostic.code,
        installed_by_b.0,
        durable_boot_epoch(&database).0,
        elapsed.as_millis()
    );
    print!(
        "{}",
        String::from_utf8(successor.stdout).expect("timed successor UTF-8 output")
    );
}

// @ref LLP 0303#a-guard-held-in-per-handle-state-is-opt-in — an independent
// default SQLite handle can write compatibility projections, but it has no
// kernel reservation authority. The epoch trigger consumes only a durable
// reservation created by the connection-owned pending tuple.
#[test]
fn raw_dml_cannot_forge_a_coherent_boot_advance_or_retire_the_live_issuer() {
    let directory = tempfile::tempdir().expect("raw-DML reservation directory");
    let database = directory.path().join("raw-dml.sqlite3");
    let mut snapback = LocalSnapback::open(&database).expect("open live boot-1 database");
    let issuer = snapback
        .install_authenticated_auth_invalidation(&invalidation_provider(), None)
        .expect("install legitimate boot-1 issuer");
    let first = issuer
        .prepare_connection()
        .expect("allocate boot-1 connection generation 1");
    assert_eq!(first.connection_generation, 1);
    let before = durable_boot_state(&database);
    let before_epoch = durable_boot_epoch(&database);
    let before_reservation = durable_boot_reservation(&database);
    assert_boot_projection_matches_epoch(&database);

    let attacker_sequence = before_epoch.0 + 1;
    let attacker_owner = "6f2a7b14-6963-4abe-9000-61b582ec317b";
    assert_ne!(attacker_owner, before_epoch.1);
    let attacker_issuance = format!(
        "{{\"databaseOpenOwnerId\":\"{attacker_owner}\",\"authorizationIncarnation\":\"{}\",\"bootSequence\":{attacker_sequence}}}",
        before_epoch.2
    );
    let mut raw = Connection::open(&database).expect("open raw default SQLite connection");
    let tx = raw
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .expect("begin coherent raw-DML advance");
    assert_eq!(
        tx.execute(
            "UPDATE _snapback_meta SET value = ?1 WHERE key = ?2",
            params![attacker_sequence.to_string(), BOOT_SEQUENCE_META_KEY],
        )
        .expect("stage attacker sequence projection"),
        1
    );
    assert_eq!(
        tx.execute(
            "UPDATE _snapback_meta SET value = ?1 WHERE key = ?2",
            params![attacker_issuance, BOOT_ISSUANCE_META_KEY],
        )
        .expect("stage attacker issuance projection"),
        1
    );
    let epoch_forgery = tx
        .execute(
            "UPDATE _snapback_auth_invalidation_boot_epoch_v1
             SET boot_sequence = ?1, database_open_owner_id = ?2,
                 authorization_incarnation = ?3
             WHERE id = 1 AND boot_sequence = ?4",
            params![
                attacker_sequence,
                attacker_owner,
                before_epoch.2,
                before_epoch.0
            ],
        )
        .expect_err("epoch advance without a genuine reservation must roll back");
    drop(tx);

    assert_eq!(durable_boot_state(&database), before);
    assert_eq!(durable_boot_epoch(&database), before_epoch);
    assert_eq!(durable_boot_reservation(&database), before_reservation);
    let reservation_forgery = raw
        .execute(
            "UPDATE _snapback_auth_invalidation_boot_reservation_v1
             SET boot_sequence = ?1, database_open_owner_id = ?2,
                 authorization_incarnation = ?3
             WHERE id = 1 AND boot_sequence = ?4",
            params![
                attacker_sequence,
                attacker_owner,
                before_epoch.2,
                before_epoch.0
            ],
        )
        .expect_err("raw DML must not manufacture the missing reservation");
    assert_eq!(durable_boot_state(&database), before);
    assert_eq!(durable_boot_epoch(&database), before_epoch);
    assert_eq!(durable_boot_reservation(&database), before_reservation);

    let still_live = issuer
        .prepare_connection()
        .expect("legitimate boot-1 issuer remains current after refused raw DML");
    assert_eq!(still_live.issuer_id.boot_sequence, 1);
    assert_eq!(still_live.connection_generation, 2);
    assert_boot_projection_matches_epoch(&database);
    println!(
        "RAW_DML_REFUSED epoch={} reservation={} durable_sequence={} legitimate_boot={} legitimate_generation={}",
        epoch_forgery,
        reservation_forgery,
        before.0,
        still_live.issuer_id.boot_sequence,
        still_live.connection_generation
    );
}

// @ref LLP 0303#a-durable-record-is-checked-at-acquisition-a-live-handle-outlives-it
// — the compatibility JSON rows may be restored by raw SQL, but the guarded
// singleton epoch has a structurally increasing update rule and remains the
// non-replayable currentness authority.
#[test]
fn canonical_projection_replay_does_not_resurrect_a_retired_issuer() {
    let directory = tempfile::tempdir().expect("poison replay directory");
    let database = directory.path().join("poison.sqlite3");
    let mut snapback = LocalSnapback::open(&database).expect("process A opens poison database");
    let issuer = snapback
        .install_authenticated_auth_invalidation(&invalidation_provider(), None)
        .expect("process A installs poison holding issuer");
    let first = issuer
        .prepare_connection()
        .expect("process A allocates poison generation 1");
    assert_eq!(first.connection_generation, 1);
    let holding = durable_boot_state(&database);
    let holding_epoch = durable_boot_epoch(&database);
    println!(
        "POISON_HOLDING sequence={} issuance={}",
        holding.0, holding.1
    );

    let successor = run_successor(&database, directory.path());
    assert_successor_succeeded(&successor);
    let successor_rows = durable_boot_state(&database);
    let successor_epoch = durable_boot_epoch(&database);
    assert_eq!(successor_rows.0, "2");
    assert_eq!(successor_epoch.0, 2);
    println!(
        "POISON_SUCCESSOR sequence={} issuance={}",
        successor_rows.0, successor_rows.1
    );
    let first_refusal = issuer
        .prepare_connection()
        .expect_err("retired issuer must first refuse against successor rows");
    assert_retired(&first_refusal);

    let mut raw = Connection::open(&database).expect("open raw poison writer");
    let decrement = raw
        .execute(
            "UPDATE _snapback_auth_invalidation_boot_epoch_v1
             SET boot_sequence = 1 WHERE id = 1",
            [],
        )
        .expect_err("ordinary DML must not decrement the monotone epoch");
    let deletion = raw
        .execute(
            "DELETE FROM _snapback_auth_invalidation_boot_epoch_v1 WHERE id = 1",
            [],
        )
        .expect_err("ordinary DML must not delete the monotone epoch");
    let replacement = raw
        .execute(
            "INSERT OR REPLACE INTO _snapback_auth_invalidation_boot_epoch_v1(
                 id, boot_sequence, database_open_owner_id, authorization_incarnation
             ) VALUES(1, 1, '6f2a7b14-6963-4abe-9000-61b582ec317b',
                      '01a03804-490a-7650-8ee2-8dcb84640c2d')",
            [],
        )
        .expect_err("ordinary DML must not replace the monotone epoch");
    assert_eq!(durable_boot_epoch(&database), successor_epoch);
    println!(
        "POISON_AUDIT decrement={} delete={} replace={} epoch_sequence={}",
        decrement, deletion, replacement, successor_epoch.0
    );

    let tx = raw
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .expect("begin raw poison transaction");
    assert_eq!(
        tx.execute(
            "UPDATE _snapback_meta SET value = ?1 WHERE key = ?2",
            params![holding.0, BOOT_SEQUENCE_META_KEY],
        )
        .expect("restore canonical holding sequence"),
        1
    );
    assert_eq!(
        tx.execute(
            "UPDATE _snapback_meta SET value = ?1 WHERE key = ?2",
            params![holding.1, BOOT_ISSUANCE_META_KEY],
        )
        .expect("restore canonical holding issuance"),
        1
    );
    tx.commit().expect("commit raw canonical projection replay");
    assert_eq!(durable_boot_state(&database), holding);
    assert_eq!(
        durable_boot_epoch(&database),
        successor_epoch,
        "raw compatibility-row replay must not lower the monotone epoch"
    );
    assert_ne!(holding_epoch, successor_epoch);

    let replay_refusal = issuer
        .prepare_connection()
        .expect_err("restored compatibility rows must not resurrect boot 1");
    assert_retired(&replay_refusal);
    let replayed = durable_boot_state(&database);
    let retained_epoch = durable_boot_epoch(&database);
    println!(
        "POISON_REFUSED code={} projected_sequence={} epoch_sequence={} issuance={}",
        replay_refusal.diagnostic.code, replayed.0, retained_epoch.0, replayed.1
    );
    assert_eq!(replayed, holding);
    assert_eq!(retained_epoch, successor_epoch);
}

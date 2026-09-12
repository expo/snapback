use serde_json::json;
use snapback3_core::*;
use std::{
    collections::BTreeMap,
    path::PathBuf,
    time::{SystemTime, UNIX_EPOCH},
};

fn obj<const N: usize>(entries: [(&str, Expr); N]) -> Expr {
    Expr::Object(entries.into_iter().map(|(key, value)| (key.to_owned(), value)).collect())
}

fn project() -> ProjectJson {
    let table = public_table(
        BTreeMap::from([
            ("id".into(), ColumnType::Id),
            ("text".into(), ColumnType::Text { max: 100 }),
            ("author".into(), ColumnType::Principal),
        ]),
        BTreeMap::from([
            (
                "byId".into(),
                Index {
                    components: vec![IndexComponent::Column("id".into())],
                    unique: true,
                },
            ),
            (
                "byText".into(),
                Index {
                    components: vec![IndexComponent::Column("text".into())],
                    unique: true,
                },
            ),
        ]),
    );
    let insert = Program {
        name: "notes.add".into(),
        kind: ProgramKind::Mutation,
        args: BTreeMap::from([(
            "text".into(),
            ArgType::Text {
                max: 100,
                min: 0,
                format: None,
            },
        )]),
        read_time_granularity_ms: None,
        body: vec![
            Stmt::Const {
                name: "id".into(),
                value: Expr::Input(Input::NewId),
            },
            Stmt::Insert {
                table: "notes".into(),
                row: obj([
                    ("id", var("id")),
                    ("text", var("text")),
                    ("author", Expr::Input(Input::Viewer)),
                ]),
            },
            Stmt::Return(var("id")),
        ],
    };
    ProjectJson {
        version: 1,
        schema: Schema {
            tables: BTreeMap::from([("notes".into(), table)]),
            ..Schema::default()
        },
        programs: vec![insert],
        effects: vec![],
        auth: Auth::default(),
    }
}

fn generation(project: &ProjectJson) -> Generation {
    Generation::certify(project, Ceilings::default()).unwrap()
}
fn request(runtime: &Runtime, intent: &str, text: &str) -> OperationRequest {
    let (_, certificate) = &runtime.generation().programs()["notes.add"];
    OperationRequest {
        intent: intent.into(),
        op: "notes.add".into(),
        args: json!({"text":text}),
        plan_hash: certificate.plan_hash.clone(),
        schema_hash: certificate.schema_hash.clone(),
        trace: ReplayTrace::default(),
    }
}
fn context(principal: &str) -> Context {
    let mut context = Context::mutation(Actor::user(principal).unwrap(), BTreeMap::new());
    context.now = Some(1234);
    context
}
fn path() -> PathBuf {
    std::env::temp_dir().join(format!(
        "snapback3-operations-{}-{}.sqlite",
        std::process::id(),
        SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ))
}

#[test]
fn lost_reply_survives_reopen_and_program_removal() {
    let path = path();
    let project = project();
    let mut runtime = Runtime::open(Store::open(&path).unwrap(), generation(&project)).unwrap();
    let request = request(&runtime, "operation-1", "hello");
    let response = runtime
        .execute_operation(&request, context("alice"))
        .unwrap();
    assert_eq!(response["state"], "committed");
    assert!(response["data"].as_str().unwrap().starts_with("s3-"));
    assert_eq!(runtime.store().commit_seq().unwrap(), 1);
    drop(runtime); // Response was lost; client retains its original journal bytes.
    let mut next = project.clone();
    next.programs.clear();
    let mut reopened = Runtime::open(Store::open(&path).unwrap(), generation(&next)).unwrap();
    assert_eq!(
        reopened
            .execute_operation(&request, context("alice"))
            .unwrap(),
        response
    );
    assert_eq!(reopened.store().commit_seq().unwrap(), 1);
    drop(reopened);
    let _ = std::fs::remove_file(path);
}

#[test]
fn id_reuse_different_bytes_and_different_principals_are_distinct() {
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation(&project())).unwrap();
    let a = request(&runtime, "same-id", "alice text");
    let first = runtime.execute_operation(&a, context("alice")).unwrap();
    let mut b = a.clone();
    b.args = json!({"text":"bob text"});
    assert!(matches!(
        runtime.execute_operation(&b, context("alice")),
        Err(OperationError::IntentReused)
    ));
    let second = runtime.execute_operation(&b, context("bob")).unwrap();
    assert_eq!(second["state"], "committed");
    assert_ne!(first["data"], second["data"]);
    assert_eq!(runtime.store().commit_seq().unwrap(), 2);
}

#[test]
fn uncommitted_old_generation_is_parked_without_a_terminal() {
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation(&project())).unwrap();
    let mut request = request(&runtime, "queued", "pending work");
    request.schema_hash = "0".repeat(64);
    assert!(matches!(
        runtime.execute_operation(&request, context("alice")),
        Err(OperationError::Changed)
    ));
    assert!(
        runtime
            .store()
            .stored_operation("alice", "queued")
            .unwrap()
            .is_none()
    );
    assert_eq!(runtime.store().commit_seq().unwrap(), 0);
}

#[test]
fn rejection_rolls_back_writes_and_remains_rejected_after_code_change() {
    let mut project = project();
    project.programs[0].body.insert(
        2,
        Stmt::Require {
            condition: Expr::Literal(Value::Bool(false)),
            code: "REJECTED_AFTER_INSERT".into(),
            site: None,
        },
    );
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation(&project)).unwrap();
    let request = request(&runtime, "rejection", "must not exist");
    let response = runtime
        .execute_operation(&request, context("alice"))
        .unwrap();
    assert_eq!(response["state"], "rejected");
    assert_eq!(response["seq"], 0);
    assert_eq!(runtime.store().commit_seq().unwrap(), 0);
    assert!(
        runtime
            .store()
            .stored_operation("alice", "rejection")
            .unwrap()
            .is_some()
    );
    project.programs[0].body.remove(2);
    runtime.apply_successor(generation(&project)).unwrap();
    assert_eq!(
        runtime
            .execute_operation(&request, context("alice"))
            .unwrap(),
        response
    );
    // The failed insert never held the unique text key.
    let retry = request_for(&runtime, "new-operation", "must not exist");
    assert_eq!(
        runtime.execute_operation(&retry, context("alice")).unwrap()["state"],
        "committed"
    );
}
fn request_for(runtime: &Runtime, intent: &str, text: &str) -> OperationRequest {
    request(runtime, intent, text)
}

#[test]
fn constraint_terminal_is_durable_and_not_deleted_by_legacy_grant_sweep() {
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation(&project())).unwrap();
    let first = request(&runtime, "first", "unique text");
    runtime.execute_operation(&first, context("alice")).unwrap();
    let conflict = request(&runtime, "constraint", "unique text");
    let response = runtime
        .execute_operation(&conflict, context("bob"))
        .unwrap();
    assert_eq!(response["state"], "rejected");
    assert_eq!(runtime.store().commit_seq().unwrap(), 1);
    runtime.sweep_offline(i64::MAX).unwrap();
    assert_eq!(
        runtime
            .execute_operation(&conflict, context("bob"))
            .unwrap(),
        response
    );
    assert!(
        runtime
            .store()
            .stored_operation("alice", "first")
            .unwrap()
            .is_some()
    );
}

#[test]
fn terminal_storage_failure_cannot_leave_an_unrecorded_application_write() {
    let path = path();
    let project = project();
    let runtime = Runtime::open(Store::open(&path).unwrap(), generation(&project)).unwrap();
    let request = request(&runtime, "storage-failure", "atomic unique text");
    drop(runtime);
    // Inject a storage fault at the terminal write, after the mutation has
    // changed application data in its still-open SQLite transaction.
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute_batch("CREATE TRIGGER fail_terminal BEFORE INSERT ON _operation_intents BEGIN SELECT RAISE(ABORT, 'injected terminal storage failure'); END;").unwrap();
    drop(connection);
    let mut runtime = Runtime::open(Store::open(&path).unwrap(), generation(&project)).unwrap();
    assert!(runtime.execute_operation(&request, context("alice")).is_err());
    assert_eq!(runtime.store().commit_seq().unwrap(), 0);
    assert!(runtime.store().stored_operation("alice", "storage-failure").unwrap().is_none());
    drop(runtime);
    let connection = rusqlite::Connection::open(&path).unwrap();
    connection.execute_batch("DROP TRIGGER fail_terminal").unwrap();
    drop(connection);
    let mut runtime = Runtime::open(Store::open(&path).unwrap(), generation(&project)).unwrap();
    // This insertion would hit its unique key if the earlier write had escaped.
    assert_eq!(runtime.execute_operation(&request, context("alice")).unwrap()["state"], "committed");
    assert_eq!(runtime.store().commit_seq().unwrap(), 1);
    drop(runtime);
    let _ = std::fs::remove_file(path);
}

#[test]
fn invalid_input_settles_permanently_without_blocking_the_next_operation() {
    let mut runtime = Runtime::open(Store::memory().unwrap(), generation(&project())).unwrap();
    let invalid = request(&runtime, "too-long", &"x".repeat(101));
    let response = runtime.execute_operation(&invalid, context("alice")).unwrap();
    assert_eq!(response["state"], "rejected");
    assert_eq!(response["seq"], 0);
    assert_eq!(runtime.execute_operation(&invalid, context("alice")).unwrap(), response);
    let valid = request(&runtime, "next", "valid work");
    assert_eq!(runtime.execute_operation(&valid, context("alice")).unwrap()["state"], "committed");
    let mut wrong_type = request(&runtime, "wrong-type", "ignored");
    wrong_type.args = json!({"text":100});
    let response = runtime.execute_operation(&wrong_type, context("alice")).unwrap();
    assert_eq!(response["state"], "rejected");
    assert_eq!(response["seq"], 1);
}

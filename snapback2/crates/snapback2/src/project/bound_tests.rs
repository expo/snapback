use super::*;

#[test]
fn quarry_bound_refusals_preserve_core_repairs() {
    let root = std::env::temp_dir().join(format!("snapback2-bound-repair-{}", std::process::id()));
    fs::create_dir_all(root.join("snapback")).unwrap();
    let compiler = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/snapback2/dist/compiler.mjs");
    let mut worker = CompilerWorker::spawn_path(compiler).unwrap();
    for (schema, source, code, expected) in [
        (
            r#"table follows:
  follower: principal
  followed: principal
  by byFollower: follower, id
  read <- public
  insert <- allow
  update <- allow
  delete <- allow
table posts:
  author: principal
  at: time
  body: text <=2000
  by byAuthorTime: author, at, id
  read <- public
  insert <- allow
  update <- allow
  delete <- allow
"#,
            r#"query feed():
  page = merge posts last 20 by byAuthorTime:
    [f.followed] for f in follows[viewer] first 500 by byFollower
  return page
"#,
            "E_BOUND",
            "structural repair",
        ),
        (
            r#"table follows:
  follower: principal
  period: int
  by byFollower: follower, id
  cap 1000 by follower
  read <- public
  insert <- allow
  update <- allow
  delete <- allow
"#,
            r#"job fillPeriods:
  chunk f in follows first 50 by byId:
    update follows[f] { follower: viewer }
"#,
            "E_BOUND",
            "chunk from 50 to at most 10",
        ),
        (
            r#"table messages:
  body: text <=1000
  read <- public
  insert <- allow
  update <- allow
  delete <- allow
table reactions:
  message: messages
  emoji: text <=2000
  by byMessage: message, id
  read <- public
  insert <- allow
  update <- allow
  delete <- allow
table receipts:
  message: messages
  detail: text <=2000
  by byMessage: message, id
  read <- public
  insert <- allow
  update <- allow
  delete <- allow
"#,
            r#"query thread():
  return messages[] first 20 by byId { body, reactions: reactions[.id] first 50 { emoji }, receipts: receipts[.id] first 50 { detail } }
"#,
            "E_BOUND",
            "widest nested collection",
        ),
        (
            "table items:\n  body: text <=1000\n  read <- public\n",
            "query work():\n  for n in range(0, 1000000):\n    value = n + 1\n  return true\n",
            "E_STEPS",
            "reduce the named expression, statement, or write repetition bound",
        ),
    ] {
        fs::write(root.join("snapback/schema.q"), schema).unwrap();
        fs::write(root.join("snapback/programs.q"), source).unwrap();
        let errors = match worker.compile(&root) {
            Ok(_) => panic!("over-budget fixture certified"),
            Err(errors) => errors,
        };
        assert!(
            errors
                .iter()
                .any(|e| e.code == code
                    && e.rewrite.as_deref().is_some_and(|r| r.contains(expected))),
            "{errors:?}"
        );
        assert!(errors.iter().all(|e| {
            e.site
                .as_deref()
                .is_some_and(|site| site.starts_with("snapback/programs.q:"))
        }));
    }
    drop(worker);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quarry_fill_periods_certifies_and_executes_all_fifty_updates() {
    use snapback2_core::{
        ExecutionState, Expr, LoopDomain, OperatorId, ProgramKind, Runtime, Stmt, Store, object,
    };
    let root =
        std::env::temp_dir().join(format!("snapback2-bound-backfill-{}", std::process::id()));
    fs::create_dir_all(root.join("snapback")).unwrap();
    fs::write(
        root.join("snapback/schema.q"),
        r#"table follows:
  follower: principal
  period: int
  by byFollower: follower, id
  cap 1000 by follower
  read <- public
  insert <- allow
  update <- allow
  delete <- allow
"#,
    )
    .unwrap();
    fs::write(
        root.join("snapback/fill.q"),
        r#"job fillPeriods:
  chunk f in follows first 50 by byId:
    update follows[f] { period: 7 }
"#,
    )
    .unwrap();
    let compiler = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/snapback2/dist/compiler.mjs");
    let mut worker = CompilerWorker::spawn_path(compiler).unwrap();
    let compiled = worker.compile(&root).unwrap();
    let (_, certificate) = &compiled.generation.programs()["fill.fillPeriods"];
    let job_certificate = certificate.job.as_ref().unwrap();
    assert_eq!(job_certificate.sweeps[0].take, 50);
    let max_examined = job_certificate.per_chunk[0].max_examined;
    assert_eq!(max_examined, 55); // The chunk page plus its upper-key capture scan.
    let mut inspect = compiled.project.programs[0].clone();
    let Stmt::For {
        domain: LoopDomain::Page(scan),
        ..
    } = &inspect.body[0]
    else {
        panic!("compiled job lost its chunk scan");
    };
    inspect.body = vec![Stmt::Return(Expr::Scan(scan.clone()))];
    inspect.kind = ProgramKind::Query;
    let mut runtime = Runtime::open(Store::memory().unwrap(), compiled.generation).unwrap();
    runtime
        .seed(
            &(0..50)
                .map(|n| {
                    (
                        "follows".into(),
                        object([
                            ("id", Value::Id(format!("f{n:02}"))),
                            ("follower", Value::Id("alice".into())),
                            ("period", Value::Int(0)),
                        ]),
                    )
                })
                .collect::<Vec<_>>(),
        )
        .unwrap();
    let id = runtime
        .enqueue_job(
            "fill.fillPeriods",
            BTreeMap::new(),
            OperatorId("test".into()),
        )
        .unwrap();
    let outcome = runtime.run_chunk(&id).unwrap();
    let execution = outcome.execution.unwrap();
    assert!(matches!(execution.state, ExecutionState::Committed { .. }));
    assert_eq!(execution.trace.examined, 53); // Fifty rows plus the upper-key capture.
    assert!(execution.trace.examined <= max_examined);
    assert_eq!(outcome.job.rows_written["follows"], 50);
    let Value::Array(rows) = runtime
        .read_operator(&inspect, BTreeMap::new(), OperatorId("test".into()), 1)
        .unwrap()
        .result
    else {
        panic!("inspection did not return rows");
    };
    assert_eq!(rows.len(), 50);
    assert!(
        rows.iter()
            .all(|row| row.field("period") == Ok(&Value::Int(7)))
    );
    drop(worker);
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn quarry_merge_refuses_work_and_output_with_distinct_core_repairs() {
    let root =
        std::env::temp_dir().join(format!("snapback2-bound-wide-merge-{}", std::process::id()));
    fs::create_dir_all(root.join("snapback")).unwrap();
    fs::write(
        root.join("snapback/schema.q"),
        r#"table follows:
  follower: principal
  followed: principal
  by byFollower: follower, id
  read <- public
table posts:
  author: principal
  at: time
  body: text <=20000
  by byAuthorTime: author, at, id
  read <- public
"#,
    )
    .unwrap();
    fs::write(
        root.join("snapback/feed.q"),
        r#"query feed():
  page = merge posts last 20 by byAuthorTime:
    [f.followed] for f in follows[viewer] first 500 by byFollower
  return page
"#,
    )
    .unwrap();
    let compiler = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/snapback2/dist/compiler.mjs");
    let mut worker = CompilerWorker::spawn_path(compiler).unwrap();
    let errors = match worker.compile(&root) {
        Ok(_) => panic!("wide merge certified"),
        Err(errors) => errors,
    };
    let examined = errors
        .iter()
        .find(|e| e.message.starts_with("examined entries"))
        .unwrap();
    let output = errors
        .iter()
        .find(|e| e.message.starts_with("output bytes"))
        .unwrap();
    assert!(
        examined
            .message
            .contains("product: merge snapback/feed.q:2:10: 500 lanes × (20 + 2)"),
        "{examined:?}"
    );
    assert!(
        output
            .message
            .contains("posts row width [posts.body = 80024 bytes"),
        "{output:?}"
    );
    assert!(
        output
            .message
            .contains("product: merge snapback/feed.q:2:10: posts first 20 after merge ×"),
        "{output:?}"
    );
    assert!(!output.message.contains("10000 repetitions"), "{output:?}");
    for error in [examined, output] {
        let repair = error.rewrite.as_deref().unwrap();
        assert!(repair.starts_with("structural repair"), "{error:?}");
        assert!(repair.contains("two snapshots"), "{error:?}");
        assert!(!repair.contains("return null"), "{error:?}");
    }
    assert!(
        output
            .rewrite
            .as_ref()
            .unwrap()
            .contains("widest nested collection")
    );
    assert_ne!(examined.rewrite, output.rewrite);
    drop(worker);
    fs::remove_dir_all(root).unwrap();
}

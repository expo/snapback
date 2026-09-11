use super::*;

#[test]
fn fanout_rewrite_uses_only_the_authored_loop_binding() {
    let root =
        std::env::temp_dir().join(format!("snapback2-fanout-binding-{}", std::process::id()));
    fs::create_dir_all(root.join("snapback")).unwrap();
    let generated = "__bound_loopItem_0";
    let repair = format!(
        "for {generated} in memberships[conversationId] first 50 by byConversationPrincipal:"
    );
    for authored in ["m", "recipient_2"] {
        fs::write(
            root.join("snapback/ops.q"),
            format!("mutation send():\n  for {authored} in page:\n    return null\n"),
        )
        .unwrap();
        let rewritten = quarry_fanout_rewrite(
            &root,
            &SourceSite {
                file: "snapback/ops.q".to_owned(),
                line: 2,
                col: 3,
                ..Default::default()
            },
            &format!("ops.send/for/{generated}/0"),
            &repair,
        )
        .unwrap();
        assert_eq!(
            rewritten,
            format!(
                "for {authored} in memberships[conversationId] first 50 by byConversationPrincipal:"
            )
        );
        assert!(!rewritten.contains(generated));
    }
    assert!(
        quarry_fanout_rewrite(
            &root,
            &SourceSite {
                file: "snapback/ops.q".to_owned(),
                line: 2,
                col: 3,
                ..Default::default()
            },
            "ops.send/for/a_different_binding/0",
            &repair,
        )
        .is_none(),
        "a source site for another loop must not rewrite the checker repair"
    );
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn compiled_fanout_repair_keeps_authored_loop_bindings() {
    let root = std::env::temp_dir().join(format!(
        "snapback2-compiled-fanout-binding-{}",
        std::process::id()
    ));
    fs::create_dir_all(root.join("snapback")).unwrap();
    fs::write(
        root.join("snapback/schema.q"),
        r#"table memberships:
  conversationId: id
  principal: principal
  by byConversationPrincipal: conversationId, principal, id
  cap 50 by conversationId
  public

table deliveries:
  principal: principal
  public
  insert <- public
"#,
    )
    .unwrap();
    let compiler = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/snapback2/dist/compiler.mjs");
    let mut worker = CompilerWorker::spawn_path(compiler).unwrap();
    for authored in ["m", "recipient_2"] {
        fs::write(
            root.join("snapback/ops.q"),
            format!(
                "mutation send(conversationId: id, c: cursor ?):\n  for {authored} in memberships[conversationId] after c first 50 by byConversationPrincipal:\n    insert deliveries {{ principal: {authored}.principal }}\n"
            ),
        )
        .unwrap();
        let refusals = match worker.compile(&root) {
            Ok(_) => panic!("cursor fanout certified"),
            Err(refusals) => refusals,
        };
        let refusal = refusals
            .iter()
            .find(|refusal| refusal.code == "E_STRUCTURAL_FANOUT")
            .unwrap_or_else(|| panic!("missing fanout refusal: {refusals:?}"));
        assert_eq!(refusal.site.as_deref(), Some("snapback/ops.q:2:3"));
        let expected = format!(
            "for {authored} in memberships[conversationId] first 50 by byConversationPrincipal:"
        );
        assert_eq!(refusal.rewrite.as_deref(), Some(expected.as_str()));
        assert!(!refusal.rewrite.as_deref().unwrap().contains("__bound_"));
    }
    drop(worker);
    fs::remove_dir_all(root).unwrap();
}

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
    [f.followed] for f in follows[viewer] first 6000 by byFollower
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
            r#"job fillPeriods():
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
        // Every refusal is sited at authored source: the program, or — since schema
        // declarations have sources (LLP 1020 A6) — the cap declaration when that term
        // dominates the product (`50 calls × cap 1000 by follower on follows`).
        assert!(errors.iter().all(|e| {
            e.site.as_deref().is_some_and(|site| {
                site.starts_with("snapback/programs.q:") || site.starts_with("snapback/schema.q:")
            })
        }), "{errors:?}");
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
        r#"job fillPeriods():
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
    [f.followed] for f in follows[viewer] first 6000 by byFollower
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
            .contains("merge snapback/feed.q:2:10: 6000 lanes heads"),
        "{examined:?}"
    );
    assert!(
        output
            .message
            .contains("posts row width [posts.body (8 field-name/framing + text max 20000 scalars: encoded value bound 80016) = 80024 bytes"),
        "{output:?}"
    );
    assert!(
        output.message.starts_with("output bytes 1607552 exceeds ceiling 1048576"),
        "{output:?}"
    );
    assert!(
        output
            .message
            .contains("product: merge snapback/feed.q:2:10: emitted page"),
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

#[test]
fn quarry_following_twenty_with_five_hundred_follows_certifies_and_runs_with_card_reads() {
    use snapback2_core::{Actor, Context, Engine, object};
    let root = std::env::temp_dir().join(format!("snapback2-following-500-{}", std::process::id()));
    fs::create_dir_all(root.join("snapback")).unwrap();
    fs::write(
        root.join("snapback/schema.q"),
        r#"table follows:
  follower: principal
  followed: principal
  unique byPair: follower, followed
  public

table profiles:
  principal: principal
  name: text <=40
  unique byPrincipal: principal
  public

table posts:
  author: principal
  text: text <=500
  parent: posts ?
  at: time
  by byParent: parent, at, id
  public

table entries:
  author: principal
  post: posts
  repost: bool
  at: time
  unique byAuthorPost: author, post
  by byAuthorTime: author, at, id
  public

table likes:
  author: principal
  post: posts
  unique byPair: author, post
  public

maintain likeCounts: count likes by post
  read <- allow
maintain entryCounts: count entries by post
  read <- allow
maintain replyCounts: count posts by parent
  read <- allow
"#,
    )
    .unwrap();
    fs::write(root.join("snapback/posts.q"), r#"shape postCard = { *, authorProfile: profiles[.author], likes: likeCounts[.id], entries: entryCounts[.id], replies: replyCounts[.id], liked: exists likes[viewer, .id], reposted: exists entries[viewer, .id] }
shape entryCard = { id, author, post, repost, at, actor: profiles[.author], content: posts[.post] postCard }
query following(c: cursor ?):
  page = merge entries after c last 20 by byAuthorTime:
    [viewer]
    [f.followed] for f in follows[viewer] first 500 by byPair
  return page entryCard
"#).unwrap();
    let compiler = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/snapback2/dist/compiler.mjs");
    let mut worker = CompilerWorker::spawn_path(compiler).unwrap();
    let compiled = worker.compile(&root).unwrap();
    let (program, certificate) = &compiled.generation.programs()["posts.following"];
    assert_eq!(certificate.max_examined, 502 + 501 + 22 + 160);
    let mut engine = Engine::memory(compiled.project.schema.clone()).unwrap();
    for n in 0..500 {
        let author = Value::Id(format!("actor{n:04}"));
        let post = Value::Id(format!("post{n:04}"));
        engine
            .seed(
                "follows",
                object([
                    ("id", Value::Id(format!("f{n:04}"))),
                    ("follower", Value::Id("viewer".into())),
                    ("followed", author.clone()),
                ]),
            )
            .unwrap();
        engine
            .seed(
                "profiles",
                object([
                    ("id", Value::Id(format!("profile{n:04}"))),
                    ("principal", author.clone()),
                    ("name", Value::String("Actor".into())),
                ]),
            )
            .unwrap();
        engine
            .seed(
                "posts",
                object([
                    ("id", post.clone()),
                    ("author", author.clone()),
                    ("text", Value::String("Following feed".into())),
                    ("at", Value::Int(n)),
                ]),
            )
            .unwrap();
        engine
            .seed(
                "entries",
                object([
                    ("id", Value::Id(format!("e{n:04}"))),
                    ("author", author),
                    ("post", post),
                    ("repost", Value::Bool(false)),
                    ("at", Value::Int(n)),
                ]),
            )
            .unwrap();
    }
    let execution = engine
        .execute(
            program,
            certificate,
            Context::query(
                Actor::new("viewer", "user").unwrap(),
                BTreeMap::from([("c".into(), Value::Null)]),
            ),
        )
        .unwrap();
    let rows = execution.result.as_array().unwrap();
    assert_eq!(rows.len(), 20);
    assert_eq!(rows[0].field("id").unwrap(), &Value::Id("e0499".into()));
    assert_eq!(rows[19].field("id").unwrap(), &Value::Id("e0480".into()));
    assert!(execution.trace.examined <= certificate.max_examined);
    assert!(execution.trace.steps <= certificate.max_steps);
    assert!(execution.next.is_some());
    assert!(execution.trace.examined <= 1_185);
    let second = engine
        .execute(
            program,
            certificate,
            Context::query(
                Actor::new("viewer", "user").unwrap(),
                BTreeMap::from([("c".into(), Value::String(execution.next.unwrap()))]),
            ),
        )
        .unwrap();
    let expected: Vec<_> = (460..480)
        .rev()
        .map(|n| Value::Id(format!("e{n:04}")))
        .collect();
    let actual: Vec<_> = second
        .result
        .as_array()
        .unwrap()
        .iter()
        .map(|r| r.field("id").unwrap().clone())
        .collect();
    assert_eq!(actual, expected);
    assert!(second.trace.examined <= 1_185);
    assert!(second.trace.steps <= certificate.max_steps);
    assert!(second.next.is_some());
    drop(worker);
    fs::remove_dir_all(root).unwrap();
}

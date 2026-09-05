use super::*;

#[test]
fn quarry_bound_refusals_preserve_core_repairs() {
    let root = std::env::temp_dir().join(format!("snapback2-bound-repair-{}", std::process::id()));
    fs::create_dir_all(root.join("snapback")).unwrap();
    let compiler = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("../../packages/snapback2/dist/compiler.mjs");
    let mut worker = CompilerWorker::spawn_path(compiler).unwrap();
    for (schema, source, expected) in [
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
            "widest nested collection",
        ),
    ] {
        fs::write(root.join("snapback/schema.q"), schema).unwrap();
        fs::write(root.join("snapback/programs.q"), source).unwrap();
        let errors = match worker.compile(&root) {
            Ok(_) => panic!("over-budget fixture certified"),
            Err(errors) => errors,
        };
        assert!(
            errors.iter().any(|e| e.code == "E_BOUND"
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

//! The round-5 issue tracker across A, H and K, with ordinary device acquisition.
#[path = "../src/scale.rs"]
mod scale;
#[path = "../../snapback4-device/tests/common/mod.rs"]
mod common;
use common::{Host, Memory, Sqlite};
use scale::{Class, analyze_bound};
use serde_json::{Value as Json, json};
use snapback4_core::{Context, Engine, Value, wire};

const SOURCE: &str = include_str!("../../snapback4-lang/tests/fixtures/intent-issues.q");
const CONTROLS: &str = "\nquery oldCard(id: issues):\n  return issues[id] { * }\nquery scopedCard(id: issues):\n  i = issues[id] ! else NOT_FOUND\n  return { ...i, labels: issueLabels where .issue = id and .org = i.org first 20 by .label }\n";
fn compiled(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}

#[test]
fn all_issue_tracker_certificates_keep_the_source_and_authority() {
    let b = compiled(&format!("{SOURCE}{CONTROLS}"));
    let certificate = |name| analyze_bound(&b.schema, b.programs.iter().find(|p| p.program.name == name).unwrap());
    for name in ["board", "overdue", "counts", "oldCard", "scopedCard"] {
        assert_eq!(certificate(name).class, Class::Constant, "{name}");
    }
    let board = certificate("board");
    assert_eq!(board.variants.len(), 4);
    assert!(board.variants.iter().all(|v| v.class == Class::Constant));
    assert!(board.line().contains("when status and assignee are both absent: constant"));
    let labeled = certificate("withLabel");
    assert_eq!(labeled.class, Class::Grows);
    assert!(labeled.line().contains("issues skipped by `exists issueLabels[.id, label]`"), "{labeled:?}");
    let find = certificate("find");
    assert_eq!(find.class, Class::Grows);
    assert!(find.line().contains("when search q is present: grows with matching words"));
    assert!(find.line().contains("when search q is absent: constant"));
    // The issue reference does not prove that a label's independent org agrees.
    let card = certificate("card");
    assert_eq!(card.class, Class::Grows);
    assert!(card.line().contains("issueLabels skipped by its per-row read rule"));

    let directory = std::env::temp_dir().join(format!("sb4-issue-certificate-{}", std::process::id()));
    std::fs::create_dir_all(directory.join("snapback")).unwrap();
    std::fs::write(directory.join("snapback/schema.q"), SOURCE).unwrap();
    let output = std::process::Command::new(env!("CARGO_BIN_EXE_snapback4"))
        .current_dir(&directory).args(["check", "--cost"]).output().unwrap();
    std::fs::remove_dir_all(directory).unwrap();
    assert!(output.status.success(), "{output:?}");
    let text = String::from_utf8(output.stdout).unwrap();
    assert!(!text.contains("$intent:"), "{text}");
    assert!(text.lines().find(|line| line.starts_with("scale:")).unwrap().ends_with("— `check --cost` gives the certificate"));
    for read in [
        "issues where .org = org and (status = null or .status = status) and (assignee = null or .assignee = assignee) last 50 by .at after c",
        "issues where .org = org and .due < now and .status != 'done' first 50 by .due after c",
        "issues where .org = org and exists issueLabels[.id, label] last 50 by .at after c",
        "issues matching q where .org = org last 20 by .at after c",
    ] { assert!(text.contains(&format!("read: {read}")), "{read}: {text}"); }
}

fn seed(server: &mut Engine, hidden_labels: usize) {
    let mut rows = vec![
        ("orgs", json!({"id":"org","name":"Ours","owner":"alice"})),
        ("orgs", json!({"id":"hidden","name":"Hidden","owner":"bob"})),
        ("members", json!({"id":"ma","org":"org","principal":"alice","role":"admin"})),
        ("members", json!({"id":"mb","org":"hidden","principal":"bob","role":"admin"})),
    ];
    for (id, org, status, assignee, due, at) in [
        ("a", "org", "todo", Some("alice"), Some(10), 1),
        ("b", "org", "doing", Some("bob"), Some(20), 2),
        ("c", "org", "todo", None, None, 3),
        ("d", "org", "done", Some("alice"), Some(5), 4),
        ("e", "org", "todo", Some("alice"), Some(200), 5),
        ("hidden", "hidden", "todo", Some("alice"), Some(1), 6),
    ] {
        rows.push(("issues", json!({"id":id,"org":org,"title":format!("common {id}"),"status":status,"assignee":assignee,"due":due,"priority":1,"at":at})));
    }
    rows.push(("issueLabels", json!({"id":"visible","issue":"a","label":"z-visible","org":"org"})));
    for n in 0..hidden_labels {
        rows.push(("issueLabels", json!({"id":format!("hidden{n}"),"issue":"a","label":format!("a-hidden{n:05}"),"org":"hidden"})));
    }
    server.seed_at(rows.into_iter().map(|(table, row)| (table.into(), wire::row_from_json(&server.schema().tables[table], &row).unwrap())).collect::<Vec<_>>(), 100).unwrap();
}
fn query(server: &mut Engine, name: &str, args: &Json) -> snapback4_core::engine::QueryOutcome {
    let args = server.program(name).unwrap().args.iter().map(|(key, kind)|
        (key.clone(), wire::from_json(kind, &args[key]).unwrap())).collect();
    server.query(name, Context::new("alice", args).at(100)).unwrap()
}
fn ids(value: &Value) -> Vec<&str> {
    value.as_array().unwrap().iter().map(|row| row.field("id").unwrap().as_str().unwrap()).collect()
}

fn on_device<H: Host>(host: &mut H) {
    let (mut original, _) = common::compile(&format!("{SOURCE}{CONTROLS}"));
    seed(&mut original, 2);
    // The supplied program has no sync declarations. Add only its existing
    // membership audiences for this acquired-device companion, without caps.
    let source = format!("{SOURCE}{CONTROLS}")
        .replace("  insert <- .owner = viewer", "  insert <- .owner = viewer\n  sync to members[.id]")
        .replace("  read <- exists members[.org, viewer]", "  read <- exists members[.org, viewer]\n  sync to members[.org]");
    let (mut server, backend) = common::compile(&source);
    seed(&mut server, 2);
    let mut device = host.open("issues", Some(backend)).unwrap();
    for (i, page) in common::snapshot_pages(&mut server, "alice", 2).iter().enumerate() { device.apply(page, i == 0).unwrap(); }
    host.close("issues", device);
    let mut device = host.open("issues", None).unwrap();
    let mut cases = vec![
        ("overdue", json!({"org":"org","c":null}), vec!["a", "b"]),
        ("withLabel", json!({"org":"org","label":"z-visible","c":null}), vec!["a"]),
        ("withLabel", json!({"org":"org","label":"a-hidden00000","c":null}), vec![]),
        ("find", json!({"org":"org","q":"","c":null}), vec!["e", "d", "c", "b", "a"]),
        ("find", json!({"org":"org","q":"common","c":null}), vec!["e", "d", "c", "b", "a"]),
    ];
    for (status, assignee, expected) in [(None, None, vec!["e","d","c","b","a"]),
        (Some("todo"), None, vec!["e","c","a"]), (None, Some("alice"), vec!["e","d","a"]),
        (Some("todo"), Some("alice"), vec!["e","a"])] {
        cases.push(("board", json!({"org":"org","status":status,"assignee":assignee,"c":null}), expected));
    }
    for (name, args, expected) in cases {
        let remote = query(&mut original, name, &args);
        assert_eq!(query(&mut server, name, &args).data, remote.data, "sync declarations preserve {name}");
        let local = device.query(name, "alice", &args, 100).unwrap();
        assert_eq!(ids(&remote.data), expected, "server {name}");
        assert_eq!(local.data, remote.data, "{} {name}", host.label());
        assert!(remote.complete && local.complete, "{name}: {remote:?}, {local:?}");
    }
    let counts = query(&mut original, "counts", &json!({"org":"org"}));
    assert_eq!(wire::to_json(&counts.data), json!({"todo":3,"doing":1,"done":1}));
    assert_eq!(device.query("counts", "alice", &json!({"org":"org"}), 100).unwrap().data, counts.data);
    for name in ["card", "scopedCard"] {
        let card = query(&mut original, name, &json!({"id":"a"}));
        assert_eq!(device.query(name, "alice", &json!({"id":"a"}), 100).unwrap().data, card.data);
        assert_eq!(ids(card.data.field("labels").unwrap()), ["visible"]);
        let old = query(&mut server, "oldCard", &json!({"id":"a"}));
        let mut fields = card.data.as_object().unwrap().clone();
        fields.remove("labels");
        assert_eq!(&fields, old.data.as_object().unwrap(), "spread retains exactly the old row fields");
    }
}
#[test] fn issue_tracker_server_and_memory_agree() { on_device(&mut Memory::new()); }
#[test] fn issue_tracker_server_and_sqlite_agree() { on_device(&mut Sqlite::new("issue-tracker")); }

#[test]
fn card_hidden_label_counterexample_keeps_the_growth_warning() {
    let (mut server, _) = common::compile(&format!("{SOURCE}{CONTROLS}"));
    seed(&mut server, 9_000);
    let card = query(&mut server, "card", &json!({"id":"a"}));
    assert!(!card.complete && card.data.field("labels").unwrap().as_array().unwrap().is_empty());
    let scoped = query(&mut server, "scopedCard", &json!({"id":"a"}));
    assert!(scoped.complete);
    assert_eq!(ids(scoped.data.field("labels").unwrap()), ["visible"]);
    assert!(scoped.metered.examined < 10, "{scoped:?}");
}

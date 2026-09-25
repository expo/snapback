use snapback4_core::{engine::Context, value::Value};

pub const CHAIN: &str = include_str!("chain.q");
pub const CLIQUE: &str = include_str!("clique.q");
pub const ISSUES: &str = include_str!("issue_tracker.q");

pub trait Backend {
    fn run(&mut self, operation: &str, context: Context) -> Result<Value, String>;
}
pub fn context(viewer: &str, now: i64, args: &[(&str, Value)]) -> Context {
    Context::new(
        viewer,
        args.iter()
            .map(|(n, v)| (n.to_string(), v.clone()))
            .collect(),
    )
    .at(now)
}
pub fn chain(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    // The second fixture replaces just the middle rule: both its immutable
    // org and its archived conjunct must be copied into all descendants.
    for conjunct in [false, true] {
        let source = if conjunct {
            CHAIN.replace("read through .org","archived: bool\n  immutable archived\n  read <- exists members[.org, viewer] and not .archived")
            .replace("id: 'p', org: 'o'","id: 'p', org: 'o', archived: false")
        } else {
            CHAIN.into()
        };
        let mut e = factory(&source);
        e.run(
            "setup",
            context("alice", 100, &[("owner", Value::Id("alice".into()))]),
        )
        .unwrap();
        e.run("add", context("alice", 100, &[])).unwrap();
        assert_eq!(
            e.run("total", context("alice", 100, &[])).unwrap(),
            Value::Int(1)
        );
        assert_eq!(
            e.run("total", context("bob", 100, &[])).unwrap(),
            Value::Null
        );
        assert_eq!(e.run("one", context("bob", 100, &[])).unwrap(), Value::Null);
        assert_eq!(
            e.run("one", context("service:search", 100, &[])).unwrap() != Value::Null,
            !conjunct
        );
        assert_eq!(
            e.run("page", context("alice", 100, &[("c", Value::Null)]))
                .unwrap()
                .as_array()
                .unwrap()
                .len(),
            1
        );
        if conjunct {
            let mut hidden = factory(&source.replace("archived: false", "archived: true"));
            hidden
                .run(
                    "setup",
                    context(
                        snapback4_core::SYSTEM_PRINCIPAL,
                        100,
                        &[("owner", Value::Id("alice".into()))],
                    ),
                )
                .unwrap();
            assert!(
                hidden
                    .run("add", context("alice", 100, &[]))
                    .unwrap_err()
                    .contains("E_RULE")
            );
        }
    }
}
pub fn clique(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let mut e = factory(CLIQUE);
    e.run("join", context("alice", 100, &[])).unwrap();
    e.run(
        "setup",
        context("alice", 100, &[("until", Value::Int(200))]),
    )
    .unwrap();
    for op in ["unreadFor", "reactionsFor"] {
        assert_eq!(
            e.run(op, context("alice", 100, &[])).unwrap(),
            Value::Int(1)
        );
        assert_eq!(e.run(op, context("bob", 100, &[])).unwrap(), Value::Null);
    }
    assert_eq!(
        e.run("unreadFor", context("alice", 200, &[])).unwrap(),
        Value::Int(0)
    );
    assert_eq!(
        e.run("reactionsFor", context("alice", 200, &[])).unwrap(),
        Value::Null
    );
    e.run("readIt", context("alice", 100, &[])).unwrap();
    assert_eq!(
        e.run("unreadFor", context("alice", 100, &[])).unwrap(),
        Value::Int(0)
    );
    e.run("leave", context("alice", 100, &[])).unwrap();
    assert_eq!(
        e.run("receipt", context("alice", 100, &[])).unwrap(),
        Value::Null
    );
    assert_eq!(
        e.run("unreadFor", context("alice", 100, &[])).unwrap(),
        Value::Null
    );
}
pub fn issues(mut factory: impl FnMut(&str) -> Box<dyn Backend>) {
    let mut e = factory(ISSUES);
    e.run("setup", context("alice", 100, &[])).unwrap();
    assert_eq!(
        e.run("issue", context("alice", 100, &[]))
            .unwrap()
            .field("comments")
            .unwrap(),
        &Value::Int(1)
    );
    assert_eq!(
        e.run("issue", context("bob", 100, &[])).unwrap(),
        Value::Null
    );
    assert_eq!(
        e.run("labels", context("alice", 100, &[("c", Value::Null)]))
            .unwrap()
            .as_array()
            .unwrap()
            .len(),
        1
    );
    assert!(
        e.run("erase", context("alice", 100, &[]))
            .unwrap_err()
            .contains("E_PARENT_HAS_CHILDREN")
    );
    assert!(
        e.run("erase", context("bob", 100, &[]))
            .unwrap_err()
            .contains("NOT_FOUND")
    );
    e.run("clear", context("alice", 100, &[])).unwrap();
    assert_eq!(
        e.run("issue", context("alice", 100, &[])).unwrap(),
        Value::Null
    );
}

//! @ref LLP 3000.028#7.3 — explicit policy and caller-only existence lowering.
use snapback4_lang::{compile, Bound};

const SOURCE: &str = r#"
table likes:
  post: id
  owner: principal
  at: time
  unique post, owner
  immutable post, owner
  public 'likes'
  insert <- .owner = viewer
  delete <- .owner = viewer
  sync public last 2 by .at with own keys .owner
query own(post: id):
  return exists likes[post, viewer]
query other(post: id, owner: principal):
  return exists likes[post, owner]
query image(post: id):
  return likes[post, viewer]
query filtered(post: id):
  return exists likes[post = post, owner = viewer, at = 10]
mutation add(post: id):
  insert likes { post, owner: viewer, at: now }
"#;
fn bound(source: &str) -> Bound {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}

#[test]
fn policy_is_explicit_and_only_caller_existence_uses_it() {
    let b = bound(SOURCE);
    assert!(b.schema.required_capabilities().contains("owner-key-coverage"));
    for (name, table) in [("own", "$ownKeys:likes"), ("other", "likes"), ("image", "likes"), ("filtered", "likes")] {
        let p = &b.programs.iter().find(|p| p.program.name == name).unwrap().program;
        assert!(snapback4_core::ir::read_sites(p).iter().any(|r| r.table == table), "{name}: {p:?}");
    }
    let old = bound(&SOURCE.replace(" with own keys .owner", ""));
    assert!(!old.schema.required_capabilities().contains("owner-key-coverage"));
    assert!(!old.schema.tables.contains_key("$ownKeys:likes"));
    assert_eq!(old.schema.tables["likes"].sync, b.schema.tables["likes"].sync);
    let json = serde_json::to_string(&b.schema).unwrap();
    assert_eq!(serde_json::from_str::<snapback4_core::Schema>(&json).unwrap(), b.schema);
    assert!(serde_json::from_str::<snapback4_core::Schema>(&json.replace("owner-key-coverage", "unsupported-owner-key-coverage")).unwrap_err().to_string().contains("E_SCHEMA_CAPABILITY"));
}

#[test]
fn unsafe_policies_refuse_at_the_sync_line() {
    for source in [
        SOURCE.replace("public 'likes'", "read <- .owner = viewer").replace("sync public", "sync"),
        SOURCE.replace("immutable post, owner", "immutable post"),
        SOURCE.replace("post: id", "post: id ?"),
        SOURCE.replace("insert <- .owner = viewer", "insert <- allow"),
        SOURCE.replace("insert <- .owner = viewer", "insert <- .owner = viewer or allow"),
        SOURCE.replace("delete <- .owner = viewer", "delete <- allow"),
        SOURCE.replace("  public 'likes'", "  update <- allow\n  public 'likes'"),
        SOURCE.replace("  public 'likes'", "  expire at .at\n  public 'likes'"),
        SOURCE.replace("last 2 by .at ", ""),
        SOURCE.replace("  sync public", "  online only\n  sync public"),
        SOURCE.replace("with own keys .owner", "with own keys .post"),
    ] {
        let b = compile(&[("schema.q".into(), source.clone())]);
        assert!(!b.diagnostics.is_empty(), "accepted unsafe policy: {source}");
    }
}

#[test]
fn full_builder_original_and_restored_bodies_compile() {
    let original = include_str!("../../../experiments/p19-one-query/builder.q");
    let old = bound(original);
    let source = original.replace("sync public last 2000 by .at", "sync public last 2000 by .at with own keys .principal")
        .replace("sync public last 1000 by .at\n\ntable follows", "sync public last 1000 by .at with own keys .actor\n\ntable follows")
        .replace("view ownLikes: count likes by .principal, .post\n", "")
        .replace("view ownReposts: count reposts by .actor, .post\n", "")
        .replace("ownLikes[viewer, .id] > 0", "exists likes[.id, viewer]")
        .replace("ownReposts[viewer, .id] > 0", "exists reposts[viewer, .id]")
        .replace("ownLikes[viewer, post] > 0", "exists likes[post, viewer]")
        .replace("ownReposts[viewer, post] > 0", "exists reposts[viewer, post]");
    let b = bound(&source);
    assert!(!b.schema.tables.contains_key("ownLikes") && !b.schema.tables.contains_key("ownReposts"));
    assert_eq!(b.schema.tables["posts"], old.schema.tables["posts"]);
    assert_eq!(b.schema.maintains.iter().filter(|m| m.own_keys.is_some()).count(), 2);
    let state = &b.programs.iter().find(|p| p.program.name == "postState").unwrap().program;
    assert!(snapback4_core::ir::read_sites(state).iter().all(|r| r.table.starts_with("$ownKeys:")));
}

#[test]
fn diagnostic_recipe_preserves_the_public_summary_and_offers_owner_key_existence() {
    let card = snapback4_lang::guide::card("offline-interactions").unwrap();
    assert!(!card.contains("not available yet"));
    let examples = snapback4_lang::guide::quarry(card);
    assert_eq!(examples.len(), 2);
    let summary = bound(&examples[1]);
    assert!(summary.notes.iter().any(|d| d.code == "N_MAINTAIN_SYNCED"));
    assert!(!summary.schema.required_capabilities().contains("owner-key-coverage"));
    let keys = bound(&examples[0]);
    assert!(keys.notes.is_empty(), "{:?}", keys.notes);
    assert_eq!(keys.schema.tables["likes"].sync, summary.schema.tables["likes"].sync);
    assert!(!keys.schema.tables.contains_key("ownLikes"));
    assert!(keys.schema.required_capabilities().contains("owner-key-coverage"));
    let state = &keys.programs.iter().find(|p| p.program.name == "postState").unwrap().program;
    assert!(snapback4_core::ir::read_sites(state).iter().any(|r| r.table == "$ownKeys:likes"));
}

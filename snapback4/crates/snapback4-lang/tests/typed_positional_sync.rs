//! @ref LLP 3000.013#2.2 — sync planning uses the admitted rule key, including its order.
use snapback4_lang::{compile, Bound};
use snapback4_core::schema::RuleExpr;

fn source(competitor: &str, sync: &str, explicit: bool) -> String {
    format!("table conversations:\n  public\n  online only\ntable members:\n  conversation: conversations\n  principal: principal\n  number: int\n  active: bool\n  unique pair: conversation, principal\n  {competitor}\n  read <- .principal = viewer\n  sync to .principal\ntable messages:\n  conversation: conversations\n  at: time\n  immutable conversation\n  read <- exists members[.conversation, viewer]{}\n  {sync}\n", if explicit { " by pair" } else { "" })
}
fn ok(source: &str) -> Bound {
    let b = compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{source}\n{:?}", b.diagnostics);
    b
}

#[test]
fn typed_rule_supplies_content_inverse_and_horizon_indexes() {
    for competitor in ["unique reverse: principal, conversation", "unique unrelated: number, active", "unique wrongType: conversation, number"] {
        for audience in ["sync", "sync to members[.conversation]"] {
            for horizon in ["", " last 20 by .at"] {
                let sync = format!("{audience}{horizon}");
                let typed = ok(&source(competitor, &sync, false));
                let explicit = ok(&source(competitor, &sync, true));
                assert_eq!(typed.schema.tables, explicit.schema.tables, "{competitor}; {sync}");
                let messages = &typed.schema.tables["messages"];
                assert!(matches!(&messages.rules.read, RuleExpr::Exists { index, .. } if index == "pair"));
                assert!(messages.indexes.values().any(|i| i.columns().starts_with(&["conversation".into()])));
                assert!(typed.schema.tables["members"].indexes.values().any(|i| i.columns().starts_with(&["principal".into(), "conversation".into()])));
                if !horizon.is_empty() {
                    let h = messages.sync.as_ref().unwrap().horizon.as_ref().unwrap();
                    assert_eq!(messages.index(&h.by).unwrap().columns(), ["conversation", "at", "id"]);
                }
            }
        }
    }
}

#[test]
fn reversed_rule_keeps_its_index_and_existing_sync_refusal() {
    let source = source("unique reverse: principal, conversation", "online only", false)
        .replace("members[.conversation, viewer]", "members[viewer, .conversation]");
    let b = ok(&source);
    assert!(matches!(&b.schema.tables["messages"].rules.read, RuleExpr::Exists { index, .. } if index == "reverse"));
    // Sync's existing invertible audience requires the recipient last. Choosing
    // the other declared index silently would change the authorized audience.
    let source = source.strip_suffix("  online only\n").unwrap().to_owned() + "  sync\n";
    let b = compile(&[("schema.q".into(), source)]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_SYNC" && d.message.contains("cannot infer")));
}

#[test]
fn sync_does_not_bypass_ambiguity_or_nullable_key_proofs() {
    let ambiguous = source("unique competing: conversation, principal", "sync", false);
    let b = compile(&[("schema.q".into(), ambiguous)]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_POSITIONAL_SCAN"));
    let nullable = source("unique reverse: principal, conversation", "sync", false)
        .replace("conversation: conversations", "conversation: conversations ?");
    let b = compile(&[("schema.q".into(), nullable)]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_QUARRY_NULL_KEY"));
    let nullable_target = source("unique reverse: principal, conversation", "sync", false)
        .replacen("conversation: conversations", "conversation: conversations ?", 1);
    let b = compile(&[("schema.q".into(), nullable_target)]);
    assert!(!b.diagnostics.iter().any(|d| d.code == "E_QUARRY_NULL_KEY"));
    assert!(b.diagnostics.iter().any(|d| d.code == "E_SYNC" && d.message.contains("required group keys")));
}

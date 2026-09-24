//! The three diary shapes, using the current producers and their JSON envelope.
use snapback4_lang::{Bound, Diagnostic, bind::residency};

const REFERENCE: &str = "table posts:\n  body: text <=100\n  public 'posts'\n  insert <- allow\ntable events:\n  postId: posts\n  public 'feed events'\nfn deliver(event: events): event\nmutation publish():\n  post = insert posts {body: 'hello'}\n  return deliver(post)\n";
const MEMBERSHIP: &str = "table conversations:\n  public 'test'\ntable members:\n  conversationId: conversations\n  principal: principal\n  unique byConversationPrincipal: conversationId, principal\n  read <- .principal = viewer\ntable reactions:\n  conversationId: conversations\n  messageId: id\n  by byMessage: messageId, id\n  by byConversationMessage: conversationId, messageId, id\n  read <- exists members[.conversationId, viewer]\nquery reactionsForMessage(conversationId: conversations, messageId: id):\n  return reactions[messageId] first 20 by byMessage\n";
const PRESENCE: &str = "effect notify\ntable notes:\n  n: int\n  unique byN: n\n  public 'notes'\n  sync public\n  insert <- allow\nmutation send(p: principal):\n  insert notes {n: 1}\n  if not exists connected[p]:\n    emit notify {row: notes[n = 1]}\n";

fn compile(source: &str) -> Bound { snapback4_lang::compile(&[("schema.q".into(), source.into())]) }
fn clean(source: &str) -> Bound {
    let b = compile(source); assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics); b
}
fn report(name: &str, diagnostics: &[Diagnostic]) {
    for diagnostic in diagnostics { println!("{name} terminal:\n{diagnostic}"); }
    println!("{name} JSON: {}", serde_json::to_string(diagnostics).unwrap());
}

#[test]
fn capture_existing_three_builder_cases() {
    let reference = compile(REFERENCE);
    report("reference", &reference.diagnostics);
    let control = include_str!("fixtures/builder-guidance-control.txt");
    assert!(control.contains(&reference.diagnostics[0].to_string()), "the already sufficient helper explanation stays unchanged");
    assert!(control.contains(&format!("reference JSON: {}", serde_json::to_string(&reference.diagnostics).unwrap())));
    assert_eq!(reference.diagnostics.len(), 1);
    assert_eq!(reference.diagnostics[0].code, "E_QUARRY_TYPE");
    assert!(reference.diagnostics[0].message.contains("deliver's event"));
    assert!(!reference.diagnostics[0].mechanical);
    let membership = clean(MEMBERSHIP);
    let notes: Vec<_> = membership.notes.iter().filter(|note| note.code == "N_NEVER_COMPLETE").cloned().collect();
    report("membership", &notes); assert_eq!(notes.len(), 1);
    assert!(notes[0].message.contains(".conversationId, which the scan does not pin"));
    assert!(!notes[0].mechanical);
    let presence = clean(PRESENCE);
    let fact = &presence.schema.operations["send"];
    println!("presence why:\n{}", residency::operation_lines("send", fact));
    println!("presence JSON: {}", serde_json::to_string(fact).unwrap());
    assert_eq!(fact.predicts.as_deref(), Some("never"));
    assert!(fact.sites.iter().any(|site| site.reason.contains("fallible or variable-cost arm")));
    assert!(fact.sites.iter().any(|site| site.reason.contains("connected[p]") && site.reason.contains("read at schema.q:10:")));
}

#[test]
fn scope_guidance_uses_existing_index_and_preserves_the_message_equality() {
    let b = clean(MEMBERSHIP);
    let note = b.notes.iter().find(|note| note.code == "N_NEVER_COMPLETE").unwrap();
    assert!(note.rewrite.contains("existing index `byConversationMessage: conversationId, messageId, id`"), "{note}");
    assert!(note.rewrite.contains("current equality prefix"));
    assert!(note.rewrite.contains("narrows the answer"));
    assert!(!note.rewrite.contains("by byConversationId"));
    assert!(!note.mechanical);
    let json = serde_json::to_value(note).unwrap();
    assert_eq!(json["rewrite"], note.rewrite); assert_eq!(json["mechanical"], false);

    let without_index = MEMBERSHIP.replace("  by byConversationMessage: conversationId, messageId, id\n", "");
    let b = clean(&without_index);
    let note = b.notes.iter().find(|note| note.code == "N_NEVER_COMPLETE").unwrap();
    assert!(note.rewrite.contains("pin .conversationId with where equalities"), "{note}");
    let rewritten = without_index.replace("reactions[messageId] first 20 by byMessage", "reactions where .conversationId = conversationId and .messageId = messageId first 20 by .id");
    assert!(!clean(&rewritten).notes.iter().any(|note| note.code == "N_NEVER_COMPLETE"));

    let incompatible = MEMBERSHIP.replace("by byConversationMessage: conversationId, messageId, id", "by byConversationMessage: conversationId, id, messageId");
    let b = clean(&incompatible);
    assert!(!b.notes.iter().find(|note| note.code == "N_NEVER_COMPLETE").unwrap().rewrite.contains("existing index"), "do not change the unpinned ordering");
}

#[test]
fn presence_guidance_connects_the_existing_origin_to_the_consuming_read() {
    let b = clean(PRESENCE); let fact = &b.schema.operations["send"];
    let blocked: Vec<_> = fact.sites.iter().filter(|site| site.kind == "presence").collect();
    assert_eq!(blocked.len(), 2, "keep the existing two causes");
    let read = blocked.iter().find(|site| site.reason.contains("a fallible evaluation")).unwrap();
    assert_eq!(read.site, "schema.q:11:23 (notes[n = 1])");
    assert!(read.reason.contains("connected[p]") && read.reason.contains("schema.q:10:17"));
    assert_eq!(fact.predicts.as_deref(), Some("never"));
    assert!(residency::operation_lines("send", fact).contains("fallible evaluation (read at schema.q:10:17) (site schema.q:11:23 (notes[n = 1]))"));
    assert_eq!(serde_json::to_value(read).unwrap()["site"], read.site);
    let hoisted = PRESENCE.replace("  if not exists connected[p]:\n    emit notify {row: notes[n = 1]}", "  row = notes[n = 1]\n  if not exists connected[p]:\n    emit notify {row}");
    let previous = clean(&hoisted);
    let notes = residency::change_notes(&b, &previous.schema.operations);
    assert_eq!(notes.len(), 1, "one existing prediction-loss note");
    assert_eq!(notes[0].code, "N_NOT_PREDICTABLE");
    assert!(!notes[0].mechanical);
    assert!(notes[0].message.contains("schema.q:11:23"));
}

#[test]
fn same_table_row_helpers_and_explicit_author_choices_still_compile() {
    let same_table = REFERENCE.replace("event: events", "event: posts");
    clean(&same_table); // Same-table row-to-reference behavior is intentional.
    let corrected = MEMBERSHIP.replace("reactions[messageId] first 20 by byMessage", "reactions[conversationId, messageId] first 20 by byConversationMessage");
    let b = clean(&corrected); assert!(!b.notes.iter().any(|note| note.code == "N_NEVER_COMPLETE"));
    // This author-selected rewrite changes when the read runs. It is not an
    // automatic repair: evaluating it unconditionally can introduce refusal.
    let hoisted = PRESENCE.replace("  if not exists connected[p]:\n    emit notify {row: notes[n = 1]}", "  row = notes[n = 1]\n  if not exists connected[p]:\n    emit notify {row}");
    assert_eq!(clean(&hoisted).schema.operations["send"].predicts.as_deref(), Some("eligible"));
}

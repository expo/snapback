use super::*;

#[test]
fn descriptor_preserves_explicit_names_fields_modules_and_hygienic_arguments() {
    for (file, source, group, through) in [
        ("schema.q", names::SOURCE.to_string(), "room", "through"),
        ("inbox.q", names::SOURCE.to_string(), "room", "through"),
        ("schema.q", names::renamed(names::SOURCE, "room", "through"), "through", "through2"),
    ] {
        let b = snapback4_lang::compile(&[(file.into(), source)]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        let emitted = snapback4_lang::emit::typescript(&b);
        let member = if file == "schema.q" { "operations[\"inboxMember\"]" } else { "operations[\"inbox\"][\"inboxMember\"]" };
        assert!(emitted.contains(&format!("member: {member}")), "{emitted}");
        let seen = b.programs.iter().find(|p| p.program.name.ends_with("inboxSeen")).unwrap();
        assert_eq!(seen.args[0].0, group);
        // Do not guess the suffix: check the actual hygienic binder output.
        assert!(seen.args[1].0.starts_with("through"), "{through}");
        assert!(emitted.contains(&format!("throughArgument: {}", serde_json::to_string(&seen.args[1].0).unwrap())));
        for mapping in ["counter: \"total\"", "floor: \"joined\"", "count: \"size\"", "seen: \"viewed\"", "delivered: \"received\"", "memberGroup: \"group\""] { assert!(emitted.contains(mapping), "{mapping}"); }
        assert!(emitted.contains(&b.schema.delivery[0].fingerprint));
        assert!(emitted.contains("ReceiptFamily<Rows[\"audience\"]"));
    }
}

#[test]
fn descriptor_defaults_and_namespace_collisions() {
    let source = names::SOURCE.replace("    watermarks .received, .viewed\n", "").replace("    runs inboxRuns\n", "")
        .replace("    operations inboxReceipt, inboxDelivered, inboxSeen, inboxMember, inboxProgress, inboxCompact\n", "");
    let b = bound(&source);
    let emitted = snapback4_lang::emit::typescript(&b);
    assert!(emitted.contains("member: operations[\"inboxMember\"]"));
    assert!(emitted.contains("seen: \"inboxSeenOrdinal\""));
    let collision = snapback4_lang::compile(&[("schema.q".into(), format!("{source}\nquery receiptFamilies():\n  return null\n"))]);
    assert!(collision.diagnostics.iter().any(|d| d.code == "E_RECEIPTS_CLAUSE" && d.message.contains("receiptFamilies")));
    let plain = bound("query receiptFamilies():\n  return null\n");
    assert!(snapback4_lang::emit::typescript(&plain).contains("export const api: Ops"));
}

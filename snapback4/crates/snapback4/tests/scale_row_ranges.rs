//! The certificate describes the actual server ledger and the device's suffix proof.
#[path = "../src/scale.rs"]
mod scale;
use scale::{Class, analyze};
const SOURCE: &str = include_str!("../../snapback4-device/tests/unread_range/schema.q");
fn bound(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
    b
}
#[test]
fn range_whole_group_non_expiring_and_witness_costs_are_distinct() {
    for (from, to, range, live) in [
        ("", "", true, true),
        (
            ".ordinal > m.readUpTo",
            ".ordinal < m.readUpTo",
            false,
            true,
        ),
        ("  expire at .until\n", "", true, false),
    ] {
        let source = if from.is_empty() {
            SOURCE.into()
        } else {
            SOURCE.replace(from, to)
        };
        let b = bound(
            &(source
                + "\nquery present(member: members):\n  return exists unread[member = member]\ntable gated:\n  member: members\n  read <- exists unread[member = .member]\nquery witness(id: gated):\n  return gated[id]\n"),
        );
        let badge = analyze(
            &b.schema,
            &b.programs
                .iter()
                .find(|p| p.program.name == "badge")
                .unwrap()
                .program,
        );
        assert_eq!(
            badge.class,
            if live { Class::Grows } else { Class::Constant }
        );
        assert!(badge.bounds.rows_examined < 8192, "{badge:?}");
        if live {
            let line = badge.line();
            for text in [
                "whole live basis",
                "one examined unit and one step",
                "probes and walks consume the internal ledger",
            ] {
                assert!(line.contains(text), "{line}");
            }
            assert_eq!(line.contains(".ordinal > member.readUpTo"), range, "{line}");
            assert_eq!(
                line.contains("When every range operand is null"),
                range,
                "{line}"
            );
            assert!(!line.contains("the examined meter bounds the backlog"));
        }
        // An expression `exists` goes through get and certifies the count.
        // Only a rule's indexed existence probe is a pure witness today.
        let present = analyze(&b.schema, &b.programs.iter().find(|p| p.program.name == "present").unwrap().program);
        assert_eq!(present.class, badge.class, "{present:?}");
        let witness = analyze(
            &b.schema,
            &b.programs
                .iter()
                .find(|p| p.program.name == "witness")
                .unwrap()
                .program,
        );
        assert_eq!(witness.class, Class::Constant, "{witness:?}");
        assert!(
            witness
                .aggregates
                .iter()
                .any(|s| s.contains("indexed existence and lifetime; does not certify the count")),
            "{witness:?}"
        );
    }
}
#[test]
fn optional_row_key_operands_keep_scalar_type_checks() {
    let source = SOURCE.replace("readUpTo: int default 0", "readUpTo: int ?");
    assert!(bound(&source).schema.maintains[0].row_key.is_some());
    let wrong = source.replace("readUpTo: int ?", "readUpTo: text <=10 ?");
    let b = snapback4_lang::compile(&[("wrong.q".into(), wrong)]);
    assert!(b.diagnostics.iter().any(|d| d.code == "E_VIEW_KEY"));
}

#[test]
fn count_dependent_rule_is_refused_and_never_reported_as_a_pure_witness() {
    let source = SOURCE.to_owned() + "\ntable gated:\n  member: members\n  read <- exists unread[member = .member, value = 0]\nquery guarded(id: gated):\n  return gated[id]\n";
    let refused = snapback4_lang::compile(&[("schema.q".into(), source.clone())]);
    assert!(refused.diagnostics.iter().any(|d| d.code == "E_QUARRY_LIVE_MAINTAIN_PROBE"));
    // The analyzer also accepts schemas from the core IR; keep that witness
    // distinction even when it did not come through Quarry's admission check.
    let mut b = bound(&source.replace("  expire at .until\n", ""));
    let expiring = bound(SOURCE).schema.tables.remove("messages").unwrap();
    b.schema.tables.insert("messages".into(), expiring);
    let result = analyze(&b.schema, &b.programs.iter().find(|p| p.program.name == "guarded").unwrap().program);
    assert_eq!(result.class, Class::Grows, "{result:?}");
    assert!(result.line().contains("whole live basis"), "{result:?}");
    for source_expiry in [true, false] {
        for predicate in ["value = 0", "recountPending = false"] {
            let mut source = SOURCE.replace("  expire at .until\n", "");
            if !source_expiry {
                source = source.replace("  joinedAt: int default 0", "  joinedAt: int default 0\n  until: time ?\n  expire at .until")
                    .replace("read <- exists members[.conversationId, viewer]", "read <- allow")
                    .replace("sync to members[.conversationId] last 3 by .ordinal", "sync public");
            }
            source += &format!("\ntable gated:\n  member: members\n  read <- exists unread[member = .member, {predicate}]\nquery guarded(id: gated):\n  return gated[id]\n");
            let mut b = bound(&source);
            if source_expiry { b.schema.tables.insert("messages".into(), bound(SOURCE).schema.tables.remove("messages").unwrap()); }
            let result = analyze(&b.schema, &b.programs.iter().find(|p|p.program.name=="guarded").unwrap().program);
            assert_eq!(result.class,Class::Grows,"{predicate} source_expiry={source_expiry}: {result:?}");
            assert!(result.line().contains("whole live basis"),"{result:?}");
            assert!(!result.line().contains("does not certify the count"),"{result:?}");
        }
    }
}

#[test]
fn certificate_uses_the_guide_plan_and_actual_fields_without_invented_backlog() {
    let guide = snapback4_lang::guide::card("maintains").unwrap();
    let example = snapback4_lang::guide::quarry(guide.split("## A value per member: Clique unread").nth(1).unwrap()).remove(0);
    for source in [example, SOURCE.replace("readUpTo", "seenThrough").replace("ordinal", "position").replace(".position > m.seenThrough", ".position >= m.seenThrough")] {
        let b=bound(&source);
        let query=b.programs.iter().find(|p|["badge","myUnread"].contains(&p.program.name.as_str())).unwrap();
        let result=analyze(&b.schema,&query.program);
        let line=result.line();
        for text in ["at most 64 stored keys", "necessary predicate index", "candidates include unswept expired rows", "expiry and the full predicate", "Larger ranges keep the shared parent/expiry index walk", "reserving one examined unit and one step", "probes and walks consume the internal ledger", "does not use the private-walk allowance", "Member lookup, authorization and the result cost more", "source group is readable by its audience", "full floor key", "and the scan finishes", "online client takes the server's count when permitted", "partial and does not ask", "expired rows in the range cost device work", "every range operand is null"] {
            assert!(line.contains(text),"missing {text}: {line}");
        }
        if source.contains("seenThrough") {
            assert!(line.contains(".position >= member.seenThrough"),"{line}");
            assert!(!line.contains("readUpTo") && !line.contains(".ordinal"));
        }
        assert_eq!(result.class,Class::Grows);
        assert!(result.growth_sites.iter().all(|g| !g.backlog),"{result:?}");
        assert!(result.bounds.rows_examined < 8192);
    }
}

#[test]
fn live_view_page_and_point_certificates_cover_real_receipts() {
    use snapback4_core::{Context, Engine, Value, wire};
    use serde_json::json;
    use std::collections::BTreeMap;
    let granted = SOURCE
        .replace("read <- .principal = viewer", "read <- exists grants[.conversationId, viewer]")
        .replace("sync to .principal", "sync to grants[.conversationId]")
        .replace("read <- exists members[.conversationId, viewer]", "read <- allow")
        .replace("sync to members[.conversationId]", "sync public")
        .replace("query badgeRows():\n  return unread where .principal = viewer", "query badgeRows(conversationId: conversations):\n  return unread where .conversationId = conversationId")
        + "\ntable grants:\n  conversationId: conversations\n  principal: principal\n  immutable conversationId, principal\n  unique conversationId, principal\n  read <- .principal = viewer\n  sync to .principal\n";
    for (variant, source, member_grant) in [
        ("expiring", SOURCE.to_owned(), false),
        ("non-expiring", SOURCE.replace("  expire at .until\n", ""), false),
        ("expiring-member", SOURCE.replace("  expire at .until\n", "")
            .replace("  joinedAt: int default 0", "  joinedAt: int default 0\n  until: time ?\n  expire at .until")
            .replace("read <- exists members[.conversationId, viewer]", "read <- allow")
            .replace("sync to members[.conversationId] last 3 by .ordinal", "sync public"), false),
        ("member-grant", granted, true),
    ] {
        let b = bound(&source);
        let certs = ["badgeRows", "badge"].map(|name| {
            analyze(&b.schema, &b.programs.iter().find(|p| p.program.name == name).unwrap().program)
        });
        let mut engine = Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap();
        let mut rows = Vec::new();
        // One row past the page proves cursorless queries do not charge
        // overflow; the conservative certificate must still cover the receipt.
        let seeded = if member_grant { 100 } else { 101 };
        for n in 0..seeded {
            let c = if member_grant { "c0".into() } else { format!("c{n}") };
            if !member_grant || n == 0 { rows.push(("conversations", json!({"id":c,"title":"chat"}))); }
            let principal = if member_grant { format!("principal{n}") } else { "bob".into() };
            rows.push(("members", json!({"id":format!("u{n}"),"conversationId":c,"principal":principal,"readUpTo":0,"joinedAt":0})));
            rows.push(("messages", json!({"id":format!("m{n}"),"conversationId":c,"ordinal":1,"at":1,"senderId":"alice","tombstone":false,"until":null})));
        }
        if member_grant { rows.push(("grants", json!({"id":"g","conversationId":"c0","principal":"bob"}))); }
        engine.seed(rows.into_iter().map(|(table, row)| {
            (table.into(), wire::row_from_json(&engine.schema().tables[table], &row).unwrap())
        }).collect::<Vec<_>>()).unwrap();
        for (i, name) in ["badgeRows", "badge"].into_iter().enumerate() {
            let args = if i == 1 { BTreeMap::from([("member".into(), Value::Id("u0".into()))]) }
                else if member_grant { BTreeMap::from([("conversationId".into(), Value::Id("c0".into()))]) }
                else { BTreeMap::new() };
            let q = engine.query(name, Context::new("bob", args).at(1)).unwrap();
            // LLP 3000.027: the cursorless bound defines this requested page.
            assert!(q.complete, "{variant} {name}");
            let count = Value::Int(if member_grant { 100 } else { 1 });
            if i == 0 {
                let Value::Array(page) = &q.data else { panic!("{variant}: {q:?}") };
                assert_eq!(page.len(), 100);
                for row in page { assert_eq!(row.field("value").unwrap(), &count); }
            } else { assert_eq!(q.data, count); }
            let visited = if i == 0 { 100 } else { 1 };
            // View row + member + live certification or private work-key lookup.
            assert_eq!(q.metered.examined, visited * 3, "{variant} {name}");
            assert_eq!(q.metered.rule_probes, if variant=="expiring-member" {0} else {visited + u64::from(member_grant)}, "{variant} {name}");
            assert!(certs[i].bounds.rows_examined >= q.metered.examined, "{variant} {name}: {q:?} exceeds {:?}", certs[i]);
            assert!(certs[i].bounds.probes >= q.metered.rule_probes, "{variant} {name}: {q:?} exceeds {:?}", certs[i]);
            eprintln!("{variant} {name}: certificate {} examined / {} probes, receipt {} / {}", certs[i].bounds.rows_examined, certs[i].bounds.probes, q.metered.examined, q.metered.rule_probes);
        }
    }
}

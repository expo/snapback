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
                "the walk itself is not metered",
            ] {
                assert!(line.contains(text), "{line}");
            }
            assert_eq!(line.contains(".ordinal > member.readUpTo"), range, "{line}");
            assert_eq!(
                line.contains("exact only when it holds the whole group"),
                !range,
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
}

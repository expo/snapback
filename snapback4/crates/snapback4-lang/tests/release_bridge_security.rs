//! Generated rollback source still participates in the ordinary intent campaign.
// @ref LLP 3000.000.000.002#8-wave-21-release-evolution — a bridge retains target rules and intent.
// @ref LLP 3000.036.004#15-sec6-write-boundaries-returned-privacy-and-deployment-review — creation and typed results remain observed.
use snapback4_lang::{compile, release_bridge, security::challenges::{self, Campaign}};

#[test]
fn renamed_loosened_bridge_preserves_privacy_and_challenges_creation() {
    for guarded in [true, false] {
        let insert = if guarded { ".owner = viewer" } else { "allow" };
        let target = format!("table docs:\n  owner: principal\n  secret: text <=40 read <- .owner = viewer\n  read <- allow\n  insert <- {insert}\n  online only\nmutation create(owner: principal, secret: text <=40):\n  return insert docs {{owner,secret}}\nquery list():\n  return docs first 10 by .id\ninvariant docs.secret write only .owner = viewer\ninvariant docs.secret read only .owner = viewer\n");
        let current = target.replace("table docs:", "table records renamed from docs:")
            .replace("docs", "records").replace("renamed from records", "renamed from docs")
            .replace("secret: text <=40 read", "secret: text <=80 ? read");
        let bridge = release_bridge::loosen(&[("schema.q".into(), target)], &[("schema.q".into(), current)]);
        assert!(bridge.diagnostics.is_empty(), "{:?}", bridge.diagnostics);
        let text = &bridge.sources[0].1;
        assert!(text.contains("read <- .owner = viewer"), "{text}");
        assert!(text.contains("invariant docs.secret write only .owner = viewer"), "{text}");
        assert!(text.contains("invariant docs.secret read only .owner = viewer"), "{text}");
        let bound = compile(&bridge.sources);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        let mut campaign = Campaign::default();
        challenges::generated_campaign(&bound, &mut campaign, true);
        let reachable: Vec<_> = campaign.violations.iter().filter(|v| v.reachability.is_reachable()).collect();
        assert!(reachable.iter().all(|v| v.effect != "mutation result" && v.effect != "read"), "{campaign:?}");
        assert_eq!(reachable.iter().any(|v| v.effect == "insert"), !guarded, "{campaign:?}");
    }
}

#[test]
fn bridge_recognizes_references_to_a_renamed_parent_as_the_same_identity() {
    let target = "table parents:\n  label: text <=40\n  public\n  online only\ntable docs:\n  parent: parents on delete restrict\n  public\n  online only\nquery list():\n  return docs first 10 by .id\n";
    let current = target.replace("parents", "guardians")
        .replace("table guardians:", "table guardians renamed from parents:");
    let bridge = release_bridge::loosen(&[("schema.q".into(), target.into())], &[("schema.q".into(), current)]);
    assert!(bridge.diagnostics.is_empty(), "{:?}", bridge.diagnostics);
    assert!(!bridge.changes.iter().any(|line| line.contains("docs.parent: incompatible")), "{:?}", bridge.changes);
    assert!(bridge.sources[0].1.contains("parent: parents on delete restrict"));
    let independent = target.replace("parents", "guardians");
    let bridge = release_bridge::loosen(&[("schema.q".into(), target.into())], &[("schema.q".into(), independent)]);
    assert!(bridge.changes.iter().any(|line| line.contains("docs.parent: incompatible")), "independent identities must not be unified: {:?}", bridge.changes);
}

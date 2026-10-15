//! Pause advice covers retained populations without running their activation.
use super::*;
use crate::rows::Rows;

fn open(source: &str) -> Engine {
    let b = compile(source);
    Engine::new_at(Store::memory().unwrap(), b.schema, b.programs, 0).unwrap()
}

fn preview(e: &mut Engine, next: &Schema) -> super::super::adoption_estimate::AdoptionEstimate {
    let before = ["r", "i", "_log", "_commits", "_generations"].map(|t| rows(e, t));
    let generation = e.generation();
    let estimate = e.store_mut().adoption_estimate(next).unwrap().expect("populated write work needs advice");
    assert_eq!(generation, e.generation());
    for (t, old) in ["r", "i", "_log", "_commits", "_generations"].into_iter().zip(before) {
        assert_eq!(rows(e, t), old, "preview wrote {t}");
    }
    estimate
}

const CHILDREN: &str = "table parents:\n  public\ntable children:\n  parent: parents\n  until: time default 50\n  immutable parent\n  expire at .until\n  read through .parent\n";
fn children(source: &str, count: usize) -> Engine {
    let mut e = open(source);
    e.seed_at(std::iter::once(("parents".into(), object([("id", Value::Id("p".into()))])))
        .chain((0..count).map(|n| ("children".into(), object([
            ("id", Value::Id(format!("c{n}"))), ("parent", Value::Id("p".into())), ("until", Value::Int(50)),
        ])))), 0).unwrap();
    e
}

#[test]
fn inherited_expiry_default_warns_before_retiring_one_thousand_children() {
    let mut e = children(CHILDREN, 1000);
    let next = compile(&CHILDREN.replace("default 50", "default 200"));
    let estimate = preview(&mut e, &next.schema);
    assert_eq!(estimate.deadline_rewrite_rows, 0);
    let message = estimate.summary();
    assert!(message.contains("unestimated write pause") && message.contains("read-through retirement/recapture children (1000 stored rows; deletion subset depends on activation time)"), "{message}");
    assert!(!message.contains("to recompute deadlines"), "{message}");
    e.adopt_at(next.schema, next.programs, 100).unwrap();
    assert!(e.store().rows("children").unwrap().is_empty());
    assert_eq!(e.store().conn().query_row("SELECT count(*) FROM i JOIN _catalog c ON c.num=i.ti WHERE c.name LIKE 'children.%'", [], |r| r.get::<_, i64>(0)).unwrap(), 0);
}

#[test]
fn adding_and_removing_read_through_warn_about_predecessor_retirement() {
    let ordinary = CHILDREN.replace("read through .parent", "public");
    for (old, new) in [(ordinary.as_str(), CHILDREN), (CHILDREN, ordinary.as_str())] {
        let mut e = children(old, 3);
        let next = compile(new);
        let estimate = preview(&mut e, &next.schema);
        assert_eq!(estimate.deadline_rewrite_rows, 0);
        let message = estimate.summary();
        assert!(message.contains("read-through retirement/recapture children (3 stored rows; deletion subset depends on activation time)"), "{message}");
        assert!(!message.contains("to recompute deadlines"), "{message}");
        e.adopt_at(next.schema, next.programs, 100).unwrap();
        assert!(e.store().rows("children").unwrap().is_empty());
    }
}

#[test]
fn unchanged_read_through_tables_warn_about_deadline_rewrites_without_retirement() {
    for now in [10, 100] {
        let mut e = children(CHILDREN, 3);
        let next = compile(&format!("{CHILDREN}\ntable unrelated:\n  public\n"));
        let estimate = preview(&mut e, &next.schema);
        assert_eq!(estimate.deadline_rewrite_rows, 3);
        assert_eq!((estimate.retired_rows, estimate.retired_index_entries), (0, 0));
        assert_eq!(estimate.seconds(), (0.0, 0.0)); // No measured rewrite rate.
        let message = estimate.summary();
        assert!(message.contains("unestimated write pause") && message.contains("read-through children rewrites 3 stored rows to recompute deadlines"), "{message}");
        assert!(!message.contains("retirement/recapture") && !message.contains("deletion subset"), "{message}");
        e.adopt_at(next.schema, next.programs, now).unwrap();
        assert_eq!(e.store().rows("children").unwrap().len(), 3);
    }
}

const GROUPS: &str = "table entries:\n  n: int\n  bucket: int\n  public\nview totals: count entries by .n\n";
fn groups() -> Engine {
    let mut e = open(GROUPS);
    e.seed_at((0..4).map(|n| ("entries".into(), object([
        ("id", Value::Id(format!("r{n}"))), ("n", Value::Int(n)), ("bucket", Value::Int(0)),
    ]))), 0).unwrap();
    e
}
fn rebuild_groups(next: &str, remaining: usize) {
    let mut e = groups();
    let next = compile(next);
    let estimate = preview(&mut e, &next.schema);
    assert_eq!(estimate.retired_rows, 4);
    assert!(estimate.retired_index_entries >= 8);
    assert!(estimate.summary().contains("unestimated retirement pause"));
    e.adopt_at(next.schema, next.programs, 10).unwrap();
    assert_eq!(e.store().rows("totals").unwrap().len(), remaining);
}

#[test]
fn missing_identity_marker_rebuilds_a_principal_reference_and_max_text_group() {
    const SOURCE: &str = "table parents:\n  public\ntable entries:\n  owner: principal\n  parent: parents\n  token: text <=64\n  amount: int\n  public\nview totals: sum entries of .amount by .owner, .parent, .token\n  public\n";
    let initial = compile(SOURCE);
    let mut e = Engine::new_at(Store::memory().unwrap(), initial.schema, initial.programs, 0).unwrap();
    let owner = format!("user:{}", "o".repeat(59));
    let parent = "p".repeat(64);
    let token = "t".repeat(64);
    assert_eq!((owner.len(), parent.len(), token.len()), (64, 64, 64));
    e.seed_at([
        ("parents".into(), object([("id", Value::Id(parent.clone()))])),
        ("entries".into(), object([("id", Value::Id("entry".into())), ("owner", Value::Id(owner.clone())),
            ("parent", Value::Id(parent.clone())), ("token", Value::String(token.clone())), ("amount", Value::Int(7))])),
    ], 0).unwrap();
    let expected = crate::schema::maintained_id(&[Value::Id(owner), Value::Id(parent), Value::String(token)]);
    let before = e.store().rows("totals").unwrap();
    assert_eq!(before.len(), 1);
    assert_eq!(before[0].field("id").unwrap(), &Value::Id(expected.clone()));
    assert_eq!(before[0].field("value").unwrap(), &Value::Int(7));
    assert_eq!(expected.len(), 64);

    e.store().conn().execute("DELETE FROM _meta WHERE key=?1", [crate::schema::MAINTAINED_ID_META]).unwrap();
    let next = compile(SOURCE);
    assert_eq!(preview(&mut e, &next.schema).aggregate_rows, 1);
    let generation = e.generation();
    e.adopt_at(next.schema, next.programs, 1).unwrap();
    assert!(e.generation() > generation);
    assert_eq!(e.store().meta(crate::schema::MAINTAINED_ID_META).unwrap().as_deref(), Some(crate::schema::MAINTAINED_ID_VERSION));
    let after = e.store().rows("totals").unwrap();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].field("id").unwrap(), &Value::Id(expected));
    assert_eq!(after[0].field("value").unwrap(), &Value::Int(7));
}

#[test]
fn identity_redeployment_rebuilds_the_ungrouped_empty_tuple() {
    const SOURCE: &str = "table entries:\n  public\nview total: count entries\n  public\n";
    let initial = compile(SOURCE);
    let mut e = Engine::new_at(Store::memory().unwrap(), initial.schema, initial.programs, 0).unwrap();
    e.seed_at([("entries".into(), object([("id", Value::Id("entry".into()))]))], 0).unwrap();
    let expected = crate::schema::maintained_id(&[]);
    let before = e.store().rows("total").unwrap();
    assert_eq!(before.len(), 1);
    assert_eq!(before[0].field("id").unwrap(), &Value::Id(expected.clone()));
    assert_eq!(before[0].field("$global").unwrap(), &Value::Bool(true));
    assert_eq!(before[0].field("value").unwrap(), &Value::Int(1));

    e.store().conn().execute("DELETE FROM _meta WHERE key=?1", [crate::schema::MAINTAINED_ID_META]).unwrap();
    let next = compile(SOURCE);
    assert_eq!(preview(&mut e, &next.schema).aggregate_rows, 1);
    let generation = e.generation();
    e.adopt_at(next.schema, next.programs, 1).unwrap();
    assert!(e.generation() > generation);
    let after = e.store().rows("total").unwrap();
    assert_eq!(after.len(), 1);
    assert_eq!(after[0].field("id").unwrap(), &Value::Id(expected));
    assert_eq!(after[0].field("$global").unwrap(), &Value::Bool(true));
    assert_eq!(after[0].field("value").unwrap(), &Value::Int(1));
}

#[test]
fn identity_adoption_rekeys_sequence_history_without_reusing_deleted_ordinals() {
    const SOURCE: &str = "table entries:\n  bucket: int\n  public\nview totals: count entries by .bucket\n  public\ntable sequenced:\n  total: totals\n  ordinal: sequence by total\n  unique total, ordinal\n  public\n";
    let mut e = open(SOURCE);
    e.seed_at([
        ("entries".into(), object([("id", Value::Id("e7".into())), ("bucket", Value::Int(7))])),
        ("entries".into(), object([("id", Value::Id("e9".into())), ("bucket", Value::Int(9))])),
    ], 0).unwrap();
    let digest7 = crate::schema::maintained_id(&[Value::Int(7)]);
    let digest9 = crate::schema::maintained_id(&[Value::Int(9)]);
    e.seed_at([
        ("sequenced".into(), object([("id", Value::Id("gone".into())), ("total", Value::Id(digest7.clone()))])),
        ("sequenced".into(), object([("id", Value::Id("kept".into())), ("total", Value::Id(digest7.clone()))])),
    ], 0).unwrap();
    e.seed_delete("sequenced", "gone").unwrap();

    let legacy7 = crate::value::canonical_json(&[Value::Int(7)]);
    let legacy9 = crate::value::canonical_json(&[Value::Int(9)]);
    let noncanonical7 = "[ { \"Int\" : 7 } ]".to_owned();
    let wrong_type7 = crate::value::canonical_json(&[Value::String("7".into())]);
    let schema = e.schema().clone();
    let target = schema.tables["totals"].clone();
    let entries = schema.tables["entries"].clone();
    let sequenced = schema.tables["sequenced"].clone();
    let tx = e.store_mut().transaction().unwrap();
    let mut row = tx.get("totals", &digest7).unwrap().unwrap();
    tx.delete("totals", &target, &row).unwrap();
    if let Value::Row(fields) | Value::Map(fields) = &mut row {
        fields.insert("id".into(), Value::Id(legacy7.clone()));
    }
    tx.put("totals", &target, &row, None).unwrap();
    tx.delete("totals", &target, &tx.get("totals", &digest9).unwrap().unwrap()).unwrap();
    tx.delete("entries", &entries, &tx.get("entries", "e9").unwrap().unwrap()).unwrap();
    let old = tx.get("sequenced", "kept").unwrap().unwrap();
    let mut next = old.clone();
    if let Value::Row(fields) | Value::Map(fields) = &mut next {
        fields.insert("total".into(), Value::Id(legacy7.clone()));
    }
    tx.put("sequenced", &sequenced, &next, Some(&old)).unwrap();
    tx.set_sequence("totals", &legacy7, 7).unwrap();
    tx.set_sequence("totals", &digest7, 4).unwrap();
    tx.set_sequence("totals", &legacy9, crate::value::I53_MAX).unwrap();
    tx.set_sequence("totals", &digest9, 12).unwrap();
    tx.set_sequence("totals", &noncanonical7, 13).unwrap();
    tx.set_sequence("totals", &wrong_type7, 14).unwrap();
    tx.set_sequence("ordinary", &legacy7, 11).unwrap();
    tx.commit().unwrap();
    e.store().conn().execute("DELETE FROM _meta WHERE key=?1", [crate::schema::MAINTAINED_ID_META]).unwrap();

    let next = compile(SOURCE);
    e.adopt_at(next.schema, next.programs, 1).unwrap();
    let tx = e.store_mut().transaction().unwrap();
    assert_eq!(tx.sequence_value("totals", &legacy7).unwrap(), 0);
    assert_eq!(tx.sequence_value("totals", &legacy9).unwrap(), 0);
    assert_eq!(tx.sequence_value("totals", &digest7).unwrap(), 7, "the deleted allocating row and lower destination counter cannot lower the high-water mark");
    assert_eq!(tx.sequence_value("totals", &digest9).unwrap(), crate::value::I53_MAX);
    assert_eq!(tx.sequence_value("totals", &noncanonical7).unwrap(), 13, "a noncanonical dangling id must not collapse into the real group");
    assert_eq!(tx.sequence_value("totals", &wrong_type7).unwrap(), 14, "a canonical tuple with the wrong predecessor type stays opaque");
    assert_eq!(tx.sequence_value("ordinary", &legacy7).unwrap(), 11, "translation is scoped by parent table and id");
    tx.commit().unwrap();
    let kept = e.store().rows("sequenced").unwrap().pop().unwrap();
    assert_eq!(kept.field("total").unwrap(), &Value::Id(digest7.clone()));
    assert_eq!(kept.field("ordinal").unwrap(), &Value::Int(2));

    e.seed_at([("sequenced".into(), object([("id", Value::Id("next".into())), ("total", Value::Id(digest7))]))], 2).unwrap();
    assert_eq!(e.store().rows("sequenced").unwrap().into_iter().find(|row| row.field("id") == Ok(&Value::Id("next".into()))).unwrap().field("ordinal"), Ok(&Value::Int(8)));
    let error = e.seed_at([("sequenced".into(), object([("id", Value::Id("full".into())), ("total", Value::Id(digest9.clone()))]))], 2).unwrap_err();
    assert_eq!(error.refusal().code, "E_SEQUENCE_EXHAUSTED");
    let tx = e.store_mut().transaction().unwrap();
    assert_eq!(tx.sequence_value("totals", &digest9).unwrap(), crate::value::I53_MAX, "overflow refusal must not change the migrated counter");
    tx.rollback().unwrap();
}

#[test]
fn sequence_identity_adoption_keeps_invalid_canonical_groups_opaque() {
    const SOURCE: &str = "table owners:\n  public\ntable entries:\n  label: text 3..20 format handle\n  owner: owners\n  public\nview labelTotals: count entries by .label\n  public\nview ownerTotals: count entries by .owner\n  public\ntable labelSequence:\n  parent: labelTotals\n  ordinal: sequence by parent\n  public\ntable ownerSequence:\n  parent: ownerTotals\n  ordinal: sequence by parent\n  public\n";
    let mut e = open(SOURCE);
    let valid = crate::value::canonical_json(&[Value::String("valid_1".into())]);
    let invalid_control = crate::value::canonical_json(&[Value::String("\u{1}".into())]);
    let invalid_format = crate::value::canonical_json(&[Value::String("Not_A_Handle".into())]);
    let invalid_reference = crate::value::canonical_json(&[Value::Id("x".repeat(136))]);
    let valid_digest = crate::schema::maintained_id(&[Value::String("valid_1".into())]);
    let control_digest = crate::schema::maintained_id(&[Value::String("\u{1}".into())]);
    let format_digest = crate::schema::maintained_id(&[Value::String("Not_A_Handle".into())]);
    let reference_digest = crate::schema::maintained_id(&[Value::Id("x".repeat(136))]);
    let tx = e.store_mut().transaction().unwrap();
    tx.set_sequence("labelTotals", &valid, 5).unwrap();
    tx.set_sequence("labelTotals", &invalid_control, 6).unwrap();
    tx.set_sequence("labelTotals", &invalid_format, 7).unwrap();
    tx.set_sequence("ownerTotals", &invalid_reference, 8).unwrap();
    tx.commit().unwrap();
    e.store().conn().execute("DELETE FROM _meta WHERE key=?1", [crate::schema::MAINTAINED_ID_META]).unwrap();

    let next = compile(SOURCE);
    e.adopt_at(next.schema, next.programs, 1).unwrap();
    let tx = e.store_mut().transaction().unwrap();
    assert_eq!(tx.sequence_value("labelTotals", &valid).unwrap(), 0);
    assert_eq!(tx.sequence_value("labelTotals", &valid_digest).unwrap(), 5, "a fully admitted predecessor group migrates");
    for (parent, old, digest, high) in [
        ("labelTotals", &invalid_control, &control_digest, 6),
        ("labelTotals", &invalid_format, &format_digest, 7),
        ("ownerTotals", &invalid_reference, &reference_digest, 8),
    ] {
        assert_eq!(tx.sequence_value(parent, old).unwrap(), high, "invalid canonical tuple retains opaque custody");
        assert_eq!(tx.sequence_value(parent, digest).unwrap(), 0, "invalid canonical tuple does not create digest custody");
    }
    tx.commit().unwrap();

    e.seed_at([
        ("labelSequence".into(), object([("id", Value::Id("control".into())), ("parent", Value::Id(invalid_control))])),
        ("labelSequence".into(), object([("id", Value::Id("format".into())), ("parent", Value::Id(invalid_format))])),
    ], 2).unwrap();
    let label_rows = e.store().rows("labelSequence").unwrap();
    assert_eq!(label_rows.iter().find(|row| row.field("id") == Ok(&Value::Id("control".into()))).unwrap().field("ordinal"), Ok(&Value::Int(7)));
    assert_eq!(label_rows.iter().find(|row| row.field("id") == Ok(&Value::Id("format".into()))).unwrap().field("ordinal"), Ok(&Value::Int(8)));
}

#[test]
fn newly_maintained_ordinary_target_does_not_reinterpret_predecessor_custody() {
    const OLD: &str = "table entries:\n  label: text 3..20 format handle\n  public\ntable oldEntries:\n  bucket: int\n  public\nview oldTotals: count oldEntries by .bucket\n  public\ntable totals:\n  label: text 3..20 format handle\n  value: int\n  public\ntable saved:\n  target: totals\n  public\ntable sequenced:\n  parent: totals\n  ordinal: sequence by parent\n  public\n";
    const NEW: &str = "table entries:\n  label: text 3..20 format handle\n  public\ntable oldEntries:\n  bucket: int\n  public\nview oldTotals: count oldEntries by .bucket\n  public\nview totals: count entries by .label\n  public\ntable saved:\n  target: totals\n  public\ntable sequenced:\n  parent: totals\n  ordinal: sequence by parent\n  public\n";
    let mut e = open(OLD);
    let legacy = crate::value::canonical_json(&[Value::String("valid_1".into())]);
    let digest = crate::schema::maintained_id(&[Value::String("valid_1".into())]);
    e.seed_at([
        ("oldEntries".into(), object([("id", Value::Id("old-entry".into())), ("bucket", Value::Int(1))])),
        ("totals".into(), object([("id", Value::Id(legacy.clone())), ("label", Value::String("valid_1".into())), ("value", Value::Int(42))])),
        ("saved".into(), object([("id", Value::Id("saved".into())), ("target", Value::Id(legacy.clone()))])),
    ], 0).unwrap();
    let tx = e.store_mut().transaction().unwrap();
    tx.set_sequence("totals", &legacy, 4).unwrap();
    tx.commit().unwrap();
    e.store().conn().execute("DELETE FROM _meta WHERE key=?1", [crate::schema::MAINTAINED_ID_META]).unwrap();

    let next = compile(NEW);
    e.adopt_at(next.schema, next.programs, 1).unwrap();
    let tx = e.store_mut().transaction().unwrap();
    assert_eq!(tx.sequence_value("totals", &legacy).unwrap(), 4, "the predecessor had no aggregate identity domain");
    assert_eq!(tx.sequence_value("totals", &digest).unwrap(), 0, "a newly maintained same-name table does not capture ordinary custody");
    tx.rollback().unwrap();
    assert_eq!(e.store().rows("saved").unwrap()[0].field("target"), Ok(&Value::Id(legacy)), "a legacy migration elsewhere cannot rebind the ordinary predecessor's references");
}

#[test]
fn removing_an_aggregate_normalizes_retained_sequence_custody_before_marking_the_store() {
    const SOURCE: &str = "table entries:\n  bucket: int\n  public\nview totals: count entries by .bucket\n  public\ntable sequenced:\n  total: totals\n  ordinal: sequence by total\n  unique total, ordinal\n  public\n";
    const WITHOUT_AGGREGATE: &str = "table entries:\n  bucket: int\n  public\n";
    let mut e = open(SOURCE);
    e.seed_at([("entries".into(), object([("id", Value::Id("entry".into())), ("bucket", Value::Int(3))]))], 0).unwrap();
    let digest = crate::schema::maintained_id(&[Value::Int(3)]);
    let legacy = crate::value::canonical_json(&[Value::Int(3)]);
    let target = e.schema().tables["totals"].clone();
    let tx = e.store_mut().transaction().unwrap();
    let mut row = tx.get("totals", &digest).unwrap().unwrap();
    tx.delete("totals", &target, &row).unwrap();
    if let Value::Row(fields) | Value::Map(fields) = &mut row {
        fields.insert("id".into(), Value::Id(legacy.clone()));
    }
    tx.put("totals", &target, &row, None).unwrap();
    tx.set_sequence("totals", &legacy, 5).unwrap();
    tx.commit().unwrap();
    e.store().conn().execute("DELETE FROM _meta WHERE key=?1", [crate::schema::MAINTAINED_ID_META]).unwrap();

    let removed = compile(WITHOUT_AGGREGATE);
    e.adopt_at(removed.schema, removed.programs, 1).unwrap();
    let tx = e.store_mut().transaction().unwrap();
    assert_eq!(tx.sequence_value("totals", &legacy).unwrap(), 0);
    assert_eq!(tx.sequence_value("totals", &digest).unwrap(), 5);
    tx.commit().unwrap();
    assert_eq!(e.store().meta(crate::schema::MAINTAINED_ID_META).unwrap().as_deref(), Some(crate::schema::MAINTAINED_ID_VERSION));

    let restored = compile(SOURCE);
    e.adopt_at(restored.schema, restored.programs, 2).unwrap();
    e.seed_at([("sequenced".into(), object([("id", Value::Id("next".into())), ("total", Value::Id(digest))]))], 3).unwrap();
    assert_eq!(e.store().rows("sequenced").unwrap()[0].field("ordinal"), Ok(&Value::Int(6)));
}

#[test]
fn counter_only_aggregate_reference_chains_rekey_to_the_final_digest() {
    const SOURCE: &str = "table aEntries:\n  key: int\n  public\nview aTotals: count aEntries by .key\n  public\ntable bEntries:\n  parent: aTotals\n  public\nview bTotals: count bEntries by .parent\n  public\ntable sequenced:\n  parent: bTotals\n  ordinal: sequence by parent\n  public\n";
    let mut e = open(SOURCE);
    let legacy_a = crate::value::canonical_json(&[Value::Int(5)]);
    let legacy_b = crate::value::canonical_json(&[Value::Id(legacy_a.clone())]);
    let digest_a = crate::schema::maintained_id(&[Value::Int(5)]);
    let digest_b = crate::schema::maintained_id(&[Value::Id(digest_a)]);
    let tx = e.store_mut().transaction().unwrap();
    tx.set_sequence("bTotals", &legacy_b, 9).unwrap();
    tx.commit().unwrap();
    e.store().conn().execute("DELETE FROM _meta WHERE key=?1", [crate::schema::MAINTAINED_ID_META]).unwrap();

    let next = compile(SOURCE);
    e.adopt_at(next.schema, next.programs, 1).unwrap();
    let tx = e.store_mut().transaction().unwrap();
    assert_eq!(tx.sequence_value("bTotals", &legacy_b).unwrap(), 0);
    assert_eq!(tx.sequence_value("bTotals", &digest_b).unwrap(), 9, "the absent referenced aggregate identity must settle before its dependent counter key");
    tx.rollback().unwrap();
}

#[test]
fn surviving_aggregate_identity_wins_over_a_counter_only_dependency() {
    const SOURCE: &str = "table aEntries:\n  key: int\n  public\nview aTotals: count aEntries by .key\n  public\ntable bEntries:\n  parent: aTotals\n  public\nview bTotals: count bEntries by .parent\n  public\ntable cEntries:\n  parent: bTotals\n  public\nview cTotals: count cEntries by .parent\n  public\ntable sequenced:\n  parent: bTotals\n  ordinal: sequence by parent\n  public\n";
    let mut e = open(SOURCE);
    let digest_a = crate::schema::maintained_id(&[Value::Int(5)]);
    e.seed_at([
        ("aEntries".into(), object([("id", Value::Id("a".into())), ("key", Value::Int(5))])),
        ("bEntries".into(), object([("id", Value::Id("b".into())), ("parent", Value::Id(digest_a.clone()))])),
    ], 0).unwrap();
    let legacy_a = crate::value::canonical_json(&[Value::Int(5)]);
    let digest_b = crate::schema::maintained_id(&[Value::Id(digest_a.clone())]);
    let legacy_b = crate::value::canonical_json(&[Value::Id(legacy_a.clone())]);
    let dangling_b = crate::schema::maintained_id(&[Value::Id(legacy_a.clone())]);
    let legacy_c = crate::value::canonical_json(&[Value::Id(legacy_b.clone())]);
    let digest_c = crate::schema::maintained_id(&[Value::Id(dangling_b.clone())]);
    let redirected_c = crate::schema::maintained_id(&[Value::Id(digest_b.clone())]);
    let schema = e.schema().clone();
    let tx = e.store_mut().transaction().unwrap();
    tx.delete("aTotals", &schema.tables["aTotals"], &tx.get("aTotals", &digest_a).unwrap().unwrap()).unwrap();
    tx.delete("aEntries", &schema.tables["aEntries"], &tx.get("aEntries", "a").unwrap().unwrap()).unwrap();
    let old_source = tx.get("bEntries", "b").unwrap().unwrap();
    let mut next_source = old_source.clone();
    if let Value::Row(fields) | Value::Map(fields) = &mut next_source {
        fields.insert("parent".into(), Value::Id(legacy_a.clone()));
    }
    tx.put("bEntries", &schema.tables["bEntries"], &next_source, Some(&old_source)).unwrap();
    let mut target = tx.get("bTotals", &digest_b).unwrap().unwrap();
    tx.delete("bTotals", &schema.tables["bTotals"], &target).unwrap();
    if let Value::Row(fields) | Value::Map(fields) = &mut target {
        fields.insert("id".into(), Value::Id(legacy_b.clone()));
        fields.insert("parent".into(), Value::Id(legacy_a.clone()));
    }
    tx.put("bTotals", &schema.tables["bTotals"], &target, None).unwrap();
    tx.set_sequence("bTotals", &legacy_b, 7).unwrap();
    tx.set_sequence("cTotals", &legacy_c, 11).unwrap();
    tx.commit().unwrap();
    e.store().conn().execute("DELETE FROM _meta WHERE key=?1", [crate::schema::MAINTAINED_ID_META]).unwrap();

    let next = compile(SOURCE);
    e.adopt_at(next.schema, next.programs, 1).unwrap();
    let tx = e.store_mut().transaction().unwrap();
    assert!(tx.get("bTotals", &dangling_b).unwrap().is_some());
    assert_eq!(tx.sequence_value("bTotals", &legacy_b).unwrap(), 0);
    assert_eq!(tx.sequence_value("bTotals", &dangling_b).unwrap(), 7, "counter custody follows the surviving rebuilt parent");
    assert_eq!(tx.sequence_value("bTotals", &digest_b).unwrap(), 0, "the absent dependency cannot redirect custody");
    assert_eq!(tx.sequence_value("cTotals", &legacy_c).unwrap(), 0);
    assert_eq!(tx.sequence_value("cTotals", &digest_c).unwrap(), 11, "counter-only dependents inherit the authoritative surviving parent map");
    assert_eq!(tx.sequence_value("cTotals", &redirected_c).unwrap(), 0);
    tx.rollback().unwrap();
    e.seed_at([("sequenced".into(), object([("id", Value::Id("next".into())), ("parent", Value::Id(dangling_b))]))], 2).unwrap();
    assert_eq!(e.store().rows("sequenced").unwrap()[0].field("ordinal"), Ok(&Value::Int(8)));
}

#[test]
fn sequence_identity_rekey_rolls_back_with_the_adoption_writer() {
    let mut store = Store::memory().unwrap();
    let legacy = crate::value::canonical_json(&[Value::Int(7)]);
    let digest = crate::schema::maintained_id(&[Value::Int(7)]);
    let tx = store.transaction().unwrap();
    tx.set_sequence("totals", &legacy, 11).unwrap();
    tx.commit().unwrap();

    let tx = store.transaction().unwrap();
    tx.rewrite_sequence_ids(&BTreeMap::from([(
        "totals".into(),
        BTreeMap::from([(legacy.clone(), digest.clone())]),
    )])).unwrap();
    assert_eq!(tx.sequence_value("totals", &legacy).unwrap(), 0);
    assert_eq!(tx.sequence_value("totals", &digest).unwrap(), 11);
    tx.rollback().unwrap();

    let tx = store.transaction().unwrap();
    assert_eq!(tx.sequence_value("totals", &legacy).unwrap(), 11);
    assert_eq!(tx.sequence_value("totals", &digest).unwrap(), 0);
    tx.rollback().unwrap();
}

#[test]
fn changed_filter_counts_cleared_retained_view_rows() {
    rebuild_groups(&GROUPS.replace("count entries by", "count entries where .n < 0 by"), 0);
}
#[test]
fn changed_key_counts_cleared_retained_view_rows() {
    rebuild_groups(&GROUPS.replace("by .n", "by .bucket"), 1);
}
#[test]
fn legacy_identity_adoption_can_change_the_grouping_key() {
    let mut e = groups();
    let schema = e.schema().clone();
    let target = schema.tables["totals"].clone();
    let rows = e.store().rows("totals").unwrap();
    let tx = e.store_mut().transaction().unwrap();
    for old in rows {
        tx.delete("totals", &target, &old).unwrap();
        let mut legacy = old.clone();
        let id = crate::value::canonical_json(&[old.field("n").unwrap().clone()]);
        if let Value::Row(fields) | Value::Map(fields) = &mut legacy {
            fields.insert("id".into(), Value::Id(id));
        }
        tx.put("totals", &target, &legacy, None).unwrap();
    }
    tx.commit().unwrap();
    e.store().conn().execute(
        "DELETE FROM _meta WHERE key=?1",
        [crate::schema::MAINTAINED_ID_META],
    ).unwrap();

    let next = compile(&GROUPS.replace("by .n", "by .bucket"));
    e.adopt_at(next.schema, next.programs, 10).unwrap();
    let rows = e.store().rows("totals").unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].field("id").unwrap(),
        &Value::Id(crate::schema::maintained_id(&[Value::Int(0)])));
    assert_eq!(rows[0].field("bucket").unwrap(), &Value::Int(0));
    assert_eq!(rows[0].field("value").unwrap(), &Value::Int(4));
}
#[test]
fn empty_source_does_not_hide_retained_target_cleanup() {
    let mut e = groups();
    // A legacy/imported target may outlive its source population.
    e.store().conn().execute_batch("DELETE FROM r WHERE t=(SELECT num FROM _catalog WHERE name='entries'); DELETE FROM i WHERE ti IN (SELECT num FROM _catalog WHERE name LIKE 'entries.%');").unwrap();
    let next = compile(&GROUPS.replace("count entries by", "count entries where .n < 0 by"));
    let estimate = preview(&mut e, &next.schema);
    assert_eq!(estimate.aggregate_rows, 0);
    assert_eq!(estimate.retired_rows, 4);
    e.adopt_at(next.schema, next.programs, 10).unwrap();
    assert!(e.store().rows("totals").unwrap().is_empty());
}

#[test]
fn parent_lifetime_change_warns_about_mirror_without_private_rebuild() {
    let source = "table posts:\n  until: time default 50\n  expire at .until\n  likes: count likes by postId\n  public\ntable likes:\n  postId: posts\n  public\n";
    let mut e = open(source);
    e.seed_at([("posts".into(), object([("id", Value::Id("p".into())), ("until", Value::Int(50))]))], 0).unwrap();
    let next = compile(&source.replace("default 50", "default 200"));
    assert!(!crate::successor::maintain_rebuild_needed(e.schema(), &next.schema, &next.schema.maintains[0]));
    let message = preview(&mut e, &next.schema).summary();
    assert!(message.contains("maintained-column mirror posts (1 stored rows)"), "{message}");
    assert!(!message.contains("$column:"));
}

#[test]
fn cap_occupancy_reset_is_visible_even_when_table_definition_is_unchanged() {
    let source = "table entries:\n  n: int\n  until: time ?\n  expire at .until\n  cap 4 by n\n  public\n";
    let mut e = open(source);
    e.seed_at([("entries".into(), object([("id", Value::Id("e".into())), ("n", Value::Int(0)), ("until", Value::Int(50))]))], 0).unwrap();
    let next = compile(&format!("{source}\ntable unrelated:\n  public\n"));
    let message = preview(&mut e, &next.schema).summary();
    assert!(message.contains("cap occupancy reset/rebuild (1 stored entries, 1 source rows)"), "{message}");
    // Legacy activation repairs missing occupancy metadata on unchanged schemas too.
    e.store().conn().execute("DELETE FROM _meta WHERE key='cap_counts_schema'", []).unwrap();
    let same = e.schema().clone();
    assert!(preview(&mut e, &same).summary().contains("cap occupancy reset/rebuild"));
}

#[test]
fn asset_home_retirement_warns_even_without_application_rows() {
    let mut e = open("table entries:\n  photo: image <=1000 ?\n  public\n");
    // The activation ledger can outlive the home row; no asset bytes are needed.
    e.store().conn().execute_batch("INSERT INTO _assets(id,owner,kind,content_type,bytes,created_at,home_table,home_id,home_column) VALUES('a','alice','image','image/png',1,0,'entries','gone','photo');").unwrap();
    let next = compile("table entries:\n  public\n");
    assert!(preview(&mut e, &next.schema).summary().contains("asset-home retirement entries.photo (1 ledger rows)"));
    assert!(e.store().conn().query_row("SELECT released_at IS NULL FROM _assets WHERE id='a'", [], |r| r.get::<_, bool>(0)).unwrap());
}

#[test]
fn legacy_live_sum_repair_is_visible_even_without_schema_change() {
    let source = "table entries:\n  n: int\n  until: time ?\n  expire at .until\n  public\nview totals: sum entries of .n by .n\n";
    let mut e = open(source);
    e.seed_at([("entries".into(), object([("id", Value::Id("e".into())), ("n", Value::Int(1)), ("until", Value::Int(50))]))], 0).unwrap();
    e.store().conn().execute("DELETE FROM _meta WHERE key='live_sum_candidates'", []).unwrap();
    let next = e.schema().clone();
    let estimate = preview(&mut e, &next);
    assert_eq!(estimate.retired_rows, 1);
    assert_eq!(estimate.aggregate_rows, 1);
}

#[test]
fn row_view_rebuild_counts_retained_recount_and_basis_rows() {
    const SOURCE: &str = include_str!("../../../../snapback4-lang/tests/fixtures/row-keyed-view.q");
    for count in [1, 1100] {
        let mut e = open(SOURCE.split("view unread:").next().unwrap());
        let mut input = vec![("members".into(), crate::wire::row_from_json(&e.schema().tables["members"],
            &serde_json::json!({"id":"m","conversationId":"c","principal":"bob","readUpTo":0,"joinedAt":0})).unwrap())];
        input.extend((1..=count).map(|n| ("messages".into(), crate::wire::row_from_json(&e.schema().tables["messages"],
            &serde_json::json!({"id":format!("r{n:04}"),"conversationId":"c","ordinal":n,"senderId":"alice","tombstone":false,"until":1000})).unwrap())));
        e.seed_at(input, 0).unwrap();
        let bound = compile(SOURCE);
        e.adopt_at(bound.schema, bound.programs, 1).unwrap();
        let hidden = if count == 1 { "$basis:unread" } else { "$recount:unread" };
        assert!(!e.store().rows(hidden).unwrap().is_empty(), "{hidden}");
        let rows: i64 = e.store().conn().query_row("SELECT count(*) FROM r JOIN _catalog c ON c.num=r.t WHERE c.name IN ('unread','$basis:unread','$recount:unread')", [], |r| r.get(0)).unwrap();
        let next = compile(&SOURCE.replace("and not .tombstone", "and .tombstone"));
        let estimate = preview(&mut e, &next.schema);
        assert_eq!(estimate.retired_rows, rows as u64);
        assert!(!estimate.summary().contains("$basis:") && !estimate.summary().contains("$recount:"));
        e.adopt_at(next.schema, next.programs, 2).unwrap();
    }
}

#[test]
fn projection_index_replacement_and_capture_fills_keep_their_population_advice() {
    let source = "table entries:\n  n: int\n  junk: int\n  by byN: n\n  public\n";
    let mut e = open(source);
    e.seed_at([("entries".into(), object([("id", Value::Id("r".into())), ("n", Value::Int(1)), ("junk", Value::Int(2))]))], 0).unwrap();
    let next = compile(&source.replace("  junk: int\n", "").replace("byN: n", "byN: id"));
    let estimate = preview(&mut e, &next.schema);
    assert_eq!((estimate.projected_rows, estimate.index_rows, estimate.retired_index_entries), (1, 1, 1));
    e.adopt_at(next.schema, next.programs, 1).unwrap();
    assert!(e.store().rows("entries").unwrap()[0].field("junk").is_err());
    let mut e = engine(false);
    let next = compile(&format!("{BASE}{VIEWS}"));
    assert!(preview(&mut e, &next.schema).capture_rows > 0);
}

#[test]
fn unchanged_and_empty_stores_remain_quiet() {
    let mut e = open(GROUPS);
    let next = compile(&GROUPS.replace("by .n", "by .bucket"));
    assert!(e.store_mut().adoption_estimate(&next.schema).unwrap().is_none());
    let mut e = groups();
    let same = e.schema().clone();
    assert!(e.store_mut().adoption_estimate(&same).unwrap().is_none());
}

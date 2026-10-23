//! The list-to-child migration owns actual asset homes across edited cycles.
use super::*;
const OLD_EACH: &str = "table orders:\n  names: [file <=1000] <=8\n  public 'fixture'\n  insert <- allow\n  update <- allow\n  online only\nmutation add(names: [file <=1000] <=8):\n  return insert orders {names}\nmutation edit(id: orders, names: [file <=1000] <=8):\n  return update orders[id] {names}\n";
const NEW_EACH: &str = "table orders:\n  public 'fixture'\n  insert <- allow\n  online only\ntable documents:\n  order: orders on delete cascade\n  names: file <=1000\n  public 'fixture'\n  insert <- allow\n  update <- allow\n  delete <- allow\n  online only\nextract documents from orders via order each: {names:names}\nmutation attach(order: orders, names: file <=1000):\n  return insert documents {order,names}\nmutation edit(id: documents, names: file <=1000):\n  return update documents[id] {names}\nmutation remove(id: documents):\n  delete documents[id]\n";
fn handle(e: &mut Engine, text: &[u8]) -> Value {
    let asset = e
        .store_file("alice", text, Some("text/plain"), "names.txt", 100)
        .unwrap();
    Value::Map(BTreeMap::from([("id".into(), Value::Id(asset.id))]).into())
}
fn mutate(
    e: &mut Engine,
    op: &str,
    args: impl IntoIterator<Item = (&'static str, Value)>,
) -> Value {
    let r = e
        .mutate(
            op,
            None,
            Context::new(
                "alice",
                args.into_iter().map(|(k, v)| (k.into(), v)).collect(),
            )
            .at(101),
        )
        .unwrap();
    match r.state {
        WriteState::Sent { result, .. } => result,
        _ => panic!("{r:?}"),
    }
}
fn child_for(e: &Engine, asset: &str) -> String {
    let home = e.store().asset(asset).unwrap().unwrap().home.unwrap();
    assert_eq!(home.0, "documents");
    home.1
}
fn ids(e: &mut Engine, parent: &str) -> Vec<String> {
    let list = field(e, "orders", parent, "names");
    let Value::Array(values) = list else {
        panic!("{list:?}")
    };
    values
        .iter()
        .map(|v| crate::assets::asset_id(Some(v)).unwrap().to_owned())
        .collect()
}
#[test]
fn dx8_each_moves_each_element_and_keeps_edited_and_native_children_through_cycles() {
    let (compiled, _) = compile(NEW_EACH);
    assert!(compiled.required_capabilities().contains("release-child-extraction-each-v1"));
    let mut e = engine(OLD_EACH);
    let a = handle(&mut e, b"a");
    let b = handle(&mut e, b"b");
    let aid = crate::assets::asset_id(Some(&a)).unwrap().to_owned();
    let bid = crate::assets::asset_id(Some(&b)).unwrap().to_owned();
    let parent = mutate(&mut e, "add", [("names", Value::Array(vec![a, b]))])
        .field("id")
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned();
    adopt(&mut e, NEW_EACH, 2).unwrap();
    assert_eq!(e.store().count("documents").unwrap(), 2);
    let first = child_for(&e, &aid);
    assert_ne!(first, child_for(&e, &bid));
    let changed = handle(&mut e, b"changed");
    let changed_id = crate::assets::asset_id(Some(&changed)).unwrap().to_owned();
    mutate(
        &mut e,
        "edit",
        [("id", Value::Id(first.clone())), ("names", changed)],
    );
    let native = handle(&mut e, b"native");
    let native_id = crate::assets::asset_id(Some(&native)).unwrap().to_owned();
    let native_child = mutate(
        &mut e,
        "attach",
        [("order", Value::Id(parent.clone())), ("names", native)],
    )
    .field("id")
    .unwrap()
    .as_str()
    .unwrap()
    .to_owned();
    for _ in 0..3 {
        adopt(&mut e, OLD_EACH, 1).unwrap();
        assert_eq!(
            ids(&mut e, &parent),
            vec![changed_id.clone(), bid.clone(), native_id.clone()]
        );
        for asset in [&changed_id, &bid, &native_id] {
            assert_eq!(
                e.store()
                    .asset(asset)
                    .unwrap()
                    .unwrap()
                    .home
                    .as_ref()
                    .unwrap()
                    .0,
                "orders"
            );
        }
        adopt(&mut e, NEW_EACH, 2).unwrap();
        assert_eq!(e.store().count("documents").unwrap(), 3);
        assert_eq!(child_for(&e, &changed_id), first);
        assert_eq!(child_for(&e, &native_id), native_child);
    }
    assert_eq!(
        e.store().test_support_meta("version").unwrap().as_deref(),
        Some(super::super::table_renames::VERSION)
    );
}
#[test]
fn dx8_each_preserves_child_identity_when_the_old_client_reorders_or_appends() {
    let mut e = engine(OLD_EACH);
    let a = handle(&mut e, b"a");
    let b = handle(&mut e, b"b");
    let aid = crate::assets::asset_id(Some(&a)).unwrap().to_owned();
    let bid = crate::assets::asset_id(Some(&b)).unwrap().to_owned();
    let parent = mutate(&mut e, "add", [("names", Value::Array(vec![a, b]))])
        .field("id")
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned();
    adopt(&mut e, NEW_EACH, 2).unwrap();
    let ca = child_for(&e, &aid);
    let cb = child_for(&e, &bid);
    adopt(&mut e, OLD_EACH, 1).unwrap();
    let Value::Array(mut values) = field(&mut e, "orders", &parent, "names") else {
        panic!()
    };
    values.reverse();
    let c = handle(&mut e, b"c");
    values.push(c);
    mutate(
        &mut e,
        "edit",
        [
            ("id", Value::Id(parent.clone())),
            ("names", Value::Array(values)),
        ],
    );
    adopt(&mut e, NEW_EACH, 2).unwrap();
    assert_eq!(e.store().count("documents").unwrap(), 3);
    assert_eq!(child_for(&e, &aid), ca);
    assert_eq!(child_for(&e, &bid), cb);
    adopt(&mut e, OLD_EACH, 1).unwrap();
    let got = ids(&mut e, &parent);
    assert_eq!(&got[..2], [bid, aid]);
    assert_eq!(got.len(), 3);
}
#[test]
fn dx8_each_handles_empty_lists_and_does_not_recreate_pruned_children() {
    let mut e = engine(OLD_EACH);
    let empty = mutate(&mut e, "add", [("names", Value::Array(vec![]))])
        .field("id")
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned();
    let a = handle(&mut e, b"a");
    mutate(&mut e, "add", [("names", Value::Array(vec![a]))]);
    adopt(&mut e, NEW_EACH, 2).unwrap();
    assert_eq!(e.store().count("documents").unwrap(), 1);
    adopt(&mut e, OLD_EACH, 1).unwrap();
    assert!(ids(&mut e, &empty).is_empty());
    e.store_mut().prune_dormant(true, None).unwrap();
    let generation = e.generation();
    let error = adopt(&mut e, NEW_EACH, 2).unwrap_err().to_string();
    assert!(error.contains("pruned/deleted"), "{error}");
    assert_eq!(e.generation(), generation);
}
#[test]
fn dx8_each_rejects_broad_child_audiences_and_invalid_element_types_atomically() {
    let private = OLD_EACH
        .replace(
            "  public 'fixture'",
            "  owner: principal\n  read <- .owner = viewer",
        )
        .replace("{names}", "{names,owner:viewer}");
    let next = NEW_EACH.replacen(
        "  public 'fixture'",
        "  owner: principal\n  read <- .owner = viewer",
        1,
    );
    let mut e = engine(&private);
    let a = handle(&mut e, b"a");
    let _ = mutate(&mut e, "add", [("names", Value::Array(vec![a]))]);
    let generation = e.generation();
    assert!(
        adopt(&mut e, &next, 2)
            .unwrap_err()
            .to_string()
            .contains("read through")
    );
    assert_eq!(e.generation(), generation);
    let b = snapback4_lang::compile(&[(
        "bad.q".into(),
        NEW_EACH.replace("  names: file <=1000", "  names: [file <=1000] <=8"),
    )]);
    assert!(
        b.diagnostics
            .iter()
            .any(|d| d.message.contains("scalar image/file/video")),
        "{:?}",
        b.diagnostics
    );
}
#[test]
fn dx8_each_preserves_optional_null_and_narrows_removed_old_list_elements() {
    let optional = OLD_EACH.replace("names: [file <=1000] <=8", "names: [file <=1000] <=8 ?");
    let mut e = engine(&optional);
    let parent = mutate(&mut e, "add", [("names", Value::Null)])
        .field("id")
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned();
    adopt(&mut e, NEW_EACH, 2).unwrap();
    adopt(&mut e, &optional, 1).unwrap();
    assert_eq!(field(&mut e, "orders", &parent, "names"), Value::Null);
    let mut e = engine(OLD_EACH);
    let a = handle(&mut e, b"a");
    let b = handle(&mut e, b"b");
    let parent = mutate(&mut e, "add", [("names", Value::Array(vec![a, b]))])
        .field("id")
        .unwrap()
        .as_str()
        .unwrap()
        .to_owned();
    adopt(&mut e, NEW_EACH, 2).unwrap();
    adopt(&mut e, OLD_EACH, 1).unwrap();
    let Value::Array(mut values) = field(&mut e, "orders", &parent, "names") else {
        panic!()
    };
    values.pop();
    mutate(
        &mut e,
        "edit",
        [("id", Value::Id(parent)), ("names", Value::Array(values))],
    );
    adopt(&mut e, NEW_EACH, 2).unwrap();
    assert_eq!(
        e.store().count("documents").unwrap(),
        1,
        "removed element cannot regain an active asset home"
    );
    for _ in 0..3 {
        adopt(&mut e, OLD_EACH, 1).unwrap();
        adopt(&mut e, NEW_EACH, 2).unwrap();
        assert_eq!(e.store().count("documents").unwrap(), 1);
    }
}
#[test]
fn dx8_each_rejects_duplicate_homes_missing_bytes_and_competing_source_declarations() {
    let mut e = engine(OLD_EACH);
    let a = handle(&mut e, b"a");
    let aid = crate::assets::asset_id(Some(&a)).unwrap().to_owned();
    mutate(&mut e, "add", [("names", Value::Array(vec![a.clone(), a]))]);
    let generation = e.generation();
    let error = adopt(&mut e, NEW_EACH, 2).unwrap_err().to_string();
    assert!(error.contains("repeated asset"), "{error}");
    assert_eq!(e.generation(), generation);
    assert_eq!(
        e.store().asset(&aid).unwrap().unwrap().home.unwrap().0,
        "orders"
    );
    let mut e = engine(OLD_EACH);
    let a = handle(&mut e, b"a");
    let aid = crate::assets::asset_id(Some(&a)).unwrap().to_owned();
    mutate(&mut e, "add", [("names", Value::Array(vec![a]))]);
    std::fs::remove_file(e.store().asset_location().unwrap().path(&aid)).unwrap();
    let generation = e.generation();
    assert!(
        adopt(&mut e, NEW_EACH, 2)
            .unwrap_err()
            .to_string()
            .contains("bytes are unavailable")
    );
    assert_eq!(e.generation(), generation);
    assert_eq!(
        e.store().asset(&aid).unwrap().unwrap().home.unwrap().0,
        "orders"
    );
    let source =
        format!("{NEW_EACH}extract documents from orders via order each: {{names:otherNames}}\n");
    let b = snapback4_lang::compile(&[("bad.q".into(), source)]);
    assert!(
        b.diagnostics
            .iter()
            .any(|d| d.message.contains("one extraction declaration")),
        "{:?}",
        b.diagnostics
    );
}
#[test]
fn dx8_each_refuses_to_rebind_a_native_child_to_a_reused_parent_lifetime() {
    let mut e = engine(NEW_EACH);
    let a = handle(&mut e, b"a");
    let aid = crate::assets::asset_id(Some(&a)).unwrap().to_owned();
    mutate(
        &mut e,
        "attach",
        [("order", Value::Id("missing-parent".into())), ("names", a)],
    );
    seed(&mut e, "orders", json!({"id":"missing-parent"}));
    let generation = e.generation();
    let error = adopt(&mut e, OLD_EACH, 1).unwrap_err().to_string();
    assert!(error.contains("parent-lifetime evidence"), "{error}");
    assert_eq!(e.generation(), generation);
    assert_eq!(
        e.store().asset(&aid).unwrap().unwrap().home.unwrap().0,
        "documents"
    );
}
#[test]
fn dx8_each_requires_immutable_captured_parent_audience_before_activation() {
    let next = NEW_EACH
        .replacen(
            "  public 'fixture'",
            "  owner: principal\n  read <- .owner = viewer\n  update <- allow",
            1,
        )
        .replacen(
            "  public 'fixture'",
            "  immutable order\n  read through .order",
            1,
        );
    let bound = snapback4_lang::compile(&[("unsafe.q".into(), next)]);
    assert!(
        bound
            .diagnostics
            .iter()
            .any(|d| d.code == "E_READ_THROUGH" && d.message.contains("must be immutable")),
        "{:?}",
        bound.diagnostics
    );
}

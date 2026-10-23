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
    let removed = values.pop().unwrap();
    let removed_id = crate::assets::asset_id(Some(&removed)).unwrap().to_owned();
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
        let released = e.store().asset(&removed_id).unwrap().unwrap();
        assert!(released.home.is_none(), "removed asset must have no active home after repeated migration cycles");
        assert!(released.released_at.is_some(), "removed asset remains eligible for ordinary garbage collection");
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

#[test]
fn dx8_each_removal_then_pruning_refuses_missing_receipt_child_atomically() {
    let mut e=engine(OLD_EACH);
    let a=handle(&mut e,b"pruned element");
    let parent=mutate(&mut e,"add",[("names",Value::Array(vec![a]))]).field("id").unwrap().as_str().unwrap().to_owned();
    adopt(&mut e,NEW_EACH,2).unwrap();
    adopt(&mut e,OLD_EACH,1).unwrap();
    mutate(&mut e,"edit",[("id",Value::Id(parent.clone())),("names",Value::Array(vec![]))]);
    e.store_mut().prune_dormant(true,None).unwrap();
    let generation=e.generation();
    let error=adopt(&mut e,NEW_EACH,2).unwrap_err().to_string();
    assert!(error.contains("pruned/deleted"),"{error}");
    assert_eq!(e.generation(),generation);
    assert!(ids(&mut e,&parent).is_empty());
}
#[test]
fn dx8_each_reverse_refuses_populated_narrowed_children_until_loosened_bridge() {
    let wide=NEW_EACH.replace("  names: file <=1000","  names: file <=1000\n  note: text <=100 ?")
        .replace("insert documents {order,names}","insert documents {order,names,note:'a native note'}");
    let narrow=wide.replace("note: text <=100 ?","note: text <=1 ?").replace("note:'a native note'","note:'x'");
    let mut e=engine(OLD_EACH);
    let a=handle(&mut e,b"historical");
    let parent=mutate(&mut e,"add",[("names",Value::Array(vec![a]))]).field("id").unwrap().as_str().unwrap().to_owned();
    adopt(&mut e,&wide,2).unwrap();
    let b=handle(&mut e,b"native narrowed");
    let bid=crate::assets::asset_id(Some(&b)).unwrap().to_owned();
    mutate(&mut e,"attach",[("order",Value::Id(parent.clone())),("names",b)]);
    adopt(&mut e,&narrow,3).unwrap();
    assert_eq!(e.store().count("documents").unwrap(),1);
    let generation=e.generation();
    let error=adopt(&mut e,OLD_EACH,1).unwrap_err().to_string();
    assert!(error.contains("retained narrowed child asset homes")&&error.contains("loosened child bridge"),"{error}");
    assert_eq!(e.generation(),generation);
    assert_eq!(e.store().asset(&bid).unwrap().unwrap().home.unwrap().0,"documents");
    adopt(&mut e,&wide,2).unwrap();
    adopt(&mut e,OLD_EACH,1).unwrap();
    let current=ids(&mut e,&parent);
    assert_eq!(current.len(),2);
    assert!(current.contains(&bid));
}

#[test]
fn dx8_each_reverse_refuses_pruned_migration_owned_null_child_atomically() {
    let mut e=engine(OLD_EACH);
    let a=handle(&mut e,b"removed then pruned");
    let parent=mutate(&mut e,"add",[("names",Value::Array(vec![a]))]).field("id").unwrap().as_str().unwrap().to_owned();
    adopt(&mut e,NEW_EACH,2).unwrap();adopt(&mut e,OLD_EACH,1).unwrap();
    mutate(&mut e,"edit",[("id",Value::Id(parent.clone())),("names",Value::Array(vec![]))]);
    adopt(&mut e,NEW_EACH,2).unwrap();
    e.store_mut().prune_dormant(true,None).unwrap();
    let generation=e.generation();
    let error=adopt(&mut e,OLD_EACH,1).unwrap_err().to_string();
    assert!(error.contains("pruned/deleted"),"{error}");assert_eq!(e.generation(),generation);
    assert_eq!(e.store().count("documents").unwrap(),0);
}
#[test]
fn dx8_each_restores_suspended_children_without_replaying_consumed_lists() {
    let suspended=NEW_EACH.split("\ntable documents:").next().unwrap().to_owned()+"\nmutation add():\n  return insert orders {}\n";
    let mut e=engine(OLD_EACH);
    let a=handle(&mut e,b"original");
    let parent=mutate(&mut e,"add",[("names",Value::Array(vec![a]))]).field("id").unwrap().as_str().unwrap().to_owned();
    adopt(&mut e,NEW_EACH,2).unwrap();
    let image=handle(&mut e,b"edited current");let aid=crate::assets::asset_id(Some(&image)).unwrap().to_owned();
    let child=e.store().test_support_conn().query_row("SELECT id FROM r WHERE t=(SELECT num FROM _catalog WHERE name='documents')",[],|r|r.get::<_,String>(0)).unwrap();
    mutate(&mut e,"edit",[("id",Value::Id(child.clone())),("names",image)]);
    let native=handle(&mut e,b"native current");let bid=crate::assets::asset_id(Some(&native)).unwrap().to_owned();
    let native=mutate(&mut e,"attach",[("order",Value::Id(parent.clone())),("names",native)]).field("id").unwrap().as_str().unwrap().to_owned();
    for cycle in 0..3 {
        adopt(&mut e,&suspended,3).unwrap();
        if cycle==0 {mutate(&mut e,"add",[]);}
        adopt(&mut e,NEW_EACH,2).unwrap();
        assert_eq!(e.store().count("documents").unwrap(),2);
        assert_eq!(child_for(&e,&aid),child);assert_eq!(child_for(&e,&bid),native);
        assert!(e.store().adoption_report().backfills.iter().any(|x|x.contains("without replaying consumed")));
    }
    adopt(&mut e,OLD_EACH,1).unwrap();assert_eq!(ids(&mut e,&parent),vec![aid,bid]);
    adopt(&mut e,NEW_EACH,2).unwrap();assert_eq!(e.store().count("documents").unwrap(),2);
}
#[test]
fn dx8_each_resume_refuses_retrospective_native_capture_and_unknown_sources() {
    let mut e=engine(OLD_EACH);let a=handle(&mut e,b"known");
    let parent=mutate(&mut e,"add",[("names",Value::Array(vec![a]))]).field("id").unwrap().as_str().unwrap().to_owned();
    adopt(&mut e,NEW_EACH,2).unwrap();
    let without=NEW_EACH.lines().filter(|s|!s.starts_with("extract ")).collect::<Vec<_>>().join("\n")+"\n";
    adopt(&mut e,&without,3).unwrap();
    let b=handle(&mut e,b"independent");mutate(&mut e,"attach",[("order",Value::Id(parent)),("names",b)]);
    let generation=e.generation();let error=adopt(&mut e,NEW_EACH,2).unwrap_err().to_string();
    assert!(error.contains("retrospectively capture"),"{error}");assert_eq!(e.generation(),generation);
    let only_parent=NEW_EACH.split("\ntable documents:").next().unwrap().to_owned()+"\nmutation add():\n  return insert orders {}\n";
    let mut e=engine(&only_parent);mutate(&mut e,"add",[]);
    let generation=e.generation();let error=adopt(&mut e,NEW_EACH,2).unwrap_err().to_string();
    assert!(error.contains("no successfully applied extraction"),"{error}");assert_eq!(e.generation(),generation);
    // An initially empty new-shape backend can own the declaration, then
    // suspend and resume native rows under the same captured lifetime law.
    let mut e=engine(NEW_EACH);
    adopt(&mut e,&only_parent,3).unwrap();adopt(&mut e,NEW_EACH,2).unwrap();
}

#[test]
fn dx8_each_empty_known_definition_refuses_independent_child_on_resume_atomically() {
    let without_each = NEW_EACH
        .lines()
        .filter(|line| !line.starts_with("extract "))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    let mut e = engine(&without_each);
    assert_eq!(e.store().count("orders").unwrap(), 0);
    assert_eq!(e.store().count("documents").unwrap(), 0);
    adopt(&mut e, NEW_EACH, 2).unwrap();
    assert_eq!(
        e.store()
            .test_support_conn()
            .query_row(
                "SELECT COUNT(*) FROM _extraction_each_definitions",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        1,
        "an initially empty extraction still records durable definition custody"
    );

    adopt(&mut e, &without_each, 3).unwrap();
    adopt(&mut e, NEW_EACH, 2).unwrap();
    assert_eq!(e.store().count("orders").unwrap(), 0);
    assert_eq!(e.store().count("documents").unwrap(), 0);
    adopt(&mut e, &without_each, 3).unwrap();
    assert!(e.schema().tables.contains_key("orders"));
    assert!(e.schema().tables.contains_key("documents"));
    let asset = handle(&mut e, b"born outside extraction custody");
    let asset_id = crate::assets::asset_id(Some(&asset)).unwrap().to_owned();
    let child = mutate(
        &mut e,
        "attach",
        [
            ("order", Value::Id("missing-parent".into())),
            ("names", asset),
        ],
    )
    .field("id")
    .unwrap()
    .as_str()
    .unwrap()
    .to_owned();

    let generation = e.generation();
    let format = e.store().test_support_meta("version").unwrap();
    let child_before = row(&mut e, "documents", &child);
    let asset_before = e.store().asset(&asset_id).unwrap().unwrap();
    let error = adopt(&mut e, NEW_EACH, 2).unwrap_err().to_string();
    assert!(
        error.contains("retrospectively capture")
            || error.contains("captured parent-lifetime evidence"),
        "{error}"
    );
    assert_eq!(e.generation(), generation);
    assert_eq!(e.store().test_support_meta("version").unwrap(), format);
    assert_eq!(e.store().count("orders").unwrap(), 0);
    assert_eq!(e.store().count("documents").unwrap(), 1);
    assert_eq!(row(&mut e, "documents", &child), child_before);
    assert_eq!(e.store().asset(&asset_id).unwrap().unwrap(), asset_before);
}

#[test]
fn dx8_each_unknown_consumed_source_refuses_child_only_history_atomically() {
    let without_each = NEW_EACH
        .lines()
        .filter(|line| !line.starts_with("extract "))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    let mut e = engine(&without_each);
    let asset = handle(&mut e, b"unknown-definition child");
    let asset_id = crate::assets::asset_id(Some(&asset)).unwrap().to_owned();
    let child = mutate(
        &mut e,
        "attach",
        [
            ("order", Value::Id("missing-parent".into())),
            ("names", asset),
        ],
    )
    .field("id")
    .unwrap()
    .as_str()
    .unwrap()
    .to_owned();
    let generation = e.generation();
    let format = e.store().test_support_meta("version").unwrap();
    let child_before = row(&mut e, "documents", &child);
    let asset_before = e.store().asset(&asset_id).unwrap().unwrap();

    let error = adopt(&mut e, NEW_EACH, 2).unwrap_err().to_string();
    assert!(
        error.contains("no successfully applied extraction")
            && error.contains("independent child history"),
        "{error}"
    );
    assert_eq!(e.generation(), generation);
    assert_eq!(e.store().test_support_meta("version").unwrap(), format);
    assert_eq!(e.store().count("orders").unwrap(), 0);
    assert_eq!(e.store().count("documents").unwrap(), 1);
    assert_eq!(row(&mut e, "documents", &child), child_before);
    assert_eq!(e.store().asset(&asset_id).unwrap().unwrap(), asset_before);
}

#[test]
fn dx8_each_unknown_consumed_source_refuses_retained_child_history_atomically() {
    let without_each = NEW_EACH
        .lines()
        .filter(|line| !line.starts_with("extract "))
        .collect::<Vec<_>>()
        .join("\n")
        + "\n";
    let parent_only = NEW_EACH
        .split("\ntable documents:")
        .next()
        .unwrap()
        .to_owned()
        + "\nmutation add():\n  return insert orders {}\n";
    let mut e = engine(&without_each);
    let asset = handle(&mut e, b"unknown retained child");
    let asset_id = crate::assets::asset_id(Some(&asset)).unwrap().to_owned();
    let child = mutate(
        &mut e,
        "attach",
        [
            ("order", Value::Id("missing-parent".into())),
            ("names", asset),
        ],
    )
    .field("id")
    .unwrap()
    .as_str()
    .unwrap()
    .to_owned();
    adopt(&mut e, &parent_only, 2).unwrap();
    assert!(!e.schema().tables.contains_key("documents"));
    let dormant_before = e
        .store()
        .test_support_conn()
        .query_row(
            "SELECT data FROM _dormant_rows WHERE t=(SELECT num FROM _catalog WHERE name='documents') AND id=?1",
            [&child],
            |row| row.get::<_, String>(0),
        )
        .unwrap();
    let generation = e.generation();
    let format = e.store().test_support_meta("version").unwrap();
    let asset_before = e.store().asset(&asset_id).unwrap().unwrap();

    let error = adopt(&mut e, NEW_EACH, 3).unwrap_err().to_string();
    assert!(
        error.contains("no successfully applied extraction")
            && error.contains("independent child history"),
        "{error}"
    );
    assert_eq!(e.generation(), generation);
    assert_eq!(e.store().test_support_meta("version").unwrap(), format);
    assert!(!e.schema().tables.contains_key("documents"));
    assert_eq!(
        e.store()
            .test_support_conn()
            .query_row(
                "SELECT data FROM _dormant_rows WHERE t=(SELECT num FROM _catalog WHERE name='documents') AND id=?1",
                [&child],
                |row| row.get::<_, String>(0),
            )
            .unwrap(),
        dormant_before
    );
    assert_eq!(e.store().asset(&asset_id).unwrap().unwrap(), asset_before);
}

#[test]
fn dx8_each_unchanged_parent_update_cannot_manufacture_extraction_provenance() {
    let mut e = engine(NEW_EACH);
    seed(&mut e, "orders", json!({"id":"p"}));
    let original = handle(&mut e, b"original child asset");
    let original_id = crate::assets::asset_id(Some(&original)).unwrap().to_owned();
    let child = mutate(
        &mut e,
        "attach",
        [
            ("order", Value::Id("p".into())),
            ("names", original),
        ],
    )
    .field("id")
    .unwrap()
    .as_str()
    .unwrap()
    .to_owned();

    let captured = e
        .store()
        .test_support_conn()
        .query_row(
            "SELECT COUNT(*), MIN(invalid) FROM _dormant_refs WHERE t=(SELECT num FROM _catalog WHERE name='documents') AND id=?1 AND column_name LIKE '$extract:%'",
            [&child],
            |row| Ok((row.get::<_, i64>(0)?, row.get::<_, Option<i64>>(1)?)),
        )
        .unwrap();
    assert_eq!(captured, (1, Some(0)), "an active-born child captures its valid parent lifetime");

    let removed = e
        .store()
        .test_support_conn()
        .execute(
            "DELETE FROM _dormant_refs WHERE t=(SELECT num FROM _catalog WHERE name='documents') AND id=?1 AND column_name LIKE '$extract:%'",
            [&child],
        )
        .unwrap();
    assert_eq!(removed, 1, "fixture must remove exactly the private extraction anchor");

    let replacement = handle(&mut e, b"replacement child asset");
    let replacement_id = crate::assets::asset_id(Some(&replacement))
        .unwrap()
        .to_owned();
    mutate(
        &mut e,
        "edit",
        [
            ("id", Value::Id(child.clone())),
            ("names", replacement),
        ],
    );
    let anchor_count = e
        .store()
        .test_support_conn()
        .query_row(
            "SELECT COUNT(*) FROM _dormant_refs WHERE t=(SELECT num FROM _catalog WHERE name='documents') AND id=?1 AND column_name LIKE '$extract:%'",
            [&child],
            |row| row.get::<_, i64>(0),
        )
        .unwrap();
    assert_eq!(
        anchor_count, 0,
        "changing another field with an unchanged parent reference cannot mint extraction custody"
    );

    let generation = e.generation();
    let format = e.store().test_support_meta("version").unwrap();
    let parent_before = row(&mut e, "orders", "p");
    let child_before = row(&mut e, "documents", &child);
    let original_before = e.store().asset(&original_id).unwrap().unwrap();
    let replacement_before = e.store().asset(&replacement_id).unwrap().unwrap();
    let error = adopt(&mut e, OLD_EACH, 1).unwrap_err().to_string();
    assert!(error.contains("parent-lifetime evidence"), "{error}");
    assert_eq!(e.generation(), generation);
    assert_eq!(e.store().test_support_meta("version").unwrap(), format);
    assert_eq!(e.store().count("orders").unwrap(), 1);
    assert_eq!(e.store().count("documents").unwrap(), 1);
    assert_eq!(row(&mut e, "orders", "p"), parent_before);
    assert_eq!(row(&mut e, "documents", &child), child_before);
    assert_eq!(e.store().asset(&original_id).unwrap().unwrap(), original_before);
    assert_eq!(
        e.store().asset(&replacement_id).unwrap().unwrap(),
        replacement_before
    );
}

#[test]
fn dx8_each_changed_parent_capture_keeps_missing_target_lifetime_invalid() {
    let movable = format!(
        "{NEW_EACH}mutation reparent(id: documents, order: orders):\n  return update documents[id] {{order}}\n"
    );
    let mut e = engine(&movable);
    seed(&mut e, "orders", json!({"id":"first"}));
    let asset = handle(&mut e, b"changed-reference child");
    let asset_id = crate::assets::asset_id(Some(&asset)).unwrap().to_owned();
    let child = mutate(
        &mut e,
        "attach",
        [
            ("order", Value::Id("first".into())),
            ("names", asset),
        ],
    )
    .field("id")
    .unwrap()
    .as_str()
    .unwrap()
    .to_owned();
    mutate(
        &mut e,
        "reparent",
        [
            ("id", Value::Id(child.clone())),
            ("order", Value::Id("later".into())),
        ],
    );
    let binding = e
        .store()
        .test_support_conn()
        .query_row(
            "SELECT parent_id, invalid FROM _dormant_refs WHERE t=(SELECT num FROM _catalog WHERE name='documents') AND id=?1 AND column_name LIKE '$extract:%'",
            [&child],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
        )
        .unwrap();
    assert_eq!(binding, ("later".into(), 2));

    seed(&mut e, "orders", json!({"id":"later"}));
    assert_eq!(
        e.store()
            .test_support_conn()
            .query_row(
                "SELECT invalid FROM _dormant_refs WHERE t=(SELECT num FROM _catalog WHERE name='documents') AND id=?1 AND column_name LIKE '$extract:%' AND parent_id='later'",
                [&child],
                |row| row.get::<_, i64>(0),
            )
            .unwrap(),
        2,
        "creating the formerly missing target must not heal captured lifetime evidence"
    );
    let generation = e.generation();
    let format = e.store().test_support_meta("version").unwrap();
    let first_before = row(&mut e, "orders", "first");
    let later_before = row(&mut e, "orders", "later");
    let child_before = row(&mut e, "documents", &child);
    let asset_before = e.store().asset(&asset_id).unwrap().unwrap();
    let error = adopt(&mut e, OLD_EACH, 1).unwrap_err().to_string();
    assert!(error.contains("parent-lifetime evidence"), "{error}");
    assert_eq!(e.generation(), generation);
    assert_eq!(e.store().test_support_meta("version").unwrap(), format);
    assert_eq!(e.store().count("orders").unwrap(), 2);
    assert_eq!(e.store().count("documents").unwrap(), 1);
    assert_eq!(row(&mut e, "orders", "first"), first_before);
    assert_eq!(row(&mut e, "orders", "later"), later_before);
    assert_eq!(row(&mut e, "documents", &child), child_before);
    assert_eq!(e.store().asset(&asset_id).unwrap().unwrap(), asset_before);
}
#[test]
fn dx8_each_reverse_shares_parent_page_and_accumulated_child_heap_atomically() {
    let old = "table orders:\n  names: [file <=1000] <=64\n  padding: text <=4096\n  public 'fixture'\n  insert <- allow\n  online only\n";
    let new = "table orders:\n  padding: text <=4096\n  public 'fixture'\n  insert <- allow\n  online only\ntable documents:\n  order: orders on delete cascade\n  names: file <=1000\n  payload: text <=65536 ?\n  public 'fixture'\n  insert <- allow\n  online only\nextract documents from orders via order each: {names:names}\nmutation attach(order: orders, names: file <=1000, payload: text <=65536):\n  return insert documents {order,names,payload}\n";
    let mut e = engine(old);
    let padding = "p".repeat(4096);
    for n in 0..256 {
        seed(
            &mut e,
            "orders",
            json!({"id":format!("p{n:03}"),"names":[],"padding":padding}),
        );
    }
    adopt(&mut e, new, 2).unwrap();
    let payload = "x".repeat(65536);
    let mut children = Vec::new();
    let mut assets = Vec::new();
    for n in 0..60 {
        let asset = handle(&mut e, format!("asset {n}").as_bytes());
        assets.push(crate::assets::asset_id(Some(&asset)).unwrap().to_owned());
        children.push(
            mutate(
                &mut e,
                "attach",
                [
                    ("order", Value::Id("p000".into())),
                    ("names", asset),
                    ("payload", Value::String(payload.clone())),
                ],
            )
            .field("id")
            .unwrap()
            .as_str()
            .unwrap()
            .to_owned(),
        );
    }
    let generation = e.generation();
    let error = adopt(&mut e, old, 1).unwrap_err();
    assert!(
        matches!(
            error,
            RuntimeError::Bound {
                kind: crate::error::MeterKind::HeapBytes,
                ..
            }
        ),
        "{error:?}"
    );
    assert_eq!(
        e.generation(),
        generation,
        "a heap cut cannot select the old release"
    );
    assert_eq!(e.store().count("orders").unwrap(), 256);
    assert_eq!(e.store().count("documents").unwrap(), 60);
    assert!(row(&mut e, "orders", "p000").field("names").is_err());
    for (child, asset) in children.iter().zip(&assets) {
        let image = row(&mut e, "documents", child);
        assert_eq!(
            image.field("payload").unwrap().as_str().unwrap().len(),
            65536
        );
        assert!(image.field("names").is_ok());
        assert_eq!(
            e.store().asset(asset).unwrap().unwrap().home.unwrap().0,
            "documents"
        );
    }
}

#[test]
fn dx8_each_forward_shares_parent_page_and_retained_child_decode_atomically() {
    let old = "table orders:\n  names: [file <=1000] <=64\n  padding: text <=65536\n  public 'fixture'\n  insert <- allow\n  update <- allow\n  online only\nmutation inflate(id: orders, padding: text <=65536):\n  return update orders[id] {padding}\n";
    let new = "table orders:\n  padding: text <=65536\n  public 'fixture'\n  insert <- allow\n  online only\ntable documents:\n  order: orders on delete cascade\n  names: file <=1000\n  payload: text <=200000 ?\n  public 'fixture'\n  insert <- allow\n  update <- allow\n  online only\nextract documents from orders via order each: {names:names}\nmutation enlarge(id: documents, payload: text <=200000):\n  return update documents[id] {payload}\n";
    let mut e = engine(old);
    let asset = handle(&mut e, b"retained forward child");
    let asset_id = crate::assets::asset_id(Some(&asset)).unwrap().to_owned();
    for n in 0..256 {
        seed(
            &mut e,
            "orders",
            json!({
                "id":format!("p{n:03}"),
                "names":if n == 0 { json!([{"id":asset_id}]) } else { json!([]) },
                "padding":"",
            }),
        );
    }
    adopt(&mut e, new, 2).unwrap();
    let child = child_for(&e, &asset_id);
    mutate(
        &mut e,
        "enlarge",
        [
            ("id", Value::Id(child.clone())),
            ("payload", Value::String("x".repeat(200000))),
        ],
    );
    adopt(&mut e, old, 1).unwrap();
    let padding = "p".repeat(65536);
    for n in 0..256 {
        mutate(
            &mut e,
            "inflate",
            [
                ("id", Value::Id(format!("p{n:03}"))),
                ("padding", Value::String(padding.clone())),
            ],
        );
    }
    let generation = e.generation();
    let error = adopt(&mut e, new, 2).unwrap_err();
    assert!(
        matches!(error, RuntimeError::Bound { kind: crate::error::MeterKind::HeapBytes, .. }),
        "{error:?}"
    );
    assert_eq!(e.generation(), generation, "a heap cut cannot select the new release");
    assert_eq!(ids(&mut e, "p000"), vec![asset_id.clone()]);
    for n in 0..256 {
        assert_eq!(
            field(&mut e, "orders", &format!("p{n:03}"), "padding")
                .as_str()
                .unwrap()
                .len(),
            65536
        );
    }
    assert_eq!(
        e.store().asset(&asset_id).unwrap().unwrap().home.unwrap().0,
        "orders"
    );
    let retained: String = e
        .store()
        .test_support_conn()
        .query_row(
            "SELECT data FROM r WHERE t=(SELECT num FROM _catalog WHERE name='documents') AND id=?1 UNION ALL SELECT data FROM _dormant_rows WHERE t=(SELECT num FROM _catalog WHERE name='documents') AND id=?1 UNION ALL SELECT data FROM _dormant_narrow_rows WHERE t=(SELECT num FROM _catalog WHERE name='documents') AND id=?1 LIMIT 1",
            [&child],
            |row| row.get(0),
        )
        .unwrap();
    let retained: Value = serde_json::from_str(&retained).unwrap();
    assert_eq!(
        retained.field("payload").unwrap().as_str().unwrap().len(),
        200000
    );
}

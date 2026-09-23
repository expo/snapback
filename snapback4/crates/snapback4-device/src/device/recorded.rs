//! Capture needs current partition authority, even while retained history is readable.
use super::*;

pub(super) fn covered<T: DeviceTx>(rows: &Predicting<'_, T>, name: &str, row: &Value, viewer: &str, now: i64) -> Result<bool, RuntimeError> {
    use snapback4_core::schema::{Audience, audience_binding, row_image};
    let Some(table) = rows.schema.table(name) else { return Ok(false) };
    let Some(sync) = &table.sync else { return Ok(false) };
    let row = row_image(row, table);
    let Some(id) = row.field("id").ok().and_then(|id| id.as_str().ok()) else { return Ok(false) };
    // Held describes acquisition, not the lifetime of its audience witness.
    let live = match &sync.audience {
        Audience::Public => true,
        Audience::Column(column) => row.field(column).ok() == Some(&Value::Id(viewer.into())),
        Audience::Target { table: target, prefix, .. } => {
            let Ok(binding) = audience_binding(rows.schema, name, table, sync) else { return Ok(false) };
            let Some(target_table) = rows.schema.table(target) else { return Ok(false) };
            let Some(index) = target_table.index(&binding.group_index) else { return Ok(false) };
            let mut key = prefix.iter().map(|column| row.field(column).cloned()).collect::<Result<Vec<_>, _>>()?;
            key.push(Value::Id(viewer.into()));
            rows.tx.lookup(target, &binding.group_index, &index, &key)?.is_some_and(|member| !target_table.expired(&row_image(&member, target_table), now))
        }
    };
    if !live { return Ok(false); }
    if table.leave != LeavePolicy::DeliveredHistory { return Ok(true); }
    let group = history::row_key(table, &row)?;
    Ok(match rows.groups.get(name).and_then(|groups| groups.get(&group)) {
        Some(history::Membership::Held) => true,
        Some(history::Membership::Rejoined(ids)) => ids.contains(id),
        _ => false,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    fn transitions<S: DeviceStore>(mut store: S) {
        let b = snapback4_lang::compile(&[("fixture.q".into(), include_str!("../../../snapback4-lang/tests/fixtures/recorded-attribution.q").into())]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        let mut schema = b.schema;
        schema.tables.get_mut("posts").unwrap().leave = LeavePolicy::DeliveredHistory;
        store.install(&schema, &BTreeMap::new(), true).unwrap();
        let tx = store.transaction().unwrap();
        let put = |id: &str| StreamEvent { table:"posts".into(), kind:"put".into(), id:id.into(), data:Some(serde_json::json!({"id":id,"authorId":"alice","parentId":null,"at":100,"until":null})) };
        let joined = BTreeMap::from([("posts".into(),vec![vec![]])]);
        history::events(&tx,&schema,&[put("p")],&BTreeMap::new(),false).unwrap();
        assert_eq!(tx.meta(history::GROUPS).unwrap().unwrap(), r#"{"posts":{}}"#);
        {
            let groups = history::load(&tx,history::GROUPS).unwrap();
            assert!(!history::is_left(&groups,"posts","[]"), "a new delivery is not departed history");
            let row = wire::row_from_json(schema.table("posts").unwrap(),put("p").data.as_ref().unwrap()).unwrap();
            let rows = Predicting { tx:&tx, schema:&schema, groups, boundaries:boundary::Boundaries::load(&tx,false).unwrap(), written:std::cell::RefCell::new(Vec::new()) };
            assert!(!covered(&rows,"posts",&row,"alice",100).unwrap(), "one delivery cannot grant full capture coverage");
        }
        tx.set_meta(history::GROUPS,r#"{"posts":{"[]":"Left"}}"#).unwrap();
        history::events(&tx,&schema,&[put("p")],&BTreeMap::new(),false).unwrap();
        assert!(history::is_left(&history::load(&tx,history::GROUPS).unwrap(),"posts","[]"));
        history::events(&tx,&schema,&[put("p")],&joined,false).unwrap();
        let check = |ids: &[&str]| {
            let groups = history::load(&tx,history::GROUPS).unwrap();
            assert!(matches!(&groups["posts"]["[]"], history::Membership::Rejoined(known) if known == &ids.iter().map(|s|s.to_string()).collect()));
        };
        check(&["p"]);
        let source = include_str!("../../../snapback4-lang/tests/fixtures/recorded-attribution.q").split("maintain receivedLikes:").next().unwrap();
        let without = snapback4_lang::compile(&[("without-recording.q".into(),source.into())]);
        assert!(without.diagnostics.is_empty(),"{:?}",without.diagnostics);
        schema = without.schema;
        schema.tables.get_mut("posts").unwrap().leave = LeavePolicy::DeliveredHistory;
        history::events(&tx,&schema,&[put("q")],&joined,false).unwrap();
        check(&["p","q"]);
        tx.set_meta(history::GROUPS,"{}").unwrap();
        history::events(&tx,&schema,&[put("q")],&joined,false).unwrap();
        check(&["q"]);
        // A join can arrive before an expiry/revocation scope event. Even a
        // previously Held group must not certify its old retained images.
        tx.set_meta(history::GROUPS,r#"{"posts":{"[]":"Held"}}"#).unwrap();
        history::events(&tx,&schema,&[put("q")],&joined,false).unwrap();
        check(&["q"]);
        // Only the replacement snapshot's held declaration grants full coverage.
        snapshot::retain(&tx,&schema,Some(&joined)).unwrap();
        assert!(matches!(history::load(&tx,history::STAGED_GROUPS).unwrap()["posts"]["[]"],history::Membership::Held));
        tx.rollback().unwrap();
    }
    #[test]
    fn membership_transitions_do_not_depend_on_recording_targets_on_both_stores() {
        transitions(crate::memory::MemoryStore::new());
        #[cfg(feature = "native")]
        {
            let dir = std::env::temp_dir().join(format!("f2-membership-{}",std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            transitions(crate::sqlite::open(&dir.join("device.sqlite")).unwrap());
            std::fs::remove_dir_all(dir).unwrap();
        }
    }
}

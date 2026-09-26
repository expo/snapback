//! Capture needs current partition authority, even while retained history is readable.
use super::*;
use snapback4_core::{error::MeterKind, rows::word_heap};

pub(super) fn covered<T: DeviceTx>(rows: &Predicting<'_, T>, name: &str, row: &Value, viewer: &str, now: i64, scope: &snapback4_core::engine::Authorization, meter: &mut snapback4_core::engine::InternalMeter<'_>) -> Result<bool, RuntimeError> {
    use snapback4_core::schema::{Audience, audience_binding};
    let Some(table) = rows.schema.table(name) else { return Ok(false) };
    let Some(sync) = &table.sync else { return Ok(false) };
    table.project_fields(row.clone(),Some(viewer)).charge_materialization_internal(meter,scope)?;
    let row = table.project_fields(row.clone(),Some(viewer)).into_value();
    if row.field("id").ok().and_then(|id| id.as_str().ok()).is_none() { return Ok(false); }
    if table.expired(&row, now) { return Ok(false); }
    // Held describes acquisition, not the lifetime of its audience witness.
    let live = match &sync.audience {
        Audience::Public => true,
        Audience::Column(column) => row.field(column).ok() == Some(&Value::Id(viewer.into())),
        Audience::Target { table: target, prefix, .. } => {
            let Ok(binding) = audience_binding(rows.schema, name, table, sync) else { return Ok(false) };
            let Some(target_table) = rows.schema.table(target) else { return Ok(false) };
            let Some(index) = target_table.index(&binding.group_index) else { return Ok(false) };
            meter.heap(word_heap::slots::<Value>(prefix.len() + 1) + word_heap::text(viewer))?;
            let mut key = Vec::with_capacity(prefix.len() + 1);
            for column in prefix {
                let value = row.field(column)?;
                value.scalar_heap(scope).charge(meter,scope)?;
                key.push(value.clone());
            }
            key.push(Value::Id(viewer.into()));
            // Pass unswept siblings under the device authority allowance. The
            // store prepays row/key allocation, and no page can examine more
            // candidates than the remaining allowance.
            let mut bounds = Bounds::default();
            loop {
                let limit = (1..=32).rev().find(|&n| meter.examined_room(n)).unwrap_or(0);
                if limit == 0 { meter.charge(MeterKind::Examined, 1)?; break false; }
                let members = rows.tx.scan_metered(target, &binding.group_index, &key, &bounds, Dir::Asc, limit, scope, meter)?;
                let count = members.len();
                if !meter.charge(MeterKind::Examined, count.max(1) as u64)? { break false; }
                let mut live = false;
                let stored = members.last().map(|(_,key)|key.clone());
                for (member, _) in members {
                    target_table.project_fields(member.clone(),Some(viewer)).charge_materialization_internal(meter,scope)?;
                    if !target_table.expired(&member, now) { live = true; break; }
                }
                if live { break true; }
                if count < limit { break false; }
                let stored = stored.as_ref().expect("full page");
                meter.heap(word_heap::key_decode(index.components.len() + 1, stored.len()))?;
                bounds.after = Some(snapback4_core::key::decode(stored).ok_or_else(|| RuntimeError::Store("invalid membership index key".into()))?.into_iter().skip(key.len()).collect());
            }
        }
    };
    if !live { return Ok(false); }
    Ok(history::coverage_state(rows.schema, &rows.groups, name, history::Coverage::Row(&row))? == history::CoverageState::Held)
}

#[cfg(test)]
mod tests {
    use snapback4_core::meter::Meter;
    use super::*;
    use snapback4_core::meter::{Ceilings, Cut};
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
            assert!(!covered_test(&rows,"posts",&row,"alice",100,&mut Meter::new(Ceilings::unbounded(),Cut::Abort)).unwrap(), "one delivery cannot grant full capture coverage");
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
        history::events(&tx,&schema,&[put("q")],&BTreeMap::new(),false).unwrap();
        check(&["p","q"]);
        history::events(&tx,&schema,&[],&joined,false).unwrap();
        check(&[]);
        tx.set_meta(history::GROUPS,"{}").unwrap();
        history::events(&tx,&schema,&[put("q")],&joined,false).unwrap();
        check(&["q"]);
        // A join can arrive before an expiry/revocation scope event. Even a
        // previously Held group must not certify its old retained images.
        tx.set_meta(history::GROUPS,r#"{"posts":{"[]":"Held"}}"#).unwrap();
        history::events(&tx,&schema,&[put("q")],&joined,false).unwrap();
        check(&["q"]);
        history::events(&tx,&schema,&[],&joined,false).unwrap();
        check(&[]);
        tx.set_meta(history::GROUPS,r#"{"posts":{"[]":"Held"}}"#).unwrap();
        history::events(&tx,&schema,&[],&joined,false).unwrap();
        check(&[]);
        history::events(&tx,&schema,&[put("q")],&joined,false).unwrap();
        let groups=history::load(&tx,history::GROUPS).unwrap();
        let row=|id|wire::row_from_json(schema.table("posts").unwrap(),put(id).data.as_ref().unwrap()).unwrap();
        assert!(history::retained(&schema,&groups,"posts",history::Coverage::Row(&row("p"))).unwrap());
        assert!(!history::retained(&schema,&groups,"posts",history::Coverage::Row(&row("q"))).unwrap());
        assert!(!history::retained(&schema,&groups,"posts",history::Coverage::Range("byId",&[])).unwrap());
        let rows=Predicting {tx:&tx,schema:&schema,groups,boundaries:boundary::Boundaries::load(&tx,false).unwrap(),written:std::cell::RefCell::new(Vec::new())};
        assert!(!covered_test(&rows,"posts",&row("p"),"alice",100,&mut Meter::new(Ceilings::unbounded(),Cut::Abort)).unwrap());
        assert!(covered_test(&rows,"posts",&row("q"),"alice",100,&mut Meter::new(Ceilings::unbounded(),Cut::Abort)).unwrap());
        // Only the replacement snapshot's held declaration grants full coverage.
        snapshot::retain(&tx,&schema,Some(&joined)).unwrap();
        assert!(matches!(history::load(&tx,history::STAGED_GROUPS).unwrap()["posts"]["[]"],history::Membership::Held));
        history::events(&tx,&schema,&[put("q")],&BTreeMap::new(),true).unwrap();
        assert!(matches!(history::load(&tx,history::STAGED_GROUPS).unwrap()["posts"]["[]"],history::Membership::Held),"snapshot puts preserve the held declaration");
        history::events(&tx,&schema,&[],&joined,true).unwrap();
        assert!(matches!(&history::load(&tx,history::STAGED_GROUPS).unwrap()["posts"]["[]"],history::Membership::Rejoined(ids) if ids.is_empty()),"a real catch-up acquisition resets staged coverage too");
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

    fn covered_test<T: DeviceTx>(rows: &Predicting<'_,T>, name: &str, row: &Value, viewer: &str, now: i64, meter: &mut Meter) -> Result<bool,RuntimeError> {
        let mut ledger = snapback4_core::meter::InternalLedger::new(meter.clone());
        let result = ledger.run(|meter,scope| covered(rows,name,row,viewer,now,scope,meter));
        result
    }

    fn membership_meter<S: DeviceStore>(mut store: S) {
        let b = snapback4_lang::compile(&[("meter.q".into(), r#"table members:
  owner: principal
  principal: principal
  until: time ?
  unique byOwnerPrincipal: owner, principal
  by byPrincipal: principal, owner
  by byExpiry: until, id
  expire at .until
  read <- allow
  sync public
table posts:
  owner: principal
  by byOwner: owner, id
  read <- exists members[.owner, viewer]
  sync to members[.owner] by .principal
"#.into())]);
        assert!(b.diagnostics.is_empty(), "{:?}", b.diagnostics);
        store.install(&b.schema, &BTreeMap::new(), true).unwrap();
        let tx = store.transaction().unwrap();
        for n in 0..9001 {
            let row = snapback4_core::value::object([
                ("id", Value::Id(format!("m{n:05}"))), ("owner", Value::Id("alice".into())),
                ("principal", Value::Id("alice".into())), ("until", Value::Int(if n == 9000 {500} else {200})),
            ]);
            tx.put("members", &b.schema.tables["members"], &row, None).unwrap();
        }
        let rows = Predicting { tx: &tx, schema: &b.schema,
            groups: serde_json::from_str(r#"{"posts":{"[\"alice\"]":"Held"}}"#).unwrap(),
            boundaries: boundary::Boundaries::load(&tx, false).unwrap(), written: RefCell::new(Vec::new()) };
        let post = snapback4_core::value::object([("id", Value::Id("p".into())), ("owner", Value::Id("alice".into()))]);
        let mut meter = Meter::new(Ceilings { examined: 8192, ..Ceilings::unbounded() }, Cut::Abort);
        assert!(matches!(covered_test(&rows, "posts", &post, "alice", 300, &mut meter),
            Err(RuntimeError::Bound { kind: MeterKind::Examined, actual: 8193, ceiling: 8192, .. })));
        let mut heap = Meter::new(Ceilings { heap_bytes: 1024, ..Ceilings::unbounded() }, Cut::Abort);
        assert!(matches!(covered_test(&rows, "posts", &post, "alice", 300, &mut heap),
            Err(RuntimeError::Bound { kind: MeterKind::HeapBytes, .. })));
        let mut enough = Meter::new(Ceilings { examined: 9001, ..Ceilings::unbounded() }, Cut::Abort);
        assert!(covered_test(&rows, "posts", &post, "alice", 300, &mut enough).unwrap());
        tx.rollback().unwrap();
    }
    #[test]
    fn membership_scans_charge_examinations_and_heap_on_both_stores() {
        membership_meter(crate::memory::MemoryStore::new());
        #[cfg(feature = "native")]
        {
            let dir = std::env::temp_dir().join(format!("f2-meter-{}", std::process::id()));
            std::fs::create_dir_all(&dir).unwrap();
            membership_meter(crate::sqlite::open(&dir.join("device.sqlite")).unwrap());
            std::fs::remove_dir_all(dir).unwrap();
        }
    }

}

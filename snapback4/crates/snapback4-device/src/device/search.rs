//! Internal SDK composition metadata and state fence; no query/session storage.
use super::*;

impl<S: DeviceStore> Device<S> {
    // @ref LLP 3000.028#3.3 — a continuation binds the device incarnation and membership observation.
    pub(crate) fn search_state(&mut self, name: &str, spent: Option<snapback4_core::meter::Metered>) -> Result<serde_json::Value, RuntimeError> {
        let Some(plan) = self.schema.operations.get(name).and_then(|fact| fact.search.as_ref()) else { return Ok(serde_json::Value::Null) };
        let tx = self.store.read_transaction()?;
        store_identity::require_owner(&tx, &self.backend_identity, &self.store_identity, self.native_digest.as_deref())?;
        let mut meter = snapback4_core::meter::Meter::resume_observation(Ceilings::default(), spent.unwrap_or_default())?;
        meter.heap(8192)?;
        meter.step(32)?;
        let mut capture = store_identity::adoption_capture(&tx)?;
        let raw = tx.meta(history::GROUPS)?.unwrap_or_else(|| "{}".into());
        let bytes = raw.len() as u64;
        // The store supplies bytes; prepay typed retained-state decoding,
        // traversal and both digests before allocation, on the same ledger.
        meter.heap(128 + bytes * 32)?;
        meter.step(bytes * 3 + 1)?;
        let groups: history::Groups = decoded(&raw)?;
        // Delivery observes every acquisition change, including edits and
        // unrelated syncs. Pagination binds only incarnation/generation,
        // acquisition validity and this table's current/retained membership.
        capture.insert(history::GROUPS.into(), Some(raw));
        let delivery = snapback4_core::value::digest(&capture);
        let mut identity = BTreeMap::new();
        for key in [STORE_ID, BACKEND_IDENTITY, GENERATION, ACQUIRED, BACKEND_REQUIRED, store_identity::RESTORE_REFUSED] {
            identity.insert(key.to_owned(), capture.get(key).cloned().flatten());
        }
        drop(capture);
        for (key, state) in groups.get(&plan.table).into_iter().flatten() {
            identity.insert(key.clone(), Some(if *state == history::Membership::Left { "left" } else { "current" }.into()));
        }
        let epoch = snapback4_core::value::digest(&identity);
        let left: Vec<_> = groups.get(&plan.table).into_iter().flat_map(|groups| groups.iter())
            .filter(|(_, state)| **state == history::Membership::Left).map(|(key, _)| key.clone()).collect();
        let kind = snapback4_core::MeterKind::OutputBytes;
        if !meter.charge(kind, 8192 + bytes * 6)? {
            return Err(RuntimeError::Bound { kind, actual: meter.used.output_bytes,
                ceiling: meter.ceilings.output_bytes, site: "ordinary search state".into() });
        }
        tx.rollback()?;
        // Reuse the canonical text codecs instead of instantiating a second
        // typed serializer into JSON Value for the two ledger records.
        Ok(serde_json::json!({ "epoch": epoch, "delivery": delivery, "left": left,
            "metered": decoded::<serde_json::Value>(&encoded(&meter.used)?)?,
            "ceilings": decoded::<serde_json::Value>(&encoded(&Ceilings::default())?)? }))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Device<crate::memory::MemoryStore> {
        let source = r#"
table members:
  room: id
  principal: principal
  unique room, principal
  read <- exists members[.room, viewer]
  sync to members[.room]
table messages:
  room: id
  text: text <=200
  at: time
  search text
  read <- exists members[.room, viewer]
  sync to members[.room] last 100 by .at
  retain delivered-history
query search(q: text <=100, c: cursor ?):
  return messages matching q last 20 by .at after c
"#;
        let bound = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
        assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
        assert!(bound.schema.operations["search"].search.is_some());
        let backend = Backend { generation: 1, schema: bound.schema, programs: bound.programs.into_iter().map(|p| p.program).collect() };
        Device::open_store(crate::memory::MemoryStore::new(), Some(backend)).unwrap()
    }

    fn meta(device: &mut Device<crate::memory::MemoryStore>, key: &str, value: &str) {
        let tx = device.store.transaction().unwrap();
        tx.set_meta(key, value).unwrap(); tx.commit().unwrap();
    }

    #[test]
    fn pagination_epoch_excludes_progress_but_delivery_fence_keeps_it() {
        let mut device = fixture();
        meta(&mut device, ACQUIRED, "1");
        let first = device.search_state("search", None).unwrap();
        assert!(first.get("plan").is_none(), "the SDK already owns this descriptor");
        for key in [WATERMARK, SEND_REVISION, deferred::CURSOR, deferred::IMAGES_AT] {
            meta(&mut device, key, "42");
            let after = device.search_state("search", None).unwrap();
            assert_eq!(first["epoch"], after["epoch"], "{key}");
            assert_ne!(first["delivery"], after["delivery"], "{key}");
        }
        device.clear_rows().unwrap();
        assert_ne!(first["epoch"], device.search_state("search", None).unwrap()["epoch"]);
    }

    #[test]
    fn pagination_epoch_tracks_only_this_tables_membership_and_retention() {
        let mut device = fixture();
        meta(&mut device, history::GROUPS, r#"{"messages":{"[\"room\"]":{"Rejoined":["a"]}}}"#);
        let first = device.search_state("search", None).unwrap();
        for groups in [
            r#"{"messages":{"[\"room\"]":{"Rejoined":["a","b"]}}}"#,
            r#"{"messages":{"[\"room\"]":"Held"},"other":{"[]":"Left"}}"#,
        ] {
            meta(&mut device, history::GROUPS, groups);
            let after = device.search_state("search", None).unwrap();
            assert_eq!(first["epoch"], after["epoch"]);
            assert_ne!(first["delivery"], after["delivery"]);
        }
        for groups in [
            r#"{"messages":{"[\"room\"]":"Left"}}"#,
            r#"{"messages":{"[\"room\"]":"Held","[\"new\"]":"Held"}}"#,
        ] {
            meta(&mut device, history::GROUPS, groups);
            assert_ne!(first["epoch"], device.search_state("search", None).unwrap()["epoch"]);
        }
    }

    #[test]
    fn retained_search_excludes_current_and_rejoined_images() {
        let mut device = fixture();
        let tx = device.store.read_transaction().unwrap();
        let groups = decoded(r#"{"messages":{"[\"left\"]":"Left","[\"held\"]":"Held","[\"rejoined\"]":{"Rejoined":[]}}}"#).unwrap();
        let reading = history::Reading { tx: &tx, schema: &device.schema, groups,
            boundaries: boundary::Boundaries::load(&tx, false).unwrap(), retained: std::cell::Cell::new(false) };
        for room in ["left", "held", "rejoined"] {
            let row = snapback4_core::wire::row_from_json(&device.schema.tables["messages"],
                &serde_json::json!({"id":"row", "room":room, "text":"coffee", "at":1000})).unwrap();
            assert_eq!(reading.search_retained_row("messages", &row).unwrap(), room == "left", "{room}");
        }
    }

    #[test]
    fn delivery_state_preserves_a_scans_exhausted_read_counter() {
        let mut device = fixture();
        let spent = snapback4_core::meter::Metered { examined: Ceilings::default().examined + 1,
            steps: 100, heap_bytes: 1024, ..Default::default() };
        let after = device.search_state("search", Some(spent)).unwrap();
        assert_eq!(after["metered"]["examined"], spent.examined);
        assert!(after["metered"]["steps"].as_u64().unwrap() > spent.steps);
        assert!(after["metered"]["heap_bytes"].as_u64().unwrap() > spent.heap_bytes);
    }
}

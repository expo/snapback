//! One release/activation contract, exercised by both physical adapters.
use super::*;
use crate::{
    activation::{ActivationPreparation, ActivationReader, ActivationTransaction, Backend},
    engine::release::ReleaseActivation,
    metadata::{MetadataReader, SchemaMarker},
    partition::PartitionRows,
};

pub(crate) fn opening_facts(tx: &(impl ActivationTransaction + PartitionRows + MetadataReader)) {
    assert_eq!(
        crate::activation::next_catalog_number(i64::MAX - 1).unwrap(),
        i64::MAX
    );
    assert_eq!(
        crate::activation::next_catalog_number(i64::MAX)
            .unwrap_err()
            .code(),
        "E_GENERATION"
    );
    assert_eq!(next_event_id(i64::MAX - 1).unwrap(), i64::MAX);
    assert_eq!(next_event_id(i64::MAX).unwrap_err().code(), "E_GENERATION");
    assert_eq!(
        crate::activation::next_generation(i64::MAX as u64, true)
            .unwrap_err()
            .code(),
        "E_GENERATION"
    );
    let backend = tx.opening_backend().unwrap();
    assert_eq!(backend.0, 1);
    assert_eq!(
        tx.previous_schema().unwrap().as_deref(),
        Some(backend.1.as_str())
    );
    tx.check_selected_release(Some(1)).unwrap();
    tx.check_selected_release(None).unwrap();
    assert_eq!(
        tx.check_selected_release(Some(2)).unwrap_err().code(),
        "E_GENERATION"
    );
    assert_eq!(tx.time_audience_clock().unwrap(), i64::MIN);
    assert_eq!(
        tx.opening_marker(SchemaMarker::SchemaHash)
            .unwrap()
            .as_deref(),
        Some(
            crate::value::digest(&serde_json::from_str::<crate::Schema>(&backend.1).unwrap())
                .as_str()
        )
    );
    tx.mark_live_sum_candidates().unwrap();
    tx.mark_maintained_ids().unwrap();
    assert_eq!(
        tx.opening_marker(SchemaMarker::LiveSumCandidates)
            .unwrap()
            .as_deref(),
        Some("1")
    );
    assert_eq!(
        tx.opening_marker(SchemaMarker::MaintainedIds)
            .unwrap()
            .as_deref(),
        Some(crate::schema::MAINTAINED_ID_VERSION)
    );
    assert_eq!(
        tx.opening_marker(SchemaMarker::TimePublications)
            .unwrap()
            .as_deref(),
        Some("1")
    );
    assert_eq!(tx.audience_epoch("absent").unwrap(), 0);
    assert_eq!(tx.audience_epoch_time("absent").unwrap(), None);
    tx.set_audience_epoch("items", u64::MAX, i64::MIN).unwrap();
    assert_eq!(tx.audience_epoch("items").unwrap(), u64::MAX);
    assert_eq!(tx.audience_epoch_time("items").unwrap(), Some(i64::MIN));
    tx.set_audience_epoch("items", 2, i64::MAX).unwrap();
    assert_eq!(tx.audience_epoch_time("items").unwrap(), Some(i64::MAX));
    assert!(!tx.table_populated("absent\0").unwrap());
    assert!(!tx.timeline_rebuild_exists("items", "absent\0").unwrap());
    assert!(
        !tx.any_table_image("absent\0", |_| panic!("absent table"))
            .unwrap()
    );
}

pub(crate) fn bookkeeping(
    tx: &(impl ActivationTransaction + PartitionRows),
    put: impl Fn(&str, &str),
    get: impl Fn(&str) -> Option<String>,
) {
    put("time_audience_clock", &i64::MAX.to_string());
    assert_eq!(tx.time_audience_clock().unwrap(), i64::MAX);
    put("time_audience_clock", "malformed");
    assert_eq!(tx.time_audience_clock().unwrap(), i64::MIN);
    put("audience_epoch:malformed", "invalid");
    put("audience_epoch_time:malformed", "invalid");
    assert_eq!(tx.audience_epoch("malformed").unwrap(), 0);
    assert_eq!(
        tx.audience_epoch_time("malformed").unwrap_err().code(),
        "E_STORE"
    );
    put("cap_counts_schema", "cap-hash");
    assert_eq!(
        tx.opening_marker(SchemaMarker::CapCounts)
            .unwrap()
            .as_deref(),
        Some("cap-hash")
    );
    put("activation_population", "true");
    put("activation_narrowed_retained", "2");
    put("activation_narrowed_restored", "1");
    put("activation_column_restored:items.body", "3");
    put("Activation_Column_Restored:items.extra", "4");
    assert_eq!(tx.activation_population().unwrap().as_deref(), Some("true"));
    assert_eq!(tx.narrowed_retained().unwrap().as_deref(), Some("2"));
    assert_eq!(tx.narrowed_restored().unwrap().as_deref(), Some("1"));
    assert_eq!(
        tx.restored_population(crate::metadata::RestoredPopulation::Column, "items.body")
            .unwrap()
            .as_deref(),
        Some("3")
    );
    tx.clear_activation_metadata().unwrap();
    assert_eq!(tx.activation_population().unwrap(), None);
    assert_eq!(tx.narrowed_retained().unwrap(), None);
    assert_eq!(tx.narrowed_restored().unwrap(), None);
    assert_eq!(
        tx.restored_population(crate::metadata::RestoredPopulation::Column, "items.body")
            .unwrap(),
        None
    );
    assert_eq!(get("Activation_Column_Restored:items.extra"), None);
    // The marker and clock have separate lifetimes from activation scratch.
    assert_eq!(
        tx.opening_marker(SchemaMarker::CapCounts)
            .unwrap()
            .as_deref(),
        Some("cap-hash")
    );
}

pub(crate) fn preparation(prep: &impl ActivationPreparation, backend: &Backend) {
    prep.check_selected_release(Some(1)).unwrap();
    prep.check_backend(backend).unwrap();
    let mut wrong = backend.clone();
    wrong.2.push(' '); // Same semantic JSON, different exact opening capture.
    assert_eq!(
        prep.check_backend(&wrong).unwrap_err().code(),
        "E_GENERATION"
    );
    assert!(prep.activation_inventory().unwrap().is_empty());
    let mut options = ReleaseActivation::new(2, Some(1));
    options.expected_revision = Some(1);
    options.check(prep).unwrap();
    options.expected_previous = Some(3);
    assert!(
        options
            .check(prep)
            .unwrap_err()
            .to_string()
            .contains("current release changed")
    );
    options.expected_previous = Some(1);
    options.expected_revision = Some(0);
    assert!(
        options
            .check(prep)
            .unwrap_err()
            .to_string()
            .contains("activation revision changed")
    );
}

fn item(key: &str) -> DormantItem {
    DormantItem {
        key: key.into(),
        path: "items.body".into(),
        kind: "column".into(),
        action: "dormant".into(),
        rows: 1,
        bytes: 8,
        asset_bytes: 0,
        definition_only: false,
        sample_ids: vec!["a\0b".into()],
        before_rows: None,
        after_rows: None,
        restored_rows: None,
        before_sample_ids: None,
    }
}

pub(crate) fn history(
    tx: &(impl ReleaseHistoryReader + ReleaseHistoryTransaction + ActivationReader),
) {
    tx.finalize_restorations().unwrap();
    assert_eq!(tx.narrowed_restored().unwrap().as_deref(), Some("0"));
    let before = tx.release_revision_value().unwrap();
    assert_eq!(
        record_event(
            tx,
            0,
            "bad\0operation",
            Some(1),
            None,
            serde_json::json!({}),
            &[]
        )
        .unwrap_err()
        .code(),
        "E_INPUT"
    );
    assert_eq!(tx.release_revision_value().unwrap(), before);
    for n in 0..19 {
        assert_eq!(
            record_event(
                tx,
                i64::MIN + n,
                "activate",
                Some(2),
                Some(1),
                serde_json::json!({"detail":"free\0text","n":n}),
                &[item("column:items.Z"), item("column:items.a")]
            )
            .unwrap(),
            n as u64 + 2
        );
    }
    assert!(tx.release_events(0, 0).unwrap().is_empty());
    assert_eq!(tx.release_events(0, usize::MAX).unwrap().len(), 20);
    let page = tx.release_events(0, 16).unwrap();
    assert_eq!(page.len(), 16);
    assert!(page.windows(2).all(|w| w[0].id < w[1].id));
    let last = page.last().unwrap().id;
    assert_eq!(tx.release_events(last, 16).unwrap().len(), 4);
    let last = tx.release_events(0, usize::MAX).unwrap().last().unwrap().id;
    let items = tx.release_event_items(last, None, 1).unwrap();
    assert_eq!(items[0].key, "column:items.Z");
    let rest = tx
        .release_event_items(last, Some(&items[0].key), usize::MAX)
        .unwrap();
    assert_eq!(rest[0].key, "column:items.a");
    assert_eq!(rest[0].sample_ids, ["a\0b"]);
    assert!(tx.release_event_items(last, None, 0).unwrap().is_empty());
    assert_eq!(
        tx.release_event_items(last, Some("column:items.Z\0"), 16)
            .unwrap()
            .len(),
        1
    );
    assert_eq!(tx.previous_active_release().unwrap(), Some(1));
    let page = tx.release_events(last, 1).unwrap();
    assert!(page.is_empty());
    let status = status(tx, 0, None, Some(last)).unwrap();
    assert_eq!(status["events"].as_array().unwrap().len(), 16);
    assert_eq!(status["revision"], 20);
    assert_eq!(status["items"].as_array().unwrap().len(), 2);
    assert_eq!(
        tx.release_events(u64::MAX, 1).unwrap_err().code(),
        "E_GENERATION"
    );
    assert_eq!(
        tx.release_event_items(u64::MAX, None, 1)
            .unwrap_err()
            .code(),
        "E_GENERATION"
    );
}

pub(crate) fn statement_error(tx: &impl ReleaseHistoryTransaction) {
    // The caller must drop/roll back the entire transaction after this error.
    assert!(
        record_event(
            tx,
            1,
            "activate",
            Some(2),
            Some(1),
            serde_json::json!({}),
            &[item("duplicate"), item("duplicate")]
        )
        .is_err()
    );
}

pub(crate) trait Lifecycle {
    fn generation(&self) -> u64;
    fn executed_version(&mut self) -> crate::Value;
    fn activate(
        &mut self,
        version: u64,
        release: u64,
        previous: u64,
        revision: u64,
    ) -> Result<u64, RuntimeError>;
    fn reopen(&mut self, expected_release: u64) -> Result<(), RuntimeError>;
    fn status(&mut self) -> serde_json::Value;
}

pub(crate) fn lifecycle(h: &mut impl Lifecycle) {
    assert_eq!(h.generation(), 1);
    assert_eq!(h.executed_version(), crate::Value::Int(1));
    let first = h.status();
    assert_eq!(first["release"], 1);
    assert_eq!(first["revision"], 1);
    h.reopen(1).unwrap();
    assert_eq!(h.status(), first);
    assert_eq!(h.reopen(2).unwrap_err().code(), "E_GENERATION");
    assert_eq!(h.status(), first);
    assert_eq!(h.activate(2, 2, 1, 1).unwrap(), 2);
    let second = h.status();
    assert_eq!(second["release"], 2);
    assert_eq!(second["revision"], 2);
    assert_eq!(second["previous_active"], 1);
    h.reopen(2).unwrap();
    assert_eq!(h.executed_version(), crate::Value::Int(2));
    assert_eq!(h.status(), second);
    assert_eq!(h.activate(2, 3, 2, 2).unwrap(), 2); // equal execution, fresh history
    assert_eq!(h.status()["revision"], 3);
    let before = h.status();
    assert_eq!(h.activate(1, 4, 1, 3).unwrap_err().code(), "E_GENERATION");
    assert_eq!(h.activate(1, 4, 3, 2).unwrap_err().code(), "E_GENERATION");
    assert_eq!(h.status(), before);
    assert_eq!(h.activate(1, 1, 3, 3).unwrap(), 3); // rollback is another generation
    h.reopen(1).unwrap();
    assert_eq!(h.generation(), 3);
    assert_eq!(h.executed_version(), crate::Value::Int(1));
}

pub(crate) fn compile(version: u64) -> (crate::Schema, Vec<crate::Program>) {
    let source = format!(
        "table items:\n  body: text <=20\n  public\nquery version():\n  return {version}\n"
    );
    let bound = snapback4_lang::compile(&[("schema.q".into(), source)]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    (
        serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap(),
        bound
            .programs
            .into_iter()
            .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap())
            .collect(),
    )
}

pub(crate) fn timeline_seed(tx: &impl crate::Rows, table: &crate::schema::Table) {
    for (id, status) in [("a", "queued"), ("b", "done"), ("c", "queued\0suffix")] {
        let row = crate::value::object([
            ("id", crate::Value::Id(id.into())),
            ("body", crate::Value::String("free\0text".into())),
            ("status", crate::Value::String(status.into())),
        ]);
        tx.put("items", table, &row, None).unwrap();
    }
}
pub(crate) fn timeline_counts(reader: &impl crate::activation::TimelineWorkReader) {
    assert_eq!(reader.timeline_work_count("items", "queued").unwrap(), 1);
    assert_eq!(
        reader
            .timeline_work_count("items", "queued\0suffix")
            .unwrap(),
        1
    );
    assert_eq!(reader.timeline_work_count("items", "absent\0").unwrap(), 0);
    assert_eq!(reader.timeline_work_count("absent\0", "queued").unwrap(), 0);
}

pub(crate) fn event_id_exhaustion(tx: &impl ReleaseHistoryTransaction) {
    let before = tx.release_revision_value().unwrap();
    assert_eq!(
        record_event(tx, 0, "activate", None, None, serde_json::json!({}), &[])
            .unwrap_err()
            .code(),
        "E_GENERATION"
    );
    assert_eq!(tx.release_revision_value().unwrap(), before);
}

pub(crate) fn malformed_generation(tx: &impl ActivationReader, put: impl Fn(&str, &str)) {
    for value in ["foo", "9223372036854775808", "1junk", "0", "-1"] {
        put("generation", value);
        assert_eq!(
            tx.opening_backend().unwrap_err().code(),
            "E_STORE_GENERATION"
        );
        assert_eq!(
            tx.previous_schema().unwrap_err().code(),
            "E_STORE_GENERATION"
        );
    }
    put("generation", "1");
    assert_eq!(
        tx.opening_backend().unwrap().0,
        1,
        "metadata errors must not poison the snapshot"
    );
}

pub(crate) fn worker_history(tx: &impl ReleaseHistoryReader, put: impl Fn(&str, &str)) {
    for (key, value) in [
        ("worker:status:z", "last"),
        ("worker:status", "legacy"),
        ("worker:status:a", "first"),
        ("Worker:Status:b", "mixed"),
        ("worker:statusish", "excluded"),
    ] {
        put(key, value);
    }
    let expected = vec![
        ("Worker:Status:b".into(), "mixed".into()),
        ("worker:status".into(), "legacy".into()),
        ("worker:status:a".into(), "first".into()),
        ("worker:status:z".into(), "last".into()),
    ];
    assert_eq!(tx.release_workers(0).unwrap(), vec![]);
    assert_eq!(tx.release_workers(2).unwrap(), expected[..2]);
    assert_eq!(tx.release_workers(usize::MAX).unwrap(), expected);
}

pub(crate) const REPAIR_SOURCE: &str = "table entries:
  n: int
  until: time ?
  expire at .until
  cap 2
  public
  insert <- allow
view totals: sum entries of .n by .n
mutation add(id: id, n: int):
  insert entries { id, n, until: null }
";

pub(crate) fn repair_backend() -> (crate::Schema, Vec<crate::Program>) {
    let bound = snapback4_lang::compile(&[("schema.q".into(), REPAIR_SOURCE.into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    (
        serde_json::from_value(serde_json::to_value(bound.schema).unwrap()).unwrap(),
        bound
            .programs
            .into_iter()
            .map(|p| serde_json::from_value(serde_json::to_value(p.program).unwrap()).unwrap())
            .collect(),
    )
}

pub(crate) trait OpeningRepairs {
    fn add(&mut self, id: &str) -> crate::engine::MutationOutcome;
    fn damage(&mut self, live_sum: bool);
    fn reopen_repaired(&mut self);
    fn population(&mut self, table: &str) -> usize;
    fn marker(&mut self, marker: SchemaMarker) -> Option<String>;
}

pub(crate) fn live_sum_reopening(h: &mut impl OpeningRepairs) {
    assert!(matches!(
        h.add("a").state,
        crate::engine::WriteState::Sent { .. }
    ));
    assert_eq!(
        h.population("totals"),
        1,
        "a live zero-sum candidate exists"
    );
    h.damage(true);
    assert_eq!(h.population("totals"), 0);
    h.reopen_repaired();
    assert_eq!(
        h.population("totals"),
        1,
        "opening recreates the live zero-sum candidate"
    );
    assert_eq!(
        h.marker(SchemaMarker::LiveSumCandidates).as_deref(),
        Some("1")
    );
}

pub(crate) fn cap_reopening(h: &mut impl OpeningRepairs) {
    assert!(matches!(
        h.add("a").state,
        crate::engine::WriteState::Sent { .. }
    ));
    let marker = h.marker(SchemaMarker::CapCounts).unwrap();
    h.damage(false);
    h.reopen_repaired();
    assert_eq!(h.marker(SchemaMarker::CapCounts), Some(marker));
    assert!(matches!(
        h.add("b").state,
        crate::engine::WriteState::Sent { .. }
    ));
    let excess = h.add("c");
    assert!(
        matches!(excess.state, crate::engine::WriteState::Failed { ref why, .. } if why.code == "E_CONSTRAINT"),
        "{excess:?}"
    );
    assert_eq!(h.population("entries"), 2);
}

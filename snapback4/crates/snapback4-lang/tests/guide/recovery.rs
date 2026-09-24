//! Runtime witnesses for refusal recovery advice; no real provider is contacted.
use serde_json::json;
use snapback4_core::{Context, Engine, Value, WriteState, assets::{Asset, AssetKind}, identity::{self, ServiceSample}};
use std::collections::BTreeMap;

fn engine(source: &str) -> Engine {
    let b = snapback4_lang::compile(&[("schema.q".into(), source.into())]);
    assert!(b.diagnostics.is_empty() && b.notes.is_empty(), "{:?} {:?}", b.diagnostics, b.notes);
    Engine::memory(b.schema, b.programs.into_iter().map(|p| p.program)).unwrap()
}
fn sample(now: i64) -> ServiceSample { ServiceSample { now, supervisor_revision: 0 } }
fn recorded_steps(e: &Engine, id: &str) -> Vec<(String, String, String)> {
    let mut q = e.store().conn().prepare("SELECT name, provider_key, state FROM _effect_steps WHERE effect_id = ?1 ORDER BY name").unwrap();
    q.query_map([id], |r| Ok((r.get(0)?, r.get(1)?, r.get(2)?))).unwrap().collect::<Result<_, _>>().unwrap()
}

#[test]
fn cancellation_definition_reconciles_recorded_step_keys() {
    // Pin the later definition itself: `why` selects an earlier paragraph.
    // cancelled_effect_keeps_distinct_stored_step_keys executes this recovery.
    let card = snapback4_lang::guide::card("effects").unwrap();
    let paragraph = card.split("\n\n").find(|p| p.starts_with("E_EFFECT_CANCELLED means")).unwrap();
    let paragraph = paragraph.split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(paragraph.contains("Inspect the recorded steps and reconcile each with its stored provider key before creating replacement intent."), "{paragraph}");
    assert!(paragraph.contains("Use `meta.id` only for legacy handlers without steps that used it as their provider key."), "{paragraph}");
    assert!(paragraph.contains("Cancellation stops further admitted work, but cannot undo a provider call already in flight."), "{paragraph}");
    assert!(!paragraph.contains("using the effect's idempotency key"), "{paragraph}");
}

#[test]
fn cancelled_effect_keeps_distinct_stored_step_keys() {
    let card = snapback4_lang::guide::card("effects").unwrap().split_whitespace().collect::<Vec<_>>().join(" ");
    assert!(card.contains("Legacy handlers without steps use `meta.id` as the provider idempotency key; generated `ctx.step` handlers use the key passed to each step callback."));
    let mut e = engine("effect mail cancellation allow\nmutation send():\n  emit mail { n: 1 }\n");
    let service = identity::service_session(e.store(), "worker", 0, 1).unwrap();
    e.mutate("send", Some("first"), Context::new("alice", Default::default()).at(0)).unwrap();
    let claim = e.claim_effects_strict(&service.token, None, 1, 1_000, true, None, || sample(10)).unwrap().remove(0);
    let id = &claim.id;
    let lease = claim.lease_token.as_deref().unwrap();
    let send = e.begin_effect_step_strict(&service.token, id, lease, "send", &json!({}), false, || sample(11)).unwrap();
    let audit = e.begin_effect_step_strict(&service.token, id, lease, "audit", &json!({}), false, || sample(12)).unwrap();
    assert_ne!(send.key, audit.key, "step names select distinct provider keys");
    assert_ne!(&send.key, id, "a generated step never uses the legacy effect ID as its provider key");
    // Model an external success whose acknowledgement was lost, outside the engine.
    let provider = BTreeMap::from([(send.key.clone(), "mail sent"), (audit.key.clone(), "audit recorded")]);
    assert!(!provider.contains_key(id), "looking up meta.id would miss both successes");

    e.mutate("send", Some("other"), Context::new("alice", Default::default()).at(20)).unwrap();
    let other = e.claim_effects_strict(&service.token, None, 1, 5_000, true, None, || sample(21)).unwrap().remove(0);
    let other_step = e.begin_effect_step_strict(&service.token, &other.id, other.lease_token.as_deref().unwrap(), "send", &json!({}), false, || sample(22)).unwrap();
    assert_ne!(send.key, other_step.key, "effect identity also selects the key");

    let retry = e.claim_effects_strict(&service.token, None, 1, 5_000, true, None, || sample(1_011)).unwrap().remove(0);
    assert_eq!(&retry.id, id);
    let recovered = e.begin_effect_step_strict(&service.token, id, retry.lease_token.as_deref().unwrap(), "send", &json!({}), true, || sample(1_012)).unwrap();
    assert_eq!(recovered.state, "reconcile");
    assert_eq!(recovered.key, send.key, "attempts retain the stored provider key");
    let before = recorded_steps(&e, id);
    let cancelled = e.cancel_effect(id, 1_013).unwrap();
    assert_eq!(cancelled.state, "failed");
    assert_eq!(cancelled.error_code.as_deref(), Some("E_EFFECT_CANCELLED"));
    assert_eq!(recorded_steps(&e, id), before, "cancellation retains reconciliation evidence");
    for (_, key, _) in recorded_steps(&e, id) { assert!(provider.contains_key(&key)); }
    assert!(e.claim_effects_strict(&service.token, None, 1, 5_000, true, None, || sample(1_014)).unwrap().is_empty());
}

#[test]
fn asset_placement_requires_upload_ownership() {
    let mut e = engine(r#"
table photos:
  photo: image <=1000 ?
  read <- allow
  insert <- allow
  update <- allow
mutation place(id: photos, photo: image <=1000):
  return upsert photos[id] { photo }
"#);
    let asset = Asset { id: "upload".into(), owner: "alice".into(), kind: AssetKind::Image, content_type: "image/png".into(), bytes: 24, width: Some(1), height: Some(1), duration: None, created_at: 0, home: None, released_at: None };
    e.store().record_asset(&asset).unwrap();
    assert!(e.asset_access("alice", &asset.id, 0).is_ok(), "unplaced uploads allow owner preview");
    assert_eq!(e.asset_access("bob", &asset.id, 0).unwrap_err().code(), "E_ASSET_UNKNOWN");
    let args = || -> BTreeMap<String, Value> { [("id".into(), Value::Id("home".into())), ("photo".into(), asset.column_value())].into() };
    let place = e.mutate("place", None, Context::new("alice", args()).at(1)).unwrap();
    assert!(matches!(place.state, WriteState::Sent { .. }), "{place:?}");
    assert!(e.asset_access("bob", &asset.id, 2).is_ok(), "the public home permits Bob's download");
    let row = snapback4_core::wire::row_from_json(&e.schema().tables["photos"], &json!({"id":"second", "photo":null})).unwrap();
    e.seed(vec![("photos".into(), row)]).unwrap();
    let mut foreign_args = args();
    foreign_args.insert("id".into(), Value::Id("second".into()));
    let denied = e.mutate("place", None, Context::new("bob", foreign_args).at(3)).unwrap();
    assert_eq!(denied.reply(None)["why"]["code"], "E_ASSET_UNKNOWN", "readability does not grant upload ownership");
    let own = Asset { id: "bobs-upload".into(), owner: "bob".into(), ..asset };
    e.store().record_asset(&own).unwrap();
    let args = [("id".into(), Value::Id("second".into())), ("photo".into(), own.column_value())].into();
    assert!(matches!(e.mutate("place", None, Context::new("bob", args).at(4)).unwrap().state, WriteState::Sent { .. }));
}

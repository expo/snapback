//! Actual file/ledger dedup, cancellation and collection custody.
use snapback4_core::{Engine, RuntimeError};
use snapback4_core::assets::UNCLAIMED_TTL_MS;
fn engine() -> Engine {
    let bound = snapback4_lang::compile(&[("schema.q".into(), "table docs:\n  owner: principal\n  doc: file <=100000 ('application/pdf') ?\n  read <- .owner = viewer\n  insert <- .owner = viewer\nmutation attach(doc: file <=100000 ('application/pdf')):\n  return insert docs { owner: viewer, doc }\n".into())]);
    assert!(bound.diagnostics.is_empty(), "{:?}", bound.diagnostics);
    Engine::memory(bound.schema, bound.programs.into_iter().map(|p| p.program)).unwrap()
}
#[test] fn duplicate_staged_uploads_commit_one_file_and_pin_until_cancellation() {
    let mut e = engine();
    let first = e.prepare_file("alice","application/pdf","a.pdf",9,1).unwrap().with_intent("u1","fingerprint").write(b"%PDF-1.7\n").unwrap();
    let second = e.prepare_file("alice","application/pdf","a.pdf",9,1).unwrap().with_intent("u1","fingerprint").write(b"%PDF-1.7\n").unwrap();
    let asset = e.finish_asset(first).unwrap();
    assert_eq!(e.finish_asset(second).unwrap().id,asset.id);
    assert_eq!(std::fs::read_dir(e.store().asset_path(&asset.id).parent().unwrap()).unwrap().count(),1);
    assert_eq!(e.asset_intent("alice","u1","fingerprint").unwrap().unwrap().id,asset.id);
    assert!(e.asset_intent("bob","u1","fingerprint").unwrap().is_none());
    assert!(matches!(e.asset_intent("alice","u1","other"),Err(RuntimeError::Asset{code:"E_ASSET_INTENT_REUSE",..})));
    assert_eq!(e.sweep_assets(UNCLAIMED_TTL_MS+100).unwrap(),0,"a ready but unplaced upload stays in custody across arbitrarily long offline time");
    e.cancel_asset_intent("alice","u1").unwrap();
    assert!(matches!(e.asset_intent("alice","u1","fingerprint"),Err(RuntimeError::Asset{code:"E_UPLOAD_CANCELLED",..})));
    assert_eq!(e.sweep_assets(UNCLAIMED_TTL_MS+100).unwrap(),1);
}
#[test] fn cancellation_wins_against_a_late_staged_upload() {
    let mut e = engine();
    let staged = e.prepare_file("alice","application/pdf","a.pdf",9,1).unwrap().with_intent("u2","fingerprint").write(b"%PDF-1.7\n").unwrap();
    e.cancel_asset_intent("alice","u2").unwrap();
    assert!(matches!(e.finish_asset(staged),Err(RuntimeError::Asset{code:"E_UPLOAD_CANCELLED",..})));
    assert!(matches!(e.asset_intent("alice","u2","changed"),Err(RuntimeError::Asset{code:"E_UPLOAD_CANCELLED",..})));
}
#[test] fn collected_receipts_never_create_a_second_asset() {
    let mut e = engine();
    let staged = e.prepare_file("alice","application/pdf","a.pdf",9,1).unwrap().with_intent("u3","fingerprint").write(b"%PDF-1.7\n").unwrap();
    let asset = e.finish_asset(staged).unwrap();
    e.store().forget_asset(&asset.id).unwrap();
    assert!(matches!(e.asset_intent("alice","u3","fingerprint"),Err(RuntimeError::Asset{code:"E_ASSET_INTENT_EXPIRED",..})));
}
#[test] fn terminal_pre_program_refusal_gets_bound_receipt_and_unpins() {
    let mut e = engine();
    let staged = e.prepare_file("alice","application/pdf","a.pdf",9,1).unwrap().with_intent("early","fingerprint").with_placement(serde_json::json!({"op":"missing-operation","args":{},"argument":"doc"})).write(b"%PDF-1.7\n").unwrap();
    let asset = e.finish_asset(staged).unwrap();
    let why = snapback4_core::error::Refusal::new("E_INPUT","input","another required argument was missing");
    let args=serde_json::json!({"doc":{"id":asset.id,"type":asset.content_type,"bytes":asset.bytes,"width":null,"height":null,"duration":null,"name":asset.name}});
    assert!(e.finish_asset_intent("alice","early","divergent-first",&args,&why).is_err());
    let outcome = e.finish_asset_intent("alice","early","missing-operation",&args,&why).unwrap();
    assert!(matches!(outcome.state,snapback4_core::WriteState::Failed{..}));
    assert!(e.finish_asset_intent("alice","early","missing-operation",&args,&why).unwrap().replayed);
    assert!(e.finish_asset_intent("alice","early","different-operation",&args,&why).is_err());
    assert_eq!(e.sweep_assets(UNCLAIMED_TTL_MS+100).unwrap(),1);
    assert!(matches!(e.asset_intent("alice","early","fingerprint"),Err(RuntimeError::Asset{code:"E_ASSET_INTENT_EXPIRED",..})));
}
#[test] fn ledger_reopen_and_owner_inventory_recover_lost_device_custody() {
    use snapback4_core::Store;
    let dir=std::env::temp_dir().join(format!("sb4-intent-ledger-{}",std::process::id()));
    std::fs::create_dir_all(&dir).unwrap(); let path=dir.join("store.sqlite");
    let prototype=engine();let schema=prototype.schema().clone();
    let id={
        let mut e=Engine::new(Store::open(&path).unwrap(),schema,[]).unwrap();
        let staged=e.prepare_file("alice","application/pdf","a.pdf",9,1).unwrap().with_intent("orphan","original").write(b"%PDF-1.7\n").unwrap();
        e.finish_asset(staged).unwrap().id
    };
    let mut reopened=Engine::open(Store::open(&path).unwrap()).unwrap();
    assert_eq!(reopened.asset_intent("alice","orphan","original").unwrap().unwrap().id,id);
    let list=reopened.pending_asset_intents("alice","").unwrap();
    assert_eq!(list["intents"][0]["id"],"orphan");
    assert_eq!(reopened.pending_asset_intents("bob","").unwrap()["intents"].as_array().unwrap().len(),0);
    reopened.cancel_asset_intent("alice","orphan").unwrap();
    assert!(reopened.pending_asset_intents("alice","").unwrap()["intents"].as_array().unwrap().is_empty());
    assert_eq!(reopened.sweep_assets(UNCLAIMED_TTL_MS+100).unwrap(),1);
    drop(reopened);std::fs::remove_dir_all(dir).unwrap();
}

#[test] fn adoption_to_ephemeral_refuses_media_before_effect_and_finalizes_durably() {
    use snapback4_core::Context;
    let mut e=engine();
    let staged=e.prepare_file("alice","application/pdf","a.pdf",9,1).unwrap().with_intent("converted","fp").with_placement(serde_json::json!({"op":"attach","args":{},"argument":"doc"})).write(b"%PDF-1.7\n").unwrap();
    let asset=e.finish_asset(staged).unwrap();
    let replacement="table live:\n  owner: principal\n  ephemeral 1m\n  read <- .owner = viewer\n  insert <- .owner = viewer\nmutation attach(doc: file <=100000 ('application/pdf')):\n  return insert live { owner: viewer }\n";
    let b=snapback4_lang::compile(&[("schema.q".into(),replacement.into())]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    e.adopt(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    let args=serde_json::json!({"doc":{"id":asset.id,"type":asset.content_type,"bytes":asset.bytes,"width":null,"height":null,"duration":null,"name":asset.name}});
    let why=e.mutate("attach",Some("converted"),Context::new("alice",Default::default()).with_wire_args(args.clone())).unwrap_err().refusal();assert_eq!(why.code,"E_UPLOAD_INTENT");
    assert_eq!(e.mutate("attach",Some("converted"),Context::new("alice",Default::default()).with_wire_args(args.clone())).unwrap_err().refusal().code,"E_UPLOAD_INTENT");
    e.finish_asset_intent("alice","converted","attach",&args,&why).unwrap();
    assert!(e.mutate("attach",Some("converted"),Context::new("alice",Default::default()).with_wire_args(args)).unwrap().replayed);
    assert_eq!(e.sweep_assets(UNCLAIMED_TTL_MS+100).unwrap(),1);
}

#[test] fn persisted_declaration_and_finalization_metadata_are_bounded(){
    let mut e=engine();
    let oversized=serde_json::json!({"op":"attach","args":{"body":"x".repeat(64<<10)},"argument":"doc"});
    assert_eq!(e.declare_asset_intent("alice","oversized","fp",&oversized).unwrap_err().refusal().code,"E_UPLOAD_ARGUMENT");assert!(e.asset_declaration("alice","oversized").unwrap().is_none());
    let envelope=serde_json::json!({"op":"x".repeat(96<<10),"args":{},"argument":"doc"});assert_eq!(e.declare_asset_intent("alice","envelope","fp",&envelope).unwrap_err().refusal().code,"E_UPLOAD_ARGUMENT");
    let staged=e.prepare_file("alice","application/pdf","a.pdf",9,1).unwrap().with_intent("bounded","fp").with_placement(serde_json::json!({"op":"attach","args":{},"argument":"doc"})).write(b"%PDF-1.7\n").unwrap();let asset=e.finish_asset(staged).unwrap();
    let args=serde_json::json!({"doc":{"id":asset.id,"type":asset.content_type,"bytes":asset.bytes,"width":null,"height":null,"duration":null,"name":asset.name}});
    let too_long=snapback4_core::error::Refusal::new("E_INPUT","input","x".repeat(4097));assert_eq!(e.finish_asset_intent("alice","bounded","attach",&args,&too_long).unwrap_err().refusal().code,"E_UPLOAD_ARGUMENT");
    assert!(e.replay_mutation("alice","bounded","attach",&args).unwrap().is_none());
    let why=snapback4_core::error::Refusal::new("E_INPUT","input","bounded");assert!(e.finish_asset_intent("alice","bounded","attach",&args,&why).is_ok());
}

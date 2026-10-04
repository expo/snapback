//! Newly predicting receipt sends expose the retained actual-payload exception.
// @ref LLP 3000.022#14.3 — rollback and custody also cover payload meter refusal.
use super::*;
fn payload_gap<H: Host>(host: &mut H) {
    for payloads in [490, 495] {
        let source = include_str!("../fixtures/rp-predecessor/schema.q").to_string() + &format!(r#"
table profiles:
  name: text <=2000
  public
  online only
mutation sendGap(conversation: conversations):
  insert messages {{ conversation, sender: viewer, text: 'gap', photo: null, at: now }}
  for n in range(0, {payloads}):
    emit notify {{ n, label: sha256(profiles['p'].name ?? '') }}
"#);
        let (mut e, mut b) = compile(&source);
        seed(&mut e);
        e.seed_at([("profiles".into(),object([("id",id("p")),("name",Value::String("x".repeat(2000)))]))],NOW).unwrap();
        b.schema = b.schema.public_projection();
        let pages = snapshot_pages(&mut e,"alice",1000);
        let name = format!("receipt-payload-{payloads}");
        let mut d = host.open(&name,Some(b)).unwrap();
        for (i,page) in pages.iter().enumerate() { d.apply(page,i==0).unwrap(); }
        let q = d.admit(request("sendGap",json!({"conversation":"c"}),1)).unwrap();
        assert!(q.predictable && q.predicted.len()==1,"{q:?}");
        assert_eq!(history_pending(&mut d).len(),1);
        let count = d.query("badge","alice",&json!({"member":"b"}),NOW).unwrap();
        assert_eq!(count.data,Value::Int(0));
        assert!(!count.complete);
        host.close(&name,d);
        let mut d = host.open(&name,None).unwrap();
        assert_eq!(d.queued().unwrap()[0].id,q.id,"custody survives restart before dispatch");
        let context = || ctx("alice",&[("conversation",id("c"))],NOW).with_ids(q.new_ids.clone());
        let out = e.mutate("sendGap",Some(&q.id),context()).unwrap();
        let success = matches!(out.state,WriteState::Sent{..});
        assert_eq!(success,payloads==490,"{out:?}");
        if payloads == 495 {
            assert!(matches!(&out.state,WriteState::Failed{why,..} if why.code=="E_BOUND"),"{out:?}");
            assert_eq!(out.metered.steps,1_000_680);
            assert!(e.store().rows("messages").unwrap().is_empty());
            assert!(e.effects(None,1000).unwrap().is_empty());
            assert_eq!(d.queued().unwrap()[0].id,q.id,"server execution alone cannot remove local custody");
            // A lost response is safe to replay with the same id; the terminal
            // server refusal is durable and no write/effect escaped rollback.
            let replay = e.mutate("sendGap",Some(&q.id),context()).unwrap();
            assert!(matches!(&replay.state,WriteState::Failed{why,..} if why.code=="E_BOUND" && why.site.as_deref()==Some("sendGap:4:3")),"{replay:?}");
            assert!(e.store().rows("messages").unwrap().is_empty());
            assert!(e.effects(None,1000).unwrap().is_empty());
            d.settle(&q.id,None).unwrap();
            assert!(d.queued().unwrap().is_empty(),"terminal refusal releases this intent only at settlement");
            assert!(history_pending(&mut d).is_empty());
            assert!(d.store().raw_rows("messages").is_empty());
            let count = d.query("badge","alice",&json!({"member":"b"}),NOW).unwrap();
            assert_eq!(count.data,Value::Int(0));
            assert!(count.complete);
            host.close(&name,d);
            let mut d = host.open(&name,None).unwrap();
            assert!(d.queued().unwrap().is_empty());
            assert!(history_pending(&mut d).is_empty(),"rollback persists across restart");
        } else {
            d.settle(&q.id,Some(seq(&out.state))).unwrap();
            publish(&mut e,&mut d,"alice");
            assert!(d.queued().unwrap().is_empty());
            assert!(history_pending(&mut d).is_empty());
            assert_eq!(d.query("badge","alice",&json!({"member":"b"}),NOW).unwrap().data,Value::Int(1));
        }
        eprintln!("RP receipt payload {payloads}: predicts=true server={success} {:?}",out.metered);
        if payloads == 495 {
            let record = json!({"source":source,"pages":pages,"args":{"conversation":"c"},"serverCommitted":false,"predicted":true,"state":out.state,"meter":out.metered});
            let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("tests/fixtures/rp-receipt-payload-gap.json");
            if std::env::var_os("UPDATE_RP_WASM_CASES").is_some() { std::fs::write(&path,serde_json::to_string(&record).unwrap()+"\n").unwrap(); }
            assert_eq!(record,serde_json::from_str::<serde_json::Value>(&std::fs::read_to_string(path).unwrap()).unwrap());
        }
    }
}
both!(documented_receipt_payload_gap_memory,documented_receipt_payload_gap_sqlite,payload_gap);

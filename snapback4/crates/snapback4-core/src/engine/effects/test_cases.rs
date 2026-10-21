use super::*;

pub(crate) trait Evidence: OutboxTransaction {
    fn settled_at(&self, id: &str) -> Option<i64>;
    fn seed_legacy(&self);
}

pub(crate) const LEGACY_ROW: &str = "INSERT INTO _outbox(id,seq,effect,payload,state,attempts,at) VALUES ('legacy',7,'mail','null','queued',0,0)";

fn emit(tx: &impl OutboxTransaction, id: &str, seq: u64) {
    let schema = Schema { effects: vec!["mail".into()], ..Schema::default() };
    record(tx, &[(id.into(),"mail".into(),Value::Null,BTreeMap::new())], seq, 0, false, &schema).unwrap();
}

pub(crate) fn candidate_ordering(tx: &impl OutboxTransaction) {
    for id in ["é", "z", "a", "A"] { emit(tx,id,1); }
    assert_eq!(tx.effect_candidates(None,0,2).unwrap(), ["A","a"]);
    assert_eq!(tx.effect_candidates(Some("mail"),0,u64::MAX).unwrap(), ["A","a","z","é"]);
    assert!(tx.effect_candidates(Some("missing"),0,100).unwrap().is_empty());
    assert!(tx.effect_candidates(None,0,0).unwrap().is_empty());
    // Legacy cancelled-but-queued rows remain visible to compatibility reads.
    tx.cancel_effect("a",0).unwrap();
    tx.retry_effect("a","legacy",0).unwrap();
    assert_eq!(tx.strict_effect_candidates(None,0,2).unwrap(), ["A","z"]);
    assert_eq!(tx.effect_candidates(None,0,2).unwrap(), ["A","a"]);
    assert!(tx.strict_effect_candidates(Some("other"),0,u64::MAX).unwrap().is_empty());
    assert!(tx.strict_effect_candidates(None,0,0).unwrap().is_empty());
    for id in ["é", "z", "A"] { tx.claim_effect(id,"worker",100,None).unwrap(); }
    assert!(tx.expired_effects(100,10).unwrap().is_empty());
    assert!(tx.expired_effects(101,0).unwrap().is_empty());
    assert_eq!(tx.expired_effects(101,2).unwrap().iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), ["A","z"]);
    assert_eq!(tx.expired_effects_strict(101).unwrap().iter().map(|r| r.id.as_str()).collect::<Vec<_>>(), ["A","z","é"]);
}

pub(crate) fn lifecycle_variants(tx: &impl Evidence) {
    emit(tx,"compat",1);
    tx.claim_effect("compat","worker",100,Some("digest")).unwrap();
    tx.send_effect("compat",Some(&Value::Null)).unwrap();
    tx.mark_effect_settled("compat",50).unwrap();
    let sent = tx.required_effect_run("compat").unwrap();
    assert_eq!(sent.result,Some(Value::Null));
    assert_eq!(sent.claimed_by.as_deref(),Some("worker"));
    assert_eq!(tx.effect_lease_digest("compat").unwrap().as_deref(),Some("digest"));
    assert_eq!(tx.settled_at("compat"),Some(50));
    // Strict claim is conditional; compatibility claim retains its old behavior.
    tx.claim_effect_strict("compat","other",200,None).unwrap();
    assert_eq!(tx.required_effect_run("compat").unwrap(),sent);
    tx.claim_effect("compat","other",200,None).unwrap();
    assert_eq!(tx.required_effect_run("compat").unwrap().attempts,2);
    tx.fail_effect("compat","failure").unwrap();
    tx.mark_effect_settled("compat",60).unwrap();
    assert_eq!(tx.required_effect_run("compat").unwrap().claimed_by.as_deref(),Some("other"));
    assert_eq!(tx.settled_at("compat"),Some(60));
    tx.retry_effect("compat","retry",70).unwrap();
    tx.mark_effect_settled("compat",61).unwrap();
    assert_eq!(tx.settled_at("compat"),None);

    emit(tx,"strict",2);
    tx.claim_effect_strict("strict","worker",100,Some(&identity::digest("claim"))).unwrap();
    let run = strict_run(tx,"strict").unwrap();
    held_strict_claim(tx,&run,"worker","claim",99).unwrap();
    for (worker,token,now) in [("wrong","claim",99),("worker","wrong",99),("worker","claim",100)] {
        assert_eq!(held_strict_claim(tx,&run,worker,token,now).unwrap_err().code(),"E_EFFECT_LEASE");
    }
    tx.retry_effect_strict("strict","retry",80).unwrap();
    let retry = tx.required_effect_run("strict").unwrap();
    assert_eq!((retry.state.as_str(),retry.next_at),("queued",Some(80)));
    assert!(retry.claimed_by.is_none() && retry.lease_until.is_none());
    assert!(tx.effect_lease_digest("strict").unwrap().is_none());
    tx.claim_effect_strict("strict","worker",200,Some("digest")).unwrap();
    tx.fail_effect_strict("strict","failed",90).unwrap();
    assert_eq!(tx.settled_at("strict"),Some(90));
    let failed = tx.required_effect_run("strict").unwrap();
    assert!(failed.claimed_by.is_none() && failed.next_at.is_none());
    tx.retry_effect_strict("strict","again",91).unwrap();
    assert_eq!(tx.settled_at("strict"),None);
    tx.claim_effect_strict("strict","worker",200,Some("digest")).unwrap();
    tx.send_effect_strict("strict",None,92).unwrap();
    let sent = tx.required_effect_run("strict").unwrap();
    assert_eq!((sent.state.as_str(),sent.result),("sent",None));
    assert!(sent.claimed_by.is_none() && sent.lease_until.is_none() && sent.next_at.is_none());
    assert!(tx.effect_lease_digest("strict").unwrap().is_none());
    assert_eq!(tx.settled_at("strict"),Some(92));

    emit(tx,"cancel",3);
    tx.claim_effect("cancel","worker",100,Some("digest")).unwrap();
    tx.cancel_effect("cancel",10).unwrap();
    let cancelled = tx.required_effect_run("cancel").unwrap();
    assert!(cancelled.cancelled);
    assert_eq!((cancelled.state.as_str(),cancelled.error_code.as_deref()),("failed",Some("E_EFFECT_CANCELLED")));
    tx.claim_effect_strict("cancel","worker",200,None).unwrap();
    assert_eq!(tx.required_effect_run("cancel").unwrap(),cancelled);
    tx.finalize_effect_cancellation("cancel",11).unwrap();
    assert_eq!(tx.settled_at("cancel"),Some(11));
    tx.park_effect_generation("cancel",99).unwrap();
    assert_eq!(tx.settled_at("cancel"),Some(11),"terminal rows stay unchanged");
    // Missing-row updates are successful no-ops on both adapters.
    tx.claim_effect_strict("missing","worker",1,None).unwrap();
    tx.cancel_effect("missing",1).unwrap();
    assert!(tx.effect_run("missing").unwrap().is_none());
    assert_eq!(strict_run(tx,"missing").unwrap_err().code(),"E_EFFECT_UNKNOWN");
}

pub(crate) fn text_and_wide_values(tx: &impl Evidence) {
    let schema = Schema::default();
    let valid = ("ok".into(),"mail".into(),Value::Null,BTreeMap::new());
    for bad in [
        ("id\0bad".into(),"mail".into(),Value::Null,BTreeMap::new()),
        ("bad".into(),"mail\0bad".into(),Value::Null,BTreeMap::new()),
        ("bad".into(),"mail".into(),Value::Null,BTreeMap::from([("principal\0bad".into(),Some(10))])),
    ] {
        assert_eq!(record(tx,&[valid.clone(),bad],1,0,false,&schema).unwrap_err().code(),"E_INPUT");
        assert!(tx.effect_run("ok").unwrap().is_none(),"validate the whole admission before writing");
    }
    assert_eq!(record(tx,&[valid],i64::MAX as u64+1,0,false,&schema).unwrap_err().code(),"E_INPUT");
    let payload = Value::String("payload\0value".into());
    record(tx,&[("wide".into(),"mail".into(),payload.clone(),BTreeMap::new())],i64::MAX as u64,i64::MIN,false,&schema).unwrap();
    let wide = tx.required_effect_run("wide").unwrap();
    assert_eq!((wide.seq,wide.at),(i64::MAX as u64,i64::MIN));
    assert_eq!(wide.payload,payload);
    tx.claim_effect("wide","worker",i64::MAX,None).unwrap();
    assert_eq!(tx.required_effect_run("wide").unwrap().lease_until,Some(i64::MAX));
    let error = diagnostic(&format!("{}\0suffix","x".repeat(1_999)));
    assert_eq!(error.chars().count(),2_000);
    assert!(error.ends_with('\u{fffd}'));
    tx.retry_effect_strict("wide",&error,i64::MAX).unwrap();
    assert_eq!(tx.required_effect_run("wide").unwrap().error.as_deref(),Some(error.as_str()));
    tx.send_effect_strict("wide",Some(&Value::String("result\0value".into())),i64::MAX).unwrap();
    assert_eq!(tx.required_effect_run("wide").unwrap().result,Some(Value::String("result\0value".into())));
    tx.send_effect_strict("wide",Some(&Value::Null),i64::MAX).unwrap();
    assert_eq!(tx.required_effect_run("wide").unwrap().result,Some(Value::Null));
    tx.send_effect_strict("wide",None,i64::MAX).unwrap();
    assert_eq!(tx.required_effect_run("wide").unwrap().result,None);
    assert_eq!(tx.settled_at("wide"),Some(i64::MAX));
    tx.seed_legacy();
    let legacy = tx.required_effect_run("legacy").unwrap();
    assert_eq!(legacy.work,legacy_work());
    assert!(legacy.contract.is_none() && legacy.deadline.is_none() && legacy.release.is_none());
    assert!(contract_stands(tx,&schema,&legacy,0).unwrap(),"NULL contract preserves legacy behavior");
    assert!(legacy.result.is_none() && legacy.next_at.is_none() && !legacy.cancelled);
}

pub(crate) fn presence_satisfaction(tx: &impl OutboxTransaction) {
    let schema = Schema::default();
    let dependencies = BTreeMap::from([("z".into(),Some(200)),("a".into(),Some(100)),("absent".into(),None)]);
    record(tx,&[("presence".into(),"mail".into(),Value::Null,dependencies)],1,0,false,&schema).unwrap();
    assert_eq!(tx.effect_presence("presence").unwrap(),[("a".into(),false),("z".into(),false)]);
    tx.reconnect_effect_presence("a",101).unwrap();
    assert!(!tx.effect_presence_satisfied("presence").unwrap());
    tx.reconnect_effect_presence("z",200).unwrap();
    assert!(tx.effect_presence_satisfied("presence").unwrap());
    tx.clear_effect_presence("presence").unwrap();
    let result = crate::value::object([("outcome",Value::String("presence_reconnected".into()))]);
    tx.satisfy_effect("presence",&result).unwrap();
    let run = tx.required_effect_run("presence").unwrap();
    assert_eq!((run.state.as_str(),run.result,run.next_at,run.attempts),("satisfied",Some(result),None,0));
    assert!(tx.effect_presence("presence").unwrap().is_empty());
    assert!(tx.effect_candidates(None,i64::MAX,u64::MAX).unwrap().is_empty());
}

pub(crate) fn deadline_and_attempt_limits(tx: &impl Evidence) {
    let mut work = legacy_work();
    work.policy.max_attempts = 1;
    let mut schema = Schema::default();
    schema.effect_specs.insert("mail".into(),work.clone());
    record(tx,&[("attempt".into(),"mail".into(),Value::Null,BTreeMap::new())],1,0,false,&schema).unwrap();
    tx.claim_effect_strict("attempt","worker",100,None).unwrap();
    assert_eq!(expire(tx,100).unwrap(),0);
    assert_eq!(expire(tx,101).unwrap(),1);
    let failed = tx.required_effect_run("attempt").unwrap();
    assert_eq!((failed.state.as_str(),failed.error_code.as_deref()),("failed",Some("E_EFFECT_ATTEMPTS")));
    assert_eq!(tx.settled_at("attempt"),Some(101));
    work.policy.deadline_ms = Some(1_000);
    schema.effect_specs.insert("mail".into(),work);
    record(tx,&[("deadline".into(),"mail".into(),Value::Null,BTreeMap::new())],2,0,false,&schema).unwrap();
    tx.claim_effect("deadline","worker",2_000,Some(&identity::digest("token"))).unwrap();
    let run = tx.required_effect_run("deadline").unwrap();
    assert_eq!(run.lease_until,Some(1_000));
    assert_eq!(held_strict_claim(tx,&run,"worker","token",1_000).unwrap_err().code(),"E_EFFECT_LEASE");
    assert_eq!(expire_strict(tx,&schema,1_000).unwrap(),1);
    assert_eq!(tx.required_effect_run("deadline").unwrap().error_code.as_deref(),Some("E_EFFECT_DEADLINE"));
    assert_eq!(tx.settled_at("deadline"),Some(1_000));
}

pub(crate) fn cancelled_race_winner(tx: &impl OutboxTransaction) {
    cancel(tx,"race",10).unwrap();
}

pub(crate) fn settle_race_loser(tx: &impl OutboxTransaction) -> Result<(),RuntimeError> {
    let run = strict_run(tx,"race")?;
    held_strict_claim(tx,&run,"worker","token",11)?;
    tx.send_effect_strict("race",None,11)
}

pub(crate) fn claim_one(tx: &impl OutboxTransaction, worker: &str) -> Vec<EffectRun> {
    let ids = tx.strict_effect_candidates(None,0,1).unwrap();
    ids.into_iter().map(|id| {
        tx.claim_effect_strict(&id,worker,100,Some(&identity::digest("token"))).unwrap();
        tx.required_effect_run(&id).unwrap()
    }).collect()
}

pub(crate) fn race_seed(tx: &impl OutboxTransaction, running: bool) {
    emit(tx,"race",1);
    if running { tx.claim_effect_strict("race","worker",100,Some(&identity::digest("token"))).unwrap(); }
}

    pub(crate) fn snapshot_seed(tx: &impl OutboxTransaction) {
        let schema = Schema { effects: vec!["mail".into()], ..Schema::default() };
        for (id, seq, deadline) in [("z",1,None), ("a",1,None), ("deferred",2,Some(1_000)), ("retry",3,None)] {
            let presence = deadline.map(|d| BTreeMap::from([("alice".into(),Some(d))])).unwrap_or_default();
            record(tx, &[(id.into(),"mail".into(),Value::Null,presence)], seq, 0, false, &schema).unwrap();
        }
        tx.retry_effect("retry", "backoff", 2_000).unwrap();
    }

    pub(crate) fn snapshot_reads(store: &impl OutboxStore) {
        assert!(store.effects_due(None, 100).unwrap());
        assert!(store.effects_due(Some("mail"), 100).unwrap());
        assert!(!store.effects_due(Some("other"), i64::MAX).unwrap());
        assert!(store.list_effects(None, 0).unwrap().is_empty());
        let ids = |limit| store.list_effects(Some("queued"),limit).unwrap().into_iter().map(|r| r.id).collect::<Vec<_>>();
        assert_eq!(ids(3), ["retry","deferred","z"]);
        assert_eq!(ids(u64::MAX), ["retry","deferred","z","a"]);
        assert!(store.list_effects(Some("sent"), 10).unwrap().is_empty());
        let health = store.effect_health(100).unwrap();
        assert_eq!(health.counts.get("queued"), Some(&4));
        assert_eq!(health.deferred.unwrap(), (1,Some(1_000)));
        assert_eq!(store.effect_health(1_000).unwrap().deferred.unwrap(), (0,None));
        assert_eq!(store.effect_counts().unwrap(), health.counts);
        store.set_effect_replay(true, require_dev_store).unwrap();
        assert_eq!(store.set_effect_replay(false, |_| Err(RuntimeError::Input("refused".into()))).unwrap_err().code(), "E_INPUT");
    }

    pub(crate) const LEASE_SEED: &str = "
        INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at,family) VALUES
            ('legacy-worker','service:worker','service',0,1000,NULL),
            ('modern-worker','service:worker','service',0,1500,'modern'),
            ('expired-worker','service:worker','service',0,100,'modern'),
            ('ordinary','member','member',0,900,'member-family'),
            ('delegated','member','member',0,850,'delegated-family');
        INSERT INTO _meta(key,value) VALUES ('worker:session-family','legacy-worker'),('WoRkEr:FaMiLy:modern','1');
        INSERT INTO _requests(id,name,args,principal,at,state,attempts,lease_until,session_digest,family,principal_generation,admitted_expires_at) VALUES
            ('legacy','action','null','member',0,'running',1,800,NULL,NULL,NULL,NULL),
            ('bound','action','null','member',0,'running',1,850,'delegated','member-family',0,900),
            ('missing','action','null','absent',0,'running',1,700,NULL,'absent-family',0,900),
            ('queued','action','null','member',0,'queued',1,600,NULL,NULL,NULL,NULL);
    ";
    pub(crate) fn lease_shift(tx: &impl OutboxTransaction) {
        let schema = Schema { effects: vec!["mail".into()], ..Schema::default() };
        record(tx, &[("leased".into(),"mail".into(),Value::Null,BTreeMap::new())], 1, 0, false, &schema).unwrap();
        tx.claim_effect("leased","worker",90,None).unwrap();
        tx.shift_worker_leases(200,100).unwrap();
        assert_eq!(tx.required_effect_run("leased").unwrap().lease_until,Some(290), "overdue effect leases shift too, as on SQLite");
    }
    pub(crate) fn replay_suppression(tx: &impl OutboxTransaction) {
        assert!(tx.replay_suppresses().unwrap(), "a refused replay change rolls back");
        let schema = Schema::default();
        record(tx, &[("suppressed".into(),"mail".into(),Value::Null,BTreeMap::new())], 4, 0, true, &schema).unwrap();
        assert!(tx.effect_run("suppressed").unwrap().is_none());
        tx.suppress_effects(2).unwrap();
    }

    // Shared capability cases: each adapter supplies an empty writer transaction.
    pub(crate) fn expiry_and_generation(tx: &impl OutboxTransaction) {
        let schema = Schema { effects: vec!["mail".into()], ..Schema::default() };
        let emissions = vec![("retry".into(), "mail".into(), Value::Null, BTreeMap::new())];
        record(tx, &emissions, 1, 0, false, &schema).unwrap();
        tx.claim_effect("retry", "worker", 100, Some(&identity::digest("claim"))).unwrap();
        let run = strict_run(tx, "retry").unwrap();
        // Strict ownership ends at equality; queue expiry retains its legacy < boundary.
        assert_eq!(held_strict_claim(tx, &run, "worker", "claim", 100).unwrap_err().code(), "E_EFFECT_LEASE");
        assert_eq!(expire(tx, 100).unwrap(), 0);
        assert_eq!(expire(tx, 101).unwrap(), 1);
        let retried = strict_run(tx, "retry").unwrap();
        assert_eq!((retried.state.as_str(), retried.attempts, retried.next_at), ("queued", 1, Some(101)));
        assert_eq!(retried.error.as_deref(), Some("the lease expired"));
        assert!(retried.claimed_by.is_none() && retried.lease_until.is_none());
        assert!(tx.effect_lease_digest("retry").unwrap().is_none());

        let mut changed = schema.clone();
        let mut work = legacy_work();
        work.policy.max_attempts = 1;
        changed.effect_specs.insert("mail".into(), work);
        // A changed declaration wins over expiry, even for a stale lease.
        tx.claim_effect_strict("retry", "worker", 200, None).unwrap();
        assert_eq!(expire_strict(tx, &changed, 201).unwrap(), 1);
        let parked = strict_run(tx, "retry").unwrap();
        assert_eq!((parked.state.as_str(), parked.error_code.as_deref()), ("parked", Some("E_EFFECT_GENERATION")));
        assert!(!contract_stands(tx, &changed, &parked, 999).unwrap());
        assert_eq!(strict_run(tx, "retry").unwrap(), parked, "terminal evidence stays immutable");

        let emissions = vec![("deadline".into(), "mail".into(), Value::Null, BTreeMap::new())];
        let mut work = legacy_work();
        work.policy.max_attempts = 1;
        work.policy.deadline_ms = Some(1_000);
        let mut bounded = schema.clone();
        bounded.effect_specs.insert("mail".into(), work);
        record(tx, &emissions, 2, 0, false, &bounded).unwrap();
        tx.claim_effect("deadline", "worker", 5_000, None).unwrap();
        assert_eq!(strict_run(tx, "deadline").unwrap().lease_until, Some(1_000));
        assert_eq!(expire(tx, 1_000).unwrap(), 1);
        let failed = strict_run(tx, "deadline").unwrap();
        assert_eq!((failed.state.as_str(), failed.error_code.as_deref()), ("failed", Some("E_EFFECT_DEADLINE")));
        assert_eq!(failed.error.as_deref(), Some("the effect deadline passed"));
    }

    pub(crate) fn presence_and_bounded_maintenance(tx: &impl OutboxTransaction) {
        let schema = Schema { effects: vec!["mail".into()], ..Schema::default() };
        let presence = BTreeMap::from([("alice".into(), Some(100)), ("bob".into(), Some(200))]);
        let emissions = vec![("presence".into(), "mail".into(), Value::Null, presence)];
        record(tx, &emissions, 1, 0, false, &schema).unwrap();
        assert!(tx.effect_candidates(None, 199, 10).unwrap().is_empty());
        assert_eq!(tx.effect_candidates(Some("mail"), 200, 10).unwrap(), ["presence"]);
        assert!(tx.pending_effect_presence("alice", 100).unwrap());
        tx.reconnect_effect_presence("alice", 100).unwrap();
        assert!(!tx.pending_effect_presence("alice", 100).unwrap());
        assert!(tx.effect_presence_satisfied("presence").unwrap());
        assert!(tx.effect_presence("presence").unwrap().iter().any(|(p, live)| p == "alice" && *live));
        tx.clear_effect_presence("presence").unwrap();
        assert!(tx.effect_presence("presence").unwrap().is_empty());
        for id in ["presence", "second"] {
            if id == "second" {
                record(tx, &[(id.into(), "mail".into(), Value::Null, BTreeMap::new())], 2, 0, false, &schema).unwrap();
            }
            tx.claim_effect(id, "worker", 50, None).unwrap();
        }
        // A zero budget still makes progress once and does not consume the next row.
        assert_eq!(expire_batch(tx, 51, 256, std::time::Duration::ZERO).unwrap(), 1);
        assert_eq!(tx.expired_effects(51, 256).unwrap().len(), 1);
        assert_eq!(expire(tx, 51).unwrap(), 1);
    }

pub(crate) fn deployed_replay_refusal(store: &impl OutboxStore) {
    assert_eq!(store.set_effect_replay(true,require_dev_store).unwrap_err().code(),"E_GENERATION");
}

// Every lookup must leave earlier writes committable, including presence updates.
pub(crate) fn nul_lookups(tx: &impl OutboxTransaction) {
    emit(tx, "lookup-survivor", 1);
    tx.insert_effect_presence("alice", "lookup-survivor", 200).unwrap();
    let missing = "missing\0key";
    assert!(tx.effect_run(missing).unwrap().is_none());
    assert!(tx.effect_candidates(Some("mail\0"), 100, 10).unwrap().is_empty());
    assert!(tx.strict_effect_candidates(Some("mail\0"), 100, 10).unwrap().is_empty());
    assert!(!tx.pending_effect_presence("alice\0", 100).unwrap());
    tx.reconnect_effect_presence("alice\0", 100).unwrap();
    assert!(!tx.effect_presence_satisfied(missing).unwrap());
    assert!(tx.effect_presence(missing).unwrap().is_empty());
    assert_eq!(strict_run(tx, missing).unwrap_err().code(), "E_EFFECT_UNKNOWN");
    assert_eq!(cancel(tx, missing, 100).unwrap_err().code(), "E_EFFECT_UNKNOWN");
    assert!(tx.effect_lease_digest(missing).is_err());
    assert_eq!(tx.effect_presence("lookup-survivor").unwrap(), [("alice".into(), false)]);
    assert!(tx.pending_effect_presence("alice", 100).unwrap());
    tx.reconnect_effect_presence("alice", 100).unwrap();
    assert!(tx.effect_presence_satisfied("lookup-survivor").unwrap());
}

pub(crate) fn nul_snapshot_reads(store: &impl OutboxStore) {
    assert!(!store.effects_due(Some("mail\0"), 100).unwrap());
    assert!(store.list_effects(Some("queued\0"), 10).unwrap().is_empty());
    assert!(store.effects_due(Some("mail"), 100).unwrap());
}

// The compatibility claim's exact expire-before-filter sequence.
pub(crate) fn nul_filter_after_expiry(tx: &impl OutboxTransaction) {
    assert_eq!(expire(tx, 101).unwrap(), 1);
    assert!(tx.effect_candidates(Some("mail\0"), 101, 1).unwrap().is_empty());
}

pub(crate) use sqlite_oracle::sqlite_nul_claim_oracle;

pub(crate) const LEASE_BOUNDARY_SEED: &str = "
    INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at,family) VALUES
        ('worker-near','worker','service',0,9223372036854775806,'worker-family'),
        ('worker-max','worker','service',0,9223372036854775807,'worker-family'),
        ('ordinary-near','member','member',0,9223372036854775806,'ordinary'),
        ('ordinary-max','member','member',0,9223372036854775807,'ordinary-max-family'),
        ('delegate-near','worker','service',0,10,'delegated'),
        ('delegate-max','worker','service',0,10,'delegated');
    INSERT INTO _meta(key,value) VALUES ('worker:family:worker-family','1');
    INSERT INTO _requests(id,name,args,principal,at,state,attempts,lease_until,session_digest,family,principal_generation,admitted_expires_at) VALUES
        ('legacy-near','action','null','worker',0,'running',1,9223372036854775806,NULL,NULL,NULL,NULL),
        ('legacy-max','action','null','worker',0,'running',1,9223372036854775807,NULL,NULL,NULL,NULL),
        ('bound-near','action','null','worker',0,'running',1,9223372036854775806,'delegate-near','worker-family',0,9223372036854775807),
        ('bound-max','action','null','worker',0,'running',1,9223372036854775807,'delegate-max','worker-family',0,9223372036854775807),
        ('capped','action','null','member',0,'running',1,9223372036854775807,NULL,'ordinary',0,9223372036854775807);
";

pub(crate) fn lease_shift_saturates(tx: &impl OutboxTransaction) {
    emit(tx, "near", 1);
    emit(tx, "max", 2);
    tx.claim_effect("near", "worker", i64::MAX - 1, None).unwrap();
    tx.claim_effect("max", "worker", i64::MAX, None).unwrap();
    // First reach MAX exactly, then attempt to cross it.
    for _ in 0..2 {
        tx.shift_worker_leases(1, 100).unwrap();
        for id in ["near", "max"] {
            assert_eq!(tx.required_effect_run(id).unwrap().lease_until, Some(i64::MAX));
        }
    }
}

pub(crate) fn lease_boundary_rows(sessions: Vec<(String, i64)>, requests: Vec<(String, i64)>) {
    assert_eq!(sessions, [
        ("delegate-max".into(), i64::MAX), ("delegate-near".into(), i64::MAX),
        ("ordinary-max".into(), i64::MAX), ("ordinary-near".into(), i64::MAX - 1),
        ("worker-max".into(), i64::MAX), ("worker-near".into(), i64::MAX),
    ]);
    assert_eq!(requests, [
        ("bound-max".into(), i64::MAX), ("bound-near".into(), i64::MAX),
        ("capped".into(), i64::MAX - 1), ("legacy-max".into(), i64::MAX),
        ("legacy-near".into(), i64::MAX),
    ]);
}

pub(crate) fn signed_lease_shift_boundaries(tx: &impl OutboxTransaction) {
    for (id, lease) in [("min", i64::MIN), ("near-min", i64::MIN + 1)] {
        emit(tx, id, 1);
        tx.claim_effect(id, "worker", lease, None).unwrap();
    }
    for delta in [-1, -1, 0] {
        tx.shift_worker_leases(delta, 0).unwrap();
        for id in ["min", "near-min"] {
            assert_eq!(tx.required_effect_run(id).unwrap().lease_until, Some(i64::MIN));
        }
    }
    tx.shift_worker_leases(i64::MAX, 0).unwrap();
    assert_eq!(tx.required_effect_run("min").unwrap().lease_until, Some(-1));
    tx.shift_worker_leases(i64::MIN, 0).unwrap();
    assert_eq!(tx.required_effect_run("min").unwrap().lease_until, Some(i64::MIN));
}

#[cfg(test)]
mod sqlite_oracle {
    use super::*;

    pub(crate) fn sqlite_nul_claim_oracle() -> EffectRun {
        let schema = Schema { effects: vec!["mail".into()], ..Schema::default() };
        let mut engine = Engine::memory(schema, []).unwrap();
        let tx = engine.store.transaction().unwrap();
        race_seed(&tx, true);
        tx.commit().unwrap();
        assert!(engine.claim_effects("worker", Some("mail\0"), 1, 1_000, 101).unwrap().is_empty());
        engine.presence_reconnected("alice\0", 101).unwrap();
        engine.effects(None, 10).unwrap().remove(0)
    }
}

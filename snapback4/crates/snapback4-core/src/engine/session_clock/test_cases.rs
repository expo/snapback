use super::*;

pub(crate) const SEED: &str = "
INSERT INTO _principal_generations(principal,generation) VALUES ('revoked',2);
INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at,family) VALUES
 ('full','alice','member',10,200,'family'),
 ('expired','alice','member',10,100,'family'),
 ('closed-action','alice','action',10,200,'closed-action'),
 ('worker','service:worker','service',10,200,'worker-family'),
 ('action','alice','action',10,180,'action-family');
INSERT INTO _meta(key,value) VALUES ('WoRkEr:FaMiLy:worker-family','1');
INSERT INTO _requests(id,name,args,principal,at,state,lease_until,deadline,session_digest,family,principal_generation,admitted_expires_at) VALUES
 ('running','test','{}','alice',10,'running',180,150,'action','family',0,200),
 ('closed','test','{}','alice',10,'succeeded',180,190,'closed-action','family',0,200);
INSERT INTO _read_sessions(token_digest,principal,kind,family,created_at,expires_at,cap_expires_at,principal_generation) VALUES
 ('read','alice','member','read-family',10,200,220,0),
 ('cap-expired','alice','member','capped',10,200,100,0),
 ('revoked-read','revoked','member','revoked',10,200,220,1);
INSERT INTO _session_mint_bindings(invocation,intent,input_digest,principal,kind,days,expires_at,family,principal_generation) VALUES
 ('mint','live','input','alice','member',1,200,'family',0),
 ('mint','expired','input','alice','member',1,100,'family',0),
 ('mint','missing','input','alice','member',1,200,'missing',0),
 ('mint','revoked','input','alice','member',1,200,'family',1);
";

pub(crate) fn preserves_only_live(tx: &(impl SessionClockTransaction + OutboxTransaction)) {
    preserve(tx, 1_000, 100).unwrap();
    tx.shift_worker_leases(1_000, 100).unwrap();
    let full = tx.session_by_digest("full").unwrap().unwrap();
    assert_eq!(full.expires_at,1_200);
    let read = tx.session_by_digest("read").unwrap().unwrap();
    assert_eq!((read.expires_at,read.cap_expires_at),(1_200,Some(1_220)));
    for digest in ["expired","cap-expired","revoked-read","closed-action"] {
        assert!(authority::live_session(tx,digest,1_100).unwrap().is_none(),"{digest} must stay dead");
    }
    assert_eq!(tx.session_by_digest("expired").unwrap().unwrap().expires_at,100);
    assert_eq!(tx.session_by_digest("cap-expired").unwrap().unwrap().cap_expires_at,Some(100));
    assert_eq!(tx.session_by_digest("revoked-read").unwrap().unwrap().expires_at,200);
    assert_eq!(tx.session_by_digest("worker").unwrap().unwrap().expires_at,1_200,"supervised family shifts exactly once");
    let claim = tx.work_by_id("running").unwrap().unwrap();
    assert_eq!(claim.lease_until,Some(1_180));
    assert_eq!(claim.deadline,Some(150),"product deadlines advance normally");
    assert!(authority::live_session(tx,"action",1_100).unwrap().is_none(),"the unchanged product deadline still fences the claim");
    let mints = tx.clock_mints(None).unwrap();
    for mint in mints {
        assert_eq!(mint.expires_at,if mint.intent == "live" { 1_200 } else if mint.intent == "expired" { 100 } else { 200 },"mint {}",mint.intent);
    }
    let row = tx.clock_sessions(false,None).unwrap().into_iter().find(|r| r.digest == "full").unwrap();
    assert_eq!(row.created_at,1_010,"refresh duration keeps its original width");
}

pub(crate) fn overflow_is_validated_before_writes(tx: &impl SessionClockTransaction) {
    let err = preserve(tx,i64::MAX,100).unwrap_err();
    assert_eq!(err.code(),"E_INPUT");
    assert_eq!(tx.session_by_digest("full").unwrap().unwrap().expires_at,200);
    assert_eq!(tx.session_by_digest("read").unwrap().unwrap().cap_expires_at,Some(220));
    assert_eq!(tx.clock_mints(None).unwrap().into_iter().find(|m| m.intent == "live").unwrap().expires_at,200);
}

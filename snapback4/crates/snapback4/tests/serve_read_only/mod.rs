// @ref LLP 3000.033#3 — the guard is tested before replay and transient effects.
mod assets;
use super::*;
use snapback4_core::{Store, Value, value::object};
use sha2::{Digest, Sha256};
const NOW: i64 = 1_790_000_000_000;
const EXTRA: &str = "\nuse identity\nuse server\nroute declared: post \"/declared\" wait 1s\neffect notify\naction external()\ntable typing:\n  owner: principal\n  ephemeral 4s\n  read <- allow\n  insert <- .owner = viewer\nmutation typeNow():\n  insert typing {owner: viewer}\nquery typingNow():\n  return typing first 10\nquery presence():\n  return exists connected[viewer]\nmutation push():\n  if not exists connected['member:bob']:\n    emit notify {recipient: 'member:bob'}\nquery history(c: cursor ?):\n  return messages where .chat = 'c1' first 2 by .ordinal after c\n";
fn host() -> Host { host_with_store(Store::memory().unwrap()) }
fn host_with_store(store: Store) -> Host {
    let h = Host::with_store(true, store, &format!("{}{}{}{}", include_str!("../../../snapback4-lang/tests/delivery/schema.q"), EXTRA, assets::SCHEMA,include_str!("receipts.q")));
    lock(&h.shared.clock).freeze(NOW);
    let mut e = lock(&h.shared.engine);
    e.seed_at(std::iter::once(("chats".into(), object([("id", Value::Id("c1".into())), ("name", Value::String("chat".into()))]))), NOW).unwrap();
    e.seed_at([1,2,4,5,6].into_iter().map(|n| ("messages".into(), object([
        ("id",Value::Id(format!("m{n}"))), ("chat",Value::Id("c1".into())), ("ordinal",Value::Int(n)),
        ("text",Value::String(format!("message {n}"))), ("owner",Value::Id("member:bob".into())), ("quote",Value::Null),
    ]))), NOW).unwrap();
    e.store().conn().execute("INSERT INTO _sessions(token_digest,principal,kind,created_at,expires_at,family) VALUES (?1,'member:bob','member',?2,?3,'full-family')", rusqlite::params![format!("{:x}",Sha256::digest(b"full")),NOW,NOW+10*86_400_000]).unwrap();
    drop(e); h.shared.publish_engine(&lock(&h.shared.engine)); h
}
const ALICE: &str = "Authorization: Bearer alice\r\n";
const FULL: &str = "Authorization: Bearer full\r\n";
fn narrowed(h: &Host) -> Json {
    let reply = body(&h.request("POST", "/auth/narrow", FULL, "{}"));
    assert!(reply["session"]["token"].as_str().is_some(), "{reply}"); reply["session"].clone()
}
fn headers(session: &Json) -> String { format!("Authorization: Bearer {}\r\n", session["token"].as_str().unwrap()) }
fn snapshot(h: &Host) -> String {
    let e=lock(&h.shared.engine); let conn=e.store().conn();
    // Includes application rows, receipts, views, effects/actions, full sessions and _ops.
    // Exclude only read-family auth state and store/schema metadata. Account rows
    // are identical deterministic fixtures, so they join the digest as well.
    let tables: Vec<String> = conn.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' AND name NOT IN ('_read_sessions','_meta','_generations') ORDER BY name").unwrap().query_map([], |r| r.get(0)).unwrap().map(Result::unwrap).collect();
    let mut values=Vec::new();
    for table in tables { let mut stmt=conn.prepare(&format!("SELECT * FROM \"{table}\"")).unwrap(); let n=stmt.column_count();
        let mut rows=stmt.query_map([], |r| (0..n).map(|i| r.get::<_,rusqlite::types::Value>(i)).collect::<Result<Vec<_>,_>>()).unwrap().map(|r| format!("{:?}",r.unwrap())).collect::<Vec<_>>(); rows.sort(); values.push((table,rows)); }
    format!("{values:?}")
}
#[test]
fn guard_barriers_replay_and_http_parity() {
    let h=host(); let session=narrowed(&h); let read=headers(&session);
    for path in ["/m/edit","/m/typeNow","/a/external","/assets","/declared","/actions/claim","/effects/claim","/effects/settle","/routes/verify/claim","/auth/session","/auth/narrow","/auth/revoke","/auth/logout-all","/seed","/dev/clock/advance","/future-route"] {
        let before=snapshot(&h);
        let eph=body(&h.request("POST","/q/typingNow",FULL,"{\"args\":{}}"))["data"].clone();
        let reply=h.request("POST",path,&read,"{\"id\":\"read-refusal\",\"args\":{}}");
        assert_eq!(status(&reply),403,"{path}: {reply}"); let reply=body(&reply);
        assert_eq!(reply["denied"]["code"],"E_READ_ONLY"); assert!(reply.get("head").is_none() && reply.get("store_id").is_none());
        assert_eq!(snapshot(&h),before,"transient durable barrier for {path}");
        assert_eq!(body(&h.request("POST","/q/typingNow",FULL,"{\"args\":{}}"))["data"],eph,"ephemeral barrier");
    }
    for (method, path) in [("GET", "/"), ("GET", "/api.ts"), ("GET", "/native.wasm"),
        ("GET", "/future-route"), ("GET", "/q/raw"), ("GET", "/auth/refresh"), ("GET", "/auth/config"),
        ("POST", "/schema"), ("POST", "/changes"), ("POST", "/assets/ordinary"),
        ("PUT", "/probe"), ("DELETE", "/assets/ordinary"), ("HEAD", "/schema")] {
        let before = snapshot(&h);
        let response = h.request(method, path, &read, "{}");
        assert_eq!(status(&response), 403, "{method} {path}: {response}");
        if method != "HEAD" { assert_eq!(body(&response), json!({"denied": body(&response)["denied"]})); assert_eq!(body(&response)["denied"]["code"], "E_READ_ONLY"); }
        assert_eq!(snapshot(&h), before);
    }
    let before = snapshot(&h);
    let forged = body(&h.request("POST", "/m/edit", &read, r#"{"scope":"full","id":"forged","args":{}}"#));
    assert_eq!(forged["denied"]["code"], "E_READ_ONLY"); assert_eq!(snapshot(&h), before);
    let refreshed = body(&h.request("POST", "/auth/refresh", &read, r#"{"scope":"full"}"#));
    assert_eq!(refreshed["session"]["scope"], "read");
    let read = headers(&refreshed["session"]);
    let accepted=body(&h.request("POST","/m/edit",FULL,"{\"id\":\"read-refusal\",\"args\":{}}"));
    assert_eq!(accepted["state"],"sent","{accepted}"); assert_ne!(accepted["replayed"],true);
    let before=snapshot(&h);
    assert_eq!(status(&h.request("POST","/m/edit",&read,"{\"id\":\"read-refusal\",\"args\":{}}")),403);
    assert_eq!(snapshot(&h),before);
    assert_eq!(body(&h.request("POST","/m/edit",FULL,"{\"id\":\"read-refusal\",\"args\":{}}"))["replayed"],true);
    for _ in 0..3 { for op in ["raw","page","scalar","filtered","unrelated","missingQuery"] {
        let a=body(&h.request("POST",&format!("/q/{op}"),FULL,"{\"args\":{}}"));
        let b=body(&h.request("POST",&format!("/q/{op}"),&read,"{\"args\":{}}"));
        assert!(b.get("delivery").is_none()); assert!(b["meter"].get("delivery").is_none());
        assert_eq!(a["data"],b["data"]); assert_eq!(a["next"],b["next"]); assert_eq!(a["complete"],b["complete"]);
        if op != "missingQuery" {
            for meter in ["examined", "steps", "heapBytes"] {
                assert!(a["meter"][meter].is_number(), "full {op} meter.{meter}: {a}");
                assert!(b["meter"][meter].is_number(), "read {op} meter.{meter}: {b}");
                assert_eq!(a["meter"][meter], b["meter"][meter], "{op} meter.{meter}");
            }
        }
        if op=="raw" { assert!(a.get("delivery").is_some()); }
        let mut a=a.clone();let mut b=b.clone();
        for reply in [&mut a,&mut b] {reply.as_object_mut().unwrap().remove("delivery");reply.as_object_mut().unwrap().remove("meter");}
        assert_eq!(a,b,"entire HTTP answer parity for {op}");
    } }
    assert_eq!(body(&h.request("GET","/probe?scope=1",&read,""))["scope"],"read");
    assert_eq!(body(&h.request("POST","/probe?scope=1",FULL,"{}"))["scope"],"full");
    for method in ["GET", "POST"] {
        let legacy = body(&h.request(method, "/probe", FULL, "{}"));
        assert_eq!(legacy, json!({"ok":true, "store_id":legacy["store_id"], "seq":legacy["seq"], "viewer":"member:bob"}));
    }
    assert_eq!(status(&h.request("GET","/schema",&read,"")),200);
}
#[test]
fn read_sync_is_allow_listed_and_has_full_visibility_without_writes() {
    let h = host();
    let read = headers(&narrowed(&h));
    let before = snapshot(&h);
    let full = h.request("POST", "/sync", FULL, r#"{"from":0}"#);
    let response = h.request("POST", "/sync", &read, r#"{"from":0}"#);
    assert_eq!(status(&response), 200, "{response}");
    let response = body(&response);
    assert!(response.get("denied").is_none(), "{response}");
    assert_eq!(response, body(&full));
    assert_eq!(snapshot(&h), before);
}
#[test]
fn paired_deterministic_reader_runs_have_equal_application_digest() {
    fn run(observer: bool) -> String {
        let h=host(); assets::seed(&h);
        lock(&h.shared.engine).store().conn().execute("INSERT INTO _sessions VALUES (?1,'member:alice','member',?2,?3,'alice-family')",rusqlite::params![format!("{:x}",Sha256::digest(b"alice")),NOW,NOW+10*86_400_000]).unwrap();
        let room=body(&h.request("POST","/m/room",FULL,"{\"id\":\"seedRoom\",\"newIds\":[\"room1\",\"bobMember\",\"aliceMember\"],\"args\":{}}"));assert_eq!(room["state"],"sent","{room}");
        for n in 1..=6 {
            let sent=body(&h.request("POST","/m/sendTracked",ALICE,&json!({"id":format!("seed{n}"),"newIds":[format!("tracked{n}")],"args":{"text":format!("message {n}")}}).to_string()));assert_eq!(sent["state"],"sent","{sent}");
        }
        assert_eq!(body(&h.request("POST","/m/gap",ALICE,"{\"id\":\"seedGap\",\"args\":{}}"))["state"],"sent");
        { let e=lock(&h.shared.engine);
          // Fixed test-only Argon2id salt/hash for paired-test-password: both
          // stores have byte-identical credentials before the genuine HTTP login.
          e.store().conn().execute("INSERT INTO _principals VALUES ('member:bob','member',NULL,?1)",[NOW]).unwrap();
          e.store().conn().execute("INSERT INTO _credentials VALUES ('member:bob','bob@pair.test',?1)",["$argon2id$v=19$m=19456,t=2,p=1$Uk8tZGV0ZXJtaW5pc3RpYw$i8LnN/JKJ4neVisYT8/a7iNj+NIYY7lCwWb7WR6SQT0"]).unwrap();
        }
        let session=observer.then(|| body(&h.request("POST","/auth/login","","{\"email\":\"bob@pair.test\",\"password\":\"paired-test-password\",\"scope\":\"read\"}"))["session"].clone());
        if let Some(session)=&session {
            let read=headers(session); let mut cursor=Json::Null; let mut rows=0;
            loop { let reply=body(&h.request("POST","/q/trackedHistory",&read,&json!({"args":{"c":cursor}}).to_string()));
                rows+=reply["data"].as_array().unwrap().len(); cursor=reply["next"].clone(); if cursor.is_null() {break;} }
            assert_eq!(rows,5,"pages include the gap at ordinal 3");
            let before=snapshot(&h); assert_eq!(status(&h.request("POST","/m/edit",&read,"{\"id\":\"external\",\"args\":{}}")),403); assert_eq!(snapshot(&h),before);
            h.request("GET","/changes?wait=0",&read,"");
            assert!(lock(&h.shared.presence.polls).is_empty());
        }
        let poll=if let Some(session)=&session {
            let (send,recv)=mpsc::channel();*lock(&h.shared.poll_wait)=Some(Arc::new(move||{let _=send.send(());}));
            let shared=h.shared.clone();let token=session["token"].as_str().unwrap().to_owned();let head=lock(&shared.engine).seq().unwrap();
            let poll=thread::spawn(move||{
                let path=format!("/changes?since={head}&wait=2");
                let req=tiny_http::TestRequest::new().with_path(&path).with_header(Header::from_bytes("Host","localhost").unwrap()).with_header(Header::from_bytes("Authorization",format!("Bearer {token}")).unwrap());changes::serve(req.into(),&shared,&path);
            });recv.recv_timeout(Duration::from_secs(5)).unwrap();Some(poll)
        }else{None};
        assert_eq!(body(&h.request("POST","/m/edit",FULL,"{\"id\":\"external\",\"args\":{}}"))["state"],"sent");
        let sent=body(&h.request("POST","/m/sendTracked",ALICE,"{\"id\":\"externalTracked\",\"newIds\":[\"tracked7\"],\"args\":{\"text\":\"live change\"}}"));assert_eq!(sent["state"],"sent","{sent}");
        if let Some(poll)=poll {
            poll.join().unwrap();*lock(&h.shared.poll_wait)=None;
            let reply=body(&h.request("POST","/q/raw",&headers(session.as_ref().unwrap()),"{\"args\":{}}"));
            assert_eq!(reply["data"]["text"],"changed");
            let tracked=body(&h.request("POST","/q/trackedAll",&headers(session.as_ref().unwrap()),"{\"args\":{}}"));
            assert_eq!(tracked["data"].as_array().unwrap().len(),6);assert_eq!(tracked["data"][5]["text"],"live change");
        }
        assets::matrix(&h,session.as_ref().map(headers).as_deref());
        // Both runs establish the same full-device disconnect grace before the effect.
        h.request("GET","/changes?wait=0",FULL,"");
        // The observer holds a genuine poll while the presence-gated effect reaches its deadline.
        assert_eq!(body(&h.request("POST","/m/push",FULL,"{\"id\":\"push\",\"args\":{}}"))["state"],"sent");
        let next=lock(&h.shared.engine).effects(None,10).unwrap()[0].next_at.unwrap();
        assert_eq!(next,NOW+PRESENCE_GRACE.as_millis() as i64);
        let mut poll=None;
        if let Some(session)=&session {
            let (send,recv)=mpsc::channel();*lock(&h.shared.poll_wait)=Some(Arc::new(move||{let _=send.send(());}));
            let shared=h.shared.clone();let token=session["token"].as_str().unwrap().to_owned();let head=lock(&shared.engine).seq().unwrap();
            poll=Some(thread::spawn(move||{
                let path=format!("/changes?since={head}&wait=1");
                let req=tiny_http::TestRequest::new().with_path(&path).with_header(Header::from_bytes("Host","localhost").unwrap()).with_header(Header::from_bytes("Authorization",format!("Bearer {token}")).unwrap());changes::serve(req.into(),&shared,&path);
            }));recv.recv_timeout(Duration::from_secs(5)).unwrap();
        }
        assert!(lock(&h.shared.engine).claim_effects("worker",None,10,60000,next-1).unwrap().is_empty());
        lock(&h.shared.clock).advance(next-NOW).unwrap();
        let claims=lock(&h.shared.engine).claim_effects("worker",None,10,60000,next).unwrap();assert_eq!(claims.len(),1);assert_eq!(claims[0].attempts,1);
        if let Some(poll)=poll {poll.join().unwrap();*lock(&h.shared.poll_wait)=None;}
        lock(&h.shared.clock).advance(1000).unwrap();
        if let Some(session)=&session {
            let mut session=session.clone(); let cap=session["capExpiresAt"].as_i64().unwrap();
            lock(&h.shared.engine).store().conn().execute("INSERT INTO _sessions VALUES ('foreign','other','user',0,1,'foreign')",[]).unwrap();
            for _ in 0..3 {
                session=body(&h.request("POST","/auth/refresh",&headers(&session),"{}"))["session"].clone();
                assert_eq!(session["scope"],"read"); assert_eq!(session["capExpiresAt"],cap);
                let digest=format!("{:x}",Sha256::digest(session["token"].as_str().unwrap().as_bytes()));
                let e=lock(&h.shared.engine);
                assert_eq!(e.store().conn().query_row("SELECT cap_expires_at FROM _read_sessions WHERE token_digest=?1",[&digest],|r|r.get::<_,i64>(0)).unwrap(),cap);
                assert_eq!(e.store().conn().query_row("SELECT COUNT(*) FROM _sessions WHERE token_digest=?1",[&digest],|r|r.get::<_,i64>(0)).unwrap(),0);
                drop(e);
                for path in ["/m/edit","/a/external"] { assert_eq!(status(&h.request("POST",path,&headers(&session),"{\"id\":\"refresh-write\",\"args\":{}}")),403); }
            }
            lock(&h.shared.clock).freeze(cap);
            assert_eq!(body(&h.request("POST","/auth/refresh",&headers(&session),"{}"))["denied"]["code"],"E_AUTH");
        } else {
            lock(&h.shared.engine).store().conn().execute("INSERT INTO _sessions VALUES ('foreign','other','user',0,1,'foreign')",[]).unwrap();
            lock(&h.shared.clock).freeze(NOW+7*86_400_000);
        }
        snapshot(&h)
    }
    let a=run(true); let b=run(false); assert_eq!(a,b);
    println!("paired application digest including _ops: {:x}",Sha256::digest(a.as_bytes()));
}
#[test]
fn read_polls_neither_enter_nor_leave_overlapping_full_presence() {
    let h=host(); let session=narrowed(&h); let token=session["token"].as_str().unwrap();
    for read_first in [false,true] { for read_closes_first in [false,true] {
        lock(&h.shared.presence.polls).clear();
        let mut jobs=Vec::new(); let (send,recv)=mpsc::channel();
        *lock(&h.shared.poll_wait)=Some(Arc::new(move || { let _=send.send(()); }));
        let head=lock(&h.shared.engine).seq().unwrap();
        for read in [read_first,!read_first] {
            let shared=h.shared.clone(); let token=if read {token.to_owned()} else {"full".into()};
            let wait=if read==read_closes_first {1} else {2};
            jobs.push((read,thread::spawn(move || { let path=format!("/changes?since={head}&wait={wait}");
                let req=tiny_http::TestRequest::new().with_path(&path).with_header(Header::from_bytes("Host","localhost").unwrap()).with_header(Header::from_bytes("Authorization",format!("Bearer {token}")).unwrap()); changes::serve(req.into(),&shared,&path); })));
            recv.recv_timeout(Duration::from_secs(5)).unwrap();
            if jobs.len()==1 {
                let presence=body(&h.request("POST","/q/presence",&headers(&session),"{\"args\":{}}"));
                assert_eq!(presence["data"],!read,"only a full poll establishes connected[viewer]");
                assert_eq!(presence["data"],body(&h.request("POST","/q/presence",FULL,"{\"args\":{}}"))["data"],"scope does not change a query under the same presence snapshot");
            }
        }
        assert_eq!(lock(&h.shared.presence.polls).get("member:bob"),Some(&(1,None)));
        jobs.sort_by_key(|(read,_)| *read != read_closes_first);
        for (read,job) in jobs { job.join().unwrap();
            let expected=if read && read_closes_first {(1,None)} else {(0,Some(NOW))};
            assert_eq!(lock(&h.shared.presence.polls).get("member:bob"),Some(&expected));
        }
        assert_eq!(lock(&h.shared.presence.polls).get("member:bob"),Some(&(0,Some(NOW))));
        *lock(&h.shared.poll_wait)=None;
    } }
}

#[test]
fn request_manifest_construction_counter_alternates_on_reused_engine() {
    let dir = std::env::temp_dir().join(format!("ro-manifests-{}", std::process::id()));
    std::fs::create_dir_all(&dir).unwrap();
    for disk in [false, true] {
    let h = host_with_store(if disk { Store::open(&dir.join("store.sqlite")).unwrap() } else { Store::memory().unwrap() });
    assert_eq!(h.shared.memory_store(), !disk);
    let session=narrowed(&h);
    for read in [true,true,false,true,false] {
        let token=if read {session["token"].as_str().unwrap()} else {"full"};
        let before=snapback4_core::engine::delivery::manifest_constructions();
        let request=tiny_http::TestRequest::new().with_method(Method::Post).with_path("/q/raw")
            .with_body("{\"args\":{}}")
            .with_header(Header::from_bytes("Host","localhost").unwrap())
            .with_header(Header::from_bytes("Authorization",format!("Bearer {token}")).unwrap());
        handle(request.into(),&h.shared);
        assert_eq!(snapback4_core::engine::delivery::manifest_constructions()-before,u64::from(!read), "disk={disk}, read={read}");
    }
    }
    std::fs::remove_dir_all(dir).unwrap();
}

#[test]
fn password_guest_scope_unknown_scope_and_service_mint_are_explicit() {
    let h=host();
    for path in ["/auth/guest","/auth/signup","/auth/login"] {
        assert_eq!(body(&h.request("POST",path,"","{\"scope\":\"unknown\"}"))["denied"]["code"],"E_INPUT");
    }
    let created=body(&h.request("POST","/auth/signup","","{\"email\":\"bob@read.test\",\"password\":\"test-long-password\",\"scope\":\"read\"}"));
    assert_eq!(created["session"]["scope"],"read");
    for path in ["/auth/guest","/auth/login"] {
        let reply=body(&h.request("POST",path,"","{\"email\":\"bob@read.test\",\"password\":\"test-long-password\",\"scope\":\"read\"}"));
        let session=&reply["session"];
        assert_eq!(session["scope"],"read","{reply}");assert_eq!(session["expiresAt"],session["capExpiresAt"]);
        assert!(session["token"].as_str().unwrap().starts_with("ro."));
        assert_eq!(status(&h.request("POST","/auth/logout-all",&headers(session),"{}")),403);
        assert_eq!(body(&h.request("POST","/auth/logout",&headers(session),"{}"))["ok"],true);
        assert_eq!(body(&h.request("GET","/probe",&headers(session),""))["denied"]["code"],"E_AUTH");
    }
    let service=snapback4_core::identity::service_session(lock(&h.shared.engine).store(),"test",NOW,1).unwrap();
    let header=format!("Authorization: Bearer {}\r\n",service.token);
    assert_eq!(body(&h.request("POST","/auth/narrow",&header,"{}"))["denied"]["code"],"E_AUTH");
    assert_eq!(body(&h.request("POST","/auth/session",&header,"{\"principal\":\"service:test\",\"kind\":\"service\",\"scope\":\"read\"}"))["denied"]["code"],"E_INPUT");
}

#[test]
fn held_read_poll_rechecks_revoked_credential_at_completion() {
    for disk in [false, true] {
        let dir = std::env::temp_dir().join(format!("ro-poll-{}-{disk}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let h = host_with_store(if disk { Store::open(&dir.join("store.sqlite")).unwrap() } else { Store::memory().unwrap() });
        let session = narrowed(&h); let header = headers(&session);
        let head = lock(&h.shared.engine).seq().unwrap();
        let (send, recv) = mpsc::channel();
        *lock(&h.shared.poll_wait) = Some(Arc::new(move || { let _ = send.send(()); }));
        let address = h.address;
        let poll = thread::spawn(move || exchange(address, &format!("GET /changes?since={head}&wait=25 HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\n{header}\r\n")));
        recv.recv_timeout(Duration::from_secs(5)).expect("read poll is held");
        *lock(&h.shared.poll_wait) = None;
        // Mutate authority directly while held, then publish a commit wake. Only
        // the completion recheck can refuse this already-authenticated poll.
        lock(&h.shared.engine).store().conn().execute("DELETE FROM _read_sessions", []).unwrap();
        h.request("POST", "/m/edit", FULL, r#"{"id":"wake","args":{}}"#);
        let response = poll.join().unwrap();
        assert_eq!(status(&response), 401, "disk={disk}: {response}");
        assert_eq!(body(&response)["denied"]["code"], "E_AUTH");
        assert!(lock(&h.shared.presence.polls).is_empty());
        drop(h); std::fs::remove_dir_all(dir).unwrap();
    }
}

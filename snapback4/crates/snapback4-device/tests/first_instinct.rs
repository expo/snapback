//! Generated spelling/schedule differential plus read-through upsert custody.
mod common;
use common::*;
#[path="../../snapback4-lang/tests/membership_paths/fixture.rs"] mod fixture;
use snapback4_core::{Engine, Context, Value, WriteState, wire};
use snapback4_device::{device::{Device, Queued}, store::DeviceStore};
use serde_json::{json, Value as Json};

fn seed(e: &mut Engine, depth: usize, field: &str) {
    let mut rows=vec![];
    for g in 0..2 {
        rows.push(("groups",json!({"id":format!("g{g}"),"title":"Group"})));
        for who in ["admin","alice","bob"] { rows.push(("members",json!({"id":format!("{who}-{g}"),field:format!("g{g}"),"principal":who}))); }
        for n in 0..3 {
            rows.push(("messages",json!({"id":format!("m{g}{n}"),field:format!("g{g}")})));
            if depth==3 {rows.push(("links",json!({"id":format!("p{g}{n}"),"message":format!("m{g}{n}")})));}
            rows.push(("reactions",json!({"id":format!("r{g}{n}"),"parent":format!("{}{g}{n}",if depth==3{"p"}else{"m"}),"principal":"admin","emoji":"seed"})));
        }
    }
    let rows: Vec<(String,Value)>=rows.into_iter().map(|(name,row)|(name.into(),wire::row_from_json(&e.schema().tables[name],&row).unwrap())).collect();
    e.seed_at(rows,100).unwrap();
}
fn acquire<S:DeviceStore>(e:&mut Engine,d:&mut Device<S>,viewer:&str) {
    for (n,p) in snapshot_pages(e,viewer,3).iter().enumerate(){d.apply(p,n==0).unwrap();}
}
fn page<S:DeviceStore>(d:&mut Device<S>,parent:&str,viewer:&str)->Json {
    snapback4_device::call::call(d,json!({"op":"query","name":"page","args":{"parent":parent},"viewer":viewer,"now":100}))["ok"].clone()
}
fn queue<S:DeviceStore>(d:&mut Device<S>,parent:&str,key:&str)->Queued {
    d.admit(serde_json::from_value(json!({"id":key,"seq":0,"op":"react","args":{"parent":parent,"emoji":key,"allowed":true},"viewer":"alice","now":100,"predictable":true})).unwrap()).unwrap()
}
fn write(e:&mut Engine,name:&str,viewer:&str,input:Json,nonce:u64)->snapback4_core::engine::MutationOutcome {
    let args=input.as_object().unwrap().iter().map(|(key,value)|(key.clone(), match value {Json::Bool(b)=>Value::Bool(*b),Json::String(s) if key=="emoji"=>Value::String(s.clone()),Json::String(s)=>Value::Id(s.clone()),_=>panic!("unsupported fixture arg")})).collect();
    let result=e.mutate(name,None,Context::new(viewer,args).at(100).with_ids(vec![format!("mint-{nonce}")])).unwrap();
    result
}

fn differential<H:Host>(host:&mut H) {
    // Every schema gets its own generated 32-step membership schedule. Snapshot
    // pages, sync bytes, held sets, queries and withdrawal/retention all compare.
    for depth in [2,3] {for keep in [false,true] {for horizon in [false,true] {for field in ["group","conversation"] {
        let (mut a,ba)=compile(&fixture::source(depth,false,keep,horizon,field));
        let (mut b,bb)=compile(&fixture::source(depth,true,keep,horizon,field));
        seed(&mut a,depth,field);seed(&mut b,depth,field);
        let mut da=host.open(&format!("a-{depth}-{keep}-{horizon}-{field}"),Some(ba)).unwrap();
        let mut db=host.open(&format!("b-{depth}-{keep}-{horizon}-{field}"),Some(bb)).unwrap();
        let aa=snapshot_pages(&mut a,"alice",3);let ab=snapshot_pages(&mut b,"alice",3);
        assert_eq!(aa.iter().map(page_json).collect::<Vec<_>>(),ab.iter().map(page_json).collect::<Vec<_>>());
        for (i,(a,b)) in aa.iter().zip(&ab).enumerate(){da.apply(a,i==0).unwrap();db.apply(b,i==0).unwrap();}
        let mut present=[true,true];let mut random=17+depth as u64+u64::from(keep)*33+u64::from(horizon)*79;
        for step in 0..32 {
            random=random.wrapping_mul(6364136223846793005).wrapping_add(1);let group=((random>>32)%2) as usize;
            present[group]=!present[group];let input=json!({"group":format!("g{group}"),"who":"alice","present":present[group]});
            for e in [&mut a,&mut b] {let outcome=write(e,"membership","admin",input.clone(),step);assert!(matches!(outcome.state,WriteState::Sent{..}),"{outcome:?}");}
            let reacted=json!({"parent":format!("{}{group}0",if depth==3{"p"}else{"m"}),"emoji":format!("v{step}"),"allowed":true});
            let oa=write(&mut a,"react","bob",reacted.clone(),100+step);
            let ob=write(&mut b,"react","bob",reacted,100+step);
            assert_eq!(oa,ob,"insert/update result, charges and bounds are identical");
            let pa=stream_page(&mut a,"alice",da.state().unwrap().0);let pb=stream_page(&mut b,"alice",db.state().unwrap().0);
            assert_eq!(page_json(&pa),page_json(&pb),"schedule {depth}/{keep}/{horizon}/{step}");
            da.apply(&pa,false).unwrap();db.apply(&pb,false).unwrap();
            for g in 0..2 {for n in 0..3 {
                let parent=format!("{}{g}{n}",if depth==3{"p"}else{"m"});
                let qa=page(&mut da,&parent,"alice");let qb=page(&mut db,&parent,"alice");assert_eq!(qa,qb);
                if !present[g] && !keep {assert_eq!(qa["data"],json!([]),"withdrawn: {qa}");}
                let context=||Context::new("alice",args(&[("parent",id(&parent))])).at(100);
                assert_eq!(a.query("page",context()).unwrap().data,b.query("page",context()).unwrap().data);
            }}
        }
        // A captured ancestor reference cannot move to a second audience.
        for e in [&mut a,&mut b] {let outcome=write(e,"move","admin",json!({"message":"m00","group":"g1"}),999);assert!(matches!(outcome.state,WriteState::Failed{..}),"{outcome:?}");}
    }}}}
}
#[test]fn schedules_memory(){differential(&mut Memory::new());}
#[test]fn schedules_sqlite(){differential(&mut Sqlite::new("qx-schedules"));}

fn prediction<H:Host>(host:&mut H) {
    for depth in [2,3] {for keep in [false,true] {
        let (mut e,b)=compile(&fixture::source(depth,false,keep,false,"group"));seed(&mut e,depth,"group");
        let parent=if depth==3{"p00"}else{"m00"};
        let mut d=host.open(&format!("p-{depth}-{keep}"),Some(b.clone())).unwrap();
        let unacquired=queue(&mut d,parent,"unacquired");assert!(!unacquired.predictable && unacquired.predicted.is_empty());
        d.settle("unacquired",None).unwrap();
        acquire(&mut e,&mut d,"alice");
        let inserted=queue(&mut d,parent,"insert");assert!(inserted.predictable && inserted.predicted.len()==1,"{inserted:?}");
        assert!(page(&mut d,parent,"alice")["data"].as_array().unwrap().iter().any(|r|r["emoji"]=="insert"));
        let updated=queue(&mut d,parent,"update");assert!(updated.predictable && updated.predicted==inserted.predicted,"{updated:?}");
        assert!(page(&mut d,parent,"alice")["data"].as_array().unwrap().iter().any(|r|r["emoji"]=="update"));
        d.settle("update",None).unwrap();
        assert!(page(&mut d,parent,"alice")["data"].as_array().unwrap().iter().any(|r|r["emoji"]=="insert"));
        d.settle("insert",None).unwrap();
        assert!(!page(&mut d,parent,"alice")["data"].as_array().unwrap().iter().any(|r|r["principal"]=="alice"));
        let miss=queue(&mut d,"unheld","miss");assert!(!miss.predictable && miss.predicted.is_empty(),"{miss:?}");
        write(&mut e,"membership","admin",json!({"group":"g0","who":"alice","present":false}),444);
        let revoked=stream_page(&mut e,"alice",d.state().unwrap().0);d.apply(&revoked,false).unwrap();
        let left=queue(&mut d,parent,"left");assert!(!left.predictable && left.predicted.is_empty(),"{left:?}");
        let (mut e,b)=compile(&fixture::source(depth,false,keep,true,"group"));seed(&mut e,depth,"group");
        let mut d=host.open(&format!("h-{depth}-{keep}"),Some(b)).unwrap();acquire(&mut e,&mut d,"alice");
        let window=queue(&mut d,parent,"window");assert!(!window.predictable && window.predicted.is_empty(),"{window:?}");
    }}
}
#[test]fn predictions_memory(){prediction(&mut Memory::new());}
#[test]fn predictions_sqlite(){prediction(&mut Sqlite::new("qx-prediction"));}

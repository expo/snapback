use super::common::*;
use snapback4_core::{Context, Engine, Value, WriteState, ir::{Program,ProgramKind,Stmt,Expr}};

#[test]
fn admission_refuses_every_unsupported_bridge_shape_and_missing_edge_bound() {
    let source=format!("{APP}{DECLARATION}");
    compile(&source);
    let cases = [
        ("authors profiles by principal","authors posts by authorId","E_TIMELINE_SHAPE"),
        ("principal: principal","principal: text <=50","E_TIMELINE_SHAPE"),
        ("authorId: principal","authorId: id","E_TIMELINE_SHAPE"),
        ("actorId: principal","actorId: principal ?","E_TIMELINE_SHAPE"),
        ("postId: posts","postId: profiles","E_TIMELINE_SHAPE"),
        ("at: time","at: int","E_TIMELINE_SHAPE"),
        ("followerId: principal","followerId: id","E_TIMELINE_SHAPE"),
        ("followedId: principal","followedId: id","E_TIMELINE_SHAPE"),
        ("unique byPrincipal: principal","by byPrincipal: principal","E_TIMELINE_SHAPE"),
        ("unique byActorPost: actorId, postId","by byActorPost: actorId, postId","E_TIMELINE_SHAPE"),
        ("unique byPair: followerId, followedId","by byPair: followerId, followedId","E_TIMELINE_SHAPE"),
        ("unique byPrincipal: principal","unique byPrincipal: principal\n  unique second: principal","E_TIMELINE_SHAPE"),
        ("insert <- .principal = viewer","insert <- allow","E_TIMELINE_SHAPE"),
        ("insert <- .authorId = viewer","insert <- allow","E_TIMELINE_SHAPE"),
        ("insert <- .actorId = viewer","insert <- allow","E_TIMELINE_SHAPE"),
        ("insert <- .followerId = viewer","insert <- allow","E_TIMELINE_SHAPE"),
        ("update <- .authorId = viewer","update <- allow","E_TIMELINE_SHAPE"),
        ("immutable authorId, at","immutable authorId","E_TIMELINE_SHAPE"),
        ("postId: posts\n  at: time","postId: posts\n  at: int","E_TIMELINE_SHAPE"),
        ("insert <- .principal = viewer","insert <- .principal = viewer\n  delete <- allow","E_TIMELINE_SHAPE"),
        ("update <- .authorId = viewer","update <- .authorId = viewer\n  delete <- .authorId = viewer","E_TIMELINE_SHAPE"),
        ("delete <- .actorId = viewer","delete <- deny","E_TIMELINE_SHAPE"),
        ("delete <- .followerId = viewer","delete <- deny","E_TIMELINE_SHAPE"),
        ("delete <- .actorId = viewer","delete <- .actorId = viewer\n  update <- .actorId = viewer","E_TIMELINE_SHAPE"),
        ("delete <- .followerId = viewer","delete <- .followerId = viewer\n  update <- .followerId = viewer","E_TIMELINE_SHAPE"),
        ("table follows:","table follows:\n  reason: text <=50","E_TIMELINE_SHAPE"),
        ("removed: bool default false","removed: bool","E_TIMELINE_REMOVAL"),
        ("removed: bool default false","removed: bool default true","E_TIMELINE_REMOVAL"),
        ("removed: bool default false","removed: bool ?","E_TIMELINE_REMOVAL"),
        ("cap 1000 by followerId","cap 999 by followerId","E_TIMELINE_FOLLOWS"),
        ("cap 1000 by followedId","cap 999 by followedId","E_TIMELINE_FOLLOWS"),
        ("cap 100000","cap 99999","E_TIMELINE_FOLLOWS"),
        ("by byFollowed: followedId, followerId","by byFollowed: followerId, followedId","E_TIMELINE_FOLLOWS"),
        ("cap 1000 by followerId", "", "E_TIMELINE_FOLLOWS"),
        ("cap 1000 by followedId", "", "E_TIMELINE_FOLLOWS"),
        ("cap 100000", "", "E_TIMELINE_FOLLOWS"),
        ("cap 1000 by followerId", "cap 1001 by followerId", "E_TIMELINE_FOLLOWS"),
        ("cap 1000 by followedId", "cap 1001 by followedId", "E_TIMELINE_FOLLOWS"),
        ("cap 100000", "cap 100001", "E_TIMELINE_FOLLOWS"),
        ("delete <- .actorId = viewer", "delete <- allow", "E_TIMELINE_SHAPE"),
        ("delete <- .followerId = viewer", "delete <- allow", "E_TIMELINE_SHAPE"),
    ];
    for (from,to,code) in cases {
        let changed=source.replacen(from,to,1);assert_ne!(changed,source);
        let b=snapback4_lang::compile(&[("schema.q".into(),changed)]);
        let d=b.diagnostics.iter().find(|d|d.code==code).unwrap_or_else(||panic!("{from}: {:?}",b.diagnostics));
        assert_eq!(d.guide,"feeds");assert!(!d.rewrite.is_empty());assert!(b.schema.timelines.is_empty());
    }
    for extra in ["table feedAuthors:\n  x: int\n", "mutation feedPurgeRemoved():\n  return null\n"] {
        let b=snapback4_lang::compile(&[("schema.q".into(),format!("{source}\n{extra}"))]);
        assert!(b.diagnostics.iter().any(|d|d.code=="E_TIMELINE_SHAPE"),"{:?}",b.diagnostics);
    }
    for table in ["profiles","posts","reposts","follows"] {
        let start=source.find(&format!("table {table}:\n")).unwrap();
        let end=source[start+1..].find("\ntable ").map_or(source.find("maintain feed").unwrap(),|n|start+1+n);
        for change in [0,1,2,3] {
            let mut section=source[start..end].to_string();
            section=match change {
                0=>section.replace("sync public","online only"),
                1=>section.replace("sync public","sync public last 20 by byId"),
                2=>{let line=section.lines().find(|l|l.trim().starts_with("public '")).unwrap().to_string();section.replace(&line,"  read <- allow")},
                _=>section.replace("sync public","expire at .expiresAt\n  sync public").replacen(":\n",":\n  expiresAt: time\n  by byExpiry: expiresAt\n",1),
            };
            let changed=format!("{}{}{}",&source[..start],section,&source[end..]);
            let b=snapback4_lang::compile(&[("schema.q".into(),changed)]);
            assert!(b.diagnostics.iter().any(|d|d.code=="E_TIMELINE_SHAPE"),"{table}/{change}: {:?}",b.diagnostics);
        }
    }
}

#[test]
fn timeline_read_shape_and_server_run_classification() {
    let b=bound(true);
    for name in ["register","deleteProfile","publish","repost","unrepost","follow","unfollow","refollow","remove"] {
        let fact=&b.schema.operations[name];
        assert_eq!(fact.predicts.as_deref(),Some("never"),"{name}: {fact:?}");
        assert!(fact.sites.iter().any(|s|s.kind=="timeline transition" && s.table=="feedPullCounts"));
    }
    for read in ["feed first 10","feed[viewer] first 10","feed[viewer, viewer] last 10","feed[viewer] last 10 by byId"] {
        let b=snapback4_lang::compile(&[("schema.q".into(),format!("{APP}{DECLARATION}\nquery bad():\n  return {read}\n"))]);
        assert!(b.diagnostics.iter().any(|d|d.code=="E_TIMELINE_READ"),"{read}: {:?}",b.diagnostics);
    }
}

#[test]
fn all_owned_tables_refuse_principal_and_system_program_writes() {
    for table in OWNED {
        for (kind, statement) in [
            ("insert",Stmt::Insert{table:table.into(),row:Expr::Literal(snapback4_core::value::object([("id",id("anything"))]))}),
            ("update",Stmt::Update{table:table.into(),key:Expr::Literal(id("anything")),patch:Expr::Literal(snapback4_core::value::object([] as [(&str,Value);0]))}),
            ("delete",Stmt::Delete{table:table.into(),key:Expr::Literal(id("anything"))}),
        ] {
            for ctx in [context("a",&[],1),Context::system().at(2)] {
                let b=bound(true); let mut programs:Vec<_>=b.programs.into_iter().map(|p|p.program).collect();
                programs.push(Program { name: "bad".into(), kind: ProgramKind::Mutation, args: Default::default(), read_time_granularity_ms: None, body: vec![statement.clone()], returned_shapes: Default::default(), native: false });
                let mut e=Engine::memory(b.schema,programs).unwrap();let before=snapshot(&e);
                let out=e.mutate("bad",None,ctx).unwrap();
                assert!(matches!(&out.state,WriteState::Failed{why,..} if why.code=="E_TIMELINE_OWNED"),"{table} {kind}: {out:?}");
                assert_eq!(snapshot(&e),before);assert_eq!(out.metered.rows_written,0);
            }
        }
    }
}

#[test]
fn removal_flag_is_one_way_and_app_rules_still_apply() {
    let source=format!(r#"{APP}{DECLARATION}
mutation register():
  insert profiles {{ principal: viewer }}
mutation publish(postId: id, removed: bool):
  insert posts {{ id: postId, authorId: viewer, at: now, removed }}
mutation flag(postId: posts, removed: bool):
  update posts[postId] {{ removed }}
mutation changeTime(postId: posts):
  update posts[postId] {{ at: now }}
mutation deletePost(postId: posts):
  delete posts[postId]
"#);
    let b=compile(&source);let mut e=Engine::memory(b.schema,b.programs.into_iter().map(|p|p.program)).unwrap();
    e.mutate("register",None,context("a",&[],0)).unwrap();
    let out=e.mutate("publish",None,context("a",&[("postId",id("initial")),("removed",Value::Bool(true))],1)).unwrap();
    assert!(matches!(&out.state,WriteState::Failed{why,..} if why.code=="E_TIMELINE_REMOVAL"));
    assert!(rows(&e,"posts").is_empty());
    for table in ["feedPosts", "feedRemovedEvents", "feedFeed", "feedBroadcast"] {assert!(rows(&e,table).is_empty());}
    e.mutate("publish",None,context("a",&[("postId",id("p")),("removed",Value::Bool(false))],2)).unwrap();
    for (n,(who,flag,code,writes)) in [("b",true,Some("E_RULE"),0),("a",false,None,1),("a",true,None,3),("a",true,None,1),("a",false,Some("E_TIMELINE_REMOVAL"),0)].into_iter().enumerate() {
        let before=snapshot(&e);let out=e.mutate("flag",None,context(who,&[("postId",id("p")),("removed",Value::Bool(flag))],3+n as i64)).unwrap();
        if let Some(code)=code {assert!(matches!(&out.state,WriteState::Failed{why,..} if why.code==code),"{out:?}");assert_eq!(snapshot(&e),before);} else {assert!(matches!(out.state,WriteState::Sent{..}),"{out:?}");assert_eq!(out.metered.rows_written,writes);}
    }
    for (n,(op,code)) in [("changeTime","E_CONSTRAINT"),("deletePost","E_RULE")].into_iter().enumerate() {
        let before=snapshot(&e);let out=e.mutate(op,None,context("a",&[("postId",id("p"))],20+n as i64)).unwrap();
        assert!(matches!(&out.state,WriteState::Failed{why,..} if why.code==code),"{op}: {out:?}");
        assert_eq!(snapshot(&e),before);assert_eq!(out.metered.rows_written,0);
    }
}

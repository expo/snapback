    use super::*;
    #[test]
    fn independent_search_cost_axes_include_inlined_peer_helpers() {
        let source = r#"
table members:
  conversation: id
  principal: principal
  unique conversation, principal
  read <- exists members[.conversation, viewer]
table messages:
  conversation: id
  text: text <=4000
  tombstone: bool
  at: time
  search text
  read <- exists members[.conversation, viewer]
fn searchPeers(chat: id):
  return members[conversation = chat] first 50 by .id
query original(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone last 20 by .at after c
query bare(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone and exists members[.conversation, viewer] last 20 by .at after c
query decorated(q: text <=100, c: cursor ?):
  return messages matching q where not .tombstone and exists members[.conversation, viewer] last 20 by .at after c { *, peers: searchPeers(.conversation) }
"#;
        let b = snapback4_lang::compile(&[("schema.q".into(),source.into())]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        for p in &b.programs {
            let c = classify(&b.schema,&p.program);
            let codes: BTreeSet<_> = c.iter().map(|s|s.code).collect();
            assert!(codes.contains("N_SEARCH_WORDS"));
            assert_eq!(codes.contains("N_SEARCH_UNSCOPED"),p.program.name == "original");
            assert_eq!(codes.contains("N_SEARCH_OPEN"),p.program.name != "original");
            assert_eq!(codes.contains("N_SEARCH_SHAPE"),p.program.name == "decorated", "{}", serde_json::to_string_pretty(&p.program).unwrap());
            assert!(c.iter().all(|s|!s.site.is_empty() && !s.rewrite.is_empty()));
        }
    }

const SCHEMA: &str = r#"
table roster:
  roomId: id
  principal: principal
  unique roomId, principal
  read <- exists roster[.roomId, viewer]
table posts:
  roomId: id
  body: text <=4000
  sender: principal
  tombstone: bool
  sent: time
  search body
  by byWords: roomId, words(body), sent, id
  read <- exists roster[.roomId, viewer]
fn searchPeers(room: id):
  return roster[roomId = room] first 50 by .id
"#;
fn compile(source: &str) -> snapback4_lang::Bound {
    let b = snapback4_lang::compile(&[("schema.q".into(),source.into())]);
    assert!(b.diagnostics.is_empty() && b.notes.is_empty(),"{source}\n{:?}\n{:?}",b.diagnostics,b.notes);
    b
}

#[test]
fn grouped_and_refusal_repairs_compile_cleanly_without_removing_the_preview() {
    let source=format!("{SCHEMA}\nquery newest(needle: text <=100, position: cursor ?):\n  return posts matching needle where not .tombstone and .sender = viewer and exists roster[.roomId, viewer] last 7 by .sent after position\n");
    let b=compile(&source);
    let p=&b.programs[0].program;
    let notes=classify(&b.schema,p);
    assert!(notes.iter().any(|n|n.code=="N_SEARCH_OPEN"),"{notes:?}");
    let merge=snapback4_lang::bind::merges(&p.body).into_iter().find(|m|snapback4_core::search_plan::eligible(&b.schema,m)).unwrap();
    let refusal=snapback4_core::search_plan::grouped(&b.schema,merge,&snapback4_core::search_plan::bindings(&b.schema,p)).unwrap();
    for rewrite in notes.iter().map(|n|&n.rewrite).chain(std::iter::once(&refusal)) {
        let fixed=compile(&format!("{SCHEMA}\nquery fixed(needle: text <=100, position: cursor ?):\n  {rewrite}\n"));
        assert!(classify(&fixed.schema,&fixed.programs[0].program).is_empty(),"{rewrite}\n{:?}",classify(&fixed.schema,&fixed.programs[0].program));
        assert!(rewrite.contains("hits:"));
        assert!(rewrite.contains("last 3 by .sent"),"{rewrite}");
        assert_eq!(rewrite.matches("tombstone").count(),2,"{rewrite}");
        assert_eq!(rewrite.matches("sender").count(),2,"{rewrite}");
        assert!(!rewrite.contains('$'),"{rewrite}");
    }
}

#[test]
fn unscoped_repair_keeps_filter_direction_order_take_and_argument_names() {
    for direction in ["first","last"] {
        let b=snapback4_lang::compile(&[("schema.q".into(),format!("{SCHEMA}\nquery original(needle: text <=100, position: cursor ?):\n  return posts matching needle where not .tombstone and .sender = viewer {direction} 7 by .sent after position\n"))]);
        assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
        let notes=classify(&b.schema,&b.programs[0].program);
        assert!(notes.iter().any(|n|n.code=="N_SEARCH_UNSCOPED"),"{notes:?}");
        for note in notes {
            let fixed=compile(&format!("{SCHEMA}\nquery fixed(needle: text <=100, position: cursor ?):\n  {}\n",note.rewrite));
            if note.code=="N_SEARCH_UNSCOPED" {
                assert!(note.rewrite.contains(&format!("{direction} 7 by .sent")),"{}",note.rewrite);
                assert!(note.rewrite.contains("tombstone") && note.rewrite.contains("sender") && note.rewrite.contains("after position"));
                assert!(!note.rewrite.contains(';') && !note.rewrite.contains('$'));
                assert!(!classify(&fixed.schema,&fixed.programs[0].program).iter().any(|n|n.code=="N_SEARCH_UNSCOPED"));
            }
        }
    }
}

#[test]
fn explicit_bounded_merge_describes_the_legacy_opening_cut() {
    let b=snapback4_lang::compile(&[("schema.q".into(),format!("{SCHEMA}\nquery old(needle: text <=100, position: cursor ?):\n  return merge posts matching needle after position last 7 by byWords:\n    [m.roomId] for m in roster[principal = viewer] first 100 by .roomId\n"))]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    let notes=classify(&b.schema,&b.programs[0].program);
    assert!(!notes.iter().any(|n|n.code=="N_SEARCH_OPEN"),"{notes:?}");
    assert!(notes.iter().any(|n|n.message.contains("heap-null") && n.message.contains("without next or E_SEARCH_OPEN")),"{notes:?}");
    for n in notes {
        compile(&format!("{SCHEMA}\nquery repaired(needle: text <=100, position: cursor ?):\n  {}\n",n.rewrite));
    }
}

#[test]
fn membership_rosters_under_message_hits_only_and_all_repairs_compile() {
    let b=compile(&format!("{SCHEMA}\nquery decorated(needle: text <=100, position: cursor ?):\n  return posts matching needle where not .tombstone and exists roster[.roomId, viewer] last 7 by .sent after position {{ *, peers: searchPeers(.roomId) }}\n"));
    let notes=classify(&b.schema,&b.programs[0].program);
    assert!(notes.iter().any(|n|n.code=="N_SEARCH_SHAPE"),"{notes:?}");
    for n in notes {
        let fixed=compile(&format!("{SCHEMA}\nquery repaired(needle: text <=100, position: cursor ?):\n  {}\n",n.rewrite));
        assert!(!classify(&fixed.schema,&fixed.programs[0].program).iter().any(|note|note.code=="N_SEARCH_SHAPE"));
        if n.code=="N_SEARCH_SHAPE" {assert!(!n.rewrite.contains("hits:") && !n.rewrite.contains("peers:"));}
    }
}

#[test]
fn certificate_uses_every_runtime_eligibility_condition() {
    let b=compile(&format!("{SCHEMA}\nquery newest(needle: text <=100, position: cursor ?):\n  return posts matching needle where exists roster[.roomId, viewer] last 7 by .sent after position\n"));
    let program=&b.programs[0].program;
    let original=snapback4_lang::bind::merges(&program.body).into_iter().find(|m|snapback4_core::search_plan::eligible(&b.schema,m)).unwrap();
    for case in ["eligible","bound","guard","setup","filter","nonuniform","declaration"] {
        let mut schema=b.schema.clone();let mut merge=original.clone();
        match case {
            "bound"=>if let Some(LaneSource::Scan(source))=&mut merge.lanes[0].source {source.take=Bound::Literal(100);},
            "guard"=>merge.lanes[0].guard=Some(Expr::Literal(Value::Bool(true))),
            "setup"=>merge.lanes[0].setup.push(Stmt::Let {name:"unused".into(),value:Expr::Literal(Value::Int(0))}),
            "filter"=>if let Some(LaneSource::Scan(source))=&mut merge.lanes[0].source {source.filter=Some(Box::new(Expr::Literal(Value::Bool(true))));},
            "nonuniform"=>schema.tables.get_mut("posts").unwrap().rules.read=snapback4_core::schema::RuleExpr::Eq(
                snapback4_core::schema::RuleTerm::Field("sender".into()),snapback4_core::schema::RuleTerm::Viewer),
            "declaration"=>{schema.tables.get_mut("posts").unwrap().columns.insert("body".into(),snapback4_core::schema::ColumnType::Text {max:2_000_000});},
            _=>{},
        }
        let eligible = matches!(case,"eligible" | "declaration");
        assert_eq!(snapback4_core::search_plan::eligible(&schema,&merge),eligible,"{case}");
        // Give the extracted merge its original needle binding.
        let mut p=program.clone();p.body=vec![
            Stmt::Let {name:"$intentNeedle1".into(),value:Expr::Variable("needle".into())},
            Stmt::Return(Expr::Merge(merge)),
        ];
        let notes=classify(&schema,&p);
        assert_eq!(notes.iter().any(|n|n.code=="N_SEARCH_OPEN"),eligible,"{case}: {notes:?}");
    }
}

#[test]
fn builtin_repairs_use_quarry_spellings_on_the_originating_schema() {
    // Every builtin the printer emits: count/concat were IR names, while the
    // existing lower, trim, slice and calendar spellings also round-trip here.
    for predicate in ["count(.body) > 3", "(.body + 'x') != 'hidden'", "lower(.body) != 'hidden'",
        "trim(.body) != 'hidden'", "slice(.body, 0, 3) != 'hid'", "hour(.sent) >= 0", "hour(.sent, 30m) >= 0",
        "day(.sent) >= 0", "day(.sent, 8h) >= 0", "bucket(.sent, 2m, 1s) >= 0"] {
        let b=compile(&format!("{SCHEMA}\nquery newest(needle: text <=100, position: cursor ?):\n  return posts matching needle where {predicate} and exists roster[.roomId, viewer] last 7 by .sent after position\n"));
        let notes=classify(&b.schema,&b.programs[0].program);
        assert!(notes.iter().any(|n|n.code=="N_SEARCH_OPEN"),"{predicate}: {notes:?}");
        for note in notes {
            assert!(note.rewrite.contains("last 3 by .sent"),"{note:?}");
            let fixed=compile(&format!("{SCHEMA}\nquery fixed(needle: text <=100, position: cursor ?):\n  {}\n",note.rewrite));
            assert!(classify(&fixed.schema,&fixed.programs[0].program).is_empty(),"{note:?}");
        }
    }
}

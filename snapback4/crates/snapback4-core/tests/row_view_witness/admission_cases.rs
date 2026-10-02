use snapback4_core::{Schema, Value, ir::*, schema::{Audience, Constraint, Index, RuleExpr, RuleTerm, Sync}};
pub fn base() -> (Schema, Vec<Program>) {
    let source=include_str!("schema.q").replace("PREDICATE","exists unread[member = .member, value = 0]").replace("MEMBER_EXPIRY","");
    let b=snapback4_lang::compile(&[("schema.q".into(),source)]);
    assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);
    (b.schema,b.programs.into_iter().map(|p|p.program).collect())
}
pub fn cases() -> Vec<(String, Schema, Vec<Program>)> {
    let (base,programs)=base(); let mut out=vec![];
    let mut fields=vec![("unread".to_string(),"recountPending".to_string()),("unread".into(),"pending".into())];
    for table in ["$basis:unread","$recount:unread"] {
        for field in base.tables[table].columns.keys() {
            fields.push((table.into(),field.clone()));
            // Neither an unknown direct field nor a shadowed copy may reach a predicate.
            if field!="id" { fields.push(("unread".into(),field.clone())); }
        }
    }
    fields.push(("unread".into(),"$private".into()));
    fields.sort();fields.dedup();
    for (table,field) in fields {
        for effect in 0..4 {
            let mut schema=base.clone();
            let rule=RuleExpr::Exists { table:table.clone(),index:"byId".into(),key:vec![RuleTerm::Literal(Value::Id("u".into()))],
                provenance:KeyProvenance::Const,equalities:vec![(field.clone(),RuleTerm::Literal(Value::Null))] };
            let rules=&mut schema.tables.get_mut("gates").unwrap().rules;
            *match effect {0=>&mut rules.read,1=>&mut rules.insert,2=>&mut rules.update,_=>&mut rules.delete}=rule;
            out.push((format!("{table}.{field}/effect{effect}/through2"),schema,programs.clone()));
        }
        let mut schema=base.clone();
        schema.tables.get_mut(&table).unwrap().sync=Some(Sync {audience:Audience::Column(field.clone()),horizon:None});
        // Private work tables are excluded from visible table traversal; their
        // audience may instead be named by a visible target's delivery declaration.
        if table!="unread" {
            schema.tables.get_mut("gates").unwrap().sync=Some(Sync {audience:Audience::Target {table:table.clone(),prefix:vec![],principal:field.clone()},horizon:None});
        }
        out.push((format!("{table}.{field}/sync"),schema,programs.clone()));
        if table == "unread" {
            let mut indexed = base.clone();
            indexed.tables.get_mut(&table).unwrap().indexes.insert("byState".into(), Index::of(&[&field], false));
            out.push((format!("{table}.{field}/index"), indexed, programs.clone()));
            let mut constrained = base.clone();
            constrained.tables.get_mut(&table).unwrap().constraints.push(Constraint::Immutable { fields: vec![field.clone()] });
            out.push((format!("{table}.{field}/constraint"), constrained, programs.clone()));
        }
        let row=Expr::Get(Read {site:"probe".into(),table:table.clone(),index:"byId".into(),key:vec![Expr::Literal(Value::Id("u".into()))],provenance:KeyProvenance::Const});
        let status=field_expr(row.clone(),&field);
        let compare=|e| Expr::Binary {op:BinaryOp::Eq,left:Box::new(e),right:Box::new(Expr::Literal(Value::Null))};
        let mut bodies=vec![
            vec![Stmt::Return(compare(status.clone()))],
            vec![Stmt::Const {name:"row".into(),value:row.clone()},Stmt::Const {name:"alias".into(),value:field_expr(Expr::Variable("row".into()),&field)},Stmt::Require {condition:Expr::Variable("alias".into()),code:"NO".into(),site:None}],
            vec![Stmt::Return(Expr::Block {body:vec![Stmt::Const {name:"helper".into(),value:status.clone()}],value:Box::new(compare(Expr::Variable("helper".into())))})],
            vec![Stmt::Return(compare(Expr::Block {body:vec![Stmt::Return(status.clone())],value:Box::new(Expr::Literal(Value::Null))}))],
            vec![Stmt::If {condition:status.clone(),then_body:vec![],else_body:vec![]}],
            vec![Stmt::Return(compare(Expr::Builtin {builtin:Builtin::OptionalField {field:field.clone()},args:vec![row.clone()]}))],
        ];
        let boxed = Expr::Object([("value".into(), row.clone())].into());
        let unboxed = field_expr(boxed.clone(), "value");
        bodies.extend([
            vec![Stmt::If { condition: field_expr(unboxed.clone(), &field), then_body: vec![], else_body: vec![] }],
            vec![Stmt::Const { name:"box".into(), value:boxed }, Stmt::Return(compare(field_expr(field_expr(Expr::Variable("box".into()), "value"), &field)))],
            vec![Stmt::Return(Expr::Block { body: vec![Stmt::Return(field_expr(unboxed.clone(), &field))], value:Box::new(Expr::Literal(Value::Null)) })],
            vec![Stmt::Return(Expr::Block { body: vec![], value:Box::new(field_expr(unboxed.clone(), &field)) })],
            vec![Stmt::Return(Expr::Builtin { builtin:Builtin::First, args:vec![Expr::Builtin { builtin:Builtin::Sort { keys:vec![SortKey {field:field.clone(),order:Order::Asc,optional:true}] }, args:vec![field_expr(Expr::Object([("value".into(),Expr::Array(vec![row.clone()]))].into()), "value")] }] })],
            vec![Stmt::Let {name:"projected".into(),value:Expr::Array(vec![])}, Stmt::For {binding:"item".into(),domain:LoopDomain::DerivedArray {value:Expr::Array(vec![row.clone()]),max:1,bound_source:"test".into()},body:vec![Stmt::Push {target:"projected".into(),value:Expr::Object([("value".into(),Expr::Variable("item".into()))].into())}]}, Stmt::Return(compare(field_expr(field_expr(Expr::Builtin {builtin:Builtin::First,args:vec![Expr::Variable("projected".into())]},"value"),&field)))],
            // Even an unused read, scalar alias returned directly, mutation
            // result or helper-local data projection has no output permission.
            vec![Stmt::Const { name:"unused".into(), value:field_expr(unboxed, &field) }, Stmt::Return(Expr::Literal(Value::Null))],
        ]);
        for (n,body) in bodies.into_iter().enumerate() {
            let mut program=programs[0].clone();program.body=body;
            out.push((format!("{table}.{field}/query{n}"),base.clone(),vec![program]));
        }
    }
    // Whole-value comparison/order must not implicitly inspect the status
    // fields of a nested row. No scalar taint is needed: its type is still Row.
    let row=Expr::Get(Read {site:"whole".into(),table:"unread".into(),index:"byId".into(),key:vec![Expr::Literal(Value::Id("u".into()))],provenance:KeyProvenance::Const});
    for (name, expr) in [
        ("whole-row-equality", Expr::Binary {op:BinaryOp::Eq,left:Box::new(row.clone()),right:Box::new(row.clone())}),
        ("nested-row-order", Expr::Builtin {builtin:Builtin::Sort {keys:vec![SortKey {field:"value".into(),order:Order::Asc,optional:false}]},args:vec![Expr::Array(vec![Expr::Object([("value".into(),row)].into())])]}),
    ] {
        let mut program=programs[0].clone(); program.body=vec![Stmt::Return(expr)];
        out.push((name.into(),base.clone(),vec![program]));
    }
    // Every inspecting builtin, including compiler-only primitives and text
    // conversion. These feed the shared six-boundary server/device matrix.
    let row = Expr::Get(Read { site:"builtin".into(), table:"unread".into(), index:"byId".into(), key:vec![Expr::Literal(Value::Id("u".into()))], provenance:KeyProvenance::Const });
    let nested = Expr::Object([("nested".into(), row.clone())].into());
    let list = Expr::Array(vec![nested.clone()]);
    for builtin in [Builtin::ProjectFields {table:"unread".into()}, Builtin::ReceiptSettled {table:"unread".into()},
        Builtin::Calendar {millis:1}, Builtin::Lower, Builtin::Trim, Builtin::Sha256, Builtin::Join,
        Builtin::Group {field:"nested".into(),optional:false}, Builtin::Min, Builtin::Max,
        Builtin::Extremum {field:"nested".into(),max:false,domain:false}, Builtin::ExtremumOf {max:true,domain:false},
        Builtin::Divmod {remainder_sink:"r".into()}, Builtin::Sort {keys:vec![SortKey {field:"nested".into(),order:Order::Asc,optional:false}]},
        Builtin::MentionTokens, Builtin::SearchPresent, Builtin::DeterministicShare, Builtin::Sum, Builtin::Connected] {
        for slot in 0..builtin.arity() {
            let mut args = vec![Expr::Literal(Value::Int(1)); builtin.arity()];
            args[slot] = list.clone();
            let mut program=programs[0].clone();
            program.body=vec![Stmt::Return(Expr::Builtin {builtin:builtin.clone(),args})];
            out.push((format!("inspecting/{builtin:?}/arg{slot}"),base.clone(),vec![program]));
        }
    }
    for (name,expr) in [
        ("concat-json-right", Expr::Builtin {builtin:Builtin::Concat,args:vec![Expr::Literal(Value::String("".into())),nested.clone()]}),
        ("concat-json-left", Expr::Builtin {builtin:Builtin::Concat,args:vec![list.clone(),Expr::Literal(Value::String("".into()))]}),
        ("len-row-metadata", Expr::Builtin {builtin:Builtin::Len,args:vec![row.clone()]}),
        ("at-index", Expr::Builtin {builtin:Builtin::At,args:vec![list.clone(),row.clone()]}),
        ("slice-start", Expr::Builtin {builtin:Builtin::Slice,args:vec![list.clone(),row.clone(),Expr::Literal(Value::Int(1))]}),
        ("slice-end", Expr::Builtin {builtin:Builtin::Slice,args:vec![list.clone(),Expr::Literal(Value::Int(0)),row.clone()]}),
        ("ordering-null", Expr::Binary {op:BinaryOp::Lt,left:Box::new(row.clone()),right:Box::new(Expr::Literal(Value::Null))}),
    ] {
        let mut program=programs[0].clone();program.body=vec![Stmt::Return(expr)];
        out.push((name.into(),base.clone(),vec![program]));
    }
    for (name,stmt) in [
        ("condition",Stmt::If {condition:row.clone(),then_body:vec![],else_body:vec![]}),
        ("require",Stmt::Require {condition:row.clone(),code:"NO".into(),site:None}),
        ("insert",Stmt::Insert {table:"gates".into(),row:nested.clone()}),
        ("emit",Stmt::Emit {effect:"probe".into(),payload:nested,once:None}),
    ] {
        let mut program=programs[0].clone();program.body=vec![stmt];
        out.push((format!("consuming/{name}"),base.clone(),vec![program]));
    }
    let scan = match &programs.iter().find(|p| p.name == "rows").unwrap().body[0] {
        Stmt::Return(Expr::Scan(scan)) => scan.clone(), other => panic!("rows scan: {other:?}"),
    };
    for order in [false,true] {
        let merge = Expr::Merge(Merge { position:None,view:None,order_keys:if order {vec!["nested".into()]} else {vec![]},site:"whole-value-set".into(),variant:None,
            lanes:vec![MergeLane {guard:None,distinct:if order {None} else {Some(Expr::Variable("item".into()))},branch:None,
                project:Some(Expr::Object([("nested".into(),row.clone())].into())),setup:vec![],scan:scan.clone(),
                source:Some(LaneSource::List {value:Expr::Array(vec![row.clone()]),max:1}),binding:"item".into()}] });
        let mut program=programs[0].clone();program.body=vec![Stmt::Return(merge)];
        out.push((format!("merge/{}",if order {"whole-value-order"} else {"distinct-json-key"}),base.clone(),vec![program]));
    }
    // Generated nested structural types: every wrapper must survive until the
    // leaf access, including helper Block results and element-selection calls.
    for seed in [7u64, 20261002, 0xdeadbeef, 0x5eed] {
        let mut random = seed;
        for case in 0..24 {
            let mut value = Expr::Get(Read {site:"generated".into(),table:"unread".into(),index:"byId".into(),key:vec![Expr::Literal(Value::Id("u".into()))],provenance:KeyProvenance::Const});
            for _ in 0..4 {
                random ^= random << 13; random ^= random >> 7; random ^= random << 17;
                value = match random % 4 {
                    0 => field_expr(Expr::Object([("value".into(),value)].into()), "value"),
                    1 => Expr::Builtin {builtin:Builtin::First,args:vec![Expr::Array(vec![value])]},
                    2 => Expr::Block {body:vec![],value:Box::new(value)},
                    _ => field_expr(Expr::Shape {base:Box::new(value.clone()),fields:[("value".into(),value)].into()},"value"),
                };
            }
            for field in ["recountPending","pending","total","$private"] {
                let mut program=programs[0].clone();
                program.body=vec![Stmt::If {condition:field_expr(value.clone(),field),then_body:vec![],else_body:vec![]}];
                out.push((format!("generated/{seed}/{case}/{field}"),base.clone(),vec![program]));
            }
        }
    }
    assert_eq!(out.len(), 803, "retain the complete round-7 matrix");
    // Round 8: captures, reset assignments and consumers surround conditional
    // loop transfers. The generated raw IR exercises all six native boundaries.
    for seed in [7u64, 20261002, 0xdeadbeef, 0x5eed] {
        let mut random = seed;
        for case in 0..12 {
            random ^= random << 13; random ^= random >> 7; random ^= random << 17;
            for (transfer_name, transfer) in [("break", Stmt::Break), ("continue", Stmt::Continue)] {
                let captured = match random % 3 {
                    0 => var("item"),
                    1 => field_expr(Expr::Object([("nested".into(), var("item"))].into()), "nested"),
                    _ => Expr::Block { body: vec![Stmt::Let { name: "helper".into(), value: var("item") }], value: Box::new(var("helper")) },
                };
                let assign = Stmt::Assign { name:"saved".into(), value: captured };
                let reset = Stmt::Assign { name:"saved".into(), value: Expr::Literal(Value::Null) };
                let condition = || Expr::Input(Input::Viewer);
                let body = if random & 1 == 0 {
                    vec![Stmt::If { condition: condition(), then_body: vec![assign, transfer], else_body: vec![] }, reset]
                } else {
                    vec![assign, Stmt::If { condition: condition(), then_body: vec![transfer], else_body: vec![] },
                        Stmt::If { condition: condition(), then_body: vec![], else_body: vec![reset] }]
                };
                let consumer = match random % 4 {
                    0 => Expr::Builtin { builtin: Builtin::Max, args: vec![var("chosen"), var("chosen")] },
                    1 => Expr::Builtin { builtin: Builtin::DeterministicShare, args: vec![Expr::Literal(Value::Int(1)), Expr::Array(vec![var("chosen")]), var("chosen")] },
                    2 => Expr::Builtin { builtin: Builtin::Sort { keys: vec![SortKey { field: "id".into(), order: Order::Asc, optional: false }] }, args: vec![Expr::Array(vec![var("chosen")])] },
                    _ => Expr::Binary { op: BinaryOp::Eq, left: Box::new(var("chosen")), right: Box::new(var("chosen")) },
                };
                for kind in [ProgramKind::Query, ProgramKind::Mutation] {
                    let mut program = programs[0].clone(); program.kind = kind;
                    program.body = vec![Stmt::Let { name: "saved".into(), value: Expr::Literal(Value::Null) },
                        Stmt::For { binding:"item".into(), domain:LoopDomain::Page(scan.clone()), body:body.clone() },
                        Stmt::Let { name:"chosen".into(), value:var("saved") }, Stmt::Return(consumer.clone())];
                    out.push((format!("control/{seed}/{case}/{transfer_name}/{kind:?}"), base.clone(), vec![program]));
                }
            }
        }
    }
    // Contextual row names cannot hide raw assignments made inside a block.
    for focal in ["$filter", "$project"] {
        let overwrite = Expr::Block { body: vec![Stmt::Assign { name:focal.into(), value:row.clone() }],
            value:Box::new(Expr::Builtin { builtin:Builtin::Max, args:vec![var(focal), var(focal)] }) };
        let mut ordinary = scan.clone(); ordinary.table = "messages".into();
        let expr = if focal == "$filter" {
            ordinary.filter = Some(Box::new(overwrite)); Expr::Scan(ordinary)
        } else {
            Expr::Merge(Merge { position:None,view:None,order_keys:vec![],site:"focal-capture".into(),variant:None,
                lanes:vec![MergeLane {guard:None,distinct:None,branch:None,project:Some(overwrite),setup:vec![],scan:ordinary,source:None,binding:"lane".into()}] })
        };
        let mut program = programs[0].clone(); program.body = vec![Stmt::Return(expr)];
        out.push((format!("control/assigned-{focal}"), base.clone(), vec![program]));
    }
    assert_eq!(out.len(), 997, "retain the complete round-8 matrix");
    // Job scopes share outer slots; embedded queries keep independent locals,
    // internal computation permissions, and the structural type of their result.
    for all in [false, true] {
        let mut query = programs[0].clone(); query.name = "embedded".into();
        query.body = vec![Stmt::Return(if all { Expr::Array(vec![row.clone()]) } else { row.clone() })];
        let call = Expr::Builtin { builtin: Builtin::JobQuery { program: Box::new(query.clone()), cursor:None, all }, args:vec![Expr::Object(Default::default())] };
        let result = if all { Expr::Builtin {builtin:Builtin::First,args:vec![call]} } else { field_expr(call,"data") };
        let scope = |body| Expr::Builtin { builtin:Builtin::JobAs, args:vec![Expr::Literal(Value::Id("reader".into())), Expr::Block {body,value:Box::new(Expr::Literal(Value::Null))}] };
        for reset in [false,true] {
            let mut program = programs[0].clone(); program.kind = ProgramKind::Job;
            program.body = vec![Stmt::Let {name:"carried".into(),value:Expr::Literal(Value::Null)},
                Stmt::Let {name:"scope".into(),value:scope(vec![Stmt::Assign {name:"carried".into(),value:result.clone()}])}];
            if reset { program.body.push(Stmt::Assign {name:"carried".into(),value:Expr::Literal(Value::Null)}); }
            program.body.push(Stmt::Return(Expr::Builtin {builtin:Builtin::Max,args:vec![var("carried"),var("carried")]}));
            out.push((format!("job/captured-query/all={all}/reset={reset}"),base.clone(),vec![program]));
        }
        // A query is not exempt from validation merely because it is embedded.
        query.body = vec![Stmt::Return(Expr::Builtin {builtin:Builtin::Max,args:vec![row.clone(),row.clone()]})];
        let call = Expr::Builtin {builtin:Builtin::JobQuery {program:Box::new(query),cursor:None,all},args:vec![Expr::Object(Default::default())]};
        let mut program=programs[0].clone(); program.kind=ProgramKind::Job;
        program.body=vec![Stmt::Let {name:"scope".into(),value:scope(vec![Stmt::Let {name:"unused".into(),value:call}])}];
        out.push((format!("job/embedded-inspection/all={all}"),base.clone(),vec![program]));
        let mut query=programs[0].clone(); query.name="status".into();
        let status=field_expr(row.clone(),"recountPending");
        query.body=vec![Stmt::Return(if all {Expr::Array(vec![status])} else {status})];
        let call=Expr::Builtin {builtin:Builtin::JobQuery {program:Box::new(query),cursor:None,all},args:vec![Expr::Object(Default::default())]};
        let mut program=programs[0].clone(); program.kind=ProgramKind::Job;
        program.body=vec![Stmt::Let {name:"scope".into(),value:scope(vec![Stmt::Let {name:"unused".into(),value:call}])}];
        out.push((format!("job/embedded-status/all={all}"),base.clone(),vec![program]));
    }
    out
}
fn field_expr(base: Expr,name: &str) -> Expr { Expr::Field {base:Box::new(base),name:name.into()} }

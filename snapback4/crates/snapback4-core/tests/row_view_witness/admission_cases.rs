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
    out
}
fn field_expr(base: Expr,name: &str) -> Expr { Expr::Field {base:Box::new(base),name:name.into()} }

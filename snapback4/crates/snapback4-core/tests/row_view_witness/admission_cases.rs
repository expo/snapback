use snapback4_core::{Schema, Value, ir::*, schema::{Audience, RuleExpr, RuleTerm, Sync}};
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
        let row=Expr::Get(Read {site:"probe".into(),table:table.clone(),index:"byId".into(),key:vec![Expr::Literal(Value::Id("u".into()))],provenance:KeyProvenance::Const});
        let status=field_expr(row.clone(),&field);
        let compare=|e| Expr::Binary {op:BinaryOp::Eq,left:Box::new(e),right:Box::new(Expr::Literal(Value::Null))};
        let bodies=vec![
            vec![Stmt::Return(compare(status.clone()))],
            vec![Stmt::Const {name:"row".into(),value:row.clone()},Stmt::Const {name:"alias".into(),value:field_expr(Expr::Variable("row".into()),&field)},Stmt::Require {condition:Expr::Variable("alias".into()),code:"NO".into(),site:None}],
            vec![Stmt::Return(Expr::Block {body:vec![Stmt::Const {name:"helper".into(),value:status.clone()}],value:Box::new(compare(Expr::Variable("helper".into())))})],
            vec![Stmt::Return(compare(Expr::Block {body:vec![Stmt::Return(status.clone())],value:Box::new(Expr::Literal(Value::Null))}))],
            vec![Stmt::If {condition:status.clone(),then_body:vec![],else_body:vec![]}],
            vec![Stmt::Return(compare(Expr::Builtin {builtin:Builtin::OptionalField {field:field.clone()},args:vec![row]}))],
        ];
        for (n,body) in bodies.into_iter().enumerate() {
            let mut program=programs[0].clone();program.body=body;
            out.push((format!("{table}.{field}/query{n}"),base.clone(),vec![program]));
        }
    }
    out
}
fn field_expr(base: Expr,name: &str) -> Expr { Expr::Field {base:Box::new(base),name:name.into()} }

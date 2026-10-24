//! Candidate contracts from authored change guards and inspected approval data.
// @ref LLP 3000.036.004.000#5-derived-campaigns-and-production-deployment — inferred candidates require ordinary replay, never a proof claim.
use super::*;
mod workflow;

// A complex operand may inspect positive evidence before producing null.
// Only a plain row-field access can establish a pure absence precondition.
fn plain_row(expression:&ast::Expr)->bool {match expression {
    ast::Expr::Name{..}|ast::Expr::Focal{..}=>true,
    ast::Expr::Assert{value,..}=>plain_row(value),
    ast::Expr::Read(read)=>read.computed.is_empty()&&read.seeks.is_empty()&&read.filter.is_none()&&read.range.is_none()&&read.matching.is_none()
        &&read.keys.iter().all(|key|matches!(key.value,ast::Expr::Name{..}|ast::Expr::Literal{..})),
    _=>false,
}}
fn same_resource(base:&ast::Expr,table:&str,keys:&[ast::KeyPart],p:&ast::ProgramDecl)->bool{match base{
    ast::Expr::Assert{value,..}=>same_resource(value,table,keys,p),
    ast::Expr::Read(read)=>read.table==table&&read.keys.len()==keys.len()&&read.keys.iter().zip(keys).all(|(a,b)|{let typed=|key:&ast::KeyPart|key.column.clone().or_else(||if matches!(&key.value,ast::Expr::Name{name,..} if p.args.iter().any(|a|a.name==*name&&matches!(&a.type_.kind,ast::TypeKind::Ref{table:t} if t==table))){Some("id".into())}else{None});typed(a)==typed(b)&&crate::print::expression(&a.value)==crate::print::expression(&b.value)}),_=>false,
}}
fn plain_field(expression:&ast::Expr)->bool {
    matches!(expression,ast::Expr::Member{base,..} if plain_row(base))
}

fn omit_preconditions(expression:&mut ast::Expr,negated:bool){
    match expression {
        ast::Expr::Unary{op,value,..} if op=="not"=>omit_preconditions(value,!negated),
        ast::Expr::Binary{op,left,right,..} if matches!(op.as_str(),"and"|"or")=>{
            omit_preconditions(left,negated);omit_preconditions(right,negated);
        },
        ast::Expr::Binary{op,left,right,site}=>{
            let null=|e:&ast::Expr|matches!(e,ast::Expr::Literal{value:ast::Literal::Null,..});
            let stage=|field:&ast::Expr,value:&ast::Expr|plain_field(field)&&matches!(field,ast::Expr::Member{name,..} if matches!(name.as_str(),"stage"|"status"|"phase"|"state"))&&matches!(value,ast::Expr::Literal{value:ast::Literal::Str(_),..});
            let absence=(op=="="&&!negated||op=="!="&&negated)&&((null(left)&&plain_field(right))||(null(right)&&plain_field(left)));
            let discriminator=matches!(op.as_str(),"="|"!="|"<"|">"|"<="|">=")&&(stage(left,right)||stage(right,left));
            if absence||discriminator{*expression=ast::Expr::Literal{value:ast::Literal::Bool(true),site:site.clone()};}
        },
        // Unknown expression contexts retain every dependency. They do not
        // justify erasing a potentially positive evidence inspection.
        _=>{},
    }
}

/// A private effect candidate's left arm selects its destination on the next
/// image; the right arm is a prerequisite in the pre-effect transaction.
pub(super) fn transition(inv:&Invariant)->Option<(&ast::Expr,&ast::Expr)>{
    if !is_derived(inv)||inv.target!="update"||inv.column.is_none()||!["/sibling-approval/","/child-stage/"].iter().any(|label|inv.site.file.contains(label)){return None;}
    match inv.syntax.as_ref()?{ast::Expr::Binary{op,left,right,..} if op=="or"=>Some((left,right)),_=>None}
}
pub(super) fn approval_receipts(e:&ast::Expr)->Vec<ast::Expr>{workflow::approval_receipts(e)}
pub fn is_derived(inv:&Invariant)->bool { inv.site.file.starts_with("$derived/") }
fn add(out:&mut Vec<Invariant>,table:&str,column:&str,target:&str,policy:RuleExpr,site:&Site){
    if target=="write" {
        add(out,table,column,"insert",RuleExpr::Or(vec![RuleExpr::Eq(RuleTerm::Field(column.into()),RuleTerm::Literal(snapback4_core::Value::Null)),policy.clone()]),site);
        add(out,table,column,"update",policy,site);return;
    }
    use sha2::{Digest,Sha256};
    let identity=format!("{:x}",Sha256::digest(serde_json::to_vec(&policy).unwrap()));
    let site=Site::new(&format!("$derived/{}/{table}/{column}/{target}/{identity}",site.file),site.line,site.col);
    if out.iter().any(|i|i.site==site&&i.policy.as_ref()==Some(&policy)){return;}
    out.push(Invariant{table:table.into(),column:Some(column.into()),target:target.into(),predicate:policy.quarry(),policy:Some(policy),site,operation:None,requirements:Vec::new(),syntax:None,unsupported:None});
}
pub fn invariants(sources:&[(String,String)],bound:&Bound)->Vec<Invariant>{
    let docs=sources.iter().map(|(f,s)|crate::parse_document(f,s).0).collect::<Vec<_>>();
    let catalog=Catalog::build(docs.clone(),&mut Vec::new());
    let mut out=Vec::new();
    let mut controlled=BTreeSet::new();
    for p in docs.iter().flat_map(|d|&d.programs).filter(|p|p.kind==ast::ProgramKind::Mutation){for (write,_) in authority_walk::writes(&catalog,p){
        if let ast::Expr::Write{op:ast::WriteOp::Insert|ast::WriteOp::Upsert,table,fields,..}=write{for f in fields{if write_advice::supplied(&f,p){controlled.insert((table.clone(),f.name));}}}
    }}
    for t in docs.iter().flat_map(|d|&d.tables){
        let Some(table)=bound.schema.table(&t.name)else{continue;};
        for (column,guard) in write_advice::table_guards(&table.rules.update){
            if controlled.contains(&(t.name.clone(),column.clone()))&&!table.immutable_fields().any(|c|c==&column)&&!table.column_writes.contains_key(&column)&&!write_advice::update_only(bound,&t.name,&column,&guard){add(&mut out,&t.name,&column,"write",guard,&t.site);}
        }
    }
    for p in docs.iter().flat_map(|d|&d.programs).filter(|p|p.kind==ast::ProgramKind::Mutation){
        let plain=authority_walk::writes(&catalog,p);
        for (write,context) in &plain {
            let ast::Expr::Write{op:ast::WriteOp::Update,table,fields,site,..}=write else{continue;};
            let Some(info)=catalog.tables.get(table)else{continue;};
            let definition=&bound.schema.tables[table];
            // Guarded edits: only the additional, column-specific condition.
            for field in fields {
                if definition.column_writes.contains_key(&field.name)||definition.immutable_fields().any(|c|c==&field.name){continue;}
                let specialized=authority_walk::column_writes(&catalog,p,&field.name);
                let mut policies=Vec::new();let mut conditional=false;
                for ((candidate,specific),(_,base)) in specialized.iter().zip(&plain){
                    if !matches!(candidate,ast::Expr::Write{op:ast::WriteOp::Update,table:t,fields,..} if t==table&&fields.iter().any(|f|f.name==field.name)){continue;}
                    conditional|=specific.body.len()>base.body.len();
                    let guards=operation::requirements(&catalog,info,specific);
                    policies.push(RuleExpr::And(guards.into_iter().filter(operation::safe).collect()));
                }
                let guard=RuleExpr::Or(policies);
                if conditional&&!write_advice::update_only(bound,table,&field.name,&guard){add(&mut out,table,&field.name,if controlled.contains(&(table.clone(),field.name.clone())){"write"}else{"update"},guard,site);}
            }
            // Approval candidates keep their inferred origin explicit. Only
            // values inspected by this approval (or media governed by its
            // stored approval timestamp) are proposed for freezing.
            let mut inspected=BTreeSet::new();
            for statement in &context.body {if let ast::Stmt::Require{condition,..}=statement {
                let mut e=condition.clone();
                // Absence and stage checks admit the transition; they do not
                // assert that the current value is evidence being approved.
                omit_preconditions(&mut e,false);
                super::super::intent_walk::expression(&mut e,&mut |e|if let ast::Expr::Member{base,name,..}=e {
                    if same_resource(base,table,match write{ast::Expr::Write{keys,..}=>keys,_=>unreachable!()},p){inspected.insert(name.clone());}
                });
            }}
            for approval in fields.iter().filter(|f|["approv","authoriz"].iter().any(|s|f.name.to_lowercase().contains(s))){
                let Some(kind)=definition.columns.get(&approval.name)else{continue;};
                let condition=match (kind.required(),approval.value.as_ref()) {
                    (snapback4_core::schema::ColumnType::Bool,Some(ast::Expr::Literal{value:ast::Literal::Bool(true),..}))=>RuleExpr::Ne(RuleTerm::Field(approval.name.clone()),RuleTerm::Literal(snapback4_core::Value::Bool(true))),
                    (snapback4_core::schema::ColumnType::Time,Some(value)) if super::creation_advice::approval_recording(kind,Some(value))=>RuleExpr::Eq(RuleTerm::Field(approval.name.clone()),RuleTerm::Literal(snapback4_core::Value::Null)),
                    _=>continue,
                };
                // A derived approve/edit contract concerns approval retained
                // across the edit. Deliberate invalidation is not a bypass.
                let paired=match &condition {
                    RuleExpr::Eq(RuleTerm::Field(c),v)=>RuleExpr::Or(vec![RuleExpr::Eq(RuleTerm::OldField(c.clone()),v.clone()),RuleExpr::Eq(RuleTerm::NextField(c.clone()),v.clone())]),
                    RuleExpr::Ne(RuleTerm::Field(c),v)=>RuleExpr::Or(vec![RuleExpr::Ne(RuleTerm::OldField(c.clone()),v.clone()),RuleExpr::Ne(RuleTerm::NextField(c.clone()),v.clone())]),_=>unreachable!("generated approval condition"),
                };
                for (column,_kind) in &definition.columns {
                    if !inspected.contains(column){continue;}
                    if fields.iter().any(|f|&f.name==column)||definition.immutable_fields().any(|c|c==column)||definition.frozen_columns.contains_key(column){continue;}
                    if !bound.programs.iter().any(|p|snapback4_core::ir::write_tables(&p.program).iter().any(|(t,e)|t==table&&matches!(*e,"update"|"upsert"))){continue;}
                    if !write_advice::update_only(bound,table,column,&condition){add(&mut out,table,column,"update",paired.clone(),site);}
                }
            }
        }
    }
    workflow::invariants(&docs,&catalog,bound,&mut out);
    out
}
pub fn notes(sources:&[(String,String)],bound:&Bound)->Vec<Diagnostic>{
    invariants(sources,bound).into_iter().map(|i|{
        let transition=transition(&i).is_some();
        let workflow=["/sibling-approval/","/approval-history/","/repeat-create/","/parent-state/","/child-stage/"].iter().any(|label|i.site.file.contains(label));
        let message=if transition{format!("{}: inferred effect prerequisite {}; judge before entering the selected destination, permitting atomic approval consumption; a replayed violation needs a specification decision",i.target_label(),i.predicate)}else{format!("{}: derived candidate {} only {}; a replayed violation needs a specification decision",i.target_label(),i.target,i.predicate)};
        let repair=if workflow{"require the named approval/parent/child prerequisite before this governed effect, consume one-use guards atomically, or record this individual alternative path with check --ack-security ID --reason '<spec rationale>'"}else{"enforce column write/freeze authority, declare matching update-only creation intent, or record this individual rule's deliberate design with check --ack-security ID --reason '<spec rationale>'"};
        Diagnostic::new(&i.site,"N_DERIVED_WRITE_AUTHORITY",message,repair).guide("security")
    }).collect()
}
pub fn augmented(sources:&[(String,String)],bound:&Bound)->Bound{
    let mut out=bound.clone();out.invariants.extend(invariants(sources,bound));
    // Declared write audiences are runtime contracts, not inferred spec intent.
    // Their replay failures cannot be acknowledged as deliberate asymmetry.
    let mut contracts=Vec::new();
    for (table,t) in bound.schema.visible_tables(){for (column,policy) in &t.column_writes{
        add(&mut contracts,table,column,"write",policy.clone(),&Site::new("column-write-contract",1,1));
    }}
    for contract in &mut contracts{contract.site.file=contract.site.file.replacen("$derived/","$enforced/",1);}
    out.invariants.extend(contracts);out
}

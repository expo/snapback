//! Exact creator/resource custody for unused approval records.
// @ref LLP 3000.036.004.000#10-sec10-approvals-and-deterministic-exploration — an audit belongs to its actual decision; absence is not approval.
use super::*;
use super::lifecycle::{state,audience};
fn arg<'a>(value:&Expr,table:&str,p:&'a ast::ProgramDecl)->Option<&'a str>{super::super::derived::resource_argument(value,table,p).map(|arg|arg.name.as_str())}
fn parent_values<'a>(effect:&'a Write<'_>,parent:&str,bound:&Bound)->Vec<&'a Expr>{
    if effect.table==parent&&effect.op==WriteOp::Update{return effect.keys.iter().filter(|key|key.column.as_deref().is_none_or(|column|column=="id")).map(|key|&key.value).collect();}
    effect.fields.iter().filter(|field|matches!(bound.schema.tables[&effect.table].columns.get(&field.name).map(ColumnType::required),Some(ColumnType::Ref{table}) if table==parent)).filter_map(field_value).collect()
}
fn source_probe(condition:&Expr,negated:bool,name:&str,reference:&str,parent:&str,effect:&Write<'_>,bound:&Bound)->bool{
    let matching=|read:&ast::ReadExpr|read.table==name&&read.keys.iter().any(|key|key.column.as_deref()==Some(reference)&&parent_values(effect,parent,bound).iter().any(|target|arg(target,parent,effect.p).is_some_and(|selected|arg(&key.value,parent,effect.p)==Some(selected))));
    match condition{
        Expr::Unary{op,value,..} if op=="not"=>source_probe(value,!negated,name,reference,parent,effect,bound),
        Expr::Binary{op,left,right,..} if op=="and"||op=="or"=>source_probe(left,negated,name,reference,parent,effect,bound)||source_probe(right,negated,name,reference,parent,effect,bound),
        Expr::Exists{read,..}=>!negated&&matching(read),
        Expr::Binary{op,left,right,..}=>[(left.as_ref(),right.as_ref(),false),(right.as_ref(),left.as_ref(),true)].into_iter().any(|(count,number,reversed)|{
            let Expr::Call{name:call,args,..}=count else{return false;};if call!="count"||args.len()!=1{return false;}let Expr::Read(read)=&args[0]else{return false;};let Some(number)=duration_number(number)else{return false;};
            let op=match (op.as_str(),reversed){("<",true)=>">",("<=",true)=>">=",(">",true)=>"<",(">=",true)=>"<=",(op,_)=>op};
            let op=if negated{match op{"="=>"!=","!="=>"=","<"=>">=","<="=>">",">"=>"<=",">="=>"<",_=>return false}}else{op};
            matching(read)&&match op{"="=>number>0,"!="=>number==0,">"=>number>=0,">="=>number>=1,_=>false}
        }),_=>false,
    }
}
fn schema_probe(rule:&RuleExpr,negated:bool,name:&str,reference:&str,parent:&str,effect:&Write<'_>,bound:&Bound)->bool{match rule{
    RuleExpr::Not(rule)=>schema_probe(rule,!negated,name,reference,parent,effect,bound),
    RuleExpr::And(rules)|RuleExpr::Or(rules)=>rules.iter().any(|rule|schema_probe(rule,negated,name,reference,parent,effect,bound)),
    RuleExpr::Exists{table,index,key,equalities,..}|RuleExpr::Created{table,index,key,equalities,..} if !negated&&table==name=>super::super::privilege::probe_pairs(bound,table,index,key,equalities).iter().any(|(column,value)|column==reference&&match value{
        RuleTerm::Field(column)|RuleTerm::NextField(column)|RuleTerm::OldField(column)=>if effect.table==parent&&effect.op==WriteOp::Update{column=="id"}else{matches!(bound.schema.tables[&effect.table].columns.get(column).map(ColumnType::required),Some(ColumnType::Ref{table}) if table==parent)},
        RuleTerm::Reference{table,field,..}=>effect.table!=parent&&table==parent&&field=="id",_=>false,
    }),_=>false,
}}
fn enforced(effect:&Write<'_>,name:&str,reference:&str,parent:&str,bound:&Bound,negative:bool)->bool{
    if conditions(&effect.context).iter().any(|condition|source_probe(condition,negative,name,reference,parent,effect,bound)){return true;}
    let table=&bound.schema.tables[&effect.table];let row=if effect.op==WriteOp::Update{&table.rules.update}else{&table.rules.insert};
    if schema_probe(row,negative,name,reference,parent,effect,bound){return true;}
    effect.fields.iter().any(|field|{
        let needed=if effect.op==WriteOp::Update{matches!(field.name.as_str(),"stage"|"status"|"state"|"phase")&&matches!(table.columns.get(&field.name).map(ColumnType::required),Some(ColumnType::Enum{..}))}else{table.columns.get(&field.name).is_some_and(|kind|!kind.is_optional())};
        needed&&table.column_writes.get(&field.name).is_some_and(|rule|schema_probe(rule,negative,name,reference,parent,effect,bound))
    })
}
fn created(value:&Expr,parent:&str)->bool{match value{
    Expr::Assert{value,..}=>created(value,parent),Expr::Member{base,name,..} if name=="id"=>created(base,parent),
    Expr::Write{op:WriteOp::Insert,table,if_absent:false,condition:None,..}=>table==parent,
    Expr::If{then,otherwise,..}=>created(then,parent)&&created(otherwise,parent),_=>false,
}}
// An attached ancestor is provenance for an audited child decision, not a
// second independently approved resource. Keep the exact typed source row.
pub(super) fn origin(value:&Expr,p:&ast::ProgramDecl,bound:&Bound)->Option<(String,String,String)>{match value{
    Expr::Assert{value,..}=>origin(value,p,bound),
    Expr::Name{name,..}=>p.args.iter().find_map(|argument|if argument.name==*name&&let TypeKind::Ref{table}=&argument.type_.kind{Some((table.clone(),table.clone(),name.clone()))}else{None}),
    Expr::Read(read) if read.keys.len()==1&&read.keys[0].column.as_deref().is_none_or(|column|column=="id")&&read.filter.is_none()&&read.range.is_none()&&read.seeks.is_empty()&&read.matching.is_none()&&read.computed.is_empty()=>arg(&read.keys[0].value,&read.table,p).map(|arg|(read.table.clone(),read.table.clone(),arg.into())),
    Expr::Member{base,name,..}=>{let (table,root,selected)=origin(base,p,bound)?;if name=="id"{return Some((table,root,selected));}let ColumnType::Ref{table}=bound.schema.tables[&table].columns.get(name)?.required()else{return None;};Some((table.clone(),root,selected))},_=>None,
}}
fn possible_destination(value:&Expr,column:&str,destination:&str,write:&Write<'_>)->bool{match value{
    Expr::Literal{value:ast::Literal::Str(value),..}=>value==destination,
    Expr::If{then,otherwise,..}=>possible_destination(then,column,destination,write)||possible_destination(otherwise,column,destination,write),
    // Copying the old stage does not produce a new entry into that stage.
    Expr::Member{base,name,..} if name==column&&super::super::derived::same_resource(base,&write.table,&write.keys,write.p)=>false,_=>true,
}}
fn coupled(creator:&Write<'_>,reference:&str,parent:&str,writes:&[Write<'_>],bound:&Bound)->bool{
    let Some(value)=creator.fields.iter().find(|field|field.name==reference).and_then(field_value)else{return false;};
    let Some((target,root,selected))=origin(value,creator.p,bound)else{return false;};if target!=parent{return false;}
    let mut preceding=BTreeSet::new();let mut located=false;
    for statement in creator.p.prelude.iter().chain(&creator.p.body){
        let mut contains=false;let mut body=vec![statement.clone()];super::super::super::intent_walk::statements(&mut body,&mut |e|if e.site()==&creator.site{contains=true;});if contains{located=true;break;}
        if let Stmt::Expr{value,..}|Stmt::Bind{value,..}=statement&&let Expr::Write{op:WriteOp::Update,site,if_absent:false,condition:None,..}=value{preceding.insert(site.to_string());}
        if matches!(statement,Stmt::Return{..}){break;}
    }
    if !located{return false;}
    let writer=RuleExpr::And(vec![audience(&bound.schema.tables[&creator.table].rules.insert),audience(&creator.gate)]);
    writes.iter().filter(|write|std::ptr::eq(write.p,creator.p)&&write.table==root&&write.op==WriteOp::Update&&!write.conditional&&preceding.contains(&write.site.to_string())).any(|write|{
        if write.keys.len()!=1||write.keys[0].column.as_deref().is_some_and(|column|column!="id")||arg(&write.keys[0].value,&root,write.p)!=Some(&selected){return false;}
        if root!=target&&write.fields.iter().any(|field|matches!(bound.schema.tables[&root].columns.get(&field.name).map(ColumnType::required),Some(ColumnType::Ref{..}))){return false;}
        write.fields.iter().any(|field|{
            if !matches!(bound.schema.tables[&root].columns.get(&field.name).map(ColumnType::required),Some(ColumnType::Enum{..})){return false;}
            let Some(Expr::Literal{value:ast::Literal::Str(destination),..})=field_value(field)else{return false;};
            fn admits(expression:&Expr,write:&Write<'_>,column:&str,value:Option<&str>)->Option<bool>{match expression{
                Expr::Literal{value:ast::Literal::Bool(value),..}=>Some(*value),Expr::Unary{op,value:expression,..} if op=="not"=>admits(expression,write,column,value).map(|value|!value),
                Expr::Binary{op,left,right,..} if op=="and"||op=="or"=>{let a=admits(left,write,column,value);let b=admits(right,write,column,value);let decisive=op=="or";if a==Some(decisive)||b==Some(decisive){Some(decisive)}else if a.is_some()&&b.is_some(){Some(!decisive)}else{None}},
                Expr::Binary{op,left,right,..} if op=="="||op=="!="=>[(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())].iter().find_map(|(field,literal)|{
                    if !matches!(field,Expr::Member{base,name,..} if name==column&&super::super::derived::same_resource(base,&write.table,&write.keys,write.p)){return None;}
                    let expected=match literal{Expr::Literal{value:ast::Literal::Str(value),..}=>Some(value.as_str()),Expr::Literal{value:ast::Literal::Null,..}=>None,_=>return None};Some((value==expected)==(op=="="))
                }),_=>None,
            }}
            let kind=&bound.schema.tables[&root].columns[&field.name];let ColumnType::Enum{variants}=kind.required()else{return false;};let mut candidates=variants.iter().map(|value|Some(value.as_str())).collect::<Vec<_>>();if kind.is_optional(){candidates.push(None);}
            let no_op=!candidates.into_iter().any(|value|value!=Some(destination.as_str())&&conditions(&write.context).iter().all(|condition|admits(condition,write,&field.name,value)!=Some(false)));

            !no_op&&!writes.iter().any(|other|other.table==root&&matches!(other.op,WriteOp::Update|WriteOp::Upsert)&&other.fields.iter().find(|other|other.name==field.name).and_then(field_value).is_some_and(|value|possible_destination(value,&field.name,destination,other))&&kernel::implies(&audience(&other.gate),&writer)!=Ok(true))
        })
    })
}
pub(super) fn notes(bound:&Bound,writes:&[Write<'_>],out:&mut Vec<Diagnostic>){
    for (name,table) in bound.schema.visible_tables().filter(|(name,_)|["approv","authoriz"].iter().any(|part|name.to_lowercase().contains(part))){
        let creators=writes.iter().filter(|write|write.table==*name&&matches!(write.op,WriteOp::Insert|WriteOp::Upsert)).collect::<Vec<_>>();if creators.is_empty()||matches!(table.rules.insert,RuleExpr::Deny){continue;}
        for (reference,kind) in &table.columns{let ColumnType::Ref{table:parent}=kind.required()else{continue;};
            let effects=writes.iter().filter(|write|write.table!=*name&&(write.table==*parent&&state(write,bound)||matches!(write.op,WriteOp::Insert|WriteOp::Upsert)&&bound.schema.tables[&write.table].columns.values().any(|kind|matches!(kind.required(),ColumnType::Ref{table} if table==parent)))).collect::<Vec<_>>();
            if effects.iter().any(|effect|enforced(effect,name,reference,parent,bound,false)){continue;}
            for creator in &creators{let writer=RuleExpr::And(vec![audience(&table.rules.insert),audience(&creator.gate)]);if kernel::implies(&RuleExpr::Allow,&writer)==Ok(true)||kernel::implies(&writer,&RuleExpr::Deny)==Ok(true){continue;}
                if creator.fields.iter().find(|field|&field.name==reference).and_then(field_value).is_some_and(|value|created(value,parent))||coupled(creator,reference,parent,writes,bound){continue;}
                if effects.iter().any(|effect|kernel::implies(&audience(&effect.gate),&writer)!=Ok(true)&&!enforced(effect,name,reference,parent,bound,true)){note(out,&creator.site,"N_APPROVAL_NOT_ENFORCED",format!("{name}.{reference}: a separately authorized approval for {parent} is recorded but no effect requires it; is it informational?"),"require the matching approval row before the governed parent/child effect; or record `check --ack-security ID --reason 'informational approval record: <spec rationale>'`");}
            }
        }
    }
}

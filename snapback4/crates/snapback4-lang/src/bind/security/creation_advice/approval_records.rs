//! Exact creator/resource custody for unused approval records.
// @ref LLP 3000.036.004.000#10-sec10-approvals-and-deterministic-exploration — an audit belongs to its actual decision; absence is not approval.
use super::*;
use super::lifecycle::{state,audience};
fn arg<'a>(value:&Expr,table:&str,p:&'a ast::ProgramDecl)->Option<&'a str>{super::super::derived::resource_argument(value,table,p).map(|arg|arg.name.as_str())}
pub(super) fn pins(read:&ast::ReadExpr,p:&ast::ProgramDecl,bound:&Bound)->Vec<(String,Expr)>{
    let table=&bound.schema.tables[&read.table];
    let candidates=table.indexes.values().filter(|index|index.unique&&index.columns().len()==read.keys.len()&&read.index.as_ref().is_none_or(|name|table.index(name)==Some(*index))).filter(|index|read.keys.iter().zip(index.columns()).all(|(key,column)|{
        if let Some(name)=&key.column{return name==&column;}let Some(kind)=table.columns.get(&column)else{return false;};
        match &key.value{Expr::Name{name,..}=>p.args.iter().find(|arg|arg.name==*name).is_some_and(|arg|match (&arg.type_.kind,kind.required()){
            (TypeKind::Ref{table:a},ColumnType::Ref{table:b})=>a==b,(TypeKind::Ref{table:a},ColumnType::Id)=>a==&read.table,(TypeKind::Principal,ColumnType::Principal)=>true,_=>false}),_=>false}
    })).map(|index|index.columns()).collect::<BTreeSet<_>>();
    let positional=if candidates.len()==1{candidates.first()}else{None};
    let mut pins=read.keys.iter().enumerate().filter_map(|(i,key)|key.column.clone().or_else(||positional.and_then(|columns|columns.get(i)).cloned()).map(|column|(column,key.value.clone()))).collect::<Vec<_>>();
    if let Some(filter)=&read.filter{for clause in conjunction(filter){if let Expr::Binary{op,left,right,..}=clause&&op=="="{for (field,value) in [(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())]{if let Expr::Member{base,name,..}=field&&matches!(base.as_ref(),Expr::Focal{..}){pins.push((name.clone(),value.clone()));}}}}}pins
}
fn selected_read(effect:&Write<'_>)->ast::ReadExpr{ast::ReadExpr{cursor_prefix:None,computed:Default::default(),order_keys:Vec::new(),table:effect.table.clone(),keys:effect.keys.clone(),index:None,range:None,matching:None,filter:None,seeks:Vec::new(),site:effect.site.clone()}}
fn stored_value(effect:&Write<'_>,column:&str,old:bool,bound:&Bound)->Expr{
    if (!old||!matches!(effect.op,WriteOp::Update|WriteOp::Upsert))&&let Some(value)=effect.fields.iter().find(|field|field.name==column).and_then(field_value){return value.clone();}
    let read=selected_read(effect);if let Some((_,value))=pins(&read,effect.p,bound).into_iter().find(|(name,_)|name==column){return value;}
    Expr::Member{base:Box::new(Expr::Read(read)),name:column.into(),site:effect.site.clone()}
}
pub(super) fn parent_values(effect:&Write<'_>,parent:&str,bound:&Bound)->Vec<Expr>{
    let mut values=if effect.table==parent&&matches!(effect.op,WriteOp::Update|WriteOp::Upsert){effect.keys.iter().filter(|key|key.column.as_deref().is_none_or(|column|column=="id")).map(|key|key.value.clone()).collect::<Vec<_>>()}else{Vec::new()};
    values.extend(bound.schema.tables[&effect.table].columns.iter().filter(|(_,kind)|matches!(kind.required(),ColumnType::Ref{table} if table==parent)).filter(|(column,_)|matches!(effect.op,WriteOp::Update|WriteOp::Upsert)||effect.fields.iter().any(|field|&field.name==*column)).map(|(column,_)|stored_value(effect,column,false,bound)));values
}
// Resolve policy reference hops through the same actual stored parent links as
// source guards. A different same-typed path cannot discharge this parent.
pub(super) fn scoped_rule(rule:&RuleExpr,effect:&Write<'_>,parent:&str,bound:&Bound)->RuleExpr{
    let term=|term:&RuleTerm|{
        let Some((column,old))=term.reference_source()else{return term.clone();};let hops=term.references().collect::<Vec<_>>();
        let Some((owner,field))=hops.last()else{return term.clone();};
        let reference=matches!(bound.schema.tables[*owner].columns.get(*field).map(ColumnType::required),Some(ColumnType::Ref{table}) if table==parent);
        if *owner!=parent&&!reference{return term.clone();}
        let mut subject=stored_value(effect,column,old,bound);
        for (_,field) in hops.iter().take(hops.len().saturating_sub(if reference{0}else{1})){subject=Expr::Member{base:Box::new(subject),name:(*field).into(),site:effect.site.clone()};}
        if origin(&subject,effect.p,bound).is_some_and(|selected|parent_values(effect,parent,bound).iter().any(|value|origin(value,effect.p,bound)==Some(selected.clone()))){term.clone()}else{RuleTerm::Literal(snapback4_core::Value::Null)}
    };
    match rule{
        RuleExpr::And(parts)=>RuleExpr::And(parts.iter().map(|rule|scoped_rule(rule,effect,parent,bound)).collect()),RuleExpr::Or(parts)=>RuleExpr::Or(parts.iter().map(|rule|scoped_rule(rule,effect,parent,bound)).collect()),RuleExpr::Not(rule)=>RuleExpr::Not(Box::new(scoped_rule(rule,effect,parent,bound))),
        RuleExpr::Eq(a,b)=>RuleExpr::Eq(term(a),term(b)),RuleExpr::Ne(a,b)=>RuleExpr::Ne(term(a),term(b)),RuleExpr::Compare(op,a,b)=>RuleExpr::Compare(*op,term(a),term(b)),
        RuleExpr::Exists{table,index,key,equalities,provenance}=>RuleExpr::Exists{table:table.clone(),index:index.clone(),key:key.iter().map(term).collect(),equalities:equalities.iter().map(|(name,value)|(name.clone(),term(value))).collect(),provenance:*provenance},
        RuleExpr::Created{table,index,key,equalities,provenance}=>RuleExpr::Created{table:table.clone(),index:index.clone(),key:key.iter().map(term).collect(),equalities:equalities.iter().map(|(name,value)|(name.clone(),term(value))).collect(),provenance:*provenance},_=>rule.clone(),
    }
}
// A prerequisite for one literal approval kind cannot consume another kind.
// Unknown caller values remain conditional possibilities, not fabricated rows.
fn literal_value(value:&Expr,kind:&ColumnType,bound:&Bound)->Option<snapback4_core::Value>{
    let mut dynamic=false;walk(value,|e|if matches!(e,Expr::Name{..}|Expr::Read(_)|Expr::Exists{..}|Expr::Member{..}){dynamic=true;});if dynamic{return None;}
    let value=super::super::concrete::value(value,&snapback4_core::Value::Null,&BTreeMap::new(),&bound.schema,"","",0)?;
    Some(match (kind.required(),value){(ColumnType::Id|ColumnType::Principal|ColumnType::Ref{..},snapback4_core::Value::String(value))=>snapback4_core::Value::Id(value),(_,value)=>value})
}
fn creator_cell(creator:&Write<'_>,column:&str,bound:&Bound)->Option<snapback4_core::Value>{
    let table=&bound.schema.tables[&creator.table];let kind=table.columns.get(column)?;
    // Only possibly admitted, nontrivial writes can change a record's kind.
    let row_grant=table.update_rule_judged().into_owned();
    let cell_grant=table.column_writes.get(column).cloned().unwrap_or(RuleExpr::Allow);
    let unfrozen=table.frozen_columns.get(column).map(|rule|RuleExpr::Not(Box::new(rule.clone()))).unwrap_or(RuleExpr::Allow);
    let grant=RuleExpr::And(vec![row_grant,cell_grant,unfrozen]);
    if !table.immutable_fields().any(|field|field==column)&&kernel::implies(&grant,&RuleExpr::Deny)!=Ok(true){
        for program in creator.catalog.documents.iter().flat_map(|doc|&doc.programs).filter(|program|program.kind==ProgramKind::Mutation){
            for (write,context) in super::super::authority_walk::writes(creator.catalog,program){
                if !applicability_known(&context,creator.catalog){continue;}
                let Expr::Write{op:WriteOp::Update|WriteOp::Upsert,table:target,keys,fields,condition,..}=write else{continue;};if target!=creator.table{continue;}
                if condition.as_deref().is_some_and(|condition|matches!(simplify_boolean(condition),Expr::Literal{value:ast::Literal::Bool(false),..})){continue;}
                let Some(value)=fields.iter().find(|field|field.name==column).and_then(field_value)else{continue;};
                let mut copied=value;while let Expr::Assert{value,..}=copied{copied=value;}
                if matches!(copied,Expr::Member{base,name,..} if name==column&&super::super::derived::same_resource(base,&target,&keys,program)){continue;}
                if conditions(&context).iter().any(|condition|matches!(simplify_boolean(condition),Expr::Literal{value:ast::Literal::Bool(false),..})){continue;}
                let mut gates=super::super::operation::requirements(creator.catalog,&creator.catalog.tables[&target],&context);gates.push(grant.clone());
                if kernel::implies(&RuleExpr::And(gates),&RuleExpr::Deny)==Ok(true){continue;}
                let before=creator.fields.iter().find(|field|field.name==column).and_then(field_value).and_then(|value|literal_value(value,kind,bound)).or_else(||if creator.op==WriteOp::Insert{match table.defaults.get(column){Some(snapback4_core::schema::ColumnDefault::Literal(value))=>Some(value.clone()),_=>None}}else{None});
                if before.is_some()&&literal_value(value,kind,bound)==before{continue;}
                return None;
            }
        }
    }
    if let Some(value)=creator.fields.iter().find(|field|field.name==column).and_then(field_value){return literal_value(value,kind,bound);}
    if creator.op!=WriteOp::Insert{return None;}
    match table.defaults.get(column){Some(snapback4_core::schema::ColumnDefault::Literal(value))=>Some(value.clone()),None if kind.is_optional()=>Some(snapback4_core::Value::Null),_=>None}
}
fn source_compatible(read:&ast::ReadExpr,creator:&Write<'_>,reader:&ast::ProgramDecl,bound:&Bound)->bool{
    for (column,expected) in pins(read,reader,bound){if let Some(kind)=bound.schema.tables[&read.table].columns.get(&column)&&let (Some(actual),Some(expected))=(creator_cell(creator,&column,bound),literal_value(&expected,kind,bound))&&actual!=expected{return false;}}
    let Some(filter)=&read.filter else{return true;};let mut filter=filter.as_ref().clone();
    super::super::super::intent_walk::expression(&mut filter,&mut |e|if matches!(e,Expr::Name{..}|Expr::Read(_)|Expr::Exists{..}){*e=Expr::Name{name:"$advice_unknown_filter".into(),site:e.site().clone()};});
    let row=snapback4_core::Value::Map(bound.schema.tables[&creator.table].columns.keys().filter_map(|column|creator_cell(creator,column,bound).map(|value|(column.clone(),value))).collect());
    super::super::concrete::evaluate(&filter,&row,&BTreeMap::new(),&bound.schema,"",&creator.table,0)!=Some(false)
}
fn schema_compatible(table:&str,index:&str,key:&[RuleTerm],equalities:&[(String,RuleTerm)],creator:&Write<'_>,bound:&Bound)->bool{
    !super::super::privilege::probe_pairs(bound,table,index,key,equalities).iter().any(|(column,expected)|matches!(expected,RuleTerm::Literal(expected) if creator_cell(creator,column,bound).is_some_and(|actual|actual!=*expected)))
}
fn source_probe(condition:&Expr,negated:bool,name:&str,reference:&str,parent:&str,effect:&Write<'_>,bound:&Bound,creator:&Write<'_>)->bool{
    let matching=|read:&ast::ReadExpr|read.table==name&&source_compatible(read,creator,effect.p,bound)&&pins(read,effect.p,bound).iter().any(|(column,value)|column==reference&&parent_values(effect,parent,bound).iter().any(|target|origin(target,effect.p,bound).is_some_and(|selected|origin(value,effect.p,bound)==Some(selected))));
    match condition{
        Expr::Unary{op,value,..} if op=="not"=>source_probe(value,!negated,name,reference,parent,effect,bound,creator),
        Expr::Binary{op,left,right,..} if op=="and"||op=="or"=>source_probe(left,negated,name,reference,parent,effect,bound,creator)||source_probe(right,negated,name,reference,parent,effect,bound,creator),
        Expr::Exists{read,..}=>!negated&&matching(read),
        Expr::Binary{op,left,right,..}=>[(left.as_ref(),right.as_ref(),false),(right.as_ref(),left.as_ref(),true)].into_iter().any(|(count,number,reversed)|{
            let Expr::Call{name:call,args,..}=count else{return false;};if call!="count"||args.len()!=1{return false;}let Expr::Read(read)=&args[0]else{return false;};let Some(number)=duration_number(number)else{return false;};
            let op=match (op.as_str(),reversed){("<",true)=>">",("<=",true)=>">=",(">",true)=>"<",(">=",true)=>"<=",(op,_)=>op};
            let op=if negated{match op{"="=>"!=","!="=>"=","<"=>">=","<="=>">",">"=>"<=",">="=>"<",_=>return false}}else{op};
            matching(read)&&match op{"="=>number>0,"!="=>number==0,">"=>number>=0,">="=>number>=1,_=>false}
        }),_=>false,
    }
}
fn schema_probe(rule:&RuleExpr,negated:bool,name:&str,reference:&str,parent:&str,effect:&Write<'_>,bound:&Bound,creator:&Write<'_>)->bool{
    let simplified=simplify_rule(rule);let rule=&simplified;match rule{
    RuleExpr::Not(rule)=>schema_probe(rule,!negated,name,reference,parent,effect,bound,creator),
    RuleExpr::And(rules)|RuleExpr::Or(rules)=>rules.iter().any(|rule|schema_probe(rule,negated,name,reference,parent,effect,bound,creator)),
    RuleExpr::Exists{table,index,key,equalities,..}|RuleExpr::Created{table,index,key,equalities,..} if !negated&&table==name&&schema_compatible(table,index,key,equalities,creator,bound)=>super::super::privilege::probe_pairs(bound,table,index,key,equalities).iter().any(|(column,value)|column==reference&&match value{
        RuleTerm::Field(column)|RuleTerm::NextField(column)|RuleTerm::OldField(column)=>effect.table==parent&&matches!(effect.op,WriteOp::Update|WriteOp::Upsert)&&column=="id"||matches!(bound.schema.tables[&effect.table].columns.get(column).map(ColumnType::required),Some(ColumnType::Ref{table}) if table==parent),
        RuleTerm::Reference{table,field,..}=>table==parent&&field=="id"||matches!(bound.schema.tables[table].columns.get(field).map(ColumnType::required),Some(ColumnType::Ref{table}) if table==parent),RuleTerm::ReferenceChain{hops,..}=>hops.last().is_some_and(|hop|hop.table==parent&&hop.field=="id"||matches!(bound.schema.tables[&hop.table].columns.get(&hop.field).map(ColumnType::required),Some(ColumnType::Ref{table}) if table==parent)),_=>false,
    }),_=>false,
}}
fn enforced(effect:&Write<'_>,name:&str,reference:&str,parent:&str,bound:&Bound,negative:bool,creator:&Write<'_>)->bool{
    let conditions=effective_conditions(&effect.context,effect.catalog);if conditions.iter().any(|condition|matches!(condition,Expr::Literal{value:ast::Literal::Bool(false),..})){return false;}
    if conditions.iter().any(|condition|source_probe(condition,negative,name,reference,parent,effect,bound,creator)){return true;}
    let table=&bound.schema.tables[&effect.table];let row=if matches!(effect.op,WriteOp::Update|WriteOp::Upsert){&table.rules.update}else{&table.rules.insert};
    if schema_probe(&scoped_rule(row,effect,parent,bound),negative,name,reference,parent,effect,bound,creator){return true;}
    let changing=matches!(effect.op,WriteOp::Update|WriteOp::Upsert);
    let fields=effect.fields.iter().filter(|field|if changing{matches!(table.columns.get(&field.name).map(ColumnType::required),Some(ColumnType::Enum{..}))&&!matches!(field_value(field),Some(Expr::Member{base,name,..}) if name==&field.name&&super::super::derived::same_resource(base,&effect.table,&effect.keys,effect.p))}else{table.columns.get(&field.name).is_some_and(|kind|!kind.is_optional())}).collect::<Vec<_>>();
    let covers=|field:&&ast::ObjectField|table.column_writes.get(&field.name).is_some_and(|rule|schema_probe(&scoped_rule(rule,effect,parent,bound),negative,name,reference,parent,effect,bound,creator));
    if negative{!fields.is_empty()&&fields.iter().all(covers)}else{fields.iter().any(covers)}
}
pub(super) fn created(value:&Expr,parent:&str)->bool{let value=simplify_boolean(value);match &value{
    Expr::Assert{value,..}=>created(value,parent),Expr::Member{base,name,..} if name=="id"=>created(base,parent),
    Expr::Write{op:WriteOp::Insert,table,if_absent:false,condition:None,..}=>table==parent,
    Expr::If{then,otherwise,..}=>created(then,parent)&&created(otherwise,parent),
    Expr::Binary{op,left,..} if op=="??"=>created(left,parent),
    Expr::Call{name,args,..} if name=="first"&&args.len()==1=>matches!(&args[0],Expr::Array{items,..} if items.first().is_some_and(|value|created(value,parent))),_=>false,
}}
pub(super) fn fresh_reference(value:&Expr,context:&ast::ProgramDecl,p:&ast::ProgramDecl,catalog:&Catalog,parent:&str)->bool{let facts=context_facts(context,catalog).unwrap_or_default();created(&apply_facts(value,&facts,&caller_names(p)),parent)}
// An attached ancestor is provenance for an audited child decision, not a
// second independently approved resource. Keep the exact typed source row.
pub(super) fn origin(value:&Expr,p:&ast::ProgramDecl,bound:&Bound)->Option<(String,String,String,Vec<String>)>{match value{
    Expr::Assert{value,..}=>origin(value,p,bound),
    Expr::Name{name,..}=>p.args.iter().find_map(|argument|if argument.name==*name&&let TypeKind::Ref{table}=&argument.type_.kind{Some((table.clone(),table.clone(),name.clone(),Vec::new()))}else{None}),
    Expr::Read(read) if read.keys.len()==1&&read.keys[0].column.as_deref().is_none_or(|column|column=="id")&&read.filter.is_none()&&read.range.is_none()&&read.seeks.is_empty()&&read.matching.is_none()&&read.computed.is_empty()=>origin(&read.keys[0].value,p,bound).filter(|(table,_,_,_)|table==&read.table),
    Expr::Member{base,name,..}=>{
        let mut plain=base.as_ref();while let Expr::Assert{value,..}=plain{plain=value;}
        if let Expr::Read(read)=plain&&let Some((_,value))=pins(read,p,bound).into_iter().find(|(column,_)|column==name){return origin(&value,p,bound);}
        let (table,root,selected,mut path)=origin(base,p,bound)?;if name=="id"{return Some((table,root,selected,path));}let ColumnType::Ref{table}=bound.schema.tables[&table].columns.get(name)?.required()else{return None;};{path.push(name.clone());Some((table.clone(),root,selected,path))}},_=>None,
}}
fn possible_destination(value:&Expr,column:&str,destination:&str,write:&Write<'_>)->bool{match value{
    Expr::Literal{value:ast::Literal::Str(value),..}=>value==destination,
    Expr::If{then,otherwise,..}=>possible_destination(then,column,destination,write)||possible_destination(otherwise,column,destination,write),
    // Copying the old stage does not produce a new entry into that stage.
    Expr::Member{base,name,..} if name==column&&super::super::derived::same_resource(base,&write.table,&write.keys,write.p)=>false,_=>true,
}}
fn coupled(creator:&Write<'_>,reference:&str,parent:&str,writes:&[Write<'_>],bound:&Bound)->bool{
    let Some(value)=creator.fields.iter().find(|field|field.name==reference).and_then(field_value)else{return false;};
    let Some((target,root,selected,path))=origin(value,creator.p,bound)else{return false;};if target!=parent{return false;}
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
        let mut owner=root.clone();
        for reference in &path{
            if writes.iter().any(|other|std::ptr::eq(other.p,creator.p)&&other.table==owner&&other.fields.iter().any(|field|field.name==*reference&&!matches!(field_value(field),Some(Expr::Member{base,name,..}) if name==reference&&super::super::derived::same_resource(base,&other.table,&other.keys,other.p)))){return false;}
            let Some(ColumnType::Ref{table})=bound.schema.tables[&owner].columns.get(reference).map(ColumnType::required)else{return false;};owner=table.clone();
        }
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
fn canonical(value:&Expr)->String{crate::print::expression(value)}
fn inserted(value:&Expr)->Option<(&str,&[ast::ObjectField])>{match value{
    Expr::Assert{value,..}|Expr::Member{base:value,..}=>inserted(value),
    Expr::Write{op:WriteOp::Insert,table,fields,if_absent:false,condition:None,..}=>Some((table,fields)),_=>None,
}}
fn creation_audit(creator:&Write<'_>,reference:&str,parent:&str,bound:&Bound)->bool{
    let Some(value)=creator.fields.iter().find(|field|field.name==reference).and_then(field_value)else{return false;};
    creator.fields.iter().filter_map(field_value).filter_map(inserted).any(|(table,fields)|fields.iter().any(|field|matches!(bound.schema.tables[table].columns.get(&field.name).map(ColumnType::required),Some(ColumnType::Ref{table}) if table==parent)&&field_value(field).is_some_and(|linked|canonical(linked)==canonical(value))))
}
pub(super) fn coexec(guaranteed:&Write<'_>,observed:&Write<'_>)->bool{
    if guaranteed.conditional||!std::ptr::eq(guaranteed.p,observed.p){return false;}
    let branches=|write:&Write<'_>|write.context.body.iter().filter_map(|stmt|if let Stmt::Require{condition,code,site,..}=stmt&&(code=="$advice"||code.starts_with("$iteration:")){Some(format!("{code}:{}:{}",site,canonical(condition)))}else{None}).collect::<BTreeSet<_>>();
    branches(guaranteed).is_subset(&branches(observed))
}
// A manager's audit row may accompany a checked bool/time decision before OR
// after it. Matching branch paths and the same selected row are mandatory.
fn decision_mirror(creator:&Write<'_>,reference:&str,parent:&str,writes:&[Write<'_>],bound:&Bound)->bool{
    let Some(value)=creator.fields.iter().find(|field|field.name==reference).and_then(field_value)else{return false;};
    let branches=|write:&Write<'_>|write.context.body.iter().filter_map(|stmt|if let Stmt::Require{condition,code,site,..}=stmt&&(code=="$advice"||code.starts_with("$iteration:")){Some(format!("{code}:{}:{}",site,canonical(condition)))}else{None}).collect::<BTreeSet<_>>();
    let path=branches(creator);let creator_role=audience(&creator.gate);
    writes.iter().filter(|write|std::ptr::eq(write.p,creator.p)&&write.table==parent&&write.op==WriteOp::Update&&!write.conditional&&branches(write).is_subset(&path)&&coexec(write,creator)&&write.keys.len()==1&&canonical(&write.keys[0].value)==canonical(value)).any(|write|write.fields.iter().any(|field|{
        let Some(kind)=bound.schema.tables[parent].columns.get(&field.name)else{return false;};let Some(assigned)=field_value(field)else{return false;};
        let positive=matches!((kind.required(),assigned),(ColumnType::Bool,Expr::Literal{value:ast::Literal::Bool(true),..}))||matches!((kind.required(),assigned),(ColumnType::Time,Expr::Name{name,..}) if name=="now");
        positive&&writes.iter().any(|effect|super::lifecycle::scalar_enforced(effect,parent,&field.name,bound,false))&&!writes.iter().any(|other|other.table==parent&&matches!(other.op,WriteOp::Update|WriteOp::Upsert|WriteOp::Insert)&&other.fields.iter().find(|candidate|candidate.name==field.name).and_then(field_value).map(|value|!matches!(value,Expr::Literal{value:ast::Literal::Bool(false)|ast::Literal::Null,..})&&!matches!(value,Expr::Member{base,name,..} if name==&field.name&&super::super::derived::same_resource(base,parent,&other.keys,other.p))).unwrap_or_else(||matches!(other.op,WriteOp::Insert|WriteOp::Upsert)&&bound.schema.tables[parent].defaults.get(&field.name).is_some_and(|value|matches!(value.value(challenges::NOW,"$audit"),snapback4_core::Value::Bool(true)|snapback4_core::Value::Int(_))))&&kernel::implies(&audience(&other.gate),&creator_role)!=Ok(true))
    }))
}
fn audience_grant(name:&str,reference:&str,parent:&str,bound:&Bound,creator:&Write<'_>)->bool{
    fn probe(rule:&RuleExpr,name:&str,reference:&str,bound:&Bound,creator:&Write<'_>)->bool{match rule{
        RuleExpr::And(parts)|RuleExpr::Or(parts)=>parts.iter().any(|part|probe(part,name,reference,bound,creator)),
        RuleExpr::Exists{table,index,key,equalities,..} if table==name&&schema_compatible(table,index,key,equalities,creator,bound)=>{
            let pairs=super::super::privilege::probe_pairs(bound,table,index,key,equalities);
            pairs.iter().any(|(column,value)|column==reference&&*value==RuleTerm::Field("id".into()))&&pairs.iter().any(|(column,value)|*value==RuleTerm::Viewer&&matches!(bound.schema.tables[table].columns.get(column).map(ColumnType::required),Some(ColumnType::Principal)))
        },_=>false,
    }}probe(&simplify_rule(&bound.schema.tables[parent].rules.read),name,reference,bound,creator)
}
fn decision_provenance(creator:&Write<'_>,reference:&str,parent:&str,writes:&[Write<'_>],bound:&Bound)->bool{
    fn selected(value:&Expr)->Option<&ast::ReadExpr>{match value{Expr::Read(read)=>Some(read),Expr::Assert{value,..}|Expr::Member{base:value,..}=>selected(value),Expr::Call{name,args,..} if name=="first"&&args.len()==1=>selected(&args[0]),_=>None}}
    let Some(value)=creator.fields.iter().find(|field|field.name==reference).and_then(field_value)else{return false;};
    creator.fields.iter().filter(|field|field.name!=reference).any(|field|{
        let Some(ColumnType::Ref{table:child})=bound.schema.tables[&creator.table].columns.get(&field.name).map(ColumnType::required)else{return false;};let Some(read)=field_value(field).and_then(selected)else{return false;};if &read.table!=child{return false;}
        pins(read,creator.p,bound).iter().any(|(column,associated)|matches!(bound.schema.tables[child].columns.get(column).map(ColumnType::required),Some(ColumnType::Ref{table}) if table==parent)&&canonical(associated)==canonical(value))&&decision_mirror(creator,&field.name,child,writes,bound)
    })
}
pub(super) fn notes(bound:&Bound,writes:&[Write<'_>],out:&mut Vec<Diagnostic>){
    for (name,table) in bound.schema.visible_tables().filter(|(name,_)|["approv","authoriz"].iter().any(|part|name.to_lowercase().contains(part))){
        let creators=writes.iter().filter(|write|write.table==*name&&matches!(write.op,WriteOp::Insert|WriteOp::Upsert)).collect::<Vec<_>>();if creators.is_empty()||matches!(table.rules.insert,RuleExpr::Deny){continue;}
        for (reference,kind) in &table.columns{let ColumnType::Ref{table:parent}=kind.required()else{continue;};
            let effects=writes.iter().filter(|write|write.table!=*name&&(write.table==*parent&&state(write,bound)||state(write,bound)&&bound.schema.tables[&write.table].columns.values().any(|kind|matches!(kind.required(),ColumnType::Ref{table} if table==parent))||matches!(write.op,WriteOp::Insert|WriteOp::Upsert)&&bound.schema.tables[&write.table].columns.values().any(|kind|matches!(kind.required(),ColumnType::Ref{table} if table==parent)))).collect::<Vec<_>>();
            for creator in &creators{if audience_grant(name,reference,parent,bound,creator)||effects.iter().any(|effect|enforced(effect,name,reference,parent,bound,false,creator)){continue;}let writer=RuleExpr::And(vec![audience(&table.rules.insert),audience(&creator.gate)]);if kernel::implies(&RuleExpr::Allow,&writer)==Ok(true)||kernel::implies(&writer,&RuleExpr::Deny)==Ok(true){continue;}
                if creator.fields.iter().find(|field|&field.name==reference).and_then(field_value).is_some_and(|value|fresh_reference(value,&creator.context,creator.p,creator.catalog,parent))||coupled(creator,reference,parent,writes,bound)||creation_audit(creator,reference,parent,bound)||decision_mirror(creator,reference,parent,writes,bound)||decision_provenance(creator,reference,parent,writes,bound){continue;}
                if effects.iter().any(|effect|kernel::implies(&audience(&effect.gate),&writer)!=Ok(true)&&!enforced(effect,name,reference,parent,bound,true,creator)){note(out,&creator.site,"N_APPROVAL_NOT_ENFORCED",format!("{name}.{reference}: a separately authorized approval for {parent} is recorded but no effect requires it; is it informational?"),"require the matching approval row before the governed parent/child effect; or record `check --ack-security ID --reason 'informational approval record: <spec rationale>'`");}
            }
        }
    }
}

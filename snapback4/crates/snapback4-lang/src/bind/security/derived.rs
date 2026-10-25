//! Candidate contracts from authored change guards and inspected approval data.
// @ref LLP 3000.036.004.000#5-derived-campaigns-and-production-deployment — inferred candidates require ordinary replay, never a proof claim.
use super::*;
mod workflow;
mod approval_checks;
mod stamps;
pub(super) use stamps::named as named_approval;
pub(crate) use approval_checks::ApprovalCheck;
pub(super) use approval_checks::revalidated;

// A complex operand may inspect positive evidence before producing null.
// Only a plain row-field access can establish a pure absence precondition.
fn plain_row(expression:&ast::Expr)->bool {match expression {
    ast::Expr::Name{..}|ast::Expr::Focal{..}=>true,
    ast::Expr::Assert{value,..}=>plain_row(value),
    ast::Expr::Read(read)=>read.computed.is_empty()&&read.seeks.is_empty()&&read.filter.is_none()&&read.range.is_none()&&read.matching.is_none()
        &&read.keys.iter().all(|key|matches!(key.value,ast::Expr::Name{..}|ast::Expr::Literal{..})),
    _=>false,
}}
pub(super) fn resource_argument<'a>(expression:&ast::Expr,table:&str,p:&'a ast::ProgramDecl)->Option<&'a ast::ArgDecl>{match expression{
    ast::Expr::Assert{value,..}=>resource_argument(value,table,p),
    ast::Expr::Name{name,..}=>p.args.iter().find(|arg|arg.name==*name&&matches!(&arg.type_.kind,ast::TypeKind::Ref{table:target} if target==table)),
    ast::Expr::Member{base,name,..} if name=="id"=>{let mut base=base.as_ref();while let ast::Expr::Assert{value,..}=base{base=value;}let ast::Expr::Read(read)=base else{return None;};if read.table!=table||read.keys.len()!=1||!plain_row(base)||read.keys[0].column.as_deref().is_some_and(|column|column!="id"){return None;}resource_argument(&read.keys[0].value,table,p)},_=>None,
}}

pub(super) fn same_resource(base:&ast::Expr,table:&str,keys:&[ast::KeyPart],p:&ast::ProgramDecl)->bool{
    fn bare(mut expression:&ast::Expr)->&ast::Expr{while let ast::Expr::Assert{value,..}=expression{expression=value;}expression}
    fn canonical<'a>(expression:&'a ast::Expr,table:&str,p:&ast::ProgramDecl)->&'a ast::Expr{
        let expression=bare(expression);
        if let ast::Expr::Member{base,name,..}=expression&&name=="id"&&let ast::Expr::Read(read)=bare(base)&&read.table==table&&read.keys.len()==1&&plain_row(&ast::Expr::Read(read.clone())){
            let key=&read.keys[0];if key.column.as_deref()==Some("id")||key.column.is_none()&&matches!(&key.value,ast::Expr::Name{name,..} if p.args.iter().any(|arg|arg.name==*name&&matches!(&arg.type_.kind,ast::TypeKind::Ref{table:t} if t==table))){return canonical(&key.value,table,p);}
        }expression
    }
    match bare(base){ast::Expr::Read(read)=>read.table==table&&read.keys.len()==keys.len()&&read.keys.iter().zip(keys).all(|(a,b)|{
        let typed=|key:&ast::KeyPart|key.column.clone().or_else(||if matches!(canonical(&key.value,table,p),ast::Expr::Name{name,..} if p.args.iter().any(|arg|arg.name==*name&&matches!(&arg.type_.kind,ast::TypeKind::Ref{table:t} if t==table))){Some("id".into())}else{None});
        typed(a)==typed(b)&&crate::print::expression(canonical(&a.value,table,p))==crate::print::expression(canonical(&b.value,table,p))
    }),_=>false}
}
#[derive(Clone,Copy,PartialEq,Eq)]enum StampSource{Fresh,Copied,Unknown}
fn stamp_source(value:&ast::Expr)->StampSource{match value{
    ast::Expr::Assert{value,..}=>stamp_source(value),
    ast::Expr::Name{name,..} if name=="now"=>StampSource::Fresh,
    ast::Expr::Literal{..}=>StampSource::Fresh,
    ast::Expr::Member{name,..} if ["approv","authoriz"].iter().any(|part|name.to_lowercase().contains(part))=>StampSource::Copied,
    ast::Expr::Binary{op,left,right,..} if matches!(op.as_str(),"+"|"-")&&matches!(right.as_ref(),ast::Expr::Literal{value:ast::Literal::Number(value),..} if value.trim_end_matches(char::is_alphabetic).parse::<i64>().ok()==Some(0))=>stamp_source(left),
    ast::Expr::Binary{left,right,..} if stamp_source(left)==StampSource::Fresh&&stamp_source(right)==StampSource::Fresh=>StampSource::Fresh,
    ast::Expr::If{then,otherwise,..} if stamp_source(then)==StampSource::Fresh&&stamp_source(otherwise)==StampSource::Fresh=>StampSource::Fresh,
    _=>StampSource::Unknown,
}}

fn potential_recording(kind:&snapback4_core::schema::ColumnType,value:Option<&ast::Expr>,table:&str,keys:&[ast::KeyPart],p:&ast::ProgramDecl,stamp:&str)->bool{
    matches!(kind.required(),snapback4_core::schema::ColumnType::Bool|snapback4_core::schema::ColumnType::Time)&&value.is_some_and(|value|{let value=super::creation_advice::simplify_boolean(value);!matches!(value,ast::Expr::Literal{value:ast::Literal::Bool(false)|ast::Literal::Null,..})&&!same_stamp_copy(&value,table,keys,p,stamp)})
}

pub(super) fn fresh_recording(kind:&snapback4_core::schema::ColumnType,value:Option<&ast::Expr>)->bool{
    super::creation_advice::approval_recording(kind,value)&&if matches!(kind.required(),snapback4_core::schema::ColumnType::Time){value.is_some_and(|value|stamp_source(value)==StampSource::Fresh)}else{true}
}

pub(super) fn same_stamp_copy(value:&ast::Expr,table:&str,keys:&[ast::KeyPart],p:&ast::ProgramDecl,stamp:&str)->bool{match value{
    ast::Expr::Assert{value,..}=>same_stamp_copy(value,table,keys,p,stamp),
    ast::Expr::Member{base,name,..}=>name==stamp&&same_resource(base,table,keys,p),
    ast::Expr::Binary{op,left,right,..} if matches!(op.as_str(),"+"|"-")&&matches!(right.as_ref(),ast::Expr::Literal{value:ast::Literal::Number(value),..} if value.trim_end_matches(char::is_alphabetic).parse::<i64>().ok()==Some(0))=>same_stamp_copy(left,table,keys,p,stamp),_=>false,
}}

fn plain_field(expression:&ast::Expr)->bool {
    matches!(expression,ast::Expr::Name{..})||matches!(expression,ast::Expr::Member{base,..} if plain_row(base))
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
            if absence||discriminator{*expression=ast::Expr::Literal{value:ast::Literal::Bool(!negated),site:site.clone()};}
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
// Normalize value-preserving wrappers consistently for dependency and replacement binding.
pub(super) fn stored_argument(value:&ast::Expr,p:&ast::ProgramDecl)->Option<String>{
    let value=super::creation_advice::simplify_boolean(value);match value{ast::Expr::Name{name,..} if p.args.iter().any(|arg|arg.name==name)=>Some(name),ast::Expr::Assert{value,..}=>stored_argument(&value,p),_=>None}
}
fn stored_uses(value:&ast::Expr,name:&str)->bool{let mut value=value.clone();let mut found=false;super::super::intent_walk::expression(&mut value,&mut |e|if matches!(e,ast::Expr::Name{name:arg,..} if arg==name){found=true;});found}
pub(super) fn payload_arguments(value:&ast::Expr,p:&ast::ProgramDecl)->BTreeSet<String>{
    p.args.iter().filter(|arg|!matches!(arg.type_.kind,ast::TypeKind::Ref{..})&&stored_uses(value,&arg.name)).map(|arg|arg.name.clone()).chain(stored_argument(value,p)).collect()
}
pub(super) fn row_input_use(value:&ast::Expr,table:&str,keys:&[ast::KeyPart],p:&ast::ProgramDecl,column:&str)->bool{let mut value=value.clone();let mut found=false;super::super::intent_walk::expression(&mut value,&mut |e|if matches!(e,ast::Expr::Member{base,name,..} if name==column&&same_resource(base,table,keys,p)){found=true;});found}
pub(super) fn row_input_copy(value:&ast::Expr,table:&str,keys:&[ast::KeyPart],p:&ast::ProgramDecl,column:&str)->bool{let value=super::creation_advice::simplify_boolean(value);let mut value=&value;while let ast::Expr::Assert{value:inner,..}=value{value=inner;}matches!(value,ast::Expr::Member{base,name,..} if name==column&&same_resource(base,table,keys,p))}
pub(super) fn opaque_row_payloads(write:&ast::Expr,context:&ast::ProgramDecl,p:&ast::ProgramDecl)->Vec<String>{let ast::Expr::Write{table,keys,fields,..}=write else{return Vec::new();};fields.iter().filter(|field|field.value.as_ref().is_some_and(|value|row_input_use(value,table,keys,p,&field.name)&&!row_input_copy(value,table,keys,p,&field.name))&&context.body.iter().any(|stmt|matches!(stmt,ast::Stmt::Require{condition,..} if row_input_use(condition,table,keys,p,&field.name)))).map(|field|field.name.clone()).collect()}
fn checked_arguments(context:&ast::ProgramDecl,p:&ast::ProgramDecl)->BTreeSet<String>{
    let mut checked=BTreeSet::new();for statement in &context.body{if let ast::Stmt::Require{condition,..}=statement{let mut condition=condition.clone();omit_preconditions(&mut condition,false);condition=super::creation_advice::simplify_boolean(&condition);super::super::intent_walk::expression(&mut condition,&mut |e|if let ast::Expr::Name{name,..}=e&&p.args.iter().any(|arg|arg.name==*name){checked.insert(name.clone());});}}checked
}
pub(super) fn opaque_payloads(fields:&[ast::ObjectField],context:&ast::ProgramDecl,p:&ast::ProgramDecl)->Vec<String>{let checked=checked_arguments(context,p);fields.iter().filter(|field|!matches!(field.name.as_str(),"status"|"stage"|"state"|"phase")&&field.value.as_ref().is_some_and(|value|stored_argument(value,p).is_none()&&!payload_arguments(value,p).is_disjoint(&checked))).map(|field|field.name.clone()).collect()}
pub(super) fn workflow_gaps(sources:&[(String,String)],bound:&Bound)->BTreeSet<String>{let docs=sources.iter().map(|(file,text)|crate::parse_document(file,text).0).collect::<Vec<_>>();let catalog=Catalog::build(docs.clone(),&mut Vec::new());workflow::source_gaps(&docs,&catalog,bound)}
pub fn invariants(sources:&[(String,String)],bound:&Bound)->Vec<Invariant>{collect(sources,bound,&mut BTreeMap::new(),&mut BTreeMap::new(),&mut BTreeMap::new())}
fn collect(sources:&[(String,String)],bound:&Bound,inputs:&mut BTreeMap<(String,String),BTreeSet<String>>,reissues:&mut BTreeMap<(String,String,String),BTreeSet<String>>,uncertain:&mut BTreeMap<(String,String,String),BTreeSet<String>>)->Vec<Invariant>{
    let docs=sources.iter().map(|(f,s)|crate::parse_document(f,s).0).collect::<Vec<_>>();
    let catalog=Catalog::build(docs.clone(),&mut Vec::new());
    let stamps=stamps::columns(&docs,&catalog,bound);for stamp in &stamps{inputs.entry(stamp.clone()).or_default();}
    let mut out=Vec::new();
    let mut controlled=BTreeSet::new();let mut origins=BTreeMap::new();let mut ambiguous_recordings:BTreeMap<(String,String,String),BTreeSet<String>>=BTreeMap::new();
    for (file,p) in docs.iter().flat_map(|d|d.programs.iter().map(move |p|(&d.file,p))).filter(|(_,p)|p.kind==ast::ProgramKind::Mutation){for (write,context) in authority_walk::writes(&catalog,p){
        if let ast::Expr::Write{op,table,fields,keys,site,..}=write{
            let Some(definition)=bound.schema.tables.get(&table)else{continue;};
            let checked=checked_arguments(&context,p);
            let payload=fields.iter().filter(|field|!matches!(field.name.as_str(),"status"|"stage"|"state"|"phase")&&field.value.as_ref().is_some_and(|value|!payload_arguments(value,p).is_disjoint(&checked))).map(|field|field.name.clone()).collect::<BTreeSet<_>>();
            for (stamp,kind) in definition.columns.iter().filter(|(stamp,_)|stamps.contains(&(table.clone(),(*stamp).clone()))){
                let recorded=if let Some(field)=fields.iter().find(|field|field.name==*stamp){potential_recording(kind,field.value.as_ref(),&table,&keys,p,stamp)}else{matches!(op,ast::WriteOp::Insert|ast::WriteOp::Upsert)&&definition.defaults.get(stamp).is_some_and(|value|match (kind.required(),value.value(challenges::NOW,"$derived")){(snapback4_core::schema::ColumnType::Bool,snapback4_core::Value::Bool(true))|(snapback4_core::schema::ColumnType::Time,snapback4_core::Value::Int(_))=>true,_=>false})};
                if recorded{inputs.entry((table.clone(),stamp.clone())).or_default().extend(payload.iter().filter(|column|*column!=stamp).cloned());origins.entry((table.clone(),stamp.clone())).or_insert_with(||site.clone());}
                if let Some(field)=fields.iter().find(|field|field.name==*stamp){let key=(super::super::operation_name(std::path::Path::new(file).file_stem().and_then(|s|s.to_str()).unwrap_or(file),&p.name),table.clone(),stamp.clone());
                    if super::creation_advice::approval_recording(kind,field.value.as_ref()){
                        let custody=if matches!(kind.required(),snapback4_core::schema::ColumnType::Time){field.value.as_ref().map(stamp_source).unwrap_or(StampSource::Unknown)}else{StampSource::Fresh};
                        match custody{StampSource::Fresh=>{reissues.entry(key).or_default().insert(site.to_string());},StampSource::Copied=>{if same_stamp_copy(field.value.as_ref().unwrap(),&table,&keys,p,stamp){uncertain.entry(key).or_default().insert(site.to_string());}else{ambiguous_recordings.entry(key).or_default().insert(site.to_string());}},StampSource::Unknown=>{ambiguous_recordings.entry(key).or_default().insert(site.to_string());}}

                    }
                    else if !matches!(field.value,Some(ast::Expr::Literal{value:ast::Literal::Bool(false)|ast::Literal::Null,..})){
                        let copied=field.value.as_ref().is_some_and(|value|same_stamp_copy(value,&table,&keys,p,stamp));
                        if copied{uncertain.entry(key).or_default().insert(site.to_string());}else{ambiguous_recordings.entry(key).or_default().insert(site.to_string());}
                    }
                }
            }
            for f in fields{if matches!(op,ast::WriteOp::Insert|ast::WriteOp::Upsert)&&write_advice::supplied(&f,p){controlled.insert((table.clone(),f.name));}}
        }
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
            let ast::Expr::Write{op:ast::WriteOp::Update|ast::WriteOp::Upsert,table,fields,site,..}=write else{continue;};
            let Some(info)=catalog.tables.get(table)else{continue;};
            let definition=&bound.schema.tables[table];
            // Guarded edits: only the additional, column-specific condition.
            for field in fields.iter().filter(|_|matches!(write,ast::Expr::Write{op:ast::WriteOp::Update,..})) {
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
                omit_preconditions(&mut e,false);e=super::creation_advice::simplify_boolean(&e);
                super::super::intent_walk::expression(&mut e,&mut |e|if let ast::Expr::Member{base,name,..}=e {
                    if same_resource(base,table,match write{ast::Expr::Write{keys,..}=>keys,_=>unreachable!()},p){inspected.insert(name.clone());}
                });
            }}
            for approval in fields.iter().filter(|f|["approv","authoriz"].iter().any(|s|f.name.to_lowercase().contains(s))){
                let Some(kind)=definition.columns.get(&approval.name)else{continue;};
                if !stamps.contains(&(table.clone(),approval.name.clone())){continue;}
                if !potential_recording(kind,approval.value.as_ref(),table,match write{ast::Expr::Write{keys,..}=>keys,_=>unreachable!()},p,&approval.name){continue;}
                // Keep the source dependency even when existing runtime freeze
                // authority makes emitting another edit candidate redundant.
                inputs.entry((table.clone(),approval.name.clone())).or_default().extend(inspected.iter().filter(|column|definition.columns.contains_key(*column)&&**column!=approval.name&&fields.iter().find(|field|&field.name==*column).is_none_or(|field|field.value.as_ref().is_some_and(|value|row_input_use(value,table,match write{ast::Expr::Write{keys,..}=>keys,_=>unreachable!()},p,column)))).cloned());
                origins.entry((table.clone(),approval.name.clone())).or_insert_with(||site.clone());

            }
        }
    }
    for (key,sites) in uncertain.iter_mut(){sites.retain(|site|reissues.get(key).is_some_and(|recorded|recorded.contains(site)));}
    for (key,sites) in reissues.iter_mut(){if let Some(ambiguous)=uncertain.get(key){sites.retain(|site|!ambiguous.contains(site));}}
    for (key,sites) in ambiguous_recordings{uncertain.entry(key).or_default().extend(sites);}
    for ((table,stamp),columns) in inputs.iter(){
        let definition=&bound.schema.tables[table];let Some(site)=origins.get(&(table.clone(),stamp.clone()))else{continue;};
        let condition=if matches!(definition.columns[stamp].required(),snapback4_core::schema::ColumnType::Bool){RuleExpr::Ne(RuleTerm::Field(stamp.clone()),RuleTerm::Literal(snapback4_core::Value::Bool(true)))}else{RuleExpr::Eq(RuleTerm::Field(stamp.clone()),RuleTerm::Literal(snapback4_core::Value::Null))};
        let paired=match &condition{RuleExpr::Eq(_,v)=>RuleExpr::Or(vec![RuleExpr::Eq(RuleTerm::OldField(stamp.clone()),v.clone()),RuleExpr::Eq(RuleTerm::NextField(stamp.clone()),v.clone())]),RuleExpr::Ne(_,v)=>RuleExpr::Or(vec![RuleExpr::Ne(RuleTerm::OldField(stamp.clone()),v.clone()),RuleExpr::Ne(RuleTerm::NextField(stamp.clone()),v.clone())]),_=>unreachable!()};
        for column in columns{
            if definition.immutable_fields().any(|c|c==column)||definition.frozen_columns.contains_key(column){continue;}
            if !bound.programs.iter().any(|p|snapback4_core::ir::write_tables(&p.program).iter().any(|(t,e)|t==table&&matches!(*e,"update"|"upsert"))){continue;}
            if !write_advice::update_only(bound,table,column,&condition){add(&mut out,table,column,"update",paired.clone(),site);}
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
    let mut out=bound.clone();let mut inputs=BTreeMap::new();let mut reissues=BTreeMap::new();let mut uncertain=BTreeMap::new();out.invariants.extend(collect(sources,bound,&mut inputs,&mut reissues,&mut uncertain));out.security_approval_checks=approval_checks::collect(sources,bound);out.security_approval_reissues.extend(reissues);out.security_approval_uncertain_writes.extend(uncertain);for (stamp,columns) in inputs{out.security_approval_inputs.entry(stamp).or_default().extend(columns);}
    // Declared write audiences are runtime contracts, not inferred spec intent.
    // Their replay failures cannot be acknowledged as deliberate asymmetry.
    let mut contracts=Vec::new();
    for (table,t) in bound.schema.visible_tables(){for (column,policy) in &t.column_writes{
        add(&mut contracts,table,column,"write",policy.clone(),&Site::new("column-write-contract",1,1));
    }}
    for contract in &mut contracts{contract.site.file=contract.site.file.replacen("$derived/","$enforced/",1);}
    out.invariants.extend(contracts);out
}

#[cfg(test)]mod sec10_preconditions{use super::*;
#[test]fn negated_stage_preconditions_preserve_replacement_checks(){
    let source="table docs:\n  status: enum('draft','ready')\n  read <- allow\n  online only\nmutation approve(doc: docs,replacement: int):\n  d = docs[doc] ! else MISSING\n  require not (d.status = 'draft' or replacement <= 0) else INVALID\n";
    let (doc,diagnostics)=crate::parse_document("schema.q",source);assert!(diagnostics.is_empty(),"{diagnostics:?}");let mut predicate=doc.programs[0].body.iter().find_map(|stmt|if let ast::Stmt::Require{condition,..}=stmt{Some(condition.clone())}else{None}).unwrap();omit_preconditions(&mut predicate,false);
    let rendered=crate::print::expression(&super::creation_advice::simplify_boolean(&predicate));assert!(rendered.contains("replacement")&&!rendered.contains("status"),"{rendered}");assert_ne!(rendered,"false");
}
}

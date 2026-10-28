//! Candidate contracts from authored change guards and inspected approval data.
// @ref LLP 3000.036.004.000#5-derived-campaigns-and-production-deployment — inferred candidates require ordinary replay, never a proof claim.
use super::*;
mod workflow;
mod approval_questions;
mod assignment_questions;
mod transition_questions;
pub use transition_questions::questions as transition_questions;
pub(crate) use transition_questions::judge as transition_question_judgment;
pub use assignment_questions::questions as assignment_questions;
pub use approval_questions::questions as approval_questions;
pub(crate) use approval_questions::judge as approval_question_judgment;
mod labels;
mod conservation;
pub(crate) use conservation::Conservation;
mod approval_checks;
mod stamps;
mod stage_columns;
mod subject;
pub(super) use stamps::named as named_approval;
pub(super) fn workflow_columns(catalog:&Catalog,bound:&Bound)->BTreeSet<(String,String)>{stage_columns::collect(catalog,bound)}
pub(super) use workflow::{approval_populations,local_population_approval};
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

// Preserve the owning table of typed member and key references, including
// population-local focal expressions.
fn referenced_columns(e:&ast::Expr,table:&str,bound:&Bound,out:&mut BTreeSet<(String,String)>){
        match e{
            ast::Expr::Member{base,name,..}=>{if let Some(owner)=super::concrete::reference_table(base,&bound.schema,table)&&bound.schema.tables[owner].columns.contains_key(name){out.insert((owner.into(),name.clone()));}referenced_columns(base,table,bound,out);},
            ast::Expr::Read(read)|ast::Expr::Exists{read,..}=>{for key in &read.keys{if let Some(column)=&key.column&&bound.schema.tables[&read.table].columns.contains_key(column){out.insert((read.table.clone(),column.clone()));}referenced_columns(&key.value,table,bound,out);}if let Some(filter)=&read.filter{referenced_columns(filter,&read.table,bound,out);}},
            ast::Expr::Binary{left,right,..}=>{referenced_columns(left,table,bound,out);referenced_columns(right,table,bound,out);},
            ast::Expr::Unary{value,..}|ast::Expr::Assert{value,..}=>referenced_columns(value,table,bound,out),
            ast::Expr::Call{name,args,..} if name=="sum"&&args.len()==2=>{referenced_columns(&args[0],table,bound,out);if let ast::Expr::Read(read)=&args[0]{referenced_columns(&args[1],&read.table,bound,out);}},
            ast::Expr::Call{args,..}|ast::Expr::Array{items:args,..}=>for arg in args{referenced_columns(arg,table,bound,out)},
            ast::Expr::If{condition,then,otherwise,..}=>{referenced_columns(condition,table,bound,out);referenced_columns(then,table,bound,out);referenced_columns(otherwise,table,bound,out);},_=>{},
        }
    }
// Principal markers are identity capabilities, not payload approval.
pub(crate) fn principal_receipt_columns(bound:&Bound)->BTreeSet<(String,String)>{
    let mut out=BTreeSet::new();for inv in &bound.invariants{if let Some(syntax)=&inv.syntax{for receipt in workflow::approval_receipts(syntax){referenced_columns(&receipt,&inv.table,bound,&mut out);}}}out.retain(|(table,column)|{let kind=&bound.schema.tables[table].columns[column];matches!(kind.required(),snapback4_core::schema::ColumnType::Principal)&&stamps::evidence(column,kind)});out
}
pub(crate) fn lifecycle_columns(bound:&Bound)->BTreeSet<(String,String)>{
    let mut out=BTreeSet::new();for inv in bound.invariants.iter().filter(|i|i.site.file.contains("/parent-state/")||i.site.file.contains("/child-stage/")){if let Some(column)=&inv.column{out.insert((inv.table.clone(),column.clone()));}if let Some(syntax)=&inv.syntax{referenced_columns(syntax,&inv.table,bound,&mut out);}}out.retain(|(table,column)|matches!(bound.schema.tables[table].columns[column].required(),snapback4_core::schema::ColumnType::Enum{..}|snapback4_core::schema::ColumnType::Text{..}));out
}
pub(super) fn categorical_change(value:&ast::Expr,table:&str,keys:&[ast::KeyPart],p:&ast::ProgramDecl,context:&ast::ProgramDecl,column:&str,bound:&Bound)->bool{stage_columns::changing_consumer(value,table,keys,p,context,column,bound)}
fn omit_preconditions(expression:&mut ast::Expr,negated:bool,stage:&impl Fn(&ast::Expr)->bool){omit_conditions(expression,negated,stage,true)}
fn omit_conditions(expression:&mut ast::Expr,negated:bool,stage:&impl Fn(&ast::Expr)->bool,remove_absence:bool){
    match expression {
        ast::Expr::Unary{op,value,..} if op=="not"=>omit_conditions(value,!negated,stage,remove_absence),
        ast::Expr::Binary{op,left,right,..} if matches!(op.as_str(),"and"|"or")=>{
            omit_conditions(left,negated,stage,remove_absence);omit_conditions(right,negated,stage,remove_absence);
        },
        ast::Expr::Binary{op,left,right,..} if matches!(op.as_str(),"="|"!=")&&(matches!(left.as_ref(),ast::Expr::Literal{value:ast::Literal::Bool(_),..})||matches!(right.as_ref(),ast::Expr::Literal{value:ast::Literal::Bool(_),..}))=>{
            if let ast::Expr::Literal{value:ast::Literal::Bool(value),..}=right.as_ref(){omit_conditions(left,negated^((op=="=")!=*value),stage,remove_absence);}else if let ast::Expr::Literal{value:ast::Literal::Bool(value),..}=left.as_ref(){omit_conditions(right,negated^((op=="=")!=*value),stage,remove_absence);}
        },
        ast::Expr::Binary{op,left,right,site}=>{
            let null=|e:&ast::Expr|matches!(e,ast::Expr::Literal{value:ast::Literal::Null,..});
            let discriminator_field=|field:&ast::Expr,value:&ast::Expr|plain_field(field)&&stage(field)&&matches!(value,ast::Expr::Literal{value:ast::Literal::Str(value),..} if !value.is_empty());
            let absence=(op=="="&&!negated||op=="!="&&negated)&&((null(left)&&plain_field(right))||(null(right)&&plain_field(left)));
            let discriminator=matches!(op.as_str(),"="|"!=")&&(discriminator_field(left,right)||discriminator_field(right,left));
            if remove_absence&&absence||discriminator{*expression=ast::Expr::Literal{value:ast::Literal::Bool(!negated),site:site.clone()};}
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
// @ref LLP 3000.036.004.000#13-witness-backed-enforcement-and-shipping-precision — migration formulas do not declare enduring meaning.
pub fn advisory(inv:&Invariant)->bool {
    if inv.site.file.contains("/label-consistency/")||inv.site.file.contains("/sec11-transition/"){return true;}
    if !is_derived(inv)||["/sibling-approval/","/approval-history/","/repeat-create/","/parent-state/","/child-stage/","/participant-conservation/"].iter().any(|family|inv.site.file.contains(family)){return false;}
    // A narrower edit guard is not an implicit declaration about every create
    // or other edit path. Keep actual paired approval invalidation contracts.
    inv.target!="update"||!inv.policy.as_ref().is_some_and(|policy|
        policy.any_term(&|term|matches!(term,RuleTerm::OldField(_)))&&policy.any_term(&|term|matches!(term,RuleTerm::NextField(_))))
}
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
    let mut checked=BTreeSet::new();for statement in &context.body{if let ast::Stmt::Require{condition,..}=statement{let mut condition=condition.clone();omit_preconditions(&mut condition,false,&|_|false);condition=super::creation_advice::simplify_boolean(&condition);super::super::intent_walk::expression(&mut condition,&mut |e|if let ast::Expr::Name{name,..}=e&&p.args.iter().any(|arg|arg.name==*name){checked.insert(name.clone());});}}checked
}
pub(super) fn opaque_payloads(fields:&[ast::ObjectField],context:&ast::ProgramDecl,p:&ast::ProgramDecl)->Vec<String>{let checked=checked_arguments(context,p);fields.iter().filter(|field|field.value.as_ref().is_some_and(|value|stored_argument(value,p).is_none()&&!payload_arguments(value,p).is_disjoint(&checked))).map(|field|field.name.clone()).collect()}
pub(super) fn workflow_gaps(sources:&[(String,String)],bound:&Bound)->BTreeSet<String>{let docs=sources.iter().map(|(file,text)|crate::parse_document(file,text).0).collect::<Vec<_>>();let catalog=Catalog::build(docs.clone(),&mut Vec::new());workflow::source_gaps(&docs,&catalog,bound).into_iter().chain(conservation::source_gaps(&docs,&catalog,bound)).collect()}
/// Structural workflow discriminators, shared with presentation-only question replay.
pub fn workflow_columns_from_sources(sources:&[(String,String)],bound:&Bound)->BTreeSet<(String,String)>{
    let docs=sources.iter().map(|(file,source)|crate::parse_document(file,source).0).collect();
    workflow_columns(&Catalog::build(docs,&mut Vec::new()),bound)
}
pub fn invariants(sources:&[(String,String)],bound:&Bound)->Vec<Invariant>{collect(sources,bound,&mut BTreeMap::new(),&mut BTreeMap::new(),&mut BTreeMap::new())}
// @ref LLP 3000.036.004.000#5-derived-campaigns-and-production-deployment — authored column edit intent disposes of an inferred approval-input freeze, not observed source guards or authored enforcement.
fn declared_column_update(bound:&Bound,table:&str,column:&str)->bool{
    bound.invariants.iter().any(|i|!is_derived(i)&&!i.site.file.starts_with("$enforced/")&&i.table==table&&i.column.as_deref()==Some(column)&&i.target=="update"&&i.operation.is_none()&&i.policy.is_some()&&i.syntax.is_some()&&i.unsupported.is_none())
}
fn collect(sources:&[(String,String)],bound:&Bound,inputs:&mut BTreeMap<(String,String),BTreeSet<String>>,reissues:&mut BTreeMap<(String,String,String),BTreeSet<String>>,uncertain:&mut BTreeMap<(String,String,String),BTreeSet<String>>)->Vec<Invariant>{
    let docs=sources.iter().map(|(f,s)|crate::parse_document(f,s).0).collect::<Vec<_>>();
    let catalog=Catalog::build(docs.clone(),&mut Vec::new());
    let stages=stage_columns::collect(&catalog,bound);
    let stamps=stamps::columns(&docs,&catalog,bound);for stamp in &stamps{inputs.entry(stamp.clone()).or_default();}
    let mut out=Vec::new();
    let mut controlled=BTreeSet::new();let mut origins=BTreeMap::new();let mut ambiguous_recordings:BTreeMap<(String,String,String),BTreeSet<String>>=BTreeMap::new();
    for (file,p) in docs.iter().flat_map(|d|d.programs.iter().map(move |p|(&d.file,p))).filter(|(_,p)|p.kind==ast::ProgramKind::Mutation){for (write,context) in authority_walk::writes(&catalog,p){
        if let ast::Expr::Write{op,table,fields,keys,site,..}=write{
            let Some(definition)=bound.schema.tables.get(&table)else{continue;};
            let checked=checked_arguments(&context,p);
            let payload=fields.iter().filter(|field|field.value.as_ref().is_some_and(|value|!payload_arguments(value,p).is_disjoint(&checked))).map(|field|field.name.clone()).collect::<BTreeSet<_>>();
            for (stamp,kind) in definition.columns.iter().filter(|(stamp,_)|stamps.contains(&(table.clone(),(*stamp).clone()))){
                let recorded=if let Some(field)=fields.iter().find(|field|field.name==*stamp){potential_recording(kind,field.value.as_ref(),&table,&keys,p,stamp)}else{matches!(op,ast::WriteOp::Insert|ast::WriteOp::Upsert)&&definition.defaults.get(stamp).is_some_and(|value|match (kind.required(),value.value(challenges::NOW,"$derived")){(snapback4_core::schema::ColumnType::Bool,snapback4_core::Value::Bool(true))|(snapback4_core::schema::ColumnType::Time,snapback4_core::Value::Int(_))=>true,_=>false})};
                if recorded{inputs.entry((table.clone(),stamp.clone())).or_default().extend(definition.columns.iter().filter(|(column,kind)|subject::matches(stamp,column,kind)).map(|(column,_)|column.clone()));inputs.entry((table.clone(),stamp.clone())).or_default().extend(payload.iter().filter(|column|*column!=stamp).cloned());origins.entry((table.clone(),stamp.clone())).or_insert_with(||site.clone());}
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
            let admissions=stage_columns::admissions(&catalog,&stages,table,match write{ast::Expr::Write{keys,..}=>keys,_=>unreachable!()},p,context,fields,bound);
            let stage=|field:&ast::Expr|matches!(field,ast::Expr::Member{base,name,..} if admissions.contains(name)&&same_resource(base,table,match write{ast::Expr::Write{keys,..}=>keys,_=>unreachable!()},p));
            let mut inspected=BTreeSet::new();
            for statement in &context.body {if let ast::Stmt::Require{condition,..}=statement {
                let mut e=condition.clone();
                // Absence and stage checks admit the transition; they do not
                // assert that the current value is evidence being approved.
                omit_preconditions(&mut e,false,&stage);e=super::creation_advice::simplify_boolean(&e);
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
    // An independently declared and enforced subject-approval operation can
    // reapprove its replacement without mechanically rewriting a true flag.
    for doc in &docs{for p in doc.programs.iter().filter(|p|p.kind==ast::ProgramKind::Mutation){for (write,context) in authority_walk::writes(&catalog,p){if let ast::Expr::Write{op:ast::WriteOp::Update,table,fields,site,..}=write{for ((owner,stamp),columns) in inputs.iter().filter(|((owner,_),_)|owner==&table){if fields.iter().any(|field|columns.contains(&field.name)&&subject::authorized(bound,&catalog,p,&context,owner,stamp,&field.name)){let name=super::super::operation_name(std::path::Path::new(&doc.file).file_stem().and_then(|s|s.to_str()).unwrap_or(&doc.file),&p.name);reissues.entry((name,table.clone(),stamp.clone())).or_default().insert(site.to_string());}}}}}}
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
            if !declared_column_update(bound,table,column)&&!write_advice::update_only(bound,table,column,&condition){add(&mut out,table,column,"update",paired.clone(),site);}
        }
    }
    workflow::invariants(&docs,&catalog,bound,&mut out);
    labels::invariants(&docs,&catalog,bound,&mut out);
    out.extend(conservation::contracts(&docs,&catalog,bound).into_iter().map(|(inv,_)|inv));
    out
}
pub fn notes(sources:&[(String,String)],bound:&Bound)->Vec<Diagnostic>{
    invariants(sources,bound).into_iter().map(|i|{
        let transition=transition(&i).is_some();
        let workflow=["/sibling-approval/","/approval-history/","/repeat-create/","/parent-state/","/child-stage/"].iter().any(|label|i.site.file.contains(label));
        let message=if transition{format!("{}: inferred effect prerequisite {}; judge before entering the selected destination, permitting atomic approval consumption; a replayed violation needs a specification decision",i.target_label(),i.predicate)}else{format!("{}: derived candidate {} only {}; a replayed violation needs a specification decision",i.target_label(),i.target,i.predicate)};
        let repair=if advisory(&i)&&!i.site.file.contains("/label-consistency/"){"initial and edit audiences may deliberately differ; this projected guard is advice only; declare independent creation/update intent if the specification requires it, then run test"}else if i.site.file.contains("/participant-conservation/"){"refund the matching participant charge in the removal transaction, refuse removal while a charge remains, or record this deliberate no-refund removal with check --ack-security ID --reason '<spec rationale>'"}else if i.site.file.contains("/label-consistency/"){"a backfill only initializes existing rows; if the formula is the ongoing meaning, declare invariant T always c = f(x); otherwise retain the intentional setter (advice only)"}else if workflow{"require the named approval/parent/child prerequisite before this governed effect, consume one-use guards atomically, or record this individual alternative path with check --ack-security ID --reason '<spec rationale>'"}else{"enforce column write/freeze authority, declare matching update-only creation intent, or record this individual rule's deliberate design with check --ack-security ID --reason '<spec rationale>'"};
        Diagnostic::new(&i.site,"N_DERIVED_WRITE_AUTHORITY",message,repair).guide("security")
    }).collect()
}
/// Semantic witness inputs include custom committed-state contracts whose
/// dependency tables are not represented by a policy/syntax expression.
pub fn witness_dependencies(sources:&[(String,String)],bound:&Bound,inv:&Invariant)->BTreeSet<String>{
    let mut tables=inv.dependencies();
    if inv.site.file.contains("/participant-conservation/"){
        let cached=bound.security_conservation.get(&inv.site.to_string()).cloned();
        let contract=cached.or_else(||{
            let docs=sources.iter().map(|(file,text)|crate::parse_document(file,text).0).collect::<Vec<_>>();
            let catalog=Catalog::build(docs.clone(),&mut Vec::new());
            conservation::contracts(&docs,&catalog,bound).into_iter().find(|(candidate,_)|candidate.site==inv.site).map(|(_,contract)|contract)
        });
        if let Some(contract)=contract{tables.insert(contract.ledger);tables.extend(contract.refund_ledger);}else{
            // A missing custom judgment cannot silently become dependency-free.
            tables.extend(bound.schema.tables.keys().cloned());
        }
    }tables
}
pub fn augmented(sources:&[(String,String)],bound:&Bound)->Bound{
    let mut out=bound.clone();let mut inputs=BTreeMap::new();let mut reissues=BTreeMap::new();let mut uncertain=BTreeMap::new();out.invariants.extend(collect(sources,bound,&mut inputs,&mut reissues,&mut uncertain).into_iter().filter(|i|!advisory(i)));out.security_approval_checks=approval_checks::collect(sources,bound);out.security_approval_reissues.extend(reissues);out.security_approval_uncertain_writes.extend(uncertain);for (stamp,columns) in inputs{out.security_approval_inputs.entry(stamp).or_default().extend(columns);}
    let docs=sources.iter().map(|(f,s)|crate::parse_document(f,s).0).collect::<Vec<_>>();let catalog=Catalog::build(docs.clone(),&mut Vec::new());
    out.security_conservation.extend(conservation::contracts(&docs,&catalog,bound).into_iter().map(|(inv,contract)|(inv.site.to_string(),contract)));
    // Declared write audiences are runtime contracts, not inferred spec intent.
    // Their replay failures cannot be acknowledged as deliberate asymmetry.
    let mut contracts=Vec::new();
    for (table,t) in bound.schema.visible_tables(){for (column,policy) in &t.column_writes{
        let site=Site::new("column-write-contract",1,1);
        add(&mut contracts,table,column,"insert",RuleExpr::Or(vec![t.column_initialization(column),policy.clone()]),&site);
        add(&mut contracts,table,column,"update",policy.clone(),&site);
    }}
    for contract in &mut contracts{contract.site.file=contract.site.file.replacen("$derived/","$enforced/",1);}
    out.invariants.extend(contracts);out
}

#[cfg(test)]mod sec10_preconditions{use super::*;
#[test]fn negated_stage_preconditions_preserve_replacement_checks(){
    let source="table docs:\n  status: enum('draft','ready')\n  read <- allow\n  online only\nmutation approve(doc: docs,replacement: int):\n  d = docs[doc] ! else MISSING\n  require not (d.status = 'draft' or replacement <= 0) else INVALID\n";
    let (doc,diagnostics)=crate::parse_document("schema.q",source);assert!(diagnostics.is_empty(),"{diagnostics:?}");let mut predicate=doc.programs[0].body.iter().find_map(|stmt|if let ast::Stmt::Require{condition,..}=stmt{Some(condition.clone())}else{None}).unwrap();omit_preconditions(&mut predicate,false,&|e|matches!(e,ast::Expr::Member{name,..} if name=="status"));
    let rendered=crate::print::expression(&super::creation_advice::simplify_boolean(&predicate));assert!(rendered.contains("replacement")&&!rendered.contains("status"),"{rendered}");assert_ne!(rendered,"false");
}
}

#[cfg(test)]mod principal_receipt_tests{use super::*;
#[test]fn principal_receipt_populations_keep_their_own_table_type(){
 let source="table docs:\n  approvedBy: principal ?\n  read <- allow\n  online only\ntable approvals:\n  doc: docs\n  approvedBy: principal ?\n  read <- allow\n  online only\ninvariant docs always exists approvals[doc = .id] where .approvedBy = viewer\n";for source in [source.to_owned(),source.replace("approvals[doc = .id] where .approvedBy = viewer","approvals[doc = .id, approvedBy = viewer]")]{let b=crate::compile(&[("schema.q".into(),source)]);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);assert_eq!(principal_receipt_columns(&b),BTreeSet::from([("approvals".into(),"approvedBy".into())]));}
}
}

#[test]fn declared_column_edit_intent_disposes_only_its_inferred_approval_freeze(){
 let source=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/sec13/w33-036.q"));
 let intent="invariant orders.designScan update only exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner']";
 let freeze=|source:&str|{let sources=vec![("schema.q".into(),source.to_owned())];let b=crate::compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);invariants(&sources,&b).into_iter().any(|i|i.table=="orders"&&i.column.as_deref()==Some("designScan")&&i.predicate.contains("designApprovedAt"))};
 assert!(!freeze(source),"the explicit design-scan edit policy answers the inferred freeze");
 let missing=source.replace(intent,"");assert!(freeze(&missing),"an always tautology does not answer the inferred edit policy");
 let unrelated=source.replace(intent,&intent.replace("orders.designScan","orders.quotedPrice"));assert!(freeze(&unrelated),"another column's edit intent cannot answer this freeze");
 let read=source.replace(intent,&intent.replace(" update only "," read only "));assert!(freeze(&read),"read intent cannot answer an edit question");
}

#[test]fn inferred_freeze_disposal_requires_supported_global_column_intent(){
 let source=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/sec13/w33-036.q"));let b=crate::compile(&[("schema.q".into(),source.into())]);
 let index=b.invariants.iter().position(|i|i.table=="orders"&&i.column.as_deref()==Some("designScan")&&i.target=="update").unwrap();assert!(declared_column_update(&b,"orders","designScan"));
 for case in 0..8 {let mut changed=b.clone();let i=&mut changed.invariants[index];match case{0=>i.unsupported=Some("not covered".into()),1=>i.policy=None,2=>i.operation=Some("clearDesignScan".into()),3=>i.column=None,4=>i.target="write".into(),5=>i.site.file="$derived/test".into(),6=>i.site.file="$enforced/test".into(),_=>i.syntax=None};assert!(!declared_column_update(&changed,"orders","designScan"),"exclusion {case}");}
 // A supported explicit allow/deny is a specification choice, not a grant.
 // Its authored assertion is retained and still receives adversarial replay.
 for policy in [RuleExpr::Allow,RuleExpr::Deny]{let mut changed=b.clone();changed.invariants[index].policy=Some(policy);assert!(declared_column_update(&changed,"orders","designScan"));let augmented=augmented(&[("schema.q".into(),source.into())],&changed);assert!(augmented.invariants.iter().any(|i|!is_derived(i)&&i.column.as_deref()==Some("designScan")&&i.target=="update"));}
}
#[test]fn explicit_edit_policy_keeps_other_payload_freezes_and_observed_guard_contracts(){
 let source=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/sec13/w33-036.q"));
 let source=source.replace("  designScan: image <=10000000 ?","  designScan: image <=10000000 ?\n  designModel: image <=10000000 ?")
  .replace("designScan: image <=10000000 ?, quotedPrice:","designScan: image <=10000000 ?, designModel: image <=10000000 ?, quotedPrice:")
  .replace("{ team, designScan, quotedPrice","{ team, designScan, designModel, quotedPrice");
 let source=format!("{source}\nmutation setDesignModel(order: orders, designModel: image <=10000000):\n  update orders[order] {{designModel}}\n");let sources=vec![("schema.q".into(),source)];let b=crate::compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let invs=invariants(&sources,&b);
 assert!(!invs.iter().any(|i|i.column.as_deref()==Some("designScan")&&i.predicate.contains("designApprovedAt")));
 assert!(invs.iter().any(|i|i.column.as_deref()==Some("designModel")&&i.predicate.contains("designApprovedAt")),"another approved payload retains its inferred freeze");
 let source="table docs:\n  photo: image <=10000 ?\n  approved: bool default false\n  read <- allow\n  insert <- allow\n  update (old, next) <- old.photo = next.photo or not old.approved\n  online only\nmutation add(photo: image <=10000 ?):\n  return insert docs {photo}\nmutation edit(doc: docs, photo: image <=10000 ?):\n  d = docs[doc] ! else MISSING\n  require not d.approved else APPROVED\n  update docs[doc] {photo}\n  return null\ninvariant docs.photo update only viewer = 'owner'\n";
 let sources=vec![("schema.q".into(),source.into())];let b=crate::compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);assert!(declared_column_update(&b,"docs","photo"));assert!(invariants(&sources,&b).iter().any(|i|i.table=="docs"&&i.column.as_deref()==Some("photo")&&i.predicate.contains("approved")),"an actually observed edit guard still needs matching intent");
}
#[test]fn declared_scan_policy_keeps_runtime_roles_deadlines_and_owner_design_change_authority(){
 use snapback4_core::{Context,Engine,Value,WriteState};
 let source=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/sec13/w33-036.q"));let b=crate::compile(&[("schema.q".into(),source.into())]);let mut engine=Engine::memory(b.schema.clone(),b.programs.iter().map(|p|p.program.clone())).unwrap();
 let now=1800000000000i64;let row=|table:&str,value:serde_json::Value|snapback4_core::wire::row_from_json(&b.schema.tables[table],&value).unwrap();
 let mut rows=[("coordinator","c"),("team","t"),("jeweler","j"),("owner","o")].into_iter().map(|(role,id)|("roles".into(),row("roles",serde_json::json!({"id":format!("role-{id}"),"principal":id,"role":role})))).collect::<Vec<_>>();
 rows.push(("orders".into(),row("orders",serde_json::json!({"id":"order","team":"t","designScan":null,"quotedPrice":100,"ringCount":1,"ceremonyAt":now+90*86400000,"designApprovedAt":now,"status":"delivered","extraCost":0,"depositKept":false,"deliveredAt":now,"flawReported":false,"flawNote":null}))));
 rows.push(("designChanges".into(),row("designChanges",serde_json::json!({"id":"change","order":"order","team":"t","description":"new design","extraCost":0,"approved":false,"approvedBy":null,"approvedAt":null}))));engine.seed_at(rows,now).unwrap();
 fn mutate(e:&mut Engine,viewer:&str,name:&str,args:BTreeMap<String,Value>,now:i64)->WriteState{e.mutate(name,None,Context::new(viewer,args).at(now)).unwrap().state}
 let args=BTreeMap::from([("order".into(),Value::Id("order".into()))]);
 for viewer in ["t","j"]{let state=mutate(&mut engine,viewer,"clearDesignScan",args.clone(),now);assert!(matches!(&state,WriteState::Failed{why,..}if why.code=="NOT_COORDINATOR"),"{state:?}");}
 assert!(matches!(mutate(&mut engine,"c","clearDesignScan",args.clone(),now),WriteState::Sent{..}));
 let before=engine.query("orderDetail",Context::new("c",args.clone()).at(now)).unwrap().data;assert_eq!(before.field("extraCost").unwrap(),&Value::Int(0));assert_eq!(before.field("designApprovedAt").unwrap(),&Value::Int(now));assert_eq!(before.field("status").unwrap(),&Value::String("delivered".into()));
 let change=BTreeMap::from([("change".into(),Value::Id("change".into())),("extraCost".into(),Value::Int(25))]);
 for viewer in ["c","t","j"]{let state=mutate(&mut engine,viewer,"approveDesignChange",change.clone(),now);assert!(matches!(&state,WriteState::Failed{why,..}if why.code=="NOT_OWNER"),"{state:?}");}
 let mut free=change.clone();free.insert("extraCost".into(),Value::Int(0));assert!(matches!(mutate(&mut engine,"o","approveDesignChange",free,now),WriteState::Failed{why,..}if why.code=="EXTRA_COST_REQUIRED"));
 assert!(matches!(mutate(&mut engine,"o","approveDesignChange",change,now),WriteState::Sent{..}));let after=engine.query("orderDetail",Context::new("c",args).at(now)).unwrap().data;assert_eq!(after.field("extraCost").unwrap(),&Value::Int(25));for field in ["designApprovedAt","ceremonyAt","status"]{assert_eq!(after.field(field).unwrap(),before.field(field).unwrap());}
}

#[test]fn runtime_column_authority_is_not_independent_edit_intent_after_augmentation(){
 let source=include_str!(concat!(env!("CARGO_MANIFEST_DIR"),"/tests/security/sec13/w33-036.q"));let intent="invariant orders.designScan update only exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner']";
 let source=source.replace(intent,"").replace("  designScan: image <=10000000 ?","  designScan: image <=10000000 ? write <- exists roles[principal = viewer, role = 'coordinator'] or exists roles[principal = viewer, role = 'owner']");let sources=vec![("schema.q".into(),source)];let b=crate::compile(&sources);assert!(b.diagnostics.is_empty(),"{:?}",b.diagnostics);let b=augmented(&sources,&b);
 assert!(b.invariants.iter().any(|i|i.site.file.starts_with("$enforced/")&&i.column.as_deref()==Some("designScan")&&i.target=="update"));assert!(!declared_column_update(&b,"orders","designScan"));
 assert!(invariants(&sources,&b).iter().any(|i|i.table=="orders"&&i.column.as_deref()==Some("designScan")&&i.predicate.contains("designApprovedAt")),"enforcement alone cannot erase the independently witnessed approval-freeze question");
}

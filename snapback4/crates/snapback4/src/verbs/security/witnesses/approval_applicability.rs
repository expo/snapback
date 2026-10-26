//! Positive activation on the exact approved row bounds individual gates.
// @ref LLP 3000.036.004.000#13-witness-backed-enforcement-and-shipping-precision — unknown applicability is advisory.
use super::*;
// A coupled activation flag must be required on the very row whose approval
// is recorded. An unmatched/unknown applicability remains an advisory guess.
pub(super) fn approval_trigger(bound:&Bound,table:&str,column:&str)->Option<String>{
    use snapback4_core::ir::{self,Expr as E,Stmt as S};
    use snapback4_core::Value as V;
    let t=bound.schema.table(table)?;let stem=column.to_lowercase().split("approv").next()?.to_owned();
    if stem.is_empty(){return None;}
    fn id_key<'a>(mut value:&'a E,vars:&'a BTreeMap<String,E>,arg:&str)->bool{
        for _ in 0..32{let E::Variable(name)=value else{return false;};if name==arg{return true;}let Some(next)=vars.get(name)else{return false;};value=next;}false
    }
    fn key(read:&ir::Read,vars:&BTreeMap<String,E>,table:&str,arg:&str)->bool{read.table==table&&read.index=="byId"&&read.key.len()==1&&id_key(&read.key[0],vars,arg)}
    fn row(e:&E,vars:&BTreeMap<String,E>,table:&str,arg:&str,depth:usize)->bool{
        if depth>32{return false;}
        match e{
            E::Get(read)=>key(read,vars,table,arg),
            E::Variable(name)=>vars.get(name).is_some_and(|e|row(e,vars,table,arg,depth+1)),
            E::Block{body,value}=>{let mut vars=vars.clone();for stmt in body{match stmt{S::Const{name,value}|S::Let{name,value}=>{vars.insert(name.clone(),value.clone());},S::Require{..}=>{},_=>return false,}}row(value,&vars,table,arg,depth+1)},
            _=>false,
        }
    }
    fn positive(e:&E,vars:&BTreeMap<String,E>,table:&str,arg:&str,column:&str,depth:usize)->bool{
        if depth>32{return false;}
        let field=|e:&E|matches!(e,E::Field{base,name} if name==column&&row(base,vars,table,arg,0));
        match e{
            E::Field{..}=>field(e),
            E::Variable(name)=>vars.get(name).is_some_and(|e|positive(e,vars,table,arg,column,depth+1)),
            E::Binary{op:ir::BinaryOp::And,left,right}=>positive(left,vars,table,arg,column,depth+1)||positive(right,vars,table,arg,column,depth+1),
            E::Binary{op:ir::BinaryOp::Or,left,right}=>positive(left,vars,table,arg,column,depth+1)&&positive(right,vars,table,arg,column,depth+1),
            E::Binary{op,left,right}=>[(left.as_ref(),right.as_ref()),(right.as_ref(),left.as_ref())].into_iter().any(|(a,b)|field(a)&&matches!((op,b),(ir::BinaryOp::Eq,E::Literal(V::Bool(true)))|(ir::BinaryOp::Ne,E::Literal(V::Bool(false))))),
            _=>false,
        }
    }
    for (trigger,kind) in &t.columns{
        if trigger==column||!trigger.to_lowercase().starts_with(&stem)||!matches!(kind.required(),ColumnType::Bool){continue;}
        'producer:for p in &bound.programs{
            let args=p.program.args.iter().filter_map(|(name,kind)|matches!(kind,ir::ArgType::Ref{table:parent} if parent==table).then_some(name)).collect::<Vec<_>>();
            if args.len()!=1{continue;}let arg=args[0];let mut vars=BTreeMap::new();let mut guarded=false;
            for stmt in &p.program.body{
                let write=match stmt{
                    S::Const{name,value}|S::Let{name,value}=>{vars.insert(name.clone(),value.clone());None},
                    S::Require{condition,..}=>{guarded|=positive(condition,&vars,table,arg,trigger,0);None},
                    S::WriteTarget{target,patch,..} if key(target,&vars,table,arg)=>Some(patch),
                    S::Update{table:target,key,patch} if target==table&&id_key(key,&vars,arg)=>Some(patch),
                    S::If{..}|S::For{..}|S::Assign{..}=>continue 'producer,
                    _=>None,
                };
                if guarded&&write.is_some_and(|e|matches!(e,E::Object(fields) if fields.get(column).is_some_and(|e|matches!(e,E::Literal(V::Bool(true))|E::Input(ir::Input::Now))))){return Some(trigger.clone());}
            }
        }
    }None
}
pub(super) fn precise_approval(bound:&Bound,note:&Diagnostic)->bool{
    note.code!="N_APPROVAL_NOT_ENFORCED"||note.message.split_once(':').and_then(|(subject,_)|subject.split_once('.')).is_some_and(|(table,column)|approval_trigger(bound,table,column).is_some())
}

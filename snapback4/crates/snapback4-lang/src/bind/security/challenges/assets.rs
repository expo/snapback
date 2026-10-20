//! Real upload ledgers for foreign-id and non-image placement challenges.
// @ref LLP 3000.038#3-upload — assets retain upload ownership and verified media type.
use super::*;
const PDF:&[u8]=b"%PDF-1.4\n%%EOF\n";
pub(super) fn file(e:&mut Engine,owner:&str,types:&[String])->Result<Value,String>{
    let mime=types.first().map(String::as_str).unwrap_or("application/pdf");
    let (bytes,name)=match mime{"application/pdf"=>(PDF,"proof.pdf"),"text/plain"=>(b"verified text\n".as_slice(),"proof.txt"),"image/png"=>(PNG.as_slice(),"proof.png"),_=>return Err(format!("file ledger needs a verified {mime} fixture"))};
    e.store_file(owner,bytes,Some(mime),name,NOW).map(|a|a.column_value()).map_err(|e|e.to_string())
}
fn contains(value:&Value,id:&Value)->bool {
    if value==id{return true;}
    match value{Value::Array(xs)=>xs.iter().any(|v|contains(v,id)),Value::Map(m)=>m.values().any(|v|contains(v,id)),Value::Row(m)=>m.values().any(|v|contains(v,id)),_=>false}
}
pub(super) fn run(bound:&Bound,fixture:&Engine,out:&mut Campaign){
    let Ok(initial)=readback(fixture)else{return;};
    if initial.values().any(|xs|!xs.is_empty()){
        out.unsupported.insert("foreign-asset replay over populated fixtures needs full ledger transfer; empty-ledger challenges run separately".into());
    }
    for bp in bound.programs.iter().filter(|p|p.program.kind==ProgramKind::Mutation&&!p.program.native){
        let p=&bp.program;
        if ephemeral_operation(bound,p,out){continue;}
        for (arg,kind) in &p.args{
            if !matches!(kind,ir::ArgType::Image{..}|ir::ArgType::File{..}){continue;}
            for mode in ["foreign upload","non-image photo"]{
                if mode=="non-image photo"&&!matches!(kind,ir::ArgType::Image{..}){continue;}
                let mut e=match engine(bound,&BTreeMap::new(),program("$security.asset",ProgramKind::Query,vec![Stmt::Return(Expr::Literal(Value::Null))])){Ok(e)=>e,Err(error)=>{out.unsupported.insert(error);continue;}};
                let sample=if mode=="non-image photo"{file(&mut e,VIEWER,&[])}else{match kind{
                    ir::ArgType::Image{..}=>e.store_asset(OTHER,&PNG,NOW).map(|a|a.column_value()).map_err(|e|e.to_string()),
                    ir::ArgType::File{types,..}=>file(&mut e,OTHER,types),_=>unreachable!(),
                }};
                let sample=match sample{Ok(v)=>v,Err(error)=>{out.unsupported.insert(error);continue;}};
                let Some(mut args)=arguments(&p.args,0)else{out.unsupported.insert(format!("{}: asset challenge needs remaining argument fixtures",p.name));continue;};
                args.insert(arg.clone(),sample.clone());
                out.attempted+=1;*out.operations.entry(p.name.clone()).or_default()+=1;
                match e.mutate(&p.name,None,Context::new(VIEWER,args).at(NOW)){
                    Ok(result) if matches!(result.state,snapback4_core::WriteState::Failed{..})=>out.refused+=1,
                    Ok(_)=>{if let Ok(rows)=readback(&e)&&rows.values().flatten().any(|row|contains(row,&sample)){
                        out.boundary_failures.push(format!("{} placed {mode} through argument {arg}",p.name));
                    }},
                    Err(error)=>{out.unsupported.insert(format!("{}: asset challenge engine error {error}",p.name));},
                }
            }
        }
    }
}

//! Qualification-only type metadata for exact counterexample correspondence.
use std::collections::BTreeMap;
fn main(){
    let root=std::path::PathBuf::from(std::env::args_os().nth(1).expect("schema directory"));
    let mut files=std::fs::read_dir(root).unwrap().map(|e|e.unwrap().path()).filter(|p|p.extension().is_some_and(|e|e=="q")).collect::<Vec<_>>();files.sort();
    let sources=files.iter().map(|p|(p.file_name().unwrap().to_string_lossy().into_owned(),std::fs::read_to_string(p).unwrap())).collect::<Vec<_>>();
    let bound=snapback4_lang::compile(&sources);assert!(bound.diagnostics.is_empty(),"metadata requires a compiled survey schema");
    let columns=bound.schema.tables.iter().map(|(t,s)|(t,s.columns.iter().filter(|(_,k)|k.contains_asset()).collect::<BTreeMap<_,_>>())).collect::<BTreeMap<_,_>>();
    let arguments=bound.programs.iter().map(|p|(&p.program.name,p.program.args.iter().filter_map(|(a,k)|snapback4_core::schema::arg_as_column(k).filter(|k|k.contains_asset()).map(|k|(a,k))).collect::<BTreeMap<_,_>>())).collect::<BTreeMap<_,_>>();
    println!("{}",serde_json::json!({"columns":columns,"arguments":arguments}));
}

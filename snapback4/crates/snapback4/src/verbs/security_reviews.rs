//! Individually justified source-bound dispositions; never proof or authority.
// @ref LLP 3000.036.004#162-narrow-gates-and-individual-dispositions — bulk compiler-note review cannot clear security gates.
use super::*;
use serde::{Serialize,Deserialize};
use sha2::{Digest,Sha256};
const ANALYZER:&str="sec10-wave28-1";

mod binding;
mod decisions;
#[derive(Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
struct File{version:u32,entries:BTreeMap<String,Entry>}
#[derive(Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
struct Entry{sources:String,analyzer:String,reason:String}
#[derive(Clone,Serialize)]
pub(super) struct Disposition{pub family:Option<String>,pub id:String,pub code:String,pub site:String,pub gated:bool,pub acknowledged:bool,pub reason:Option<String>,pub scope:String}
pub(super) fn gated(code:&str)->bool{snapback4_lang::security::gated_note(code)}
fn hash(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
fn digest(s:&str)->bool{s.len()==64&&s.bytes().all(|b|b.is_ascii_hexdigit())}
pub(super) fn review(project:&Project,sources:&[(String,String)],notes:&[snapback4_lang::Diagnostic],ack:Option<(&str,&str)>)->Result<Vec<Disposition>,String>{
    review_inner(project,sources,notes,ack,false)
}
/// Read-only decisions for a caller-validated immutable saved-source selection.
pub(super) fn review_snapshot(project:&Project,sources:&[(String,String)],notes:&[snapback4_lang::Diagnostic])->Result<Vec<Disposition>,String>{
    review_inner(project,sources,notes,None,true)
}
// @ref LLP 3000.036.004.000#11-wave-27-precision-and-workflow-conservation — one decision snapshot binds replay priority and disposition.
pub(super) struct ReviewSnapshot{file:File}
impl ReviewSnapshot{
    pub(super) fn capture(project:&Project)->Result<Self,String>{Ok(Self{file:read_file(project)?})}
    pub(super) fn has_decisions(&self)->bool{!self.file.entries.is_empty()}
    pub(super) fn dispositions(&self,sources:&[(String,String)],notes:&[snapback4_lang::Diagnostic])->Vec<Disposition>{dispositions(&self.file,notes,binding::identities(notes,sources))}
    pub(super) fn ensure_current(&self,project:&Project)->Result<(),String>{
        if read_file(project)?!=self.file{return Err("security review decisions changed during deployment preflight; rerun this deploy command to replay current individual decisions".into());}Ok(())
    }
}
fn read_file(project:&Project)->Result<File,String>{
    let file:File=match std::fs::read(project.schema_dir().join("security-reviews.json")){
        Ok(bytes)=>serde_json::from_slice(&bytes).map_err(|_|"invalid snapback/security-reviews.json; expected version 1 with per-note source/analyzer/reason records".to_string())?,
        Err(e) if e.kind()==std::io::ErrorKind::NotFound=>File{version:1,entries:BTreeMap::new()},
        Err(e)=>return Err(format!("cannot read security dispositions: {e}")),
    };
    if file.version!=1||file.entries.iter().any(|(key,e)|!digest(key)||!digest(&e.sources)||e.reason.trim().is_empty()||e.analyzer.is_empty()){return Err("invalid security disposition version/digest/reason".into());}
    Ok(file)
}
fn review_inner(project:&Project,sources:&[(String,String)],notes:&[snapback4_lang::Diagnostic],ack:Option<(&str,&str)>,snapshot:bool)->Result<Vec<Disposition>,String>{
    if !snapshot&&project.sources().map_err(|e|e.to_string())?!=sources{return Err("Quarry sources changed during security review; rerun check".into());}
    let identities=binding::identities(notes,sources);
    let path=project.schema_dir().join("security-reviews.json");
    // Keep the lock inode in ignored generated output. Do not unlink a lock
    // while another process can be waiting on that inode. Kernel ownership
    // releases it on exit, including an interrupted writer.
    let _writer_lock=if ack.is_some(){
        let directory=project.schema_dir().join("generated");
        std::fs::create_dir_all(&directory).map_err(|e|format!("cannot create security review lock directory: {e}"))?;
        let lock=std::fs::OpenOptions::new().create(true).truncate(false).read(true).write(true).open(directory.join("security-reviews.lock")).map_err(|e|format!("cannot open security review lock: {e}"))?;
        lock.lock().map_err(|e|format!("cannot acquire security review lock: {e}"))?;Some(lock)
    }else{None};
    if !snapshot&&project.sources().map_err(|e|e.to_string())?!=sources{return Err("Quarry sources changed while waiting for security review; rerun check".into());}
    let mut file=read_file(project)?;
    if let Some((key,reason))=ack{
        if reason.trim().is_empty(){return Err("--reason needs the specification rationale for this individual note".into());}
        let selected=if key.starts_with("audience:") {
            let Some(family)=decisions::family(notes,&identities) else {return Err("no current advisory audience family; run check --json".into());};
            if family!=key{return Err("stale or unknown audience family; rerun check and review the current members".into());}
            identities.iter().zip(notes).filter(|(_,note)|decisions::audience(&note.code)).map(|(identity,_)|identity).collect::<Vec<_>>()
        } else {
            vec![identities.iter().find(|(id,_,_)|id==key).ok_or_else(||"--ack-security ID is not a current security note; run check --json".to_string())?]
        };
        for (id,fingerprint,_) in selected {
            file.entries.insert(id.clone(),Entry{sources:fingerprint.clone(),analyzer:ANALYZER.into(),reason:reason.trim().into()});
        }
        let temporary=path.with_extension(format!("json.{}.tmp",std::process::id()));
        let result=std::fs::write(&temporary,serde_json::to_vec_pretty(&file).unwrap()).and_then(|_|{
            if project.sources()?!=sources{return Err(std::io::Error::other("Quarry sources changed before disposition publication; rerun check"));}
            std::fs::rename(&temporary,&path)
        });
        if let Err(e)=result{let _=std::fs::remove_file(&temporary);return Err(format!("cannot record security disposition: {e}"));}
    }
    Ok(dispositions(&file,notes,identities))
}
fn dispositions(file:&File,notes:&[snapback4_lang::Diagnostic],identities:Vec<(String,String,String)>)->Vec<Disposition>{
    let family=decisions::family(notes,&identities);
    notes.iter().zip(identities).map(|(n,(key,fingerprint,scope))|{let entry=file.entries.get(&key).filter(|e|e.sources==fingerprint&&e.analyzer==ANALYZER);
        Disposition{family:decisions::audience(&n.code).then(||family.clone()).flatten(),id:key,code:n.code.clone(),site:n.site.to_string(),gated:gated(&n.code),acknowledged:entry.is_some(),scope,reason:entry.map(|e|e.reason.clone())}
    }).collect()
}
pub(super) fn pending(dispositions:&[Disposition])->bool{dispositions.iter().any(|d|d.gated&&!d.acknowledged)}
pub(super) use decisions::{print,render,count as decision_count};
#[cfg(test)]mod tests{
use super::*;
pub(super) struct Scratch(pub(super) std::path::PathBuf);impl Drop for Scratch{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
#[test]fn individual_source_and_diagnostic_bound_dispositions(){
 let root=std::env::temp_dir().join(format!("sb4-sec7-dispositions-{}",std::process::id()));std::fs::create_dir_all(root.join("snapback")).unwrap();
 let _scratch=Scratch(root.clone());let p=Project{root:root.clone()};std::fs::write(p.schema_dir().join("schema.q"),"query q():\n  return true\n").unwrap();let sources=p.sources().unwrap();
 let a=snapback4_lang::Diagnostic::new(&Default::default(),"N_OPTIONAL_UPLOAD_CREATE","a","");let b=snapback4_lang::Diagnostic::new(&Default::default(),"N_RETAINED_ROLE_GRANT","b","");let notes=[a.clone(),b];let key=binding::identities(&notes,&sources)[0].0.clone();
 assert!(review(&p,&sources,&notes,Some((&key,"  "))).is_err());assert!(review(&p,&sources,&notes,Some(("unknown","intended"))).is_err());
 let ds=review(&p,&sources,&notes,Some((&key,"the specification allows optional draft evidence"))).unwrap();assert!(ds[0].acknowledged);assert!(!ds[1].acknowledged);assert!(pending(&ds));
 let changed=[snapback4_lang::Diagnostic::new(&Default::default(),"N_OPTIONAL_UPLOAD_CREATE","changed","")];assert!(!review(&p,&sources,&changed,None).unwrap()[0].acknowledged);
 let path=p.schema_dir().join("security-reviews.json");let mut f:File=serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();for old in ["sec7-2","sec7-3","sec7-4","sec7-5","sec7-6","sec7-7","sec7-8","sec7-9","sec9-1","sec9-2","sec10-1","sec10-2","sec10-3","sec10-4","sec10-5","sec10-6","sec10-7","sec10-8","sec10-9","sec10-10","sec10-11","sec10-12","sec10-13","sec10-14","sec10-15","sec10-16","sec10-17"]{f.entries.get_mut(&key).unwrap().analyzer=old.into();std::fs::write(&path,serde_json::to_vec(&f).unwrap()).unwrap();assert!(!review(&p,&sources,&notes,None).unwrap()[0].acknowledged);}
 std::fs::write(p.schema_dir().join("schema.q"),"query q():\n  return false\n").unwrap();assert!(review(&p,&sources,&notes,Some((&key,"intended"))).is_err());assert!(!review(&p,&p.sources().unwrap(),&notes,None).unwrap()[0].acknowledged);
 std::fs::write(&path,"{}").unwrap();assert!(review(&p,&p.sources().unwrap(),&notes,None).is_err());std::fs::remove_dir_all(root).unwrap();
}
#[test]fn deployment_decisions_are_immutable_and_detect_semantic_changes(){
 let root=std::env::temp_dir().join(format!("sb4-sec10-review-snapshot-{}",std::process::id()));std::fs::create_dir_all(root.join("snapback")).unwrap();let _scratch=Scratch(root.clone());let p=Project{root};
 std::fs::write(p.schema_dir().join("schema.q"),"query q():\n  return true\n").unwrap();let sources=p.sources().unwrap();
 let notes=vec![snapback4_lang::Diagnostic::new(&Default::default(),"N_DERIVED_WRITE_AUTHORITY","docs.cell: individual alternative","confirm")];
 let empty=ReviewSnapshot::capture(&p).unwrap();assert!(!empty.has_decisions());
 let id=review(&p,&sources,&notes,None).unwrap()[0].id.clone();review(&p,&sources,&notes,Some((&id,"manual override is deliberate"))).unwrap();
 assert!(!empty.dispositions(&sources,&notes)[0].acknowledged);assert!(empty.ensure_current(&p).unwrap_err().contains("rerun this deploy"));
 let saved=ReviewSnapshot::capture(&p).unwrap();assert!(saved.dispositions(&sources,&notes)[0].acknowledged);
 let path=p.schema_dir().join("security-reviews.json");let file=read_file(&p).unwrap();std::fs::write(&path,serde_json::to_vec(&file).unwrap()).unwrap();saved.ensure_current(&p).unwrap();
 std::fs::remove_file(&path).unwrap();assert!(saved.dispositions(&sources,&notes)[0].acknowledged);assert!(saved.ensure_current(&p).is_err());
 std::fs::write(&path,"{}").unwrap();assert!(ReviewSnapshot::capture(&p).is_err());
}
#[test]fn repeated_advisories_are_individually_reviewed_and_survive_comments(){
 let root=std::env::temp_dir().join(format!("sb4-sec8-advisory-{}",std::process::id()));std::fs::create_dir_all(root.join("snapback")).unwrap();let _scratch=Scratch(root.clone());let p=Project{root};
 let text="query q():\n  return true\n";std::fs::write(p.schema_dir().join("schema.q"),text).unwrap();
 let mut n=snapback4_lang::Diagnostic::new(&snapback4_lang::Site::new("schema.q",2,3),"N_ROLE_WIDE_READ","q.read: reviewed audience","confirm spec");let notes=vec![n.clone(),n.clone()];
 let ds=review(&p,&p.sources().unwrap(),&notes,None).unwrap();assert_ne!(ds[0].id,ds[1].id);
 let ds=review(&p,&p.sources().unwrap(),&notes,Some((&ds[0].id,"Specification allows this audience"))).unwrap();assert!(ds[0].acknowledged);assert!(!ds[1].acknowledged);assert!(!pending(&ds));
 std::fs::write(p.schema_dir().join("schema.q"),format!("-- comment\n{text}")).unwrap();n.site.line+=1;
 let ds=review(&p,&p.sources().unwrap(),&[n.clone(),n],None).unwrap();assert!(ds[0].acknowledged);assert!(!ds[1].acknowledged);
}

}

#[cfg(test)] mod family_tests {
 use super::*;
 #[test] fn audience_command_records_current_members_but_never_gates_or_changed_families() {
  let root=std::env::temp_dir().join(format!("sb4-dx9-family-{}",std::process::id()));
  std::fs::create_dir_all(root.join("snapback")).unwrap();let _scratch=super::tests::Scratch(root.clone());
  let p=Project{root};std::fs::write(p.schema_dir().join("schema.q"),"query q():\n  return true\n").unwrap();let sources=p.sources().unwrap();
  let n=|code:&str,message:&str|snapback4_lang::Diagnostic::new(&Default::default(),code,message,"confirm");
  let notes=vec![n("N_ROLE_WIDE_READ","notes.read: audience A"),n("N_ROLE_WIDE_WRITE","notes.write: audience B"),n("N_PRESENCE_LOOSENING","gate")];
  let ds=review(&p,&sources,&notes,None).unwrap();let family=ds[0].family.clone().unwrap();assert_eq!(ds[1].family.as_ref(),Some(&family));assert!(ds[2].family.is_none());
  let recorded=review(&p,&sources,&notes,Some((&family,"The specification admits both audiences"))).unwrap();
  assert!(recorded[0].acknowledged&&recorded[1].acknowledged);assert!(!recorded[2].acknowledged);assert!(pending(&recorded));
  let mut changed=notes.clone();changed.push(n("N_BROAD_READ","extra.read: another audience"));
  assert!(review(&p,&sources,&changed,Some((&family,"old decision"))).is_err());
  assert!(review(&p,&sources,&notes,Some((&family,"  "))).is_err());
 }
}

//! Individually justified dispositions; current evidence is never runtime authority.
// @ref LLP 3000.036.004#162-narrow-gates-and-individual-dispositions — bulk compiler-note review cannot clear security gates.
use super::*;
use serde::{Serialize,Deserialize};
use sha2::{Digest,Sha256};
const ANALYZER:&str="sec10-wave28-dx11-1";
mod binding;
pub(super) mod witness;
mod decisions;
#[derive(Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
struct File{version:u32,entries:BTreeMap<String,Entry>}
#[derive(Serialize,Deserialize,PartialEq,Eq)]
#[serde(deny_unknown_fields)]
struct Entry{sources:String,analyzer:String,reason:String,#[serde(default,skip_serializing_if="Option::is_none")] witness:Option<serde_json::Value>}
#[derive(Clone,Serialize)]
pub(super) struct Disposition{pub family:Option<String>,pub id:String,pub code:String,pub site:String,pub gated:bool,pub acknowledged:bool,pub recorded:bool,pub reason:Option<String>,pub scope:String,pub witness:Option<serde_json::Value>}
pub(super) fn gated(code:&str)->bool{snapback4_lang::security::gated_note(code)}
fn hash(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
fn digest(s:&str)->bool{s.len()==64&&s.bytes().all(|b|b.is_ascii_hexdigit())}
pub(super) fn review(project:&Project,sources:&[(String,String)],notes:&[snapback4_lang::Diagnostic],ack:Option<(&str,&str)>)->Result<Vec<Disposition>,String>{
    review_inner(project,sources,notes,ack,false,&[])
}
/// Read-only decisions for a caller-validated immutable saved-source selection.
pub(super) fn review_snapshot(project:&Project,sources:&[(String,String)],notes:&[snapback4_lang::Diagnostic])->Result<Vec<Disposition>,String>{
    review_inner(project,sources,notes,None,true,&[])
}
// @ref LLP 3000.036.004.000#11-wave-27-precision-and-workflow-conservation — one decision snapshot binds replay priority and disposition.
pub(super) struct ReviewSnapshot{file:File}
impl ReviewSnapshot{
    pub(super) fn capture(project:&Project)->Result<Self,String>{Ok(Self{file:read_file(project)?})}
    pub(super) fn has_decisions(&self)->bool{!self.file.entries.is_empty()}
    pub(super) fn dispositions(&self,sources:&[(String,String)],notes:&[snapback4_lang::Diagnostic])->Vec<Disposition>{self.dispositions_with_evidence(sources,notes,&[])}
    pub(super) fn dispositions_with_evidence(&self,sources:&[(String,String)],notes:&[snapback4_lang::Diagnostic],evidence:&[Option<serde_json::Value>])->Vec<Disposition>{dispositions(&self.file,notes,witness::identities(notes,sources,evidence),&Default::default(),evidence)}
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
pub(super) fn review_evidence(project:&Project,sources:&[(String,String)],notes:&[snapback4_lang::Diagnostic],ack:Option<(&str,&str)>,evidence:&[Option<serde_json::Value>])->Result<Vec<Disposition>,String>{
    review_inner(project,sources,notes,ack,false,evidence)
}
fn review_inner(project:&Project,sources:&[(String,String)],notes:&[snapback4_lang::Diagnostic],ack:Option<(&str,&str)>,snapshot:bool,evidence:&[Option<serde_json::Value>])->Result<Vec<Disposition>,String>{
    if !snapshot&&project.sources().map_err(|e|e.to_string())?!=sources{return Err("Quarry sources changed during security review; rerun check".into());}
    let identities=witness::identities(notes,sources,evidence);
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
    let mut recorded=std::collections::BTreeSet::new();
    if let Some((key,reason))=ack{
        // Validate the complete batch against the same captured source/note set.
        // Nothing is published when even one member is stale or unknown.
        let mut selected=std::collections::BTreeSet::new();
        for key in key.split(',').map(str::trim) {
            if key.starts_with("audience:") {
                let Some(family)=decisions::family(notes,&identities) else {return Err("no current advisory audience family; run check --review --json".into());};
                if family==key {
                    selected.extend(notes.iter().enumerate().filter(|(_,note)|decisions::audience(&note.code)).map(|(i,_)|i));
                } else {
                    let history: BTreeMap<String,Vec<(String,String)>>=std::fs::read(project.schema_dir().join("generated/security-families.json")).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or_default();
                    let members=history.get(key).ok_or("stale or unknown audience family: rerun check --review; existing individual decisions are preserved")?;
                    for (id,fingerprint) in members {
                        let index=identities.iter().enumerate().find(|(i,(current,binding,_))|current==id&&binding==fingerprint&&decisions::audience(&notes[*i].code)).map(|(i,_)|i).ok_or("stale audience family member: a relevant rule changed or disappeared; no decisions recorded; run check --review")?;
                        selected.insert(index);
                    }
                }
            } else {
                let index=identities.iter().position(|(id,_,_)|id==key).ok_or_else(||format!("--ack-security {key} is stale, belongs to another source selection, or is not a decision ID. Use securityReviews[].id from `check --review --json` (not a diagnostic code or invariant site); repeated --ack-security ID or comma-separated IDs share one --reason"))?;
                selected.insert(index);
            }
        }
        recorded=selected.clone();
        for index in selected {
            let (id,fingerprint,_)=&identities[index];
            if let Some(value)=evidence.get(index).and_then(Option::as_ref){witness::validate_reason(reason,value)?;}
            if reason.trim().is_empty(){return Err("--reason needs the specification rationale for this individual note".into());}
            file.entries.insert(id.clone(),Entry{sources:fingerprint.clone(),analyzer:ANALYZER.into(),reason:reason.trim().into(),witness:evidence.get(index).cloned().flatten()});
        }
        let temporary=path.with_extension(format!("json.{}.tmp",std::process::id()));
        let result=std::fs::write(&temporary,serde_json::to_vec_pretty(&file).unwrap()).and_then(|_|{
            if project.sources()?!=sources{return Err(std::io::Error::other("Quarry sources changed before disposition publication; rerun check"));}
            std::fs::rename(&temporary,&path)
        });
        if let Err(e)=result{let _=std::fs::remove_file(&temporary);return Err(format!("cannot record security disposition: {e}"));}
    }
    if !snapshot{remember_family_identities(project,notes,&identities);}
    Ok(dispositions(&file,notes,identities,&recorded,evidence))
}
// Display history is generated evidence only; it cannot change captured decisions.
pub(super) fn remember_families(project:&Project,sources:&[(String,String)],notes:&[snapback4_lang::Diagnostic]){remember_family_identities(project,notes,&binding::identities(notes,sources));}
fn remember_family_identities(project:&Project,notes:&[snapback4_lang::Diagnostic],identities:&[(String,String,String)]){
    let family=decisions::family(notes,identities);
    if let Some(family)=&family {
        let path=project.schema_dir().join("generated/security-families.json");
        let mut history:BTreeMap<String,Vec<(String,String)>>=std::fs::read(&path).ok().and_then(|b|serde_json::from_slice(&b).ok()).unwrap_or_default();
        history.insert(family.clone(),identities.iter().zip(notes).filter(|(_,n)|decisions::audience(&n.code)).map(|((id,binding,_),_)|(id.clone(),binding.clone())).collect());
        let temporary=path.with_extension(format!("{}.tmp",std::process::id()));
        let _=std::fs::create_dir_all(path.parent().unwrap());
        if std::fs::write(&temporary,serde_json::to_vec(&history).unwrap()).is_ok(){let _=std::fs::rename(&temporary,&path);}let _=std::fs::remove_file(temporary);
    }
}
fn dispositions(file:&File,notes:&[snapback4_lang::Diagnostic],identities:Vec<(String,String,String)>,recorded:&std::collections::BTreeSet<usize>,evidence:&[Option<serde_json::Value>])->Vec<Disposition>{
    let family=decisions::family(notes,&identities);
    notes.iter().zip(identities).enumerate().map(|(i,(n,(key,fingerprint,scope)))|{let entry=file.entries.get(&key).filter(|e|witness::retained(e,&fingerprint,evidence.get(i).and_then(Option::as_ref)));
        Disposition{family:decisions::audience(&n.code).then(||family.clone()).flatten(),id:key,code:n.code.clone(),site:n.site.to_string(),gated:witness::gate(&n.code,evidence.get(i).and_then(Option::as_ref)),acknowledged:entry.is_some(),recorded:recorded.contains(&i),scope,reason:entry.map(|e|e.reason.clone()),witness:evidence.get(i).cloned().flatten().or_else(||entry.and_then(|e|e.witness.clone()))}
    }).collect()
}

pub(super) fn pending(dispositions:&[Disposition])->bool{dispositions.iter().any(|d|d.gated&&!d.acknowledged)}
pub(super) use decisions::{print,render,render_mode,count as decision_count};
#[cfg(test)]mod tests{
use super::*;
pub(super) struct Scratch(pub(super) std::path::PathBuf);impl Drop for Scratch{fn drop(&mut self){let _=std::fs::remove_dir_all(&self.0);}}
#[test]fn individual_source_and_diagnostic_bound_dispositions(){
 let root=std::env::temp_dir().join(format!("sb4-sec7-dispositions-{}",std::process::id()));std::fs::create_dir_all(root.join("snapback")).unwrap();
 let _scratch=Scratch(root.clone());let p=Project{root:root.clone()};std::fs::write(p.schema_dir().join("schema.q"),"query q():\n  return true\n").unwrap();let sources=p.sources().unwrap();
 let a=snapback4_lang::Diagnostic::new(&Default::default(),"N_OPTIONAL_UPLOAD_CREATE","a","");let b=snapback4_lang::Diagnostic::new(&Default::default(),"N_RETAINED_ROLE_GRANT","b","");let notes=[a.clone(),b];let key=binding::identities(&notes,&sources)[0].0.clone();
 assert!(review(&p,&sources,&notes,Some((&key,"  "))).is_err());assert!(review(&p,&sources,&notes,Some(("unknown","intended"))).is_err());
 let ds=review(&p,&sources,&notes,Some((&key,"the specification allows optional draft evidence"))).unwrap();assert!(ds[0].acknowledged);assert!(!ds[1].acknowledged);assert!(!pending(&ds),"static questions without witnesses remain advice");
 let changed=[snapback4_lang::Diagnostic::new(&Default::default(),"N_OPTIONAL_UPLOAD_CREATE","changed","")];assert!(!review(&p,&sources,&changed,None).unwrap()[0].acknowledged);
 let path=p.schema_dir().join("security-reviews.json");let mut f:File=serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();for old in ["sec7-2","sec7-3","sec7-4","sec7-5","sec7-6","sec7-7","sec7-8","sec7-9","sec9-1","sec9-2","sec10-1","sec10-2","sec10-3","sec10-4","sec10-5","sec10-6","sec10-7","sec10-8","sec10-9","sec10-10","sec10-11","sec10-12","sec10-13","sec10-14","sec10-15","sec10-16","sec10-17","sec9-3","sec10-wave28-1","sec11-1"]{f.entries.get_mut(&key).unwrap().analyzer=old.into();std::fs::write(&path,serde_json::to_vec(&f).unwrap()).unwrap();assert!(!review(&p,&sources,&notes,None).unwrap()[0].acknowledged);}
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
#[test]fn captured_decisions_retain_their_recorded_witness(){
 let root=std::env::temp_dir().join(format!("sb4-sec10-witness-snapshot-{}",std::process::id()));std::fs::create_dir_all(root.join("snapback")).unwrap();let _scratch=Scratch(root.clone());let p=Project{root};
 std::fs::write(p.schema_dir().join("schema.q"),"query q():\n  return true\n").unwrap();let sources=p.sources().unwrap();
 let notes=vec![snapback4_lang::Diagnostic::new(&Default::default(),"N_DERIVED_WRITE_AUTHORITY","docs.value: individual alternative","confirm")];let id=review(&p,&sources,&notes,None).unwrap()[0].id.clone();
 let evidence=vec![Some(serde_json::json!({"operation":"create","value":1}))];
 review_evidence(&p,&sources,&notes,Some((&id,"This manual override is deliberate")),&evidence).unwrap();let saved=ReviewSnapshot::capture(&p).unwrap();let ds=saved.dispositions(&sources,&notes);assert!(ds[0].acknowledged);assert!(!ds[0].recorded);assert_eq!(ds[0].witness,evidence[0]);
 review_evidence(&p,&sources,&notes,Some((&id,"A different reviewed decision")),&[Some(serde_json::json!({"operation":"create","value":2}))]).unwrap();assert!(saved.ensure_current(&p).is_err());assert_eq!(saved.dispositions(&sources,&notes)[0].witness,evidence[0]);
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
 #[test]fn snapshot_display_history_cannot_acknowledge_a_new_family_member(){
  let root=std::env::temp_dir().join(format!("sb4-sec10-snapshot-family-{}",std::process::id()));std::fs::create_dir_all(root.join("snapback")).unwrap();let _scratch=super::tests::Scratch(root.clone());let p=Project{root};
  std::fs::write(p.schema_dir().join("schema.q"),"query q():\n  return true\n").unwrap();let sources=p.sources().unwrap();let first=vec![snapback4_lang::Diagnostic::new(&Default::default(),"N_ROLE_WIDE_READ","docs.read: original audience","confirm")];
  let saved=ReviewSnapshot::capture(&p).unwrap();let family=saved.dispositions(&sources,&first)[0].family.clone().unwrap();remember_families(&p,&sources,&first);
  let mut later=first.clone();later.push(snapback4_lang::Diagnostic::new(&Default::default(),"N_BROAD_READ","extra.read: new audience","confirm"));let now=review(&p,&sources,&later,Some((&family,"The original audience is deliberate"))).unwrap();assert!(now[0].acknowledged);assert!(!now[1].acknowledged);assert!(saved.dispositions(&sources,&later).iter().all(|d|!d.acknowledged));assert!(saved.ensure_current(&p).is_err());
 }

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
  let retained=review(&p,&sources,&changed,Some((&family,"old decision"))).unwrap();
  assert!(retained[0].acknowledged&&retained[1].acknowledged);assert!(!retained[2].acknowledged&&!retained[3].acknowledged);
  assert!(review(&p,&sources,&notes,Some((&family,"  "))).is_err());
 }
}

#[cfg(test)]mod sec11_tests {
 use super::*;
 #[test]fn every_invalid_witness_answer_prints_the_replay_and_preserves_the_file(){
  let root=std::env::temp_dir().join(format!("sb4-sec11-refusal-{}",std::process::id()));std::fs::create_dir_all(root.join("snapback")).unwrap();let _scratch=super::tests::Scratch(root.clone());let p=Project{root};
  std::fs::write(p.schema_dir().join("schema.q"),"query q():\n  return true\n").unwrap();let sources=p.sources().unwrap();
  let notes=[snapback4_lang::Diagnostic::new(&Default::default(),"N_OPTIONAL_EVIDENCE","docs.scan: presence","require scan")];
  let value=witness::stamp(json!({"candidate":"question: missing evidence","operation":"create","viewer":"dev:clerk","effect":"insert","history":[{"operation":"create","viewer":"dev:clerk","state":"sent"}],"reachability":"generated-fixture-trace","summary":"create as dev:clerk -> ok; scan=null"}));
  let evidence=[Some(value.clone())];let ds=review_evidence(&p,&sources,&notes,None,&evidence).unwrap();
  let path=p.schema_dir().join("security-reviews.json");
  for reason in ["","   ","the specification requires a scan","audience: managers only; intended effect: clerks must not create"]{
   let error=review_evidence(&p,&sources,&notes,Some((&ds[0].id,reason)),&evidence).err().expect("invalid answer");
   assert!(error.contains("create as dev:clerk -> ok; scan=null")&&error.contains(value["id"].as_str().unwrap()),"{error}");assert!(!path.exists());
  }
  let reason=format!("witness {}; permit create as dev:clerk; audience: clerks deliberately open drafts without scans",value["id"].as_str().unwrap());
  assert!(review_evidence(&p,&sources,&notes,Some((&ds[0].id,&reason)),&evidence).unwrap()[0].acknowledged);
  let saved=std::fs::read(&path).unwrap();
  assert!(review_evidence(&p,&sources,&notes,Some((&ds[0].id,"a different reason")),&evidence).is_err());assert_eq!(std::fs::read(path).unwrap(),saved);
 }
}

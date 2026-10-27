//! A stopped staging snapshot becomes a new, independently authenticated deployment.
// @ref LLP 3000.000.000.003#6-staging-snapshot-promotion-rel4-stretch-proposal — no source mutation, replacement, shared session authority or shared replica incarnation.
use super::{Options,Project};
use std::{fs,path::{Path,PathBuf}};
use serde_json::json;
struct Candidate(PathBuf,bool);
impl Drop for Candidate{fn drop(&mut self){if !self.1{let _=fs::remove_dir_all(&self.0);}}}
fn err(e:impl std::fmt::Display)->String{format!("E_PROMOTE: {e}")}

pub fn run(options:&Options)->i32 {
    match plan(options) {
        Ok(value)=>{if options.json{println!("{value}");}else{println!("promote verdict: READY; {}",if options.flags.contains_key("check"){ "preview only; destination not created" }else{"new production deployment created"});println!("release {}; accounts/data/assets/releases retained; inherited sessions revoked; users sign in again; destination {}",value["release"],value["destination"].as_str().unwrap_or(""));println!("{} inherited sessions revoked; clock: real time, unpaused, offset 0ms",value["promotion"]["revokedSessions"]);}0},
        Err(error)=>{if options.json{println!("{}",json!({"ok":false,"message":error}));}eprintln!("promote verdict: REFUSED\npromote: {error}");1},
    }
}
fn plan(options:&Options)->Result<serde_json::Value,String>{
    #[cfg(not(any(target_os="linux",target_os="macos")))]
    return Err(err("promotion requires Linux/macOS atomic no-replacement publication"));
    if options.positionals.len()!=2{return Err(err("usage: snapback4 promote <staging> <production> [--check]"));}
    let source=super::releases::existing_deployment(Path::new(&options.positionals[0]))?;
    crate::store_config::local_deployment(options,&source).map_err(|e|format!("{e}; promotion supports SQLite staging only"))?;
    let requested=Path::new(&options.positionals[1]);
    if fs::symlink_metadata(requested).is_ok(){return Err(err("destination already exists; choose a new production directory (existing empty directories are also refused)"));}
    let parent=requested.parent().filter(|p|!p.as_os_str().is_empty()).unwrap_or(Path::new(".")).canonicalize().map_err(err)?;
    let name=requested.file_name().ok_or_else(||err("destination needs a new directory name"))?;
    let destination=parent.join(name);
    if destination.starts_with(&source)||source.starts_with(&destination){return Err(err("source and destination must be separate, non-nested deployment directories"));}
    let _command=super::releases::command_lock(&source)?;
    let database=source.join("store.sqlite").canonicalize().map_err(err)?;
    let assets=database.parent().ok_or_else(||err("source store has no asset directory"))?.join("assets");
    if destination.starts_with(&assets)||assets.starts_with(&destination){return Err(err("destination must be outside the source store's retained asset tree, including for a SQLite alias"));}
    // Use the existing exclusion inode without creating a new source token,
    // owner record or address. Keep it locked until publication completes.
    let owner=snapback4_core::private_fs::auxiliary_file(&database,&snapback4_core::private_fs::owner_path(&database),false,0).map_err(|e|err(format!("source ownership unavailable: {e}; start and stop staging once, then retry")))?;
    owner.try_lock().map_err(|_|err(format!("source must be stopped; run `snapback4 stop {}` and retry",source.display())))?;
    let mut store=snapback4_core::store_port::AnyStore::open_read_only(&database).map_err(err)?;
    if store.deployment_environment().map_err(err)?.as_deref()!=Some("staging"){return Err(err("source must be a staging deployment; production/legacy stores cannot be promoted or relabelled"));}
    let wall=snapback4_core::now_ms();let clock=crate::dev_clock_store::staging_clock(&store,0,wall).map_err(err)?;
    if clock.paused||clock.offset!=0||clock.now>wall{return Err(err("staging clock is paused or ahead of real time; promotion never rebases timestamps; use a fresh real-time staging deployment"));}
    let held=store.release_status(0,None,None).map_err(err)?;
    let release=held["release"].as_u64().ok_or_else(||err("source has no persisted live release; deploy staging explicitly first"))?;
    let id=snapback4_core::ids::mint(wall,&mut snapback4_core::ids::Mint::default()).map_err(err)?;
    let candidate_path=parent.join(format!(".snapback4-promote-{id}"));
    #[cfg(unix)] {use std::os::unix::fs::DirBuilderExt;fs::DirBuilder::new().mode(0o700).create(&candidate_path).map_err(err)?;}
    #[cfg(not(unix))] {return Err(err("promotion requires a supported Unix no-replacement rename"));}
    let mut candidate=Candidate(candidate_path,false);
    store.snapshot_to(&candidate.0.join("store.sqlite"))?;drop(store);
    copy_tree(&source.join("releases"),&candidate.0.join("releases"),true)?;
    if assets.exists(){copy_tree(&assets,&candidate.0.join("assets"),false)?;}
    for entry in fs::read_dir(candidate.0.join("releases")).map_err(err)? {
        let path=entry.map_err(err)?.path();
        if path.file_name().and_then(|s|s.to_str()).and_then(|s|s.parse::<u64>().ok()).is_some(){
            let old=source.join("releases").join(path.file_name().unwrap());
            if crate::release_files::digest(&old)?!=crate::release_files::digest(&path)?{return Err(err("copied release digest differs from its immutable source"));}
            crate::release_files::link_store(&path)?;
        }
    }
    fs::write(candidate.0.join("current"),format!("{release}\n")).map_err(err)?;
    if source.join("releases.jsonl").is_file(){copy_file(&source.join("releases.jsonl"),&candidate.0.join("releases.jsonl"))?;}
    let provenance=json!({"source":source,"release":release,"generation":held["generation"],"revision":held["revision"],"clock":{"now":clock.now,"offset":clock.offset,"paused":clock.paused},"at":wall,"cliVersion":env!("CARGO_PKG_VERSION")});
    let mut copied=snapback4_core::store_port::AnyStore::open(&candidate.0.join("store.sqlite")).map_err(err)?;
    let promotion_wall=snapback4_core::now_ms();let final_clock=crate::dev_clock_store::staging_clock(&copied,0,promotion_wall).map_err(err)?;
    if final_clock.paused||final_clock.offset!=0||final_clock.now>promotion_wall{return Err(err("staging clock is ahead at publication preflight; retry with real-time staging; no timestamps were rebased"));}
    let mut provenance=provenance;provenance["at"]=json!(promotion_wall);provenance["clock"]=json!({"now":final_clock.now,"offset":final_clock.offset,"paused":final_clock.paused});
    let provenance=copied.promote_snapshot(provenance).map_err(err)?;drop(copied);
    let selected=candidate.0.join("releases").join(release.to_string());let project=Project{root:selected.clone()};
    let bound=super::releases::bound_at(selected.clone())?;
    crate::dev_worker::prepare_release(&project,&bound.schema)?;
    // Security analysis may write ignored campaign/family caches. Give it a
    // separate private project, never an immutable captured release tree.
    let checking_root=candidate.0.join(".promotion-check");copy_tree(&selected,&checking_root,true)?;
    let checking=Project{root:checking_root.clone()};let sources=checking.sources().map_err(err)?;
    let checked=super::releases::bound_at(checking_root.clone())?;
    let copied=snapback4_core::store_port::AnyStore::open(&candidate.0.join("store.sqlite")).map_err(err)?;
    let mut engine=project.open_release_engine(copied,&bound,release,promotion_wall).map_err(err)?;
    crate::native::install(&mut engine,&project).map_err(err)?;drop(engine);
    let mut strict=options.clone();strict.flags.insert("strict".into(),String::new());
    let security=super::security::release_loop(&checking,&checked,&sources,None,None,&strict)?;
    if let Err(error)=super::security::enforce_release(security.as_ref(),&strict){
        super::security::print_release(security.as_ref());
        return Err(format!("{error}; repair the named intent in the working staging source, redeploy staging, stop it, then retry promotion; immutable captured releases must not be edited"));
    }
    fs::remove_dir_all(checking_root).map_err(err)?;
    for entry in fs::read_dir(candidate.0.join("releases")).map_err(err)? {
        let path=entry.map_err(err)?.path();
        if path.file_name().and_then(|s|s.to_str()).and_then(|s|s.parse::<u64>().ok()).is_some()
            && crate::release_files::digest(&source.join("releases").join(path.file_name().unwrap()))?!=crate::release_files::digest(&path)? {
            return Err(err("production preflight changed immutable release artifacts; source/destination remain unchanged"));
        }
    }
    fs::write(candidate.0.join("promotion.json"),serde_json::to_vec_pretty(&provenance).unwrap()).map_err(err)?;
    let value=json!({"ok":true,"preview":options.flags.contains_key("check"),"release":release,"source":source,"destination":destination,"promotion":provenance});
    if options.flags.contains_key("check"){return Ok(value);}
    // Links to the shared store are excluded from release durability traversal;
    // every real byte and directory, including the SQLite snapshot, is flushed.
    durable(&candidate.0)?;
    no_replace(&candidate.0,&destination)?;
    candidate.1=true;
    fs::File::open(&parent).and_then(|f|f.sync_all()).map_err(|e|err(format!("destination {} may already be complete; inspect it before retrying; parent sync failed: {e}",destination.display())))?;
    Ok(value)
}
fn copy_file(source:&Path,destination:&Path)->Result<(),String>{
    if !fs::symlink_metadata(source).map_err(err)?.is_file(){return Err(err(format!("snapshot input must be a regular file: {}",source.display())));}
    fs::copy(source,destination).map_err(err)?;Ok(())
}
fn copy_tree(source:&Path,destination:&Path,releases:bool)->Result<(),String>{
    if !fs::symlink_metadata(source).map_err(err)?.is_dir(){return Err(err("snapshot input must be a real directory"));}
    fs::create_dir(destination).map_err(err)?;
    for entry in fs::read_dir(source).map_err(err)?{let entry=entry.map_err(err)?;
        if releases&&entry.file_name()==".snapback4"{continue;}
        let from=entry.path();let to=destination.join(entry.file_name());let kind=entry.file_type().map_err(err)?;
        if kind.is_dir(){copy_tree(&from,&to,releases)?;}else if kind.is_file(){copy_file(&from,&to)?;}else{return Err(err(format!("snapshot refuses symlink/special artifact {}",from.display())));}
    }Ok(())
}
fn durable(path:&Path)->Result<(),String>{
    for entry in fs::read_dir(path).map_err(err)?{let entry=entry.map_err(err)?;let kind=entry.file_type().map_err(err)?;
        if kind.is_dir(){durable(&entry.path())?;}else if kind.is_file(){fs::File::open(entry.path()).and_then(|f|f.sync_all()).map_err(err)?;}
        // Only the just-created relative release-store links are symlinks.
    }fs::File::open(path).and_then(|f|f.sync_all()).map_err(err)
}
fn no_replace(source:&Path,destination:&Path)->Result<(),String>{
    #[cfg(unix)] {use std::{ffi::CString,os::unix::ffi::OsStrExt};
        let from=CString::new(source.as_os_str().as_bytes()).map_err(err)?;let to=CString::new(destination.as_os_str().as_bytes()).map_err(err)?;
        #[cfg(target_os="linux")]
        let result=unsafe{libc::syscall(libc::SYS_renameat2,libc::AT_FDCWD,from.as_ptr(),libc::AT_FDCWD,to.as_ptr(),libc::RENAME_NOREPLACE)};
        #[cfg(target_os="macos")]
        let result=unsafe{libc::renamex_np(from.as_ptr(),to.as_ptr(),libc::RENAME_EXCL) as libc::c_long};
        #[cfg(any(target_os="linux",target_os="macos"))]
        {if result==0{return Ok(());}return Err(err(format!("destination was not replaced: {}",std::io::Error::last_os_error())));}
    }
    #[allow(unreachable_code)] Err(err("no supported atomic no-replacement rename on this host"))
}

#[cfg(test)]mod tests {
    use super::*;
    #[test]
    fn no_replace_never_overwrites_an_empty_or_populated_destination(){
        let root=std::env::temp_dir().join(format!("promotion-race-{}-{}",std::process::id(),snapback4_core::ids::seed()));fs::create_dir_all(&root).unwrap();
        let source=root.join("candidate");fs::create_dir(&source).unwrap();fs::write(source.join("kept"),b"original").unwrap();let target=root.join("target");fs::create_dir(&target).unwrap();
        assert!(no_replace(&source,&target).is_err());assert!(source.join("kept").is_file());fs::write(target.join("other"),b"other").unwrap();assert!(no_replace(&source,&target).is_err());assert_eq!(fs::read(target.join("other")).unwrap(),b"other");fs::remove_dir_all(target).unwrap();no_replace(&source,&root.join("published")).unwrap();assert_eq!(fs::read(root.join("published/kept")).unwrap(),b"original");fs::remove_dir_all(root).unwrap();
    }
}

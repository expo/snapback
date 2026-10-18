//! Keep qualification bound to the invocation's loaded image across rebuilds.
use std::{fs,path::Path};

pub(super) fn snapshot(destination:&Path)->Result<(),String>{
    #[cfg(target_os="linux")]
    {fs::copy("/proc/self/exe",destination).map(|_|()).map_err(|e|format!("private host image snapshot: {e}"))}
    #[cfg(target_os="macos")]
    {from_path(&std::env::current_exe().map_err(|e|e.to_string())?,destination)}
    #[cfg(not(any(target_os="linux",target_os="macos")))]
    {let _=destination;Err("private host image identity is unsupported on this platform; no HTTP qualification".into())}
}

#[cfg(target_os="macos")]
#[repr(C)]
struct RegionInfo {protection:[u32;4],offset:u64,counters:[u32;14],address:u64,size:u64}
#[cfg(target_os="macos")]
#[repr(C)]
struct RegionWithPath {region:RegionInfo,vnode:libc::vnode_info_path}

#[cfg(target_os="macos")]
fn from_path(source:&Path,destination:&Path)->Result<(),String>{
    use std::os::unix::fs::MetadataExt;
    let mut file=fs::File::open(source).map_err(|e|format!("private host image open: {e}"))?;
    let before=file.metadata().map_err(|e|e.to_string())?;
    // SDK sys/proc_info.h: PROC_PIDREGIONPATHINFO=8 returns the VM region's
    // backing vnode. A pathname may already name a replacement; its open fd
    // must match the vnode actually mapped as this process's Mach-O header.
    let header=unsafe{libc::_dyld_get_image_header(0)} as u64;
    if header==0{return Err("cannot locate the loaded private host image".into());}
    let mut loaded:RegionWithPath=unsafe{std::mem::zeroed()};
    let size=std::mem::size_of::<RegionWithPath>() as i32;
    let got=unsafe{libc::proc_pidinfo(std::process::id() as i32,8,header,&mut loaded as *mut _ as *mut _,size)};
    if got!=size||header<loaded.region.address||header-loaded.region.address>=loaded.region.size{
        return Err("cannot establish loaded private host vnode identity; retry after rebuild".into());
    }
    let stat=&loaded.vnode.vip_vi.vi_stat;
    if stat.vst_ino==0||stat.vst_ino!=before.ino()||stat.vst_dev as u64!=before.dev(){
        return Err("private host executable pathname was replaced; no HTTP qualification".into());
    }
    let mut out=fs::File::create(destination).map_err(|e|e.to_string())?;
    std::io::copy(&mut file,&mut out).map_err(|e|e.to_string())?;
    out.set_permissions(before.permissions()).map_err(|e|e.to_string())?;
    let after=file.metadata().map_err(|e|e.to_string())?;
    if (before.len(),before.mtime(),before.mtime_nsec(),before.ctime(),before.ctime_nsec())!=(after.len(),after.mtime(),after.mtime_nsec(),after.ctime(),after.ctime_nsec()){
        return Err("private host executable changed while snapshotting; no HTTP qualification".into());
    }
    Ok(())
}

#[cfg(all(test,target_os="macos"))]
mod tests{
    use super::*;
    use std::{process::{Command,Stdio},time::{Duration,Instant}};
    #[test]fn replaced_path_cannot_qualify_a_different_image(){
        if let Some(root)=std::env::var_os("SNAPBACK4_SECURITY_IMAGE_CHILD"){
            let root=std::path::PathBuf::from(root);fs::write(root.join("ready"),"").unwrap();
            let until=Instant::now()+Duration::from_secs(15);
            while !root.join("go").exists(){assert!(Instant::now()<until);std::thread::sleep(Duration::from_millis(20));}
            assert!(from_path(&root.join("running"),&root.join("snapshot")).is_err());return;
        }
        let root=std::env::temp_dir().join(format!("sb4-security-image-{}",std::process::id()));
        fs::create_dir(&root).unwrap();let scratch=super::super::Scratch(root);
        let original=std::env::current_exe().unwrap();let running=scratch.0.join("running");
        // Control proves that the normal path is identified before testing a
        // real child whose executable pathname is replaced after exec.
        from_path(&original,&scratch.0.join("control")).unwrap();fs::copy(&original,&running).unwrap();
        let mut child=super::super::Process(Command::new(&running).args(["--exact","verbs::security::http::image::tests::replaced_path_cannot_qualify_a_different_image","--nocapture"])
            .env("SNAPBACK4_SECURITY_IMAGE_CHILD",&scratch.0).stdout(Stdio::null()).stderr(Stdio::null()).spawn().unwrap());
        let until=Instant::now()+Duration::from_secs(15);
        while !scratch.0.join("ready").exists(){assert!(Instant::now()<until);assert!(child.0.try_wait().unwrap().is_none());std::thread::sleep(Duration::from_millis(20));}
        fs::rename(&running,scratch.0.join("old")).unwrap();fs::write(&running,b"replacement image").unwrap();fs::write(scratch.0.join("go"),"").unwrap();
        super::super::wait(&mut child,Duration::from_secs(15)).unwrap();
    }
}

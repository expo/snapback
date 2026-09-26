use super::*;
use std::os::unix::fs::symlink;

#[test]
fn address_records_reject_links_nonfiles_stale_and_wrong_project() {
    let root = std::env::temp_dir().join(format!("sb4-address-{}", std::process::id()));
    fs::create_dir_all(&root).unwrap();
    let project = Project { root: root.clone() };
    let registration = Registration::new(&project, 12345, "identity".into(), true).unwrap();
    assert_eq!(read(&project).len(), 1);
    let path = registration.path.clone();
    let target = root.join("external");
    fs::rename(&path, &target).unwrap();
    symlink(&target, &path).unwrap();
    let before = fs::read(&target).unwrap();
    assert!(read(&project).is_empty(), "reader must not follow symlinks");
    assert!(Registration::new(&project, 12345, "other".into(), true).is_err());
    assert_eq!(fs::read(&target).unwrap(), before, "writer must not follow symlinks");
    fs::remove_file(&path).unwrap();
    fs::hard_link(&target, &path).unwrap();
    assert!(read(&project).is_empty(), "reader must reject multiple links");
    assert!(Registration::new(&project, 12345, "other".into(), true).is_err());
    assert_eq!(fs::read(&target).unwrap(), before);
    fs::remove_file(&path).unwrap();
    fs::create_dir(&path).unwrap();
    assert!(read(&project).is_empty());
    assert!(Registration::new(&project, 12345, "other".into(), true).is_err());
    fs::remove_dir(&path).unwrap();
    let cpath = std::ffi::CString::new(path.as_os_str().as_encoded_bytes()).unwrap();
    assert_eq!(unsafe { libc::mkfifo(cpath.as_ptr(), 0o600) }, 0);
    assert!(read(&project).is_empty(), "nonblocking open must reject a FIFO");
    assert!(Registration::new(&project, 12345, "other".into(), true).is_err());
    fs::remove_file(&path).unwrap();
    // This different inode is held and well-formed, but belongs to another project.
    fs::write(&path, serde_json::to_vec(&Address { project: root.join("other"), port: 12345, store_id: "identity".into(), temporary: true }).unwrap()).unwrap();
    let replacement = open(&path, true).unwrap(); replacement.try_lock().unwrap();
    assert!(read(&project).is_empty());
    drop(registration);
    assert!(path.exists(), "an exiting host must not remove a replacement inode");
    drop(replacement);
    fs::write(&path, before).unwrap();
    assert!(read(&project).is_empty(), "an unlocked record is stale");
    let registration = Registration::new(&project, 12345, "new identity".into(), true).unwrap();
    assert_eq!(read(&project)[0].store_id, "new identity");
    drop(registration);
    assert!(!path.exists());
    fs::remove_dir_all(root).unwrap();
}

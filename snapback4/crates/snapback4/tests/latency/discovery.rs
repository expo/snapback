use super::*;
use std::os::unix::fs::symlink;

#[test]
fn address_records_reject_links_nonfiles_stale_and_wrong_project() {
    let root = std::env::temp_dir().join(format!("sb4-address-{}", std::process::id()));
    fs::create_dir_all(&root).unwrap();
    let project = Project { root: root.clone() };
    let registration = Registration::new(&project, 12345, "identity".into(), true).unwrap();
    assert_eq!(read(&project).len(), 1);
    let path = project.data_dir().join(&registration.name);
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
    let replacement = registration.directory.open_record(&registration.name, true).unwrap(); replacement.try_lock().unwrap();
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

#[test]
fn address_directory_rejects_symlinks_and_foreign_owners() {
    let root = std::env::temp_dir().join(format!("sb4-address-parent-{}", std::process::id()));
    let external = root.join("external");
    fs::create_dir_all(&external).unwrap();
    let project = Project { root: root.clone() };
    symlink(&external, project.data_dir()).unwrap();
    let path = external.join("dev-address-12345.json");
    fs::write(&path, "external contents").unwrap();
    assert!(Registration::new(&project, 12345, "identity".into(), true).is_err());
    assert!(read(&project).is_empty());
    assert_eq!(fs::read_to_string(path).unwrap(), "external contents");
    if unsafe { libc::geteuid() } != 0 {
        assert!(Directory::verify(File::open("/").unwrap()).is_err(), "root-owned directory must be rejected");
    } else {
        fs::remove_file(project.data_dir()).unwrap();
        fs::create_dir(project.data_dir()).unwrap();
        let path = c_name(project.data_dir().as_os_str()).unwrap();
        assert_eq!(unsafe { libc::chown(path.as_ptr(), 1, 1) }, 0);
        assert!(Directory::open(&project, true).is_err());
    }
    fs::remove_dir_all(root).unwrap();
}

#[test]
fn address_directory_swap_cannot_redirect_opens_enumeration_or_cleanup() {
    let root = std::env::temp_dir().join(format!("sb4-address-swap-{}", std::process::id()));
    fs::create_dir_all(&root).unwrap();
    let project = Project { root: root.clone() };
    let registration = Registration::new(&project, 12345, "identity".into(), true).unwrap();
    let original = root.join("original");
    let external = root.join("external");
    fs::rename(project.data_dir(), &original).unwrap();
    fs::create_dir(&external).unwrap();
    fs::write(external.join(&registration.name), "external contents").unwrap();
    fs::write(external.join("external-only"), "external contents").unwrap();
    symlink(&external, project.data_dir()).unwrap();
    let names = registration.directory.names().unwrap();
    assert!(names.contains(&registration.name));
    assert!(!names.contains(&OsString::from("external-only")));
    let mut opened = registration.directory.open_record(&registration.name, false).unwrap();
    let mut bytes = String::new(); opened.read_to_string(&mut bytes).unwrap();
    assert!(bytes.contains("identity"));
    registration.directory.open_record(OsStr::new("dev-address-23456.json"), true).unwrap().write_all(b"anchored").unwrap();
    assert_eq!(fs::read(original.join("dev-address-23456.json")).unwrap(), b"anchored");
    assert!(!external.join("dev-address-23456.json").exists());
    assert!(read(&project).is_empty());
    drop(registration);
    assert!(!original.join("dev-address-12345.json").exists());
    assert_eq!(fs::read_to_string(external.join("dev-address-12345.json")).unwrap(), "external contents");
    fs::remove_dir_all(root).unwrap();
}

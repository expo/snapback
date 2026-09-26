//! Observe the real opener from SQLite connection creation, before installation.
use super::*;
use rusqlite::ffi;
use std::{cell::RefCell, ffi::{CStr, c_char, c_int, c_void}};

thread_local! {
    static READS: RefCell<Option<Vec<String>>> = const { RefCell::new(None) };
}

unsafe extern "C" fn authorize(_: *mut c_void, action: c_int, table: *const c_char,
    _: *const c_char, _: *const c_char, _: *const c_char) -> c_int
{
    if action == ffi::SQLITE_READ && !table.is_null() {
        // SAFETY: SQLite supplies a valid C string for a READ's table argument.
        let table = unsafe { CStr::from_ptr(table) }.to_string_lossy();
        READS.with(|reads| { if let Some(reads) = reads.borrow_mut().as_mut() { reads.push(table.into_owned()); } });
    }
    ffi::SQLITE_OK
}

unsafe extern "C" fn observe(db: *mut ffi::sqlite3, _: *mut *mut c_char, _: *const ffi::sqlite3_api_routines) -> c_int {
    // Auto-extensions are global; instrumentation applies only to this test's
    // thread while its actual Device::open is running. Parallel tests are untouched.
    if READS.with(|reads| reads.borrow().is_some()) {
        // SAFETY: the extension receives the newly opened connection. No callback
        // context is borrowed, and the callback lives for the process lifetime.
        unsafe { ffi::sqlite3_set_authorizer(db, Some(authorize), std::ptr::null_mut()) }
    } else { ffi::SQLITE_OK }
}

struct ObserveOpen;
impl Drop for ObserveOpen {
    fn drop(&mut self) {
        // SAFETY: unregister only this test's extension, never other extensions.
        unsafe { ffi::sqlite3_cancel_auto_extension(Some(observe)); }
        READS.with(|reads| { reads.borrow_mut().take(); });
    }
}

#[test]
fn a_second_device_open_does_not_read_the_installed_partition() {
    let (mut server, backend) = server();
    let host = Sqlite::new("residency-open");
    let path = host.path("store");
    let mut device = Device::open(&path, Some(backend)).unwrap();
    for (n, page) in snapshot_pages(&mut server, "dev:alice", 100).iter().enumerate() {
        device.apply(page, n == 0).unwrap();
    }
    let expected = check_rows(&mut device);
    drop(device);
    // SAFETY: SQLite's documented extension API installs the observer on new
    // connections. The guard cancels it even if opening or an assertion fails.
    assert_eq!(unsafe { ffi::sqlite3_auto_extension(Some(observe)) }, ffi::SQLITE_OK);
    let observer = ObserveOpen;
    READS.with(|reads| *reads.borrow_mut() = Some(Vec::new()));
    let mut reopened = Device::open(&path, None).unwrap();
    let reads = READS.with(|reads| reads.borrow_mut().take().unwrap());
    drop(observer);
    assert!(reads.iter().any(|t| t == "sqlite_master"), "the real open must be observed: {reads:?}");
    assert!(!reads.iter().any(|t| t == "r"), "a complete installation must not recount r on open: {reads:?}");
    assert_eq!(check_rows(&mut reopened), expected);
}

//! Loaded inside the executed Node process, after V8, libuv and JS workers start.
//! Standalone N-API module: no npm package or generated binding is required.
#![cfg(target_os = "macos")]
use std::ffi::c_void;
#[repr(C)]
struct ThreadInfo {
    user: u64, system: u64, cpu: i32, policy: i32, state: i32, flags: i32,
    sleep: i32, current: i32, priority: i32, maximum: i32, name: [u8; 64],
}
unsafe extern "C" {
    static mach_task_self_: u32;
    fn task_threads(task: u32, threads: *mut *mut u32, count: *mut u32) -> i32;
    fn thread_info(thread: u32, flavor: i32, info: *mut i32, count: *mut u32) -> i32;
    fn mach_port_deallocate(task: u32, port: u32) -> i32;
    fn vm_deallocate(task: u32, address: usize, size: usize) -> i32;
    fn napi_create_string_utf8(env: *mut c_void, text: *const u8, len: usize, result: *mut *mut c_void) -> i32;
}
#[unsafe(no_mangle)]
pub unsafe extern "C" fn napi_register_module_v1(env: *mut c_void, _: *mut c_void) -> *mut c_void {
    unsafe {
        let mut threads = std::ptr::null_mut();
        let mut count = 0;
        assert_eq!(task_threads(mach_task_self_, &mut threads, &mut count), 0);
        let mut priorities = Vec::new();
        for &thread in std::slice::from_raw_parts(threads, count as usize) {
            let mut info: ThreadInfo = std::mem::zeroed();
            let mut words = (std::mem::size_of::<ThreadInfo>() / 4) as u32;
            assert_eq!(thread_info(thread, 5, (&mut info as *mut ThreadInfo).cast(), &mut words), 0);
            priorities.push(info.priority);
            assert_eq!(mach_port_deallocate(mach_task_self_, thread), 0);
        }
        assert_eq!(vm_deallocate(mach_task_self_, threads as usize, count as usize * 4), 0);
        let text = format!("{priorities:?}");
        let mut result = std::ptr::null_mut();
        assert_eq!(napi_create_string_utf8(env, text.as_ptr(), text.len(), &mut result), 0);
        result
    }
}

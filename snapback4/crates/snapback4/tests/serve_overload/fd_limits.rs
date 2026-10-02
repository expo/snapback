use super::*;

// A separate process is essential: libtest's other tests share RLIMIT_NOFILE.
#[test]
fn many_servers_raise_a_low_soft_limit_and_release_their_descriptors() {
    const CHILD: &str = "SNAPBACK4_FD_LIMIT_CHILD";
    if std::env::var_os(CHILD).is_none() {
        use std::os::unix::process::CommandExt;
        let mut command = std::process::Command::new(std::env::current_exe().unwrap());
        command.args(["--exact", "serve::tests::overload_tests::fd_limits::many_servers_raise_a_low_soft_limit_and_release_their_descriptors", "--nocapture"])
            .env(CHILD, "1");
        unsafe { command.pre_exec(|| {
            let mut limit = std::mem::zeroed();
            if libc::getrlimit(libc::RLIMIT_NOFILE, &mut limit) != 0 { return Err(std::io::Error::last_os_error()); }
            limit.rlim_cur = 256.min(limit.rlim_max);
            if libc::setrlimit(libc::RLIMIT_NOFILE, &limit) != 0 { return Err(std::io::Error::last_os_error()); }
            Ok(())
        }); }
        let output = command.output().unwrap();
        assert!(output.status.success(), "{}\n{}", String::from_utf8_lossy(&output.stdout), String::from_utf8_lossy(&output.stderr));
        return;
    }
    let mut before: libc::rlimit = unsafe { std::mem::zeroed() };
    assert_eq!(unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut before) }, 0);
    assert!(before.rlim_cur <= 256);
    if before.rlim_max < 2048 {
        eprintln!("hard NOFILE limit below 2048; cannot exercise the 1280-descriptor workload");
        return;
    }
    let fds = || {
        #[cfg(target_os = "linux")]
        let path = "/proc/self/fd";
        #[cfg(not(target_os = "linux"))]
        let path = "/dev/fd";
        std::fs::read_dir(path).unwrap().count()
    };
    let baseline = fds();
    // The first Host must apply the shared helper before opening its listener.
    let warm = Host::new(true);
    drop(warm);
    wait_until(|| fds() <= baseline);
    for _ in 0..3 {
        let mut hosts = Vec::new();
        let mut peers = Vec::new();
        let mut owners = Vec::new();
        for _ in 0..8 {
            let host = Host::new(true);
            // Exercise the persistent request pool as well as connection intake.
            assert_eq!(status(&host.request("GET", "/auth/config", "", "")), 200);
            for _ in 0..32 { peers.push(TcpStream::connect(host.address).unwrap()); }
            wait_until(|| host.server.num_connections() == 32);
            owners.push((Arc::downgrade(&host.shared), Arc::downgrade(&host.admission)));
            hosts.push(host);
        }
        assert!(fds() > 1024, "workload must exceed both original soft limits");
        drop(peers);
        for host in &hosts { wait_until(|| host.server.num_connections() == 0); }
        drop(hosts);
        wait_until(|| owners.iter().all(|(shared, admission)| shared.upgrade().is_none() && admission.upgrade().is_none()));
        wait_until(|| fds() <= baseline);
    }
    let mut after: libc::rlimit = unsafe { std::mem::zeroed() };
    assert_eq!(unsafe { libc::getrlimit(libc::RLIMIT_NOFILE, &mut after) }, 0);
    assert!(after.rlim_cur > 1024);
    assert_eq!(after.rlim_max, before.rlim_max);
}

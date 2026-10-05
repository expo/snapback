//! A real non-loopback peer for local HTTP boundary tests, without an outbound route.
#[cfg(unix)]
pub fn address() -> std::net::IpAddr {
    struct Interfaces(*mut libc::ifaddrs);
    impl Drop for Interfaces {
        fn drop(&mut self) { unsafe { libc::freeifaddrs(self.0) }; }
    }
    let mut head = std::ptr::null_mut();
    assert_eq!(unsafe { libc::getifaddrs(&mut head) }, 0, "{}", std::io::Error::last_os_error());
    let interfaces = Interfaces(head);
    let mut row = interfaces.0;
    let mut candidates = Vec::new();
    while !row.is_null() {
        // getifaddrs owns this linked list until the guard frees it below.
        let interface = unsafe { &*row };
        if !interface.ifa_addr.is_null() && interface.ifa_flags & libc::IFF_UP as u32 != 0
            && unsafe { (*interface.ifa_addr).sa_family } as i32 == libc::AF_INET {
            let address = unsafe { &*interface.ifa_addr.cast::<libc::sockaddr_in>() };
            let ip = std::net::Ipv4Addr::from(u32::from_be(address.sin_addr.s_addr));
            if !ip.is_loopback() && !ip.is_unspecified() {
                // Prefer a LAN interface over a point-to-point VPN interface.
                candidates.push((interface.ifa_flags & libc::IFF_POINTOPOINT as u32 != 0, ip));
            }
        }
        row = interface.ifa_next;
    }
    candidates.sort_unstable();
    candidates.first().expect("HTTP peer-fence tests require an up, non-loopback IPv4 interface").1.into()
}

#[cfg(not(unix))]
pub fn address() -> std::net::IpAddr {
    let route = std::net::UdpSocket::bind("0.0.0.0:0").unwrap();
    route.connect("192.0.2.1:9").unwrap();
    let ip = route.local_addr().unwrap().ip();
    assert!(!ip.is_loopback() && !ip.is_unspecified());
    ip
}

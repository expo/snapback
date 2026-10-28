#[path="/home/ccheever/projects/sb4-b32-dx15/snapback4/crates/snapback4/src/supervisor.rs"]
mod supervisor;
fn main() {
    if std::env::args().nth(1).as_deref()==Some("--launch") {
        let marker="/consumer/parent-ready";
        let _=std::fs::remove_file(marker);
        let _child=std::process::Command::new("/proof/probe").arg("serve").env("PROBE_READY",marker).spawn().unwrap();
        let until=std::time::Instant::now()+std::time::Duration::from_secs(5);
        while !std::path::Path::new(marker).exists() { assert!(std::time::Instant::now()<until);std::thread::sleep(std::time::Duration::from_millis(5)); }
        println!("launcher exits after readiness");
        std::process::exit(0);
    }
    supervisor::adopt();
    assert_eq!(supervisor::identity(std::process::id()).unwrap().1,"unverified");
    println!("live parent accepted without proc");
    if let Ok(path)=std::env::var("PROBE_READY") {std::fs::write(path,"ready").unwrap();}
    std::thread::sleep(std::time::Duration::from_millis(800));
    println!("survived with live parent");
}

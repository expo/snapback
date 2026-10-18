//! An isolated production host for signed-out challenges. No development doors.
// @ref LLP 3000.036.004#4-counterexamples-and-generated-tests — signed-out contexts must cross HTTP admission.
use std::{fs, io::{Read,Write}, net::{TcpListener,TcpStream,SocketAddr}, path::PathBuf,
    process::{Child,Command,Stdio}, time::{Duration,Instant,SystemTime,UNIX_EPOCH}};
use snapback4_lang::Bound;

struct Scratch(PathBuf);
impl Drop for Scratch {fn drop(&mut self){let _=fs::remove_dir_all(&self.0);}}
struct Process(Child);
impl Drop for Process {fn drop(&mut self){let _=self.0.kill();let _=self.0.wait();}}
fn wait(child:&mut Process,budget:Duration)->Result<(),String>{
    let until=Instant::now()+budget;
    loop{match child.0.try_wait().map_err(|e|e.to_string())?{
        Some(status)=>return if status.success(){Ok(())}else{Err(format!("private serve preparation exited {status}"))},
        None if Instant::now()<until=>std::thread::sleep(Duration::from_millis(20)),
        _=>return Err("private serve preparation exceeded 30 seconds".into()),
    }}
}
fn request(address:SocketAddr,path:&str,persona:bool)->Result<(u16,serde_json::Value),String>{
    let mut stream=TcpStream::connect_timeout(&address,Duration::from_secs(2)).map_err(|e|e.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).map_err(|e|e.to_string())?;
    stream.set_write_timeout(Some(Duration::from_secs(3))).map_err(|e|e.to_string())?;
    let header=if persona{"x-snapback-persona: security-forged\r\n"}else{""};
    let body="{\"id\":\"security-unauthenticated\",\"args\":{}}";
    let wire=format!("POST {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{header}\r\n{body}",body.len());
    stream.write_all(wire.as_bytes()).map_err(|e|e.to_string())?;
    let mut bytes=Vec::new();stream.take(1<<20).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
    let wire=String::from_utf8(bytes).map_err(|e|e.to_string())?;
    let status=wire.split_whitespace().nth(1).and_then(|s|s.parse::<u16>().ok()).ok_or("malformed HTTP status")?;
    let body=wire.split_once("\r\n\r\n").map(|(_,b)|b).ok_or("malformed HTTP response")?;
    let json=serde_json::from_str(body).map_err(|e|format!("HTTP {status}: {e}"))?;
    Ok((status,json))
}

pub(super) fn run(bound:&Bound,sources:&[(String,String)])->Result<usize,String>{
    // Auth admission is exercised on the actual schema. External worker/native
    // startup needs its app-owned artifacts; never pretend this schema-only
    // host qualifies those paths.
    if bound.programs.iter().any(|p|p.program.native||p.program.kind==snapback4_core::ir::ProgramKind::Action)
        || !bound.schema.effects.is_empty() || !bound.schema.action_specs.is_empty(){
        println!("security not covered: unauthenticated serve HTTP for native/action/effect applications needs its complete deployed artifacts");return Ok(0);
    }
    let stamp=SystemTime::now().duration_since(UNIX_EPOCH).map_err(|e|e.to_string())?.as_nanos();
    let root=std::env::temp_dir().join(format!("sb4-security-serve-{}-{stamp}",std::process::id()));
    fs::create_dir(&root).map_err(|e|e.to_string())?;let scratch=Scratch(root);
    fs::create_dir(scratch.0.join("snapback")).map_err(|e|e.to_string())?;
    for (name,text) in sources {
        let file=std::path::Path::new(name).file_name().ok_or("source needs a file name")?;
        fs::write(scratch.0.join("snapback").join(file),text).map_err(|e|e.to_string())?;
    }
    let executable=std::env::current_exe().map_err(|e|e.to_string())?;
    let output=fs::File::create(scratch.0.join("host.log")).map_err(|e|e.to_string())?;
    let command=|verb:&str|->Result<Command,String>{
        let mut c=Command::new(&executable);c.arg(verb).current_dir(&scratch.0)
            .env("SNAPBACK4_SUPERVISOR_PID",std::process::id().to_string()).stdin(Stdio::null())
            .stdout(output.try_clone().map_err(|e|e.to_string())?).stderr(output.try_clone().map_err(|e|e.to_string())?);Ok(c)
    };
    let mut deploy=Process(command("deploy")?.args(["deployment"]).spawn().map_err(|e|e.to_string())?);
    wait(&mut deploy,Duration::from_secs(30))?;drop(deploy);
    let listener=TcpListener::bind((std::net::Ipv4Addr::LOCALHOST,0)).map_err(|e|e.to_string())?;
    let address=listener.local_addr().map_err(|e|e.to_string())?;drop(listener);
    let mut host=Process(command("serve")?.args(["deployment","--bind","127.0.0.1","--port",&address.port().to_string()]).spawn().map_err(|e|e.to_string())?);
    let until=Instant::now()+Duration::from_secs(15);
    loop{
        if host.0.try_wait().map_err(|e|e.to_string())?.is_some(){return Err("private production serve exited during startup".into());}
        if TcpStream::connect_timeout(&address,Duration::from_millis(100)).is_ok(){break;}
        if Instant::now()>=until{return Err("private production serve did not listen within 15 seconds".into());}
        std::thread::sleep(Duration::from_millis(20));
    }
    let mut attempted=0;
    for p in &bound.programs {
        let prefix=match p.program.kind{snapback4_core::ir::ProgramKind::Query=>"q",snapback4_core::ir::ProgramKind::Mutation=>"m",_=>continue};
        for forged in [false,true]{
            let (status,body)=request(address,&format!("/{prefix}/{}",p.program.name),forged)?;attempted+=1;
            if status!=401||body["denied"]["code"]!="E_AUTH" {
                return Err(format!("unauthenticated serve HTTP {} (forged persona={forged}) returned {status}: {body}",p.program.name));
            }
        }
    }
    // Staging/provisioning belongs to STAGE. This host never opens its dev doors.
    for path in ["/seed","/dev/reset","/dev/clock/advance"] {
        let (status,_)=request(address,path,false)?;attempted+=1;
        if !matches!(status,401|403|404){return Err(format!("production development door {path} returned {status}"));}
    }
    drop(host);drop(scratch);
    println!("security unauthenticated serve HTTP: {attempted} attempts refused (including forged personas and dev doors)");
    Ok(attempted)
}

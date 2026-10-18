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
    exchange(address,"POST",path,if persona{"x-snapback-persona: security-forged\r\n"}else{""},"{\"id\":\"security-unauthenticated\",\"args\":{}}")
}
fn exchange(address:SocketAddr,method:&str,path:&str,header:&str,body:&str)->Result<(u16,serde_json::Value),String>{
    let mut stream=TcpStream::connect_timeout(&address,Duration::from_secs(2)).map_err(|e|e.to_string())?;
    stream.set_read_timeout(Some(Duration::from_secs(3))).map_err(|e|e.to_string())?;
    stream.set_write_timeout(Some(Duration::from_secs(3))).map_err(|e|e.to_string())?;
    let wire=format!("{method} {path} HTTP/1.1\r\nHost: localhost\r\nConnection: close\r\nContent-Type: application/json\r\nContent-Length: {}\r\n{header}\r\n{body}",body.len());
    stream.write_all(wire.as_bytes()).map_err(|e|e.to_string())?;
    let mut bytes=Vec::new();stream.take(1<<20).read_to_end(&mut bytes).map_err(|e|e.to_string())?;
    if bytes.len()==1<<20{return Err("private HTTP response exceeded 1 MiB".into());}
    let boundary=bytes.windows(4).position(|b|b==b"\r\n\r\n").ok_or("malformed HTTP response")?;
    let headers=std::str::from_utf8(&bytes[..boundary]).map_err(|_|"invalid HTTP headers")?;
    let body=&bytes[boundary+4..];
    let status=headers.split_whitespace().nth(1).and_then(|s|s.parse::<u16>().ok()).ok_or("malformed HTTP status")?;
    let decoded=if headers.lines().any(|line|line.split_once(':').is_some_and(|(k,v)|k.eq_ignore_ascii_case("transfer-encoding")&&v.trim().eq_ignore_ascii_case("chunked"))){chunks(body)?}else{body.to_vec()};
    let json=serde_json::from_slice(&decoded).map_err(|e|format!("HTTP {status}: {e}"))?;
    Ok((status,json))
}
fn chunks(mut wire:&[u8])->Result<Vec<u8>,String>{
    let mut out=Vec::new();
    loop{
        let line=wire.windows(2).position(|b|b==b"\r\n").ok_or("incomplete HTTP chunk header")?;
        let size=std::str::from_utf8(&wire[..line]).map_err(|_|"invalid HTTP chunk header")?;
        let count=usize::from_str_radix(size.split(';').next().unwrap_or(""),16).map_err(|_|"invalid HTTP chunk size")?;
        wire=&wire[line+2..];
        if count==0{if wire!=b"\r\n"{return Err("unexpected HTTP chunk trailer".into());}return Ok(out);}
        let end=count.checked_add(2).ok_or("HTTP chunk size overflow")?;
        if wire.len()<end||&wire[count..end]!=b"\r\n"{return Err("incomplete HTTP chunk body".into());}
        out.extend_from_slice(&wire[..count]);wire=&wire[end..];
    }
}

#[cfg(test)]
mod tests{
    #[test]fn production_schema_chunks_are_decoded_before_json(){
        let body=super::chunks(b"5\r\n{\"a\":\r\n6\r\n\"yes\"}\r\n0\r\n\r\n").unwrap();
        assert_eq!(serde_json::from_slice::<serde_json::Value>(&body).unwrap()["a"],"yes");
        assert!(super::chunks(b"10\r\nshort\r\n0\r\n\r\n").is_err());
        assert!(super::chunks(b"ffffffffffffffffffff\r\n").is_err());
        assert_eq!(super::chunks(b"1\r\n\xc3\r\n1\r\n\xa9\r\n0\r\n\r\n").unwrap(),"é".as_bytes());
    }
}

// An actual credential history at the production admission boundary. A stale
// device's already copied bytes remain a separate, explicitly unproved path.
fn revoked_sessions(bound:&Bound,address:SocketAddr)->Result<usize,String>{
    if !bound.schema.auth.guests && !bound.schema.auth.password {
        println!("security not covered: ordinary session revocation HTTP requires declared guest or password identity");return Ok(0);
    }
    let (path,payload)=if bound.schema.auth.guests{("/auth/guest","{}")}
        else{("/auth/signup","{\"email\":\"security-campaign@example.test\",\"password\":\"Isolated-campaign-7842!\"}")};
    let (status,session)=exchange(address,"POST",path,"",payload)?;
    if status!=200{return Err(format!("private revocation campaign could not authenticate (HTTP {status}); no revocation claim"));}
    let token=session["session"]["token"].as_str().ok_or("private revocation campaign did not receive a session")?;
    let bearer=format!("Authorization: Bearer {token}\r\n");
    if exchange(address,"GET","/schema",&bearer,"")?.0!=200{return Err("fresh session failed schema admission before revocation".into());}
    let (status,rotated)=exchange(address,"POST","/auth/refresh",&bearer,"{}")?;
    if status!=200{return Err("private revocation campaign could not rotate its live session".into());}
    let successor=rotated["session"]["token"].as_str().ok_or("rotation did not return a successor session")?;
    let next=format!("Authorization: Bearer {successor}\r\n");
    if exchange(address,"GET","/schema",&next,"")?.0!=200{return Err("rotation successor failed admission before revocation".into());}
    let (status,ended)=exchange(address,"POST","/auth/logout-all",&next,"{}")?;
    if status!=200||ended["ok"]!=true||ended["revoked"].as_u64().unwrap_or(0)==0{return Err("private revocation campaign could not revoke its successor".into());}
    let mut attempted=0;
    for header in [&bearer,&next] {
        let mut paths=vec![("GET","/schema".to_owned()),("GET","/changes?since=0&wait=0".to_owned()),("POST","/sync".to_owned()),("POST","/probe".to_owned()),("POST","/auth/refresh".to_owned())];
        for p in &bound.programs{
            let prefix=match p.program.kind{snapback4_core::ir::ProgramKind::Query=>"q",snapback4_core::ir::ProgramKind::Mutation=>"m",_=>continue};
            paths.push(("POST",format!("/{prefix}/{}",p.program.name)));
        }
        for (method,path) in paths{
            let (status,body)=exchange(address,method,&path,header,"{\"id\":\"security-revoked\",\"args\":{}}")?;attempted+=1;
            if status!=401||body["denied"]["code"]!="E_AUTH"{return Err(format!("revoked credential admitted at {method} {path} (HTTP {status}); bearer omitted"));}
        }
    }
    println!("security live-session revocation HTTP: {attempted} attempts refused after actual refresh and logout-all; disconnected device storage is not covered");
    Ok(attempted)
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
    let revoked=revoked_sessions(bound,address)?;
    drop(host);drop(scratch);
    println!("security unauthenticated serve HTTP: {attempted} attempts refused (including forged personas and dev doors)");
    Ok(attempted+revoked)
}

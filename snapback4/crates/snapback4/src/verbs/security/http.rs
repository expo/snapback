//! An isolated production host for signed-out challenges. No development doors.
// @ref LLP 3000.036.004#4-counterexamples-and-generated-tests — signed-out contexts must cross HTTP admission.
use std::{fs, io::{Read,Write}, net::{TcpListener,TcpStream,SocketAddr}, path::PathBuf,
    process::{Child,Command,Stdio}, time::{Duration,Instant,SystemTime,UNIX_EPOCH}};
use snapback4_lang::Bound;
#[path="http_image.rs"] mod image;

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
    let decoded=framed(headers,body)?;
    let json=serde_json::from_slice(&decoded).map_err(|e|format!("HTTP {status}: {e}"))?;
    Ok((status,json))
}
fn framed(headers:&str,body:&[u8])->Result<Vec<u8>,String>{
    let mut length=None;let mut transfer=false;
    let mut lines=headers.split("\r\n");
    let status=lines.next().ok_or("missing HTTP status line")?;
    if !(status.starts_with("HTTP/1.1 ")||status.starts_with("HTTP/1.0 "))||status.bytes().any(|b|b<32||b==127){return Err("malformed HTTP status line".into());}
    for line in lines{
        let (name,value)=line.split_once(':').ok_or("malformed HTTP header")?;
        if name.is_empty()||!name.bytes().all(|b|b.is_ascii_alphanumeric()||b"!#$%&'*+-.^_`|~".contains(&b))||value.bytes().any(|b|b<32&&b!=b'\t'||b==127){return Err("malformed HTTP header field".into());}
        if name.eq_ignore_ascii_case("content-length"){
            let value=value.trim_matches([' ','\t']);
            if length.is_some()||value.is_empty()||!value.bytes().all(|b|b.is_ascii_digit()){return Err("invalid or duplicate HTTP content length".into());}
            length=Some(value.parse::<usize>().map_err(|_|"invalid HTTP content length")?);
        }
        if name.eq_ignore_ascii_case("transfer-encoding"){
            if transfer||!value.trim_matches([' ','\t']).eq_ignore_ascii_case("chunked"){return Err("invalid or duplicate HTTP transfer encoding".into());}transfer=true;
        }
    }
    if transfer{
        if length.is_some(){return Err("conflicting HTTP body framing".into());}chunks(body)
    }else{
        if length!=Some(body.len()){return Err("HTTP body lacks complete declared content length".into());}
        Ok(body.to_vec())
    }
}
fn chunks(mut wire:&[u8])->Result<Vec<u8>,String>{
    let mut out=Vec::new();
    loop{
        let line=wire.windows(2).position(|b|b==b"\r\n").ok_or("incomplete HTTP chunk header")?;
        let size=std::str::from_utf8(&wire[..line]).map_err(|_|"invalid HTTP chunk header")?;
        if size.is_empty()||!size.bytes().all(|b|b.is_ascii_hexdigit()){return Err("invalid HTTP chunk size".into());}
        let count=usize::from_str_radix(size,16).map_err(|_|"invalid HTTP chunk size")?;
        wire=&wire[line+2..];
        if count==0{if wire!=b"\r\n"{return Err("unexpected HTTP chunk trailer".into());}return Ok(out);}
        let end=count.checked_add(2).ok_or("HTTP chunk size overflow")?;
        if wire.len()<end||&wire[count..end]!=b"\r\n"{return Err("incomplete HTTP chunk body".into());}
        out.extend_from_slice(&wire[..count]);wire=&wire[end..];
    }
}
// @ref LLP 3000.036.004#137-wave-19-correction-admissible-starts-and-persistent-refutations — verify the existing door-specific auth envelope without weakening admission.
fn auth_refusal(status:u16,body:&serde_json::Value,ephemeral:bool)->bool{
    let refusal=if status==401{&body["denied"]}else if ephemeral&&status==200&&body["state"]=="failed"{&body["why"]}else{return false;};
    refusal["code"]=="E_AUTH"&&refusal["family"]=="auth"&&refusal["rule"].is_null()&&body.get("data").is_none()&&body.get("result").is_none()
}

fn rotation_successor<'a>(session:&serde_json::Value,rotated:&'a serde_json::Value)->Result<&'a str,String>{
    let field=|value:&serde_json::Value,name:&str|->Result<String,String>{
        value["session"][name].as_str().filter(|v|!v.trim().is_empty()).map(str::to_owned).ok_or_else(||format!("session response lacks a nonempty {name}"))
    };
    if field(session,"principal")?!=field(rotated,"principal")?{return Err("rotation changed the reported principal".into());}
    let token=field(session,"token")?;let next=field(rotated,"token")?;
    if token==next{return Err("rotation did not return a distinct successor".into());}
    Ok(rotated["session"]["token"].as_str().expect("checked nonempty successor"))
}

#[cfg(test)]
mod tests{
    #[test]fn rotation_requires_explicit_distinct_same_principal_credentials(){
        use serde_json::json;
        let original=json!({"session":{"principal":"guest:one","token":"first"}});
        let next=json!({"session":{"principal":"guest:one","token":"second"}});
        assert_eq!(super::rotation_successor(&original,&next).unwrap(),"second");
        for principal in [serde_json::Value::Null,json!(""),json!(" "),json!(17),json!({}),json!([]),json!("guest:other")]{
            let malformed=json!({"session":{"principal":principal,"token":"second"}});
            assert!(super::rotation_successor(&original,&malformed).is_err());
            assert!(super::rotation_successor(&malformed,&next).is_err());
        }
        assert!(super::rotation_successor(&json!({"session":{"token":"first"}}),&json!({"session":{"token":"second"}})).is_err());
        assert!(super::rotation_successor(&original,&original).is_err());
    }
    #[test]fn auth_envelopes_follow_the_declared_door_without_accepting_app_refusals_or_payloads(){
        use serde_json::json;
        let durable=json!({"denied":{"code":"E_AUTH","family":"auth"}});
        let memory=json!({"state":"failed","why":{"code":"E_AUTH","family":"auth"}});
        assert!(super::auth_refusal(401,&durable,false));assert!(super::auth_refusal(401,&durable,true));
        assert!(super::auth_refusal(200,&memory,true));assert!(!super::auth_refusal(200,&memory,false));
        for value in [json!({"state":"sent","why":{"code":"E_AUTH","family":"auth"}}),json!({"state":"failed","why":{"code":"E_AUTH","family":"rule"}}),json!({"state":"failed","why":{"code":"E_AUTH","family":"auth","rule":"E_AUTH"}}),json!({"state":"failed","why":{"code":"E_AUTH","family":"auth"},"result":"private"}),json!({"state":"failed","why":{"code":"E_AUTH","family":"auth"},"data":"private"})]{assert!(!super::auth_refusal(200,&value,true));}
    }
    #[test]fn production_schema_chunks_are_decoded_before_json(){
        let body=super::chunks(b"5\r\n{\"a\":\r\n6\r\n\"yes\"}\r\n0\r\n\r\n").unwrap();
        assert_eq!(serde_json::from_slice::<serde_json::Value>(&body).unwrap()["a"],"yes");
        assert!(super::chunks(b"10\r\nshort\r\n0\r\n\r\n").is_err());
        assert!(super::chunks(b"ffffffffffffffffffff\r\n").is_err());
        assert_eq!(super::chunks(b"1\r\n\xc3\r\n1\r\n\xa9\r\n0\r\n\r\n").unwrap(),"é".as_bytes());
        let prefix=b"{\"denied\":{\"code\":\"E_AUTH\"}}";
        assert!(super::framed("HTTP/1.1 401 Unauthorized\r\nContent-Length: 100",prefix).is_err(),"complete JSON prefix must not hide truncation");
        assert!(super::framed("HTTP/1.1 401 Unauthorized\r\nContent-Length: 2\r\nContent-Length: 2",b"{}").is_err());
        assert!(super::framed("HTTP/1.1 401 Unauthorized\r\nTransfer-Encoding: chunked\r\nContent-Length: 2",b"{}").is_err());
        assert_eq!(super::framed("HTTP/1.1 200 OK\r\nContent-Length: 2",b"{}").unwrap(),b"{}");
        assert!(super::framed("HTTP/1.1 401 Unauthorized\r\nContent-Length : 100",prefix).is_err());
        assert!(super::framed("HTTP/1.1 401 Unauthorized\r\nContent-Length: \u{00a0}2",b"{}").is_err());
        assert!(super::chunks(b"+2\r\n{}\r\n0\r\n\r\n").is_err());
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
    let successor=rotation_successor(&session,&rotated)?;
    let next=format!("Authorization: Bearer {successor}\r\n");
    if exchange(address,"GET","/schema",&next,"")?.0!=200{return Err("rotation successor failed admission before revocation".into());}
    let (status,retired)=exchange(address,"GET","/schema",&bearer,"")?;
    if status!=401||retired["denied"]["code"]!="E_AUTH"{return Err("rotation left the original credential admitted before logout-all".into());}
    let (status,ended)=exchange(address,"POST","/auth/logout-all",&next,"{}")?;
    if status!=200||ended["ok"]!=true||ended["revoked"].as_u64().unwrap_or(0)==0{return Err("private revocation campaign could not revoke its successor".into());}
    let mut attempted=0;
    for header in [&bearer,&next] {
        let mut paths=vec![("GET","/schema".to_owned(),false),("GET","/changes?since=0&wait=0".to_owned(),false),("POST","/sync".to_owned(),false),("POST","/probe".to_owned(),false),("POST","/auth/refresh".to_owned(),false)];
        for p in &bound.programs{
            let prefix=match p.program.kind{snapback4_core::ir::ProgramKind::Query=>"q",snapback4_core::ir::ProgramKind::Mutation=>"m",_=>continue};
            let ephemeral=p.program.kind==snapback4_core::ir::ProgramKind::Mutation&&bound.schema.operations.get(&p.program.name).is_some_and(|f|f.ephemeral);
            paths.push(("POST",format!("/{prefix}/{}",p.program.name),ephemeral));
        }
        for (method,path,ephemeral) in paths{
            let (status,body)=exchange(address,method,&path,header,"{\"id\":\"security-revoked\",\"args\":{}}")?;attempted+=1;
            if !auth_refusal(status,&body,ephemeral){return Err(format!("revoked credential admitted at {method} {path} (HTTP {status}); bearer omitted"));}
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
    let executable=scratch.0.join("security-host");
    image::snapshot(&executable)?;
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
            let ephemeral=p.program.kind==snapback4_core::ir::ProgramKind::Mutation&&bound.schema.operations.get(&p.program.name).is_some_and(|f|f.ephemeral);
            if !auth_refusal(status,&body,ephemeral) {
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

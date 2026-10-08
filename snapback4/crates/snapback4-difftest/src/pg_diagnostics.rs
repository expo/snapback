//! A transparent local wire observer retains ErrorResponse before the engine
//! converts it to a public refusal. Never changes a SQL request or response.
//! Only used with the evaluation adapter's unencrypted local test connection.
use crate::store_database::error_chain;
use postgres::{
    Client, Config, NoTls,
    config::{Host, SslMode},
};
use std::{
    collections::BTreeMap,
    io::{self, Read, Write},
    net::{Shutdown, TcpStream},
    os::unix::net::{UnixListener, UnixStream},
    path::PathBuf,
    sync::{
        Arc, Mutex,
        atomic::{AtomicU64, Ordering},
    },
    thread::JoinHandle,
};
static NEXT: AtomicU64 = AtomicU64::new(0);
#[derive(Default)]
struct State {
    sql: String,
    statements: BTreeMap<String, String>,
    errors: Vec<String>,
}
pub(crate) struct Diagnostics {
    state: Arc<Mutex<State>>,
    directory: PathBuf,
    join: Option<JoinHandle<()>>,
    shutdown: Socket,
}
enum Socket {
    Tcp(TcpStream),
    Unix(UnixStream),
}
impl Socket {
    fn copy(&self) -> io::Result<Self> {
        match self {
            Self::Tcp(s) => Ok(Self::Tcp(s.try_clone()?)),
            Self::Unix(s) => Ok(Self::Unix(s.try_clone()?)),
        }
    }
    fn shutdown(&self) {
        let _ = match self {
            Self::Tcp(s) => s.shutdown(Shutdown::Both),
            Self::Unix(s) => s.shutdown(Shutdown::Both),
        };
    }
}
impl Read for Socket {
    fn read(&mut self, b: &mut [u8]) -> io::Result<usize> {
        match self {
            Self::Tcp(s) => s.read(b),
            Self::Unix(s) => s.read(b),
        }
    }
}
impl Write for Socket {
    fn write(&mut self, b: &[u8]) -> io::Result<usize> {
        match self {
            Self::Tcp(s) => s.write(b),
            Self::Unix(s) => s.write(b),
        }
    }
    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}
fn frame(input: &mut impl Read) -> io::Result<Vec<u8>> {
    let mut header = [0; 5];
    input.read_exact(&mut header)?;
    let length = u32::from_be_bytes(header[1..].try_into().unwrap()) as usize;
    if !(4..=64 * 1024 * 1024).contains(&length) {
        return Err(io::Error::other("invalid Postgres frame length"));
    }
    let mut bytes = vec![0; length + 1];
    bytes[..5].copy_from_slice(&header);
    input.read_exact(&mut bytes[5..])?;
    Ok(bytes)
}
fn strings(bytes: &[u8]) -> impl Iterator<Item = String> + '_ {
    bytes
        .split(|b| *b == 0)
        .map(|s| String::from_utf8_lossy(s).into_owned())
}
fn frontend(bytes: &[u8], state: &Mutex<State>) {
    let mut state = state.lock().unwrap();
    let mut fields = strings(&bytes[5..]);
    match bytes[0] {
        b'Q' => state.sql = fields.next().unwrap_or_default(),
        b'P' => {
            let name = fields.next().unwrap_or_default();
            let sql = fields.next().unwrap_or_default();
            state.sql = sql.clone();
            state.statements.insert(name, sql);
        }
        b'B' => {
            let name = fields.nth(1).unwrap_or_default();
            if let Some(sql) = state.statements.get(&name) {
                state.sql = sql.clone();
            }
        }
        b'C' if bytes.get(5) == Some(&b'S') => {
            state
                .statements
                .remove(&String::from_utf8_lossy(&bytes[6..bytes.len() - 1]).into_owned());
        }
        _ => {}
    }
}
fn backend(bytes: &[u8], state: &Mutex<State>) {
    if bytes[0] != b'E' {
        return;
    }
    let mut fields = BTreeMap::new();
    for field in bytes[5..].split(|b| *b == 0).filter(|s| !s.is_empty()) {
        fields.insert(field[0], String::from_utf8_lossy(&field[1..]).into_owned());
    }
    let mut state = state.lock().unwrap();
    let error = format!(
        "statement={}; SQLSTATE={}; message={}; detail={}; server_fields={fields:?}",
        state.sql,
        fields.get(&b'C').map(String::as_str).unwrap_or("<none>"),
        fields.get(&b'M').map(String::as_str).unwrap_or("<none>"),
        fields.get(&b'D').map(String::as_str).unwrap_or("<none>")
    );
    state.errors.push(error);
}
impl Diagnostics {
    pub fn connect(url: &str) -> Result<(Client, Self), String> {
        let config: Config = url
            .parse()
            .map_err(|e| error_chain("parse connection", &e))?;
        if config.get_hosts().len() != 1 {
            return Err("diagnostic connection requires one explicit local host".into());
        }
        let port = config.get_ports().first().copied().unwrap_or(5432);
        let remote = match &config.get_hosts()[0] {
            Host::Tcp(host) => {
                let socket = TcpStream::connect((host.as_str(), port))
                    .map_err(|e| error_chain("CONNECT TCP", &e))?;
                socket
                    .set_nodelay(true)
                    .map_err(|e| error_chain("TCP_NODELAY", &e))?;
                Socket::Tcp(socket)
            }
            Host::Unix(path) => Socket::Unix(
                UnixStream::connect(path.join(format!(".s.PGSQL.{port}")))
                    .map_err(|e| error_chain("CONNECT Unix", &e))?,
            ),
        };
        let shutdown = remote
            .copy()
            .map_err(|e| error_chain("duplicate diagnostic socket", &e))?;
        let directory = std::env::temp_dir().join(format!(
            "dt-pg-{}-{}",
            std::process::id(),
            NEXT.fetch_add(1, Ordering::Relaxed)
        ));
        std::fs::create_dir(&directory)
            .map_err(|e| error_chain("create diagnostic socket directory", &e))?;
        let listener = UnixListener::bind(directory.join(".s.PGSQL.5432"))
            .map_err(|e| error_chain("bind diagnostic socket", &e))?;
        let state = Arc::new(Mutex::new(State::default()));
        let shared = state.clone();
        let join = std::thread::spawn(move || {
            let task = || -> io::Result<()> {
                let (mut local, _) = listener.accept()?;
                let mut remote = remote;
                let mut length = [0; 4];
                local.read_exact(&mut length)?;
                let n = u32::from_be_bytes(length) as usize;
                if !(4..=65536).contains(&n) {
                    return Err(io::Error::other("invalid startup frame"));
                }
                let mut startup = vec![0; n];
                startup[..4].copy_from_slice(&length);
                local.read_exact(&mut startup[4..])?;
                remote.write_all(&startup)?;
                let mut remote_reader = remote.copy()?;
                let mut local_writer = local.try_clone()?;
                let response_state = shared.clone();
                let responses = std::thread::spawn(move || {
                    loop {
                        match frame(&mut remote_reader) {
                            Ok(bytes) => {
                                backend(&bytes, &response_state);
                                if let Err(e) = local_writer.write_all(&bytes) {
                                    response_state
                                        .lock()
                                        .unwrap()
                                        .errors
                                        .push(error_chain("relay server response", &e));
                                    break;
                                }
                            }
                            Err(e) => {
                                response_state
                                    .lock()
                                    .unwrap()
                                    .errors
                                    .push(error_chain("read server response", &e));
                                break;
                            }
                        }
                    }
                    let _ = local_writer.shutdown(Shutdown::Both);
                    remote_reader.shutdown();
                });
                while let Ok(bytes) = frame(&mut local) {
                    frontend(&bytes, &shared);
                    if remote.write_all(&bytes).is_err() {
                        break;
                    }
                }
                remote.shutdown();
                let _ = local.shutdown(Shutdown::Both);
                let _ = responses.join();
                Ok(())
            };
            if let Err(e) = task() {
                shared
                    .lock()
                    .unwrap()
                    .errors
                    .push(error_chain("wire observer", &e));
            }
        });
        let mut local = Config::new();
        local
            .host_path(&directory)
            .port(5432)
            .ssl_mode(SslMode::Disable);
        if let Some(v) = config.get_user() {
            local.user(v);
        }
        if let Some(v) = config.get_password() {
            local.password(v);
        }
        if let Some(v) = config.get_dbname() {
            local.dbname(v);
        }
        if let Some(v) = config.get_options() {
            local.options(v);
        }
        local.application_name("snapback4-difftest");
        let diagnostics = Self {
            state,
            directory,
            join: Some(join),
            shutdown,
        };
        let client = local
            .connect(NoTls)
            .map_err(|e| diagnostics.describe(&error_chain("CONNECT engine", &e)))?;
        Ok((client, diagnostics))
    }
    pub fn clear(&self) {
        self.state.lock().unwrap().errors.clear();
    }
    pub fn describe(&self, error: &str) -> String {
        let state = self.state.lock().unwrap();
        format!(
            "{error}; last_statement={}; source_chain=[{}]",
            state.sql,
            state.errors.join("; ")
        )
    }
}
impl Drop for Diagnostics {
    fn drop(&mut self) {
        // Error paths may drop diagnostics before a still-owned Client. Close
        // our connection first so joining the relay can never wait on that drop.
        self.shutdown.shutdown();
        if let Some(join) = self.join.take() {
            let _ = join.join();
        }
        let _ = std::fs::remove_dir_all(&self.directory);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn retains_sqlstate_detail_and_statement_before_refusal_conversion() {
        let url = std::env::var("SNAPBACK4_EVAL_POSTGRES").unwrap();
        let (mut client, diagnostics) = Diagnostics::connect(&url).unwrap();
        let sql = "DO $$ BEGIN RAISE EXCEPTION 'diagnostic sentinel' USING ERRCODE='P0001', DETAIL='full detail sentinel'; END $$";
        let error = client.batch_execute(sql).unwrap_err();
        let detail = diagnostics.describe(&error_chain("DO", &error));
        assert!(detail.contains("SQLSTATE=P0001"), "{detail}");
        assert!(detail.contains("full detail sentinel"), "{detail}");
        assert!(detail.contains("statement=DO"), "{detail}");
        // Setup errors can unwind diagnostics before the still-owned client.
        // This order must close the relay rather than hang while joining it.
        drop(diagnostics);
        assert!(client.simple_query("SELECT 1").is_err());
    }
}

//! Shared pieces of the ownership-and-fencing prototype for
//! LLP 3000.009.001.000 §5 (ownership, fencing of every durable transaction,
//! lease-driven takeover on the database clock).
//!
//! Nothing here consults a host wall clock for a protocol decision: lease
//! expiry and renewal are computed by the database (`clock_timestamp()`),
//! and fencing compares tokens only.

use postgres::{Client, NoTls, Transaction, error::SqlState};
use std::io::Write;

/// Session advisory lock key: the clean-shutdown fast path only (§5), never the gate.
pub const ADVISORY_KEY: i64 = 0x5b4f_3c3;

/// Prefix of the application_name every owner connection carries:
/// `sb-owner:<holder>:<token>`.
pub const OWNER_TAG: &str = "sb-owner";

pub fn owner_tag(holder: &str, token: i64) -> String {
    format!("{OWNER_TAG}:{holder}:{token}")
}

fn env(key: &str, default: &str) -> String {
    std::env::var(key).unwrap_or_else(|_| default.to_string())
}

/// libpq-style connection string. `PGFENCE_TCP=1` connects over 127.0.0.1
/// instead of the Unix socket (used by the keepalive witness).
pub fn conninfo(user: &str, app: &str, options: &str) -> String {
    let host = if env("PGFENCE_TCP", "0") == "1" { "127.0.0.1".to_string() } else { env("PGFENCE_HOST", "/tmp") };
    let port = env("PGFENCE_PORT", "5432");
    let db = env("PGFENCE_DB", "fence");
    let mut s = format!("host={host} port={port} dbname={db} user={user} application_name='{app}' connect_timeout=5");
    if !options.is_empty() {
        s.push_str(&format!(" options='{options}'"));
    }
    s
}

pub fn connect(user: &str, app: &str, options: &str) -> Result<Client, postgres::Error> {
    Client::connect(&conninfo(user, app, options), NoTls)
}

pub fn backend_pid(c: &mut Client) -> i32 {
    c.query_one("SELECT pg_backend_pid()", &[]).expect("pg_backend_pid").get(0)
}

/// The row lock the fence takes on `_owner`. The RFC says `FOR SHARE`;
/// `FOR KEY SHARE` is the variant witness 8 evaluates.
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
pub enum LockMode {
    Share,
    KeyShare,
}

impl LockMode {
    pub fn parse(s: &str) -> LockMode {
        match s {
            "share" => LockMode::Share,
            "keyshare" => LockMode::KeyShare,
            other => panic!("unknown lock mode {other}"),
        }
    }
    pub fn fence_sql(self) -> &'static str {
        match self {
            LockMode::Share => "SELECT token FROM _owner WHERE singleton FOR SHARE",
            LockMode::KeyShare => "SELECT token FROM _owner WHERE singleton FOR KEY SHARE",
        }
    }
}

#[derive(Debug)]
pub enum WriteError {
    /// The fence or the head predicate refused: this process no longer owns the store.
    Refused(String),
    Db(postgres::Error),
}

impl From<postgres::Error> for WriteError {
    fn from(e: postgres::Error) -> Self {
        WriteError::Db(e)
    }
}

impl std::fmt::Display for WriteError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            WriteError::Refused(r) => write!(f, "REFUSED {r}"),
            WriteError::Db(e) => write!(f, "DB_ERROR {}", err_str(e)),
        }
    }
}

/// The fence (§5): the first statement of every writing transaction. The
/// row lock is held to commit, so a token increment (which needs
/// `FOR UPDATE`) cannot commit while this transaction is in flight, and any
/// fence that runs after the increment commits reads the new token.
pub fn fence(tx: &mut Transaction<'_>, mode: LockMode, token: i64) -> Result<(), WriteError> {
    let current: i64 = tx.query_one(mode.fence_sql(), &[])?.get(0);
    if current != token {
        return Err(WriteError::Refused(format!("owner_token_is_{current}_process_holds_{token}")));
    }
    Ok(())
}

pub fn err_str(e: &postgres::Error) -> String {
    match e.as_db_error() {
        Some(d) => format!("{} {}", d.code().code(), d.message()),
        None => e.to_string(),
    }
}

pub fn is_lock_timeout(e: &postgres::Error) -> bool {
    e.code() == Some(&SqlState::LOCK_NOT_AVAILABLE)
}

/// One machine-readable event line on stdout: `NAME k=v k=v ...`.
pub fn event(name: &str, fields: &str) {
    let mut out = std::io::stdout().lock();
    let _ = writeln!(out, "{name} {fields}");
    let _ = out.flush();
}

/// Value of `key=` in an event line (values contain no spaces, except a
/// trailing `err=` which the harness never parses).
pub fn kv<'a>(line: &'a str, key: &str) -> Option<&'a str> {
    line.split_whitespace().find_map(|t| t.strip_prefix(key).and_then(|r| r.strip_prefix('=')))
}

/// Schema reset, run by the harness as the superuser under `SET ROLE sb_ddl`
/// so the tables are owned by the DDL role and the serving role holds only
/// the grants the protocol needs.
pub const RESET_SQL: &str = r#"
SET ROLE sb_ddl;
DROP TABLE IF EXISTS _owner, _head, _log, _sessions, _takeovers;
CREATE TABLE _owner (
  singleton   boolean PRIMARY KEY CHECK (singleton),
  holder      text,
  token       bigint NOT NULL,
  lease_until timestamptz NOT NULL,
  backends    int[] NOT NULL DEFAULT '{}'
);
INSERT INTO _owner VALUES (true, NULL, 0, '-infinity', '{}');
CREATE TABLE _head (
  singleton   boolean PRIMARY KEY CHECK (singleton),
  seq         bigint NOT NULL,
  owner_token bigint NOT NULL
);
INSERT INTO _head VALUES (true, 0, 0);
-- One row per head advance, so every advance has a writer token and a commit timestamp.
CREATE TABLE _log (seq bigint PRIMARY KEY, owner_token bigint NOT NULL, writer text NOT NULL);
-- The non-head durable write (a session mint).
CREATE TABLE _sessions (id text PRIMARY KEY, minted_by_token bigint NOT NULL, writer text NOT NULL);
-- Written inside each takeover transaction; its xmin's commit timestamp is the takeover instant.
CREATE TABLE _takeovers (
  token           bigint PRIMARY KEY,
  holder          text NOT NULL,
  from_token      bigint NOT NULL,
  from_holder     text,
  lease_until_was timestamptz NOT NULL,
  decided_at      timestamptz NOT NULL,
  strategy        text NOT NULL
);
GRANT SELECT, INSERT, UPDATE ON _owner, _head, _log, _sessions, _takeovers TO sb_core;
GRANT SELECT ON _owner, _head, _log, _sessions, _takeovers TO sb_inspect;
RESET ROLE;
"#;

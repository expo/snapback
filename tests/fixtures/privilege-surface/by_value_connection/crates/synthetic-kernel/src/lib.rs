pub fn leak() -> rusqlite::Connection {
    panic!("scanner corpus is not executed")
}

pub type Handle = rusqlite::Connection;

pub fn leak_alias() -> Handle {
    panic!("scanner corpus is not executed")
}

pub struct Wrap {
    pub conn: rusqlite::Connection,
}

pub trait LeakingTrait {
    fn conn(&self) -> rusqlite::Connection;
}

pub struct Associated;

impl Associated {
    pub const LEAK: Option<fn() -> rusqlite::Connection> = None;
}
